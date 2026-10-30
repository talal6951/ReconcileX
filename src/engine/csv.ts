import Papa from "papaparse";
import { detectDateFormats, tryParseDate, type DateFormat } from "./dates";
import { isSupportedCurrency, MoneyParseError, normalizeCurrency, parseAmount } from "./money";
import type { ColumnMapping, RowError, Side, Transaction } from "./types";

export const MAX_ROWS = 100_000;
export const MAX_FIELD_LENGTH = 1_000;

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  errors: RowError[];
}

export function parseCsv(text: string): ParsedCsv {
  const errors: RowError[] = [];
  const clean = text.replace(/^﻿/, "");
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy" });
  for (const e of result.errors) {
    errors.push({ line: (e.row ?? 0) + 1, message: `CSV syntax: ${e.message}` });
  }
  const [headerRow, ...rows] = result.data;
  if (!headerRow) return { headers: [], rows: [], errors: [{ line: 1, message: "File is empty" }] };
  const headers = headerRow.map((h) => h.trim());
  const seen = new Set<string>();
  headers.forEach((h, i) => {
    if (!h) errors.push({ line: 1, message: `Column ${i + 1} has an empty header` });
    else if (seen.has(h.toLowerCase())) errors.push({ line: 1, column: h, message: `Duplicate header "${h}"` });
    seen.add(h.toLowerCase());
  });
  if (rows.length > MAX_ROWS) errors.push({ line: 1, message: `File has ${rows.length} rows; maximum is ${MAX_ROWS}` });
  rows.forEach((r, i) => {
    if (r.length !== headers.length) {
      errors.push({ line: i + 2, message: `Row has ${r.length} fields; header has ${headers.length}` });
    }
  });
  return { headers, rows, errors };
}

const SYNONYMS: Record<keyof Omit<ColumnMapping, "dateFormat" | "decimalSeparator" | "defaultCurrency" | "invertSign">, string[]> = {
  date: ["date", "transaction date", "txn date", "posting date", "posted date", "value date", "booking date", "entry date"],
  amount: ["amount", "amt", "transaction amount", "value", "net amount"],
  debit: ["debit", "debits", "withdrawal", "withdrawals", "money out", "dr"],
  credit: ["credit", "credits", "deposit", "deposits", "money in", "cr"],
  currency: ["currency", "ccy", "curr", "currency code"],
  reference: ["reference", "ref", "invoice", "invoice number", "invoice no", "document number", "doc no", "payment reference"],
  description: ["description", "narrative", "details", "memo", "particulars", "transaction details", "remarks"],
  externalId: ["transaction id", "txn id", "id", "transaction reference", "bank reference", "external id", "entry id", "journal id"],
  counterparty: ["counterparty", "payee", "payer", "customer", "vendor", "supplier", "name", "beneficiary"],
  balance: ["balance", "running balance", "closing balance", "ledger balance", "available balance"],
};

function canon(h: string): string {
  return h.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
}

const KNOWN_HEADERS = new Set([...Object.values(SYNONYMS).flat(), "balance", "running balance", "paid in", "paid out", "type"]);

/** Number of cells that look like a known statement column header (used to locate header rows in sheets/PDFs). */
export function headerScore(cells: readonly string[]): number {
  return cells.filter((c) => KNOWN_HEADERS.has(canon(c))).length;
}

export interface MappingSuggestion {
  mapping: Partial<ColumnMapping>;
  dateFormats: DateFormat[];
  decimalSeparator: "." | ",";
}

/** Suggest a column mapping from header names and sample values. The user must confirm it. */
export function suggestMapping(headers: string[], rows: string[][]): MappingSuggestion {
  const mapping: Partial<ColumnMapping> = {};
  const used = new Set<string>();
  for (const [field, names] of Object.entries(SYNONYMS) as [keyof typeof SYNONYMS, string[]][]) {
    const hit = headers.find((h) => !used.has(h) && names.includes(canon(h)));
    if (hit) {
      (mapping as Record<string, string>)[field] = hit;
      used.add(hit);
    }
  }
  if (mapping.amount && (mapping.debit || mapping.credit)) {
    delete mapping.debit;
    delete mapping.credit;
  }
  let dateFormats: DateFormat[] = [];
  if (mapping.date) {
    const idx = headers.indexOf(mapping.date);
    dateFormats = detectDateFormats(rows.slice(0, 500).map((r) => r[idx] ?? ""));
    if (dateFormats.length >= 1) mapping.dateFormat = dateFormats[0];
  }
  // Decimal separator: a comma followed by exactly 1-2 digits at end, with no dots, suggests ",".
  const amountCols = [mapping.amount, mapping.debit, mapping.credit].filter(Boolean) as string[];
  const samples = amountCols.flatMap((c) => rows.slice(0, 200).map((r) => r[headers.indexOf(c)] ?? ""));
  const commaDecimal = samples.filter((v) => /,\d{1,2}$/.test(v.trim()) && !/\./.test(v)).length;
  const dotDecimal = samples.filter((v) => /\.\d{1,3}$/.test(v.trim())).length;
  const decimalSeparator = commaDecimal > dotDecimal ? "," : ".";
  mapping.decimalSeparator = decimalSeparator;
  return { mapping, dateFormats, decimalSeparator };
}

