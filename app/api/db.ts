// portal/db.ts
// pg Pool singleton for the portal service.
//
// TODO(prod): replace rejectUnauthorized:false with a pinned CA_CERT on prod promotion (TASK-026 / ROADMAP-006).
// DigitalOcean Managed Postgres dev DBs present a self-signed CA; rejectUnauthorized:false is intentional for dev.

import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from './env.ts';

const { Pool } = pg;

let pool: pg.Pool | undefined;

/**
 * Returns the memoised pg Pool, constructing it on first call.
 * Uses ssl: { rejectUnauthorized: false } for DO Managed Postgres dev compatibility.
 */
/**
 * Resolve the TLS config for the pg Pool.
 *
 * DigitalOcean Managed Postgres presents a self-signed project CA, so plain
 * `sslmode=require` (now treated as `verify-full` by pg) fails. We pin that CA
 * instead, giving fully-verified TLS. The PEM is sourced, in priority order:
 *   1. DATABASE_CA_CERT  — inline PEM (App Platform secret)
 *   2. DATABASE_CA_CERT_PATH — path to a PEM file
 *   3. deploy/do-ca-certificate.crt — committed CA (local dev / VPS)
 * Falls back to unverified TLS only if no CA is found, so a missing cert never
 * hard-breaks local development.
 */
function resolveSsl(): { ca: string; rejectUnauthorized: true } | { rejectUnauthorized: false } {
  const inline = process.env['DATABASE_CA_CERT'];
  if (inline && inline.includes('BEGIN CERTIFICATE')) {
    return { ca: inline, rejectUnauthorized: true };
  }
  const caPath =
    process.env['DATABASE_CA_CERT_PATH'] ??
    fileURLToPath(new URL('../../deploy/do-ca-certificate.crt', import.meta.url));
  try {
    return { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
  } catch {
    return { rejectUnauthorized: false };
  }
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: resolveSsl(),
    });
    // pg forwards backend/network errors from IDLE pooled clients as a Pool
    // 'error' event. Without a listener, Node escalates it to an unhandled
    // 'error' and crashes the process — e.g. EADDRNOTAVAIL/ECONNRESET when DO
    // closes an idle connection or the host's network blips. pg already evicts
    // the dead client, so we just log and keep serving.
    pool.on('error', (err) => {
      console.error('[db] idle pg client error (connection evicted):', err.message);
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
