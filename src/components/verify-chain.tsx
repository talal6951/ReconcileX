"use client";

import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";

/** Recomputes the workspace's audit hash chain on the server and shows the result. */
export function VerifyChain() {
  const [state, setState] = useState<{ ok: boolean; events: number; brokenAt: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/audit/verify", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Verification failed");
      setState(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button className="btn btn-secondary" onClick={verify} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Verify integrity
      </button>
      {state && state.ok && (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ok">
          <ShieldCheck className="h-4 w-4" /> Chain intact · {state.events.toLocaleString("en-US")} events verified
        </span>
      )}
      {state && !state.ok && (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-bad">
          <ShieldAlert className="h-4 w-4" /> Chain broken at event #{state.brokenAt} — history may have been altered
        </span>
      )}
      {error && <span className="text-[12.5px] text-bad">{error}</span>}
    </div>
  );
}
