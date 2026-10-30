/**
 * Apply the Stage 2 (imports) migration to the LIVE database, with before/after verification.
 * Run only after `npm run db:backup -- <label>` has succeeded.
 * Exit code 0 only if every check passes; any unexpected difference stops with exit 1.
 *
 * Usage: npx tsx scripts/apply-imports-migration.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
import { applyImportsMigration, IMPORT_COLUMNS } from "../src/server/migrations/imports";
import { compare, snapshot } from "./db-verify";

const ROOT = path.resolve(import.meta.dirname, "..");
const LIVE = process.env.RECONCILEX_DB_PATH ?? path.join(ROOT, "data", "reconcilex.db");

function main(): number {
  const db = new Database(LIVE, { fileMustExist: true });
  const before = snapshot(db);
  if (before.integrity !== "ok" || before.chains.some((c) => !c.ok)) {
    console.error("STOPPED before migrating: live database failed pre-checks.", before.integrity, before.chains.filter((c) => !c.ok));
    db.close();
    return 1;
  }
  const datasetsBefore = db.prepare("SELECT * FROM datasets ORDER BY id").all() as Record<string, unknown>[];

  const executed = applyImportsMigration(db);

  const after = snapshot(db);
  const datasetsAfter = db.prepare("SELECT * FROM datasets ORDER BY id").all() as Record<string, unknown>[];
  const columns = db.prepare("PRAGMA table_info(datasets)").all() as { name: string; type: string; notnull: number; dflt_value: unknown }[];
  db.close();

  const names = IMPORT_COLUMNS.map(([n]) => n);
  const newCols = columns.filter((c) => names.includes(c.name));
  const unchanged =
    datasetsBefore.length === datasetsAfter.length &&
    datasetsBefore.every((row, i) => Object.keys(row).every((k) => row[k] === datasetsAfter[i]![k]) && names.every((n) => datasetsAfter[i]![n] === null));
  const diffs = compare(before, after);

  const checks: [string, boolean, string][] = [
    ["Statements executed", executed.length === 6 || executed.length === 0, `${executed.length} (0 means already applied)`],
    ["Database integrity", after.integrity === "ok", after.integrity],
    ["Row counts identical", JSON.stringify(before.counts) === JSON.stringify(after.counts), `${Object.keys(after.counts).length} tables`],
    ["Financial totals identical", JSON.stringify(before.totals) === JSON.stringify(after.totals), JSON.stringify(after.totals)],
    ["Transaction fingerprint identical", before.txFingerprint === after.txFingerprint, after.txFingerprint],
    ["Audit-hash fingerprint identical", before.auditFingerprint === after.auditFingerprint, after.auditFingerprint],
    ["All audit chains valid", after.chains.every((c) => c.ok), `${after.chains.filter((c) => c.ok).length}/${after.chains.length}`],
    ["Six nullable columns present, no defaults", newCols.length === 6 && newCols.every((c) => c.notnull === 0 && c.dflt_value === null), newCols.map((c) => c.name).join(", ")],
    ["Existing dataset rows unchanged", unchanged, `${datasetsAfter.length} rows`],
    ["compare() reports no differences", diffs.length === 0, diffs.join("; ") || "none"],
  ];
  for (const s of executed) console.log(`executed: ${s}`);
  for (const [label, ok, detail] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(failed ? `\nMIGRATION VERIFICATION FAILED (${failed}). Restore from the backup taken immediately before this run.` : "\nMIGRATION APPLIED AND VERIFIED.");
  return failed ? 1 : 0;
}

process.exit(main());
