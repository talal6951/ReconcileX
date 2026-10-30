/**
 * Verified backup of the Reconcile X database (read-only on the live DB).
 *
 * 1. Snapshot with SQLite's online backup API (consistent, includes WAL contents).
 * 2. Verify the copy independently (see db-verify.ts) and compare with the live DB.
 * 3. Exit non-zero on ANY mismatch.
 *
 * Usage: npm run db:backup -- <label>
 */
import Database from "better-sqlite3";
import { chmodSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { compare, snapshot } from "./db-verify";

const ROOT = path.resolve(import.meta.dirname, "..");
const LIVE = process.env.RECONCILEX_DB_PATH ?? path.join(ROOT, "data", "reconcilex.db");
const DIR = path.join(ROOT, "data", "backups");

async function main() {
  const label = (process.argv[2] ?? "manual").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "manual";
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  chmodSync(DIR, 0o700);
  const dest = path.join(DIR, `reconcilex-${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);

  const live = new Database(LIVE, { fileMustExist: true, readonly: true });
  await live.backup(dest);
  chmodSync(dest, 0o600);
  const copy = new Database(dest, { readonly: true });
  const a = snapshot(live);
  const b = snapshot(copy);
  copy.close();
  live.close();
  const problems = compare(a, b);

  console.log(`Backup: ${path.relative(ROOT, dest)} (${statSync(dest).size.toLocaleString("en-US")} bytes, mode 600)`);
  console.log(`integrity_check (backup): ${b.integrity}`);
  console.log("Row counts (live = backup):");
  for (const [k, v] of Object.entries(b.counts)) console.log(`  ${k.padEnd(18)} ${String(v).padStart(7)}${a.counts[k] === v ? "" : `  ≠ live ${a.counts[k]}`}`);
  console.log("Transaction totals by side:currency (minor units, bigint):");
  for (const [k, v] of Object.entries(b.totals)) console.log(`  ${k.padEnd(14)} ${v.padStart(16)}${a.totals[k] === v ? "" : "  ≠ live"}`);
  console.log(`Transaction fingerprint: ${b.txFingerprint}${a.txFingerprint === b.txFingerprint ? " (matches live)" : " (DIFFERS)"}`);
  console.log(`Audit-hash fingerprint:  ${b.auditFingerprint}${a.auditFingerprint === b.auditFingerprint ? " (matches live)" : " (DIFFERS)"}`);
  console.log(`Audit chains verified on backup: ${b.chains.length} workspace chain(s)`);
  for (const c of b.chains) console.log(`  ${c.ok ? "ok    " : "BROKEN"} ${c.events.toString().padStart(5)} events  ${c.org}`);

  if (problems.length) {
    console.error(`\nBACKUP VERIFICATION FAILED:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nBACKUP VERIFIED: copy is complete and identical to the live database.");
}

main().catch((e) => {
  console.error("BACKUP FAILED:", e);
  process.exit(1);
});
