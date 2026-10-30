import { FEATURES, FEATURE_COUNT } from "./features";
import type { FeatureContribution } from "./types";

/**
 * L2-regularised logistic regression over standardised features.
 * Chosen because every prediction decomposes into additive per-feature
 * contributions (w_i * z_i), which is what makes scores explainable to reviewers.
 */
export interface LogisticModel {
  version: string;
  featureKeys: string[];
  means: number[];
  stds: number[];
  weights: number[];
  bias: number;
  trainedAt: string;
  trainingSummary: { examples: number; positives: number; seeds: number[]; epochs: number; l2: number; learningRate: number };
}

export interface TrainOptions {
  epochs?: number;
  learningRate?: number;
  l2?: number;
}

export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Missing values (NaN) are mean-imputed: they standardise to 0 and contribute nothing. */
function standardize(x: number[], means: number[], stds: number[]): number[] {
  return x.map((v, i) => (Number.isNaN(v) ? 0 : (v - means[i]!) / stds[i]!));
}

/** Deterministic full-batch gradient descent. Same data + options => identical weights. */
export function trainLogistic(
  X: number[][],
  y: number[],
  meta: { version: string; seeds: number[] },
  opts: TrainOptions = {},
): LogisticModel {
  if (X.length === 0 || X.length !== y.length) throw new Error("Training set is empty or misaligned");
  const epochs = opts.epochs ?? 1500;
  const lr = opts.learningRate ?? 0.3;
  const l2 = opts.l2 ?? 1e-3;
  const d = FEATURE_COUNT;
  const n = X.length;
  // Statistics over present (non-NaN) values only.
  const means = new Array<number>(d).fill(0);
  const stds = new Array<number>(d).fill(0);
  const present = new Array<number>(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) if (!Number.isNaN(x[j]!)) { means[j]! += x[j]!; present[j]!++; }
  for (let j = 0; j < d; j++) means[j] = present[j] ? means[j]! / present[j]! : 0;
  for (const x of X) for (let j = 0; j < d; j++) if (!Number.isNaN(x[j]!)) stds[j]! += (x[j]! - means[j]!) ** 2;
  for (let j = 0; j < d; j++) stds[j] = Math.sqrt(present[j] ? stds[j]! / present[j]! : 0) || 1;
  const Z = X.map((x) => standardize(x, means, stds));

  const w = new Array<number>(d).fill(0);
  let b = 0;
  const grad = new Array<number>(d);
  for (let epoch = 0; epoch < epochs; epoch++) {
    grad.fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const z = Z[i]!;
      let s = b;
      for (let j = 0; j < d; j++) s += w[j]! * z[j]!;
      const err = sigmoid(s) - y[i]!;
      for (let j = 0; j < d; j++) grad[j]! += err * z[j]!;
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j]! -= lr * (grad[j]! / n + l2 * w[j]!);
    b -= lr * (gb / n);
  }
  return {
    version: meta.version,
    featureKeys: FEATURES.map((f) => f.key),
    means,
    stds,
    weights: w,
    bias: b,
    trainedAt: new Date().toISOString(),
    trainingSummary: { examples: n, positives: y.filter((v) => v === 1).length, seeds: meta.seeds, epochs, l2, learningRate: lr },
  };
}

export function assertCompatible(model: LogisticModel): void {
  const keys = FEATURES.map((f) => f.key);
  if (model.featureKeys.length !== keys.length || model.featureKeys.some((k, i) => k !== keys[i])) {
    throw new Error(`Model ${model.version} was trained on a different feature set; retrain with "npm run train"`);
  }
}

export function predict(model: LogisticModel, x: number[]): number {
  const z = standardize(x, model.means, model.stds);
  let s = model.bias;
  for (let j = 0; j < z.length; j++) s += model.weights[j]! * z[j]!;
  return sigmoid(s);
}

/** Per-feature contributions to the log-odds, sorted by absolute impact. */
export function explain(model: LogisticModel, x: number[]): FeatureContribution[] {
  const z = standardize(x, model.means, model.stds);
  return FEATURES.map((f, j) => ({
    feature: f.key,
    label: f.label,
    // null = input not available on one or both records (imputed, zero contribution).
    value: Number.isNaN(x[j]!) ? null : Number(x[j]!.toFixed(4)),
    contribution: Number((model.weights[j]! * z[j]!).toFixed(4)),
  })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}
