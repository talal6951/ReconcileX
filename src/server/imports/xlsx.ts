import ExcelJS from "exceljs";
import { headerScore } from "@/engine/csv";
import { detectCurrency } from "./currency";
import { assertSafeWorkbookZip } from "./zip-guard";
import { ImportError, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS, type ExtractedTable } from "./types";

/**
 * Convert one cell to TEXT without reinterpretation:
 *  - numbers → shortest round-trip decimal (JS String()); float artifacts such as
 *    0.30000000000000004 remain visible and are rejected later by the strict money parser
 *  - dates → ISO calendar day (ExcelJS dates are UTC)
 *  - formulas → their cached result; a formula with no cached result is flagged
 */
export function cellText(value: ExcelJS.CellValue): { text: string; flag?: string } {
  if (value === null || value === undefined) return { text: "" };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { text: "", flag: "non-finite number" };
    return { text: String(value) };
  }
  if (typeof value === "string") return { text: value };
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE" };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { text: "", flag: "invalid date" };
    return { text: value.toISOString().slice(0, 10) };
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return { text: value.richText.map((r) => r.text).join("") };
    if ("error" in value) return { text: "", flag: `cell error ${String(value.error)}` };
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as { result?: ExcelJS.CellValue }).result;
      if (result === undefined || result === null) return { text: "", flag: "formula without a saved result (open and re-save the workbook in Excel)" };
      return cellText(result);
    }
    if ("text" in value && typeof value.text === "string") return { text: value.text };
  }
  return { text: String(value), flag: "unrecognised cell type" };
}

function uniqueHeaders(raw: string[]): { headers: string[]; renamed: string[] } {
  const seen = new Map<string, number>();
  const renamed: string[] = [];
  const headers = raw.map((h, i) => {
    let name = h.trim() || `Column ${i + 1}`;
    if (!h.trim()) renamed.push(`Column ${i + 1} had no header`);
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) {
      renamed.push(`Duplicate header "${name}" renamed to "${name} (${n})"`);
      name = `${name} (${n})`;
    }
    return name;
  });
  return { headers, renamed };
}

export async function extractXlsx(bytes: Uint8Array, meta: { filename: string; sha256: string }, sheetName?: string): Promise<ExtractedTable> {
  assertSafeWorkbookZip(bytes);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    throw new ImportError("The workbook could not be read. It may be corrupted, password-protected or not a real .xlsx file.", "xlsx_unreadable");
  }
  const sheets = wb.worksheets.filter((w) => w.state !== "veryHidden").map((w) => w.name);
  if (sheets.length === 0) throw new ImportError("The workbook contains no worksheets.", "no_sheets");
  const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets.find((w) => w.actualRowCount > 0) ?? wb.worksheets[0];
  if (!ws) throw new ImportError(`Worksheet "${sheetName}" was not found.`, "no_sheet");
  if (ws.actualRowCount === 0) throw new ImportError(`Worksheet "${ws.name}" is empty.`, "empty_sheet");
  if (ws.rowCount > MAX_IMPORT_ROWS + 50) throw new ImportError(`Worksheet "${ws.name}" has ${ws.rowCount} rows; the maximum is ${MAX_IMPORT_ROWS}.`, "too_many_rows");

  // Read all rows as text, keeping their real sheet row numbers.
  const rowsAll: { n: number; cells: string[]; flags: string[] }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const cells: string[] = [];
    const flags: string[] = [];
    const width = Math.min(row.cellCount, MAX_IMPORT_COLUMNS + 1);
    for (let c = 1; c <= width; c++) {
      const { text, flag } = cellText(row.getCell(c).value);
      cells.push(text.trim());
      if (flag) flags.push(`column ${c}: ${flag}`);
    }
    if (cells.some((v) => v !== "")) rowsAll.push({ n, cells, flags });
  });
  if (rowsAll.length === 0) throw new ImportError(`Worksheet "${ws.name}" has no data.`, "empty_sheet");

  // Header row: the best-scoring row among the first 30 (statements often have title rows above the table).
  const candidates = rowsAll.slice(0, 30);
  let headerIdx = 0;
  let best = -1;
  candidates.forEach((r, i) => {
    const s = headerScore(r.cells);
    if (s > best) {
      best = s;
      headerIdx = i;
    }
  });
  const warnings: string[] = [];
  if (best < 2) warnings.push("No clear header row was found; the first non-empty row is used as headers. Check the column mapping carefully.");
  if (headerIdx > 0) warnings.push(`${headerIdx} non-empty row(s) above the header row (titles, account details) were not imported.`);

  const headerRow = rowsAll[headerIdx]!;
  let width = headerRow.cells.length;
  while (width > 0 && headerRow.cells[width - 1] === "") width--;
  if (width > MAX_IMPORT_COLUMNS) throw new ImportError(`The table has more than ${MAX_IMPORT_COLUMNS} columns.`, "too_many_columns");
  const { headers, renamed } = uniqueHeaders(headerRow.cells.slice(0, width));
  warnings.push(...renamed);

  const rows: string[][] = [];
  const locators: string[] = [];
  const rowFlags: ExtractedTable["rowFlags"] = [];
  let overflow = 0;
  for (const r of rowsAll.slice(headerIdx + 1)) {
    if (rows.length >= MAX_IMPORT_ROWS) throw new ImportError(`More than ${MAX_IMPORT_ROWS} data rows.`, "too_many_rows");
    const cells = r.cells.slice(0, width);
    while (cells.length < width) cells.push("");
    if (r.cells.slice(width).some((v) => v !== "")) overflow++;
    if (cells.every((v) => v === "")) continue;
    const idx = rows.length;
    rows.push(cells);
    locators.push(`${ws.name}!R${r.n}`);
    for (const f of r.flags) rowFlags.push({ row: idx, code: "cell", message: f });
  }
  if (overflow) warnings.push(`${overflow} row(s) contain values to the right of the last header column; those values were not imported.`);
  if (rows.length === 0) throw new ImportError("No data rows were found below the header row.", "no_rows");

  const detectedCurrency = detectCurrency(rowsAll.slice(0, headerIdx).flatMap((r) => r.cells)) ?? undefined;
  return { kind: "xlsx", filename: meta.filename, bytes: bytes.length, sha256: meta.sha256, headers, rows, locators, rowFlags, warnings, sheets, sheet: ws.name, detectedCurrency };
}
