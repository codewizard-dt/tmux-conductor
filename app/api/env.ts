// app/api/env.ts
// Typed, fail-fast, tiered environment validation for the app/api service.
//
// Loads the repo-root .env (two levels up from app/api/) BEFORE any process.env reads,
// so a single root .env drives every service.
//
// Out of scope here: OAuth flow internals, session store, relay, devices/pairing routes.

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env. `import 'dotenv/config'` would only look at CWD, so we
// resolve ../../.env relative to this module's URL. Done before any process.env read.
void fileURLToPath; // imported per task spec; URL form is used directly below
dotenv.config({ path: new URL('../../.env', import.meta.url) });

const errors: string[] = [];

// --- Required ---
const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  errors.push('DATABASE_URL is required but not set');
}

// --- API_PORT ---
const portRaw = process.env['API_PORT'];
const API_PORT = portRaw !== undefined ? parseInt(portRaw, 10) : 8080;
if (portRaw !== undefined && isNaN(API_PORT)) {
  errors.push(`API_PORT must be a valid integer, got: ${portRaw}`);
}

// --- BETTER_AUTH_SECRET (hard-required: must be set AND ≥32 bytes utf8) ---
const BETTER_AUTH_SECRET = process.env['BETTER_AUTH_SECRET'];
if (!BETTER_AUTH_SECRET) {
  errors.push('BETTER_AUTH_SECRET is required but not set');
} else if (Buffer.byteLength(BETTER_AUTH_SECRET, 'utf8') < 32) {
  errors.push(
    `BETTER_AUTH_SECRET is set but too short (${Buffer.byteLength(BETTER_AUTH_SECRET, 'utf8')} bytes); must be ≥32 bytes`,
  );
}

// --- Fail fast: report ALL errors together ---
if (errors.length > 0) {
  console.error('[app/api] Environment validation failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

// --- Permissive-with-warning: auth vars ---
const GOOGLE_CLIENT_ID = process.env['GOOGLE_CLIENT_ID'];
const GOOGLE_CLIENT_SECRET = process.env['GOOGLE_CLIENT_SECRET'];
const PUBLIC_BASE_URL = process.env['PUBLIC_BASE_URL'];

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.warn(
    '[app/api] auth not fully configured — email/password works, but Google OAuth is disabled until GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set',
  );
}

// --- HOST_SERVER_URL (URL of the host-side conductor backend reachable from the container) ---
const HOST_SERVER_URL = process.env['HOST_SERVER_URL'] ?? 'http://host.docker.internal:8788';

// --- ALLOWLIST_EMAILS ---
const ALLOWLIST_EMAILS: string[] = (process.env['ALLOWLIST_EMAILS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Export a single typed frozen env object.
export const env = Object.freeze({
  DATABASE_URL: DATABASE_URL as string,
  BETTER_AUTH_SECRET: BETTER_AUTH_SECRET as string,
  HOST_SERVER_URL,
  GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID as string | undefined,
  GOOGLE_CLIENT_SECRET: GOOGLE_CLIENT_SECRET as string | undefined,
  PUBLIC_BASE_URL: PUBLIC_BASE_URL as string | undefined,
  ALLOWLIST_EMAILS,
  API_PORT,
});