"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Info, Loader2, RotateCcw, ShieldCheck, Upload, XCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { detectDateFormats, DATE_FORMATS, type DateFormat } from "@/engine/dates";
import { CURRENCY_EXPONENTS } from "@/engine/money";
import { validateMapping } from "@/engine/csv";
import { validateStatement, type StatementValidation } from "@/engine/statement";
import type { ColumnMapping, Side } from "@/engine/types";
import { int, money } from "@/lib/format";
import { Badge } from "../ui";

/** Extraction payload as returned by /api/imports/extract (shape mirrors server ExtractedTable). */
export interface Extraction {
  kind: "csv" | "xlsx" | "pdf";
  filename: string;
  bytes: number;
  sha256: string;
  headers: string[];
  rows: string[][];
  locators: string[];
  rowFlags: { row: number; code: string; message: string }[];
  warnings: string[];
  sheets?: string[];
  sheet?: string;
  pages?: number;
  balances?: { opening?: { raw: string; location: string }; closing?: { raw: string; location: string } };
  detectedCurrency?: string;
}

const CURRENCY_PROBLEM = "Map a currency column or choose a default currency";

export interface ConfirmedSide {
  token: string;
  extraction: Pick<Extraction, "headers" | "rows" | "locators" | "rowFlags" | "warnings" | "balances">;
  mapping: ColumnMapping;
  excludedRows: number[];
  confirmed: true;
  summary: { filename: string; kind: string; imported: number; excluded: number };
}

const FIELDS: { key: keyof ColumnMapping; label: string; hint?: string }[] = [
  { key: "date", label: "Date", hint: "required" },
  { key: "amount", label: "Amount (signed)", hint: "or debit/credit" },
  { key: "debit", label: "Debit / money out" },
  { key: "credit", label: "Credit / money in" },
  { key: "currency", label: "Currency", hint: "or default" },
  { key: "description", label: "Description" },
  { key: "reference", label: "Reference" },
  { key: "externalId", label: "Transaction ID" },
  { key: "counterparty", label: "Counterparty" },
  { key: "balance", label: "Running balance", hint: "verification only" },
];

const KIND_LABEL = { csv: "CSV", xlsx: "Excel workbook", pdf: "PDF statement" } as const;
const PAGE = 50;
type Filter = "all" | "error" | "warning" | "excluded";

