import { beforeEach, describe, expect, it } from "vitest";
import { defaultModel } from "@/engine/default-model";
import { sumMinor } from "@/engine/money";
import { DEMO_BANK_MAPPING, DEMO_LEDGER_MAPPING, generateSynthetic } from "@/engine/synthetic";
import { openDatabase, type DB } from "@/server/db";
import { createRun, decideException, decideMatch, listDecisions, loadRun } from "@/server/repo";
import { bucketOf, buildReport } from "@/server/report";

const ORG = "org_report";
let db: DB;
let runId: string;

beforeEach(() => {
  db = openDatabase(":memory:");
  const ds = generateSynthetic(5, 250);
  const out = createRun(db, {
    orgId: ORG,
    name: "Report test",
    actor: "Ana <ana@example.com>",
    model: defaultModel,
    source: "demo",
    bank: { filename: "b.csv", csv: ds.bankCsv, mapping: DEMO_BANK_MAPPING },
    ledger: { filename: "l.csv", csv: ds.ledgerCsv, mapping: DEMO_LEDGER_MAPPING },
  });
  if (!out.ok) throw new Error("run failed");
  runId = out.runId;
});

const report = () => buildReport(loadRun(db, ORG, runId), listDecisions(db, ORG, runId));

describe("buildReport", () => {
  it("classifies every transaction into exactly one bucket and totals reconcile exactly", () => {
    const data = loadRun(db, ORG, runId);
    const r = report();
    for (const p of r.positions) {
      for (const side of [p.bank, p.ledger]) {
        expect(side.confirmedCount + side.pendingCount + side.unmatchedCount).toBe(side.count);
        expect(side.confirmedMinor + side.pendingMinor + side.unmatchedMinor).toBe(side.totalMinor);
      }
      expect(p.netDifferenceMinor).toBe(p.bank.totalMinor - p.ledger.totalMinor);
    }
    const bankTotal = sumMinor(r.positions.map((p) => BigInt(p.bank.count)));
    expect(bankTotal).toBe(BigInt(data.bank.length));
    // Per-currency totals equal raw sums from the source transactions.
    for (const p of r.positions) {
      expect(p.bank.totalMinor).toBe(sumMinor(data.bank.filter((t) => t.currency === p.currency).map((t) => t.amountMinor)));
    }
  });

  it("reflects human decisions: approve → confirmed, reject → unmatched", () => {
    const data = loadRun(db, ORG, runId);
    const pending = data.matches.filter((m) => m.status === "suggested" || m.status === "needs_review");
    const [a, b] = pending;
    const before = report();
    decideMatch(db, { orgId: ORG, runId, matchId: a!.id, decision: "approve", reason: "Remittance checked", reviewer: "Ana" });
    decideMatch(db, { orgId: ORG, runId, matchId: b!.id, decision: "reject", reason: "Different customer", reviewer: "Ben" });
    const after = report();
    const side = (r: typeof before, c: string) => r.positions.find((p) => p.currency === c)!.bank;
    // Approval moves exactly a's bank rows from pending to confirmed.
    expect(side(after, a!.currency).confirmedCount).toBe(side(before, a!.currency).confirmedCount + a!.bankIds.length);
    // Rejection moves exactly b's bank rows from pending to unmatched.
    expect(side(after, b!.currency).unmatchedCount).toBe(side(before, b!.currency).unmatchedCount + b!.bankIds.length);
    const pendingDrop = (c: string) => side(before, c).pendingCount - side(after, c).pendingCount;
    if (a!.currency === b!.currency) expect(pendingDrop(a!.currency)).toBe(a!.bankIds.length + b!.bankIds.length);
    else {
      expect(pendingDrop(a!.currency)).toBe(a!.bankIds.length);
      expect(pendingDrop(b!.currency)).toBe(b!.bankIds.length);
    }
    expect(after.matchesByStatus.approved).toBe(1);
    expect(after.matchesByStatus.rejected).toBe(1);
    expect(after.readiness.pendingMatches).toBe(before.readiness.pendingMatches - 2);
    expect(after.reviewers.map((r) => r.reviewer).sort()).toEqual(["Ana", "Ben"]);
  });

  it("tracks accepted differences on confirmed matches", () => {
    const data = loadRun(db, ORG, runId);
    const withDiff = data.matches.find((m) => (m.status === "suggested" || m.status === "needs_review") && m.bankTotalMinor !== m.ledgerTotalMinor);
    if (!withDiff) return; // dataset-dependent; covered when present
    const before = report().positions.find((p) => p.currency === withDiff.currency)!.confirmedDifferenceMinor;
    decideMatch(db, { orgId: ORG, runId, matchId: withDiff.id, decision: "approve", reason: "Fee confirmed", reviewer: "Ana" });
    const after = report().positions.find((p) => p.currency === withDiff.currency)!.confirmedDifferenceMinor;
    expect(after - before).toBe(withDiff.bankTotalMinor - withDiff.ledgerTotalMinor);
  });

  it("is ready for sign-off only when nothing is pending or open", () => {
    const data = loadRun(db, ORG, runId);
    expect(report().readiness.ready).toBe(false);
    for (const m of data.matches) {
      if (m.status === "suggested" || m.status === "needs_review") decideMatch(db, { orgId: ORG, runId, matchId: m.id, decision: "approve", reason: "Bulk test", reviewer: "Ana" });
    }
    for (const e of data.exceptions) decideException(db, { orgId: ORG, runId, exceptionId: e.id, decision: "resolve", reason: "Bulk test", reviewer: "Ana" });
    const r = report();
    expect(r.readiness).toEqual({ pendingMatches: 0, openExceptions: 0, ready: true });
    expect(r.exceptions.every((e) => e.open === 0 && e.openExposureMinor === 0n)).toBe(true);
  });

  it("maps statuses to buckets", () => {
    expect(bucketOf("verified")).toBe("confirmed");
    expect(bucketOf("approved")).toBe("confirmed");
    expect(bucketOf("needs_review")).toBe("pending");
    expect(bucketOf("rejected")).toBe("unmatched");
    expect(bucketOf(undefined)).toBe("unmatched");
  });
});