export function validateMapping(headers: string[], m: Partial<ColumnMapping>): string[] {
  const problems: string[] = [];
  const has = (c?: string) => c !== undefined && c !== "" && headers.includes(c);
  if (!has(m.date)) problems.push("A date column must be mapped");
  if (!m.dateFormat) problems.push("A date format must be selected");
  const single = has(m.amount);
  const split = has(m.debit) || has(m.credit);
  if (single && split) problems.push("Map either a signed amount column or debit/credit columns, not both");
  if (!single && !split) problems.push("An amount column (or debit/credit columns) must be mapped");
  if (!has(m.currency)) {
    if (!m.defaultCurrency) problems.push("Map a currency column or choose a default currency");
    else if (!isSupportedCurrency(m.defaultCurrency)) problems.push(`Unsupported default currency "${m.defaultCurrency}"`);
  }
  if (!has(m.reference) && !has(m.description) && !has(m.externalId)) {
    problems.push("Map at least one of reference, description or transaction ID");
  }
  for (const [k, v] of Object.entries(m)) {
    if (["dateFormat", "decimalSeparator", "defaultCurrency", "invertSign"].includes(k)) continue;
    if (typeof v === "string" && v !== "" && !headers.includes(v)) problems.push(`Mapped column "${v}" for ${k} does not exist`);
  }
  return problems;
}

export interface NormalizeResult {
  transactions: Transaction[];
  errors: RowError[];
}

/**
 * Convert raw CSV rows into validated transactions. Validation is strict:
 * any invalid row is reported and the caller must not proceed with a partial import.
 */
export function normalizeRows(side: Side, headers: string[], rows: string[][], mapping: ColumnMapping, opts: { lines?: readonly number[] } = {}): NormalizeResult {
  const errors: RowError[] = [];
  const transactions: Transaction[] = [];
  const idx = (c?: string) => (c ? headers.indexOf(c) : -1);
  const iDate = idx(mapping.date), iAmt = idx(mapping.amount), iDr = idx(mapping.debit), iCr = idx(mapping.credit);
  const iCcy = idx(mapping.currency), iRef = idx(mapping.reference), iDesc = idx(mapping.description);
  const iExt = idx(mapping.externalId), iCp = idx(mapping.counterparty);
  const prefix = side === "bank" ? "B" : "L";
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  rows.forEach((r, n) => {
    // Source line: the real sheet row / statement line when known, else the CSV line (header = 1).
    const line = opts.lines?.[n] ?? n + 2;
    const rowErrors: RowError[] = [];
    for (const v of r) {
      if (v.length > MAX_FIELD_LENGTH) rowErrors.push({ line, message: `Field exceeds ${MAX_FIELD_LENGTH} characters` });
    }
    const currencyRaw = iCcy >= 0 ? get(r, iCcy) : mapping.defaultCurrency ?? "";
    const currency = normalizeCurrency(currencyRaw);
    if (!currency) rowErrors.push({ line, column: mapping.currency, message: "Currency is empty" });
    else if (!isSupportedCurrency(currency)) rowErrors.push({ line, column: mapping.currency, value: currencyRaw, message: `Unsupported currency "${currencyRaw}"` });

    const dateRaw = get(r, iDate);
    const parsedDate = dateRaw ? tryParseDate(dateRaw, mapping.dateFormat) : null;
    if (!parsedDate) rowErrors.push({ line, column: mapping.date, value: dateRaw, message: dateRaw ? `Invalid ${mapping.dateFormat} date` : "Date is empty" });

    let amountMinor: bigint | null = null;
    if (currency && isSupportedCurrency(currency)) {
      try {
        if (iAmt >= 0) {
          amountMinor = parseAmount(get(r, iAmt), currency, { decimalSeparator: mapping.decimalSeparator });
        } else {
          const dr = get(r, iDr), cr = get(r, iCr);
          if (!dr && !cr) throw new MoneyParseError("Both debit and credit are empty");
          const drV = dr ? parseAmount(dr, currency, { decimalSeparator: mapping.decimalSeparator }) : 0n;
          const crV = cr ? parseAmount(cr, currency, { decimalSeparator: mapping.decimalSeparator }) : 0n;
          if (drV < 0n || crV < 0n) throw new MoneyParseError("Debit/credit values must not be negative");
          if (drV !== 0n && crV !== 0n) throw new MoneyParseError("Row has both a debit and a credit value");
          amountMinor = crV - drV;
        }
        if (mapping.invertSign) amountMinor = -amountMinor;
        if (amountMinor === 0n) throw new MoneyParseError("Amount is zero");
      } catch (e) {
        rowErrors.push({ line, column: mapping.amount ?? `${mapping.debit}/${mapping.credit}`, message: (e as Error).message });
      }
    }

    const reference = get(r, iRef);
    const description = get(r, iDesc);
    const externalId = get(r, iExt);
    if (!reference && !description && !externalId) {
      rowErrors.push({ line, message: "Row has no reference, description or transaction ID" });
    }

    if (rowErrors.length > 0 || !parsedDate || amountMinor === null) {
      errors.push(...rowErrors);
      return;
    }
    transactions.push({
      id: `${prefix}-${String(n + 1).padStart(6, "0")}`,
      side,
      sourceLine: line,
      externalId,
      date: parsedDate.iso,
      day: parsedDate.day,
      amountMinor,
      currency,
      reference,
      description,
      counterparty: get(r, iCp),
    });
  });
  return { transactions, errors };
}
