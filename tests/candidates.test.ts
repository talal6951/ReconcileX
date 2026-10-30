import { describe, expect, it } from "vitest";
import { buildCandidates, generateIdentifierCandidates, indexTx } from "@/engine/features";
import { findDuplicates } from "@/engine/duplicates";
import { DEFAULT_CONFIG } from "@/engine/types";
import { tx } from "./helpers";

describe("identifier candidate index", () => {
  it("finds a ledger reference embedded in a bank narrative", () => {
    const b = indexTx(tx("bank", { amount: "500.00", date: "2024-05-02", description: "ACH CREDIT ACME INV-2024-10023 THANK YOU" }));
    const l = indexTx(tx("ledger", { amount: "520.00", date: "2024-05-01", reference: "INV-2024-10023" }));
    const out = generateIdentifierCandidates([b], [l], new Set(), DEFAULT_CONFIG);
    expect(out).toHaveLength(1);
  });

  it("handles long reference numbers and long digit runs", () => {
    const longRef = "PO" + "9".repeat(5) + "1234567890123456789012345";
    const narrative = `WIRE ${"7".repeat(200)} ${longRef} END`;
    const b = indexTx(tx("bank", { amount: "100.00", date: "2024-05-02", description: narrative }));
    const l = indexTx(tx("ledger", { amount: "100.00", date: "2024-05-02", reference: longRef }));
    const t0 = performance.now();
    const out = generateIdentifierCandidates([b], [l], new Set(), DEFAULT_CONFIG);
    expect(out).toHaveLength(1);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("never emits duplicate pairs when an identifier appears several times", () => {
    const b = indexTx(tx("bank", { amount: "100.00", date: "2024-05-02", reference: "INV10023", description: "INV10023 INV-10023 inv 10023" }));
    const l = indexTx(tx("ledger", { amount: "100.00", date: "2024-05-02", reference: "INV-10023" }));
    const out = generateIdentifierCandidates([b], [l], new Set(), DEFAULT_CONFIG);
    expect(out).toHaveLength(1);
    const all = buildCandidates([b], [l], DEFAULT_CONFIG);
    expect(all).toHaveLength(1);
  });

  it("respects currency, sign and date window", () => {
    const b = indexTx(tx("bank", { amount: "100.00", date: "2024-05-02", description: "INV-55501" }));
    const wrongCcy = indexTx(tx("ledger", { amount: "100.00", currency: "EUR", date: "2024-05-02", reference: "INV-55501" }));
    const wrongSign = indexTx(tx("ledger", { amount: "-100.00", date: "2024-05-02", reference: "INV-55501" }));
    const tooFar = indexTx(tx("ledger", { amount: "100.00", date: "2024-06-30", reference: "INV-55501" }));
    expect(generateIdentifierCandidates([b], [wrongCcy, wrongSign, tooFar], new Set(), DEFAULT_CONFIG)).toHaveLength(0);
  });

  it("scales to thousands of rows", () => {
    const bank = [], ledger = [];
    for (let i = 0; i < 5000; i++) {
      const ref = `INV-${100000 + i}`;
      const day = `2024-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, "0")}`;
      bank.push(indexTx(tx("bank", { amount: `${100 + (i % 977)}.00`, date: day, description: `PAYMENT ${ref} CUSTOMER ${i}` })));
      ledger.push(indexTx(tx("ledger", { amount: `${100 + (i % 977)}.00`, date: day, reference: ref })));
    }
    const t0 = performance.now();
    const cands = buildCandidates(bank, ledger, DEFAULT_CONFIG);
    const ms = performance.now() - t0;
    const keys = new Set(cands.map((c) => `${c.bank.tx.id}|${c.ledger.tx.id}`));
    expect(keys.size).toBe(cands.length);
    expect(ms).toBeLessThan(5000);
  });
});

describe("candidate blocking", () => {
  it("only pairs same currency within tolerance and window", () => {
    const b = indexTx(tx("bank", { amount: "1000.00", date: "2024-01-10", description: "X" }));
    const ok = indexTx(tx("ledger", { amount: "990.00", date: "2024-01-08", description: "X" }));
    const tooDifferent = indexTx(tx("ledger", { amount: "800.00", date: "2024-01-10", description: "X" }));
    const otherCcy = indexTx(tx("ledger", { amount: "1000.00", currency: "EUR", date: "2024-01-10", description: "X" }));
    const c = buildCandidates([b], [ok, tooDifferent, otherCcy], DEFAULT_CONFIG);
    expect(c.map((p) => p.ledger.tx.id)).toEqual([ok.tx.id]);
  });
});

describe("findDuplicates", () => {
  it("groups exact duplicates and repeated transaction IDs", () => {
    const a = tx("bank", { amount: "50.00", date: "2024-01-01", reference: "R1", externalId: "TXN-001" });
    const b = tx("bank", { amount: "50.00", date: "2024-01-01", reference: "R1", externalId: "TXN-001" });
    const c = tx("bank", { amount: "75.00", date: "2024-01-03", reference: "R2", externalId: "TXN-009" });
    const d = tx("bank", { amount: "80.00", date: "2024-01-04", reference: "R3", externalId: "TXN-009" });
    const groups = findDuplicates([a, b, c, d]);
    expect(groups).toContainEqual({ side: "bank", ids: [a.id, b.id], kind: "exact" });
    expect(groups).toContainEqual({ side: "bank", ids: [c.id, d.id], kind: "external_id" });
    expect(groups).toHaveLength(2);
  });
});
