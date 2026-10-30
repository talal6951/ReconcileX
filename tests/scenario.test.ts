import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO, DEFAULT_UNCERTAINTY, runDeterministic, runMonteCarlo, type ScenarioInput } from "@/engine/scenario";

const flat: ScenarioInput = { startingCash: 1000, monthlyRevenue: 300, monthlyExpenses: 200, paymentDelayDays: 0, revenueGrowth: 0, expenseGrowth: 0, months: 4 };

describe("deterministic projection", () => {
  it("with no delay, cash grows by revenue − expenses each month", () => {
    const r = runDeterministic(flat);
    expect(r.months.map((m) => m.cash)).toEqual([1100, 1200, 1300, 1400]);
    expect(r.runwayMonth).toBeNull();
    expect(r.receivablesAtEnd).toBe(0);
  });

  it("a 30-day delay shifts every collection by exactly one month", () => {
    const r = runDeterministic({ ...flat, paymentDelayDays: 30 });
    expect(r.months.map((m) => m.collections)).toEqual([0, 300, 300, 300]);
    expect(r.months.map((m) => m.cash)).toEqual([800, 900, 1000, 1100]);
    expect(r.receivablesAtEnd).toBe(300); // the last month's invoices are still outstanding
  });

  it("a 45-day delay splits collections half and half across months 2 and 3", () => {
    const r = runDeterministic({ ...flat, paymentDelayDays: 45 });
    expect(r.months.map((m) => m.collections)).toEqual([0, 150, 300, 300]);
    expect(r.receivablesAtEnd).toBeCloseTo(450, 10);
  });

  it("conserves money: collected + outstanding = invoiced", () => {
    const s = { ...DEFAULT_SCENARIO, paymentDelayDays: 52 };
    const r = runDeterministic(s);
    const invoiced = r.months.reduce((a, m) => a + m.revenue, 0);
    const collected = r.months.reduce((a, m) => a + m.collections, 0);
    expect(collected + r.receivablesAtEnd).toBeCloseTo(invoiced, 6);
  });

  it("reports runway when cash turns negative", () => {
    const r = runDeterministic({ ...flat, startingCash: 150, paymentDelayDays: 60 });
    expect(r.runwayMonth).toBe(1);
    expect(r.lowestMonth).toBe(2);
  });

  it("longer payment delays never improve cash (monotonic)", () => {
    const lows = [0, 15, 30, 45, 60, 90].map((d) => runDeterministic({ ...DEFAULT_SCENARIO, paymentDelayDays: d }).lowestCash);
    for (let i = 1; i < lows.length; i++) expect(lows[i]!).toBeLessThanOrEqual(lows[i - 1]! + 1e-6);
  });

  it("rejects invalid inputs", () => {
    expect(() => runDeterministic({ ...flat, months: 0 })).toThrow();
    expect(() => runDeterministic({ ...flat, paymentDelayDays: -1 })).toThrow();
    expect(() => runDeterministic({ ...flat, monthlyRevenue: Number.NaN })).toThrow();
  });
});

describe("Monte Carlo", () => {
  it("is reproducible for a given seed", () => {
    const a = runMonteCarlo(DEFAULT_SCENARIO, DEFAULT_UNCERTAINTY);
    const b = runMonteCarlo(DEFAULT_SCENARIO, DEFAULT_UNCERTAINTY);
    expect(a).toEqual(b);
  });

  it("collapses to the deterministic path when there is no uncertainty", () => {
    const det = runDeterministic(DEFAULT_SCENARIO);
    const mc = runMonteCarlo(DEFAULT_SCENARIO, { ...DEFAULT_UNCERTAINTY, revenueVolatility: 0, delayStdDays: 0, runs: 200 });
    mc.bands.forEach((b, t) => {
      expect(b.p10).toBeCloseTo(det.months[t]!.cash, 6);
      expect(b.p90).toBeCloseTo(det.months[t]!.cash, 6);
    });
    expect(mc.standardError).toBe(0);
  });

  it("keeps bands ordered and reports a probability with its standard error", () => {
    // Choose starting cash so the deterministic low point is exactly zero: the outcome is genuinely uncertain.
    const low = runDeterministic({ ...DEFAULT_SCENARIO, startingCash: 0 }).lowestCash;
    const mc = runMonteCarlo({ ...DEFAULT_SCENARIO, startingCash: -low }, DEFAULT_UNCERTAINTY);
    for (const b of mc.bands) expect(b.p10 <= b.p50 && b.p50 <= b.p90).toBe(true);
    expect(mc.probabilityNegative).toBeGreaterThan(0);
    expect(mc.probabilityNegative).toBeLessThan(1);
    expect(mc.standardError).toBeCloseTo(Math.sqrt((mc.probabilityNegative * (1 - mc.probabilityNegative)) / mc.runs), 12);
  });

  it("mean-preserving revenue noise: the median path tracks the deterministic path closely", () => {
    const det = runDeterministic(DEFAULT_SCENARIO);
    const mc = runMonteCarlo(DEFAULT_SCENARIO, { ...DEFAULT_UNCERTAINTY, delayStdDays: 0, runs: 5000 });
    const last = mc.bands.at(-1)!.p50, detLast = det.months.at(-1)!.cash;
    expect(Math.abs(last - detLast) / Math.abs(detLast)).toBeLessThan(0.1);
  });
});
