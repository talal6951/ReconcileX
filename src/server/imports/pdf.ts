import { headerScore } from "@/engine/csv";
import { detectCurrency } from "./currency";
import { ImportError, MAX_IMPORT_ROWS, type ExtractedTable, type StatementBalances } from "./types";

/**
 * Text-based PDF statement extraction.
 *
 * Reconstructs a table from positioned text: the statement's header row defines
 * the columns; every following line is split into those columns by x-position.
 * Columns are assigned by overlap with the header labels (see columnOf).
 * Nothing is inferred beyond position — no OCR, no amount arithmetic, no guessing:
 *  - values straddling a column boundary are flagged as ambiguous;
 *  - lines with an amount but no date become flagged rows (never silently dropped);
 *  - opening/closing balance lines are captured as raw text for verification only.
 */

export const PDF_LIMITS = { maxPages: 300, minTextCharsPerPage: 40 };

interface Token {
  str: string;
  x0: number;
  x1: number;
  y: number;
}

interface Line {
  page: number;
  y: number;
  tokens: Token[];
  /** 1-based line number on its page (top to bottom). */
  n: number;
}

interface Column {
  label: string;
  x0: number;
  x1: number;
}

const BALANCE_RE = /\b(opening|closing|beginning|ending|previous|new)\s+balance\b|\bbalance\s+(brought|carried)\s+forward\b|\bbalance\s+[bc]\/f\b/i;
const AMOUNT_RE = /^[(+-]?\d{1,3}([,. ' ]\d{3})*([.,]\d+)?\)?$|^[(+-]?\d+([.,]\d+)?\)?$/;
const DATE_HEADER_RE = /date/i;

/** Merge text items on a line into word-level tokens (PDFs often split words or characters). */
function lineTokens(items: Token[]): Token[] {
  const sorted = [...items].sort((a, b) => a.x0 - b.x0);
  const out: Token[] = [];
  for (const it of sorted) {
    const prev = out[out.length - 1];
    const gap = prev ? it.x0 - prev.x1 : Infinity;
    // Glue fragments closer than ~1 space; a wider gap starts a new token.
    if (prev && gap < 2.5) {
      prev.str += gap > 0.6 ? ` ${it.str}` : it.str;
      prev.x1 = Math.max(prev.x1, it.x1);
    } else out.push({ ...it });
  }
  return out;
}

function groupLines(page: number, items: Token[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const lines: { y: number; items: Token[] }[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= 2.5) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  return lines.map((l, i) => ({ page, y: l.y, tokens: lineTokens(l.items), n: i + 1 }));
}

/** Horizontal tolerance (pt) when testing overlap with a header label. */
const OVERLAP_TOLERANCE = 1;
/** If the two nearest header labels are within this distance (pt) of each other, the column is ambiguous. */
const NEAREST_MARGIN = 6;
/** Edge-alignment tolerance (pt) for left- or right-aligned columns. */
const ALIGN_TOLERANCE = 3;

/**
 * A value belongs to a column it overlaps only if it is laid out like that column:
 * left edges aligned (text), right edges aligned (numbers), or substantially
 * overlapping the label (centred headers). Merely touching a label is not enough.
 */
function alignedWith(t: Token, c: Column, overlap: number): boolean {
  const narrower = Math.max(Math.min(t.x1 - t.x0, c.x1 - c.x0), 0.01);
  return Math.abs(t.x0 - c.x0) <= ALIGN_TOLERANCE || Math.abs(t.x1 - c.x1) <= ALIGN_TOLERANCE || overlap / narrower >= 0.5;
}

/**
 * Assign a token to a column by horizontal overlap with the header LABEL spans.
 * Works for left-aligned text (values start under the label and may run far right)
 * and right-aligned numbers (values end under the label and may extend left).
 *   - overlaps exactly one label and is aligned with it → that column
 *   - overlaps one label without alignment, or two or more labels → ambiguous (flagged, never guessed)
 *   - overlaps none → nearest label edge, ambiguous if the runner-up is nearly as close
 */
function columnOf(t: Token, cols: Column[]): { col: number; ambiguous: boolean } {
  const overlaps: { i: number; amount: number }[] = [];
  cols.forEach((c, i) => {
    const amount = Math.min(t.x1, c.x1 + OVERLAP_TOLERANCE) - Math.max(t.x0, c.x0 - OVERLAP_TOLERANCE);
    if (amount > 0) overlaps.push({ i, amount });
  });
  if (overlaps.length === 1) {
    const { i, amount } = overlaps[0]!;
    return { col: i, ambiguous: !alignedWith(t, cols[i]!, amount) };
  }
  if (overlaps.length > 1) {
    overlaps.sort((a, b) => b.amount - a.amount);
    return { col: overlaps[0]!.i, ambiguous: true };
  }
  const dist = cols
    .map((c, i) => ({ i, d: t.x1 < c.x0 ? c.x0 - t.x1 : t.x0 - c.x1 }))
    .sort((a, b) => a.d - b.d);
  const [best, second] = dist;
  return { col: best!.i, ambiguous: !!second && second.d - best!.d < NEAREST_MARGIN };
}

function isHeaderLine(l: Line): boolean {
  const cells = l.tokens.map((t) => t.str);
  return headerScore(cells) >= 3 && cells.some((c) => DATE_HEADER_RE.test(c));
}

export async function extractPdf(bytes: Uint8Array, meta: { filename: string; sha256: string }): Promise<ExtractedTable> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js 6.x has no eval/new Function code paths (the former isEvalSupported option was removed),
  // so font programs cannot execute code. Only text content is read; nothing is rendered.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), // pdf.js takes ownership of the buffer; give it a copy
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    await task.destroy();
    const name = (e as { name?: string }).name;
    if (name === "PasswordException") throw new ImportError("This PDF is password-protected or encrypted. Download an unprotected statement from your bank and try again.", "encrypted_pdf");
    throw new ImportError("The PDF could not be read; it may be corrupted or not a real PDF.", "corrupt_pdf");
  }

  try {
    if (pdf.numPages > PDF_LIMITS.maxPages) throw new ImportError(`The PDF has ${pdf.numPages} pages; the maximum is ${PDF_LIMITS.maxPages}.`, "too_many_pages");
    const lines: Line[] = [];
    let chars = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items: Token[] = [];
      for (const it of content.items) {
        if (!("str" in it)) continue;
        const str = it.str.replace(/\s+/g, " ").trim();
        if (!str) continue;
        chars += str.length;
        const x = it.transform[4] as number;
        items.push({ str, x0: x, x1: x + (it.width as number), y: it.transform[5] as number });
      }
      lines.push(...groupLines(p, items));
      page.cleanup();
    }
    if (chars < PDF_LIMITS.minTextCharsPerPage * pdf.numPages) {
      throw new ImportError(
        "This PDF contains little or no selectable text — it appears to be a scanned image. Reconcile X does not use OCR, because OCR errors in amounts cannot be ruled out. Download a text-based PDF, CSV or Excel export from your bank instead.",
        "scanned_pdf",
      );
    }

    const headerAt = lines.findIndex(isHeaderLine);
    if (headerAt < 0) {
      throw new ImportError(
        "No transaction table header (e.g. Date · Description · Amount/Debit/Credit · Balance) was found. This statement layout is not supported; use a CSV or Excel export instead.",
        "unrecognised_layout",
      );
    }
    const header = lines[headerAt]!;
    const cols: Column[] = header.tokens.map((t) => ({ label: t.str, x0: t.x0, x1: t.x1 }));
    const dateCol = cols.findIndex((c) => DATE_HEADER_RE.test(c.label));
    const descCol = cols.findIndex((c) => /descr|detail|narrat|particular|memo|transaction/i.test(c.label) && !DATE_HEADER_RE.test(c.label));

    const rows: string[][] = [];
    const locators: string[] = [];
    const rowFlags: ExtractedTable["rowFlags"] = [];
    const balances: StatementBalances = {};
    let merged = 0;
    let ignored = 0;
    let repeatedHeaders = 0;
    let prevLine: Line | null = null;

    for (const line of lines.slice(headerAt + 1)) {
      const text = line.tokens.map((t) => t.str).join(" ");
      if (isHeaderLine(line)) {
        repeatedHeaders++;
        prevLine = null;
        continue;
      }
      if (BALANCE_RE.test(text)) {
        const amounts = line.tokens.filter((t) => AMOUNT_RE.test(t.str));
        const raw = amounts[amounts.length - 1]?.str;
        const loc = `page ${line.page}, line ${line.n}`;
        if (raw) {
          if (/opening|beginning|previous|brought/i.test(text)) balances.opening ??= { raw, location: loc };
          else balances.closing = { raw, location: loc };
        }
        prevLine = null;
        continue;
      }
      const cells = cols.map(() => "");
      let ambiguous = false;
      let multiAmount = false;
      for (const t of line.tokens) {
        const { col, ambiguous: amb } = columnOf(t, cols);
        if (amb) ambiguous = true;
        if (cells[col] && col !== descCol && AMOUNT_RE.test(t.str) && AMOUNT_RE.test(cells[col]!)) multiAmount = true;
        cells[col] = cells[col] ? `${cells[col]} ${t.str}` : t.str;
      }
      const hasDate = dateCol >= 0 && /\d/.test(cells[dateCol]!);
      const hasAmount = cells.some((c, i) => i !== dateCol && i !== descCol && AMOUNT_RE.test(c));
      const onlyDescription = cells.every((c, i) => i === descCol || c === "");

      if (!hasDate && onlyDescription && descCol >= 0 && prevLine && prevLine.page === line.page && prevLine.y - line.y < 16 && rows.length > 0) {
        // Wrapped description continuing the previous transaction.
        const last = rows[rows.length - 1]!;
        last[descCol] = `${last[descCol]} ${cells[descCol]}`.trim();
        merged++;
        prevLine = line;
        continue;
      }
      if (!hasDate && !hasAmount) {
        ignored++; // page footers, notices, totals text without amounts
        prevLine = null;
        continue;
      }
      if (rows.length >= MAX_IMPORT_ROWS) throw new ImportError(`More than ${MAX_IMPORT_ROWS} transaction lines.`, "too_many_rows");
      const idx = rows.length;
      rows.push(cells);
      locators.push(`page ${line.page}, line ${line.n}`);
      if (!hasDate) rowFlags.push({ row: idx, code: "no_date", message: "Line has an amount but no date — check against the statement" });
      if (ambiguous) rowFlags.push({ row: idx, code: "ambiguous_column", message: "A value sits between two columns; its column could not be determined reliably" });
      if (multiAmount) rowFlags.push({ row: idx, code: "multiple_values", message: "More than one numeric value fell into the same column" });
      prevLine = line;
    }

    if (rows.length === 0) throw new ImportError("A header row was found but no transaction lines below it.", "no_rows");
    const warnings: string[] = [];
    if (merged) warnings.push(`${merged} wrapped description line(s) were joined to the transaction above them.`);
    if (ignored) warnings.push(`${ignored} line(s) without a date or amount (headers, footers, notices) were not imported.`);
    if (repeatedHeaders) warnings.push(`The table header repeats on ${repeatedHeaders} later page(s); those header lines were skipped.`);
    if (!balances.opening || !balances.closing) warnings.push("Opening and/or closing balance lines were not found, so the statement balance cannot be cross-checked automatically.");

    return {
      kind: "pdf",
      filename: meta.filename,
      bytes: bytes.length,
      sha256: meta.sha256,
      headers: cols.map((c, i) => c.label || `Column ${i + 1}`),
      rows,
      locators,
      rowFlags,
      warnings,
      pages: pdf.numPages,
      balances,
      detectedCurrency: detectCurrency(lines.slice(0, headerAt).map((l) => l.tokens.map((t) => t.str).join(" "))) ?? undefined,
    };
  } finally {
    await task.destroy();
  }
}
