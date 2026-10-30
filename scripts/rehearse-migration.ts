/**
 * Rehearse the Stage 2 (imports) migration on a SEPARATE COPY of a verified backup.
 * The live database is never opened. Refuses to operate on the live DB or on the backup itself.
 *
 * Usage: npx tsx scripts/rehearse-migration.ts <backup-file.db> <empty-or-scratch-dir>
 * Exit code 0 only if every check passes.
 */
import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { applyImportsMigration, IMPORT_COLUMNS } from "../src/server/migrations/imports";
import { compare, snapshot } from "./db-verify";

const ROOT = path.resolve(import.meta.dirname, "..");
const LIVE = path.join(ROOT, "data", "reconcilex.db");

function main(): number {
  const [backupArg, workArg] = process.argv.slice(2);
  if (!backupArg || !workArg) {
    console.error("Usage: tsx scripts/rehearse-migration.ts <backup-file.db> <scratch-dir>");
    return 2;
  }
  const backup = realpathSync(backupArg);
  mkdirSync(workArg, { recursive: true });
  const copyPath = path.join(realpathSync(workArg), "rehearsal.db");

  // Safety rails: never touch the live database or the backup itself.
  if (existsSync(LIVE) && (backup === realpathSync(LIVE) || copyPath === realpathSync(LIVE))) {
    console.error("REFUSED: path resolves to the live database.");
    return 2;
  }
  if (copyPath === backup) {
    console.error("REFUSED: rehearsal copy would overwrite the backup.");
    return 2;
  }
  for (const suffix of ["", "-wal", "-shm"]) rmSync(copyPath + suffix, { force: true });
  copyFileSync(backup, copyPath);
  console.log(`Backup (read only): ${path.relative(ROOT, backup)}`);
  console.log(`Rehearsal copy:     ${copyPath}\n`);

  const db = new Database(copyPath);
  const before = snapshot(db);
  const datasetsBefore = db.prepare("SELECT * FROM datasets ORDER BY id").all() as Record<string, unknown>[];

  const firstRun = applyImportsMigration(db);
  const secondRun = applyImportsMigration(db);

  const after = snapshot(db);
  const datasetsAfter = db.prepare("SELECT * FROM datasets ORDER BY id").all() as Record<string, unknown>[];
  const columns = db.prepare("PRAGMA table_info(datasets)").all() as { name: string; type: string; notnull: number; dflt_value: unknown }[];
  db.close();

  const newNames = IMPORT_COLUMNS.map(([n]) => n);
  const newCols = columns.filter((c) => newNames.includes(c.name));
  // Existing rows unchanged: every original column value identical, every new column NULL.
  const unchanged =
    datasetsBefore.length === datasetsAfter.length &&
    datasetsBefore.every((row, i) => {
      const a = datasetsAfter[i]!;
      return Object.keys(row).every((k) => row[k] === a[k]) && newNames.every((n) => a[n] === null);
    });

  const checks: [string, boolean, string][] = [
    ["Database integrity (integrity_check)", after.integrity === "ok", after.integrity],
    ["Row counts identical (all tables)", JSON.stringify(before.counts) === JSON.stringify(after.counts), `${Object.keys(after.counts).length} tables`],
    ["Financial totals identical (bigint, per side:currency)", JSON.stringify(before.totals) === JSON.stringify(after.totals), `${Object.keys(after.totals).length} totals`],
    ["Transaction fingerprint identical", before.txFingerprint === after.txFingerprint, after.txFingerprint.slice(0, 16) + "…"],
    ["Audit-hash fingerprint identical", before.auditFingerprint === after.auditFingerprint, after.auditFingerprint.slice(0, 16) + "…"],
    ["All audit chains valid", after.chains.every((c) => c.ok), `${after.chains.filter((c) => c.ok).length}/${after.chains.length} chains`],
    ["Six new columns added on first run", firstRun.length === 6 && newCols.length === 6, `${firstRun.length} statements`],
    ["Idempotent (second run executes nothing)", secondRun.length === 0, `${secondRun.length} statements`],
    ["All six new columns nullable, no default", newCols.every((c) => c.notnull === 0 && c.dflt_value === null), newCols.map((c) => `${c.name} ${c.type}`).join(", ")],
    ["Existing dataset rows unchanged (old values equal, new columns NULL)", unchanged, `${datasetsAfter.length} rows compared`],
    ["No differences reported by compare()", compare(before, after).length === 0, compare(before, after).join("; ") || "none"],
  ];

  console.log("Statements executed (first run):");
  for (const s of firstRun) console.log(`  ${s}`);
  console.log("\nTables / row counts after:");
  for (const [k, v] of Object.entries(after.counts)) console.log(`  ${k.padEnd(18)} ${String(v).padStart(7)}  (before ${before.counts[k]})`);
  console.log("\nTotals after (before) — minor units:");
  for (const [k, v] of Object.entries(after.totals)) console.log(`  ${k.padEnd(14)} ${v.padStart(14)}  (${before.totals[k]})`);
  console.log("\nChecks:");
  for (const [label, ok, detail] of checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(failed ? `\nREHEARSAL FAILED (${failed} check(s)).` : "\nREHEARSAL PASSED: additive, idempotent, all records preserved.");
  return failed ? 1 : 0;
}

process.exit(main());
