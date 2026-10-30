/**
 * Print a read-only fingerprint of a database (row counts, totals, transaction and
 * audit fingerprints, chain status) as JSON. Opens the file READ-ONLY.
 *
 * Usage: npx tsx scripts/db-fingerprint.ts <path-to.db>
 */
import Database from "better-sqlite3";
import { snapshot } from "./db-verify";

const file = process.argv[2];
if (!file) {
  console.error("Usage: tsx scripts/db-fingerprint.ts <path-to.db>");
  process.exit(2);
}
const db = new Database(file, { readonly: true, fileMustExist: true });
const s = snapshot(db);
db.close();
console.log(JSON.stringify({ file, ...s }, null, 2));
