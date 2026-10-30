import { ImportError } from "./types";

/**
 * Inspect a ZIP container's central directory BEFORE any decompression.
 * Rejects zip bombs (excessive declared size, entry count or compression ratio),
 * macro-enabled workbooks, and ZIPs that are not Excel workbooks.
 */
export const ZIP_LIMITS = {
  maxEntries: 2_000,
  maxTotalUncompressed: 200 * 1024 * 1024,
  maxEntryRatio: 200,
};

export interface ZipEntry {
  name: string;
  compressed: number;
  uncompressed: number;
}

export function readCentralDirectory(buf: Uint8Array): ZipEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End-of-central-directory record: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ImportError("The workbook is not a valid ZIP container (it may be corrupted or truncated).", "corrupt_zip");
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ImportError("ZIP64 workbooks are not supported.", "zip64");
  if (cdOffset + cdSize > buf.length) throw new ImportError("The workbook's ZIP directory is out of bounds (corrupted file).", "corrupt_zip");
  if (count > ZIP_LIMITS.maxEntries) throw new ImportError(`The workbook contains too many parts (${count}).`, "zip_entries");

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || view.getUint32(p, true) !== 0x02014b50) throw new ImportError("The workbook's ZIP directory is malformed.", "corrupt_zip");
    const compressed = view.getUint32(p + 20, true);
    const uncompressed = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, compressed, uncompressed });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function assertSafeWorkbookZip(buf: Uint8Array): void {
  const entries = readCentralDirectory(buf);
  let total = 0;
  for (const e of entries) {
    total += e.uncompressed;
    if (e.compressed > 0 && e.uncompressed / e.compressed > ZIP_LIMITS.maxEntryRatio && e.uncompressed > 1024 * 1024) {
      throw new ImportError("The workbook is suspiciously compressed (possible zip bomb) and was rejected.", "zip_bomb");
    }
  }
  if (total > ZIP_LIMITS.maxTotalUncompressed) throw new ImportError("The workbook expands to more than 200 MB and was rejected.", "zip_bomb");
  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  if ([...names].some((n) => n.endsWith("vbaproject.bin"))) throw new ImportError("Macro-enabled workbooks are not accepted. Save as .xlsx without macros.", "macros");
  if (!names.has("xl/workbook.xml") || !names.has("[content_types].xml")) {
    throw new ImportError("This ZIP file is not an Excel workbook (.xlsx).", "not_xlsx");
  }
}
