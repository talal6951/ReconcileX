import { rng } from "./synthetic";

/**
 * Scenario Lab: an ILLUSTRATIVE monthly cash projection.
 *
 * Deterministic model (month t = 1..H):
 *   revenue_t   = R · (1 + g)^(t−1)            invoiced at the start of month t
 *   expenses_t  = E · (1 + h)^(t−1)            paid in month t
 *   collections: an invoice with payment delay D days is collected in month t + ⌊D/30⌋
 *                (fraction 1 − f) and t + ⌊D/30⌋ + 1 (fraction f), where f = (D mod 30) / 30
 *   cash_t      = cash_{t−1} + collections_t − expenses_t
 *
 * Monte Carlo (N seeded runs): monthly revenue multiplied by exp(σ_R·Z − σ_R²/2) (mean-preserving
 * log-normal noise) and payment delay ~ Normal(D, σ_D) truncated at 0, drawn per month. Reports
 * P10/P50/P90 cash per month and P(cash < 0 at any month) with its standard error √(p(1−p)/N).
 *
 * This is a forecast for exploration, not reconciliation: values are whole currency units in
 * floating point and are rounded for display. It makes no claim about any real business.
 */

export interface ScenarioInput {
  startingCash: number;
  monthlyRevenue: number;
  monthlyExpenses: number;
  /** Average days customers take to pay. */
  paymentDelayDays: number;
  /** Monthly revenue growth, e.g. 0.02 = +2% per month. */
  revenueGrowth: number;
  /** Monthly expense growth. */
  expenseGrowth: number;
  months: number;
}

export interface UncertaintyInput {
  /** Volatility of monthly revenue (log-space std dev), e.g. 0.15. */
  revenueVolatility: number;
  /** Std dev of payment delay in days. */
  delayStdDays: number;
  runs: number;
  seed: number;
}

export const DEFAULT_SCENARIO: ScenarioInput = {
  startingCash: 250_000,
  monthlyRevenue: 120_000,
  monthlyExpenses: 110_000,
  paymentDelayDays: 45,
  revenueGrowth: 0.01,
  expenseGrowth: 0.005,
  months: 12,
};

export const DEFAULT_UNCERTAINTY: UncertaintyInput = { revenueVolatility: 0.15, delayStdDays: 10, runs: 2000, seed: 2026 };

export interface MonthResult {
  month: number;
  revenue: number;
  collections: number;
  expenses: number;
  cash: number;
}

export interface DeterministicResult {
  months: MonthResult[];
  lowestCash: number;
  lowestMonth: number;
  /** First month with negative cash, or null if cash stays ≥ 0 over the horizon. */
  runwayMonth: number | null;
  /** Receivables outstanding at the end of the horizon (cash earned but not yet collected). */
  receivablesAtEnd: number;
}

function validate(s: ScenarioInput) {
  if (!Number.isFinite(s.startingCash) || !Number.isFinite(s.monthlyRevenue) || !Number.isFinite(s.monthlyExpenses)) throw new Error("Amounts must be numbers");
  if (s.monthlyRevenue < 0 || s.monthlyExpenses < 0) throw new Error("Revenue and expenses cannot be negative");
  if (!(s.paymentDelayDays >= 0 && s.paymentDelayDays <= 365)) throw new Error("Payment delay must be 0–365 days");
  if (!Number.isInteger(s.months) || s.months < 1 || s.months > 60) throw new Error("Horizon must be 1–60 months");
  if (s.revenueGrowth < -0.5 || s.revenueGrowth > 0.5 || s.expenseGrowth < -0.5 || s.expenseGrowth > 0.5) throw new Error("Growth rates must be between −50% and +50% per month");
}

/** Spread one month's revenue over the months it is collected in, given a delay. */
function collect(into: number[], month: number, amount: number, delayDays: number) {
  const whole = Math.floor(delayDays / 30);
  const f = (delayDays - whole * 30) / 30;
  const a = month + whole, b = a + 1;
  if (a < into.length) into[a] = into[a]! + amount * (1 - f);
  if (b < into.length) into[b] = into[b]! + amount * f;
}

function project(s: ScenarioInput, revenueAt: (t: number) => number, delayAt: (t: number) => number): { months: MonthResult[]; uncollected: number } {
  const collections = new Array<number>(s.months).fill(0);
  const revenue: number[] = [];
  let invoiced = 0;
  for (let t = 0; t < s.months; t++) {
    const r = revenueAt(t);
    revenue.push(r);
    invoiced += r;
    collect(collections, t, r, delayAt(t));
  }
  let cash = s.startingCash;
  const months: MonthResult[] = [];
  let collected = 0;
  for (let t = 0; t < s.months; t++) {
    const expenses = s.monthlyExpenses * (1 + s.expenseGrowth) ** t;
    cash += collections[t]! - expenses;
    collected += collections[t]!;
    months.push({ month: t + 1, revenue: revenue[t]!, collections: collections[t]!, expenses, cash });
  }
  return { months, uncollected: invoiced - collected };
}

export function runDeterministic(s: ScenarioInput): DeterministicResult {
  validate(s);
  const { months, uncollected } = project(s, (t) => s.monthlyRevenue * (1 + s.revenueGrowth) ** t, () => s.paymentDelayDays);
  let lowestCash = Infinity, lowestMonth = 0;
  for (const m of months) if (m.cash < lowestCash) [lowestCash, lowestMonth] = [m.cash, m.month];
  return { months, lowestCash, lowestMonth, runwayMonth: months.find((m) => m.cash < 0)?.month ?? null, receivablesAtEnd: uncollected };
}

export interface MonteCarloResult {
  runs: number;
  seed: number;
  bands: { month: number; p10: number; p50: number; p90: number }[];
  /** Fraction of runs where cash goes below zero in any month. */
  probabilityNegative: number;
  /** Monte Carlo standard error of probabilityNegative. */
  standardError: number;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function runMonteCarlo(s: ScenarioInput, u: UncertaintyInput): MonteCarloResult {
  validate(s);
  if (!Number.isInteger(u.runs) || u.runs < 100 || u.runs > 20_000) throw new Error("Runs must be 100–20,000");
  if (u.revenueVolatility < 0 || u.revenueVolatility > 1 || u.delayStdDays < 0 || u.delayStdDays > 120) throw new Error("Uncertainty settings out of range");
  const r = rng(u.seed);
  const normal = () => Math.sqrt(-2 * Math.log(1 - r.next())) * Math.cos(2 * Math.PI * r.next());
  const sigma = u.revenueVolatility;
  const paths: number[][] = Array.from({ length: s.months }, () => []);
  let negative = 0;
  for (let k = 0; k < u.runs; k++) {
    const { months } = project(
      s,
      (t) => s.monthlyRevenue * (1 + s.revenueGrowth) ** t * Math.exp(sigma * normal() - (sigma * sigma) / 2),
      () => Math.min(365, Math.max(0, s.paymentDelayDays + u.delayStdDays * normal())),
    );
    if (months.some((m) => m.cash < 0)) negative++;
    months.forEach((m, t) => paths[t]!.push(m.cash));
  }
  const bands = paths.map((col, t) => {
    const sorted = [...col].sort((a, b) => a - b);
    return { month: t + 1, p10: quantile(sorted, 0.1), p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9) };
  });
  const p = negative / u.runs;
  return { runs: u.runs, seed: u.seed, bands, probabilityNegative: p, standardError: Math.sqrt((p * (1 - p)) / u.runs) };
}
