import { normalizeRows } from "./csv";
import { findDuplicates } from "./duplicates";
import { MoneyParseError, parseAmount } from "./money";
import type { ColumnMapping, Side, Transaction } from "./types";

/**
 * Statement preview validation — shared by the browser (live preview) and the
 * server (authoritative check before saving). Pure; never alters an amount.
 *
 *   error    → blocks import until the row is explicitly excluded (or the source fixed)
 *   warning  → shown for review; does not block
 */

/** Extraction flags that make a row's values unreliable: treated as blocking errors. */
export const BLOCKING_FLAGS = new Set(["ambiguous_column", "multiple_values", "no_date", "cell", "field_count", "csv_syntax"]);

export interface StatementInput {
  side: Side;
  headers: string[];
  rows: string[][];
  locators: string[];
  rowFlags: { row: number; code: string; message: string }[];
  balances?: { opening?: { raw: string; location: string }; closing?: { raw: string; location: string } };
  mapping: ColumnMapping;
  /** Row indexes the user explicitly excluded. */
  excluded: ReadonlySet<number>;
}

export interface RowStatus {
  index: number;
  locator: string;
  state: "ok" | "warning" | "error" | "excluded";
  errors: string[];
  warnings: string[];
  /** Parsed signed amount in minor units for valid rows (string for transport). */
  amountMinor?: string;
  currency?: string;
}

export interface CurrencyTotal {
  currency: string;
  count: number;
  inflowMinor: bigint;
  outflowMinor: bigint;
  netMinor: bigint;
}

export type BalanceCheck =
  | { status: "pass"; currency: string; openingMinor: bigint; closingMinor: bigint; netMinor: bigint }
  | { status: "fail"; currency: string; openingMinor: bigint; closingMinor: bigint; netMinor: bigint; differenceMinor: bigint; excludedRows: number }
  | { status: "unavailable"; reason: string };

export interface StatementValidation {
  rows: RowStatus[];
  transactions: Transaction[];
  counts: { total: number; ok: number; warnings: number; errors: number; excluded: number };
  totals: CurrencyTotal[];
  balanceCheck: BalanceCheck;
  runningBalance: { checked: number; mismatches: number; order: "ascending" | "descending" | null };
  mappingProblems: string[];
}

export function validateStatement(input: StatementInput, mappingProblems: string[] = []): StatementValidation {
  const { side, headers, rows, locators, mapping, excluded } = input;
  const statuses: RowStatus[] = rows.map((_, i) => ({ index: i, locator: locators[i] ?? `row ${i + 1}`, state: "ok", errors: [], warnings: [] }));

  for (const f of input.rowFlags) {
    const s = statuses[f.row];
    if (!s) continue;
    (BLOCKING_FLAGS.has(f.code) ? s.errors : s.warnings).push(f.message);
  }

  const transactions: Transaction[] = [];
  if (mappingProblems.length === 0) {
    // Normalise each row individually so errors attach to the exact row.
    rows.forEach((row, i) => {
      if (excluded.has(i)) return;
      const r = normalizeRows(side, headers, [row], mapping, { lines: [i + 1] });
      const s = statuses[i]!;
      for (const e of r.errors) s.errors.push(e.column ? `${e.column}: ${e.message}` : e.message);
      const t = r.transactions[0];
      if (t && s.errors.length === 0) {
        const id = `${side === "bank" ? "B" : "L"}-${String(transactions.length + 1).padStart(6, "0")}`;
        transactions.push({ ...t, id, sourceLine: i + 1 });
        s.amountMinor = t.amountMinor.toString();
        s.currency = t.currency;
        if (!t.reference && !t.externalId) s.warnings.push("No reference or transaction ID — matching will rely on amount, date and description");
        if (!t.description) s.warnings.push("No description");
      }
    });

    // Possible duplicates WITHIN this file (surfaced, never removed).
    const indexOf = new Map(transactions.map((t) => [t.id, t.sourceLine - 1]));
    for (const g of findDuplicates(transactions)) {
      const where = g.ids.map((id) => statuses[indexOf.get(id)!]!.locator).join(", ");
      for (const id of g.ids) statuses[indexOf.get(id)!]!.warnings.push(`Possible duplicate (${g.kind.replace("_", " ")}): ${where}`);
    }
  }

  const runningBalance = checkRunningBalance(input, statuses);

  for (const s of statuses) {
    if (excluded.has(s.index)) s.state = "excluded";
    else if (s.errors.length) s.state = "error";
    else if (s.warnings.length) s.state = "warning";
  }

  const totals = new Map<string, CurrencyTotal>();
  for (const t of transactions) {
    const c = totals.get(t.currency) ?? { currency: t.currency, count: 0, inflowMinor: 0n, outflowMinor: 0n, netMinor: 0n };
    c.count++;
    if (t.amountMinor >= 0n) c.inflowMinor += t.amountMinor;
    else c.outflowMinor += -t.amountMinor;
    c.netMinor += t.amountMinor;
    totals.set(t.currency, c);
  }

  return {
    rows: statuses,
    transactions,
    counts: {
      total: rows.length,
      ok: statuses.filter((s) => s.state === "ok").length,
      warnings: statuses.filter((s) => s.state === "warning").length,
      errors: statuses.filter((s) => s.state === "error").length,
      excluded: statuses.filter((s) => s.state === "excluded").length,
    },
    totals: [...totals.values()],
    balanceCheck: checkStatementBalance(input, [...totals.values()], statuses),
    runningBalance,
    mappingProblems,
  };
}

