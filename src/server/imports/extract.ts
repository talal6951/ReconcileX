import { createHash } from "node:crypto";
import { extractCsv } from "./csv";
import { extractPdf } from "./pdf";
import { sniff } from "./sniff";
import { ImportError, MAX_IMPORT_BYTES, type ExtractedTable } from "./types";
import { extractXlsx } from "./xlsx";

/** Single entry point: size check → hash original bytes → identify by content → extract to a text table. */
export async function extractStatement(bytes: Uint8Array, rawFilename: string, opts: { sheet?: string } = {}): Promise<ExtractedTable> {
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportError(`The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`, "too_large");
  const filename = sanitizeFilename(rawFilename);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const kind = sniff(bytes, filename);
  const meta = { filename, sha256 };
  switch (kind) {
    case "csv":
      return extractCsv(bytes, meta);
    case "xlsx":
      return extractXlsx(bytes, meta, opts.sheet);
    case "pdf":
      return extractPdf(bytes, meta);
  }
}

/** Keep only a safe display name (no paths, control characters or excessive length). */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "upload";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160);
  return clean || "upload";
}
