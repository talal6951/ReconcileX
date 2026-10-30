import { describe, expect, it } from "vitest";
import { defaultModel } from "@/engine/default-model";
import { createInvestigator } from "@/engine/investigate";
import { reconcile } from "@/engine/matcher";
import { generateSynthetic } from "@/engine/synthetic";
import type { Transaction } from "@/engine/types";
import { tx } from "./helpers";

function setup(bank: Transaction[], ledger: Transaction[]) {
  const result = reconcile(bank, ledger, { model: defaultModel });
  return { result, inv: createInvestigator(bank, ledger, result) };
}

describe("investigator grounding", () => {
  it("only ever cites transactions that exist, and every hypothesis cites evidence", () => {
    const ds = generateSynthetic(321, 400);
    const { result, inv } = setup(ds.bank, ds.ledger);
    const ids = new Set([...ds.bank, ...ds.ledger].map((t) => t.id));
    const all = [
      ...result.exceptions.map((e) => inv.investigateException(e.id)),
      ...result.matches.map((m) => inv.investigateMatch(m.id)),
    ];
    expect(all.length).toBeGreaterThan(100);
    for (const i of all) {
      const evIds = new Set(i.evidence.map((e) => e.id));
      for (const e of i.evidence) for (const id of e.txIds) expect(ids.has(id)).toBe(true);
      for (const h of i.hypotheses) {
        expect(h.evidenceIds.length).toBeGreaterThan(0);
        for (const ref of h.evidenceIds) expect(evIds.has(ref)).toBe(true);
      }
      expect(i.recommendedAction.length).toBeGreaterThan(0);
      expect(i.limitations.length).toBeGreaterThan(0);
    }
  });

  it("states plainly when no evidence is found instead of inventing a cause", () => {
    const b = tx("bank", { amount: "4321.09", date: "2024-06-10", description: "WIRE IN UNKNOWN" });
    const { result, inv } = setup([b], []);
    const i = inv.investigateException(result.exceptions[0]!.id);
    expect(i.hypotheses).toHaveLength(0);
    expect(i.limitations.join(" ")).toMatch(/No ledger record with the same amount/);
  });
});

describe("investigator hypotheses", () => {
  it("identifies a fee-like shortfall on a suggested match", () => {
    const b = tx("bank", { amount: "985.00", date: "2024-06-03", description: "ACH CREDIT ACME INV-77001", counterparty: "ACME" });
    const l = tx("ledger", { amount: "1000.00", date: "2024-06-02", reference: "INV-77001", counterparty: "Acme" });
    const { result, inv } = setup([b], [l]);
    const i = inv.investigateMatch(result.matches[0]!.id);
    expect(i.hypotheses.map((h) => h.title)).toContain("Fee deducted before settlement");
    expect(i.headline).toMatch(/-15\.00 USD/);
  });

  it("recognises bank-originated fees", () => {
    const b = tx("bank", { amount: "-25.00", date: "2024-06-30", description: "MONTHLY SERVICE FEE" });
    const { result, inv } = setup([b], []);
    const i = inv.investigateException(result.exceptions[0]!.id);
    expect(i.hypotheses[0]!.title).toBe("Bank-originated item");
  });

  it("points to a same-amount counterpart already linked elsewhere", () => {
    const b1 = tx("bank", { amount: "250.00", date: "2024-06-05", description: "PAYMENT GLOBEX INV-1", counterparty: "GLOBEX" });
    const b2 = tx("bank", { amount: "250.00", date: "2024-06-05", description: "UNRELATED", counterparty: "OTHER" });
    const l = tx("ledger", { amount: "250.00", date: "2024-06-04", reference: "INV-1", counterparty: "Globex" });
    const { result, inv } = setup([b1, b2], [l]);
    const exc = result.exceptions.find((e) => e.type === "missing_in_ledger")!;
    const i = inv.investigateException(exc.id);
    expect(i.hypotheses.some((h) => h.title.startsWith("Counterpart may be linked"))).toBe(true);
  });

  it("explains a currency mismatch with an implied rate computed exactly", () => {
    const b = tx("bank", { amount: "920.00", currency: "EUR", date: "2024-06-02", reference: "INV-88001" });
    const l = tx("ledger", { amount: "1000.00", currency: "USD", date: "2024-06-01", reference: "INV-88001" });
    const { result, inv } = setup([b], [l]);
    const i = inv.investigateException(result.exceptions[0]!.id);
    expect(i.evidence.some((e) => e.text.includes("0.920000"))).toBe(true);
  });

  it("distinguishes repeated payments from a double posting", () => {
    const mk = (side: "bank" | "ledger", ext: string) =>
      tx(side, { amount: "49.00", date: "2024-06-03", description: "SUBSCRIPTION HOOLI", counterparty: "Hooli", externalId: ext });
    const twins = setup([mk("bank", "BX-1001"), mk("bank", "BX-1002")], [mk("ledger", "JE-1001"), mk("ledger", "JE-1002")]);
    const dupT = twins.result.exceptions.find((e) => e.type === "duplicate_bank")!;
    expect(twins.inv.investigateException(dupT.id).hypotheses[0]!.title).toBe("Legitimate repeated transactions");

    const posted = setup([mk("bank", "BX-2001")], [mk("ledger", "JE-2001"), mk("ledger", "JE-2002")]);
    const dupP = posted.result.exceptions.find((e) => e.type === "duplicate_ledger")!;
    expect(posted.inv.investigateException(dupP.id).hypotheses[0]!.title).toBe("Double posting or re-import");
  });
});
