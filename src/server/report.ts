import { absMinor } from "@/engine/money";
import type { ExceptionType, MatchMethod, MatchStatus, Transaction } from "@/engine/types";
import type { DecisionRecord, RunData } from "./repo";

/**
 * Reconciliation report figures, computed from the CURRENT state of a run
 * (engine results plus every human decision). All money is bigint minor units.
 *
 * Classification of each transaction (exactly one bucket per row):
 *   confirmed  — part of a verified (rule) or approved (human) match
 *   pending    — part of a suggested / needs-review match not yet decided
 *   unmatched  — in no match, or only in a rejected match
 */

export type Bucket = "confirmed" | "pending" | "unmatched";

export interface SideFigures {
  count: number;
  totalMinor: bigint;
  confirmedCount: number;
  confirmedMinor: bigint;
  pendingCount: number;
  pendingMinor: bigint;
  unmatchedCount: number;
  unmatchedMinor: bigint;
}

export interface CurrencyPosition {
  currency: string;
  bank: SideFigures;
  ledger: SideFigures;
  /** Bank total − ledger total (signed). */
  netDifferenceMinor: bigint;
  /** Σ(bank − ledger) across confirmed matches: differences accepted by reviewers (e.g. fees). */
  confirmedDifferenceMinor: bigint;
}

export interface ReportData {
  positions: CurrencyPosition[];
  matchesByStatus: Record<MatchStatus, number>;
  matchesByMethod: Record<MatchMethod, { count: number; confirmed: number }>;
  exceptions: { type: ExceptionType; currency: string; open: number; resolved: number; openExposureMinor: bigint }[];
  reviewers: { reviewer: string; approvals: number; rejections: number; reopens: number; resolutions: number; last: string }[];
  readiness: { pendingMatches: number; openExceptions: number; ready: boolean };
}

const emptySide = (): SideFigures => ({
  count: 0,
  totalMinor: 0n,
  confirmedCount: 0,
  confirmedMinor: 0n,
  pendingCount: 0,
  pendingMinor: 0n,
  unmatchedCount: 0,
  unmatchedMinor: 0n,
});

export function bucketOf(status: MatchStatus | undefined): Bucket {
  if (status === "verified" || status === "approved") return "confirmed";
  if (status === "suggested" || status === "needs_review") return "pending";
  return "unmatched";
}

export function buildReport(data: RunData, decisions: DecisionRecord[]): ReportData {
  const statusOf = new Map<string, MatchStatus>();
  for (const m of data.matches) for (const id of [...m.bankIds, ...m.ledgerIds]) statusOf.set(id, m.status);

  const positions = new Map<string, CurrencyPosition>();
  const pos = (c: string) => {
    let p = positions.get(c);
    if (!p) {
      p = { currency: c, bank: emptySide(), ledger: emptySide(), netDifferenceMinor: 0n, confirmedDifferenceMinor: 0n };
      positions.set(c, p);
    }
    return p;
  };
  const add = (s: SideFigures, t: Transaction) => {
    s.count++;
    s.totalMinor += t.amountMinor;
    const b = bucketOf(statusOf.get(t.id));
    if (b === "confirmed") {
      s.confirmedCount++;
      s.confirmedMinor += t.amountMinor;
    } else if (b === "pending") {
      s.pendingCount++;
      s.pendingMinor += t.amountMinor;
    } else {
      s.unmatchedCount++;
      s.unmatchedMinor += t.amountMinor;
    }
  };
  for (const t of data.bank) add(pos(t.currency).bank, t);
  for (const t of data.ledger) add(pos(t.currency).ledger, t);
  for (const m of data.matches) {
    if (bucketOf(m.status) === "confirmed") pos(m.currency).confirmedDifferenceMinor += m.bankTotalMinor - m.ledgerTotalMinor;
  }
  for (const p of positions.values()) p.netDifferenceMinor = p.bank.totalMinor - p.ledger.totalMinor;

  const matchesByStatus: ReportData["matchesByStatus"] = { verified: 0, suggested: 0, needs_review: 0, approved: 0, rejected: 0 };
  const matchesByMethod = {} as ReportData["matchesByMethod"];
  for (const method of ["rule_external_id", "rule_exact_reference", "ml_scored", "split_sum"] as MatchMethod[]) matchesByMethod[method] = { count: 0, confirmed: 0 };
  for (const m of data.matches) {
    matchesByStatus[m.status]++;
    matchesByMethod[m.method].count++;
    if (bucketOf(m.status) === "confirmed") matchesByMethod[m.method].confirmed++;
  }

  const excKey = new Map<string, ReportData["exceptions"][number]>();
  for (const e of data.exceptions) {
    const k = `${e.type}|${e.currency}`;
    let row = excKey.get(k);
    if (!row) {
      row = { type: e.type, currency: e.currency, open: 0, resolved: 0, openExposureMinor: 0n };
      excKey.set(k, row);
    }
    if (e.status === "open") {
      row.open++;
      row.openExposureMinor += absMinor(e.exposureMinor);
    } else row.resolved++;
  }

  const reviewerMap = new Map<string, ReportData["reviewers"][number]>();
  for (const d of decisions) {
    let r = reviewerMap.get(d.reviewer);
    if (!r) {
      r = { reviewer: d.reviewer, approvals: 0, rejections: 0, reopens: 0, resolutions: 0, last: d.createdAt };
      reviewerMap.set(d.reviewer, r);
    }
    if (d.decision === "approve") r.approvals++;
    else if (d.decision === "reject") r.rejections++;
    else if (d.decision === "reopen") r.reopens++;
    else if (d.decision === "resolve") r.resolutions++;
    if (d.createdAt > r.last) r.last = d.createdAt;
  }

  const pendingMatches = matchesByStatus.suggested + matchesByStatus.needs_review;
  const openExceptions = data.exceptions.filter((e) => e.status === "open").length;
  return {
    positions: [...positions.values()].sort((a, b) => b.bank.count + b.ledger.count - (a.bank.count + a.ledger.count)),
    matchesByStatus,
    matchesByMethod,
    exceptions: [...excKey.values()].sort((a, b) => b.open - a.open || a.type.localeCompare(b.type)),
    reviewers: [...reviewerMap.values()].sort((a, b) => b.last.localeCompare(a.last)),
    readiness: { pendingMatches, openExceptions, ready: pendingMatches === 0 && openExceptions === 0 },
  };
}
