import { parseCsv } from "@/engine/csv";
import { decodeUtf8 } from "./sniff";
import { ImportError, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS, type ExtractedTable } from "./types";

/** CSV → text table. Structural problems are reported per row; nothing is repaired or re-ordered. */
export function extractCsv(bytes: Uint8Array, meta: { filename: string; sha256: string }): ExtractedTable {
  const parsed = parseCsv(decodeUtf8(bytes));
  const headerProblems = parsed.errors.filter((e) => e.line === 1);
  if (parsed.headers.length === 0) throw new ImportError("The CSV file has no header row.", "no_header");
  if (headerProblems.length) throw new ImportError(`The CSV header row is invalid: ${headerProblems.map((e) => e.message).join("; ")}.`, "bad_header");
  if (parsed.headers.length > MAX_IMPORT_COLUMNS) throw new ImportError(`The CSV has more than ${MAX_IMPORT_COLUMNS} columns.`, "too_many_columns");
  if (parsed.rows.length === 0) throw new ImportError("The CSV file has a header but no data rows.", "no_rows");
  if (parsed.rows.length > MAX_IMPORT_ROWS) throw new ImportError(`The CSV has more than ${MAX_IMPORT_ROWS} rows.`, "too_many_rows");

  const width = parsed.headers.length;
  const rowFlags: ExtractedTable["rowFlags"] = [];
  const rows = parsed.rows.map((r, i) => {
    if (r.length !== width) rowFlags.push({ row: i, code: "field_count", message: `Row has ${r.length} fields; the header has ${width}` });
    const cells = r.slice(0, width).map((c) => c.trim());
    while (cells.length < width) cells.push("");
    return cells;
  });
  for (const e of parsed.errors) {
    if (e.line > 1) rowFlags.push({ row: e.line - 2, code: "csv_syntax", message: e.message });
  }
  return {
    kind: "csv",
    filename: meta.filename,
    bytes: bytes.length,
    sha256: meta.sha256,
    headers: parsed.headers,
    rows,
    locators: rows.map((_, i) => `line ${i + 2}`),
    rowFlags: dedupeFlags(rowFlags),
    warnings: [],
  };
}

function dedupeFlags(flags: ExtractedTable["rowFlags"]) {
  const seen = new Set<string>();
  return flags.filter((f) => {
    const k = `${f.row}|${f.code}|${f.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
