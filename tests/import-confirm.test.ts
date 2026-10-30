import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { suggestMapping } from "@/engine/csv";
import { defaultModel } from "@/engine/default-model";
import type { ColumnMapping, Side } from "@/engine/types";
import { listAudit, verifyAuditChain } from "@/server/audit";
import { openDatabase, type DB } from "@/server/db";
import { confirmImportRun, type ConfirmSide } from "@/server/imports/confirm";
import { extractStatement } from "@/server/imports/extract";
import { sampleLedgerCsv, samplePdf, sampleStatement, sampleXlsx } from "@/server/imports/samples";
import { signPreview } from "@/server/imports/token";
import type { ExtractedTable } from "@/server/imports/types";
import { listRuns, loadRun, ValidationError } from "@/server/repo";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET ??= "test-secret-for-import-preview-signing-0123456789";
});

const ORG = "org_imports";
const ctx = { orgId: ORG, userId: "user_1", actor: "Ana Reviewer <ana@example.test>" };
const SEED = 21, EVENTS = 180;

const BANK_MAPPING: ColumnMapping = {
  date: "Date", description: "Description", reference: "Reference", debit: "Debit", credit: "Credit", balance: "Balance",
  defaultCurrency: "USD", dateFormat: "YYYY-MM-DD", decimalSeparator: ".",
};

let db: DB;
beforeEach(() => {
  db = openDatabase(":memory:");
});

const pick = (t: ExtractedTable) => ({ headers: t.headers, rows: t.rows, locators: t.locators, rowFlags: t.rowFlags, warnings: t.warnings, balances: t.balances });

async function side(t: ExtractedTable, s: Side, mapping: ColumnMapping, extra: Partial<ConfirmSide> = {}, signer = ctx): Promise<ConfirmSide> {
  return { token: signPreview(t, { orgId: signer.orgId, userId: signer.userId, side: s }), extraction: pick(t), mapping, excludedRows: [], confirmed: true, ...extra };
}

async function fixtures() {
  const truth = sampleStatement(SEED, EVENTS);
  const bank = await extractStatement(await samplePdf(truth, { wrapEvery: 6 }), "statement.pdf");
  const ledger = await extractStatement(new TextEncoder().encode(sampleLedgerCsv(SEED, EVENTS)), "ledger.csv");
  const ledgerMapping = suggestMapping(ledger.headers, ledger.rows).mapping as ColumnMapping;
  return { truth, bank, ledger, ledgerMapping };
}

