/**
 * The agent's memory database: the `memory` Postgres knowledge store declared
 * in astropods.yml. The platform provisions it (a container next to the agent
 * under `ast project start`; a managed or shared database when deployed) and
 * injects POSTGRES_HOST / _PORT / _USER / _PASSWORD / _DB.
 *
 * One pool, two users:
 *   - Mastra's PostgresStore: conversation threads/messages + suspended runs.
 *   - user_profiles: long-term, cross-conversation profile per user.
 */

import { Pool } from 'pg';

export const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgres',
  database: process.env.POSTGRES_DB ?? 'postgres',
  max: 5,
});

pool.on('error', (err) => console.error('[memory-db] idle client error', err.message));

let ready: Promise<void> | null = null;

/** Create the profile table on first use. Safe to call repeatedly. */
export function ensureMemorySchema(): Promise<void> {
  ready ??= pool
    .query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id       TEXT PRIMARY KEY,
        profile       JSONB NOT NULL DEFAULT '{}'::jsonb,
        conversations INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`)
    .then(() => undefined)
    .catch((err) => {
      ready = null; // retry on the next call, e.g. while the database is still starting
      throw err;
    });
  return ready;
}
