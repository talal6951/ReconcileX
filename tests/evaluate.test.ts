import { describe, expect, it } from "vitest";
import { binaryMetrics, detection, evaluatePipeline, finalizeRecalls, safeRatio } from "@/engine/evaluate";
import type { GroundTruth } from "@/engine/synthetic";
import { DEFAULT_CONFIG, type Match, type ReconciliationResult } from "@/engine/types";

describe("safeRatio / detection", () => {
  it("returns null for 0/0 and a real zero for 0/n", () => {
    expect(safeRatio(0, 0)).toBeNull();
    expect(safeRatio(0, 5)).toBe(0);
    expect(safeRatio(5, 5)).toBe(1);
    expect(safeRatio(3, 4)).toBe(0.75);
  });
  it("rejects impossible ratios instead of reporting >100%", () => {
    expect(() => safeRatio(6, 5)).toThrow();
    expect(() => safeRatio(-1, 5)).toThrow();
  });
  it("detection recall is null without ground truth, 0 when nothing detected", () => {
    expect(detection(0, 0)).toEqual({ truth: 0, detected: 0, recall: null });
    expect(detection(4, 0)).toEqual({ truth: 4, detected: 0, recall: 0 });
    expect(detection(4, 3).recall).toBe(0.75);
  });
});

describe("binaryMetrics (hand-computed expectations)", () => {
  it("perfect ranking", () => {
    const m = binaryMetrics([0.9, 0.8, 0.3, 0.1], [1, 1, 0, 0]);
    expect(m.rocAuc).toBe(1);
    expect(m.averagePrecision).toBe(1);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
  });

  it("fully reversed ranking yields genuine zeros, not nulls", () => {
    const m = binaryMetrics([0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0]);
    expect(m.rocAuc).toBe(0);
    // Positives found at ranks 3 and 4: AP = (1/3 + 2/4) / 2 = 5/12.
    expect(m.averagePrecision).toBeCloseTo(5 / 12, 12);
    expect(m.precision).toBe(0); // 2 predicted positives, both wrong
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
  });

  it("matches a known ROC AUC value", () => {
    // Classic example: AUC = 0.75.
    expect(binaryMetrics([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1]).rocAuc).toBeCloseTo(0.75, 12);
  });

  it("handles ties with average ranks", () => {
    expect(binaryMetrics([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0]).rocAuc).toBe(0.5);
  });

  it("computes log loss", () => {
    expect(binaryMetrics([0.5, 0.5], [1, 0]).logLoss).toBeCloseTo(Math.LN2, 12);
  });

  it("no positive labels: AUC, AP, recall and F1 are undefined; precision is a real 0", () => {
    const m = binaryMetrics([0.9, 0.2], [0, 0]);
    expect(m.rocAuc).toBeNull();
    expect(m.averagePrecision).toBeNull();
    expect(m.recall).toBeNull();
    expect(m.precision).toBe(0);
    expect(m.f1).toBeNull();
  });

  it("no predicted positives: precision undefined, recall a real 0", () => {
    const m = binaryMetrics([0.1, 0.2], [1, 0]);
    expect(m.precision).toBeNull();
    expect(m.recall).toBe(0);
    expect(m.f1).toBeNull();
  });

  it("empty input is entirely undefined", () => {
    const m = binaryMetrics([], []);
    expect(m.n).toBe(0);
    expect([m.rocAuc, m.averagePrecision, m.logLoss, m.precision, m.recall, m.f1]).toEqual([null, null, null, null, null, null]);
    expect(m.calibration).toEqual([]);
  });

  it("serializes without NaN", () => {
    const json = JSON.stringify(binaryMetrics([0.3], [0]));
    expect(json).not.toContain("NaN");
  });
});

function match(p: Partial<Match> & Pick<Match, "bankIds" | "ledgerIds">): Match {
  return {
    id: "M",
    kind: p.bankIds.length > 1 ? "one_to_many" : p.ledgerIds.length > 1 ? "many_to_one" : "one_to_one",
    status: "verified",
    method: "rule_exact_reference",
    score: 1,
    currency: "USD",
    bankTotalMinor: 0n,
    ledgerTotalMinor: 0n,
    flags: [],
    evidence: { reasons: [], amountDifferenceMinor: "0", dayDifference: 0 },
    ...p,
  };
}

function result(matches: Match[], extra: Partial<ReconciliationResult> = {}): ReconciliationResult {
  return {
    engineVersion: "t",
    modelVersion: "t",
    config: DEFAULT_CONFIG,
    matches,
    exceptions: [],
    duplicateGroups: [],
    metrics: {} as ReconciliationResult["metrics"],
    ...extra,
  };
}

const emptyTruth = (): GroundTruth => ({
  links: [],
  missingInBank: [],
  missingInLedger: [],
  currencyMismatch: [],
  duplicateBank: [],
  duplicateLedger: [],
  canonical: {},
  scenarioCounts: {},
});

describe("evaluatePipeline", () => {
  it("reports null (not 100%) for categories with no ground truth and no proposals", () => {
    const e = evaluatePipeline(result([]), emptyTruth());
    expect(e.verified.precision).toBeNull();
    expect(e.suggestions1to1.precision).toBeNull();
    expect(e.oneToOneRecall.recall).toBeNull();
    expect(e.splits.precision).toBeNull();
    expect(e.splits.recall).toBeNull();
    expect(e.missingInBank.recall).toBeNull();
    expect(e.duplicates.recall).toBeNull();
  });

  it("counts correct and incorrect matches, honouring canonical equivalence", () => {
    const truth = emptyTruth();
    truth.links = [
      { bankIds: ["B1"], ledgerIds: ["L1"], scenario: "exact_reference" },
      { bankIds: ["B2"], ledgerIds: ["L2"], scenario: "ambiguous_twins" },
      { bankIds: ["B3"], ledgerIds: ["L3"], scenario: "no_reference" },
      { bankIds: ["B4", "B5"], ledgerIds: ["L4"], scenario: "split_payment" },
    ];
    truth.canonical = { L2: "L2", L9: "L2" }; // L9 is an indistinguishable twin of L2
    truth.missingInBank = ["L7"];
    const r = result([
      match({ bankIds: ["B1"], ledgerIds: ["L1"] }), // verified, correct
      match({ bankIds: ["B2"], ledgerIds: ["L9"], status: "suggested", method: "ml_scored" }), // correct via twin
      match({ bankIds: ["B3"], ledgerIds: ["L1x"], status: "suggested", method: "ml_scored" }), // wrong
      match({ bankIds: ["B4", "B5"], ledgerIds: ["L4"], status: "suggested", method: "split_sum" }),
    ]);
    const e = evaluatePipeline(r, truth);
    expect(e.verified).toEqual({ count: 1, correct: 1, precision: 1 });
    expect(e.suggestions1to1).toEqual({ count: 2, correct: 1, precision: 0.5 });
    expect(e.oneToOneRecall).toEqual({ truth: 3, found: 2, recall: 2 / 3 });
    expect(e.splits).toMatchObject({ truth: 1, proposed: 1, exact: 1, precision: 1, recall: 1 });
    expect(e.missingInBank).toEqual({ truth: 1, detected: 0, recall: 0 });
  });

  it("finalizeRecalls recomputes from counts", () => {
    const e = evaluatePipeline(result([]), emptyTruth());
    e.missingInBank = { truth: 2, detected: 1, recall: null };
    expect(finalizeRecalls(e).missingInBank.recall).toBe(0.5);
  });
});
