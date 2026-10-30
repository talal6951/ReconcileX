import { describe, expect, it } from "vitest";
import { defaultModel } from "@/engine/default-model";
import { evaluatePipeline } from "@/engine/evaluate";
import { reconcile } from "@/engine/matcher";
import { generateSynthetic } from "@/engine/synthetic";
import type { Transaction } from "@/engine/types";
import { tx } from "./helpers";

const run = (bank: Transaction[], ledger: Transaction[]) => reconcile(bank, ledger, { model: defaultModel });

describe("deterministic matching", () => {
  it("verifies a unique exact reference match", () => {
    const b = tx("bank", { amount: "1250.00", date: "2024-03-02", reference: "INV-20001", description: "ACH CREDIT ACME" });
    const l = tx("ledger", { amount: "1250.00", date: "2024-03-01", reference: "INV-20001", description: "Receipt Acme" });
    const r = run([b], [l]);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ status: "verified", method: "rule_exact_reference", bankIds: [b.id], ledgerIds: [l.id] });
    expect(r.exceptions).toHaveLength(0);
  });

  it("verifies on identical transaction IDs", () => {
    const b = tx("bank", { amount: "99.99", date: "2024-03-02", externalId: "PX-778812", description: "PAYOUT" });
    const l = tx("ledger", { amount: "99.99", date: "2024-03-02", externalId: "PX-778812", description: "Payout" });
    expect(run([b], [l]).matches[0]).toMatchObject({ status: "verified", method: "rule_external_id" });
  });

  it("verifies when the ledger invoice number appears inside the bank narrative", () => {
    const b = tx("bank", { amount: "310.00", date: "2024-03-04", description: "WIRE IN GLOBEX REF INV-30017" });
    const l = tx("ledger", { amount: "310.00", date: "2024-03-02", reference: "INV-30017" });
    expect(run([b], [l]).matches[0]).toMatchObject({ status: "verified" });
  });

  it("never verifies when the uniqueness check fails (two ledger rows share amount + reference)", () => {
    const b = tx("bank", { amount: "500.00", date: "2024-03-02", reference: "INV-40001" });
    const l1 = tx("ledger", { amount: "500.00", date: "2024-03-01", reference: "INV-40001", description: "Receipt A" });
    const l2 = tx("ledger", { amount: "500.00", date: "2024-03-02", reference: "INV-40001", description: "Receipt B" });
    const r = run([b], [l1, l2]);
    expect(r.matches.every((m) => m.status !== "verified")).toBe(true);
    const m = r.matches[0]!;
    expect(m.status).toBe("needs_review");
    expect(m.flags).toContain("ambiguous");
    expect(m.evidence.alternatives?.length).toBeGreaterThan(0);
    expect(r.exceptions.some((e) => e.type === "missing_in_bank")).toBe(true);
  });

  it("does not verify a reference match whose amount differs", () => {
    const b = tx("bank", { amount: "980.00", date: "2024-03-02", reference: "INV-50001", counterparty: "ACME" });
    const l = tx("ledger", { amount: "1000.00", date: "2024-03-01", reference: "INV-50001", counterparty: "Acme" });
    const r = run([b], [l]);
    expect(r.matches[0]!.status).not.toBe("verified");
    expect(r.matches[0]!.flags).toContain("amount_difference");
    const ex = r.exceptions.find((e) => e.type === "amount_mismatch")!;
    expect(ex.exposureMinor).toBe(2000n);
    expect(ex.details.matchId).toBe(r.matches[0]!.id);
  });
});

