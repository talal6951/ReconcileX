import ExcelJS from "exceljs";
import Papa from "papaparse";
import { createRequire } from "node:module";
import { formatMinor, toDecimalString } from "@/engine/money";
import { generateSynthetic } from "@/engine/synthetic";

/**
 * Synthetic statement files (PDF / XLSX) with known ground truth, for demos and
 * tests. Clearly labelled as synthetic; no real bank, account or person.
 */

// pdf-lib's ESM build is not Node-resolvable; load its CommonJS entry.
const { PDFDocument, StandardFonts, rgb } = createRequire(import.meta.url)("pdf-lib") as typeof import("pdf-lib");

export interface SampleLine {
  date: string;
  description: string;
  reference: string;
  /** Money out (positive minor units) or 0. */
  debitMinor: bigint;
  /** Money in (positive minor units) or 0. */
  creditMinor: bigint;
  balanceMinor: bigint;
}

export interface SampleStatement {
  currency: string;
  openingMinor: bigint;
  closingMinor: bigint;
  lines: SampleLine[];
}

/** Bank-side USD lines from the synthetic generator, in date order, with running balances. */
export function sampleStatement(seed: number, events: number, currency = "USD"): SampleStatement {
  const ds = generateSynthetic(seed, events);
  const tx = ds.bank.filter((t) => t.currency === currency).sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
  const openingMinor = 2_500_000_00n;
  let bal = openingMinor;
  const lines = tx.map((t) => {
    bal += t.amountMinor;
    return {
      date: t.date,
      description: t.description,
      reference: t.reference || t.externalId,
      debitMinor: t.amountMinor < 0n ? -t.amountMinor : 0n,
      creditMinor: t.amountMinor > 0n ? t.amountMinor : 0n,
      balanceMinor: bal,
    };
  });
  return { currency, openingMinor, closingMinor: bal, lines };
}

const money = (m: bigint, ccy: string) => formatMinor(m, ccy);

/** The ledger side of the same synthetic dataset (one currency), as CSV — pairs with sampleStatement(). */
export function sampleLedgerCsv(seed: number, events: number, currency = "USD"): string {
  const ds = generateSynthetic(seed, events);
  const rows = ds.ledger.filter((t) => t.currency === currency).sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
  return Papa.unparse({
    fields: ["Entry ID", "Date", "Reference", "Memo", "Counterparty", "Amount", "Currency"],
    data: rows.map((t) => [t.externalId, t.date, t.reference, t.description, t.counterparty, toDecimalString(t.amountMinor, t.currency), t.currency]),
  });
}

/** Multi-page text PDF: title block, repeated table header, wrapped descriptions, opening/closing balance, page footers. */
export async function samplePdf(s: SampleStatement, opts: { wrapEvery?: number } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Synthetic demo statement");
  doc.setProducer("Reconcile X synthetic data");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = 8;
  // Column layout: left-aligned text columns, right-aligned numeric columns (right edges).
  const COL = { date: 36, desc: 100, ref: 300, debitR: 430, creditR: 495, balanceR: 565 };
  const LINE = 11;
  const BOTTOM = 60; // keep clear of the footer at y = 30
  const right = (page: import("pdf-lib").PDFPage, text: string, xr: number, y: number, f = font) => page.drawText(text, { x: xr - f.widthOfTextAtSize(text, size), y, size, font: f });

  let page = doc.addPage([595, 842]);
  let y = 800;
  page.drawText("SYNTHETIC DEMO BANK — not a real institution", { x: 36, y, size: 11, font: bold, color: rgb(0.05, 0.1, 0.2) });
  y -= 14;
  page.drawText(`Account XXXX-0042 · Currency ${s.currency} · Synthetic data for demonstration only`, { x: 36, y, size, font });
  y -= 22;
  const tableHeader = () => {
    page.drawText("Date", { x: COL.date, y, size, font: bold });
    page.drawText("Description", { x: COL.desc, y, size, font: bold });
    page.drawText("Reference", { x: COL.ref, y, size, font: bold });
    right(page, "Debit", COL.debitR, y, bold);
    right(page, "Credit", COL.creditR, y, bold);
    right(page, "Balance", COL.balanceR, y, bold);
    y -= 14;
  };
  /** Start a new page (with a repeated table header) unless `needed` points still fit. */
  const ensureSpace = (needed: number) => {
    if (y - needed >= BOTTOM) return;
    page = doc.addPage([595, 842]);
    y = 800;
    tableHeader();
  };
  tableHeader();
  page.drawText("Opening balance", { x: COL.desc, y, size, font });
  right(page, money(s.openingMinor, s.currency), COL.balanceR, y);
  y -= 12;

  s.lines.forEach((l, k) => {
    // Like real statements, text never overflows its column: wrap when the description is too wide
    // (and, optionally, every Nth line to exercise multi-line descriptions).
    const tooWide = font.widthOfTextAtSize(l.description, size) > COL.ref - COL.desc - 10;
    const wrap = tooWide || (opts.wrapEvery !== undefined && k % opts.wrapEvery === 0);
    const [first, second] = wrap ? splitDesc(l.description) : [l.description, ""];
    ensureSpace(second ? 2 * LINE : LINE); // a transaction and its continuation stay on one page
    page.drawText(l.date, { x: COL.date, y, size, font });
    page.drawText(first, { x: COL.desc, y, size, font });
    page.drawText(l.reference.slice(0, 24), { x: COL.ref, y, size, font });
    if (l.debitMinor) right(page, money(l.debitMinor, s.currency), COL.debitR, y);
    if (l.creditMinor) right(page, money(l.creditMinor, s.currency), COL.creditR, y);
    right(page, money(l.balanceMinor, s.currency), COL.balanceR, y);
    y -= LINE;
    if (second) {
      page.drawText(second, { x: COL.desc, y, size, font });
      y -= LINE;
    }
  });
  ensureSpace(LINE + 4);
  y -= 4;
  page.drawText("Closing balance", { x: COL.desc, y, size, font });
  right(page, money(s.closingMinor, s.currency), COL.balanceR, y);

  const pages = doc.getPages();
  pages.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages.length} · Synthetic statement generated by Reconcile X`, { x: 36, y: 30, size: 7, font }));
  return doc.save();
}

function splitDesc(d: string): [string, string] {
  const words = d.split(" ");
  const half = Math.ceil(words.length / 2);
  return words.length > 1 ? [words.slice(0, half).join(" "), words.slice(half).join(" ")] : [d, ""];
}

/** XLSX with title rows above the table, real Date cells and numeric amount cells. */
export async function sampleXlsx(s: SampleStatement): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Reconcile X synthetic data";
  const ws = wb.addWorksheet("Statement");
  ws.addRow(["SYNTHETIC DEMO BANK — not a real institution"]);
  ws.addRow([`Account XXXX-0042 · ${s.currency} · synthetic data for demonstration only`]);
  ws.addRow([]);
  ws.addRow(["Date", "Description", "Reference", "Debit", "Credit", "Balance", "Currency"]);
  for (const l of s.lines) {
    // Decimal string → Number: exact shortest round-trip for 2-decimal amounts (verified in tests).
    const num = (m: bigint) => (m === 0n ? null : Number(toDecimalString(m, s.currency)));
    ws.addRow([new Date(`${l.date}T00:00:00Z`), l.description, l.reference, num(l.debitMinor), num(l.creditMinor), Number(toDecimalString(l.balanceMinor, s.currency)), s.currency]);
  }
  ws.getColumn(1).numFmt = "yyyy-mm-dd";
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
