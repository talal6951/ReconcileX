import type { CandidatePair } from "./features";
import type { GroundTruth } from "./synthetic";
import type { ReconciliationResult } from "./types";

const canon = (truth: GroundTruth, id: string) => truth.canonical[id] ?? id;

export function truthPairKeys(truth: GroundTruth): Set<string> {
  const keys = new Set<string>();
  for (const l of truth.links) {
    if (l.bankIds.length === 1 && l.ledgerIds.length === 1) keys.add(`${canon(truth, l.bankIds[0]!)}|${canon(truth, l.ledgerIds[0]!)}`);
  }
  return keys;
}

export function labelCandidates(cands: CandidatePair[], truth: GroundTruth): number[] {
  const keys = truthPairKeys(truth);
  return cands.map((c) => (keys.has(`${canon(truth, c.bank.tx.id)}|${canon(truth, c.ledger.tx.id)}`) ? 1 : 0));
}

export interface BinaryMetrics {
  n: number;
  positives: number;
  /** Metrics are null when mathematically undefined (e.g. no positives); a genuine 0 stays 0. */
  rocAuc: number | null;
  averagePrecision: number | null;
  logLoss: number | null;
  threshold: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  calibration: { bin: string; meanPredicted: number; observedRate: number; count: number }[];
  prCurve: { recall: number; precision: number; threshold: number }[];
}

/** Standard binary-classification metrics computed from scores and labels. */
export function binaryMetrics(scores: number[], labels: number[], threshold = 0.5): BinaryMetrics {
  const n = scores.length;
  const order = scores.map((s, i) => i).sort((a, b) => scores[b]! - scores[a]!);
  const P = labels.reduce((s, y) => s + y, 0);
  const N = n - P;
  // ROC AUC via rank-sum (Mann-Whitney), with tie handling by average rank.
  const asc = scores.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(n);
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && asc[j + 1]![0] === asc[i]![0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[asc[k]![1]] = avg;
    i = j + 1;
  }
  let rankSumPos = 0;
  labels.forEach((y, i) => { if (y === 1) rankSumPos += ranks[i]!; });
  const rocAuc = P > 0 && N > 0 ? (rankSumPos - (P * (P + 1)) / 2) / (P * N) : null;

  // Average precision and PR curve.
  let tp = 0, fp = 0, ap = 0;
  const prCurve: BinaryMetrics["prCurve"] = [];
  order.forEach((i, rank) => {
    if (labels[i] === 1) {
      tp++;
      ap += tp / (tp + fp);
    } else fp++;
    if (rank % Math.max(1, Math.floor(n / 60)) === 0 || rank === n - 1) {
      prCurve.push({ recall: P ? tp / P : 0, precision: tp / (tp + fp), threshold: scores[i]! });
    }
  });
  const averagePrecision = P ? ap / P : null;

  let tpT = 0, fpT = 0, fnT = 0, ll = 0;
  scores.forEach((s, i) => {
    const y = labels[i]!;
    const pred = s >= threshold ? 1 : 0;
    if (pred && y) tpT++;
    else if (pred && !y) fpT++;
    else if (!pred && y) fnT++;
    const p = Math.min(1 - 1e-12, Math.max(1e-12, s));
    ll -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
  });
  // No predicted positives => precision undefined; no actual positives => recall undefined.
  const precision = safeRatio(tpT, tpT + fpT);
  const recall = safeRatio(tpT, tpT + fnT);
  // F1 is undefined if either input is; it is a valid 0 when both are 0.
  const f1 = precision === null || recall === null ? null : precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const bins = 10;
  const calibration: BinaryMetrics["calibration"] = [];
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const idx = scores.map((s, i) => i).filter((i) => scores[i]! >= lo && (b === bins - 1 ? scores[i]! <= hi : scores[i]! < hi));
    if (idx.length === 0) continue;
    calibration.push({
      bin: `${lo.toFixed(1)}–${hi.toFixed(1)}`,
      meanPredicted: idx.reduce((s, i) => s + scores[i]!, 0) / idx.length,
      observedRate: idx.reduce((s, i) => s + labels[i]!, 0) / idx.length,
      count: idx.length,
    });
  }
  return {
    n,
    positives: P,
    rocAuc,
    averagePrecision,
    logLoss: n ? ll / n : null,
    threshold,
    precision,
    recall,
    f1,
    calibration,
    prCurve,
  };
}

export interface DetectionStat {
  truth: number;
  detected: number;
  /** null when there are no ground-truth examples (recall undefined). */
  recall: number | null;
}

