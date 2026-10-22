/**
 * Local writable store for the mock backend: viewing calendar, leads, audit log.
 *
 * SQLite under /data, the volume Astropods persists across restarts and
 * redeploys. Falls back to ./.data when /data is not writable (bun test,
 * scripts run on the host).
 */

import { Database } from 'bun:sqlite';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function resolveDataDir(): string {
  const preferred = process.env.DATA_DIR || '/data';
  try {
    mkdirSync(preferred, { recursive: true });
    accessSync(preferred, constants.W_OK);
    return preferred;
  } catch {
    const fallback = join(process.cwd(), '.data');
    mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

export const DATA_DIR = resolveDataDir();

export const db = new Database(process.env.BACKEND_DB === ':memory:' ? ':memory:' : join(DATA_DIR, 'concierge-backend.db'));
db.exec('PRAGMA journal_mode=WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS viewings (
    id          TEXT PRIMARY KEY,
    listing_id  TEXT NOT NULL,
    agent_id    TEXT NOT NULL,
    slot        TEXT NOT NULL,
    attendee    TEXT,
    status      TEXT NOT NULL DEFAULT 'confirmed',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (agent_id, slot)
  );
  CREATE TABLE IF NOT EXISTS leads (
    id               TEXT PRIMARY KEY,
    listing_id       TEXT NOT NULL,
    agent_id         TEXT NOT NULL,
    summary_json     TEXT NOT NULL,
    readiness_score  INTEGER NOT NULL,
    approved_at      TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event       TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Bookings and handoffs are linked to the user whose memory lives in the
// Postgres knowledge store (memory-db.ts). Additive migration for older files.
function addColumnIfMissing(table: string, column: string, type: string) {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
addColumnIfMissing('viewings', 'user_id', 'TEXT');
addColumnIfMissing('leads', 'user_id', 'TEXT');

const auditStmt = db.prepare('INSERT INTO audit_log (event, detail_json) VALUES (?, ?)');
export function audit(event: string, detail: unknown): void {
  auditStmt.run(event, JSON.stringify(detail));
}
