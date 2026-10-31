"use client";

import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DEFAULT_SCENARIO, DEFAULT_UNCERTAINTY, runDeterministic, runMonteCarlo, type ScenarioInput } from "@/engine/scenario";
import { Card } from "./ui";

const fmt = (v: number) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : Math.abs(v) >= 10_000 ? `${(v / 1000).toFixed(0)}K` : Math.round(v).toLocaleString("en-US"));
const whole = (v: number) => Math.round(v).toLocaleString("en-US");

interface Field {
  key: keyof ScenarioInput;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: "money" | "days" | "pct";
}

const FIELDS: Field[] = [
  { key: "startingCash", label: "Cash today", min: 0, max: 2_000_000, step: 10_000, unit: "money" },
  { key: "monthlyRevenue", label: "Monthly revenue", min: 0, max: 1_000_000, step: 5_000, unit: "money" },
  { key: "monthlyExpenses", label: "Monthly expenses", min: 0, max: 1_000_000, step: 5_000, unit: "money" },
  { key: "paymentDelayDays", label: "Customers pay after", min: 0, max: 120, step: 1, unit: "days" },
  { key: "revenueGrowth", label: "Revenue growth / month", min: -0.1, max: 0.1, step: 0.005, unit: "pct" },
  { key: "expenseGrowth", label: "Expense growth / month", min: -0.1, max: 0.1, step: 0.005, unit: "pct" },
];

export function ScenarioLab() {
  const [s, setS] = useState<ScenarioInput>(DEFAULT_SCENARIO);
  const [uncertainty, setUncertainty] = useState(true);
  const [volatility, setVolatility] = useState(DEFAULT_UNCERTAINTY.revenueVolatility);
  const [delayStd, setDelayStd] = useState(DEFAULT_UNCERTAINTY.delayStdDays);

  const det = useMemo(() => runDeterministic(s), [s]);
  const mc = useMemo(() => (uncertainty ? runMonteCarlo(s, { ...DEFAULT_UNCERTAINTY, revenueVolatility: volatility, delayStdDays: delayStd }) : null), [s, uncertainty, volatility, delayStd]);
  const baseline = useMemo(() => runDeterministic({ ...s, paymentDelayDays: 0 }), [s]);

  const chart = det.months.map((m, i) => ({
    month: `M${m.month}`,
    expected: Math.round(m.cash),
    band: mc ? [Math.round(mc.bands[i]!.p10), Math.round(mc.bands[i]!.p90)] : undefined,
    median: mc ? Math.round(mc.bands[i]!.p50) : undefined,
  }));
  const delayCost = baseline.lowestCash - det.lowestCash;

  return (
    <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
      <Card
        title="Assumptions"
        actions={
          <button className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-3 hover:text-ink" onClick={() => setS(DEFAULT_SCENARIO)}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        }
      >
        <div className="space-y-5">
          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="flex items-baseline justify-between text-[13px]">
                <span className="text-ink-2">{f.label}</span>
                <span className="tabular font-semibold text-ink">{f.unit === "money" ? whole(s[f.key]) : f.unit === "days" ? `${s[f.key]} days` : `${(s[f.key] * 100).toFixed(1)}%`}</span>
              </span>
              <input
                type="range"
                className="mt-2 w-full accent-[var(--color-brand)]"
                min={f.min}
                max={f.max}
                step={f.step}
                value={s[f.key]}
                aria-label={f.label}
                onChange={(e) => setS((cur) => ({ ...cur, [f.key]: Number(e.target.value) }))}
              />
            </label>
          ))}
          <div className="border-t border-line pt-4">
            <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <input type="checkbox" checked={uncertainty} onChange={(e) => setUncertainty(e.target.checked)} />
              Simulate uncertainty (Monte Carlo)
            </label>
            {uncertainty && (
              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="flex justify-between text-[12.5px] text-ink-2">
                    Revenue volatility <span className="tabular font-semibold text-ink">±{Math.round(volatility * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    className="mt-2 w-full accent-[var(--color-brand)]"
                    min={0}
                    max={0.5}
                    step={0.01}
                    value={volatility}
                    aria-label="Revenue volatility"
                    onChange={(e) => setVolatility(Number(e.target.value))}
                  />
                </label>
                <label className="block">
                  <span className="flex justify-between text-[12.5px] text-ink-2">
                    Payment delay variability <span className="tabular font-semibold text-ink">±{delayStd} days</span>
                  </span>
                  <input
                    type="range"
                    className="mt-2 w-full accent-[var(--color-brand)]"
                    min={0}
                    max={40}
                    step={1}
                    value={delayStd}
                    aria-label="Payment delay variability"
                    onChange={(e) => setDelayStd(Number(e.target.value))}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="min-w-0 space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Answer label="Lowest cash point" value={whole(det.lowestCash)} tone={det.lowestCash < 0 ? "bad" : "ok"} sub={`in month ${det.lowestMonth} (expected path)`} />
          <Answer
            label={mc ? "Chance of running out of cash" : "Runs out of cash?"}
            value={mc ? `${(mc.probabilityNegative * 100).toFixed(1)}%` : det.runwayMonth ? `Month ${det.runwayMonth}` : "No"}
            tone={mc ? (mc.probabilityNegative > 0.2 ? "bad" : mc.probabilityNegative > 0.05 ? "warn" : "ok") : det.runwayMonth ? "bad" : "ok"}
            sub={mc ? `±${(1.96 * mc.standardError * 100).toFixed(1)} pts (95% interval) · ${mc.runs.toLocaleString("en-US")} simulations` : `over ${s.months} months`}
          />
          <Answer label="Cost of the payment delay" value={whole(Math.max(0, delayCost))} tone={delayCost > 0 ? "warn" : "ok"} sub={`lower low point vs. customers paying immediately`} />
        </div>

        <Card title="Projected cash" subtitle={mc ? "Expected path, with the range where 80% of simulations fall (10th–90th percentile)" : "Expected path"}>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#EFEDE8" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6E6C66" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#6E6C66" }} axisLine={false} tickLine={false} tickFormatter={fmt} width={56} />
              <Tooltip
                formatter={(v) => (Array.isArray(v) ? `${whole(Number(v[0]))} – ${whole(Number(v[1]))}` : whole(Number(v)))}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E6E3DC" }}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="#c8322f" strokeDasharray="4 3" />
              {mc && <Area dataKey="band" name="10th–90th percentile" stroke="none" fill="#C8A96A" fillOpacity={0.28} isAnimationActive={false} />}
              {mc && <Line dataKey="median" name="Median simulation" stroke="#8C6D35" strokeDasharray="5 4" dot={false} strokeWidth={1.5} isAnimationActive={false} />}
              <Line dataKey="expected" name="Expected path" stroke="#121214" strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <p className="text-[12px] leading-relaxed text-ink-3">
          Illustrative model, not a forecast of any real business. Each month’s revenue is collected after the payment delay (split across two months when the delay isn’t a whole number of months);
          expenses are paid in the same month. Monte Carlo runs add mean-preserving log-normal noise to revenue and normal noise to the delay, with a fixed random seed so results are reproducible. The
          ± figure is the 95% confidence interval of the simulated probability (1.96 × standard error).
        </p>
      </div>
    </div>
  );
}

function Answer({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-bad";
  return (
    <div className="card p-5">
      <div className="text-[12.5px] text-ink-3">{label}</div>
      <div className={`tabular mt-1.5 text-[28px] font-semibold tracking-tight ${color}`}>{value}</div>
      <div className="mt-1 text-[12px] text-ink-3">{sub}</div>
    </div>
  );
}
