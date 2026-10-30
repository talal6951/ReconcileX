"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Play, Sparkles, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { normalizeRows, parseCsv, suggestMapping, validateMapping } from "@/engine/csv";
import { DATE_FORMATS, detectDateFormats, type DateFormat } from "@/engine/dates";
import { CURRENCY_EXPONENTS } from "@/engine/money";
import type { ColumnMapping, RowError, Side } from "@/engine/types";
import { int } from "@/lib/format";
import { Card } from "./ui";

const MAX_BYTES = 15 * 1024 * 1024;

interface SideState {
  filename: string;
  text: string;
  headers: string[];
  rows: string[][];
  parseErrors: RowError[];
  mapping: Partial<ColumnMapping>;
  dateCandidates: DateFormat[];
  dateConfirmed: boolean;
}

const FIELDS: { key: keyof ColumnMapping; label: string; hint?: string }[] = [
  { key: "date", label: "Date", hint: "required" },
  { key: "amount", label: "Amount (signed)", hint: "or debit/credit" },
  { key: "debit", label: "Debit" },
  { key: "credit", label: "Credit" },
  { key: "currency", label: "Currency", hint: "or default below" },
  { key: "reference", label: "Reference" },
  { key: "description", label: "Description" },
  { key: "externalId", label: "Transaction ID" },
  { key: "counterparty", label: "Counterparty" },
];

function fromFile(filename: string, text: string): SideState {
  const parsed = parseCsv(text);
  const sug = suggestMapping(parsed.headers, parsed.rows);
  return {
    filename,
    text,
    headers: parsed.headers,
    rows: parsed.rows,
    parseErrors: parsed.errors,
    mapping: sug.mapping,
    dateCandidates: sug.dateFormats,
    // An ambiguous format (e.g. DD/MM vs MM/DD) must be confirmed by the user.
    dateConfirmed: sug.dateFormats.length === 1,
  };
}

