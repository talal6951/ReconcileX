import { beforeEach, describe, expect, it } from "vitest";
import { appendAudit, AUDIT_EXPORT_MAX, AUDIT_PAGE_MAX, auditFacets, exportAuditEvents, searchAudit, verifyAuditChain } from "@/server/audit";
import { openDatabase, type DB } from "@/server/db";

const A = "org_alpha";
const B = "org_beta";
let db: DB;

beforeEach(() => {
  db = openDatabase(":memory:");
  appendAudit(db, { orgId: A, actor: "Ana <ana@a.test>", action: "run.completed", runId: "RUN-A1", entityType: "run", entityId: "RUN-A1", details: { note: "alpha secret ledger" } });
  appendAudit(db, { orgId: A, actor: "Ben <ben@a.test>", action: "match.approve", runId: "RUN-A1", entityType: "match", entityId: "M-00001", details: { reason: "100% sure_ok" } });
  appendAudit(db, { orgId: A, actor: "Ana <ana@a.test>", action: "exception.resolve", runId: "RUN-A2", entityType: "exception", entityId: "E-00001", details: { reason: "Bank fee booked" } });
  appendAudit(db, { orgId: B, actor: "Eve <eve@b.test>", action: "run.completed", runId: "RUN-B1", entityType: "run", entityId: "RUN-B1", details: { note: "alpha secret ledger" } });
});

describe("searchAudit scoping", () => {
  it("only ever returns the caller's workspace, even when the text matches another's events", () => {
    const a = searchAudit(db, { orgId: A, q: "alpha secret" });
    expect(a.total).toBe(1);
    expect(a.events.every((e) => e.orgId === A)).toBe(true);
    const b = searchAudit(db, { orgId: B, q: "alpha secret" });
    expect(b.total).toBe(1);
    expect(b.events[0]!.actor).toContain("Eve");
  });

  it("cannot reach another workspace by filtering on its run, actor or action", () => {
    expect(searchAudit(db, { orgId: A, runId: "RUN-B1" }).total).toBe(0);
    expect(searchAudit(db, { orgId: A, actor: "Eve <eve@b.test>" }).total).toBe(0);
    expect(searchAudit(db, { orgId: B, action: "match.approve" }).total).toBe(0);
  });

  it("requires a workspace", () => {
    expect(() => searchAudit(db, { orgId: "" })).toThrow(/Workspace context/);
    expect(() => exportAuditEvents(db, { orgId: "" })).toThrow(/Workspace context/);
    expect(() => auditFacets(db, "")).toThrow(/Workspace context/);
  });

  it("facets list only the caller's actions and actors", () => {
    const f = auditFacets(db, A);
    expect(f.actors).toEqual(["Ana <ana@a.test>", "Ben <ben@a.test>"]);
    expect(f.actions).toEqual(["exception.resolve", "match.approve", "run.completed"]);
  });
});

describe("searchAudit filters", () => {
  it("filters by action, actor and run, newest first", () => {
    expect(searchAudit(db, { orgId: A, action: "match.approve" }).events.map((e) => e.entityId)).toEqual(["M-00001"]);
    expect(searchAudit(db, { orgId: A, actor: "Ana <ana@a.test>" }).events.map((e) => e.action)).toEqual(["exception.resolve", "run.completed"]);
    expect(searchAudit(db, { orgId: A, runId: "RUN-A1" }).total).toBe(2);
  });

  it("matches free text against details, entity and run", () => {
    expect(searchAudit(db, { orgId: A, q: "bank fee" }).total).toBe(1);
    expect(searchAudit(db, { orgId: A, q: "M-00001" }).total).toBe(1);
    expect(searchAudit(db, { orgId: A, q: "run-a2" }).total).toBe(1); // case-insensitive for ASCII
  });

  it("treats % and _ literally (no wildcard injection)", () => {
    expect(searchAudit(db, { orgId: A, q: "%" }).total).toBe(1); // only the event whose details contain "100%"
    expect(searchAudit(db, { orgId: A, q: "_" }).total).toBe(1); // only "sure_ok"
    expect(searchAudit(db, { orgId: A, q: "%%%%" }).total).toBe(0);
  });

  it("applies inclusive UTC day bounds and ignores malformed dates", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(searchAudit(db, { orgId: A, from: today, to: today }).total).toBe(3);
    expect(searchAudit(db, { orgId: A, from: "2099-01-01" }).total).toBe(0);
    expect(searchAudit(db, { orgId: A, to: "2000-01-01" }).total).toBe(0);
    expect(searchAudit(db, { orgId: A, from: "not-a-date'; DROP TABLE audit_events;--" }).total).toBe(3);
  });

  it("paginates and caps page size", () => {
    for (let i = 0; i < AUDIT_PAGE_MAX + 20; i++) appendAudit(db, { orgId: A, actor: "Bulk", action: "test.bulk", details: { i } });
    const p1 = searchAudit(db, { orgId: A, action: "test.bulk" }, { limit: 10_000 });
    expect(p1.events).toHaveLength(AUDIT_PAGE_MAX);
    expect(p1.total).toBe(AUDIT_PAGE_MAX + 20);
    const p2 = searchAudit(db, { orgId: A, action: "test.bulk" }, { limit: AUDIT_PAGE_MAX, offset: AUDIT_PAGE_MAX });
    expect(p2.events).toHaveLength(20);
    expect(new Set([...p1.events, ...p2.events].map((e) => e.seq)).size).toBe(AUDIT_PAGE_MAX + 20);
  });
});

describe("exportAuditEvents", () => {
  it("exports everything below the cap without truncation", () => {
    const out = exportAuditEvents(db, { orgId: A });
    expect(out).toMatchObject({ total: 3, truncated: false });
    expect(out.events).toHaveLength(3);
  });

  it("exports up to the 5,000-event cap (not the page cap) and reports truncation", () => {
    db.transaction(() => {
      for (let i = 0; i < AUDIT_EXPORT_MAX + 5; i++) appendAudit(db, { orgId: A, actor: "Bulk", action: "test.bulk", details: { i } });
    })();
    const out = exportAuditEvents(db, { orgId: A, action: "test.bulk" });
    expect(out.events).toHaveLength(AUDIT_EXPORT_MAX);
    expect(out.total).toBe(AUDIT_EXPORT_MAX + 5);
    expect(out.truncated).toBe(true);
    // Most recent first; workspace B untouched and its chain intact.
    expect(out.events[0]!.details).toEqual({ i: AUDIT_EXPORT_MAX + 4 });
    expect(verifyAuditChain(db, B)).toMatchObject({ ok: true, events: 1 });
    expect(verifyAuditChain(db, A).ok).toBe(true);
  });
});
