/**
 * Apply database migrations: Better Auth tables (users, sessions, organizations,
 * members, invitations) and Reconcile X tenancy columns. Additive only.
 * Exits non-zero on any failure, or if anything remains unapplied afterwards.
 * Usage: npm run db:migrate
 */
import { getMigrations } from "better-auth/db/migration";
import { auth } from "../src/server/auth";
import { getDb } from "../src/server/db";

async function main() {
  const before = await getMigrations(auth.options);
  console.log(`Auth tables to create: ${before.toBeCreated.map((t) => t.table).join(", ") || "none"}`);
  console.log(`Auth columns to add: ${before.toBeAdded.map((t) => `${t.table}(${Object.keys(t.fields).join(",")})`).join(", ") || "none"}`);
  await before.runMigrations();

  const after = await getMigrations(auth.options);
  if (after.toBeCreated.length > 0 || after.toBeAdded.length > 0) {
    throw new Error(`Migration incomplete: ${after.toBeCreated.length} tables and ${after.toBeAdded.length} column sets still pending`);
  }
  const db = getDb(); // applies the app schema and tenancy columns on open
  const integrity = db.prepare("PRAGMA integrity_check").pluck().get();
  if (integrity !== "ok") throw new Error(`integrity_check failed: ${String(integrity)}`);
  console.log("Migrations complete. Pending: 0. integrity_check: ok");
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
