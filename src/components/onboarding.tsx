"use client";

import clsx from "clsx";
import { ArrowRight, Building2, Check, FileUp, LayoutDashboard, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { routes } from "@/lib/routes";

function slugify(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

export function Onboarding({ userName, demo }: { userName: string; demo: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"checking" | "workspace" | "start">("checking");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A returning member without an active workspace is attached to their first one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await authClient.organization.list();
      if (cancelled) return;
      if (data && data.length > 0) {
        await authClient.organization.setActive({ organizationId: data[0]!.id });
        if (!cancelled) setStep("start");
      } else setStep("workspace");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function createWorkspace(e: FormEvent) {
    e.preventDefault();
    const name = company.trim();
    if (name.length < 2) return setError("Enter your company or team name.");
    setBusy("create");
    setError(null);
    const { data, error } = await authClient.organization.create({ name: name.slice(0, 80), slug: slugify(name) });
    if (error || !data) {
      setError(error?.message ?? "Could not create the workspace.");
      setBusy(null);
      return;
    }
    await authClient.organization.setActive({ organizationId: data.id });
    setBusy(null);
    setStep("start");
  }

  async function loadDemo() {
    setBusy("demo");
    setError(null);
    try {
      const res = await fetch("/api/runs/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seed: 42, events: 1500 }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load the demo dataset");
      router.replace(routes.reconciliation(body.runId));
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const first = userName.split(" ")[0] || "there";

  return (
    <div className="w-full max-w-2xl">
      <Steps current={step === "start" ? 2 : 1} />
      {step === "checking" && (
        <div className="card flex items-center gap-2 p-8 text-[14px] text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" /> Preparing your workspace…
        </div>
      )}
      {step === "workspace" && (
        <form onSubmit={createWorkspace} className="card p-8">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand">
            <Building2 className="h-5 w-5" />
          </div>
          <h1 className="mt-5 text-[24px] font-semibold tracking-tight">Welcome, {first}. Name your workspace.</h1>
          <p className="mt-2 text-[14px] text-ink-3">A workspace holds your company’s reconciliations, decisions and audit trail. Its data is visible only to its members.</p>
          <label className="mt-6 block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Company or team name</span>
            <input className="input h-10 text-[14px]" autoFocus maxLength={80} placeholder="e.g. Northwind Finance" value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
          {error && <p role="alert" className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</p>}
          <button className="btn btn-primary mt-6 h-10 px-5 text-[14px]" disabled={busy !== null || company.trim().length < 2}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Create workspace
          </button>
        </form>
      )}
      {step === "start" && (
        <div className="card p-8">
          <h1 className="text-[24px] font-semibold tracking-tight">Your workspace is ready. How would you like to start?</h1>
          <p className="mt-2 text-[14px] text-ink-3">You can do both — the demo never mixes with your own data.</p>
          <div className="mt-6 grid gap-3">
            <Choice
              highlight={demo}
              icon={<Sparkles className="h-5 w-5" />}
              title="Explore with demo data"
              body="Reconcile ~1,500 synthetic bank and ledger transactions with fees, splits, payouts, duplicates and mismatches built in."
              action={busy === "demo" ? "Reconciling…" : "Load demo"}
              busy={busy === "demo"}
              disabled={busy !== null}
              onClick={loadDemo}
            />
            <Choice
              highlight={!demo}
              icon={<FileUp className="h-5 w-5" />}
              title="Import my statements"
              body="Upload a bank statement (CSV, Excel or text-based PDF) and a ledger export, then verify and reconcile."
              action="Start import"
              disabled={busy !== null}
              onClick={() => router.push(routes.newReconciliation)}
            />
            <Choice icon={<LayoutDashboard className="h-5 w-5" />} title="Look around first" body="Go to the overview. You can start a reconciliation any time." action="Open overview" disabled={busy !== null} onClick={() => router.push(routes.app)} />
          </div>
          {error && <p role="alert" className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</p>}
        </div>
      )}
    </div>
  );
}

function Steps({ current }: { current: 1 | 2 }) {
  return (
    <ol className="mb-6 flex items-center gap-3 text-[12.5px] font-medium">
      {["Create workspace", "Choose a starting point"].map((label, i) => {
        const n = i + 1;
        const done = n < current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span className={clsx("grid h-6 w-6 place-items-center rounded-full text-[11px]", done ? "bg-ok text-white" : n === current ? "bg-brand text-white" : "bg-neutral-soft text-ink-3")}>{done ? <Check className="h-3.5 w-3.5" /> : n}</span>
            <span className={n === current ? "text-ink" : "text-ink-3"}>{label}</span>
            {n < 2 && <span className="mx-1 h-px w-8 bg-line-strong" />}
          </li>
        );
      })}
    </ol>
  );
}

function Choice({ icon, title, body, action, onClick, disabled, busy, highlight }: { icon: React.ReactNode; title: string; body: string; action: string; onClick: () => void; disabled?: boolean; busy?: boolean; highlight?: boolean }) {
  return (
    <div className={clsx("flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center", highlight ? "border-brand/40 bg-brand-soft/40" : "border-line")}>
      <div className={clsx("grid h-10 w-10 shrink-0 place-items-center rounded-lg", highlight ? "bg-brand text-white" : "bg-neutral-soft text-ink-2")}>{icon}</div>
      <div className="flex-1">
        <div className="text-[15px] font-semibold text-ink">{title}</div>
        <p className="mt-0.5 text-[13px] text-ink-3">{body}</p>
      </div>
      <button className={clsx("btn shrink-0", highlight ? "btn-primary" : "btn-secondary")} onClick={onClick} disabled={disabled}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {action}
      </button>
    </div>
  );
}
