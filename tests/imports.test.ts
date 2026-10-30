import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { validateMapping } from "@/engine/csv";
import { validateStatement } from "@/engine/statement";
import type { ColumnMapping } from "@/engine/types";
import { extractStatement } from "@/server/imports/extract";
import { sampleStatement, samplePdf, sampleXlsx } from "@/server/imports/samples";
import { signPreview, tableHash, TokenError, verifyPreview } from "@/server/imports/token";
import { ImportError, type ExtractedTable } from "@/server/imports/types";

const { PDFDocument, StandardFonts } = createRequire(import.meta.url)("pdf-lib") as typeof import("pdf-lib");

beforeAll(() => {
  // Test-only signing secret (not a real credential).
  process.env.BETTER_AUTH_SECRET ??= "test-secret-for-import-preview-signing-0123456789";
});

const enc = (s: string) => new TextEncoder().encode(s);

async function expectImportError(p: Promise<unknown> | (() => unknown), code: string) {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    expect((e as ImportError).code).toBe(code);
    return e as ImportError;
  }
  throw new Error(`expected ImportError ${code}`);
}

const STATEMENT_MAPPING: ColumnMapping = {
  date: "Date",
  description: "Description",
  reference: "Reference",
  debit: "Debit",
  credit: "Credit",
  balance: "Balance",
  defaultCurrency: "USD",
  dateFormat: "YYYY-MM-DD",
  decimalSeparator: ".",
};

function validate(t: ExtractedTable, mapping: ColumnMapping, excluded: number[] = []) {
  return validateStatement(
    { side: "bank", headers: t.headers, rows: t.rows, locators: t.locators, rowFlags: t.rowFlags, balances: t.balances, mapping, excluded: new Set(excluded) },
    validateMapping(t.headers, mapping),
  );
}

describe("file identification", () => {
  it("rejects legacy .xls with conversion guidance", async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const e = await expectImportError(extractStatement(ole, "statement.xls"), "legacy_xls");
    expect(e.message).toMatch(/save it as \.xlsx/i);
  });
  it("rejects an .xls name even with other content", async () => {
    await expectImportError(extractStatement(enc("Date,Amount\n"), "renamed.xls"), "legacy_xls");
  });
  it("rejects empty, binary-as-CSV, unknown types and PDF content under another extension", async () => {
    await expectImportError(extractStatement(new Uint8Array(), "x.csv"), "empty");
    await expectImportError(extractStatement(new Uint8Array([0x41, 0x00, 0x42]), "x.csv"), "binary_csv");
    await expectImportError(extractStatement(enc("hello"), "x.docx"), "unsupported_type");
    await expectImportError(extractStatement(enc("%PDF-1.7 ..."), "statement.csv"), "extension_mismatch");
  });
  it("rejects oversize files before parsing", async () => {
    await expectImportError(extractStatement(new Uint8Array(15 * 1024 * 1024 + 1), "big.csv"), "too_large");
  });
  it("sanitises path components out of filenames", async () => {
    const t = await extractStatement(enc("Date,Description,Amount\n2024-01-01,X,1.00\n"), "../../etc/passwd\u0000.csv");
    expect(t.filename).toBe("passwd.csv");
  });
});

describe("CSV extraction", () => {
  it("keeps cells as text and flags rows with the wrong field count", async () => {
    const t = await extractStatement(enc("Date,Description,Amount\n2024-01-01,Coffee,4.50\n2024-01-02,Bad row\n"), "s.csv");
    expect(t.rows[0]).toEqual(["2024-01-01", "Coffee", "4.50"]);
    expect(t.rowFlags).toContainEqual(expect.objectContaining({ row: 1, code: "field_count" }));
    expect(t.locators).toEqual(["line 2", "line 3"]);
  });
  it("rejects invalid UTF-8 instead of substituting characters", async () => {
    await expectImportError(extractStatement(new Uint8Array([0x44, 0x61, 0x74, 0x65, 0x0a, 0xff, 0xfe]), "s.csv"), "invalid_utf8");
  });
  it("rejects duplicate headers", async () => {
    await expectImportError(extractStatement(enc("Date,Amount,Amount\n2024-01-01,1,2\n"), "s.csv"), "bad_header");
  });
});

