import { currencyExponent, formatMinor } from "@/engine/money";

/** Format an integer-minor-unit string for display. Uses BigInt end to end. */
export function money(minor: string | bigint, currency: string, opts: { sign?: boolean } = {}): string {
  const v = typeof minor === "bigint" ? minor : BigInt(minor);
  const s = formatMinor(v, currency);
  return opts.sign && v > 0n ? `+${s}` : s;
}

/** Compact display for large totals (display only; never used in calculations). */
export function compactMoney(minor: string | bigint, currency: string): string {
  const v = typeof minor === "bigint" ? minor : BigInt(minor);
  const abs = v < 0n ? -v : v;
  const major = abs / 10n ** BigInt(currencyExponent(currency));
  const sign = v < 0n ? "-" : "";
  if (major >= 1_000_000n) return `${sign}${(Number(major / 10_000n) / 100).toFixed(2)}M`;
  if (major >= 10_000n) return `${sign}${(Number(major / 100n) / 10).toFixed(1)}K`;
  return `${sign}${formatMinor(abs, currency)}`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "n/a";
  return `${(v * 100).toFixed(digits)}%`;
}

export function int(v: number): string {
  return v.toLocaleString("en-US");
}

export function ms(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const STATUS_LABEL: Record<string, string> = {
  verified: "Verified",
  suggested: "Suggested",
  needs_review: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
};

export const METHOD_LABEL: Record<string, string> = {
  rule_external_id: "Rule · Transaction ID",
  rule_exact_reference: "Rule · Reference",
  ml_scored: "ML scored",
  split_sum: "Split / aggregate",
};

export const EXCEPTION_LABEL: Record<string, string> = {
  missing_in_ledger: "Missing in ledger",
  missing_in_bank: "Missing in bank",
  duplicate_bank: "Duplicate (bank)",
  duplicate_ledger: "Duplicate (ledger)",
  amount_mismatch: "Amount mismatch",
  currency_mismatch: "Currency mismatch",
};

export const FLAG_LABEL: Record<string, string> = {
  amount_difference: "Amount diff",
  date_lag: "Date lag",
  ambiguous: "Ambiguous",
  duplicate_involved: "Duplicate",
  low_confidence: "Low confidence",
};
