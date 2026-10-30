"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Download, FileWarning, Loader2, Play, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RowError } from "@/engine/types";
import { int } from "@/lib/format";
import { routes } from "@/lib/routes";
import { Card } from "../ui";
import { SideImport, type ConfirmedSide } from "./side-import";

type ServerErrors = { side: string; problems: string[]; rowErrors: RowError[]; totalRowErrors: number }[];

export function ImportWizard() {
  const router = useRouter();
  const [bank, setBank] = useState<ConfirmedSide | null>(null);
  const [loaded, setLoaded] = useState({ bank: false, ledger: false });
  const [ledger, setLedger] = useState<ConfirmedSide | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<ServerErrors | null>(null);

  async function reconcile() {
    if (!bank || !ledger) return;
    setBusy(true);
    setError(null);
    setServerErrors(null);
    // Send exactly what the server verifies; the display summary stays in the browser.
    const strip = (c: ConfirmedSide) => ({ token: c.token, extraction: c.extraction, mapping: c.mapping, excludedRows: c.excludedRows, confirmed: c.confirmed });
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() || `${bank.summary.filename} vs ${ledger.summary.filename}`, bank: strip(bank), ledger: strip(ledger) }),
      });
      const body = await res.json();
      if (res.ok) {
        router.push(routes.reconciliation(body.runId));
        return;
      }
      if (res.status === 422 && body.validation) setServerErrors(body.validation);
      else setError(body.error ?? "The reconciliation could not be created.");
    } catch {
      setError("Request failed. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <Stepper current={!(loaded.bank && loaded.ledger) ? 0 : !(bank && ledger) ? 1 : 2} />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <SideImport side="bank" onConfirmed={setBank} onLoaded={(v) => setLoaded((l) => ({ ...l, bank: v }))} />
          <SideImport side="ledger" onConfirmed={setLedger} onLoaded={(v) => setLoaded((l) => ({ ...l, ledger: v }))} />
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Card title="Reconcile">
            <ol className="space-y-2 text-[12.5px]">
              <Step done={!!bank} label="Bank statement confirmed" detail={bank && `${int(bank.summary.imported)} rows · ${int(bank.summary.excluded)} excluded`} />
              <Step done={!!ledger} label="Ledger export confirmed" detail={ledger && `${int(ledger.summary.imported)} rows · ${int(ledger.summary.excluded)} excluded`} />
            </ol>
            <label className="mt-4 mb-1 block text-[12px] font-medium text-ink-2">Name</label>
            <input className="input mb-3" placeholder="e.g. Operating account · October" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            <button className="btn btn-primary w-full justify-center" disabled={!bank || !ledger || busy} onClick={reconcile}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {busy ? "Reconciling…" : "Import & reconcile"}
            </button>
            {(!bank || !ledger) && (
              <p className="mt-2 rounded-md bg-neutral-soft px-2.5 py-2 text-[12px] text-ink-2" role="status">
                To continue: {[!bank && "confirm the bank statement", !ledger && "confirm the ledger export"].filter(Boolean).join(" and ")} (tick the box at the bottom of each).
              </p>
            )}
            <p className="mt-2 text-[11px] text-ink-3">The server re-checks both confirmed previews before saving. Nothing changes in your bank or ledger.</p>
            {error && <p className="mt-2 rounded-md bg-bad-soft p-2 text-[12px] text-bad">{error}</p>}
            {serverErrors && (
              <div className="mt-3 rounded-lg bg-bad-soft p-3 text-[12px] text-bad">
                <div className="mb-1 flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-4 w-4" /> Import rejected — nothing was saved
                </div>
                {serverErrors.map((e) => (
                  <div key={e.side} className="mt-1">
                    <div className="font-semibold capitalize">{e.side}</div>
                    <ul className="ml-4 list-disc">
                      {e.problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                      {e.rowErrors.slice(0, 5).map((r, i) => (
                        <li key={i}>{r.message}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="What can be imported">
            <ul className="space-y-2 text-[12px] text-ink-2">
              <li>
                <b className="text-ink">CSV</b> — UTF-8, one header row.
              </li>
              <li>
                <b className="text-ink">Excel .xlsx</b> — first table on the chosen sheet; title rows above it are skipped.
              </li>
              <li>
                <b className="text-ink">Text-based PDF</b> — statements with a header row such as Date · Description · Debit · Credit · Balance.
              </li>
            </ul>
            <div className="mt-3 flex gap-2 rounded-lg bg-warn-soft p-2.5 text-[11.5px] text-ink-2">
              <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <span>
                Not supported: scanned/image PDFs (no OCR — amounts could be misread), password-protected PDFs, legacy <b>.xls</b> (save as .xlsx or CSV), and macro workbooks.
              </span>
            </div>
          </Card>

          <Card title="Try with synthetic files" subtitle="Generated demo data — no real accounts">
            <div className="space-y-1.5 text-[12.5px]">
              {[
                ["bank-pdf", "Bank statement (PDF)"],
                ["bank-xlsx", "Bank statement (Excel)"],
                ["ledger-csv", "Matching ledger (CSV)"],
              ].map(([f, l]) => (
                <a key={f} className="flex items-center gap-2 font-medium text-brand hover:underline" href={`/api/imports/sample?file=${f}&seed=42&events=400`}>
                  <Download className="h-3.5 w-3.5" /> {l}
                </a>
              ))}
            </div>
            <DemoShortcut />
          </Card>
        </aside>
      </div>
    </div>
  );
}

/** Upload → Review → Results. "Results" is reached when both sides are confirmed and ready to reconcile. */
function Stepper({ current }: { current: 0 | 1 | 2 }) {
  const steps = [
    { title: "Upload", body: "Bank statement and ledger" },
    { title: "Review", body: "Check and confirm each file" },
    { title: "Results", body: "Reconcile and approve" },
  ];
  return (
    <ol className="grid grid-cols-3 gap-2 rounded-2xl border border-line bg-white p-2 shadow-[var(--shadow-card)]" aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={s.title} aria-current={state === "current" ? "step" : undefined} className={clsx("flex items-center gap-3 rounded-xl px-3 py-2.5", state === "current" && "bg-brand-soft")}>
            <span
              className={clsx(
                "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold",
                state === "done" ? "bg-ok text-white" : state === "current" ? "bg-brand text-white" : "bg-neutral-soft text-ink-3",
              )}
            >
              {state === "done" ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={clsx("block text-[13.5px] font-semibold", state === "todo" ? "text-ink-3" : "text-ink")}>{s.title}</span>
              <span className="hidden truncate text-[11.5px] text-ink-3 sm:block">{s.body}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Step({ done, label, detail }: { done: boolean; label: string; detail?: string | null }) {
  return (
    <li className={clsx("flex items-start gap-2", done ? "text-ok" : "text-ink-3")}>
      {done ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <span className="mt-0.5 h-4 w-4 rounded-full border border-line-strong" />}
      <span>
        <span className="font-medium">{label}</span>
        {detail && <span className="block text-[11px] text-ink-3">{detail}</span>}
      </span>
    </li>
  );
}

function DemoShortcut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/runs/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seed: 42, events: 1500 }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Demo failed");
      router.push(routes.reconciliation(body.runId));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 border-t border-line pt-3">
      <button className="btn btn-secondary w-full justify-center" disabled={busy} onClick={run}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Skip import · load full demo
      </button>
      {error && <p className="mt-1 text-[12px] text-bad">{error}</p>}
    </div>
  );
}
