import { absMinor, currencyExponent } from "./money";
import { normalizeText } from "./text";
import type { Side, Transaction } from "./types";

/**
 * Statistical anomaly detection (descriptive statistics — no training involved).
 *
 * 1. Unusual amount for a counterparty: robust modified z-score (Iglewicz & Hoaglin, 1993)
 *      z = 0.6745 · (x − median) / MAD,  x = ln|amount|
 *    computed within groups of the same side, currency, direction and counterparty.
 *    Median/MAD resist the very outliers being searched for (unlike mean/stdev).
 *    |z| > 3.5 is the conventional cut-off. If MAD = 0 the mean absolute deviation
 *    is used (z = (x − median) / (1.253314 · MeanAD)); if both are 0 the group is constant.
 *
 * 2. First-digit test (Benford's law): Pearson chi-square goodness of fit, 8 degrees of
 *    freedom; p-value computed numerically from the regularised upper incomplete gamma function.
 *    A dataset-level indicator only — many legitimate datasets do not follow Benford.
 *
 * Amounts are converted to floating point ONLY for these statistics; no money
 * arithmetic happens here.
 */

export const ANOMALY_DEFAULTS = { minGroupSize: 8, threshold: 3.5 } as const;

export interface AmountAnomaly {
  txId: string;
  side: Side;
  currency: string;
  group: string;
  groupSize: number;
  amountMinor: bigint;
  /** Median of |amount| within the group, in minor units. */
  typicalMinor: bigint;
  z: number;
  direction: "higher" | "lower";
  /** How many times larger/smaller than the group's typical amount. */
  ratio: number;
}

export function median(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Modified z-scores for a sample (same order as input). */
export function modifiedZScores(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const med = median(sorted);
  const absDev = values.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = median(absDev);
  if (mad > 0) return values.map((v) => (0.6745 * (v - med)) / mad);
  const meanAD = absDev.reduce((s, d) => s + d, 0) / values.length;
  if (meanAD > 0) return values.map((v) => (v - med) / (1.253314 * meanAD));
  return values.map(() => 0);
}

function majorUnits(minor: bigint, currency: string): number {
  return Number(absMinor(minor)) / 10 ** currencyExponent(currency);
}

/** Grouping key: counterparty if present, else the first two words of the description. */
export function counterpartyKey(t: Transaction): string {
  const cp = normalizeText(t.counterparty);
  if (cp) return cp;
  return normalizeText(t.description).split(" ").filter((w) => /^[A-Z]+$/.test(w)).slice(0, 2).join(" ");
}

export function detectAmountAnomalies(txs: readonly Transaction[], opts: { minGroupSize?: number; threshold?: number } = {}): AmountAnomaly[] {
  const minGroupSize = opts.minGroupSize ?? ANOMALY_DEFAULTS.minGroupSize;
  const threshold = opts.threshold ?? ANOMALY_DEFAULTS.threshold;
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.amountMinor === 0n) continue;
    const key = counterpartyKey(t);
    if (!key) continue;
    const g = `${t.side}|${t.currency}|${t.amountMinor < 0n ? "out" : "in"}|${key}`;
    const arr = groups.get(g);
    if (arr) arr.push(t);
    else groups.set(g, [t]);
  }
  const out: AmountAnomaly[] = [];
  for (const [g, members] of groups) {
    if (members.length < minGroupSize) continue;
    const logs = members.map((t) => Math.log(majorUnits(t.amountMinor, t.currency)));
    const z = modifiedZScores(logs);
    const sortedAbs = members.map((t) => absMinor(t.amountMinor)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const typicalMinor = sortedAbs[(sortedAbs.length - 1) >> 1]!;
    members.forEach((t, i) => {
      if (Math.abs(z[i]!) <= threshold) return;
      const amt = absMinor(t.amountMinor);
      out.push({
        txId: t.id,
        side: t.side,
        currency: t.currency,
        group: g.split("|").slice(3).join("|"),
        groupSize: members.length,
        amountMinor: t.amountMinor,
        typicalMinor,
        z: Number(z[i]!.toFixed(2)),
        direction: z[i]! > 0 ? "higher" : "lower",
        ratio: Number((z[i]! > 0 ? Number(amt) / Number(typicalMinor) : Number(typicalMinor) / Number(amt)).toFixed(1)),
      });
    });
  }
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}

// ---------- Benford first-digit test ----------

export const BENFORD = Array.from({ length: 9 }, (_, i) => Math.log10(1 + 1 / (i + 1)));

/** ln Γ(x) (Lanczos approximation). */
function lnGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularised upper incomplete gamma Q(a, x) — series for x < a+1, continued fraction otherwise. */
export function gammaQ(a: number, x: number): number {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 500; n++) {
      del *= x / ++ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** Upper-tail p-value of a chi-square statistic with k degrees of freedom. */
export function chiSquarePValue(stat: number, df: number): number {
  return gammaQ(df / 2, stat / 2);
}

export interface BenfordResult {
  n: number;
  observed: number[];
  expected: number[];
  chiSquare: number | null;
  pValue: number | null;
  /** "insufficient" below 100 amounts; otherwise based on p < 0.01. */
  verdict: "insufficient" | "consistent" | "deviates";
}

export function benfordTest(txs: readonly Transaction[], minN = 100): BenfordResult {
  const counts = Array(9).fill(0) as number[];
  for (const t of txs) {
    const digits = absMinor(t.amountMinor).toString();
    const first = Number(digits[0]);
    if (first >= 1) counts[first - 1] = counts[first - 1]! + 1;
  }
  const n = counts.reduce((s, c) => s + c, 0);
  const expected = BENFORD.map((p) => p * n);
  if (n < minN) return { n, observed: counts, expected, chiSquare: null, pValue: null, verdict: "insufficient" };
  const chiSquare = counts.reduce((s, o, i) => s + (o - expected[i]!) ** 2 / expected[i]!, 0);
  const pValue = chiSquarePValue(chiSquare, 8);
  return { n, observed: counts, expected, chiSquare: Number(chiSquare.toFixed(3)), pValue, verdict: pValue < 0.01 ? "deviates" : "consistent" };
}