function statementCurrency(input: StatementInput, totals: CurrencyTotal[]): string | null {
  if (totals.length === 1) return totals[0]!.currency;
  if (totals.length === 0 && input.mapping.defaultCurrency) return input.mapping.defaultCurrency;
  return null;
}

/** opening + Σ(included amounts) must equal closing — exact, in bigint. */
function checkStatementBalance(input: StatementInput, totals: CurrencyTotal[], statuses: RowStatus[]): BalanceCheck {
  const { opening, closing } = input.balances ?? {};
  if (!opening || !closing) return { status: "unavailable", reason: "The file does not state both an opening and a closing balance." };
  const currency = statementCurrency(input, totals);
  if (!currency) return { status: "unavailable", reason: "The statement contains several currencies; balances cannot be checked as one total." };
  let openingMinor: bigint, closingMinor: bigint;
  try {
    openingMinor = parseAmount(opening.raw, currency, { decimalSeparator: input.mapping.decimalSeparator });
    closingMinor = parseAmount(closing.raw, currency, { decimalSeparator: input.mapping.decimalSeparator });
  } catch (e) {
    return { status: "unavailable", reason: `Balance could not be read: ${(e as MoneyParseError).message}` };
  }
  const blocking = statuses.filter((s) => s.errors.length > 0 && !input.excluded.has(s.index)).length;
  if (blocking) return { status: "unavailable", reason: `${blocking} row(s) still have errors; resolve them to run the balance check.` };
  const netMinor = totals.find((t) => t.currency === currency)?.netMinor ?? 0n;
  if (openingMinor + netMinor === closingMinor) return { status: "pass", currency, openingMinor, closingMinor, netMinor };
  return { status: "fail", currency, openingMinor, closingMinor, netMinor, differenceMinor: closingMinor - (openingMinor + netMinor), excludedRows: input.excluded.size };
}

/**
 * If a running-balance column is mapped, each balance must equal the previous
 * balance plus this row's amount. Statement order may be ascending or
 * descending by date; the order with fewer breaks is used.
 */
function checkRunningBalance(input: StatementInput, statuses: RowStatus[]): StatementValidation["runningBalance"] {
  const col = input.mapping.balance ? input.headers.indexOf(input.mapping.balance) : -1;
  if (col < 0) return { checked: 0, mismatches: 0, order: null };
  const seq: { i: number; amount: bigint; balance: bigint }[] = [];
  for (const s of statuses) {
    if (s.amountMinor === undefined || !s.currency || input.excluded.has(s.index)) continue;
    const raw = input.rows[s.index]![col]?.trim();
    if (!raw) continue;
    try {
      seq.push({ i: s.index, amount: BigInt(s.amountMinor), balance: parseAmount(raw, s.currency, { decimalSeparator: input.mapping.decimalSeparator }) });
    } catch {
      s.warnings.push(`Balance "${raw}" could not be read`);
    }
  }
  const breaks = (order: typeof seq) => {
    const bad: number[] = [];
    for (let k = 1; k < order.length; k++) if (order[k - 1]!.balance + order[k]!.amount !== order[k]!.balance) bad.push(order[k]!.i);
    return bad;
  };
  const asc = breaks(seq);
  const desc = breaks([...seq].reverse());
  const useAsc = asc.length <= desc.length;
  const bad = useAsc ? asc : desc;
  for (const i of bad) statuses[i]!.warnings.push("Running balance does not follow from the previous row — a line may be missing, misread or excluded");
  return { checked: seq.length, mismatches: bad.length, order: seq.length > 1 ? (useAsc ? "ascending" : "descending") : null };
}
