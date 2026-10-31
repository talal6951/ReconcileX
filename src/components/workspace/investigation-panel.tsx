"use client";

import clsx from "clsx";
import { AlertCircle, ArrowLeftRight, BrainCircuit, CheckCircle2, FileSearch, History, Loader2, RotateCcw, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { Investigation } from "@/engine/investigate";
import type { ExceptionDTO, MatchDTO, TxDTO } from "@/lib/dto";
import { dateTime, METHOD_LABEL, money } from "@/lib/format";
import { Badge, ExceptionBadge, FlagChip, StatusBadge } from "../ui";

interface Decision {
  id: number;
  decision: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
  reviewer: string;
  createdAt: string;
}

export type Subject = { kind: "match"; item: MatchDTO } | { kind: "exception"; item: ExceptionDTO };

const SUPPORT_TONE = { strong: "ok", moderate: "info", weak: "neutral" } as const;

export function InvestigationPanel({
  runId,
  subject,
  tx,
  onClose,
  onDecided,
}: {
  runId: string;
  subject: Subject;
  tx: Record<string, TxDTO>;
  onClose: () => void;
  onDecided: (subject: Subject, newStatus: string) => void;
}) {
  const [data, setData] = useState<{ investigation: Investigation; decisions: Decision[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const id = subject.item.id;

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setReason("");
    setActionError(null);
    const q = subject.kind === "match" ? `match=${encodeURIComponent(id)}` : `exception=${encodeURIComponent(id)}`;
    fetch(`/api/runs/${encodeURIComponent(runId)}/investigate?${q}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Investigation failed");
        if (!cancelled) setData(body);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [runId, subject.kind, id, subject.item.status]);

  async function decide(decision: string) {
    setActionError(null);
    if (reason.trim().length < 3) return setActionError("A reason (at least 3 characters) is required for every decision.");
    setBusy(decision);
    try {
      const path = subject.kind === "match" ? `matches/${encodeURIComponent(id)}` : `exceptions/${encodeURIComponent(id)}`;
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Decision failed");
      onDecided(subject, body.to);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const status = subject.item.status;
  const bankIds = subject.item.bankIds, ledgerIds = subject.item.ledgerIds;

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="eyebrow flex items-center gap-1.5">
            <FileSearch className="h-3.5 w-3.5" /> Investigation · {id}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {subject.kind === "match" ? (
              <>
                <StatusBadge status={status} />
                <Badge tone="neutral" dot={false}>{METHOD_LABEL[subject.item.method]}</Badge>
                {subject.item.flags.map((f) => <FlagChip key={f} flag={f} />)}
              </>
            ) : (
              <>
                <ExceptionBadge type={subject.item.type} />
                <Badge tone={status === "open" ? "warn" : "ok"}>{status === "open" ? "Open" : "Resolved"}</Badge>
              </>
            )}
          </div>
        </div>
        <button aria-label="Close panel" onClick={onClose} className="rounded-md p-1.5 text-ink-3 hover:bg-neutral-soft hover:text-ink">
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <Comparison bankIds={bankIds} ledgerIds={ledgerIds} tx={tx} />

        {subject.kind === "match" && subject.item.evidence.contributions && <ModelExplanation match={subject.item} />}

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-bad-soft p-3 text-[13px] text-bad">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}
        {!data && !error && (
          <div className="flex items-center gap-2 text-[13px] text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" /> Examining evidence…
          </div>
        )}
        {data && <Findings inv={data.investigation} />}
        {data && data.decisions.length > 0 && (
          <section>
            <h3 className="eyebrow mb-2 flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" /> Decision history
            </h3>
            <ol className="space-y-2">
              {data.decisions.map((d) => (
                <li key={d.id} className="rounded-lg border border-line p-2.5 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">
                      {d.decision} · {d.fromStatus} → {d.toStatus}
                    </span>
                    <span className="text-ink-3">{dateTime(d.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-ink-2">“{d.reason}”</div>
                  <div className="mt-0.5 text-ink-3">by {d.reviewer}</div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      <footer className="border-t border-line bg-[#FBFAF8] px-5 py-4">
        <div className="mb-2">
          <input className="input" placeholder="Reason for your decision (required, recorded in the audit trail)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Decision reason" maxLength={1000} />
        </div>
        {actionError && <p className="mb-2 text-[12px] text-bad">{actionError}</p>}
        <div className="flex flex-wrap gap-2">
          {subject.kind === "match" ? (
            <>
              {(status === "suggested" || status === "needs_review") && (
                <button className="btn btn-ok" disabled={!!busy} onClick={() => decide("approve")}>
                  {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve match
                </button>
              )}
              {status !== "rejected" && (
                <button className="btn btn-bad" disabled={!!busy} onClick={() => decide("reject")}>
                  {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} {status === "verified" ? "Override & reject" : "Reject"}
                </button>
              )}
              {(status === "approved" || status === "rejected") && (
                <button className="btn btn-secondary" disabled={!!busy} onClick={() => decide("reopen")}>
                  <RotateCcw className="h-4 w-4" /> Reopen
                </button>
              )}
            </>
          ) : status === "open" ? (
            <button className="btn btn-ok" disabled={!!busy} onClick={() => decide("resolve")}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Mark resolved
            </button>
          ) : (
            <button className="btn btn-secondary" disabled={!!busy} onClick={() => decide("reopen")}>
              <RotateCcw className="h-4 w-4" /> Reopen
            </button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-ink-3">Decisions only change reconciliation status. No payments, bank or ledger records are modified.</p>
      </footer>
    </div>
  );
}

function Comparison({ bankIds, ledgerIds, tx }: { bankIds: string[]; ledgerIds: string[]; tx: Record<string, TxDTO> }) {
  const bank = bankIds.map((i) => tx[i]!).filter(Boolean);
  const ledger = ledgerIds.map((i) => tx[i]!).filter(Boolean);
  const total = (rows: TxDTO[]) => rows.reduce((s, t) => s + BigInt(t.amountMinor), 0n);
  const ccy = (bank[0] ?? ledger[0])?.currency ?? "USD";
  const diff = bank.length && ledger.length ? total(bank) - total(ledger) : null;
  const sameCcy = bank.every((b) => ledger.every((l) => l.currency === b.currency));
  return (
    <section>
      <h3 className="eyebrow mb-2 flex items-center gap-1.5">
        <ArrowLeftRight className="h-3.5 w-3.5" /> Record comparison
      </h3>
      <div className="grid gap-2 md:grid-cols-2">
        <Side title="Bank" rows={bank} />
        <Side title="Ledger" rows={ledger} />
      </div>
      {diff !== null && sameCcy && (
        <div className={clsx("tabular mt-2 flex items-center justify-between rounded-lg px-3 py-2 text-[12px]", diff === 0n ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>
          <span className="font-semibold">{diff === 0n ? "Totals agree" : "Difference (bank − ledger)"}</span>
          <span className="font-semibold">
            {money(diff, ccy, { sign: true })} {ccy}
          </span>
        </div>
      )}
    </section>
  );
}

function Side({ title, rows }: { title: string; rows: TxDTO[] }) {
  return (
    <div className="rounded-lg border border-line">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
        {title}
        <span>{rows.length} row{rows.length === 1 ? "" : "s"}</span>
      </div>
      {rows.length === 0 && <div className="px-3 py-3 text-[12px] italic text-ink-3">No counterpart</div>}
      {rows.map((t) => (
        <dl key={t.id} className="grid grid-cols-[78px_1fr] gap-x-2 gap-y-0.5 border-b border-line px-3 py-2 text-[12px] last:border-0">
          <dt className="text-ink-3">Amount</dt>
          <dd className="tabular font-semibold text-ink">
            {money(t.amountMinor, t.currency)} <span className="text-ink-3">{t.currency}</span>
          </dd>
          <dt className="text-ink-3">Date</dt>
          <dd className="tabular">{t.date}</dd>
          {t.reference && (
            <>
              <dt className="text-ink-3">Reference</dt>
              <dd className="font-mono text-[11.5px] break-all">{t.reference}</dd>
            </>
          )}
          {t.description && (
            <>
              <dt className="text-ink-3">Description</dt>
              <dd className="break-words">{t.description}</dd>
            </>
          )}
          {t.counterparty && (
            <>
              <dt className="text-ink-3">Counterparty</dt>
              <dd>{t.counterparty}</dd>
            </>
          )}
          <dt className="text-ink-3">Source</dt>
          <dd className="text-ink-3">
            {t.externalId || "—"} · line {t.sourceLine} · {t.id}
          </dd>
        </dl>
      ))}
    </div>
  );
}

function ModelExplanation({ match }: { match: MatchDTO }) {
  const contribs = (match.evidence.contributions ?? []).filter((c) => Math.abs(c.contribution) >= 0.01).slice(0, 8);
  const max = Math.max(...contribs.map((c) => Math.abs(c.contribution)), 0.01);
  return (
    <section>
      <h3 className="eyebrow mb-2 flex items-center gap-1.5">
        <BrainCircuit className="h-3.5 w-3.5" /> Model explanation
      </h3>
      <div className="rounded-lg border border-line p-3">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-[12px] text-ink-3">Match probability</span>
          <span className="tabular text-[20px] font-semibold text-ink">{(match.score * 100).toFixed(1)}%</span>
        </div>
        <div className="space-y-1.5">
          {contribs.map((c) => (
            <div key={c.feature} className="grid grid-cols-[1fr_120px] items-center gap-2 text-[11.5px]">
              <div className="min-w-0">
                <div className="truncate text-ink-2">{c.label}</div>
                <div className="text-[10.5px] text-ink-3">value {c.value === null ? "not available" : c.value}</div>
              </div>
              <div className="relative h-2 rounded bg-neutral-soft">
                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-line-strong" />
                <div
                  className={clsx("absolute top-0 bottom-0 rounded", c.contribution >= 0 ? "left-1/2 bg-ok" : "right-1/2 bg-bad")}
                  style={{ width: `${(Math.abs(c.contribution) / max) * 50}%` }}
                  title={`${c.contribution > 0 ? "+" : ""}${c.contribution.toFixed(3)} log-odds`}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-ink-3">Bars show each feature’s contribution to the log-odds (green supports the match, red opposes). Model scores are never sufficient for approval.</p>
      </div>
    </section>
  );
}

function Findings({ inv }: { inv: Investigation }) {
  const evidenceById = new Map(inv.evidence.map((e) => [e.id, e]));
  return (
    <section className="space-y-4">
      <div className="rounded-lg bg-night-900 p-3.5 text-white">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#D9C08F]">Automated investigation</div>
        <p className="mt-1 text-[13.5px] font-medium leading-snug">{inv.headline}</p>
      </div>
      <div>
        <h3 className="eyebrow mb-2">Possible explanations</h3>
        {inv.hypotheses.length === 0 && <p className="text-[12.5px] text-ink-3">No explanation is supported by the available evidence.</p>}
        <ul className="space-y-2">
          {inv.hypotheses.map((h, i) => (
            <li key={i} className="rounded-lg border border-line p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink">{h.title}</span>
                <Badge tone={SUPPORT_TONE[h.support]} dot={false}>
                  {h.support} support
                </Badge>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{h.explanation}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {h.evidenceIds.map((eid) => (
                  <span key={eid} className="rounded bg-neutral-soft px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2" title={evidenceById.get(eid)?.text}>
                    {eid}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="eyebrow mb-2">Evidence examined</h3>
        <ul className="space-y-1.5">
          {inv.evidence.map((e) => (
            <li key={e.id} className="flex gap-2 text-[12px] leading-relaxed">
              <span className="mt-0.5 shrink-0 rounded bg-neutral-soft px-1.5 font-mono text-[10.5px] text-ink-2">{e.id}</span>
              <span className="text-ink-2">{e.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg border border-[#E8DCC2] bg-brand-soft p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-brand">Recommended next step</div>
        <p className="mt-1 text-[12.5px] text-ink">{inv.recommendedAction}</p>
      </div>
      <ul className="space-y-1 text-[11.5px] text-ink-3">
        {inv.limitations.map((l, i) => (
          <li key={i}>• {l}</li>
        ))}
      </ul>
    </section>
  );
}
