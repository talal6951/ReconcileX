import Link from "next/link";
import { DemoButton } from "@/components/demo-button";
import { Card, Empty, PageHeader, Progress } from "@/components/ui";
import { dateTime, int, ms, pct } from "@/lib/format";
import { runs as listRuns } from "@/server/service";
import { requireWorkspacePage } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reconciliations" };

export default async function Runs() {
  const ctx = await requireWorkspacePage();
  const runs = listRuns(ctx);
  return (
    <>
      <PageHeader
        eyebrow="History"
        title="Reconciliations"
        description="Every run is stored with its inputs, engine and model versions, results and review decisions."
        actions={
          <Link className="btn btn-primary" href="/app/reconciliations/new">
            New reconciliation
          </Link>
        }
      />
      <Card bodyClassName="p-0">
        {runs.length === 0 ? (
          <Empty title="No reconciliations yet" action={<DemoButton />}>
            Start with the synthetic demo or upload CSV files.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="px-4 py-2.5 font-semibold">Run</th>
                  <th className="px-4 py-2.5 font-semibold">Created</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Bank / ledger rows</th>
                  <th className="w-44 px-4 py-2.5 font-semibold">Auto-verified</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Pending</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Open exceptions</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Time</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {runs.map((r) => (
                  <tr key={r.id} className="table-row border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/app/reconciliations/${r.id}`} className="font-semibold text-ink hover:text-brand">
                        {r.name}
                      </Link>
                      <div className="text-[11.5px] text-ink-3">
                        {r.id} · {r.source === "demo" ? "synthetic demo" : "upload"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-2">
                      {dateTime(r.createdAt)}
                      <div className="text-[11.5px] text-ink-3">{r.createdBy}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {int(r.metrics.bankCount)} / {int(r.metrics.ledgerCount)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Progress value={r.metrics.autoVerifiedRate} />
                        <span className="w-12 text-right text-[12px]">{pct(r.metrics.autoVerifiedRate)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-warn">{int(r.progress.pending)}</td>
                    <td className="px-4 py-3 text-right text-bad">{int(r.progress.openExceptions)}</td>
                    <td className="px-4 py-3 text-right text-ink-2">{ms(r.metrics.totalMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
