// portal/env.ts
// Typed, fail-fast, tiered environment validation for the portal service.
//
// Downstream tasks will tighten Google/session vars to hard-required once auth lands:
//   - SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PUBLIC_BASE_URL → required (TASK-025)
//
// Out of scope here: OAuth flow, session store, relay, devices/pairing routes.

const errors: string[] = [];

// --- Required ---
const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  errors.push('DATABASE_URL is required but not set');
}

// --- PORT ---
const portRaw = process.env['PORT'];
const PORT = portRaw !== undefined ? parseInt(portRaw, 10) : 8080;
if (portRaw !== undefined && isNaN(PORT)) {
  errors.push(`PORT must be a valid integer, got: ${portRaw}`);
}

// --- SESSION_SECRET (set-but-too-short is a hard error) ---
const SESSION_SECRET = process.env['SESSION_SECRET'];
if (SESSION_SECRET !== undefined && Buffer.byteLength(SESSION_SECRET, 'utf8') < 32) {
  errors.push(
    `SESSION_SECRET is set but too short (${Buffer.byteLength(SESSION_SECRET, 'utf8')} bytes); must be ≥32 bytes`,
  );
}

// --- Fail fast: report ALL errors together ---
if (errors.length > 0) {
  console.error('[portal] Environment validation failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

// --- Permissive-with-warning: auth vars ---
const GOOGLE_CLIENT_ID = process.env['GOOGLE_CLIENT_ID'];
const GOOGLE_CLIENT_SECRET = process.env['GOOGLE_CLIENT_SECRET'];
const PUBLIC_BASE_URL = process.env['PUBLIC_BASE_URL'];

if (!SESSION_SECRET || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !PUBLIC_BASE_URL) {
  console.warn(
    '[portal] auth not fully configured — /healthz boots but OAuth disabled (see TASK-025)',
  );
}

// --- ALLOWLIST_EMAILS ---
const ALLOWLIST_EMAILS: string[] = (process.env['ALLOWLIST_EMAILS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Export a single typed frozen env object.
export const env = Object.freeze({
  DATABASE_URL: DATABASE_URL as string,
  SESSION_SECRET: SESSION_SECRET as string | undefined,
  GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID as string | undefined,
  GOOGLE_CLIENT_SECRET: GOOGLE_CLIENT_SECRET as string | undefined,
  PUBLIC_BASE_URL: PUBLIC_BASE_URL as string | undefined,
  ALLOWLIST_EMAILS,
  PORT,
});