describe("currency awareness", () => {
  it("never matches across currencies and raises a currency mismatch", () => {
    const b = tx("bank", { amount: "920.00", currency: "EUR", date: "2024-03-02", reference: "INV-60001" });
    const l = tx("ledger", { amount: "1000.00", currency: "USD", date: "2024-03-01", reference: "INV-60001" });
    const r = run([b], [l]);
    expect(r.matches).toHaveLength(0);
    expect(r.exceptions.map((e) => e.type)).toEqual(["currency_mismatch"]);
  });

  it("does not pair identical numeric amounts in different currencies", () => {
    const b = tx("bank", { amount: "100.00", currency: "GBP", date: "2024-03-02", description: "PAYMENT" });
    const l = tx("ledger", { amount: "100.00", currency: "USD", date: "2024-03-02", description: "PAYMENT" });
    const r = run([b], [l]);
    expect(r.matches).toHaveLength(0);
    expect(r.exceptions.map((e) => e.type).sort()).toEqual(["missing_in_bank", "missing_in_ledger"]);
  });

  it("handles zero- and three-decimal currencies exactly", () => {
    const b = tx("bank", { amount: "15000", currency: "JPY", date: "2024-03-02", reference: "INV-61001" });
    const l = tx("ledger", { amount: "15000", currency: "JPY", date: "2024-03-02", reference: "INV-61001" });
    const b2 = tx("bank", { amount: "12.345", currency: "KWD", date: "2024-03-02", reference: "INV-61002" });
    const l2 = tx("ledger", { amount: "12.345", currency: "KWD", date: "2024-03-02", reference: "INV-61002" });
    const r = run([b, b2], [l, l2]);
    expect(r.matches.filter((m) => m.status === "verified")).toHaveLength(2);
  });
});

describe("duplicates", () => {
  it("flags a ledger entry posted twice and leaves the extra copy unmatched", () => {
    const b = tx("bank", { amount: "700.00", date: "2024-03-03", description: "ACH CREDIT INITECH INV-70001" });
    const l1 = tx("ledger", { amount: "700.00", date: "2024-03-02", reference: "INV-70001", description: "Receipt Initech", externalId: "JE-1" + "001" });
    const l2 = tx("ledger", { amount: "700.00", date: "2024-03-02", reference: "INV-70001", description: "Receipt Initech", externalId: "JE-1" + "002" });
    const r = run([b], [l1, l2]);
    expect(r.duplicateGroups).toContainEqual({ side: "ledger", ids: [l1.id, l2.id], kind: "same_content" });
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.status).toBe("needs_review");
    expect(r.matches[0]!.flags).toContain("duplicate_involved");
    expect(r.exceptions.filter((e) => e.type === "missing_in_bank")).toHaveLength(1);
    expect(r.exceptions.filter((e) => e.type === "duplicate_ledger")).toHaveLength(1);
  });

  it("flags a re-imported bank row", () => {
    const b1 = tx("bank", { amount: "45.00", date: "2024-03-03", externalId: "BTX123456", description: "CARD OFFICE CO" });
    const b2 = { ...b1, id: "B-999999" };
    const r = run([b1, b2], []);
    expect(r.duplicateGroups[0]).toMatchObject({ side: "bank", kind: "exact" });
  });
});

describe("splits and aggregates", () => {
  it("proposes a split payment (one invoice, several bank receipts) for review", () => {
    const l = tx("ledger", { amount: "1000.00", date: "2024-04-01", reference: "INV-80001", counterparty: "Acme Industrial Ltd" });
    const b1 = tx("bank", { amount: "400.00", date: "2024-04-01", description: "ACME PMT INV-80001 PART 1", counterparty: "ACME INDUSTRIAL LTD" });
    const b2 = tx("bank", { amount: "600.00", date: "2024-04-03", description: "ACME PMT INV-80001 PART 2", counterparty: "ACME INDUSTRIAL LTD" });
    const r = run([b1, b2], [l]);
    const m = r.matches.find((x) => x.method === "split_sum")!;
    expect(m).toBeDefined();
    expect(m.kind).toBe("one_to_many");
    expect(m.status).not.toBe("verified");
    expect(m.bankTotalMinor).toBe(m.ledgerTotalMinor);
    expect(new Set(m.bankIds)).toEqual(new Set([b1.id, b2.id]));
  });

  it("proposes an aggregated settlement (several ledger sales, one payout)", () => {
    const b = tx("bank", { amount: "350.75", date: "2024-04-05", description: "STRIPE PAYOUT", counterparty: "STRIPE" });
    const l1 = tx("ledger", { amount: "100.25", date: "2024-04-03", reference: "SALE-1", description: "Card sale via Stripe - A" });
    const l2 = tx("ledger", { amount: "250.50", date: "2024-04-04", reference: "SALE-2", description: "Card sale via Stripe - B" });
    const noise = tx("ledger", { amount: "999.00", date: "2024-04-04", reference: "INV-1", description: "Other" });
    const r = run([b], [l1, l2, noise]);
    const m = r.matches.find((x) => x.method === "split_sum")!;
    expect(m.kind).toBe("many_to_one");
    expect(new Set(m.ledgerIds)).toEqual(new Set([l1.id, l2.id]));
  });

  it("does not propose a split when no subset sums exactly", () => {
    const l = tx("ledger", { amount: "1000.00", date: "2024-04-01", reference: "INV-90001" });
    const b1 = tx("bank", { amount: "400.00", date: "2024-04-01", description: "INV-90001 PART 1" });
    const b2 = tx("bank", { amount: "599.99", date: "2024-04-02", description: "INV-90001 PART 2" });
    expect(run([b1, b2], [l]).matches.some((m) => m.method === "split_sum")).toBe(false);
  });
});

