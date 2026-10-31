"use client";

import { Info, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { TxDTO } from "@/lib/dto";
import { int, money } from "@/lib/format";
import { Badge } from "../ui";

interface Anomaly {
  txId: string;
  side: "bank" | "ledger";
  currency: string;
  group: string;
  groupSize: number;
  amountMinor: string;
  typicalMinor: string;
  z: number;
  direction: "higher" | "lower";
  ratio: number;
}

interface Benford {
  n: number;
  observed: number[];
  expected: number[];
  chiSquare: number | null;
  pValue: number | null;
  verdict: "insufficient" | "consistent" | "deviates";
}

interface Insights {
  anomalies: Anomaly[];
  benford: { bank: Benford; ledger: Benford };
  settings: { minGroupSize: number; threshold: number };
}

/** Statistical insights: unusual amounts (robust z-score) and first-digit tests. Descriptive, not accusations. */
export function InsightsPanel({ runId, tx }: { runId: string; tx: Record<string, TxDTO> }) {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${encodeURIComponent(runId)}/insights`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Could not load insights");
        if (live) setData(body);
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [runId]);

  if (error) return <p className="p-6 text-[13px] text-bad">{error}</p>;
  if (!data)
    return (
      <p className="flex items-center gap-2 p-6 text-[13px] text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Analysing amounts…
      </p>
    );

  return (
    <div className="space-y-6 p-5">
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-ink">Unusual amounts</h3>
          <span className="text-[12px] text-ink-3">
            {int(data.anomalies.length)} found · robust z-score above {data.settings.threshold} within a counterparty’s own history (≥ {data.settings.minGroupSize} payments)
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-[12.5px] text-ink-3">
          Each amount is compared with the median of the same counterparty’s amounts (on a log scale), using the median absolute deviation so that the outliers themselves don’t distort the baseline. A
          flag means “worth a look”, not “wrong”.
        </p>
        {data.anomalies.length === 0 ? (
          <p className="mt-4 rounded-lg bg-ok-soft px-4 py-3 text-[13px] text-ok">No amounts stand out from their counterparty’s usual pattern.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="px-4 py-2.5 font-semibold">Transaction</th>
                  <th className="px-4 py-2.5 font-semibold">Counterparty</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Typical</th>
                  <th className="px-4 py-2.5 font-semibold">Why it stands out</th>
                </tr>
              </thead>
              <tbody>
                {data.anomalies.slice(0, 100).map((a) => {
                  const t = tx[a.txId];
                  return (
                    <tr key={a.txId} className="border-b border-line align-top last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{t?.description || t?.reference || a.txId}</div>
                        <div className="text-[11.5px] text-ink-3">
                          {a.side === "bank" ? "Bank" : "Ledger"} · {t?.date} · {a.txId}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-ink-2">
                        {a.group}
                        <div className="text-[11.5px] text-ink-3">{int(a.groupSize)} payments</div>
                      </td>
                      <td className="tabular px-4 py-3 text-right font-semibold whitespace-nowrap">
                        {money(a.amountMinor, a.currency)} <span className="text-[11px] text-ink-3">{a.currency}</span>
                      </td>
                      <td className="tabular px-4 py-3 text-right whitespace-nowrap text-ink-3">{money(a.typicalMinor, a.currency)}</td>
                      <td className="px-4 py-3">
                        <Badge tone="warn" dot={false}>
                          {a.direction === "higher" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {a.ratio}× {a.direction} than usual
                        </Badge>
                        <div className="mt-1 text-[11.5px] text-ink-3">robust z = {a.z}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-[15px] font-semibold text-ink">First-digit test (Benford’s law)</h3>
        <p className="mt-1 max-w-3xl text-[12.5px] text-ink-3">
          In many naturally occurring financial datasets, about 30% of amounts start with 1 and fewer than 5% with 9. A strong deviation can signal fabricated, duplicated or constrained amounts — or
          simply a dataset where Benford’s law doesn’t apply (e.g. fixed prices). Pearson χ² test, 8 degrees of freedom.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {(["bank", "ledger"] as const).map((side) => (
            <BenfordCard key={side} title={side === "bank" ? "Bank statement" : "Ledger"} b={data.benford[side]} />
          ))}
        </div>
      </section>
    </div>
  );
}

function BenfordCard({ title, b }: { title: string; b: Benford }) {
  // Scale to the larger of the observed maximum and Benford's 30.1% for digit 1, with 10% headroom so nothing touches the top.
  const max = Math.max(...b.observed.map((o) => o / Math.max(b.n, 1)), 0.302) * 1.1;
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-center justify-between">
        <span className="text-[13.5px] font-semibold">{title}</span>
        {b.verdict === "insufficient" ? <Badge tone="neutral">Too few amounts</Badge> : b.verdict === "consistent" ? <Badge tone="ok">Consistent</Badge> : <Badge tone="warn">Deviates</Badge>}
      </div>
      <div className="mt-1 text-[12px] text-ink-3">
        {int(b.n)} amounts
        {b.chiSquare !== null && b.pValue !== null && (
          <>
            {" "}
            · χ² = {b.chiSquare.toFixed(1)} · p = {b.pValue < 0.0001 ? "< 0.0001" : b.pValue.toFixed(4)}
          </>
        )}
      </div>
      {/* Columns stretch to the full chart height so the bars' percentage heights resolve (an auto-height parent gives 0). */}
      <div className="mt-4 flex h-28 items-stretch gap-1.5" role="img" aria-label="Observed versus expected first-digit frequencies">
        {b.observed.map((o, i) => {
          const obs = b.n ? o / b.n : 0;
          const exp = b.expected[i]! / Math.max(b.n, 1);
          return (
            <div key={i} className="relative flex h-full flex-1 flex-col items-center justify-end">
              <div
                className="w-full rounded-t bg-brand/80"
                style={{ height: `${(obs / max) * 100}%` }}
                title={`Digit ${i + 1}: observed ${(obs * 100).toFixed(1)}%, expected ${(exp * 100).toFixed(1)}%`}
              />
              <div className="absolute w-[120%] border-t-2 border-dashed border-ink-2" style={{ bottom: `${(exp / max) * 100}%` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5 text-center text-[10.5px] text-ink-3">
        {b.observed.map((_, i) => (
          <span key={i} className="flex-1">
            {i + 1}
          </span>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
        <Info className="h-3 w-3" /> Bars: observed share · dashed line: Benford expectation
      </p>
    </div>
  );
}
