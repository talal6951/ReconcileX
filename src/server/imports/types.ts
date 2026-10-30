/** Shapes shared by the statement extractors. No amounts are interpreted here — cells stay as text. */

export type SourceKind = "csv" | "xlsx" | "pdf";

export const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 100_000;
export const MAX_IMPORT_COLUMNS = 60;

export class ImportError extends Error {
  constructor(
    message: string,
    /** Stable code for UI/tests, e.g. "legacy_xls", "scanned_pdf". */
    readonly code: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export interface StatementBalances {
  /** Raw text exactly as printed; parsed later with the confirmed mapping (currency, decimal separator). */
  opening?: { raw: string; location: string };
  closing?: { raw: string; location: string };
}

/** A rectangular table of TEXT cells plus provenance. Amounts are never parsed or altered here. */
export interface ExtractedTable {
  kind: SourceKind;
  filename: string;
  bytes: number;
  /** SHA-256 of the original uploaded bytes. */
  sha256: string;
  headers: string[];
  rows: string[][];
  /** Human-readable source location for each row, e.g. "Sheet1!R14" or "page 2, line 17". */
  locators: string[];
  /** Per-row extraction concerns (e.g. ambiguous column position). Rows with these require attention. */
  rowFlags: { row: number; code: string; message: string }[];
  warnings: string[];
  sheets?: string[];
  sheet?: string;
  pages?: number;
  balances?: StatementBalances;
  /** Currency stated in the document's title/account text, when exactly one code is present. A suggestion only. */
  detectedCurrency?: string;
}
