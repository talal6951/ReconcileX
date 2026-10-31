import { ArrowRight, CheckCircle2, CircleAlert, Clock, FileText, ListChecks, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { CoverageChart, ReviewDonut, type RunBar } from "@/components/dashboard-charts";
import { SERIES } from "@/lib/chart-colors";
import { DemoButton } from "@/components/demo-button";
import { Card, Kpi } from "@/components/ui";
import { dateTime, int, ms, pct } from "@/lib/format";
import { routes } from "@/lib/routes";
import { runData, runs as listRuns } from "@/server/service";
import { requireWorkspacePage } from "@/server/session";

export const dynamic = "force-dynamic";

/** Plain-language descriptions of exception types, ordered by how urgently they usually need attention. */
const ATTENTION: { type: string; title: string; hint: string }[] = [
  { type: "missing_in_ledger", title: "Bank transactions not in your ledger", hint: "Fees, interest or unrecorded receipts" },
  { type: "missing_in_bank", title: "Ledger entries not on the bank statement", hint: "Often in transit, or never paid" },
  { type: "amount_mismatch", title: "Matches with a different amount", hint: "Usually fees or rounding" },
  { type: "currency_mismatch", title: "Same reference, different currency", hint: "Check the exchange rate used" },
  { type: "duplicate_ledger", title: "Possible duplicate ledger entries", hint: "Posted twice?" },
  { type: "duplicate_bank", title: "Possible duplicate bank lines", hint: "Imported twice?" },
];

function greeting(name: string) {
  const first = name.split(" ")[0] || "there";
  return `Welcome back, ${first}`;
}

export default async function Overview() {
  const ctx = await requireWorkspacePage();
  const runs = listRuns(ctx);

  if (runs.length === 0) {
    return (
      <div className="mx-auto max-w-3xl py-10 md:py-16">
        <p className="eyebrow">{ctx.orgName}</p>
        <h1 className="mt-2 text-[30px] font-semibold tracking-tight text-ink md:text-[36px]">{greeting(ctx.userName)}</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-ink-3">
          Reconcile a bank statement against your ledger in three steps: upload both files, review what Reconcile X found, and approve the results.
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="card p-6">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand">
              <Plus className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-[16px] font-semibold">Start a reconciliation</h2>
            <p className="mt-1 text-[13.5px] text-ink-3">Upload a bank statement (PDF, Excel or CSV) and a ledger export.</p>
            <Link className="btn btn-primary mt-5" href={routes.newReconciliation}>
              Upload files <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="card p-6">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ok-soft text-ok">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-[16px] font-semibold">See it with demo data</h2>
            <p className="mt-1 text-[13.5px] text-ink-3">1,500 synthetic transactions with fees, splits, duplicates and mismatches built in.</p>
            <div className="mt-5">
              <DemoButton label="Load demo" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const latest = runs[0]!;
  const m = latest.metrics;
  const p = latest.progress;
  const data = runData(ctx, latest.id);
  const openByType = new Map<string, number>();
  for (const e of data.exceptions) if (e.status === "open") openByType.set(e.type, (openByType.get(e.type) ?? 0) + 1);
  const attention = ATTENTION.filter((a) => (openByType.get(a.type) ?? 0) > 0);
  const confirmed = p.verified + p.approved;
  const proposed = confirmed + p.pending + p.rejected;
  const done = p.pending === 0 && p.openExceptions === 0;

  const bars: RunBar[] = runs
    .slice(0, 8)
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

  const donut = [
    { name: "Verified by rule", value: p.verified, color: SERIES.verified },
    { name: "Approved by you", value: p.approved, color: SERIES.approved },
    { name: "Waiting for review", value: p.pending, color: SERIES.review },
    { name: "Rejected", value: p.rejected, color: SERIES.rejected },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-8">
      {/* Headline: what happened and what to do next */}
      <section className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <p className="eyebrow">{ctx.orgName}</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-ink md:text-[32px]">{greeting(ctx.userName)}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            Your latest reconciliation,{" "}
            <Link href={routes.reconciliation(latest.id)} className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              {latest.name}
            </Link>
            , linked <b className="text-ink">{pct(m.proposedCoverageRate, 0)}</b> of {int(m.bankCount)} bank transactions.{" "}
            {done ? (
              <span className="text-ok">Everything has been reviewed.</span>
            ) : (
              <>
                <b className="text-ink">{int(p.pending)}</b> {p.pending === 1 ? "match needs" : "matches need"} your review and <b className="text-ink">{int(p.openExceptions)}</b>{" "}
                {p.openExceptions === 1 ? "exception is" : "exceptions are"} open.
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link className="btn btn-secondary h-10 px-4" href={routes.newReconciliation}>
            <Plus className="h-4 w-4" /> New reconciliation
          </Link>
          <Link className="btn btn-primary h-10 px-4" href={routes.reconciliation(latest.id)}>
            {done ? "Open results" : "Continue review"} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Matched automatically" tone="ok" icon={<CheckCircle2 className="h-4 w-4" />} value={pct(m.autoVerifiedRate, 0)} sub={`${int(m.verifiedMatches)} proven by exact rules`} />
        <Kpi label="Waiting for review" tone="warn" icon={<ListChecks className="h-4 w-4" />} value={int(p.pending)} sub={`${int(p.approved)} approved · ${int(p.rejected)} rejected`} />
        <Kpi label="Open exceptions" tone="bad" icon={<CircleAlert className="h-4 w-4" />} value={int(p.openExceptions)} sub={`${int(p.resolvedExceptions)} resolved`} />
        <Kpi label="Processing time" icon={<Clock className="h-4 w-4" />} value={ms(m.totalMs)} sub={`${int(m.bankCount + m.ledgerCount)} rows reconciled`} />
      </section>

      <section className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1.15fr_1fr]">
        <Card title="Needs your attention" subtitle="Open exceptions in the latest reconciliation" bodyClassName="p-0">
          {attention.length === 0 && p.pending === 0 ? (
            <p className="flex items-center gap-2 px-5 py-8 text-[14px] text-ok">
              <CheckCircle2 className="h-5 w-5" /> Nothing needs attention.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {p.pending > 0 && (
                <AttentionRow
                  href={routes.reconciliation(latest.id)}
                  count={p.pending}
                  title="Suggested matches to approve or reject"
                  hint="Each shows the evidence and the model’s reasoning"
                  tone="warn"
                />
              )}
              {attention.map((a) => (
                <AttentionRow key={a.type} href={`${routes.reconciliation(latest.id)}?tab=exceptions&type=${a.type}`} count={openByType.get(a.type)!} title={a.title} hint={a.hint} tone="bad" />
              ))}
            </ul>
          )}
        </Card>
        <Card title="Review progress" subtitle={`${int(proposed)} proposed links in the latest reconciliation`}>
          <ReviewDonut data={donut} />
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2">
            {donut.map((d) => (
              <div key={d.name} className="flex items-center justify-between text-[12.5px]">
                <span className="flex items-center gap-2 text-ink-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                  {d.name}
                </span>
                <span className="tabular font-medium text-ink">{int(d.value)}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1.15fr_1fr]">
        <Card title="Bank transactions by outcome" subtitle="Share of each reconciliation’s bank lines, at the time it ran">
          <CoverageChart data={bars} />
        </Card>
        <Card
          title="Recent reconciliations"
          actions={
            <Link href={routes.reconciliations} className="text-[12.5px] font-semibold text-brand hover:underline">
              View all
            </Link>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-line">
            {runs.slice(0, 5).map((r) => (
              <li key={r.id}>
                <Link href={routes.reconciliation(r.id)} className="row-hover flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium text-ink sm:truncate">{r.name}</div>
                    <div className="text-[12px] text-ink-3">{dateTime(r.createdAt)}</div>
                  </div>
                  <div className="tabular shrink-0 text-right text-[12px]">
                    <div className="font-medium text-ink">{pct(r.metrics.proposedCoverageRate, 0)} linked</div>
                    <div className="text-ink-3">{int(r.progress.pending)} to review</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-5 py-3">
            <Link href={routes.report(latest.id)} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2 hover:text-ink">
              <FileText className="h-4 w-4" /> Latest report
            </Link>
          </div>
        </Card>
      </section>
    </div>
  );
}

function AttentionRow({ href, count, title, hint, tone }: { href: string; count: number; title: string; hint: string; tone: "warn" | "bad" }) {
  return (
    <li>
      <Link href={href} className="row-hover flex items-center gap-4 px-5 py-4">
        <span className={`tabular grid h-9 min-w-12 shrink-0 place-items-center rounded-lg px-2 text-[13px] font-semibold ${tone === "warn" ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad"}`}>
          {int(count)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium text-ink sm:truncate">{title}</span>
          <span className="block text-[12px] text-ink-3 sm:truncate">{hint}</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-ink-3" />
      </Link>
    </li>
  );
}
