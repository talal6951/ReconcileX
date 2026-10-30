import "server-only";
import { defaultModel } from "@/engine/default-model";
import { createInvestigator } from "@/engine/investigate";
import { DEMO_BANK_MAPPING, DEMO_LEDGER_MAPPING, generateSynthetic } from "@/engine/synthetic";
import { suggestMapping } from "@/engine/csv";
import type { Side } from "@/engine/types";
import { confirmImportRun, type ConfirmSide } from "./imports/confirm";
import { extractStatement } from "./imports/extract";
import { sampleLedgerCsv, samplePdf, sampleStatement, sampleXlsx } from "./imports/samples";
import { signPreview } from "./imports/token";
import type { ExceptionDTO, MatchDTO, TxDTO, WorkspaceDTO } from "@/lib/dto";
import { appendAudit, auditFacets, exportAuditEvents, listAudit, searchAudit, verifyAuditChain, type AuditQuery } from "./audit";
import { getDb } from "./db";
import { auditCsv, decisionsCsv, exceptionsCsv, matchesCsv, reportJson } from "./exports";
import {
  asResult,
  createRun,
  decideException,
  decideMatch,
  getRunSummary,
  listDecisions,
  listRuns,
  loadRun,
  modelUsage,
  recordExport,
  ValidationError,
  type MatchDecision,
  type RunData,
} from "./repo";
import type { WorkspaceContext } from "./session";

/**
 * Server-side facade. Every function requires a verified WorkspaceContext
 * (see session.ts); all data access is scoped to ctx.orgId and every audit
 * event is attributed to the signed-in user.
 */

export function runs(ctx: WorkspaceContext) {
  return listRuns(getDb(), ctx.orgId);
}

export function runSummary(ctx: WorkspaceContext, runId: string) {
  return getRunSummary(getDb(), ctx.orgId, runId);
}

/**
 * Step 1 of an upload: extract a file into a signed, NOT-yet-saved preview.
 * Nothing is persisted here.
 */
export async function extractForPreview(ctx: WorkspaceContext, input: { bytes: Uint8Array; filename: string; side: Side; sheet?: string }) {
  const table = await extractStatement(input.bytes, input.filename, { sheet: input.sheet });
  const suggestion = suggestMapping(table.headers, table.rows);
  // No currency column: use the currency the document itself states (exactly one code found), if any.
  if (!suggestion.mapping.currency && table.detectedCurrency) suggestion.mapping.defaultCurrency = table.detectedCurrency;
  const token = signPreview(table, { orgId: ctx.orgId, userId: ctx.userId, side: input.side });
  return { extraction: table, suggestion, token };
}

/** Step 2: save a reviewed, explicitly confirmed preview (signature re-verified server-side). */
export function confirmUpload(ctx: WorkspaceContext, input: { name: string; bank: ConfirmSide; ledger: ConfirmSide }) {
  return confirmImportRun(getDb(), { orgId: ctx.orgId, userId: ctx.userId, actor: ctx.actor }, input, defaultModel);
}

