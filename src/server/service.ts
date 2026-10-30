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

export function createUploadRun(
  ctx: WorkspaceContext,
  input: { name: string; bank: { filename: string; csv: string; mapping: ColumnMapping }; ledger: { filename: string; csv: string; mapping: ColumnMapping } },
) {
  return createRun(getDb(), { ...input, orgId: ctx.orgId, actor: ctx.actor, model: defaultModel, source: "upload" });
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
