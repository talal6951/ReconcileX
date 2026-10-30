import type Database from "better-sqlite3";

/**
 * Stage 2 migration: provenance columns for imported statements.
 * Additive only — six NULLABLE columns on `datasets`, no defaults, no data rewrite.
 * Existing rows keep NULL (meaning: legacy CSV import, recorded before this migration).
 */
export const IMPORT_COLUMNS: readonly (readonly [name: string, type: string, purpose: string])[] = [
  ["source_kind", "TEXT", "csv | xlsx | xls | pdf"],
  ["source_sha256", "TEXT", "SHA-256 of the original uploaded file bytes"],
  ["source_bytes", "INTEGER", "size of the original file in bytes"],
  ["extraction_json", "TEXT", "extraction report: warnings, balance check, excluded rows, sheet/pages"],
  ["confirmed_by", "TEXT", "user who confirmed the transaction preview"],
  ["confirmed_at", "TEXT", "ISO timestamp of that confirmation"],
] as const;

/** Apply missing columns inside one transaction. Returns the statements executed (empty if already applied). */
export function applyImportsMigration(db: Database.Database): string[] {
  const existing = new Set((db.prepare("PRAGMA table_info(datasets)").all() as { name: string }[]).map((c) => c.name));
  const statements = IMPORT_COLUMNS.filter(([name]) => !existing.has(name)).map(([name, type]) => `ALTER TABLE datasets ADD COLUMN ${name} ${type}`);
  db.transaction(() => {
    for (const sql of statements) db.exec(sql);
  })();
  return statements;
}