/** Synthetic sample files (clearly labelled, no real data) for trying the import flow. */
export async function sampleFile(file: "bank-pdf" | "bank-xlsx" | "ledger-csv", seed: number, events: number) {
  checkDemo(seed, events);
  if (file === "ledger-csv") return { bytes: new TextEncoder().encode(sampleLedgerCsv(seed, events)), filename: `synthetic-ledger-${seed}.csv`, contentType: "text/csv; charset=utf-8" };
  const s = sampleStatement(seed, events);
  if (file === "bank-xlsx") return { bytes: await sampleXlsx(s), filename: `synthetic-statement-${seed}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  return { bytes: await samplePdf(s, { wrapEvery: 7 }), filename: `synthetic-statement-${seed}.pdf`, contentType: "application/pdf" };
}

export const DEMO_LIMITS = { minEvents: 50, maxEvents: 12_000 };

function checkDemo(seed: number, events: number) {
  if (!Number.isInteger(seed) || seed < 1 || seed > 1_000_000) throw new ValidationError("Seed must be an integer 1–1,000,000");
  if (!Number.isInteger(events) || events < DEMO_LIMITS.minEvents || events > DEMO_LIMITS.maxEvents) {
    throw new ValidationError(`Events must be ${DEMO_LIMITS.minEvents}–${DEMO_LIMITS.maxEvents}`);
  }
}

export function createDemoRun(ctx: WorkspaceContext, input: { seed: number; events: number }) {
  checkDemo(input.seed, input.events);
  const ds = generateSynthetic(input.seed, input.events);
  return createRun(getDb(), {
    orgId: ctx.orgId,
    name: `Demo · seed ${input.seed} · ${ds.bank.length.toLocaleString("en-US")} bank rows`,
    actor: ctx.actor,
    model: defaultModel,
    source: "demo",
    bank: { filename: `synthetic-bank-${input.seed}.csv`, csv: ds.bankCsv, mapping: DEMO_BANK_MAPPING },
    ledger: { filename: `synthetic-ledger-${input.seed}.csv`, csv: ds.ledgerCsv, mapping: DEMO_LEDGER_MAPPING },
  });
}

/** Synthetic CSVs (no real data) so the upload flow can be exercised end to end. */
export function demoCsv(seed: number, events: number, side: "bank" | "ledger") {
  checkDemo(seed, events);
  const ds = generateSynthetic(seed, events);
  return side === "bank" ? ds.bankCsv : ds.ledgerCsv;
}

function txDto(t: RunData["bank"][number]): TxDTO {
  return {
    id: t.id,
    side: t.side,
    sourceLine: t.sourceLine,
    externalId: t.externalId,
    date: t.date,
    amountMinor: t.amountMinor.toString(),
    currency: t.currency,
    reference: t.reference,
    description: t.description,
    counterparty: t.counterparty,
  };
}

export function workspace(ctx: WorkspaceContext, runId: string): WorkspaceDTO {
  const data = loadRun(getDb(), ctx.orgId, runId);
  const transactions: Record<string, TxDTO> = {};
  for (const t of [...data.bank, ...data.ledger]) transactions[t.id] = txDto(t);
  const matches: MatchDTO[] = data.matches.map((m) => ({ ...m, bankTotalMinor: m.bankTotalMinor.toString(), ledgerTotalMinor: m.ledgerTotalMinor.toString() }));
  const exceptions: ExceptionDTO[] = data.exceptions.map((e) => ({ ...e, exposureMinor: e.exposureMinor.toString() }));
  return { summary: data.summary, config: data.config, transactions, matches, exceptions };
}

export function investigate(ctx: WorkspaceContext, runId: string, subject: { matchId?: string; exceptionId?: string }) {
  const db = getDb();
  const data = loadRun(db, ctx.orgId, runId);
  const inv = createInvestigator(data.bank, data.ledger, asResult(data));
  const investigation = subject.matchId ? inv.investigateMatch(subject.matchId) : inv.investigateException(subject.exceptionId!);
  const decisions = listDecisions(db, ctx.orgId, runId, subject.matchId ?? subject.exceptionId);
  return { investigation, decisions };
}

export function reviewMatch(ctx: WorkspaceContext, input: { runId: string; matchId: string; decision: MatchDecision; reason: string }) {
  return decideMatch(getDb(), { ...input, orgId: ctx.orgId, reviewer: ctx.actor });
}

export function reviewException(ctx: WorkspaceContext, input: { runId: string; exceptionId: string; decision: "resolve" | "reopen"; reason: string }) {
  return decideException(getDb(), { ...input, orgId: ctx.orgId, reviewer: ctx.actor });
}

export function decisions(ctx: WorkspaceContext, runId: string) {
  return listDecisions(getDb(), ctx.orgId, runId);
}

export function runData(ctx: WorkspaceContext, runId: string) {
  return loadRun(getDb(), ctx.orgId, runId);
}

export type ExportFormat = "matches" | "exceptions" | "decisions" | "audit" | "json";

export function exportRun(ctx: WorkspaceContext, runId: string, format: ExportFormat): { body: string; contentType: string; filename: string } {
  const db = getDb();
  const data = loadRun(db, ctx.orgId, runId);
  recordExport(db, { orgId: ctx.orgId, runId, actor: ctx.actor, format });
  const base = `${runId}`;
  switch (format) {
    case "matches":
      return { body: matchesCsv(data), contentType: "text/csv; charset=utf-8", filename: `${base}-matches.csv` };
    case "exceptions":
      return { body: exceptionsCsv(data), contentType: "text/csv; charset=utf-8", filename: `${base}-exceptions.csv` };
    case "decisions":
      return { body: decisionsCsv(listDecisions(db, ctx.orgId, runId)), contentType: "text/csv; charset=utf-8", filename: `${base}-review-decisions.csv` };
    case "audit":
      return { body: auditCsv(listAudit(db, { orgId: ctx.orgId, runId, limit: 5000 })), contentType: "text/csv; charset=utf-8", filename: `${base}-audit.csv` };
    case "json":
      return { body: JSON.stringify(reportJson(data, listDecisions(db, ctx.orgId, runId)), null, 2), contentType: "application/json", filename: `${base}-report.json` };
  }
}

export function audit(ctx: WorkspaceContext, limit = 500) {
  return listAudit(getDb(), { orgId: ctx.orgId, limit });
}

export function verifyAudit(ctx: WorkspaceContext) {
  return verifyAuditChain(getDb(), ctx.orgId);
}

export function workspaceModelUsage(ctx: WorkspaceContext) {
  return modelUsage(getDb(), ctx.orgId);
}

/** Audit filters as accepted from callers. The workspace always comes from the verified session, never the request. */
export type AuditFilters = Omit<AuditQuery, "orgId">;

export function searchWorkspaceAudit(ctx: WorkspaceContext, filters: AuditFilters, page: { limit?: number; offset?: number }) {
  return searchAudit(getDb(), { ...filters, orgId: ctx.orgId }, page);
}

export function workspaceAuditFacets(ctx: WorkspaceContext) {
  return auditFacets(getDb(), ctx.orgId);
}

/** Workspace audit CSV (most recent 5,000 matching events). The export itself is audited. */
export function exportWorkspaceAudit(ctx: WorkspaceContext, filters: AuditFilters) {
  const db = getDb();
  const { events, total, truncated } = exportAuditEvents(db, { ...filters, orgId: ctx.orgId });
  appendAudit(db, {
    orgId: ctx.orgId,
    actor: ctx.actor,
    action: "audit.exported",
    entityType: "workspace",
    entityId: ctx.orgId,
    details: { exported: events.length, matched: total, truncated, filters: { ...filters } },
  });
  return { csv: auditCsv(events), exported: events.length, total, truncated };
}
