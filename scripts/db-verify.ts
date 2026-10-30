/**
 * Database verification snapshot shared by backup and migration scripts.
 * Read-only: computes integrity, row counts, exact per-currency totals,
 * fingerprints of transactions and audit hashes, and per-workspace chain status.
 */
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { verifyAuditChain } from "../src/server/audit";

export interface Snapshot {
  integrity: string;
  counts: Record<string, number>;
  totals: Record<string, string>;
  txFingerprint: string;
  auditFingerprint: string;
  chains: { org: string; ok: boolean; events: number; brokenAt: number | null }[];
}

export function snapshot(db: Database.Database): Snapshot {
  const integrity = db.prepare("PRAGMA integrity_check").pluck().get() as string;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all() as string[];
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = db.prepare(`SELECT COUNT(*) FROM "${t}"`).pluck().get() as number;

  const totals: Record<string, bigint> = {};
  const txHash = createHash("sha256");
  const tx = db.prepare(
    `SELECT d.side AS side, t.currency AS currency, t.amount_minor AS amount, t.dataset_id AS ds, t.id AS id
     FROM transactions t JOIN datasets d ON d.id = t.dataset_id ORDER BY t.dataset_id, t.id`,
  );
  for (const r of tx.iterate() as Iterable<{ side: string; currency: string; amount: string; ds: string; id: string }>) {
    const k = `${r.side}:${r.currency}`;
    totals[k] = (totals[k] ?? 0n) + BigInt(r.amount);
    txHash.update(`${r.ds}|${r.id}|${r.currency}|${r.amount}\n`);
  }
  const auditHash = createHash("sha256");
  for (const h of db.prepare("SELECT seq, hash FROM audit_events ORDER BY seq").iterate() as Iterable<{ seq: number; hash: string }>) {
    auditHash.update(`${h.seq}|${h.hash}\n`);
  }
  const orgs = db.prepare("SELECT DISTINCT organization_id FROM audit_events").pluck().all() as (string | null)[];
  return {
    integrity,
    counts,
    totals: Object.fromEntries(Object.entries(totals).sort().map(([k, v]) => [k, v.toString()])),
    txFingerprint: txHash.digest("hex"),
    auditFingerprint: auditHash.digest("hex"),
    chains: orgs.map((o) => ({ org: o ?? "(legacy, no workspace)", ...verifyAuditChain(db, o) })),
  };
}

/** Differences between two snapshots that would indicate data loss or corruption. */
export function compare(before: Snapshot, after: Snapshot): string[] {
  const problems: string[] = [];
  if (after.integrity !== "ok") problems.push(`integrity_check: ${after.integrity}`);
  for (const k of new Set([...Object.keys(before.counts), ...Object.keys(after.counts)])) {
    if (before.counts[k] !== after.counts[k]) problems.push(`row count ${k}: ${before.counts[k]} → ${after.counts[k]}`);
  }
  if (JSON.stringify(before.totals) !== JSON.stringify(after.totals)) problems.push("transaction totals differ");
  if (before.txFingerprint !== after.txFingerprint) problems.push("transaction fingerprint differs");
  if (before.auditFingerprint !== after.auditFingerprint) problems.push("audit fingerprint differs");
  for (const c of after.chains) if (!c.ok) problems.push(`audit chain broken in ${c.org} at #${c.brokenAt}`);
  return problems;
}
