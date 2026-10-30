import type { DateFormat } from "./dates";
import type { DecimalSeparator } from "./money";

export type Side = "bank" | "ledger";

export interface Transaction {
  /** Run-unique id, e.g. "B-000012". */
  id: string;
  side: Side;
  /** 1-based line number in the source file (header is line 1). */
  sourceLine: number;
  externalId: string;
  /** ISO calendar date YYYY-MM-DD. */
  date: string;
  /** Days since epoch, for window arithmetic. */
  day: number;
  /** Signed integer minor units. */
  amountMinor: bigint;
  currency: string;
  reference: string;
  description: string;
  counterparty: string;
}

export interface ColumnMapping {
  date: string;
  /** Single signed amount column. Mutually exclusive with debit/credit. */
  amount?: string;
  debit?: string;
  credit?: string;
  currency?: string;
  /** Used when no currency column is mapped. */
  defaultCurrency?: string;
  reference?: string;
  description?: string;
  externalId?: string;
  counterparty?: string;
  dateFormat: DateFormat;
  decimalSeparator: DecimalSeparator;
  /** Flip signs so that inflows are positive on both sides. */
  invertSign?: boolean;
}

export interface RowError {
  line: number;
  column?: string;
  value?: string;
  message: string;
}

export type MatchStatus = "verified" | "suggested" | "needs_review" | "approved" | "rejected";
export type MatchMethod = "rule_external_id" | "rule_exact_reference" | "ml_scored" | "split_sum";
export type MatchKind = "one_to_one" | "one_to_many" | "many_to_one";

export interface FeatureContribution {
  feature: string;
  label: string;
  /** null when the input was missing on one or both records. */
  value: number | null;
  contribution: number;
}

export interface MatchEvidence {
  /** Plain-language rule or reasoning trail, each item grounded in the data. */
  reasons: string[];
  amountDifferenceMinor: string;
  dayDifference: number;
  referenceSimilarity?: number;
  contributions?: FeatureContribution[];
  /** Other candidates considered for the same transaction(s). */
  alternatives?: { bankIds: string[]; ledgerIds: string[]; score: number }[];
  uniqueness?: string;
}

export type MatchFlag = "amount_difference" | "date_lag" | "ambiguous" | "duplicate_involved" | "low_confidence";

export interface Match {
  id: string;
  kind: MatchKind;
  status: MatchStatus;
  method: MatchMethod;
  /** Model probability or rule confidence in [0,1]. Rules that verify report 1. */
  score: number;
  bankIds: string[];
  ledgerIds: string[];
  currency: string;
  bankTotalMinor: bigint;
  ledgerTotalMinor: bigint;
  flags: MatchFlag[];
  evidence: MatchEvidence;
}

export type ExceptionType =
  | "missing_in_ledger"
  | "missing_in_bank"
  | "duplicate_bank"
  | "duplicate_ledger"
  | "amount_mismatch"
  | "currency_mismatch";

export interface ReconException {
  id: string;
  type: ExceptionType;
  bankIds: string[];
  ledgerIds: string[];
  currency: string;
  /** Absolute exposure in minor units of `currency` (sum of affected amounts or the discrepancy). */
  exposureMinor: bigint;
  message: string;
  details: Record<string, string | number | boolean | string[]>;
}

export interface CurrencyTotals {
  currency: string;
  bankCount: number;
  ledgerCount: number;
  /** Bank rows in this currency covered by any proposed match. */
  matchedBankCount: number;
  bankTotalMinor: bigint;
  ledgerTotalMinor: bigint;
  matchedBankMinor: bigint;
  unmatchedBankMinor: bigint;
  unmatchedLedgerMinor: bigint;
}

export interface RunMetrics {
  bankCount: number;
  ledgerCount: number;
  verifiedMatches: number;
  suggestedMatches: number;
  reviewMatches: number;
  splitMatches: number;
  /** Bank rows covered by verified matches / bank rows. */
  autoVerifiedRate: number;
  /** Bank rows covered by any proposed match / bank rows. */
  proposedCoverageRate: number;
  /** Exact bank-row counts by the engine status of the match covering them. */
  bankRowsByStatus: { verified: number; suggested: number; needs_review: number };
  unmatchedBank: number;
  unmatchedLedger: number;
  exceptionsByType: Record<ExceptionType, number>;
  candidatePairsScored: number;
  timingsMs: Record<string, number>;
  totalMs: number;
  byCurrency: CurrencyTotals[];
}

export interface EngineConfig {
  /** Max |day difference| for candidate pairs. */
  dateWindowDays: number;
  /** Candidate amount tolerance as a fraction of the larger amount. */
  amountTolerancePct: number;
  /** Minimum model probability for a 1:1 suggestion. */
  minSuggestProbability: number;
  /** If the runner-up is within this probability margin, the match is ambiguous. */
  ambiguityMargin: number;
  /** Max components in a split/aggregate search. */
  maxSplitParts: number;
  /** Max nearby candidates considered per split search. */
  splitCandidatePool: number;
  /** Max candidates per bank row retained for scoring. */
  maxCandidatesPerRow: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  dateWindowDays: 5,
  amountTolerancePct: 0.05,
  minSuggestProbability: 0.5,
  ambiguityMargin: 0.15,
  maxSplitParts: 4,
  splitCandidatePool: 20,
  maxCandidatesPerRow: 12,
};

export interface ReconciliationResult {
  engineVersion: string;
  modelVersion: string;
  config: EngineConfig;
  matches: Match[];
  exceptions: ReconException[];
  duplicateGroups: { side: Side; ids: string[]; kind: "exact" | "same_content" | "external_id" }[];
  metrics: RunMetrics;
}