describe("XLSX extraction", () => {
  it("round-trips a synthetic statement exactly (amounts, dates, balances)", async () => {
    const s = sampleStatement(7, 200);
    const t = await extractStatement(await sampleXlsx(s), "statement.xlsx");
    expect(t.kind).toBe("xlsx");
    expect(t.sheet).toBe("Statement");
    expect(t.headers).toEqual(["Date", "Description", "Reference", "Debit", "Credit", "Balance", "Currency"]);
    // Two title rows + one blank row above the header; blank rows are not counted.
    expect(t.warnings.join(" ")).toMatch(/2 non-empty row\(s\) above the header/);
    expect(t.locators[0]).toBe("Statement!R5");
    const v = validate(t, { ...STATEMENT_MAPPING, currency: "Currency", defaultCurrency: undefined });
    expect(v.counts.errors).toBe(0);
    expect(v.transactions.map((x) => x.amountMinor)).toEqual(s.lines.map((l) => l.creditMinor - l.debitMinor));
    expect(v.transactions.map((x) => x.date)).toEqual(s.lines.map((l) => l.date));
    expect(v.runningBalance).toMatchObject({ checked: s.lines.length, mismatches: 0 });
  });

  async function workbook(build: (ws: ExcelJS.Worksheet) => void) {
    const wb = new ExcelJS.Workbook();
    build(wb.addWorksheet("S"));
    return new Uint8Array(await wb.xlsx.writeBuffer());
  }

  it("rejects floating-point artifacts rather than rounding them", async () => {
    const bytes = await workbook((ws) => {
      ws.addRow(["Date", "Description", "Amount"]);
      ws.addRow(["2024-01-01", "Float artifact", 0.1 + 0.2]);
      ws.addRow(["2024-01-02", "Clean", 12.5]);
    });
    const t = await extractStatement(bytes, "f.xlsx");
    expect(t.rows[0]![2]).toBe("0.30000000000000004");
    const v = validate(t, { date: "Date", description: "Description", amount: "Amount", defaultCurrency: "USD", dateFormat: "YYYY-MM-DD", decimalSeparator: "." });
    expect(v.rows[0]!.state).toBe("error");
    expect(v.rows[0]!.errors.join()).toMatch(/decimal places/);
    expect(v.rows[1]!.amountMinor).toBe("1250");
  });

  it("flags formulas that have no saved result", async () => {
    const bytes = await workbook((ws) => {
      ws.addRow(["Date", "Description", "Amount"]);
      ws.addRow(["2024-01-01", "Formula", { formula: "1+1" } as ExcelJS.CellFormulaValue]);
    });
    const t = await extractStatement(bytes, "formula.xlsx");
    expect(t.rowFlags[0]).toMatchObject({ row: 0, code: "cell" });
    const v = validate(t, { date: "Date", description: "Description", amount: "Amount", defaultCurrency: "USD", dateFormat: "YYYY-MM-DD", decimalSeparator: "." });
    expect(v.rows[0]!.state).toBe("error");
  });

  it("rejects macro workbooks, non-workbook ZIPs and zip bombs", async () => {
    const macro = new JSZip();
    macro.file("[Content_Types].xml", "<Types/>");
    macro.file("xl/workbook.xml", "<workbook/>");
    macro.file("xl/vbaProject.bin", "macro");
    await expectImportError(extractStatement(new Uint8Array(await macro.generateAsync({ type: "uint8array" })), "m.xlsx"), "macros");

    const docx = new JSZip();
    docx.file("[Content_Types].xml", "<Types/>");
    docx.file("word/document.xml", "<document/>");
    await expectImportError(extractStatement(new Uint8Array(await docx.generateAsync({ type: "uint8array" })), "fake.xlsx"), "not_xlsx");

    const bomb = new JSZip();
    bomb.file("[Content_Types].xml", "<Types/>");
    bomb.file("xl/workbook.xml", "<workbook/>");
    bomb.file("xl/worksheets/sheet1.xml", "0".repeat(20 * 1024 * 1024));
    const bombBytes = new Uint8Array(await bomb.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } }));
    expect(bombBytes.length).toBeLessThan(200_000);
    await expectImportError(extractStatement(bombBytes, "bomb.xlsx"), "zip_bomb");
  });

  it("rejects truncated / corrupt workbooks", async () => {
    const good = await sampleXlsx(sampleStatement(3, 60));
    await expectImportError(extractStatement(good.slice(0, Math.floor(good.length / 2)), "cut.xlsx"), "corrupt_zip");
  });
});

