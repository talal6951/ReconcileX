import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Local SQLite store. Money is stored as TEXT holding the integer minor-unit
 * value so it round-trips through BigInt without precision loss.
 */
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  side TEXT NOT NULL CHECK (side IN ('bank','ledger')),
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  mapping_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  source_line INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  date TEXT NOT NULL,
  day INTEGER NOT NULL,
  amount_minor TEXT NOT NULL,
  currency TEXT NOT NULL,
  reference TEXT NOT NULL,
  description TEXT NOT NULL,
  counterparty TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bank_dataset_id TEXT NOT NULL REFERENCES datasets(id),
  ledger_dataset_id TEXT NOT NULL REFERENCES datasets(id),
  engine_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  config_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  duplicate_groups_json TEXT NOT NULL,
  source TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  original_status TEXT NOT NULL,
  method TEXT NOT NULL,
  score REAL NOT NULL,
  bank_ids_json TEXT NOT NULL,
  ledger_ids_json TEXT NOT NULL,
  currency TEXT NOT NULL,
  bank_total_minor TEXT NOT NULL,
  ledger_total_minor TEXT NOT NULL,
  flags_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  PRIMARY KEY (run_id, id)
);
CREATE INDEX IF NOT EXISTS matches_status ON matches(run_id, status);

CREATE TABLE IF NOT EXISTS exceptions (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  bank_ids_json TEXT NOT NULL,
  ledger_ids_json TEXT NOT NULL,
  currency TEXT NOT NULL,
  exposure_minor TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL,
  PRIMARY KEY (run_id, id)
);

CREATE TABLE IF NOT EXISTS review_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('match','exception')),
  subject_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  run_id TEXT,
  entity_type TEXT,
  entity_id TEXT,
  details_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

-- The audit log is append-only.
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
`;

export type DB = Database.Database;

/** Additive migrations for databases created before multi-tenancy. Never drops data. */
const TENANT_COLUMNS: [table: string, column: string][] = [
  ["datasets", "organization_id"],
  ["runs", "organization_id"],
  ["audit_events", "organization_id"],
];

function migrate(db: DB) {
  for (const [table, column] of TENANT_COLUMNS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS runs_org ON runs(organization_id, created_at);
    CREATE INDEX IF NOT EXISTS audit_org ON audit_events(organization_id, seq);
  `);
}

export function openDatabase(file: string): DB {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

const globalForDb = globalThis as unknown as { __reconcilexDb?: DB };

/** Process-wide connection (survives Next.js dev hot reloads). */
export function getDb(): DB {
  if (!globalForDb.__reconcilexDb) {
    const file = process.env.RECONCILEX_DB_PATH ?? path.join(process.cwd(), "data", "reconcilex.db");
    globalForDb.__reconcilexDb = openDatabase(file);
  }
  return globalForDb.__reconcilexDb;
}
