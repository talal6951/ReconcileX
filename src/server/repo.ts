import { createHash, randomUUID } from "node:crypto";
import { normalizeRows, parseCsv, validateMapping } from "@/engine/csv";
import type { LogisticModel } from "@/engine/model";
import { reconcile } from "@/engine/matcher";
import type {
  ColumnMapping,
  EngineConfig,
  Match,
  MatchStatus,
  ReconException,
  ReconciliationResult,
  RowError,
  RunMetrics,
  Side,
  Transaction,
} from "@/engine/types";
import { appendAudit } from "./audit";
import type { DB } from "./db";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_REPORTED_ERRORS = 200;

export interface ImportSide {
  filename: string;
  csv: string;
  mapping: ColumnMapping;
}

export type CreateRunOutcome =
  | { ok: true; runId: string }
  | { ok: false; errors: { side: Side | "request"; problems: string[]; rowErrors: RowError[]; totalRowErrors: number }[] };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function cleanActor(actor: string): string {
  const a = actor.trim().replace(/[\u0000-\u001f]/g, "");
  if (a.length < 1 || a.length > 80) throw new ValidationError("Reviewer name must be 1–80 characters");
  return a;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Validate both files, persist datasets and transactions, run the engine,
 * persist the results and write audit events — atomically.
 */
export function createRun(
  db: DB,
  input: { orgId: string; name: string; bank: ImportSide; ledger: ImportSide; actor: string; model: LogisticModel; config?: Partial<EngineConfig>; source: "upload" | "demo" },
): CreateRunOutcome {
  const orgId = requireOrg(input.orgId);
  const actor = cleanActor(input.actor);
  const name = input.name.trim().slice(0, 120) || "Untitled reconciliation";
  const parsed: Record<Side, Transaction[]> = { bank: [], ledger: [] };
  const errors: Extract<CreateRunOutcome, { ok: false }>["errors"] = [];

  for (const side of ["bank", "ledger"] as const) {
    const s = input[side];
    if (Buffer.byteLength(s.csv, "utf8") > MAX_UPLOAD_BYTES) {
      errors.push({ side, problems: [`File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`], rowErrors: [], totalRowErrors: 0 });
      continue;
    }
    const csv = parseCsv(s.csv);
    const problems = validateMapping(csv.headers, s.mapping);
    if (csv.rows.length === 0) problems.push("File has no data rows");
    let rowErrors = [...csv.errors];
    if (problems.length === 0 && csv.errors.length === 0) {
      const norm = normalizeRows(side, csv.headers, csv.rows, s.mapping);
      rowErrors = norm.errors;
      parsed[side] = norm.transactions;
    }
    if (problems.length > 0 || rowErrors.length > 0) {
      errors.push({ side, problems, rowErrors: rowErrors.slice(0, MAX_REPORTED_ERRORS), totalRowErrors: rowErrors.length });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const result = reconcile(parsed.bank, parsed.ledger, { model: input.model, config: input.config });
  const runId = `RUN-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const now = new Date().toISOString();

  db.transaction(() => {
    const datasetIds: Record<Side, string> = { bank: randomUUID(), ledger: randomUUID() };
    const insDs = db.prepare("INSERT INTO datasets (id, organization_id, side, filename, sha256, row_count, mapping_json, created_at) VALUES (?,?,?,?,?,?,?,?)");
    const insTx = db.prepare(
      "INSERT INTO transactions (dataset_id, id, source_line, external_id, date, day, amount_minor, currency, reference, description, counterparty) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const side of ["bank", "ledger"] as const) {
      const s = input[side];
      const fileHash = sha256(s.csv);
      insDs.run(datasetIds[side], orgId, side, s.filename.slice(0, 200), fileHash, parsed[side].length, JSON.stringify(s.mapping), now);
      for (const t of parsed[side]) {
        insTx.run(datasetIds[side], t.id, t.sourceLine, t.externalId, t.date, t.day, t.amountMinor.toString(), t.currency, t.reference, t.description, t.counterparty);
      }
      appendAudit(db, { orgId, actor, action: "dataset.imported", runId, entityType: "dataset", entityId: datasetIds[side], details: { side, filename: s.filename, sha256: fileHash, rows: parsed[side].length } });
    }
    db.prepare(
      "INSERT INTO runs (id, organization_id, name, bank_dataset_id, ledger_dataset_id, engine_version, model_version, config_json, metrics_json, duplicate_groups_json, source, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(runId, orgId, name, datasetIds.bank, datasetIds.ledger, result.engineVersion, result.modelVersion, JSON.stringify(result.config), JSON.stringify(serializeMetrics(result.metrics)), JSON.stringify(result.duplicateGroups), input.source, actor, now);
    const insM = db.prepare(
      "INSERT INTO matches (run_id, id, kind, status, original_status, method, score, bank_ids_json, ledger_ids_json, currency, bank_total_minor, ledger_total_minor, flags_json, evidence_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const m of result.matches) {
      insM.run(runId, m.id, m.kind, m.status, m.status, m.method, m.score, JSON.stringify(m.bankIds), JSON.stringify(m.ledgerIds), m.currency, m.bankTotalMinor.toString(), m.ledgerTotalMinor.toString(), JSON.stringify(m.flags), JSON.stringify(m.evidence));
    }
    const insE = db.prepare(
      "INSERT INTO exceptions (run_id, id, type, bank_ids_json, ledger_ids_json, currency, exposure_minor, message, details_json) VALUES (?,?,?,?,?,?,?,?,?)",
    );
    for (const e of result.exceptions) {
      insE.run(runId, e.id, e.type, JSON.stringify(e.bankIds), JSON.stringify(e.ledgerIds), e.currency, e.exposureMinor.toString(), e.message, JSON.stringify(e.details));
    }
    appendAudit(db, {
      orgId,
      actor,
      action: "run.completed",
      runId,
      entityType: "run",
      entityId: runId,
      details: {
        engineVersion: result.engineVersion,
        modelVersion: result.modelVersion,
        matches: result.matches.length,
        verified: result.metrics.verifiedMatches,
        exceptions: result.exceptions.length,
        totalMs: result.metrics.totalMs,
      },
    });
  })();
  runCache.delete(runId);
  return { ok: true, runId };
}

/** Metrics with bigint totals converted to strings for JSON storage. */
export type StoredMetrics = Omit<RunMetrics, "byCurrency"> & {
  byCurrency: { currency: string; bankCount: number; ledgerCount: number; matchedBankCount: number; bankTotalMinor: string; ledgerTotalMinor: string; matchedBankMinor: string; unmatchedBankMinor: string; unmatchedLedgerMinor: string }[];
};

function serializeMetrics(m: RunMetrics): StoredMetrics {
  return {
    ...m,
    byCurrency: m.byCurrency.map((c) => ({
      ...c,
      bankTotalMinor: c.bankTotalMinor.toString(),
      ledgerTotalMinor: c.ledgerTotalMinor.toString(),
      matchedBankMinor: c.matchedBankMinor.toString(),
      unmatchedBankMinor: c.unmatchedBankMinor.toString(),
      unmatchedLedgerMinor: c.unmatchedLedgerMinor.toString(),
    })),
  };
}

export interface ReviewProgress {
  verified: number;
  approved: number;
  rejected: number;
  pending: number;
  openExceptions: number;
  resolvedExceptions: number;
}

export interface RunSummary {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  source: string;
  engineVersion: string;
  modelVersion: string;
  bankFile: string;
  ledgerFile: string;
  metrics: StoredMetrics;
  progress: ReviewProgress;
}

interface RunRow {
  id: string;
  name: string;
  created_at: string;
  created_by: string;
  source: string;
  engine_version: string;
  model_version: string;
  metrics_json: string;
  config_json: string;
  duplicate_groups_json: string;
  bank_dataset_id: string;
  ledger_dataset_id: string;
  bank_file: string;
  ledger_file: string;
}

const RUN_SELECT = `SELECT r.*, b.filename AS bank_file, l.filename AS ledger_file FROM runs r
  JOIN datasets b ON b.id = r.bank_dataset_id JOIN datasets l ON l.id = r.ledger_dataset_id`;

function progressFor(db: DB, runId: string): ReviewProgress {
  const m = db.prepare("SELECT status, COUNT(*) AS n FROM matches WHERE run_id = ? GROUP BY status").all(runId) as { status: MatchStatus; n: number }[];
  const e = db.prepare("SELECT status, COUNT(*) AS n FROM exceptions WHERE run_id = ? GROUP BY status").all(runId) as { status: string; n: number }[];
  const get = (s: string) => m.find((x) => x.status === s)?.n ?? 0;
  return {
    verified: get("verified"),
    approved: get("approved"),
    rejected: get("rejected"),
    pending: get("suggested") + get("needs_review"),
    openExceptions: e.find((x) => x.status === "open")?.n ?? 0,
    resolvedExceptions: e.find((x) => x.status === "resolved")?.n ?? 0,
  };
}

const toSummary = (db: DB, r: RunRow): RunSummary => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  createdBy: r.created_by,
  source: r.source,
  engineVersion: r.engine_version,
  modelVersion: r.model_version,
  bankFile: r.bank_file,
  ledgerFile: r.ledger_file,
  metrics: JSON.parse(r.metrics_json),
  progress: progressFor(db, r.id),
});

export function listRuns(db: DB, orgId: string, limit = 100): RunSummary[] {
  const rows = db.prepare(`${RUN_SELECT} WHERE r.organization_id = ? ORDER BY r.created_at DESC LIMIT ?`).all(requireOrg(orgId), limit) as RunRow[];
  return rows.map((r) => toSummary(db, r));
}

/**
 * Tenant guard: a run outside the caller's workspace is reported as not found
 * (no existence leak across workspaces).
 */
function runRow(db: DB, orgId: string, runId: string): RunRow {
  const r = db.prepare(`${RUN_SELECT} WHERE r.id = ? AND r.organization_id = ?`).get(runId, requireOrg(orgId)) as RunRow | undefined;
  if (!r) throw new NotFoundError(`Run ${runId} not found`);
  return r;
}

export function getRunSummary(db: DB, orgId: string, runId: string): RunSummary {
  return toSummary(db, runRow(db, orgId, runId));
}

function requireOrg(orgId: string): string {
  if (typeof orgId !== "string" || orgId.length === 0) throw new Error("Workspace context is required");
  return orgId;
}

interface TxRow {
  id: string;
  source_line: number;
  external_id: string;
  date: string;
  day: number;
  amount_minor: string;
  currency: string;
  reference: string;
  description: string;
  counterparty: string;
}

interface MatchRow {
  id: string;
  kind: Match["kind"];
  status: MatchStatus;
  original_status: MatchStatus;
  method: Match["method"];
  score: number;
  bank_ids_json: string;
  ledger_ids_json: string;
  currency: string;
  bank_total_minor: string;
  ledger_total_minor: string;
  flags_json: string;
  evidence_json: string;
}

interface ExceptionRow {
  id: string;
  type: ReconException["type"];
  status: "open" | "resolved";
  bank_ids_json: string;
  ledger_ids_json: string;
  currency: string;
  exposure_minor: string;
  message: string;
  details_json: string;
}

export type StoredMatch = Match & { originalStatus: MatchStatus };
export type StoredException = ReconException & { status: "open" | "resolved" };

export interface RunData {
  summary: RunSummary;
  config: EngineConfig;
  bank: Transaction[];
  ledger: Transaction[];
  matches: StoredMatch[];
  exceptions: StoredException[];
  duplicateGroups: ReconciliationResult["duplicateGroups"];
}

const runCache = new Map<string, RunData>();

function loadTxs(db: DB, datasetId: string, side: Side): Transaction[] {
  const rows = db.prepare("SELECT * FROM transactions WHERE dataset_id = ? ORDER BY id").all(datasetId) as TxRow[];
  return rows.map((r) => ({
    id: r.id,
    side,
    sourceLine: r.source_line,
    externalId: r.external_id,
    date: r.date,
    day: r.day,
    amountMinor: BigInt(r.amount_minor),
    currency: r.currency,
    reference: r.reference,
    description: r.description,
    counterparty: r.counterparty,
  }));
}

/** Full run state including current review statuses. Transactions are cached (immutable). */
export function loadRun(db: DB, orgId: string, runId: string): RunData {
  // Tenant check happens before the cache is consulted.
  const r = runRow(db, orgId, runId);
  let cached = runCache.get(runId);
  if (!cached) {
    cached = {
      summary: toSummary(db, r),
      config: JSON.parse(r.config_json),
      bank: loadTxs(db, r.bank_dataset_id, "bank"),
      ledger: loadTxs(db, r.ledger_dataset_id, "ledger"),
      matches: [],
      exceptions: [],
      duplicateGroups: JSON.parse(r.duplicate_groups_json),
    };
    if (runCache.size > 8) runCache.delete(runCache.keys().next().value!);
    runCache.set(runId, cached);
  }
  const matches = (db.prepare("SELECT * FROM matches WHERE run_id = ? ORDER BY id").all(runId) as MatchRow[]).map(
    (m): StoredMatch => ({
      id: m.id,
      kind: m.kind,
      status: m.status,
      originalStatus: m.original_status,
      method: m.method,
      score: m.score,
      bankIds: JSON.parse(m.bank_ids_json),
      ledgerIds: JSON.parse(m.ledger_ids_json),
      currency: m.currency,
      bankTotalMinor: BigInt(m.bank_total_minor),
      ledgerTotalMinor: BigInt(m.ledger_total_minor),
      flags: JSON.parse(m.flags_json),
      evidence: JSON.parse(m.evidence_json),
    }),
  );
  const exceptions = (db.prepare("SELECT * FROM exceptions WHERE run_id = ? ORDER BY id").all(runId) as ExceptionRow[]).map(
    (e): StoredException => ({
      id: e.id,
      type: e.type,
      status: e.status,
      bankIds: JSON.parse(e.bank_ids_json),
      ledgerIds: JSON.parse(e.ledger_ids_json),
      currency: e.currency,
      exposureMinor: BigInt(e.exposure_minor),
      message: e.message,
      details: JSON.parse(e.details_json),
    }),
  );
  return { ...cached, summary: toSummary(db, r), matches, exceptions };
}

/** Rebuild an engine result object (for the investigator) from stored state. */
export function asResult(data: RunData): ReconciliationResult {
  return {
    engineVersion: data.summary.engineVersion,
    modelVersion: data.summary.modelVersion,
    config: data.config,
    matches: data.matches,
    exceptions: data.exceptions,
    duplicateGroups: data.duplicateGroups,
    metrics: {} as RunMetrics,
  };
}

export type MatchDecision = "approve" | "reject" | "reopen";

const TRANSITIONS: Record<MatchDecision, MatchStatus[]> = {
  approve: ["suggested", "needs_review"],
  reject: ["suggested", "needs_review", "verified", "approved"],
  reopen: ["approved", "rejected"],
};

function cleanReason(reason: string): string {
  const r = reason.trim();
  if (r.length < 3 || r.length > 1000) throw new ValidationError("A reason of 3–1000 characters is required for every review decision");
  return r;
}

/** Human review of a proposed match. Every decision is recorded and audited. */
export function decideMatch(db: DB, input: { orgId: string; runId: string; matchId: string; decision: MatchDecision; reason: string; reviewer: string }) {
  const reviewer = cleanActor(input.reviewer);
  const reason = cleanReason(input.reason);
  return db.transaction(() => {
    runRow(db, input.orgId, input.runId);
    const row = db.prepare("SELECT status, original_status FROM matches WHERE run_id = ? AND id = ?").get(input.runId, input.matchId) as
      | { status: MatchStatus; original_status: MatchStatus }
      | undefined;
    if (!row) throw new NotFoundError(`Match ${input.matchId} not found in ${input.runId}`);
    if (!TRANSITIONS[input.decision].includes(row.status)) {
      throw new ValidationError(`Cannot ${input.decision} a match whose status is "${row.status}"`);
    }
    const to: MatchStatus = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : row.original_status;
    db.prepare("UPDATE matches SET status = ? WHERE run_id = ? AND id = ?").run(to, input.runId, input.matchId);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO review_decisions (run_id, subject_type, subject_id, decision, from_status, to_status, reason, reviewer, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(input.runId, "match", input.matchId, input.decision, row.status, to, reason, reviewer, now);
    appendAudit(db, { orgId: input.orgId, actor: reviewer, action: `match.${input.decision}`, runId: input.runId, entityType: "match", entityId: input.matchId, details: { from: row.status, to, reason } });
    return { from: row.status, to };
  })();
}

export function decideException(db: DB, input: { orgId: string; runId: string; exceptionId: string; decision: "resolve" | "reopen"; reason: string; reviewer: string }) {
  const reviewer = cleanActor(input.reviewer);
  const reason = cleanReason(input.reason);
  return db.transaction(() => {
    runRow(db, input.orgId, input.runId);
    const row = db.prepare("SELECT status FROM exceptions WHERE run_id = ? AND id = ?").get(input.runId, input.exceptionId) as { status: "open" | "resolved" } | undefined;
    if (!row) throw new NotFoundError(`Exception ${input.exceptionId} not found in ${input.runId}`);
    const expected = input.decision === "resolve" ? "open" : "resolved";
    if (row.status !== expected) throw new ValidationError(`Cannot ${input.decision} an exception that is ${row.status}`);
    const to = input.decision === "resolve" ? "resolved" : "open";
    db.prepare("UPDATE exceptions SET status = ? WHERE run_id = ? AND id = ?").run(to, input.runId, input.exceptionId);
    db.prepare(
      "INSERT INTO review_decisions (run_id, subject_type, subject_id, decision, from_status, to_status, reason, reviewer, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(input.runId, "exception", input.exceptionId, input.decision, row.status, to, reason, reviewer, new Date().toISOString());
    appendAudit(db, { orgId: input.orgId, actor: reviewer, action: `exception.${input.decision}`, runId: input.runId, entityType: "exception", entityId: input.exceptionId, details: { from: row.status, to, reason } });
    return { from: row.status, to };
  })();
}

export interface DecisionRecord {
  id: number;
  subjectType: "match" | "exception";
  subjectId: string;
  decision: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
  reviewer: string;
  createdAt: string;
}

export function listDecisions(db: DB, orgId: string, runId: string, subjectId?: string): DecisionRecord[] {
  runRow(db, orgId, runId);
  const rows = (
    subjectId
      ? db.prepare("SELECT * FROM review_decisions WHERE run_id = ? AND subject_id = ? ORDER BY id DESC").all(runId, subjectId)
      : db.prepare("SELECT * FROM review_decisions WHERE run_id = ? ORDER BY id DESC").all(runId)
  ) as { id: number; subject_type: "match" | "exception"; subject_id: string; decision: string; from_status: string; to_status: string; reason: string; reviewer: string; created_at: string }[];
  return rows.map((r) => ({
    id: r.id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    decision: r.decision,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    reason: r.reason,
    reviewer: r.reviewer,
    createdAt: r.created_at,
  }));
}

export function recordExport(db: DB, input: { orgId: string; runId: string; actor: string; format: string }) {
  runRow(db, input.orgId, input.runId);
  appendAudit(db, { orgId: input.orgId, actor: cleanActor(input.actor), action: "report.exported", runId: input.runId, entityType: "run", entityId: input.runId, details: { format: input.format } });
}
