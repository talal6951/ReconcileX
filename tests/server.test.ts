import { beforeEach, describe, expect, it } from "vitest";
import { defaultModel } from "@/engine/default-model";
import { DEMO_BANK_MAPPING, DEMO_LEDGER_MAPPING, generateSynthetic } from "@/engine/synthetic";
import { appendAudit, listAudit, verifyAuditChain } from "@/server/audit";
import { openDatabase, type DB } from "@/server/db";
import { auditCsv, exceptionsCsv, matchesCsv, reportJson, safeText } from "@/server/exports";
import { createRun, decideException, decideMatch, listDecisions, listRuns, loadRun, ValidationError } from "@/server/repo";

let db: DB;
beforeEach(() => {
  db = openDatabase(":memory:");
});

function demoRun(seed = 11, events = 150) {
  const ds = generateSynthetic(seed, events);
  const out = createRun(db, {
    name: "Test run",
    actor: "tester",
    model: defaultModel,
    source: "demo",
    bank: { filename: "bank.csv", csv: ds.bankCsv, mapping: DEMO_BANK_MAPPING },
    ledger: { filename: "ledger.csv", csv: ds.ledgerCsv, mapping: DEMO_LEDGER_MAPPING },
  });
  if (!out.ok) throw new Error(JSON.stringify(out.errors));
  return { ds, runId: out.runId };
}

