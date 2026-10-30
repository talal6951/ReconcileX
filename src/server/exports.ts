import Papa from "papaparse";
import { toDecimalString } from "@/engine/money";
import type { Transaction } from "@/engine/types";
import type { AuditEvent } from "./audit";
import type { DecisionRecord, RunData } from "./repo";

/**
 * Neutralise spreadsheet formula injection in TEXT cells (OWASP CSV injection):
 * a leading = + - @ tab or CR is prefixed with an apostrophe. Numeric amount
 * cells are validated as plain decimals instead, so "-100.00" stays numeric.
 */
export function safeText(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function amount(minor: bigint, currency: string): string {
  const s = toDecimalString(minor, currency);
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Refusing to export malformed amount ${s}`);
  return s;
}

function csv(fields: string[], rows: string[][]): string {
  return Papa.unparse({ fields, data: rows }, { newline: "\r\n" });
}

export function matchesCsv(data: RunData): string {
  const tx = new Map<string, Transaction>([...data.bank, ...data.ledger].map((t) => [t.id, t]));
  const describe = (ids: string[]) =>
    ids
      .map((id) => tx.get(id))
      .filter(Boolean)
      .map((t) => [t!.externalId || t!.id, t!.date, t!.reference, t!.description].filter(Boolean).join(" "))
      .join(" | ");
  return csv(
    ["Match ID", "Status", "Engine status", "Method", "Kind", "Score", "Currency", "Bank total", "Ledger total", "Difference", "Bank rows", "Ledger rows", "Bank details", "Ledger details", "Flags"],
    data.matches.map((m) => [
      safeText(m.id),
      safeText(m.status),
      safeText(m.originalStatus),
      safeText(m.method),
      safeText(m.kind),
      m.score.toFixed(4),
      safeText(m.currency),
      amount(m.bankTotalMinor, m.currency),
      amount(m.ledgerTotalMinor, m.currency),
      amount(m.bankTotalMinor - m.ledgerTotalMinor, m.currency),
      safeText(m.bankIds.join(" ")),
      safeText(m.ledgerIds.join(" ")),
      safeText(describe(m.bankIds)),
      safeText(describe(m.ledgerIds)),
      safeText(m.flags.join(" ")),
    ]),
  );
}

export function exceptionsCsv(data: RunData): string {
  const tx = new Map<string, Transaction>([...data.bank, ...data.ledger].map((t) => [t.id, t]));
  return csv(
    ["Exception ID", "Type", "Status", "Currency", "Exposure", "Message", "Bank rows", "Ledger rows", "Bank source lines", "Ledger source lines"],
    data.exceptions.map((e) => [
      safeText(e.id),
      safeText(e.type),
      safeText(e.status),
      safeText(e.currency),
      amount(e.exposureMinor, e.currency),
      safeText(e.message),
      safeText(e.bankIds.join(" ")),
      safeText(e.ledgerIds.join(" ")),
      e.bankIds.map((id) => tx.get(id)?.sourceLine ?? "").join(" "),
      e.ledgerIds.map((id) => tx.get(id)?.sourceLine ?? "").join(" "),
    ]),
  );
}

export function decisionsCsv(decisions: DecisionRecord[]): string {
  return csv(
    ["Decision ID", "Subject type", "Subject ID", "Decision", "From", "To", "Reason", "Reviewer", "Timestamp"],
    decisions.map((d) => [String(d.id), safeText(d.subjectType), safeText(d.subjectId), safeText(d.decision), safeText(d.fromStatus), safeText(d.toStatus), safeText(d.reason), safeText(d.reviewer), safeText(d.createdAt)]),
  );
}

export function auditCsv(events: AuditEvent[]): string {
  return csv(
    ["Seq", "Timestamp", "Actor", "Action", "Run", "Entity type", "Entity ID", "Details", "Prev hash", "Hash"],
    events.map((e) => [String(e.seq), safeText(e.ts), safeText(e.actor), safeText(e.action), safeText(e.runId), safeText(e.entityType), safeText(e.entityId), safeText(JSON.stringify(e.details)), e.prevHash, e.hash]),
  );
}

/** JSON-safe structured report (bigints as decimal strings plus raw minor units). */
export function reportJson(data: RunData, decisions: DecisionRecord[]) {
  const money = (minor: bigint, currency: string) => ({ minor: minor.toString(), decimal: toDecimalString(minor, currency), currency });
  return {
    generatedAt: new Date().toISOString(),
    run: data.summary,
    config: data.config,
    matches: data.matches.map((m) => ({
      ...m,
      bankTotal: money(m.bankTotalMinor, m.currency),
      ledgerTotal: money(m.ledgerTotalMinor, m.currency),
      bankTotalMinor: undefined,
      ledgerTotalMinor: undefined,
    })),
    exceptions: data.exceptions.map((e) => ({ ...e, exposure: money(e.exposureMinor, e.currency), exposureMinor: undefined })),
    decisions,
  };
}
