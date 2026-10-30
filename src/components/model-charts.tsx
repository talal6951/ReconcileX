"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";

const axis = { fontSize: 11, fill: "#6b7a90" };
const tooltipStyle = { fontSize: 12, borderRadius: 8, border: "1px solid #e3e8f0" };

export function PrCurve({ model, baseline }: { model: { recall: number; precision: number }[]; baseline: { recall: number; precision: number }[] }) {
  // Merge onto a shared recall axis for a two-series line chart.
  const rows = [...model.map((p) => ({ recall: p.recall, model: p.precision })), ...baseline.map((p) => ({ recall: p.recall, baseline: p.precision }))].sort((a, b) => a.recall - b.recall);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={rows} margin={{ top: 8, right: 16, left: -8, bottom: 8 }}>
        <CartesianGrid stroke="#eef1f6" />
        <XAxis dataKey="recall" type="number" domain={[0, 1]} tick={axis} tickFormatter={(v) => `${Math.round(v * 100)}%`} label={{ value: "Recall", position: "insideBottom", offset: -4, fontSize: 11, fill: "#6b7a90" }} />
        <YAxis domain={[0.5, 1]} tick={axis} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} labelFormatter={(v) => `Recall ${(Number(v) * 100).toFixed(1)}%`} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="model" name="Logistic regression" stroke="#2458e6" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        <Line dataKey="baseline" name="Rules-only baseline" stroke="#9aa6b8" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Calibration({ bins }: { bins: { meanPredicted: number; observedRate: number; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 8, right: 16, left: -8, bottom: 8 }}>
        <CartesianGrid stroke="#eef1f6" />
        <XAxis dataKey="meanPredicted" type="number" domain={[0, 1]} tick={axis} tickFormatter={(v) => `${Math.round(v * 100)}%`} label={{ value: "Predicted probability", position: "insideBottom", offset: -4, fontSize: 11, fill: "#6b7a90" }} />
        <YAxis dataKey="observedRate" type="number" domain={[0, 1]} tick={axis} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
        <ZAxis dataKey="count" range={[40, 400]} name="Pairs" />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#c3ccdb" strokeDasharray="4 3" />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => (n === "Pairs" ? Number(v).toLocaleString("en-US") : `${(Number(v) * 100).toFixed(1)}%`)} />
        <Scatter data={bins} name="Observed match rate" fill="#2458e6" isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