describe("confirmImportRun", () => {
  it("imports a confirmed PDF + CSV pair exactly, with provenance and an audited confirmation", async () => {
    const { truth, bank, ledger, ledgerMapping } = await fixtures();
    const out = confirmImportRun(db, ctx, { name: "PDF import", bank: await side(bank, "bank", BANK_MAPPING), ledger: await side(ledger, "ledger", ledgerMapping) }, defaultModel);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const data = loadRun(db, ORG, out.runId);
    // Amounts and dates saved exactly as on the statement, in statement order, with original row numbers.
    expect(data.bank.map((t) => t.amountMinor)).toEqual(truth.lines.map((l) => l.creditMinor - l.debitMinor));
    expect(data.bank.map((t) => t.date)).toEqual(truth.lines.map((l) => l.date));
    expect(data.bank.map((t) => t.sourceLine)).toEqual(truth.lines.map((_, i) => i + 1));
    expect(data.matches.length).toBeGreaterThan(0);

    const ds = db.prepare("SELECT side, source_kind, source_sha256, source_bytes, extraction_json, confirmed_by, confirmed_at FROM datasets ORDER BY side").all() as Record<string, string | number>[];
    const b = ds.find((d) => d.side === "bank")!;
    expect(b.source_kind).toBe("pdf");
    expect(b.source_sha256).toBe(bank.sha256);
    expect(b.source_bytes).toBe(bank.bytes);
    expect(b.confirmed_by).toBe(ctx.actor);
    const ex = JSON.parse(b.extraction_json as string);
    expect(ex.balanceCheck.status).toBe("pass");
    expect(ex.excluded).toEqual([]);
    expect(ds.find((d) => d.side === "ledger")!.source_kind).toBe("csv");

    const imported = listAudit(db, { orgId: ORG }).filter((e) => e.action === "dataset.imported");
    expect(imported).toHaveLength(2);
    expect(imported.find((e) => e.details.side === "bank")!.details).toMatchObject({ sourceKind: "pdf", confirmed: true, confirmedBy: ctx.actor, balanceCheck: "pass", excludedRows: 0 });
    expect(verifyAuditChain(db, ORG).ok).toBe(true);
  });

  it("imports XLSX statements the same way", async () => {
    const { truth, ledger, ledgerMapping } = await fixtures();
    const bank = await extractStatement(await sampleXlsx(truth), "statement.xlsx");
    const out = confirmImportRun(db, ctx, { name: "XLSX", bank: await side(bank, "bank", { ...BANK_MAPPING, currency: "Currency", defaultCurrency: undefined }), ledger: await side(ledger, "ledger", ledgerMapping) }, defaultModel);
    expect(out.ok).toBe(true);
    if (out.ok) expect(loadRun(db, ORG, out.runId).bank.map((t) => t.amountMinor)).toEqual(truth.lines.map((l) => l.creditMinor - l.debitMinor));
  });

  it("saves nothing without explicit confirmation", async () => {
    const { bank, ledger, ledgerMapping } = await fixtures();
    const unconfirmed = { ...(await side(bank, "bank", BANK_MAPPING)), confirmed: false };
    const ledgerSide = await side(ledger, "ledger", ledgerMapping);
    expect(() => confirmImportRun(db, ctx, { name: "x", bank: unconfirmed, ledger: ledgerSide }, defaultModel)).toThrow(/Confirm that you have checked/);
    expect(listRuns(db, ORG)).toHaveLength(0);
  });

  it("rejects amounts changed after extraction", async () => {
    const { bank, ledger, ledgerMapping } = await fixtures();
    const s = await side(bank, "bank", BANK_MAPPING);
    const rows = s.extraction.rows.map((r) => [...r]);
    const col = s.extraction.headers.indexOf("Credit");
    const i = rows.findIndex((r) => r[col]);
    rows[i]![col] = "1.00";
    const ledgerSide = await side(ledger, "ledger", ledgerMapping);
    expect(() => confirmImportRun(db, ctx, { name: "x", bank: { ...s, extraction: { ...s.extraction, rows } }, ledger: ledgerSide }, defaultModel)).toThrow(/differ from the extracted preview/);
    expect(listRuns(db, ORG)).toHaveLength(0);
  });

  it("rejects previews signed for another workspace, user or side", async () => {
    const { bank, ledger, ledgerMapping } = await fixtures();
    const ledgerSide = await side(ledger, "ledger", ledgerMapping);
    const foreign = await side(bank, "bank", BANK_MAPPING, {}, { ...ctx, orgId: "org_other" });
    expect(() => confirmImportRun(db, ctx, { name: "x", bank: foreign, ledger: ledgerSide }, defaultModel)).toThrow(ValidationError);
    const otherUser = await side(bank, "bank", BANK_MAPPING, {}, { ...ctx, userId: "user_2" });
    expect(() => confirmImportRun(db, ctx, { name: "x", bank: otherUser, ledger: ledgerSide }, defaultModel)).toThrow(/different user or workspace/);
    const swapped = { ...(await side(bank, "ledger", BANK_MAPPING)) };
    expect(() => confirmImportRun(db, ctx, { name: "x", bank: swapped, ledger: ledgerSide }, defaultModel)).toThrow(/other side/);
    expect(listRuns(db, ORG)).toHaveLength(0);
  });

  it("blocks rows with errors until they are explicitly excluded, and records exclusions verbatim", async () => {
    const { ledger, ledgerMapping } = await fixtures();
    const csv = "Date,Description,Reference,Debit,Credit\n2024-07-01,Good,R1,,100.00\n2024-07-02,Both sides,R2,5.00,5.00\n2024-07-03,Also good,R3,20.00,\n";
    const bank = await extractStatement(new TextEncoder().encode(csv), "bank.csv");
    const mapping: ColumnMapping = { date: "Date", description: "Description", reference: "Reference", debit: "Debit", credit: "Credit", defaultCurrency: "USD", dateFormat: "YYYY-MM-DD", decimalSeparator: "." };
    const blocked = confirmImportRun(db, ctx, { name: "x", bank: await side(bank, "bank", mapping), ledger: await side(ledger, "ledger", ledgerMapping) }, defaultModel);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.errors[0]!.side).toBe("bank");
      expect(blocked.errors[0]!.rowErrors[0]!.message).toMatch(/line 3.*both a debit and a credit/);
    }
    expect(listRuns(db, ORG)).toHaveLength(0);

    const ok = confirmImportRun(db, ctx, { name: "x", bank: await side(bank, "bank", mapping, { excludedRows: [1] }), ledger: await side(ledger, "ledger", ledgerMapping) }, defaultModel);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const data = loadRun(db, ORG, ok.runId);
    expect(data.bank.map((t) => [t.amountMinor, t.sourceLine])).toEqual([[10000n, 1], [-2000n, 3]]);
    const ex = JSON.parse((db.prepare("SELECT extraction_json FROM datasets WHERE side = 'bank'").get() as { extraction_json: string }).extraction_json);
    expect(ex.excluded).toEqual([{ row: 2, locator: "line 3", cells: ["2024-07-02", "Both sides", "R2", "5.00", "5.00"] }]);
    expect(listAudit(db, { orgId: ORG }).find((e) => e.action === "dataset.imported" && e.details.side === "bank")!.details.excludedRows).toBe(1);
  });

  it("validates exclusion indexes", async () => {
    const { bank, ledger, ledgerMapping } = await fixtures();
    const l = await side(ledger, "ledger", ledgerMapping);
    for (const bad of [[-1], [bank.rows.length], [0, 0], [1.5]]) {
      await expect(async () => confirmImportRun(db, ctx, { name: "x", bank: await side(bank, "bank", BANK_MAPPING, { excludedRows: bad }), ledger: l }, defaultModel)).rejects.toThrow(ValidationError);
    }
    const all = bank.rows.map((_, i) => i);
    await expect(async () => confirmImportRun(db, ctx, { name: "x", bank: await side(bank, "bank", BANK_MAPPING, { excludedRows: all }), ledger: l }, defaultModel)).rejects.toThrow(/nothing would be imported/);
  });

  it("keeps imports inside the confirming workspace", async () => {
    const { bank, ledger, ledgerMapping } = await fixtures();
    const out = confirmImportRun(db, ctx, { name: "x", bank: await side(bank, "bank", BANK_MAPPING), ledger: await side(ledger, "ledger", ledgerMapping) }, defaultModel);
    expect(out.ok).toBe(true);
    expect(listRuns(db, ORG)).toHaveLength(1);
    expect(listRuns(db, "org_other")).toHaveLength(0);
    const orgs = db.prepare("SELECT DISTINCT organization_id FROM datasets").pluck().all();
    expect(orgs).toEqual([ORG]);
  });
});