describe("ML-assisted suggestions", () => {
  it("suggests (never verifies) a match without any shared reference", () => {
    const b = tx("bank", { amount: "2310.40", date: "2024-05-03", description: "ACH CREDIT NORTHWIND TRADERS", counterparty: "NORTHWIND TRADERS" });
    const l = tx("ledger", { amount: "2310.40", date: "2024-05-01", reference: "INV-11111", description: "Customer receipt Northwind Traders", counterparty: "Northwind Traders" });
    const m = run([b], [l]).matches[0]!;
    expect(m.method).toBe("ml_scored");
    expect(m.status).toBe("suggested");
    expect(m.score).toBeGreaterThan(0.5);
    expect(m.evidence.contributions?.length).toBe(13);
  });

  it("marks indistinguishable twins as ambiguous", () => {
    const mk = (side: "bank" | "ledger") =>
      tx(side, { amount: "49.00", date: "2024-05-03", description: "SUBSCRIPTION HOOLI", counterparty: "Hooli" });
    const r = run([mk("bank"), mk("bank")], [mk("ledger"), mk("ledger")]);
    expect(r.matches).toHaveLength(2);
    for (const m of r.matches) {
      expect(m.status).toBe("needs_review");
      expect(m.flags).toContain("ambiguous");
    }
  });
});

describe("end-to-end on synthetic data with ground truth", () => {
  for (const seed of [201, 202, 203]) {
    it(`seed ${seed}: verified matches are always correct; detection quality is high`, () => {
      const ds = generateSynthetic(seed, 800);
      const r = run(ds.bank, ds.ledger);
      const e = evaluatePipeline(r, ds.truth);
      expect(e.verified.count).toBeGreaterThan(0);
      expect(e.verified.precision).toBe(1);
      expect(e.suggestions1to1.precision!).toBeGreaterThan(0.95);
      expect(e.oneToOneRecall.recall!).toBeGreaterThan(0.95);
      expect(e.duplicates.recall).toBe(1);
      expect(e.currencyMismatch.recall!).toBeGreaterThan(0.9);
      // Every bank and ledger row is accounted for exactly once across matches and row-level exceptions.
      const rowLevel = new Set(["missing_in_bank", "missing_in_ledger", "currency_mismatch"]);
      const seen = new Map<string, number>();
      for (const m of r.matches) for (const id of [...m.bankIds, ...m.ledgerIds]) seen.set(id, (seen.get(id) ?? 0) + 1);
      for (const x of r.exceptions.filter((x) => rowLevel.has(x.type))) for (const id of [...x.bankIds, ...x.ledgerIds]) seen.set(id, (seen.get(id) ?? 0) + 1);
      expect(seen.size).toBe(ds.bank.length + ds.ledger.length);
      expect([...seen.values()].every((n) => n === 1)).toBe(true);
    });
  }

  it("is deterministic", () => {
    const ds = generateSynthetic(77, 300);
    const a = run(ds.bank, ds.ledger), b = run(ds.bank, ds.ledger);
    const strip = (r: typeof a) => r.matches.map((m) => `${m.id}:${m.status}:${m.bankIds}:${m.ledgerIds}:${m.score}`);
    expect(strip(a)).toEqual(strip(b));
  });

  it("reconciles 10,000+ rows per side within a few seconds", () => {
    const ds = generateSynthetic(500, 9000);
    expect(ds.bank.length).toBeGreaterThan(9000);
    const t0 = performance.now();
    const r = run(ds.bank, ds.ledger);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(10_000);
    expect(evaluatePipeline(r, ds.truth).verified.precision).toBe(1);
  });
});
