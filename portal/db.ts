// portal/db.ts
// pg Pool singleton for the portal service.
//
// TODO(prod): replace rejectUnauthorized:false with a pinned CA_CERT on prod promotion (TASK-026 / ROADMAP-006).
// DigitalOcean Managed Postgres dev DBs present a self-signed CA; rejectUnauthorized:false is intentional for dev.

import pg from 'pg';
import { env } from './env.ts';

const { Pool } = pg;

let pool: pg.Pool | undefined;

/**
 * Returns the memoised pg Pool, constructing it on first call.
 * Uses ssl: { rejectUnauthorized: false } for DO Managed Postgres dev compatibility.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

/**
 * Convenience query wrapper delegating to the Pool singleton.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/**
 * Ends the pool if constructed. Used by graceful shutdown.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