export function SideImport({ side, onConfirmed, onLoaded }: { side: Side; onConfirmed: (c: ConfirmedSide | null) => void; onLoaded?: (loaded: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [ext, setExt] = useState<Extraction | null>(null);
  const [token, setToken] = useState("");
  const [mapping, setMapping] = useState<Partial<ColumnMapping>>({});
  const [dateCandidates, setDateCandidates] = useState<DateFormat[]>([]);
  const [dateConfirmed, setDateConfirmed] = useState(false);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [showColumns, setShowColumns] = useState(false);
  const [showTable, setShowTable] = useState(false);

  const title = side === "bank" ? "Bank statement" : "Ledger export";

  async function upload(f: File, sheet?: string) {
    setBusy(true);
    setError(null);
    resetConfirmation();
    const form = new FormData();
    form.set("file", f);
    form.set("side", side);
    if (sheet) form.set("sheet", sheet);
    try {
      const res = await fetch("/api/imports/extract", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) {
        setError({ message: body.error ?? "The file could not be read.", code: body.code });
        setExt(null);
        return;
      }
      const e: Extraction = body.extraction;
      setFile(f);
      setExt(e);
      onLoaded?.(true);
      setToken(body.token);
      setMapping(body.suggestion.mapping);
      setDateCandidates(body.suggestion.dateFormats);
      setDateConfirmed(body.suggestion.dateFormats.length === 1);
      setExcluded(new Set());
      setFilter(e.rowFlags.length ? "error" : "all");
      setPage(0);
      setShowColumns(false);
    } catch {
      setError({ message: "Upload failed. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  function resetConfirmation() {
    setConfirmed(false);
    onConfirmed(null);
  }

  function clear() {
    setExt(null);
    onLoaded?.(false);
    setFile(null);
    setToken("");
    setError(null);
    setExcluded(new Set());
    resetConfirmation();
  }

  const mappingProblems = useMemo(() => {
    if (!ext) return [];
    const p = validateMapping(ext.headers, mapping);
    if (dateCandidates.length > 1 && !dateConfirmed) p.push(`Dates fit ${dateCandidates.join(" and ")} — choose the correct format`);
    return p;
  }, [ext, mapping, dateCandidates, dateConfirmed]);

  const v: StatementValidation | null = useMemo(() => {
    if (!ext) return null;
    return validateStatement(
      { side, headers: ext.headers, rows: ext.rows, locators: ext.locators, rowFlags: ext.rowFlags, balances: ext.balances, mapping: mapping as ColumnMapping, excluded },
      mappingProblems,
    );
  }, [ext, side, mapping, excluded, mappingProblems]);

  const canConfirm = !!v && v.mappingProblems.length === 0 && v.counts.errors === 0 && v.transactions.length > 0;
  // Currency is asked as its own plain question; other mapping issues open the column editor.
  const needsCurrency = mappingProblems.includes(CURRENCY_PROBLEM);
  const columnProblems = mappingProblems.filter((p) => p !== CURRENCY_PROBLEM);
  const columnsOpen = showColumns || columnProblems.length > 0;

  function toggleConfirm(next: boolean) {
    if (!ext || !v || !canConfirm) return;
    setConfirmed(next);
    onConfirmed(
      next
        ? {
            token,
            extraction: { headers: ext.headers, rows: ext.rows, locators: ext.locators, rowFlags: ext.rowFlags, warnings: ext.warnings, balances: ext.balances },
            mapping: mapping as ColumnMapping,
            excludedRows: [...excluded].sort((a, b) => a - b),
            confirmed: true,
            summary: { filename: ext.filename, kind: ext.kind, imported: v.transactions.length, excluded: excluded.size },
          }
        : null,
    );
  }

  function setMap(patch: Partial<ColumnMapping>) {
    resetConfirmation();
    setMapping((m) => ({ ...m, ...patch }));
  }

  function toggleExclude(i: number) {
    resetConfirmation();
    setExcluded((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  }

  function excludeAllErrors() {
    if (!v) return;
    resetConfirmation();
    setExcluded((s) => new Set([...s, ...v.rows.filter((r) => r.state === "error").map((r) => r.index)]));
  }

  // ---------- Upload state ----------
  if (!ext) {
    return (
      <section className="card p-5">
        <Header side={side} title={title} />
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
            if (f) upload(f);
          }}
          className={clsx(
            "mt-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition",
            drag ? "border-brand bg-brand-soft" : "border-line-strong",
          )}
        >
          {busy ? <Loader2 className="h-8 w-8 animate-spin text-brand" /> : <Upload className="h-8 w-8 text-ink-3" />}
          <p className="mt-3 text-[13.5px] font-medium text-ink">{busy ? "Reading file…" : "Drop a file here or choose one"}</p>
          <p className="mt-1 text-[12px] text-ink-3">CSV, Excel (.xlsx) or text-based PDF · up to 15 MB</p>
          <button className="btn btn-secondary mt-4" disabled={busy} onClick={() => input.current?.click()}>
            Choose file
          </button>
          <input
            ref={input}
            type="file"
            accept=".csv,.xlsx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            aria-label={`${title} file`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
        </div>
        {error && (
          <div role="alert" className="mt-3 flex gap-2 rounded-lg bg-bad-soft p-3 text-[12.5px] text-bad">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error.message}</span>
          </div>
        )}
        <p className="mt-3 text-[11.5px] text-ink-3">Nothing is saved until you review the extracted transactions and confirm them.</p>
      </section>
    );
  }

  // ---------- Preview state ----------
  const rows = v!.rows.filter((r) => (filter === "all" ? true : r.state === filter));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
  const col = (k: keyof ColumnMapping) => (typeof mapping[k] === "string" && mapping[k] ? ext.headers.indexOf(mapping[k] as string) : -1);
  const iDate = col("date"),
    iDesc = col("description"),
    iRef = col("reference"),
    iBal = col("balance");

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line p-5">
        <Header side={side} title={title} />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
          <span className="inline-flex items-center gap-1.5 font-medium text-ink">
            {ext.kind === "pdf" ? <FileText className="h-4 w-4" /> : <FileSpreadsheet className="h-4 w-4" />}
            {ext.filename}
          </span>
          <span>{KIND_LABEL[ext.kind]}</span>
          <span>{(ext.bytes / 1024).toFixed(1)} KB</span>
          {ext.pages && <span>{ext.pages} page(s)</span>}
          <span className="font-mono text-[11px] text-ink-3" title={`SHA-256 ${ext.sha256}`}>
            SHA-256 {ext.sha256.slice(0, 12)}…
          </span>
          <button className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-ink-3 hover:text-ink" onClick={clear}>
            <RotateCcw className="h-3.5 w-3.5" /> Replace file
          </button>
        </div>
        {ext.sheets && ext.sheets.length > 1 && (
          <label className="mt-3 flex items-center gap-2 text-[12.5px]">
            <span className="text-ink-2">Worksheet</span>
            <select className="input h-8 w-auto" value={ext.sheet} disabled={busy} onChange={(e) => file && upload(file, e.target.value)}>
              {ext.sheets.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        {(ext.warnings.length > 0 || ext.kind === "pdf") && (
          <div className="mt-3 space-y-1.5 rounded-lg bg-info-soft p-3 text-[12px] text-ink-2">
            {ext.kind === "pdf" && (
              <p className="flex gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                PDF tables are reconstructed from text positions. Check dates, amounts and signs against the original statement before confirming. Scanned PDFs are not supported.
              </p>
            )}
            {ext.warnings.map((w) => (
              <p key={w} className="flex gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                {w}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Mapping */}
      <div className="space-y-3 border-b border-line p-5">
        {/* Currency: asked in plain language when the file doesn't say; shown when detected. */}
        {needsCurrency ? (
          <div className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn-soft p-3 sm:flex-row sm:items-center">
            <span className="flex-1 text-[13px] font-medium text-ink">Which currency is this {side === "bank" ? "statement" : "ledger"} in? The file doesn’t say.</span>
            <select className="input h-9 w-full sm:w-36" aria-label={`${title} currency`} value="" onChange={(e) => setMap({ defaultCurrency: e.target.value || undefined })}>
              <option value="">Choose…</option>
              {Object.keys(CURRENCY_EXPONENTS).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        ) : (
          !mapping.currency &&
          mapping.defaultCurrency && (
            <p className="text-[12.5px] text-ink-2">
              Currency <b className="text-ink">{mapping.defaultCurrency}</b>
              {ext.detectedCurrency === mapping.defaultCurrency ? " — detected from the document" : " — chosen by you"} ·{" "}
              <button className="font-semibold text-brand hover:underline" onClick={() => setMap({ defaultCurrency: undefined })}>
                change
              </button>
            </p>
          )
        )}

        {!columnsOpen ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-2">
            <CheckCircle2 className="h-4 w-4 text-ok" />
            <span>
              Columns matched automatically:{" "}
              <span className="text-ink">
                {FIELDS.filter((f) => mapping[f.key])
                  .map((f) => f.label.split(" ")[0])
                  .join(" · ")}
              </span>
            </span>
            <button className="font-semibold text-brand hover:underline" onClick={() => setShowColumns(true)}>
              Adjust columns
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">Columns</h3>
              {columnProblems.length === 0 && (
                <button className="text-[12px] font-semibold text-ink-3 hover:text-ink" onClick={() => setShowColumns(false)}>
                  Done
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-5">
              {FIELDS.map((f) => (
                <label key={f.key} className="text-[12px]">
                  <span className="mb-0.5 flex justify-between gap-1 text-ink-2">
                    <span className="truncate">{f.label}</span>
                    {f.hint && <span className="shrink-0 text-ink-3">{f.hint}</span>}
                  </span>
                  <select
                    className="input h-8"
                    aria-label={`${title} ${f.label} column`}
                    value={(mapping[f.key] as string) ?? ""}
                    onChange={(e) => {
                      const val = e.target.value || undefined;
                      if (f.key === "date" && val) {
                        const idx = ext.headers.indexOf(val);
                        const cands = detectDateFormats(ext.rows.slice(0, 500).map((r) => r[idx] ?? ""));
                        setDateCandidates(cands);
                        setDateConfirmed(cands.length === 1);
                        setMap({ date: val, dateFormat: cands[0] });
                        return;
                      }
                      setMap({ [f.key]: val });
                    }}
                  >
                    <option value="">—</option>
                    {ext.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <label className="text-[12px]">
                <span className="mb-0.5 block text-ink-2">Date format</span>
                <select
                  className={clsx("input h-8", dateCandidates.length > 1 && !dateConfirmed && "border-warn")}
                  aria-label={`${title} date format`}
                  value={mapping.dateFormat ?? ""}
                  onChange={(e) => {
                    setDateConfirmed(true);
                    setMap({ dateFormat: e.target.value as DateFormat });
                  }}
                >
                  {!mapping.dateFormat && <option value="">—</option>}
                  {DATE_FORMATS.map((f) => (
                    <option key={f} value={f} disabled={dateCandidates.length > 0 && !dateCandidates.includes(f)}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[12px]">
                <span className="mb-0.5 block text-ink-2">Decimal separator</span>
                <select
                  className="input h-8"
                  aria-label={`${title} decimal separator`}
                  value={mapping.decimalSeparator ?? "."}
                  onChange={(e) => setMap({ decimalSeparator: e.target.value as "." | "," })}
                >
                  <option value=".">1,234.56</option>
                  <option value=",">1.234,56</option>
                </select>
              </label>
              <label className="text-[12px]">
                <span className="mb-0.5 block text-ink-2">Default currency</span>
                <select
                  className="input h-8"
                  aria-label={`${title} default currency`}
                  value={mapping.defaultCurrency ?? ""}
                  disabled={!!mapping.currency}
                  onChange={(e) => setMap({ defaultCurrency: e.target.value || undefined })}
                >
                  <option value="">—</option>
                  {Object.keys(CURRENCY_EXPONENTS).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-end gap-2 pb-1.5 text-[12px] text-ink-2">
                <input type="checkbox" checked={!!mapping.invertSign} onChange={(e) => setMap({ invertSign: e.target.checked })} />
                Invert signs (inflows positive)
              </label>
            </div>
            {columnProblems.length > 0 && (
              <ul className="list-inside list-disc rounded-lg bg-warn-soft p-3 text-[12px] text-warn">
                {columnProblems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Checks */}
      {v && v.mappingProblems.length === 0 && (
        <div className="grid gap-3 border-b border-line p-5 md:grid-cols-3">
          <Stat label="Rows extracted" value={int(v.counts.total)} sub={`${int(v.transactions.length)} will be imported · ${int(v.counts.excluded)} excluded`} />
          <Stat
            label="Need attention"
            value={<span className={v.counts.errors ? "text-bad" : "text-ok"}>{int(v.counts.errors)} errors</span>}
            sub={`${int(v.counts.warnings)} with warnings (review, not blocking)`}
          />
          <BalanceStat v={v} />
          {v.totals.map((t) => (
            <div key={t.currency} className="tabular rounded-lg border border-line p-3 text-[12px] md:col-span-3">
              <span className="font-semibold text-ink">{t.currency}</span> · {int(t.count)} transactions · money in <b className="text-ok">{money(t.inflowMinor, t.currency)}</b> · money out{" "}
              <b className="text-bad">{money(t.outflowMinor, t.currency)}</b> · net <b>{money(t.netMinor, t.currency, { sign: true })}</b>
              {v.runningBalance.checked > 1 && (
                <span className="ml-2 text-ink-3">· running balance {v.runningBalance.mismatches === 0 ? "consistent on every row" : `breaks on ${int(v.runningBalance.mismatches)} row(s)`}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Preview table: shown when rows need attention, otherwise one line with an option to view. */}
      {v && v.mappingProblems.length === 0 && !(showTable || v.counts.errors > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-4 text-[13px]">
          <CheckCircle2 className="h-4 w-4 text-ok" />
          <span className="text-ink">
            {int(v.transactions.length)} transactions ready to import
            {v.counts.warnings > 0 && <span className="text-ink-3"> · {int(v.counts.warnings)} with notes to review</span>}
          </span>
          <button
            className="font-semibold text-brand hover:underline"
            onClick={() => {
              setShowTable(true);
              setFilter(v.counts.warnings > 0 ? "warning" : "all");
              setPage(0);
            }}
          >
            View transactions
          </button>
        </div>
      )}
      {v && v.mappingProblems.length === 0 && (showTable || v.counts.errors > 0) && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
            <div className="flex gap-1">
              {(
                [
                  ["all", `All ${int(v.counts.total)}`],
                  ["error", `Errors ${int(v.counts.errors)}`],
                  ["warning", `Warnings ${int(v.counts.warnings)}`],
                  ["excluded", `Excluded ${int(v.counts.excluded)}`],
                ] as [Filter, string][]
              ).map(([f, l]) => (
                <button
                  key={f}
                  onClick={() => {
                    setFilter(f);
                    setPage(0);
                  }}
                  className={clsx("rounded-md px-2.5 py-1 text-[12px] font-semibold", filter === f ? "bg-night-900 text-white" : "text-ink-3 hover:bg-neutral-soft")}
                >
                  {l}
                </button>
              ))}
            </div>
            {v.counts.errors > 0 && (
              <button className="btn btn-bad h-8" onClick={excludeAllErrors}>
                Exclude all {int(v.counts.errors)} error rows
              </button>
            )}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[860px] text-[12.5px]">
              <thead>
                <tr className="border-y border-line text-left text-[10.5px] uppercase tracking-wide text-ink-3">
                  <th className="w-10 px-3 py-2 font-semibold">Excl.</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Description · reference</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                  {iBal >= 0 && <th className="px-3 py-2 text-right font-semibold">Balance</th>}
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((r) => {
                  const cells = ext.rows[r.index]!;
                  return (
                    <tr
                      key={r.index}
                      className={clsx(
                        "border-b border-line align-top",
                        r.state === "excluded" && "bg-neutral-soft/60 text-ink-3 line-through decoration-ink-3/40",
                        r.state === "error" && "bg-bad-soft/40",
                      )}
                    >
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={excluded.has(r.index)} onChange={() => toggleExclude(r.index)} aria-label={`Exclude ${r.locator}`} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-[11.5px] text-ink-3">{r.locator}</td>
                      <td className="tabular px-3 py-2 whitespace-nowrap">{iDate >= 0 ? cells[iDate] : "—"}</td>
                      <td className="max-w-[340px] px-3 py-2">
                        <div className="truncate">{iDesc >= 0 ? cells[iDesc] : ""}</div>
                        {iRef >= 0 && cells[iRef] && <div className="truncate font-mono text-[11px] text-ink-3">{cells[iRef]}</div>}
                      </td>
                      <td className="tabular px-3 py-2 text-right font-medium whitespace-nowrap">
                        {r.amountMinor !== undefined && r.currency ? (
                          <span className={BigInt(r.amountMinor) < 0n ? "text-bad" : "text-ok"}>
                            {money(r.amountMinor, r.currency, { sign: true })} <span className="text-[10.5px] text-ink-3">{r.currency}</span>
                          </span>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      {iBal >= 0 && <td className="tabular px-3 py-2 text-right text-ink-3">{cells[iBal]}</td>}
                      <td className="max-w-[300px] px-3 py-2">
                        {r.state === "ok" && <Badge tone="ok">OK</Badge>}
                        {r.state === "excluded" && <Badge tone="neutral">Excluded</Badge>}
                        {r.state === "error" && <Badge tone="bad">Error</Badge>}
                        {r.state === "warning" && <Badge tone="warn">Check</Badge>}
                        {[...r.errors, ...r.warnings].map((m) => (
                          <div key={m} className={clsx("mt-1 text-[11px] leading-snug no-underline", r.errors.includes(m) ? "text-bad" : "text-warn")}>
                            {m}
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {slice.length === 0 && <p className="px-5 py-8 text-center text-[12.5px] text-ink-3">No rows in this view.</p>}
          </div>
          <div className="flex items-center justify-between px-5 py-2.5 text-[12px] text-ink-3">
            <span className="tabular">{rows.length ? `${int(page * PAGE + 1)}–${int(Math.min(rows.length, (page + 1) * PAGE))} of ${int(rows.length)}` : "0 rows"}</span>
            <div className="flex items-center gap-1">
              <button className="btn btn-secondary h-8 px-2" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="tabular px-1">
                {page + 1}/{pages}
              </span>
              <button className="btn btn-secondary h-8 px-2" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Confirmation */}
      <div className={clsx("border-t border-line p-5", confirmed ? "bg-ok-soft" : "bg-[#FBFAF8]")}>
        <label className={clsx("flex items-start gap-3 text-[13px]", !canConfirm && "opacity-60")}>
          <input type="checkbox" className="mt-0.5 h-4 w-4" disabled={!canConfirm} checked={confirmed} onChange={(e) => toggleConfirm(e.target.checked)} aria-label={`Confirm ${title} transactions`} />
          <span>
            <span className="font-semibold text-ink">
              I have checked these {v ? int(v.transactions.length) : 0} transactions against the original {side === "bank" ? "statement" : "ledger export"}.
            </span>
            <span className="mt-0.5 block text-[12px] text-ink-3">
              {canConfirm
                ? "Amounts are imported exactly as shown. Excluded rows are recorded in the audit trail."
                : v && v.counts.errors > 0
                  ? "Resolve every error row first — exclude it or correct the source file. Amounts are never changed automatically."
                  : "Complete the column mapping first."}
            </span>
          </span>
          {confirmed && <ShieldCheck className="ml-auto h-5 w-5 shrink-0 text-ok" />}
        </label>
      </div>
    </section>
  );
}

function Header({ side, title }: { side: Side; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-soft text-[12px] font-semibold text-brand">{side === "bank" ? "1" : "2"}</span>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className="tabular mt-0.5 text-[18px] font-semibold">{value}</div>
      <div className="text-[11.5px] text-ink-3">{sub}</div>
    </div>
  );
}

function BalanceStat({ v }: { v: StatementValidation }) {
  const b = v.balanceCheck;
  if (b.status === "unavailable") {
    return (
      <div className="rounded-lg border border-line p-3">
        <div className="text-[11.5px] text-ink-3">Statement balance check</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[14px] font-semibold text-ink-2">
          <Info className="h-4 w-4 text-ink-3" /> Not available
        </div>
        <div className="text-[11.5px] text-ink-3">{b.reason}</div>
      </div>
    );
  }
  const ok = b.status === "pass";
  return (
    <div className={clsx("rounded-lg border p-3", ok ? "border-ok/30 bg-ok-soft" : "border-bad/30 bg-bad-soft")}>
      <div className="text-[11.5px] text-ink-3">Statement balance check</div>
      <div className={clsx("mt-0.5 flex items-center gap-1.5 text-[14px] font-semibold", ok ? "text-ok" : "text-bad")}>
        {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        {ok ? "Opening + transactions = closing" : "Does not reconcile"}
      </div>
      <div className="tabular text-[11.5px] text-ink-2">
        {money(b.openingMinor, b.currency)} {b.netMinor >= 0n ? "+" : "−"} {money(b.netMinor < 0n ? -b.netMinor : b.netMinor, b.currency)} {ok ? "=" : "≠"} {money(b.closingMinor, b.currency)}{" "}
        {b.currency}
        {b.status === "fail" && (
          <span className="block text-bad">
            Difference {money(b.differenceMinor, b.currency, { sign: true })}
            {b.excludedRows ? ` · ${b.excludedRows} row(s) excluded` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
