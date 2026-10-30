"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DemoButton({ seed = 42, events = 1500, label = "Run demo reconciliation" }: { seed?: number; events?: number; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/runs/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seed, events }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Demo run failed");
      router.push(`/app/reconciliations/${body.runId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button className="btn btn-primary" onClick={run} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {busy ? "Reconciling…" : label}
      </button>
      {error && <p className="text-[12px] text-bad">{error}</p>}
    </div>
  );
}
