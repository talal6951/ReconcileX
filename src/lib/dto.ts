/**
 * Client-facing data shapes. Money crosses the wire as strings of integer minor
 * units ("123456") and is formatted with BigInt on the client — never as JS numbers.
 */
import type { EngineConfig, ExceptionType, MatchEvidence, MatchFlag, MatchKind, MatchMethod, MatchStatus, Side } from "@/engine/types";
import type { ReviewProgress, StoredMetrics } from "@/server/repo";

export interface TxDTO {
  id: string;
  side: Side;
  sourceLine: number;
  externalId: string;
  date: string;
  amountMinor: string;
  currency: string;
  reference: string;
  description: string;
  counterparty: string;
}

export interface MatchDTO {
  id: string;
  kind: MatchKind;
  status: MatchStatus;
  originalStatus: MatchStatus;
  method: MatchMethod;
  score: number;
  bankIds: string[];
  ledgerIds: string[];
  currency: string;
  bankTotalMinor: string;
  ledgerTotalMinor: string;
  flags: MatchFlag[];
  evidence: MatchEvidence;
}

export interface ExceptionDTO {
  id: string;
  type: ExceptionType;
  status: "open" | "resolved";
  bankIds: string[];
  ledgerIds: string[];
  currency: string;
  exposureMinor: string;
  message: string;
  details: Record<string, string | number | boolean | string[]>;
}

export interface RunSummaryDTO {
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

export interface WorkspaceDTO {
  summary: RunSummaryDTO;
  config: EngineConfig;
  transactions: Record<string, TxDTO>;
  matches: MatchDTO[];
  exceptions: ExceptionDTO[];
}
