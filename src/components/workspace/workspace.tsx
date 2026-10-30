"use client";

import clsx from "clsx";
import { ArrowDownUp, ChevronLeft, ChevronRight, Download, FileText, Link2, Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExceptionDTO, MatchDTO, TxDTO, WorkspaceDTO } from "@/lib/dto";
import { dateTime, EXCEPTION_LABEL, int, METHOD_LABEL, money, ms, pct } from "@/lib/format";
import { ExceptionBadge, FlagChip, Kpi, PageHeader, StatusBadge } from "../ui";
import { InsightsPanel } from "./insights-panel";
import { InvestigationPanel, type Subject } from "./investigation-panel";

export type Tab = "review" | "matches" | "exceptions" | "insights";
type SortKey = "id" | "amount" | "score" | "date" | "diff";
const PAGE = 50;

const abs = (v: bigint) => (v < 0n ? -v : v);

export function Workspace({ runId, initialTab = "review", initialExceptionType }: { runId: string; initialTab?: Tab; initialExceptionType?: string }) {
  const [data, setData] = useState<WorkspaceDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [method, setMethod] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [excType, setExcType] = useState(initialExceptionType && initialExceptionType in EXCEPTION_LABEL ? initialExceptionType : "all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "id", dir: 1 });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Subject | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/workspace`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load run");
      setData(body);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => setPage(0), [tab, query, status, method, currency, excType, sort]);

  const tx = useMemo(() => data?.transactions ?? {}, [data]);
  const q = query.trim().toLowerCase();

  const textOf = useCallback(
    (ids: string[]) =>
      ids
        .map((i) => tx[i])
        .filter(Boolean)
        .map((t) => `${t!.id} ${t!.externalId} ${t!.reference} ${t!.description} ${t!.counterparty} ${t!.date} ${money(t!.amountMinor, t!.currency)} ${t!.amountMinor}`)
        .join(" ")
        .toLowerCase(),
    [tx],
  );

  const matches = useMemo(() => {
    if (!data) return [];
    let rows = data.matches;
    if (tab === "review") rows = rows.filter((m) => m.status === "suggested" || m.status === "needs_review");
    if (status !== "all") rows = rows.filter((m) => m.status === status);
    if (method !== "all") rows = rows.filter((m) => m.method === method);
    if (currency !== "all") rows = rows.filter((m) => m.currency === currency);
    if (q) rows = rows.filter((m) => m.id.toLowerCase().includes(q) || textOf([...m.bankIds, ...m.ledgerIds]).includes(q));
    const key = (m: MatchDTO): bigint | number | string => {
      switch (sort.key) {
        case "amount":
          return abs(BigInt(m.bankTotalMinor));
        case "score":
          return m.score;
        case "diff":
          return abs(BigInt(m.bankTotalMinor) - BigInt(m.ledgerTotalMinor));
        case "date":
          return tx[m.bankIds[0]!]?.date ?? "";
        default:
          return m.id;
      }
    };
    return [...rows].sort((a, b) => {
      const ka = key(a),
        kb = key(b);
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * sort.dir;
    });
  }, [data, tab, status, method, currency, q, sort, textOf, tx]);

  const exceptions = useMemo(() => {
    if (!data) return [];
    let rows = data.exceptions;
    if (excType !== "all") rows = rows.filter((e) => e.type === excType);
    if (status !== "all") rows = rows.filter((e) => e.status === status);
    if (currency !== "all") rows = rows.filter((e) => e.currency === currency);
    if (q) rows = rows.filter((e) => e.id.toLowerCase().includes(q) || e.message.toLowerCase().includes(q) || textOf([...e.bankIds, ...e.ledgerIds]).includes(q));
    const key = (e: ExceptionDTO): bigint | string =>
      sort.key === "amount" || sort.key === "diff" ? BigInt(e.exposureMinor) : sort.key === "date" ? (tx[e.bankIds[0] ?? e.ledgerIds[0]!]?.date ?? "") : e.id;
    return [...rows].sort((a, b) => {
      const ka = key(a),
        kb = key(b);
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * sort.dir;
    });
  }, [data, excType, status, currency, q, sort, textOf, tx]);

  if (error) return <div className="card p-6 text-[13px] text-bad">{error}</div>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 p-6 text-[13px] text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading reconciliation…
      </div>
    );
  }

  const s = data.summary;
  const p = s.progress;
  const currencies = [...new Set([...data.matches.map((m) => m.currency), ...data.exceptions.map((e) => e.currency)])].sort();
  const list = tab === "exceptions" ? exceptions : matches;
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const slice = list.slice(page * PAGE, page * PAGE + PAGE);
  const reviewCount = data.matches.filter((m) => m.status === "suggested" || m.status === "needs_review").length;
  const openExc = data.exceptions.filter((e) => e.status === "open").length;

  function onDecided(subject: Subject, newStatus: string) {
    if (subject.kind === "match") {
      const item: MatchDTO = { ...subject.item, status: newStatus as MatchDTO["status"] };
      setData((d) => d && { ...d, matches: d.matches.map((m) => (m.id === item.id ? item : m)) });
      setSelected({ kind: "match", item });
    } else {
      const item: ExceptionDTO = { ...subject.item, status: newStatus as ExceptionDTO["status"] };
      setData((d) => d && { ...d, exceptions: d.exceptions.map((e) => (e.id === item.id ? item : e)) });
      setSelected({ kind: "exception", item });
    }
    // Refresh summary counters from the server (source of truth).
    load();
  }

  const exportHref = (format: string) => `/api/runs/${encodeURIComponent(runId)}/export?format=${format}`;
  const toggleSort = (key: SortKey) => setSort((cur) => ({ key, dir: cur.key === key ? (-cur.dir as 1 | -1) : key === "id" || key === "date" ? 1 : -1 }));

  return (
    <div className={clsx(selected && "xl:pr-[500px]")}>
      <PageHeader
        eyebrow={`Reconciliation workspace · ${s.id}`}
        title={s.name}
        description={
          <>
            {s.bankFile} ↔ {s.ledgerFile} · {dateTime(s.createdAt)} · {s.createdBy} · processed in {ms(s.metrics.totalMs)} · model {s.modelVersion}
          </>
        }
        actions={
          <>
            <div className="group relative">
              <button className="btn btn-secondary">
                <Download className="h-4 w-4" /> Export
              </button>
              <div className="invisible absolute right-0 z-20 mt-1 w-56 rounded-lg border border-line bg-white p-1 opacity-0 shadow-[var(--shadow-pop)] transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                {[
                  ["matches", "Matches (CSV)"],
                  ["exceptions", "Exceptions (CSV)"],
                  ["decisions", "Review decisions (CSV)"],
                  ["audit", "Audit trail (CSV)"],
                  ["json", "Full report (JSON)"],
                ].map(([f, l]) => (
                  <a key={f} href={exportHref(f!)} className="block rounded-md px-3 py-2 text-[13px] text-ink-2 hover:bg-neutral-soft hover:text-ink">
                    {l}
                  </a>
                ))}
              </div>
            </div>
            <Link className="btn btn-primary" href={`/app/reconciliations/${runId}/report`}>
              <FileText className="h-4 w-4" /> Report
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Verified" value={int(p.verified)} sub={`${pct(s.metrics.autoVerifiedRate)} of bank rows`} />
        <Kpi label="Approved" value={int(p.approved)} sub="by reviewers" />
        <Kpi label="Pending review" value={int(p.pending)} sub={`${int(s.metrics.splitMatches)} split/aggregate`} />
        <Kpi label="Rejected" value={int(p.rejected)} sub="returned to unmatched" />
        <Kpi label="Open exceptions" value={int(p.openExceptions)} sub={`${int(p.resolvedExceptions)} resolved`} />
        <Kpi label="Rows" value={int(s.metrics.bankCount + s.metrics.ledgerCount)} sub={`${int(s.metrics.candidatePairsScored)} pairs scored`} />
      </div>

      <div className="card mt-4">
        <div className="flex flex-col gap-3 border-b border-line px-4 pt-3 md:flex-row md:items-end md:justify-between">
          <nav className="-mb-px flex gap-5 overflow-x-auto">
            {(
              [
                ["review", "Review queue", reviewCount],
                ["matches", "All matches", data.matches.length],
                ["exceptions", "Exceptions", openExc],
                ["insights", "Insights", null],
              ] as [Tab, string, number | null][]
            ).map(([t, label, n]) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setStatus("all");
                }}
                className={clsx(
                  "flex items-center gap-2 border-b-2 pb-2.5 text-[13px] font-semibold whitespace-nowrap",
                  tab === t ? "border-brand text-ink" : "border-transparent text-ink-3 hover:text-ink",
                )}
              >
                {label}
                {n !== null && <span className={clsx("tabular rounded-full px-1.5 text-[11px]", tab === t ? "bg-brand-soft text-brand" : "bg-neutral-soft text-ink-3")}>{int(n)}</span>}
              </button>
            ))}
          </nav>
          <div className={clsx("flex flex-wrap items-center gap-2 pb-3", tab === "insights" && "hidden")}>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-ink-3" />
              <input className="input pl-8" placeholder="Search ID, reference, amount…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
            </div>
            {tab !== "exceptions" ? (
              <>
                <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
                  <option value="all">All statuses</option>
                  {(tab === "review" ? ["suggested", "needs_review"] : ["verified", "suggested", "needs_review", "approved", "rejected"]).map((v) => (
                    <option key={v} value={v}>
                      {v.replace("_", " ")}
                    </option>
                  ))}
                </select>
                <select className="input w-auto" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method filter">
                  <option value="all">All methods</option>
                  {Object.entries(METHOD_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <select className="input w-auto" value={excType} onChange={(e) => setExcType(e.target.value)} aria-label="Exception type filter">
                  <option value="all">All types</option>
                  {Object.entries(EXCEPTION_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Exception status filter">
                  <option value="all">Open & resolved</option>
                  <option value="open">Open</option>
                  <option value="resolved">Resolved</option>
                </select>
              </>
            )}
            <select className="input w-auto" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency filter">
              <option value="all">All currencies</option>
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {tab === "insights" ? (
          <InsightsPanel runId={runId} tx={tx} />
        ) : (
          <>
            <div className="overflow-x-auto">
              {tab === "exceptions" ? (
                <ExceptionTable
                  rows={slice as ExceptionDTO[]}
                  tx={tx}
                  selectedId={selected?.item.id}
                  onSelect={(e) => setSelected({ kind: "exception", item: e })}
                  sort={sort}
                  toggleSort={toggleSort}
                />
              ) : (
                <MatchTable rows={slice as MatchDTO[]} tx={tx} selectedId={selected?.item.id} onSelect={(m) => setSelected({ kind: "match", item: m })} sort={sort} toggleSort={toggleSort} />
              )}
              {list.length === 0 && <div className="px-4 py-12 text-center text-[13px] text-ink-3">{tab === "review" && !q ? "The review queue is empty." : "No rows match the current filters."}</div>}
            </div>

            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
              <span className="tabular">{list.length ? `${int(page * PAGE + 1)}–${int(Math.min(list.length, (page + 1) * PAGE))} of ${int(list.length)}` : "0 rows"}</span>
              <div className="flex items-center gap-1">
                <button className="btn btn-secondary h-8 px-2" disabled={page === 0} onClick={() => setPage((x) => x - 1)} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="tabular px-2">
                  {page + 1} / {pages}
                </span>
                <button className="btn btn-secondary h-8 px-2" disabled={page >= pages - 1} onClick={() => setPage((x) => x + 1)} aria-label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {selected && (
        <>
          <div className="fixed inset-0 z-30 bg-black/30 xl:hidden" onClick={() => setSelected(null)} />
          <aside className="fixed inset-y-0 right-0 z-40 w-full border-l border-line shadow-[var(--shadow-pop)] sm:w-[500px]">
            <InvestigationPanel runId={runId} subject={selected} tx={tx} onClose={() => setSelected(null)} onDecided={onDecided} />
          </aside>
        </>
      )}
    </div>
  );
}

function SortHead({ label, k, sort, toggleSort, className }: { label: string; k: SortKey; sort: { key: SortKey; dir: number }; toggleSort: (k: SortKey) => void; className?: string }) {
  return (
    <th className={clsx("px-3 py-2.5 font-semibold", className)}>
      <button onClick={() => toggleSort(k)} className={clsx("inline-flex items-center gap-1 uppercase hover:text-ink", sort.key === k && "text-ink")}>
        {label}
        <ArrowDownUp className={clsx("h-3 w-3", sort.key === k ? "opacity-100" : "opacity-30")} />
      </button>
    </th>
  );
}

function TxCell({ ids, tx, align = "left" }: { ids: string[]; tx: Record<string, TxDTO>; align?: "left" | "right" }) {
  if (ids.length === 0) return <span className="text-[12px] italic text-ink-3">—</span>;
  const first = tx[ids[0]!];
  if (!first) return null;
  return (
    <div className={clsx("min-w-0", align === "right" && "text-right")}>
      <div className="truncate text-[12.5px] font-medium text-ink" title={first.description || first.reference}>
        {ids.length > 1 ? `${ids.length} transactions` : first.description || first.reference || first.externalId}
      </div>
      <div className="truncate text-[11.5px] text-ink-3">
        {first.date}
        {ids.length === 1 && first.reference ? ` · ${first.reference}` : ""}
        {ids.length > 1
          ? ` · ${ids
              .map((i) => tx[i]?.date)
              .filter(Boolean)
              .sort()
              .at(-1)}`
          : ""}
      </div>
    </div>
  );
}

function MatchTable({
  rows,
  tx,
  selectedId,
  onSelect,
  sort,
  toggleSort,
}: {
  rows: MatchDTO[];
  tx: Record<string, TxDTO>;
  selectedId?: string;
  onSelect: (m: MatchDTO) => void;
  sort: { key: SortKey; dir: number };
  toggleSort: (k: SortKey) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <table className="w-full min-w-[980px] text-[13px]">
      <thead>
        <tr className="border-b border-line text-left text-[11px] tracking-wide text-ink-3">
          <SortHead label="Match" k="id" sort={sort} toggleSort={toggleSort} />
          <th className="px-3 py-2.5 font-semibold uppercase">Bank</th>
          <SortHead label="Bank amount" k="amount" sort={sort} toggleSort={toggleSort} className="text-right" />
          <SortHead label="Score" k="score" sort={sort} toggleSort={toggleSort} className="text-center" />
          <th className="px-3 py-2.5 font-semibold uppercase">Ledger</th>
          <th className="px-3 py-2.5 text-right font-semibold uppercase">Ledger amount</th>
          <SortHead label="Δ" k="diff" sort={sort} toggleSort={toggleSort} className="text-right" />
          <th className="px-3 py-2.5 font-semibold uppercase">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const diff = BigInt(m.bankTotalMinor) - BigInt(m.ledgerTotalMinor);
          return (
            <tr key={m.id} onClick={() => onSelect(m)} className={clsx("row-hover cursor-pointer border-b border-line last:border-0", selectedId === m.id && "!bg-brand-soft/60")}>
              <td className="px-3 py-2.5 align-top">
                <div className="font-mono text-[12px] font-semibold text-ink">{m.id}</div>
                <div className="text-[11px] text-ink-3">{METHOD_LABEL[m.method]}</div>
              </td>
              <td className="max-w-[240px] px-3 py-2.5 align-top">
                <TxCell ids={m.bankIds} tx={tx} />
              </td>
              <td className="tabular px-3 py-2.5 text-right align-top font-medium">
                {money(m.bankTotalMinor, m.currency)} <span className="text-[11px] text-ink-3">{m.currency}</span>
              </td>
              <td className="px-3 py-2.5 text-center align-top">
                <div className="inline-flex items-center gap-1 text-ink-3">
                  <Link2 className="h-3.5 w-3.5" />
                  <span className={clsx("tabular text-[12px] font-semibold", m.score >= 0.9 ? "text-ok" : m.score >= 0.7 ? "text-info" : "text-warn")}>
                    {m.status === "verified" ? "rule" : `${Math.round(m.score * 100)}%`}
                  </span>
                </div>
              </td>
              <td className="max-w-[240px] px-3 py-2.5 align-top">
                <TxCell ids={m.ledgerIds} tx={tx} />
              </td>
              <td className="tabular px-3 py-2.5 text-right align-top font-medium">{money(m.ledgerTotalMinor, m.currency)}</td>
              <td className={clsx("tabular px-3 py-2.5 text-right align-top", diff === 0n ? "text-ink-3" : "font-semibold text-warn")}>
                {diff === 0n ? "0" : money(diff, m.currency, { sign: true })}
              </td>
              <td className="px-3 py-2.5 align-top">
                <div className="flex flex-wrap items-center gap-1">
                  <StatusBadge status={m.status} />
                  {m.flags
                    .filter((f) => f !== "low_confidence" || m.status !== "verified")
                    .map((f) => (
                      <FlagChip key={f} flag={f} />
                    ))}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ExceptionTable({
  rows,
  tx,
  selectedId,
  onSelect,
  sort,
  toggleSort,
}: {
  rows: ExceptionDTO[];
  tx: Record<string, TxDTO>;
  selectedId?: string;
  onSelect: (e: ExceptionDTO) => void;
  sort: { key: SortKey; dir: number };
  toggleSort: (k: SortKey) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <table className="w-full min-w-[900px] text-[13px]">
      <thead>
        <tr className="border-b border-line text-left text-[11px] tracking-wide text-ink-3">
          <SortHead label="Exception" k="id" sort={sort} toggleSort={toggleSort} />
          <th className="px-3 py-2.5 font-semibold uppercase">Type</th>
          <th className="px-3 py-2.5 font-semibold uppercase">Records</th>
          <SortHead label="Date" k="date" sort={sort} toggleSort={toggleSort} />
          <SortHead label="Exposure" k="amount" sort={sort} toggleSort={toggleSort} className="text-right" />
          <th className="px-3 py-2.5 font-semibold uppercase">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => {
          const first = tx[e.bankIds[0] ?? e.ledgerIds[0]!];
          return (
            <tr key={e.id} onClick={() => onSelect(e)} className={clsx("row-hover cursor-pointer border-b border-line last:border-0", selectedId === e.id && "!bg-brand-soft/60")}>
              <td className="px-3 py-2.5 align-top font-mono text-[12px] font-semibold">{e.id}</td>
              <td className="px-3 py-2.5 align-top">
                <ExceptionBadge type={e.type} />
              </td>
              <td className="max-w-[420px] px-3 py-2.5 align-top">
                <div className="truncate text-[12.5px] text-ink">{e.message}</div>
                <div className="truncate text-[11.5px] text-ink-3">
                  {[...e.bankIds, ...e.ledgerIds].slice(0, 4).join(", ")}
                  {first?.description ? ` · ${first.description}` : ""}
                </div>
              </td>
              <td className="tabular px-3 py-2.5 align-top text-[12px] text-ink-2">{first?.date}</td>
              <td className="tabular px-3 py-2.5 text-right align-top font-medium">
                {money(e.exposureMinor, e.currency)} <span className="text-[11px] text-ink-3">{e.currency}</span>
              </td>
              <td className="px-3 py-2.5 align-top">
                <span className={clsx("text-[12px] font-semibold", e.status === "open" ? "text-warn" : "text-ok")}>{e.status === "open" ? "Open" : "Resolved"}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
