// portal/migrate.ts
// Advisory-locked, idempotent migration runner.
//
// Runs ordered NNN_*.sql files from portal/migrations/ against the database.
// Uses pg_advisory_lock to prevent concurrent double-apply when multiple portal
// instances boot simultaneously.
//
// Out of scope: 001_init.sql DDL lives in a downstream task (TASK-024).

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from './db.ts';

const ADVISORY_LOCK_KEY = 4711n; // fixed bigint key for portal migrations
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Acquire a session-level advisory lock, run all pending migrations, release the lock.
 * Idempotent: re-running with no new files is a clean no-op.
 */
export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Acquire session-level advisory lock to prevent concurrent double-apply.
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    // Ensure migrations tracking table exists.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     text        PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Read migration files in lexical order.
    let files: string[];
    try {
      const entries = await readdir(MIGRATIONS_DIR);
      files = entries.filter((f) => f.endsWith('.sql')).sort();
    } catch {
      files = [];
    }

    if (files.length === 0) {
      console.log('[portal] no migrations to apply');
      return;
    }

    // Fetch already-applied versions.
    const { rows } = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations',
    );
    const applied = new Set(rows.map((r) => r.version));

    // Apply each pending migration in its own transaction.
    for (const file of files) {
      if (applied.has(file)) {
        continue; // idempotent: already applied
      }

      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
        await client.query('COMMIT');
        console.log(`[portal] applied migration: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    // Always release the advisory lock and return the client.
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}

// CLI guard — only runs when invoked directly (e.g. `npm run migrate`).
if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) {
  runMigrations()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[portal] migration failed:', err);
      closePool().finally(() => process.exit(1));
    });
}