describe("PDF extraction", () => {
  it("extracts a multi-page statement exactly, with wrapped lines, repeated headers and a passing balance check", async () => {
    const s = sampleStatement(11, 300);
    expect(s.lines.length).toBeGreaterThan(100); // spans several pages
    const t = await extractStatement(await samplePdf(s, { wrapEvery: 9 }), "statement.pdf");
    expect(t.kind).toBe("pdf");
    expect(t.pages).toBeGreaterThan(2);
    expect(t.headers).toEqual(["Date", "Description", "Reference", "Debit", "Credit", "Balance"]);
    expect(t.rows).toHaveLength(s.lines.length);
    expect(t.warnings.join(" ")).toMatch(/wrapped description line/);
    expect(t.warnings.join(" ")).toMatch(/header repeats/);
    expect(t.balances?.opening?.raw).toBe("2,500,000.00");

    const v = validate(t, STATEMENT_MAPPING);
    expect(v.counts.errors).toBe(0);
    expect(v.transactions.map((x) => x.amountMinor)).toEqual(s.lines.map((l) => l.creditMinor - l.debitMinor));
    expect(v.transactions.map((x) => x.description)).toEqual(s.lines.map((l) => l.description));
    expect(v.balanceCheck).toMatchObject({ status: "pass", openingMinor: s.openingMinor, closingMinor: s.closingMinor });
    expect(v.runningBalance).toMatchObject({ mismatches: 0, order: "ascending" });
  });

  it("detects a missing line through the balance checks", async () => {
    const s = sampleStatement(12, 120);
    const t = await extractStatement(await samplePdf(s), "s.pdf");
    const v = validate(t, STATEMENT_MAPPING, [5]); // user excludes one line
    expect(v.balanceCheck.status).toBe("fail");
    if (v.balanceCheck.status === "fail") expect(v.balanceCheck.differenceMinor).toBe(s.lines[5]!.creditMinor - s.lines[5]!.debitMinor);
    expect(v.runningBalance.mismatches).toBeGreaterThan(0);
  });

  async function pdfWith(draw: (page: import("pdf-lib").PDFPage, font: import("pdf-lib").PDFFont) => void) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    draw(doc.addPage([595, 842]), font);
    return new Uint8Array(await doc.save());
  }

  it("rejects scanned / image-only PDFs instead of guessing", async () => {
    const bytes = await pdfWith((page) => page.drawRectangle({ x: 50, y: 50, width: 400, height: 600 }));
    const e = await expectImportError(extractStatement(bytes, "scan.pdf"), "scanned_pdf");
    expect(e.message).toMatch(/does not use OCR/);
  });

  it("rejects PDFs without a recognisable transaction table", async () => {
    const bytes = await pdfWith((page, font) => {
      for (let i = 0; i < 20; i++) page.drawText(`This is a letter paragraph number ${i} with no transaction table at all.`, { x: 40, y: 780 - i * 14, size: 9, font });
    });
    await expectImportError(extractStatement(bytes, "letter.pdf"), "unrecognised_layout");
  });

  it("rejects corrupt PDFs", async () => {
    await expectImportError(extractStatement(enc("%PDF-1.7\n1 0 obj << garbage >>\n%%EOF"), "bad.pdf"), "corrupt_pdf");
  });

  it("flags a value straddling two columns as ambiguous (blocking)", async () => {
    const bytes = await pdfWith((page, font) => {
      const t = (s: string, x: number, y: number) => page.drawText(s, { x, y, size: 9, font });
      t("Date", 40, 760); t("Description", 110, 760); t("Debit", 380, 760); t("Credit", 450, 760); t("Balance", 520, 760);
      for (let i = 0; i < 6; i++) { t(`2024-07-0${i + 1}`, 40, 744 - i * 14); t(`Ordinary line ${i}`, 110, 744 - i * 14); t("10.00", 450, 744 - i * 14); }
      t("2024-07-09", 40, 650); t("Straddling amount", 110, 650); t("123,456.78", 405, 650); // between Debit and Credit
    });
    const t = await extractStatement(bytes, "amb.pdf");
    const amb = t.rowFlags.find((f) => f.code === "ambiguous_column");
    expect(amb).toBeDefined();
    const v = validate(t, { date: "Date", description: "Description", debit: "Debit", credit: "Credit", defaultCurrency: "USD", dateFormat: "YYYY-MM-DD", decimalSeparator: "." });
    expect(v.rows[amb!.row]!.state).toBe("error");
  });
});

describe("currency detection", () => {
  it("detects the single currency stated in a PDF statement's header text", async () => {
    const t = await extractStatement(await samplePdf(sampleStatement(5, 80)), "s.pdf");
    expect(t.detectedCurrency).toBe("USD");
  });
  it("detects it from XLSX title rows", async () => {
    const t = await extractStatement(await sampleXlsx(sampleStatement(5, 80)), "s.xlsx");
    expect(t.detectedCurrency).toBe("USD");
  });
  it("never guesses: none, several, or lowercase words give no suggestion", async () => {
    const { detectCurrency } = await import("@/server/imports/currency");
    expect(detectCurrency(["Account statement"])).toBeNull();
    expect(detectCurrency(["Balances in USD and EUR"])).toBeNull();
    expect(detectCurrency(["Please try again"])).toBeNull();
    expect(detectCurrency(["Currency: GBP", "GBP account"])).toBe("GBP");
  });
});

