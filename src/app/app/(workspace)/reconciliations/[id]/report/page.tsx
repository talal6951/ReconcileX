import clsx from "clsx";
import { ArrowLeft, CheckCircle2, CircleAlert, Download, FileJson, FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { Badge, Card, ExceptionBadge, PageHeader, Progress } from "@/components/ui";
import { dateTime, int, METHOD_LABEL, money, ms, pct, STATUS_LABEL } from "@/lib/format";
import { routes } from "@/lib/routes";
import { NotFoundError } from "@/server/repo";
import { buildReport, type SideFigures } from "@/server/report";
import { decisions as listDecisions, runData } from "@/server/service";
import { requireWorkspacePage } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reconciliation report" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireWorkspacePage();
  const { id } = await params;
  let data;
  try {
    data = runData(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const decisions = listDecisions(ctx, id);
  const r = buildReport(data, decisions);
  const s = data.summary;
  const exportHref = (f: string) => `/api/runs/${encodeURIComponent(id)}/export?format=${f}`;

  return (
    <div className="space-y-4">
      <Link href={routes.reconciliation(id)} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3 hover:text-ink print:hidden">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to workspace
      </Link>
      <PageHeader
        eyebrow={`Reconciliation report · ${s.id}`}
        title={s.name}
        description={`Prepared for ${ctx.orgName} · generated ${dateTime(new Date().toISOString())} by ${ctx.userName}`}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <PrintButton />
            <a className="btn btn-secondary" href={exportHref("matches")}>
              <FileSpreadsheet className="h-4 w-4" /> Matches CSV
            </a>
            <a className="btn btn-secondary" href={exportHref("exceptions")}>
              <Download className="h-4 w-4" /> Exceptions CSV
            </a>
            <a className="btn btn-primary" href={exportHref("json")}>
              <FileJson className="h-4 w-4" /> Full report JSON
            </a>
          </div>
        }
      />

      <Readiness pending={r.readiness.pendingMatches} open={r.readiness.openExceptions} ready={r.readiness.ready} />

      <Card title="Source and provenance" subtitle="What was reconciled, by whom, and with which engine">
        <dl className="grid gap-x-8 gap-y-3 text-[13px] md:grid-cols-2">
          <Meta label="Bank statement" value={s.bankFile} mono={`SHA-256 ${s.bankSha256}`} />
          <Meta label="Ledger export" value={s.ledgerFile} mono={`SHA-256 ${s.ledgerSha256}`} />
          <Meta label="Created" value={`${dateTime(s.createdAt)} by ${s.createdBy}`} />
          <Meta label="Engine / model" value={`engine ${s.engineVersion} · model ${s.modelVersion}`} mono={`processed ${int(s.metrics.bankCount + s.metrics.ledgerCount)} rows in ${ms(s.metrics.totalMs)}`} />
          <Meta label="Data source" value={s.source === "demo" ? "Synthetic demonstration data (not real accounts)" : "Uploaded files"} />
          <Meta label="Matching parameters" value={`±${data.config.dateWindowDays} days · ${(data.config.amountTolerancePct * 100).toFixed(1)}% candidate tolerance · suggest ≥ ${pct(data.config.minSuggestProbability, 0)}`} />
        </dl>
      </Card>

      <Card title="Position by currency" subtitle="Current state including all review decisions. Confirmed = verified by rule or approved by a reviewer." bodyClassName="p-0">
        {r.positions.map((p) => (
          <div key={p.currency} className="border-b border-line px-4 py-4 last:border-0">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[15px] font-semibold">{p.currency}</h3>
              <div className="tabular text-[12.5px] text-ink-3">
                Net difference (bank − ledger):{" "}
                <span className={clsx("font-semibold", p.netDifferenceMinor === 0n ? "text-ok" : "text-ink")}>
                  {money(p.netDifferenceMinor, p.currency, { sign: true })} {p.currency}
                </span>
                {p.confirmedDifferenceMinor !== 0n && (
                  <>
                    {" "}· accepted differences on confirmed matches: <span className="font-semibold text-warn">{money(p.confirmedDifferenceMinor, p.currency, { sign: true })}</span>
                  </>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="tabular w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
                    <th className="py-1.5 font-semibold">Side</th>
                    <th className="py-1.5 text-right font-semibold">Rows</th>
                    <th className="py-1.5 text-right font-semibold">Net total</th>
                    <th className="py-1.5 text-right font-semibold text-ok">Confirmed</th>
                    <th className="py-1.5 text-right font-semibold text-warn">Pending review</th>
                    <th className="py-1.5 text-right font-semibold text-bad">Unmatched</th>
                    <th className="w-40 py-1.5 pl-4 font-semibold">Confirmed share</th>
                  </tr>
                </thead>
                <tbody>
                  <SideRow label="Bank" s={p.bank} ccy={p.currency} />
                  <SideRow label="Ledger" s={p.ledger} ccy={p.currency} />
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Matches by status" bodyClassName="p-0">
          <table className="tabular w-full text-[13px]">
            <tbody>
              {(Object.entries(r.matchesByStatus) as [string, number][]).map(([status, n]) => (
                <tr key={status} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">{STATUS_LABEL[status] ?? status}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{int(n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Matches by method" subtitle="How each link was found, and how many are now confirmed" bodyClassName="p-0">
          <table className="tabular w-full text-[13px]">
            <tbody>
              {Object.entries(r.matchesByMethod).map(([method, v]) => (
                <tr key={method} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">{METHOD_LABEL[method] ?? method}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{int(v.count)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-3">{int(v.confirmed)} confirmed</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Exception register" subtitle="Open exposure is the absolute amount at stake for unresolved items" bodyClassName="p-0">
        {r.exceptions.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-ink-3">No exceptions were raised.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="px-4 py-2.5 font-semibold">Type</th>
                  <th className="px-4 py-2.5 font-semibold">Currency</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Open</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Resolved</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Open exposure</th>
                </tr>
              </thead>
              <tbody>
                {r.exceptions.map((e) => (
                  <tr key={`${e.type}-${e.currency}`} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <ExceptionBadge type={e.type} />
                    </td>
                    <td className="px-4 py-2.5">{e.currency}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{int(e.open)}</td>
                    <td className="px-4 py-2.5 text-right text-ok">{int(e.resolved)}</td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {money(e.openExposureMinor, e.currency)} {e.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Review activity" subtitle="Every decision is recorded with a reason in the audit trail" bodyClassName="p-0">
        {r.reviewers.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-ink-3">No review decisions have been recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[600px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="px-4 py-2.5 font-semibold">Reviewer</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Approved</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Rejected</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Reopened</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Exceptions resolved</th>
                  <th className="px-4 py-2.5 font-semibold">Last action</th>
                </tr>
              </thead>
              <tbody>
                {r.reviewers.map((v) => (
                  <tr key={v.reviewer} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 font-medium">{v.reviewer}</td>
                    <td className="px-4 py-2.5 text-right">{int(v.approvals)}</td>
                    <td className="px-4 py-2.5 text-right">{int(v.rejections)}</td>
                    <td className="px-4 py-2.5 text-right">{int(v.reopens)}</td>
                    <td className="px-4 py-2.5 text-right">{int(v.resolutions)}</td>
                    <td className="px-4 py-2.5 text-ink-3">{dateTime(v.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-[11.5px] text-ink-3">
        Amounts are computed in integer minor units from the stored transactions. This report reflects data and decisions at the time of generation; it is not an accounting opinion. Reconcile X does not move money or modify bank or ledger records.
      </p>
    </div>
  );
}

function Readiness({ pending, open, ready }: { pending: number; open: number; ready: boolean }) {
  return (
    <div className={clsx("flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between", ready ? "border-ok/30 bg-ok-soft" : "border-warn/30 bg-warn-soft")}>
      <div className="flex items-start gap-3">
        {ready ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-ok" /> : <CircleAlert className="mt-0.5 h-5 w-5 text-warn" />}
        <div>
          <div className={clsx("text-[14px] font-semibold", ready ? "text-ok" : "text-warn")}>{ready ? "Ready for sign-off" : "Not ready for sign-off"}</div>
          <div className="text-[12.5px] text-ink-2">
            {ready ? "Every proposed match has been decided and every exception resolved." : `${int(pending)} match${pending === 1 ? "" : "es"} awaiting review · ${int(open)} open exception${open === 1 ? "" : "s"}`}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <Badge tone={pending === 0 ? "ok" : "warn"}>{pending === 0 ? "Reviews complete" : "Reviews pending"}</Badge>
        <Badge tone={open === 0 ? "ok" : "bad"}>{open === 0 ? "Exceptions resolved" : "Exceptions open"}</Badge>
      </div>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5 break-words text-ink">{value}</dd>
      {mono && <dd className="mt-0.5 break-all font-mono text-[11px] text-ink-3">{mono}</dd>}
    </div>
  );
}

function SideRow({ label, s, ccy }: { label: string; s: SideFigures; ccy: string }) {
  const share = s.count ? s.confirmedCount / s.count : 0;
  return (
    <tr className="border-t border-line">
      <td className="py-2 font-medium">{label}</td>
      <td className="py-2 text-right">{int(s.count)}</td>
      <td className="py-2 text-right">{money(s.totalMinor, ccy)}</td>
      <td className="py-2 text-right">
        {money(s.confirmedMinor, ccy)} <span className="text-[11px] text-ink-3">({int(s.confirmedCount)})</span>
      </td>
      <td className="py-2 text-right">
        {money(s.pendingMinor, ccy)} <span className="text-[11px] text-ink-3">({int(s.pendingCount)})</span>
      </td>
      <td className="py-2 text-right">
        {money(s.unmatchedMinor, ccy)} <span className="text-[11px] text-ink-3">({int(s.unmatchedCount)})</span>
      </td>
      <td className="py-2 pl-4">
        <div className="flex items-center gap-2">
          <Progress value={share} tone={share >= 0.9 ? "ok" : share >= 0.6 ? "warn" : "bad"} />
          <span className="w-10 text-right text-[11px] text-ink-3">{pct(share, 0)}</span>
        </div>
      </td>
    </tr>
  );
}