export function NewRun() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sides, setSides] = useState<Record<Side, SideState | null>>({ bank: null, ledger: null });
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<{ side: string; problems: string[]; rowErrors: RowError[]; totalRowErrors: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useMemo(() => {
    const out: Record<Side, { problems: string[]; rowErrors: RowError[]; rowsOk: number } | null> = { bank: null, ledger: null };
    for (const side of ["bank", "ledger"] as const) {
      const s = sides[side];
      if (!s) continue;
      const problems = validateMapping(s.headers, s.mapping);
      if (!s.dateConfirmed && s.dateCandidates.length > 1) problems.push(`Date format is ambiguous (${s.dateCandidates.join(" or ")}); confirm it`);
      if (s.dateCandidates.length === 0 && s.mapping.date) problems.push("No supported date format fits every value in the date column");
      let rowErrors = s.parseErrors;
      let rowsOk = 0;
      if (problems.length === 0 && s.parseErrors.length === 0) {
        const norm = normalizeRows(side, s.headers, s.rows, s.mapping as ColumnMapping);
        rowErrors = norm.errors;
        rowsOk = norm.transactions.length;
      }
      out[side] = { problems, rowErrors, rowsOk };
    }
    return out;
  }, [sides]);

  const ready = (["bank", "ledger"] as const).every((s) => sides[s] && check[s] && check[s]!.problems.length === 0 && check[s]!.rowErrors.length === 0);

  async function submit() {
    setBusy(true);
    setError(null);
    setServerErrors(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name || `${sides.bank!.filename} vs ${sides.ledger!.filename}`,
          bank: { filename: sides.bank!.filename, csv: sides.bank!.text, mapping: sides.bank!.mapping },
          ledger: { filename: sides.ledger!.filename, csv: sides.ledger!.text, mapping: sides.ledger!.mapping },
        }),
      });
      const body = await res.json();
      if (res.status === 422) setServerErrors(body.validation);
      else if (!res.ok) throw new Error(body.error ?? "Reconciliation failed");
      else {
        router.push(`/app/reconciliations/${body.runId}`);
        return;
      }
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          {(["bank", "ledger"] as const).map((side) => (
            <SidePanel key={side} side={side} state={sides[side]} check={check[side]} onChange={(s) => setSides((cur) => ({ ...cur, [side]: s }))} />
          ))}
        </div>
        {serverErrors && (
          <div className="card border-bad/30 p-4">
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-bad">
              <AlertTriangle className="h-4 w-4" /> Server validation rejected the import
            </h3>
            {serverErrors.map((e) => (
              <div key={e.side} className="mt-2 text-[12.5px]">
                <div className="font-semibold capitalize">{e.side}</div>
                <ul className="ml-4 list-disc text-ink-2">
                  {e.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                  {e.rowErrors.slice(0, 10).map((r, i) => (
                    <li key={i}>
                      Line {r.line}
                      {r.column ? ` (${r.column})` : ""}: {r.message}
                    </li>
                  ))}
                </ul>
                {e.totalRowErrors > 10 && <div className="text-ink-3">…and {int(e.totalRowErrors - 10)} more row errors</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <Card title="Run reconciliation">
          <label className="mb-1 block text-[12px] font-medium text-ink-2">Name</label>
          <input className="input mb-3" placeholder="e.g. Operating account · October" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          <p className="mb-4 text-[11px] text-ink-3">The run is recorded under your account in this workspace’s audit trail.</p>
          <ul className="mb-4 space-y-1.5 text-[12px]">
            {(["bank", "ledger"] as const).map((s) => {
              const ok = sides[s] && check[s] && check[s]!.problems.length === 0 && check[s]!.rowErrors.length === 0;
              return (
                <li key={s} className={clsx("flex items-center gap-2", ok ? "text-ok" : "text-ink-3")}>
                  {ok ? <CheckCircle2 className="h-4 w-4" /> : <span className="h-4 w-4 rounded-full border border-line-strong" />}
                  <span className="capitalize">{s}</span> file {ok ? `valid · ${int(check[s]!.rowsOk)} rows` : sides[s] ? "needs attention" : "not loaded"}
                </li>
              );
            })}
          </ul>
          <button className="btn btn-primary w-full justify-center" disabled={!ready || busy} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {busy ? "Reconciling…" : "Reconcile"}
          </button>
          {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
        </Card>
        <DemoCard />
      </div>
    </div>
  );
}

function SidePanel({ side, state, check, onChange }: { side: Side; state: SideState | null; check: { problems: string[]; rowErrors: RowError[]; rowsOk: number } | null; onChange: (s: SideState | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function load(file: File) {
    setFileError(null);
    if (file.size > MAX_BYTES) return setFileError("File exceeds 15 MB");
    if (!/\.(csv|txt)$/i.test(file.name)) return setFileError("Please choose a .csv file");
    onChange(fromFile(file.name, await file.text()));
  }

  const setMap = (patch: Partial<ColumnMapping>) => state && onChange({ ...state, mapping: { ...state.mapping, ...patch } });
  const mapped = new Set(Object.entries(state?.mapping ?? {}).filter(([k]) => FIELDS.some((f) => f.key === k)).map(([, v]) => v as string));

  return (
    <Card title={side === "bank" ? "Bank statement" : "Internal ledger"} subtitle={state ? `${state.filename} · ${int(state.rows.length)} rows · ${state.headers.length} columns` : "CSV export"} actions={state && <button className="text-[12px] font-semibold text-ink-3 hover:text-ink" onClick={() => onChange(null)}>Clear</button>}>
      {!state ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) load(f);
          }}
          className={clsx("flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-10 text-center transition", drag ? "border-brand bg-brand-soft" : "border-line-strong")}
        >
          <FileSpreadsheet className="h-8 w-8 text-ink-3" />
          <p className="mt-2 text-[13px] text-ink-2">Drop a CSV here or</p>
          <button className="btn btn-secondary mt-2" onClick={() => input.current?.click()}>
            <Upload className="h-4 w-4" /> Choose file
          </button>
          <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          {fileError && <p className="mt-2 text-[12px] text-bad">{fileError}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="text-[12px]">
                <span className="mb-0.5 flex justify-between text-ink-2">
                  {f.label} {f.hint && <span className="text-ink-3">{f.hint}</span>}
                </span>
                <select
                  className="input h-8"
                  value={(state.mapping[f.key] as string) ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || undefined;
                    const patch: Partial<ColumnMapping> = { [f.key]: v };
                    if (f.key === "date" && v) {
                      const idx = state.headers.indexOf(v);
                      const cands = detectDateFormats(state.rows.slice(0, 500).map((r) => r[idx] ?? ""));
                      onChange({ ...state, mapping: { ...state.mapping, ...patch, dateFormat: cands[0] }, dateCandidates: cands, dateConfirmed: cands.length === 1 });
                      return;
                    }
                    setMap(patch);
                  }}
                >
                  <option value="">—</option>
                  {state.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-line pt-3 sm:grid-cols-4">
            <label className="text-[12px]">
              <span className="mb-0.5 block text-ink-2">Date format</span>
              <select
                className={clsx("input h-8", !state.dateConfirmed && state.dateCandidates.length > 1 && "border-warn")}
                value={state.mapping.dateFormat ?? ""}
                onChange={(e) => onChange({ ...state, mapping: { ...state.mapping, dateFormat: e.target.value as DateFormat }, dateConfirmed: true })}
              >
                {!state.mapping.dateFormat && <option value="">—</option>}
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f} disabled={state.dateCandidates.length > 0 && !state.dateCandidates.includes(f)}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px]">
              <span className="mb-0.5 block text-ink-2">Decimal</span>
              <select className="input h-8" value={state.mapping.decimalSeparator ?? "."} onChange={(e) => setMap({ decimalSeparator: e.target.value as "." | "," })}>
                <option value=".">1,234.56</option>
                <option value=",">1.234,56</option>
              </select>
            </label>
            <label className="text-[12px]">
              <span className="mb-0.5 block text-ink-2">Default currency</span>
              <select className="input h-8" value={state.mapping.defaultCurrency ?? ""} onChange={(e) => setMap({ defaultCurrency: e.target.value || undefined })} disabled={!!state.mapping.currency}>
                <option value="">—</option>
                {Object.keys(CURRENCY_EXPONENTS).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-1.5 text-[12px] text-ink-2">
              <input type="checkbox" checked={!!state.mapping.invertSign} onChange={(e) => setMap({ invertSign: e.target.checked })} />
              Invert signs
            </label>
          </div>
          {!state.dateConfirmed && state.dateCandidates.length > 1 && (
            <p className="rounded-md bg-warn-soft px-2.5 py-1.5 text-[12px] text-warn">
              Dates fit both {state.dateCandidates.join(" and ")}. Select the correct format — Reconcile X will not guess.
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="bg-[#f8fafc]">
                  {state.headers.map((h) => (
                    <th key={h} className={clsx("px-2 py-1.5 text-left font-semibold whitespace-nowrap", mapped.has(h) ? "text-brand" : "text-ink-3")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {state.rows.slice(0, 4).map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    {r.map((c, j) => (
                      <td key={j} className="max-w-[160px] truncate px-2 py-1 whitespace-nowrap text-ink-2">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {check && (check.problems.length > 0 || check.rowErrors.length > 0) ? (
            <div className="rounded-lg bg-bad-soft p-3 text-[12px] text-bad">
              <div className="mb-1 flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-4 w-4" /> {check.problems.length > 0 ? "Mapping incomplete" : `${int(check.rowErrors.length)} invalid row(s) — import blocked`}
              </div>
              <ul className="ml-4 list-disc space-y-0.5">
                {check.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
                {check.rowErrors.slice(0, 6).map((r, i) => (
                  <li key={i}>
                    Line {r.line}
                    {r.column ? ` · ${r.column}` : ""}
                    {r.value ? ` · "${r.value}"` : ""}: {r.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            check && (
              <div className="flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2 text-[12px] font-medium text-ok">
                <CheckCircle2 className="h-4 w-4" /> All {int(check.rowsOk)} rows valid
              </div>
            )
          )}
        </div>
      )}
    </Card>
  );
}

function DemoCard() {
  const router = useRouter();
  const [seed, setSeed] = useState(42);
  const [events, setEvents] = useState(1500);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/runs/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seed, events }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Demo failed");
      router.push(`/app/reconciliations/${body.runId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Card title="Synthetic demonstration" subtitle="Generated data with known ground truth. No real accounts.">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[12px]">
          <span className="mb-0.5 block text-ink-2">Seed</span>
          <input className="input h-8" type="number" min={1} value={seed} onChange={(e) => setSeed(Math.max(1, Math.trunc(Number(e.target.value) || 1)))} />
        </label>
        <label className="text-[12px]">
          <span className="mb-0.5 block text-ink-2">Business events</span>
          <input className="input h-8" type="number" min={50} max={12000} step={50} value={events} onChange={(e) => setEvents(Math.trunc(Number(e.target.value) || 0))} />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-ink-3">Includes exact matches, fees, rounding, late settlements, splits, payouts, duplicates, missing items and currency mismatches.</p>
      <button className="btn btn-secondary mt-3 w-full justify-center" disabled={busy} onClick={run}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate & reconcile
      </button>
      <div className="mt-2 flex gap-3 text-[12px]">
        <a className="inline-flex items-center gap-1 font-medium text-brand hover:underline" href={`/api/demo-csv?side=bank&seed=${seed}&events=${events}`}>
          <Download className="h-3.5 w-3.5" /> bank.csv
        </a>
        <a className="inline-flex items-center gap-1 font-medium text-brand hover:underline" href={`/api/demo-csv?side=ledger&seed=${seed}&events=${events}`}>
          <Download className="h-3.5 w-3.5" /> ledger.csv
        </a>
      </div>
      {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
    </Card>
  );
}
