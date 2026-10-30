import { ImportError, type SourceKind } from "./types";

/**
 * Identify a file from its BYTES (magic numbers), cross-checked against its name.
 * Extensions alone are never trusted: a renamed file is rejected, not misparsed.
 */
export function sniff(bytes: Uint8Array, filename: string): SourceKind {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);

  if (bytes.length === 0) throw new ImportError("The file is empty.", "empty");

  // Legacy Excel 97–2003 (.xls) and other OLE2 compound documents: D0 CF 11 E0 A1 B1 1A E1.
  if (starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    throw new ImportError(
      "Legacy Excel (.xls) files are not supported. Open the file in Excel, LibreOffice or Google Sheets and save it as .xlsx (Excel Workbook) or .csv, then upload that file.",
      "legacy_xls",
    );
  }
  // %PDF-
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) {
    if (ext && ext !== "pdf") throw new ImportError(`The file content is a PDF but its name ends in .${ext}. Rename it to .pdf if that is intended.`, "extension_mismatch");
    return "pdf";
  }
  // ZIP container (PK\x03\x04). Only .xlsx is accepted; contents are validated by the XLSX reader.
  if (starts([0x50, 0x4b, 0x03, 0x04])) {
    if (ext === "xlsm" || ext === "xlsb") throw new ImportError("Macro-enabled (.xlsm) and binary (.xlsb) workbooks are not supported. Save as .xlsx without macros.", "unsupported_workbook");
    if (ext !== "xlsx") throw new ImportError(`Unsupported ZIP-based file (.${ext || "unknown"}). Upload an .xlsx workbook, a .csv file or a text-based PDF.`, "unsupported_zip");
    return "xlsx";
  }
  if (ext === "xls") {
    throw new ImportError("This .xls file is not a recognised spreadsheet. Save it as .xlsx or .csv and upload again.", "legacy_xls");
  }
  if (ext === "csv" || ext === "txt") {
    if (bytes.includes(0)) throw new ImportError("The file contains binary data and is not a valid CSV text file.", "binary_csv");
    return "csv";
  }
  throw new ImportError(`Unsupported file type${ext ? ` (.${ext})` : ""}. Supported: .csv, .xlsx and text-based .pdf.`, "unsupported_type");
}

/** Decode CSV bytes as UTF-8, rejecting invalid sequences instead of substituting characters. */
export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ImportError("The CSV file is not valid UTF-8 text. Export it again as “CSV UTF-8”.", "invalid_utf8");
  }
}
