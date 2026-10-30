/**
 * Measure the amount-anomaly detector on the synthetic injected-anomaly benchmark
 * across thresholds. Writes src/engine/model/anomaly-evaluation.json.
 * Usage: npm run eval:anomaly
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { ANOMALY_DEFAULTS, detectAmountAnomalies } from "../src/engine/anomaly";
import { anomalyBenchmark } from "../src/engine/anomaly-benchmark";
import { safeRatio } from "../src/engine/evaluate";

const SEEDS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const THRESHOLDS = [2.5, 3, 3.5, 4, 5];
const datasets = SEEDS.map((s) => anomalyBenchmark(s));

const rows = THRESHOLDS.map((threshold) => {
  let tp = 0, fp = 0, fn = 0;
  for (const b of datasets) {
    const flagged = new Set(detectAmountAnomalies(b.transactions, { threshold }).map((a) => a.txId));
    for (const id of flagged) {
      if (b.anomalyIds.has(id)) tp++;
      else fp++;
    }
    for (const id of b.anomalyIds) if (!flagged.has(id)) fn++;
  }
  const precision = safeRatio(tp, tp + fp);
  const recall = safeRatio(tp, tp + fn);
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { threshold, tp, fp, fn, precision, recall, f1 };
});

const totalTx = datasets.reduce((s, d) => s + d.transactions.length, 0);
const injected = datasets.reduce((s, d) => s + d.anomalyIds.size, 0);
const out = {
  generatedAt: new Date().toISOString(),
  method: "Modified z-score (Iglewicz & Hoaglin) on ln|amount| within counterparty groups; median/MAD",
  defaultThreshold: ANOMALY_DEFAULTS.threshold,
  minGroupSize: ANOMALY_DEFAULTS.minGroupSize,
  benchmark: {
    description: "Synthetic: 40 counterparties × 30 transactions per seed, log-normal amounts (σ=0.25), ~3% replaced by 4–15× higher/lower amounts. Not real-world data.",
    seeds: SEEDS,
    transactions: totalTx,
    injectedAnomalies: injected,
  },
  results: rows,
};
writeFileSync(path.join(import.meta.dirname, "..", "src", "engine", "model", "anomaly-evaluation.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`Benchmark: ${totalTx} transactions, ${injected} injected anomalies, ${SEEDS.length} seeds`);
console.log("threshold  precision  recall   F1     (TP/FP/FN)");
for (const r of rows) {
  const p = (v: number | null) => (v === null ? "  n/a " : (v * 100).toFixed(1).padStart(5) + "%");
  console.log(`  ${String(r.threshold).padEnd(7)}  ${p(r.precision)}    ${p(r.recall)}  ${p(r.f1)}  (${r.tp}/${r.fp}/${r.fn})`);
}
