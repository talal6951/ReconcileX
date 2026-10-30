"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const SERIES = {
  verified: "#0f8a5f",
  approved: "#3aa57f",
  suggested: "#2458e6",
  review: "#d08a0e",
  rejected: "#c8322f",
  unmatched: "#c3ccdb",
};

const axis = { fontSize: 11, fill: "#6b7a90" };
const tooltipStyle = { fontSize: 12, borderRadius: 8, border: "1px solid #e3e8f0", boxShadow: "0 8px 24px -8px rgba(14,26,43,.2)" };

export interface RunBar {
  name: string;
  verified: number;
  suggested: number;
  review: number;
  unmatched: number;
}

export function CoverageChart({ data }: { data: RunBar[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="#eef1f6" />
        <XAxis dataKey="name" tick={axis} axisLine={false} tickLine={false} />
        <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(1)}%`} cursor={{ fill: "#f4f6fa" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Bar dataKey="verified" name="Verified by rule" stackId="a" fill={SERIES.verified} />
        <Bar dataKey="suggested" name="Suggested" stackId="a" fill={SERIES.suggested} />
        <Bar dataKey="review" name="Needs review" stackId="a" fill={SERIES.review} />
        <Bar dataKey="unmatched" name="Unmatched" stackId="a" fill={SERIES.unmatched} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ExceptionChart({ data }: { data: { label: string; count: number; tone: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 38)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="label" tick={axis} axisLine={false} tickLine={false} width={130} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f4f6fa" }} />
        <Bar dataKey="count" name="Exceptions" radius={[0, 4, 4, 0]} barSize={16} label={{ position: "right", fontSize: 11, fill: "#3c4a5e" }}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.tone} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ReviewDonut({ data }: { data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="relative h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={88} paddingAngle={1.5} stroke="none">
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="tabular text-2xl font-semibold text-ink">{total.toLocaleString("en-US")}</div>
          <div className="text-[11px] text-ink-3">proposed links</div>
        </div>
      </div>
    </div>
  );
}
