import evaluation from "@/engine/model/evaluation.json";

/**
 * Public benchmark figures, derived at build/render time from the measured
 * evaluation artifact (src/engine/model/evaluation.json). Nothing here is
 * hand-entered; retraining updates these numbers.
 */
export function benchmarks() {
  const pipe = evaluation.pipeline;
  const verifiedCount = pipe.reduce((s, p) => s + p.evaluation.verified.count, 0);
  const verifiedCorrect = pipe.reduce((s, p) => s + p.evaluation.verified.correct, 0);
  const rows = pipe.reduce((s, p) => s + p.bankRows + p.ledgerRows, 0);
  const ms = pipe.reduce((s, p) => s + p.totalMs, 0);
  return {
    modelVersion: evaluation.modelVersion,
    modelF1: evaluation.model.f1 as number | null,
    baselineF1: evaluation.baseline.f1 as number | null,
    rocAuc: evaluation.model.rocAuc as number | null,
    verifiedCount,
    verifiedCorrect,
    verifiedPrecision: verifiedCount ? verifiedCorrect / verifiedCount : null,
    avgRows: Math.round(rows / pipe.length),
    avgMs: Math.round(ms / pipe.length),
    testSeeds: evaluation.dataset.testSeeds.length,
  };
}