export interface PipelineEvaluation {
  verified: { count: number; correct: number; precision: number | null };
  suggestions1to1: { count: number; correct: number; precision: number | null };
  oneToOneRecall: { truth: number; found: number; recall: number | null };
  splits: { truth: number; proposed: number; exact: number; precision: number | null; recall: number | null };
  missingInBank: DetectionStat;
  missingInLedger: DetectionStat;
  currencyMismatch: DetectionStat;
  duplicates: DetectionStat;
  ambiguousFlagged: number;
}

/** Score a full engine run against ground truth. */
export function evaluatePipeline(result: ReconciliationResult, truth: GroundTruth): PipelineEvaluation {
  const c = (id: string) => canon(truth, id);
  const keys = truthPairKeys(truth);
  const isCorrect1to1 = (b: string, l: string) => keys.has(`${c(b)}|${c(l)}`);
  const one = result.matches.filter((m) => m.kind === "one_to_one");
  const verified = one.filter((m) => m.status === "verified");
  const sugg = one.filter((m) => m.status !== "verified");
  const vCorrect = verified.filter((m) => isCorrect1to1(m.bankIds[0]!, m.ledgerIds[0]!)).length;
  const sCorrect = sugg.filter((m) => isCorrect1to1(m.bankIds[0]!, m.ledgerIds[0]!)).length;

  const setKey = (b: string[], l: string[]) => `${[...b].map(c).sort().join(",")}|${[...l].map(c).sort().join(",")}`;
  const truthSplits = truth.links.filter((l) => l.bankIds.length > 1 || l.ledgerIds.length > 1);
  const truthSplitKeys = new Set(truthSplits.map((l) => setKey(l.bankIds, l.ledgerIds)));
  const proposedSplits = result.matches.filter((m) => m.kind !== "one_to_one");
  const exactSplits = proposedSplits.filter((m) => truthSplitKeys.has(setKey(m.bankIds, m.ledgerIds))).length;

  const excIds = (type: string, side: "bankIds" | "ledgerIds") =>
    new Set(result.exceptions.filter((e) => e.type === type).flatMap((e) => e[side]).map(c));
  const mib = excIds("missing_in_bank", "ledgerIds");
  const mil = excIds("missing_in_ledger", "bankIds");
  const cm = excIds("currency_mismatch", "bankIds");
  const dupDetected = [...truth.duplicateBank, ...truth.duplicateLedger].filter((g) =>
    result.duplicateGroups.some((d) => g.every((id) => d.ids.includes(id))),
  ).length;
  const truth1to1 = keys.size;
  const found1to1 = new Set(one.filter((m) => isCorrect1to1(m.bankIds[0]!, m.ledgerIds[0]!)).map((m) => `${c(m.bankIds[0]!)}|${c(m.ledgerIds[0]!)}`)).size;

  return {
    verified: { count: verified.length, correct: vCorrect, precision: safeRatio(vCorrect, verified.length) },
    suggestions1to1: { count: sugg.length, correct: sCorrect, precision: safeRatio(sCorrect, sugg.length) },
    oneToOneRecall: { truth: truth1to1, found: found1to1, recall: safeRatio(found1to1, truth1to1) },
    splits: {
      truth: truthSplits.length,
      proposed: proposedSplits.length,
      exact: exactSplits,
      precision: safeRatio(exactSplits, proposedSplits.length),
      // A proposed split is "exact" only if it equals a truth split, so exact <= truth holds.
      recall: safeRatio(exactSplits, truthSplits.length),
    },
    missingInBank: detection(truth.missingInBank.length, truth.missingInBank.filter((id) => mib.has(c(id))).length),
    missingInLedger: detection(truth.missingInLedger.length, truth.missingInLedger.filter((id) => mil.has(c(id))).length),
    currencyMismatch: detection(truth.currencyMismatch.length, truth.currencyMismatch.filter((x) => cm.has(c(x.bankId))).length),
    duplicates: detection(truth.duplicateBank.length + truth.duplicateLedger.length, dupDetected),
    ambiguousFlagged: result.matches.filter((m) => m.flags.includes("ambiguous")).length,
  };
}

/**
 * Ratio with an explicit "undefined" result. Recall with zero ground-truth
 * examples (or precision with zero predictions) is 0/0 — reported as null,
 * never as a flattering 100%.
 */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  if (numerator < 0 || numerator > denominator) throw new Error(`Invalid ratio ${numerator}/${denominator}`);
  return numerator / denominator;
}

export function detection(truthCount: number, detected: number): DetectionStat {
  return { truth: truthCount, detected, recall: safeRatio(detected, truthCount) };
}

/** Recompute derived recalls from counts (kept for callers that mutate counts). */
export function finalizeRecalls(e: PipelineEvaluation): PipelineEvaluation {
  for (const k of ["missingInBank", "missingInLedger", "currencyMismatch", "duplicates"] as const) {
    e[k].recall = safeRatio(e[k].detected, e[k].truth);
  }
  return e;
}
