import { describe, expect, it } from "vitest";
import { benfordTest, BENFORD, chiSquarePValue, detectAmountAnomalies, median, modifiedZScores } from "@/engine/anomaly";
import { anomalyBenchmark } from "@/engine/anomaly-benchmark";
import { safeRatio } from "@/engine/evaluate";
import type { Transaction } from "@/engine/types";
import { tx } from "./helpers";

describe("robust statistics", () => {
  it("computes medians and modified z-scores", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    // Data 1..9: median 5, MAD = median(|x−5|) = 2 → z(9) = 0.6745·4/2.
    const z = modifiedZScores([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(z[8]).toBeCloseTo(0.6745 * 2, 10);
    expect(z[4]).toBe(0);
  });
  it("falls back to mean absolute deviation when MAD is zero, and treats constant groups as normal", () => {
    const z = modifiedZScores([10, 10, 10, 10, 10, 10, 10, 50]);
    expect(z[7]).toBeGreaterThan(3.5);
    expect(modifiedZScores([5, 5, 5])).toEqual([0, 0, 0]);
  });
});

describe("chi-square p-values (regularised incomplete gamma)", () => {
  it("matches standard table values", () => {
    expect(chiSquarePValue(15.507, 8)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(20.09, 8)).toBeCloseTo(0.01, 3);
    expect(chiSquarePValue(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(0, 8)).toBe(1);
  });
});

describe("Benford first-digit test", () => {
  const mk = (amounts: string[]): Transaction[] => amounts.map((a, i) => tx("bank", { amount: a, date: "2024-07-01", id: `B-${i}`, description: "X" }));
  it("reports insufficient data below 100 amounts", () => {
    expect(benfordTest(mk(["12.00", "34.00"])).verdict).toBe("insufficient");
  });
  it("accepts Benford-distributed amounts and rejects uniform first digits", () => {
    const benford: string[] = [];
    BENFORD.forEach((p, d) => {
      for (let k = 0; k < Math.round(p * 2000); k++) benford.push(`${d + 1}${String(k % 100).padStart(2, "0")}.00`);
    });
    expect(benfordTest(mk(benford)).verdict).toBe("consistent");
    const uniform = Array.from({ length: 900 }, (_, i) => `${(i % 9) + 1}00.00`);
    const r = benfordTest(mk(uniform));
    expect(r.verdict).toBe("deviates");
    expect(r.pValue!).toBeLessThan(1e-6);
  });
});

describe("amount anomaly detector", () => {
  it("flags an amount far outside a counterparty's history with an explanation", () => {
    const amounts = ["100.00", "102.50", "98.00", "101.00", "99.50", "100.25", "97.75", "103.00", "1500.00"];
    const txs = amounts.map((a, i) => tx("bank", { amount: `-${a}`, date: "2024-07-01", id: `B-${i}`, counterparty: "Acme Supplies", description: "ACH DEBIT" }));
    const found = detectAmountAnomalies(txs);
    expect(found).toHaveLength(1);
    // |amounts| sorted: 97.75 98.00 99.50 100.00 100.25 101.00 102.50 103.00 1500.00 → median 100.25.
    expect(found[0]).toMatchObject({ txId: "B-8", direction: "higher", group: "ACME SUPPLIES", groupSize: 9, typicalMinor: 10025n });
    expect(found[0]!.ratio).toBeCloseTo(15.0, 1);
  });
  it("needs enough history before judging", () => {
    const txs = ["100.00", "100.00", "5000.00"].map((a, i) => tx("bank", { amount: a, date: "2024-07-01", id: `B-${i}`, counterparty: "New Co", description: "X" }));
    expect(detectAmountAnomalies(txs)).toHaveLength(0);
  });
  it("is evaluated on a synthetic benchmark with injected anomalies (measured, not assumed)", () => {
    let tp = 0, fp = 0, fn = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const b = anomalyBenchmark(seed);
      const flagged = new Set(detectAmountAnomalies(b.transactions).map((a) => a.txId));
      for (const id of flagged) {
        if (b.anomalyIds.has(id)) tp++;
        else fp++;
      }
      for (const id of b.anomalyIds) if (!flagged.has(id)) fn++;
    }
    const precision = safeRatio(tp, tp + fp)!, recall = safeRatio(tp, tp + fn)!;
    expect(tp + fn).toBeGreaterThan(100); // enough injected anomalies to be meaningful
    expect(precision).toBeGreaterThan(0.9);
    expect(recall).toBeGreaterThan(0.9);
  });
});