describe("signed preview", () => {
  const ctx = { orgId: "org_1", userId: "user_1", side: "bank" as const };
  async function table() {
    return extractStatement(enc("Date,Description,Amount\n2024-01-01,Coffee,4.50\n2024-01-02,Rent,-1200.00\n"), "s.csv");
  }

  it("verifies an untouched preview", async () => {
    const t = await table();
    const claims = verifyPreview(signPreview(t, ctx), t, ctx);
    expect(claims).toMatchObject({ org: "org_1", kind: "csv", rowCount: 2, sha256: t.sha256 });
  });

  it("rejects any change to an amount, row, flag or balance after extraction", async () => {
    const t = await table();
    const token = signPreview(t, ctx);
    const altered = { ...t, rows: t.rows.map((r) => [...r]) };
    altered.rows[1]![2] = "-12.00";
    expect(() => verifyPreview(token, altered, ctx)).toThrow(/differ from the extracted preview/);
    expect(() => verifyPreview(token, { ...t, rows: t.rows.slice(1) }, ctx)).toThrow(TokenError);
    expect(() => verifyPreview(token, { ...t, rowFlags: [] , warnings: ["x"] }, ctx)).toThrow(TokenError);
    expect(() => verifyPreview(token, { ...t, balances: { closing: { raw: "1", location: "x" } } }, ctx)).toThrow(TokenError);
  });

  it("is bound to workspace, user, side and time, and cannot be forged", async () => {
    const t = await table();
    const token = signPreview(t, ctx, Date.now() - 31 * 60 * 1000);
    expect(() => verifyPreview(signPreview(t, ctx), t, { ...ctx, orgId: "org_2" })).toThrow(/different user or workspace/);
    expect(() => verifyPreview(signPreview(t, ctx), t, { ...ctx, userId: "user_2" })).toThrow(/different user or workspace/);
    expect(() => verifyPreview(signPreview(t, ctx), t, { ...ctx, side: "ledger" })).toThrow(/other side/);
    expect(() => verifyPreview(token, t, ctx)).toThrow(/expired/);
    const [body] = signPreview(t, ctx).split(".");
    const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), org: "org_2" })).toString("base64url");
    expect(() => verifyPreview(`${forgedBody}.${signPreview(t, ctx).split(".")[1]}`, t, { ...ctx, orgId: "org_2" })).toThrow(/signature is invalid/);
    expect(() => verifyPreview("garbage", t, ctx)).toThrow(TokenError);
    expect(tableHash(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("statement validation", () => {
  const mapping: ColumnMapping = { date: "Date", description: "Description", reference: "Ref", debit: "Debit", credit: "Credit", defaultCurrency: "USD", dateFormat: "YYYY-MM-DD", decimalSeparator: "." };
  const base = (rows: string[][]) => ({ side: "bank" as const, headers: ["Date", "Description", "Ref", "Debit", "Credit"], rows, locators: rows.map((_, i) => `line ${i + 2}`), rowFlags: [], mapping, excluded: new Set<number>() });

  it("rejects ambiguous amounts (debit AND credit) and bad values; excluded rows are skipped", () => {
    const rows = [
      ["2024-01-01", "OK", "R1", "", "100.00"],
      ["2024-01-02", "Both sides", "R2", "5.00", "5.00"],
      ["2024-01-03", "Too precise", "R3", "1.005", ""],
      ["2024-02-30", "Bad date", "R4", "", "1.00"],
    ];
    const v = validateStatement(base(rows));
    expect(v.rows.map((r) => r.state)).toEqual(["ok", "error", "error", "error"]);
    expect(v.rows[1]!.errors.join()).toMatch(/both a debit and a credit/);
    const ex = validateStatement({ ...base(rows), excluded: new Set([1, 2, 3]) });
    expect(ex.counts).toMatchObject({ ok: 1, errors: 0, excluded: 3 });
    expect(ex.transactions.map((t) => t.amountMinor)).toEqual([10000n]);
  });

  it("warns about possible duplicates within the file without removing them", () => {
    const v = validateStatement(base([["2024-01-01", "Coffee", "R1", "4.50", ""], ["2024-01-01", "Coffee", "R1", "4.50", ""]]));
    expect(v.transactions).toHaveLength(2);
    expect(v.rows.every((r) => r.state === "warning" && r.warnings.some((w) => /Possible duplicate/.test(w)))).toBe(true);
  });

  it("parses DD MMM YYYY dates strictly", () => {
    const v = validateStatement({ ...base([["03 Jul 2024", "A", "R1", "", "1.00"], ["31 Jun 2024", "B", "R2", "", "1.00"]]), mapping: { ...mapping, dateFormat: "DD MMM YYYY" } });
    expect(v.transactions[0]!.date).toBe("2024-07-03");
    expect(v.rows[1]!.state).toBe("error");
  });
});