describe("createRun", () => {
  it("persists datasets, results and audit events; amounts round-trip exactly", () => {
    const { ds, runId } = demoRun();
    const data = loadRun(db, runId);
    expect(data.bank).toHaveLength(ds.bank.length);
    expect(data.bank.map((t) => t.amountMinor)).toEqual(ds.bank.map((t) => t.amountMinor));
    expect(data.matches.length).toBeGreaterThan(0);
    expect(listRuns(db)).toHaveLength(1);
    expect(listAudit(db, { runId }).map((e) => e.action).sort()).toEqual(["dataset.imported", "dataset.imported", "run.completed"]);
  });

  it("rejects the whole import on any invalid row and reports line numbers", () => {
    const bad = "Transaction ID,Posting Date,Description,Reference,Counterparty,Amount,Currency\nT1,2024-01-01,X,,C,10.005,USD\nT2,2024-13-01,Y,,C,5.00,USD\nT3,2024-01-02,Z,,C,5.00,ZZZ\n";
    const ds = generateSynthetic(1, 20);
    const out = createRun(db, {
      name: "Bad",
      actor: "tester",
      model: defaultModel,
      source: "upload",
      bank: { filename: "bad.csv", csv: bad, mapping: DEMO_BANK_MAPPING },
      ledger: { filename: "l.csv", csv: ds.ledgerCsv, mapping: DEMO_LEDGER_MAPPING },
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    const bank = out.errors.find((e) => e.side === "bank")!;
    expect(bank.rowErrors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(listRuns(db)).toHaveLength(0);
  });

  it("rejects an invalid mapping", () => {
    const ds = generateSynthetic(1, 20);
    const out = createRun(db, {
      name: "Bad mapping",
      actor: "tester",
      model: defaultModel,
      source: "upload",
      bank: { filename: "b.csv", csv: ds.bankCsv, mapping: { ...DEMO_BANK_MAPPING, amount: "Nope" } },
      ledger: { filename: "l.csv", csv: ds.ledgerCsv, mapping: DEMO_LEDGER_MAPPING },
    });
    expect(out.ok).toBe(false);
  });
});

describe("review workflow", () => {
  it("approves, rejects and reopens with reasons, enforcing transitions", () => {
    const { runId } = demoRun();
    const data = loadRun(db, runId);
    const pending = data.matches.find((m) => m.status === "suggested" || m.status === "needs_review")!;
    const verified = data.matches.find((m) => m.status === "verified")!;

    expect(() => decideMatch(db, { runId, matchId: pending.id, decision: "approve", reason: "", reviewer: "ana" })).toThrow(ValidationError);
    expect(() => decideMatch(db, { runId, matchId: verified.id, decision: "approve", reason: "looks fine", reviewer: "ana" })).toThrow(/Cannot approve/);

    expect(decideMatch(db, { runId, matchId: pending.id, decision: "approve", reason: "Remittance confirms", reviewer: "ana" }).to).toBe("approved");
    expect(() => decideMatch(db, { runId, matchId: pending.id, decision: "approve", reason: "again", reviewer: "ana" })).toThrow();
    expect(decideMatch(db, { runId, matchId: pending.id, decision: "reopen", reason: "Reopened for second look", reviewer: "ben" }).to).toBe(pending.status);
    expect(decideMatch(db, { runId, matchId: verified.id, decision: "reject", reason: "Wrong entity", reviewer: "ben" }).to).toBe("rejected");

    const decisions = listDecisions(db, runId);
    expect(decisions).toHaveLength(3);
    expect(decisions[0]!.reviewer).toBe("ben");
    const after = loadRun(db, runId);
    expect(after.summary.progress.rejected).toBe(1);
  });

  it("resolves and reopens exceptions", () => {
    const { runId } = demoRun();
    const exc = loadRun(db, runId).exceptions[0]!;
    decideException(db, { runId, exceptionId: exc.id, decision: "resolve", reason: "Bank fee booked", reviewer: "ana" });
    expect(() => decideException(db, { runId, exceptionId: exc.id, decision: "resolve", reason: "again", reviewer: "ana" })).toThrow();
    expect(loadRun(db, runId).summary.progress.resolvedExceptions).toBe(1);
  });
});

describe("audit log", () => {
  it("is hash-chained, verifiable and append-only", () => {
    demoRun();
    appendAudit(db, { actor: "x", action: "test.event", details: { a: 1, nested: { b: "c" } } });
    expect(verifyAuditChain(db)).toMatchObject({ ok: true, brokenAt: null });
    expect(() => db.prepare("UPDATE audit_events SET actor = 'evil' WHERE seq = 1").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM audit_events").run()).toThrow(/append-only/);
  });

  it("detects tampering if triggers are bypassed", () => {
    demoRun();
    db.exec("DROP TRIGGER audit_no_update");
    db.prepare("UPDATE audit_events SET details_json = '{\"rows\":1}' WHERE seq = 2").run();
    expect(verifyAuditChain(db)).toMatchObject({ ok: false, brokenAt: 2 });
  });
});

describe("exports", () => {
  it("neutralises formula injection in text but keeps negative amounts numeric", () => {
    expect(safeText("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(safeText("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(safeText("normal")).toBe("normal");
    const { runId } = demoRun();
    const data = loadRun(db, runId);
    const m = matchesCsv(data);
    expect(m.split("\r\n")[0]).toContain("Match ID");
    expect(m).toMatch(/,-\d+\.\d{2},/); // outflows exported as plain negative decimals
    expect(exceptionsCsv(data).split("\r\n").length).toBe(data.exceptions.length + 1);
    expect(auditCsv(listAudit(db)).length).toBeGreaterThan(0);
    const json = JSON.stringify(reportJson(data, []));
    expect(json).not.toContain("NaN");
  });

  it("escapes a malicious value in exports", () => {
    // Matched pair whose bank external ID starts with "=": it lands first in the Bank details cell.
    const bank = "Transaction ID,Posting Date,Description,Reference,Counterparty,Amount,Currency\n\"=cmd|' /C calc'!A0\",2024-01-01,Payment,REF-1001,C,10.00,USD\n";
    const ledger = "Entry ID,Date,Reference,Memo,Counterparty,Amount,Currency\nJ1,2024-01-01,REF-1001,Memo,C,10.00,USD\n";
    const out = createRun(db, {
      name: "Injection",
      actor: "t",
      model: defaultModel,
      source: "upload",
      bank: { filename: "b.csv", csv: bank, mapping: DEMO_BANK_MAPPING },
      ledger: { filename: "l.csv", csv: ledger, mapping: DEMO_LEDGER_MAPPING },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const csv = matchesCsv(loadRun(db, out.runId));
    expect(csv).toContain("=cmd"); // the value is present...
    expect(csv).not.toMatch(/(^|,)"?=cmd/m); // ...but never at the start of a cell
    expect(csv).toMatch(/'=cmd/);
  });
});
