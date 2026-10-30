import { createHash } from "node:crypto";
import type { DB } from "./db";

/**
 * Append-only, hash-chained audit log. Each event's hash covers its content and
 * the previous hash, so any edit to history breaks verification. (SQLite
 * triggers additionally block UPDATE/DELETE.)
 */

export interface AuditInput {
  actor: string;
  action: string;
  runId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown>;
}

export interface AuditEvent {
  seq: number;
  ts: string;
  actor: string;
  action: string;
  runId: string | null;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}

function hashEvent(e: Omit<AuditEvent, "seq" | "hash">): string {
  return createHash("sha256")
    .update(e.prevHash)
    .update(canonical({ ts: e.ts, actor: e.actor, action: e.action, runId: e.runId, entityType: e.entityType, entityId: e.entityId, details: e.details }))
    .digest("hex");
}

export function appendAudit(db: DB, input: AuditInput): AuditEvent {
  const last = db.prepare("SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined;
  const base = {
    ts: new Date().toISOString(),
    actor: input.actor,
    action: input.action,
    runId: input.runId ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    details: input.details ?? {},
    prevHash: last?.hash ?? GENESIS,
  };
  const hash = hashEvent(base);
  const info = db
    .prepare(
      "INSERT INTO audit_events (ts, actor, action, run_id, entity_type, entity_id, details_json, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(base.ts, base.actor, base.action, base.runId, base.entityType, base.entityId, canonical(base.details), base.prevHash, hash);
  return { ...base, seq: Number(info.lastInsertRowid), hash };
}

interface AuditRow {
  seq: number;
  ts: string;
  actor: string;
  action: string;
  run_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  details_json: string;
  prev_hash: string;
  hash: string;
}

const toEvent = (r: AuditRow): AuditEvent => ({
  seq: r.seq,
  ts: r.ts,
  actor: r.actor,
  action: r.action,
  runId: r.run_id,
  entityType: r.entity_type,
  entityId: r.entity_id,
  details: JSON.parse(r.details_json),
  prevHash: r.prev_hash,
  hash: r.hash,
});

export function listAudit(db: DB, opts: { runId?: string; limit?: number } = {}): AuditEvent[] {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);
  const rows = opts.runId
    ? (db.prepare("SELECT * FROM audit_events WHERE run_id = ? ORDER BY seq DESC LIMIT ?").all(opts.runId, limit) as AuditRow[])
    : (db.prepare("SELECT * FROM audit_events ORDER BY seq DESC LIMIT ?").all(limit) as AuditRow[]);
  return rows.map(toEvent);
}

/** Recompute the whole chain. Returns the first broken sequence number, if any. */
export function verifyAuditChain(db: DB): { ok: boolean; events: number; brokenAt: number | null } {
  const rows = db.prepare("SELECT * FROM audit_events ORDER BY seq ASC").all() as AuditRow[];
  let prev = GENESIS;
  for (const r of rows) {
    const e = toEvent(r);
    if (e.prevHash !== prev || hashEvent(e) !== e.hash) return { ok: false, events: rows.length, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true, events: rows.length, brokenAt: null };
}
