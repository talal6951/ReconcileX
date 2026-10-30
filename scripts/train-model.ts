/**
 * Train the match-scoring model on synthetic data with ground truth and
 * evaluate it on held-out seeds. Writes:
 *   src/engine/model/weights.json     – the model used by the engine
 *   src/engine/model/evaluation.json  – measured metrics (no hand-entered numbers)
 *
 * Usage: npm run train
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { binaryMetrics, evaluatePipeline, labelCandidates } from "../src/engine/evaluate";
import { FEATURES } from "../src/engine/features";
import { residualCandidates, reconcile } from "../src/engine/matcher";
import { predict, trainLogistic } from "../src/engine/model";
import { generateSynthetic } from "../src/engine/synthetic";
import { DEFAULT_CONFIG } from "../src/engine/types";

const TRAIN_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const TEST_SEEDS = [101, 102, 103];
const EVENTS_PER_SEED = 1500;
const VERSION = "lr-2026.10-v1";

function collect(seeds: number[]) {
  const X: number[][] = [];
  const y: number[] = [];
  for (const seed of seeds) {
    const ds = generateSynthetic(seed, EVENTS_PER_SEED);
    const { candidates } = residualCandidates(ds.bank, ds.ledger, DEFAULT_CONFIG);
    X.push(...candidates.map((c) => c.features));
    y.push(...labelCandidates(candidates, ds.truth));
  }
  return { X, y };
}

/** Rules-only baseline: exact amount first, then date proximity. No learning. */
function baselineScore(x: number[]): number {
  const amountExact = x[0]!, dayDiff = x[2]!;
  return 0.6 * amountExact + 0.4 * Math.max(0, 1 - dayDiff);
}

const t0 = performance.now();
const train = collect(TRAIN_SEEDS);
const model = trainLogistic(train.X, train.y, { version: VERSION, seeds: TRAIN_SEEDS });
const trainMs = performance.now() - t0;

const test = collect(TEST_SEEDS);
const modelScores = test.X.map((x) => predict(model, x));
const baseScores = test.X.map(baselineScore);
const modelMetrics = binaryMetrics(modelScores, test.y, DEFAULT_CONFIG.minSuggestProbability);
const baselineMetrics = binaryMetrics(baseScores, test.y, DEFAULT_CONFIG.minSuggestProbability);

const pipeline = TEST_SEEDS.map((seed) => {
  const ds = generateSynthetic(seed, EVENTS_PER_SEED);
  const r = reconcile(ds.bank, ds.ledger, { model });
  return { seed, bankRows: ds.bank.length, ledgerRows: ds.ledger.length, totalMs: r.metrics.totalMs, evaluation: evaluatePipeline(r, ds.truth) };
});

const evaluation = {
  modelVersion: VERSION,
  generatedAt: new Date().toISOString(),
  dataset: {
    description: "Synthetic bank/ledger data with known ground truth (src/engine/synthetic.ts). Not real customer data.",
    trainSeeds: TRAIN_SEEDS,
    testSeeds: TEST_SEEDS,
    eventsPerSeed: EVENTS_PER_SEED,
    trainPairs: train.X.length,
    trainPositives: train.y.filter((v) => v === 1).length,
    testPairs: test.X.length,
    testPositives: test.y.filter((v) => v === 1).length,
  },
  scope: "Candidate pairs remaining after the deterministic rules (the model's operating distribution).",
  features: FEATURES.map((f, i) => ({ ...f, weight: model.weights[i], mean: model.means[i], std: model.stds[i] })),
  bias: model.bias,
  trainMs: Math.round(trainMs),
  model: modelMetrics,
  baseline: { description: "0.6 × exact-amount + 0.4 × date proximity (no learning)", ...baselineMetrics },
  pipeline,
};

const outDir = path.join(import.meta.dirname, "..", "src", "engine", "model");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "weights.json"), JSON.stringify(model, null, 2) + "\n");
writeFileSync(path.join(outDir, "evaluation.json"), JSON.stringify(evaluation, null, 2) + "\n");

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(2)}%`);
console.log(`Model ${VERSION}: trained on ${train.X.length} pairs (${evaluation.dataset.trainPositives} positive) in ${Math.round(trainMs)} ms`);
console.log(`Held-out pairs: ${test.X.length} (${evaluation.dataset.testPositives} positive)`);
console.log(`              ROC-AUC   AvgPrec   Precision Recall    F1`);
for (const [name, m] of [["model", modelMetrics], ["baseline", baselineMetrics]] as const) {
  console.log(`${name.padEnd(12)}  ${pct(m.rocAuc).padEnd(9)} ${pct(m.averagePrecision).padEnd(9)} ${pct(m.precision).padEnd(9)} ${pct(m.recall).padEnd(9)} ${pct(m.f1)}`);
}
console.log("\nWeights (standardised):");
FEATURES.forEach((f, i) => console.log(`  ${f.key.padEnd(24)} ${model.weights[i]!.toFixed(3)}`));
console.log("\nEnd-to-end on held-out seeds:");
for (const p of pipeline) {
  const e = p.evaluation;
  console.log(
    `  seed ${p.seed}: ${p.bankRows}/${p.ledgerRows} rows in ${p.totalMs} ms | verified ${e.verified.correct}/${e.verified.count} (${pct(e.verified.precision)})` +
      ` | ML 1:1 ${e.suggestions1to1.correct}/${e.suggestions1to1.count} (${pct(e.suggestions1to1.precision)})` +
      ` | 1:1 recall ${pct(e.oneToOneRecall.recall)} | splits ${e.splits.exact}/${e.splits.truth} found, ${e.splits.proposed} proposed` +
      ` | missing bank ${e.missingInBank.detected}/${e.missingInBank.truth} ledger ${e.missingInLedger.detected}/${e.missingInLedger.truth}` +
      ` | ccy ${e.currencyMismatch.detected}/${e.currencyMismatch.truth} | dup ${e.duplicates.detected}/${e.duplicates.truth} | ambiguous ${e.ambiguousFlagged}`,
  );
}
