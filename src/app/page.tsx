import { AlertTriangle, CheckCircle2, Clock, Gauge, ListChecks, Timer } from "lucide-react";
import Link from "next/link";
import { CoverageChart, ExceptionChart, ReviewDonut, SERIES, type RunBar } from "@/components/dashboard-charts";
import { DemoButton } from "@/components/demo-button";
import { Card, Empty, Kpi, PageHeader, Progress } from "@/components/ui";
import { compactMoney, dateTime, EXCEPTION_LABEL, int, ms, pct } from "@/lib/format";
import { runs as listRuns } from "@/server/service";

export const dynamic = "force-dynamic";

const EXC_COLOR: Record<string, string> = {
  missing_in_ledger: "#c8322f",
  missing_in_bank: "#e0605d",
  currency_mismatch: "#8f1f1d",
  amount_mismatch: "#d08a0e",
  duplicate_bank: "#e9b64a",
  duplicate_ledger: "#f0cc7a",
};

export default function Overview() {
  const runs = listRuns();
  if (runs.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Overview" title="Reconciliation overview" />
        <div className="card">
          <Empty
            title="No reconciliations yet"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <DemoButton />
                <Link className="btn btn-secondary" href="/reconcile/new">
                  Upload CSV files
                </Link>
              </div>
            }
          >
            Run a demonstration on synthetic bank and ledger data, or upload your own CSV exports. Nothing leaves this machine.
          </Empty>
        </div>
      </>
    );
  }

  const latest = runs[0]!;
  const m = latest.metrics;
  const p = latest.progress;
  const proposed = p.verified + p.approved + p.pending + p.rejected;
  const rowsPerSec = ((m.bankCount + m.ledgerCount) / Math.max(m.totalMs, 1)) * 1000;

  const bars: RunBar[] = runs
    .slice(0, 10)
    .reverse()
    .map((r) => {
      const n = Math.max(1, r.metrics.bankCount);
      const s = r.metrics.bankRowsByStatus ?? { verified: 0, suggested: 0, needs_review: 0 };
      const share = (x: number) => Number(((x / n) * 100).toFixed(2));
      return {
        name: r.id.slice(-4),
        verified: share(s.verified),
        suggested: share(s.suggested),
        review: share(s.needs_review),
        unmatched: share(r.metrics.bankCount - s.verified - s.suggested - s.needs_review),
      };
    });

  const exc = Object.entries(m.exceptionsByType)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ label: EXCEPTION_LABEL[type] ?? type, count, tone: EXC_COLOR[type] ?? "#6b7a90" }));

  const donut = [
    { name: "Verified", value: p.verified, color: SERIES.verified },
    { name: "Approved", value: p.approved, color: SERIES.approved },
    { name: "Pending review", value: p.pending, color: SERIES.review },
    { name: "Rejected", value: p.rejected, color: SERIES.rejected },
  ].filter((d) => d.value > 0);

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Reconciliation overview"
        description={
          <>
            Latest run <Link href={`/runs/${latest.id}`} className="font-medium text-brand hover:underline">{latest.name}</Link> · {dateTime(latest.createdAt)} · engine {latest.engineVersion} · model {latest.modelVersion}
          </>
        }
        actions={
          <>
            <Link className="btn btn-secondary" href={`/runs/${latest.id}/report`}>
              Report
            </Link>
            <Link className="btn btn-primary" href={`/runs/${latest.id}`}>
              Open workspace
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-6">
        <Kpi label="Auto-verified" tone="ok" icon={<CheckCircle2 className="h-4 w-4" />} value={pct(m.autoVerifiedRate)} sub={`${int(m.verifiedMatches)} rule matches, unique on both sides`} />
        <Kpi label="Proposed coverage" tone="info" icon={<Gauge className="h-4 w-4" />} value={pct(m.proposedCoverageRate)} sub={`of ${int(m.bankCount)} bank rows linked`} />
        <Kpi label="Awaiting review" tone="warn" icon={<ListChecks className="h-4 w-4" />} value={int(p.pending)} sub={`${int(p.approved)} approved · ${int(p.rejected)} rejected`} />
        <Kpi label="Open exceptions" tone="bad" icon={<AlertTriangle className="h-4 w-4" />} value={int(p.openExceptions)} sub={`${int(p.resolvedExceptions)} resolved`} />
        <Kpi label="Processing time" icon={<Timer className="h-4 w-4" />} value={ms(m.totalMs)} sub={`${int(Math.round(rowsPerSec))} rows/s measured`} />
        <Kpi label="Rows reconciled" icon={<Clock className="h-4 w-4" />} value={int(m.bankCount + m.ledgerCount)} sub={`${int(m.bankCount)} bank · ${int(m.ledgerCount)} ledger`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Bank-row coverage by run" subtitle="Share of bank transactions by match outcome at run time (last 10 runs)">
          <CoverageChart data={bars} />
        </Card>
        <Card title="Review status" subtitle="Latest run, current decisions">
          <ReviewDonut data={donut} />
          <div className="mt-2 space-y-2">
            {[
              ["Verified by rule", p.verified, SERIES.verified],
              ["Approved by reviewer", p.approved, SERIES.approved],
              ["Pending review", p.pending, SERIES.review],
              ["Rejected", p.rejected, SERIES.rejected],
            ].map(([l, v, c]) => (
              <div key={l as string} className="flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-2 text-ink-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: c as string }} />
                  {l}
                </span>
                <span className="tabular font-medium text-ink">
                  {int(v as number)} <span className="text-ink-3">· {pct(proposed ? (v as number) / proposed : null, 0)}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Exceptions by type" subtitle="Latest run">
          {exc.length ? <ExceptionChart data={exc} /> : <p className="text-[13px] text-ink-3">No exceptions.</p>}
        </Card>
        <Card className="xl:col-span-2" title="Exposure by currency" subtitle="Latest run · totals computed in integer minor units" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="px-4 py-2.5 font-semibold">Currency</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Bank rows</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Bank net</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Ledger net</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Unmatched bank</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Unmatched ledger</th>
                  <th className="w-36 px-4 py-2.5 font-semibold">Linked</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {m.byCurrency.map((c) => {
                  // Count-based share: signed net totals would mislead when inflows and outflows mix.
                  const linked = c.bankCount ? (c.matchedBankCount ?? 0) / c.bankCount : 0;
                  return (
                    <tr key={c.currency} className="table-row border-b border-line last:border-0">
                      <td className="px-4 py-2.5 font-semibold">{c.currency}</td>
                      <td className="px-4 py-2.5 text-right">{int(c.bankCount)}</td>
                      <td className="px-4 py-2.5 text-right">{compactMoney(c.bankTotalMinor, c.currency)}</td>
                      <td className="px-4 py-2.5 text-right">{compactMoney(c.ledgerTotalMinor, c.currency)}</td>
                      <td className="px-4 py-2.5 text-right text-bad">{compactMoney(c.unmatchedBankMinor, c.currency)}</td>
                      <td className="px-4 py-2.5 text-right text-bad">{compactMoney(c.unmatchedLedgerMinor, c.currency)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Progress value={linked} tone={linked >= 0.9 ? "ok" : linked >= 0.7 ? "warn" : "bad"} />
                          <span className="w-10 text-right text-[11px] text-ink-3">{pct(linked, 0)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="mt-4" title="Recent reconciliations" actions={<Link href="/runs" className="text-[12px] font-semibold text-brand hover:underline">View all</Link>} bodyClassName="p-0">
        <RecentRuns runs={runs.slice(0, 6)} />
      </Card>
    </>
  );
}

function RecentRuns({ runs }: { runs: ReturnType<typeof listRuns> }) {
  return (
    <div className="divide-y divide-line">
      {runs.map((r) => (
        <Link key={r.id} href={`/runs/${r.id}`} className="table-row flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-ink">{r.name}</div>
            <div className="text-[12px] text-ink-3">
              {r.id} · {dateTime(r.createdAt)} · {r.createdBy}
            </div>
          </div>
          <div className="tabular flex items-center gap-5 text-[12px] text-ink-2">
            <span>{int(r.metrics.bankCount)} bank rows</span>
            <span className="text-ok">{pct(r.metrics.autoVerifiedRate)} verified</span>
            <span className="text-warn">{int(r.progress.pending)} pending</span>
            <span className="text-bad">{int(r.progress.openExceptions)} open</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
