import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { VerifyChain } from "@/components/verify-chain";
import { dateTime, int } from "@/lib/format";
import { routes } from "@/lib/routes";
import { searchWorkspaceAudit, workspaceAuditFacets, type AuditFilters } from "@/server/service";
import { requireWorkspacePage } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit trail" };

const PAGE = 50;

const ACTION_LABEL: Record<string, string> = {
  "dataset.imported": "Dataset imported",
  "run.completed": "Reconciliation run",
  "match.approve": "Match approved",
  "match.reject": "Match rejected",
  "match.reopen": "Match reopened",
  "exception.resolve": "Exception resolved",
  "exception.reopen": "Exception reopened",
  "report.exported": "Report exported",
  "audit.exported": "Audit trail exported",
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 200) || undefined;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  const ctx = await requireWorkspacePage();
  const sp = await searchParams;
  const filters: AuditFilters = { q: one(sp.q), action: one(sp.action), actor: one(sp.actor), runId: one(sp.run), from: one(sp.from), to: one(sp.to) };
  const page = Math.max(0, Math.trunc(Number(one(sp.page) ?? "0")) || 0);
  const { events, total } = searchWorkspaceAudit(ctx, filters, { limit: PAGE, offset: page * PAGE });
  const facets = workspaceAuditFacets(ctx);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const qs = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const all = { q: filters.q, action: filters.action, actor: filters.actor, run: filters.runId, from: filters.from, to: filters.to, ...extra };
    for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Governance"
        title="Audit trail"
        description={`Every import, reconciliation, decision and export in ${ctx.orgName}. Events are hash-chained and append-only: editing or deleting history is blocked and detectable.`}
        actions={
          <>
            <VerifyChain />
            <a className="btn btn-primary" href={`/api/audit/export${qs({})}`}>
              <Download className="h-4 w-4" /> Export CSV
            </a>
          </>
        }
      />

      <Card bodyClassName="p-0">
        <form method="get" className="grid gap-2 border-b border-line p-4 md:grid-cols-[1.4fr_1fr_1fr_auto_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-ink-3" />
            <input className="input pl-8" name="q" defaultValue={filters.q} placeholder="Search actor, run, match, reason…" aria-label="Search audit events" maxLength={200} />
          </div>
          <select className="input" name="action" defaultValue={filters.action ?? ""} aria-label="Action">
            <option value="">All actions</option>
            {facets.actions.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a] ?? a}
              </option>
            ))}
          </select>
          <select className="input" name="actor" defaultValue={filters.actor ?? ""} aria-label="Person">
            <option value="">Everyone</option>
            {facets.actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input className="input" type="date" name="from" defaultValue={filters.from} aria-label="From date" />
          <input className="input" type="date" name="to" defaultValue={filters.to} aria-label="To date" />
          <div className="flex gap-2">
            {filters.runId && <input type="hidden" name="run" value={filters.runId} />}
            <button className="btn btn-primary" type="submit">
              Filter
            </button>
            {filtered && (
              <Link className="btn btn-secondary" href={routes.audit}>
                Clear
              </Link>
            )}
          </div>
        </form>

        <div className="flex items-center justify-between px-4 py-2.5 text-[12px] text-ink-3">
          <span className="tabular">
            {int(total)} event{total === 1 ? "" : "s"}
            {filters.runId && (
              <>
                {" "}for run <span className="font-mono text-ink-2">{filters.runId}</span>
              </>
            )}
          </span>
          <span>Times shown in your local timezone · stored in UTC</span>
        </div>

        <div className="overflow-x-auto">
          {events.length === 0 ? (
            <p className="border-t border-line px-4 py-12 text-center text-[13px] text-ink-3">{filtered ? "No events match these filters." : "No activity recorded yet."}</p>
          ) : (
            <table className="w-full min-w-[920px] text-[13px]">
              <thead>
                <tr className="border-y border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="px-4 py-2.5 font-semibold">#</th>
                  <th className="px-4 py-2.5 font-semibold">When</th>
                  <th className="px-4 py-2.5 font-semibold">Who</th>
                  <th className="px-4 py-2.5 font-semibold">Action</th>
                  <th className="px-4 py-2.5 font-semibold">Subject</th>
                  <th className="px-4 py-2.5 font-semibold">Details</th>
                  <th className="px-4 py-2.5 font-semibold">Hash</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.seq} className="table-row border-b border-line align-top last:border-0">
                    <td className="tabular px-4 py-2.5 text-ink-3">{e.seq}</td>
                    <td className="tabular px-4 py-2.5 whitespace-nowrap text-ink-2">{dateTime(e.ts)}</td>
                    <td className="max-w-[200px] truncate px-4 py-2.5" title={e.actor}>
                      {e.actor}
                    </td>
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">{ACTION_LABEL[e.action] ?? e.action}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {e.runId ? (
                        <Link className="font-mono text-[12px] text-brand hover:underline" href={routes.reconciliation(e.runId)}>
                          {e.runId}
                        </Link>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                      {e.entityId && e.entityId !== e.runId && e.entityType !== "workspace" && e.entityType !== "dataset" && <div className="font-mono text-[11px] text-ink-3">{e.entityId}</div>}
                    </td>
                    <td className="max-w-[360px] px-4 py-2.5 text-[12px] text-ink-2">
                      <Details details={e.details} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-ink-3" title={`hash ${e.hash}\nprev ${e.prevHash}`}>
                      {e.hash.slice(0, 10)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
          <span className="tabular">
            Page {page + 1} of {pages}
          </span>
          <div className="flex gap-1">
            {page > 0 ? (
              <Link className="btn btn-secondary h-8 px-2" href={`${routes.audit}${qs({ page: page - 1 })}`} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </Link>
            ) : (
              <span className="btn btn-secondary h-8 px-2 opacity-40" aria-hidden>
                <ChevronLeft className="h-4 w-4" />
              </span>
            )}
            {page < pages - 1 ? (
              <Link className="btn btn-secondary h-8 px-2" href={`${routes.audit}${qs({ page: page + 1 })}`} aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className="btn btn-secondary h-8 px-2 opacity-40" aria-hidden>
                <ChevronRight className="h-4 w-4" />
              </span>
            )}
          </div>
        </div>
      </Card>
      <p className="text-[11.5px] text-ink-3">Exports include the most recent 5,000 matching events; the export itself is recorded here.</p>
    </div>
  );
}

/** Human-readable rendering of the most useful detail fields; full JSON on hover. */
function Details({ details }: { details: Record<string, unknown> }) {
  const parts: string[] = [];
  if (typeof details.reason === "string") parts.push(`“${details.reason}”`);
  if (typeof details.from === "string" && typeof details.to === "string") parts.push(`${details.from} → ${details.to}`);
  if (typeof details.filename === "string") parts.push(String(details.filename));
  if (typeof details.rows === "number") parts.push(`${int(details.rows)} rows`);
  if (typeof details.matches === "number") parts.push(`${int(details.matches)} matches · ${int(Number(details.exceptions ?? 0))} exceptions`);
  if (typeof details.format === "string") parts.push(`format ${details.format}`);
  if (typeof details.exported === "number") parts.push(`${int(details.exported)} events${details.truncated ? " (truncated)" : ""}`);
  const full = JSON.stringify(details);
  return (
    <span className="line-clamp-2 break-words" title={full}>
      {parts.length ? parts.join(" · ") : full === "{}" ? "—" : full}
    </span>
  );
}
