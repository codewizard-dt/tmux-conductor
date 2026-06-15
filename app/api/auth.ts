// app/api/auth.ts
// better-auth configuration for the app/api service.
//
// Uses the node-postgres Pool from ./db.ts directly (better-auth accepts a pg Pool
// as its `database` option and uses the built-in Kysely adapter against it).
// Run `npm run auth:generate` to (re)generate the SQL schema better-auth requires.

import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { getPool } from './db.ts';
import { env } from './env.ts';

// Google is only wired when BOTH credentials are present; otherwise socialProviders
// is omitted entirely so better-auth doesn't register a half-configured provider.
const socialProviders: NonNullable<BetterAuthOptions['socialProviders']> = {};
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}

export const auth = betterAuth({
  // node-postgres Pool passed straight through; built-in Kysely adapter handles it.
  database: getPool(),
  secret: env.BETTER_AUTH_SECRET,
  basePath: '/auth',
  ...(env.PUBLIC_BASE_URL ? { baseURL: env.PUBLIC_BASE_URL } : {}),
  // The frontend is served from a different origin (Vite dev :4321, or the App
  // Platform static-site domain in prod) than this API's baseURL, and reaches us
  // through a proxy. better-auth validates the browser Origin header against its
  // baseURL by default and 403s (INVALID_ORIGIN) on a mismatch, so the frontend
  // origin must be explicitly trusted. Driven by CORS_ORIGIN (same value used by
  // @fastify/cors in index.ts), defaulting to the local Vite dev origin.
  trustedOrigins: [env.CORS_ORIGIN],
  // Cookie hardening. better-auth already sets HttpOnly + SameSite=Lax by default;
  // we additionally force the Secure attribute in production (real enforcement still
  // depends on the deployment terminating TLS). Gating on NODE_ENV keeps local http
  // dev (no TLS) working, where browsers would otherwise drop a Secure cookie.
  advanced: {
    useSecureCookies: process.env['NODE_ENV'] === 'production',
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  ...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),
  databaseHooks: {
    user: {
      create: {
        // Invite-code redemption gate. Runs before better-auth persists the new user row.
        // Order of checks:
        //   1. BOOTSTRAP_ADMIN_EMAIL — always allowed, no code required.
        //   2. Grandfather — email already exists in "user" table → allow (no code consumed).
        //   3. x-invite-code header — validate & atomically consume (transaction-safe).
        before: async (user, ctx) => {
          const email = (user.email ?? '').toLowerCase();

          // 1. Bootstrap admin bypasses the invite-code gate entirely.
          if (email === env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) {
            return { data: user };
          }

          // 2. Grandfather existing accounts (e.g. on re-deploy or schema change).
          const pool = getPool();
          const { rows: existing } = await pool.query<{ id: string }>(
            'SELECT id FROM "user" WHERE lower(email) = $1',
            [email],
          );
          if (existing.length > 0) {
            return { data: user };
          }

          // 3. Require a valid, non-expired, non-exhausted invite code.
          // better-auth passes a web-standard Headers object OR a plain header map
          // depending on the runtime. Handle both shapes.
          const hdrs = ctx?.request?.headers;
          let rawCode: string | undefined;
          if (hdrs) {
            if (typeof (hdrs as { get?: unknown }).get === 'function') {
              rawCode = (hdrs as Headers).get('x-invite-code') ?? undefined;
            } else {
              rawCode = (hdrs as unknown as Record<string, string | undefined>)['x-invite-code'];
            }
          }

          if (!rawCode || rawCode.trim() === '') {
            throw new Error('invite code required');
          }

          const code = rawCode.trim();

          // Open a dedicated client for the transaction so we can use SELECT … FOR UPDATE.
          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            const { rows } = await client.query<{
              id: string;
              used_count: number;
              usage_limit: number;
              expires_at: Date | null;
            }>(
              `SELECT id, used_count, usage_limit, expires_at
               FROM invite_codes
               WHERE code = $1
               FOR UPDATE`,
              [code],
            );

            if (rows.length === 0) {
              await client.query('ROLLBACK');
              throw new Error('invite code is invalid');
            }

            const row = rows[0]!;

            if (row.expires_at !== null && row.expires_at <= new Date()) {
              await client.query('ROLLBACK');
              throw new Error('invite code has expired');
            }

            if (row.used_count >= row.usage_limit) {
              await client.query('ROLLBACK');
              throw new Error('invite code has been fully redeemed');
            }

            await client.query(
              'UPDATE invite_codes SET used_count = used_count + 1 WHERE id = $1',
              [row.id],
            );

            await client.query('COMMIT');
          } catch (err) {
            // Ensure any open transaction is rolled back on unexpected errors.
            try {
              await client.query('ROLLBACK');
            } catch {
              // ignore rollback errors
            }
            throw err;
          } finally {
            client.release();
          }

          return { data: user };
        },
      },
    },
  },
});
