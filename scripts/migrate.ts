/**
 * Apply database migrations: Better Auth tables (users, sessions, organizations,
 * members, invitations) and Reconcile X schema/tenancy/import columns. Additive only.
 *
 * Usage:
 *   npm run db:migrate                      → the configured database (RECONCILEX_DB_PATH or data/reconcilex.db)
 *   npx tsx --env-file=.env.local scripts/migrate.ts --db <path>   → ONLY that file
 *
 * With --db, the target is fixed BEFORE any module that opens a database is loaded,
 * and the opened connection is verified to be that exact file. Exits non-zero on any failure.
 */
import path from "node:path";

async function main() {
  const i = process.argv.indexOf("--db");
  let expected: string | null = null;
  if (i >= 0) {
    const arg = process.argv[i + 1];
    if (!arg) throw new Error("--db requires a path");
    expected = path.resolve(arg);
    const preset = process.env.RECONCILEX_DB_PATH;
    if (preset !== undefined && path.resolve(preset) !== expected) {
      throw new Error(`RECONCILEX_DB_PATH (${preset}) conflicts with --db (${expected})`);
    }
    process.env.RECONCILEX_DB_PATH = expected;
  }

  // Loaded only now, after the target is fixed: auth.ts opens the database at import time.
  const { getDb } = await import("../src/server/db");
  const db = getDb();
  const opened = path.resolve(db.name);
  console.log(`Database: ${opened}`);
  if (expected && opened !== expected) throw new Error(`Opened ${opened} but --db requested ${expected}; aborting`);

  const { getMigrations } = await import("better-auth/db/migration");
  const { auth } = await import("../src/server/auth");
  const before = await getMigrations(auth.options);
  console.log(`Auth tables to create: ${before.toBeCreated.map((t) => t.table).join(", ") || "none"}`);
  console.log(`Auth columns to add: ${before.toBeAdded.map((t) => `${t.table}(${Object.keys(t.fields).join(",")})`).join(", ") || "none"}`);
  await before.runMigrations();

  const after = await getMigrations(auth.options);
  if (after.toBeCreated.length > 0 || after.toBeAdded.length > 0) {
    throw new Error(`Migration incomplete: ${after.toBeCreated.length} tables and ${after.toBeAdded.length} column sets still pending`);
  }
  const integrity = db.prepare("PRAGMA integrity_check").pluck().get();
  if (integrity !== "ok") throw new Error(`integrity_check failed: ${String(integrity)}`);
  console.log("Migrations complete. Pending: 0. integrity_check: ok");
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
