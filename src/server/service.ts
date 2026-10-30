import "server-only";
import { defaultModel } from "@/engine/default-model";
import { createInvestigator } from "@/engine/investigate";
import { DEMO_BANK_MAPPING, DEMO_LEDGER_MAPPING, generateSynthetic } from "@/engine/synthetic";
import type { ColumnMapping } from "@/engine/types";
import type { ExceptionDTO, MatchDTO, TxDTO, WorkspaceDTO } from "@/lib/dto";
import { listAudit, verifyAuditChain } from "./audit";
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
  recordExport,
  ValidationError,
  type MatchDecision,
  type RunData,
} from "./repo";

/** Server-side facade used by route handlers and server components. */

export function runs() {
  return listRuns(getDb());
}

export function runSummary(runId: string) {
  return getRunSummary(getDb(), runId);
}

export function createUploadRun(input: {
  name: string;
  reviewer: string;
  bank: { filename: string; csv: string; mapping: ColumnMapping };
  ledger: { filename: string; csv: string; mapping: ColumnMapping };
}) {
  return createRun(getDb(), { ...input, actor: input.reviewer, model: defaultModel, source: "upload" });
}

export const DEMO_LIMITS = { minEvents: 50, maxEvents: 12_000 };

export function createDemoRun(input: { reviewer: string; seed: number; events: number }) {
  if (!Number.isInteger(input.seed) || input.seed < 1 || input.seed > 1_000_000) throw new ValidationError("Seed must be an integer 1–1,000,000");
  if (!Number.isInteger(input.events) || input.events < DEMO_LIMITS.minEvents || input.events > DEMO_LIMITS.maxEvents) {
    throw new ValidationError(`Events must be ${DEMO_LIMITS.minEvents}–${DEMO_LIMITS.maxEvents}`);
  }
  const ds = generateSynthetic(input.seed, input.events);
  return createRun(getDb(), {
    name: `Demo · seed ${input.seed} · ${ds.bank.length.toLocaleString("en-US")} bank rows`,
    actor: input.reviewer,
    model: defaultModel,
    source: "demo",
    bank: { filename: `synthetic-bank-${input.seed}.csv`, csv: ds.bankCsv, mapping: DEMO_BANK_MAPPING },
    ledger: { filename: `synthetic-ledger-${input.seed}.csv`, csv: ds.ledgerCsv, mapping: DEMO_LEDGER_MAPPING },
  });
}

/** Synthetic CSVs for download, so the upload flow can be exercised end to end. */
export function demoCsv(seed: number, events: number, side: "bank" | "ledger") {
  const ds = generateSynthetic(seed, Math.min(Math.max(events, DEMO_LIMITS.minEvents), DEMO_LIMITS.maxEvents));
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

export function workspace(runId: string): WorkspaceDTO {
  const data = loadRun(getDb(), runId);
  const transactions: Record<string, TxDTO> = {};
  for (const t of [...data.bank, ...data.ledger]) transactions[t.id] = txDto(t);
  const matches: MatchDTO[] = data.matches.map((m) => ({ ...m, bankTotalMinor: m.bankTotalMinor.toString(), ledgerTotalMinor: m.ledgerTotalMinor.toString() }));
  const exceptions: ExceptionDTO[] = data.exceptions.map((e) => ({ ...e, exposureMinor: e.exposureMinor.toString() }));
  return { summary: data.summary, config: data.config, transactions, matches, exceptions };
}

export function investigate(runId: string, subject: { matchId?: string; exceptionId?: string }) {
  const db = getDb();
  const data = loadRun(db, runId);
  const inv = createInvestigator(data.bank, data.ledger, asResult(data));
  const investigation = subject.matchId ? inv.investigateMatch(subject.matchId) : inv.investigateException(subject.exceptionId!);
  const decisions = listDecisions(db, runId, subject.matchId ?? subject.exceptionId);
  return { investigation, decisions };
}

export function reviewMatch(input: { runId: string; matchId: string; decision: MatchDecision; reason: string; reviewer: string }) {
  return decideMatch(getDb(), input);
}

export function reviewException(input: { runId: string; exceptionId: string; decision: "resolve" | "reopen"; reason: string; reviewer: string }) {
  return decideException(getDb(), input);
}

export function decisions(runId: string) {
  return listDecisions(getDb(), runId);
}

export type ExportFormat = "matches" | "exceptions" | "decisions" | "audit" | "json";

export function exportRun(runId: string, format: ExportFormat, actor: string): { body: string; contentType: string; filename: string } {
  const db = getDb();
  const data = loadRun(db, runId);
  recordExport(db, { runId, actor, format });
  const base = `${runId}`;
  switch (format) {
    case "matches":
      return { body: matchesCsv(data), contentType: "text/csv; charset=utf-8", filename: `${base}-matches.csv` };
    case "exceptions":
      return { body: exceptionsCsv(data), contentType: "text/csv; charset=utf-8", filename: `${base}-exceptions.csv` };
    case "decisions":
      return { body: decisionsCsv(listDecisions(db, runId)), contentType: "text/csv; charset=utf-8", filename: `${base}-review-decisions.csv` };
    case "audit":
      return { body: auditCsv(listAudit(db, { runId, limit: 5000 })), contentType: "text/csv; charset=utf-8", filename: `${base}-audit.csv` };
    case "json":
      return { body: JSON.stringify(reportJson(data, listDecisions(db, runId)), null, 2), contentType: "application/json", filename: `${base}-report.json` };
  }
}

export function audit(limit = 500) {
  return listAudit(getDb(), { limit });
}

export function verifyAudit() {
  return verifyAuditChain(getDb());
}
