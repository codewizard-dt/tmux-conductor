// app/api/lib/crypto.ts
// Shared cryptographic utilities for the pairing flow.
// All functions use Node built-in `node:crypto` — no external dependencies.

import { createHash, randomBytes } from 'node:crypto';

/**
 * Crockford base32 alphabet — 32 chars, case-insensitive, excludes O/I/L/U to
 * avoid visual ambiguity. Characters: 0-9 A-H J K M N P-T V-Z.
 */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generates a raw 8-character pairing code using the Crockford base32 alphabet.
 * Uses 5 random bytes (40 bits) → 8 × 5-bit chunks mapped via modulo-32 index.
 * No dashes — caller formats via formatPairingCode().
 */
export function generatePairingCode(): string {
  const buf = randomBytes(5);
  // Pack 5 bytes into a 40-bit integer (big-endian) then extract 8 × 5-bit groups.
  let val = 0n;
  for (let i = 0; i < 5; i++) {
    val = (val << 8n) | BigInt(buf[i]!);
  }
  let code = '';
  for (let i = 7; i >= 0; i--) {
    const idx = Number((val >> BigInt(i * 5)) & 0x1fn);
    code += CROCKFORD[idx];
  }
  return code;
}

/**
 * Formats a raw 8-char pairing code as XXXX-XXXX for display.
 */
export function formatPairingCode(code: string): string {
  return code.slice(0, 4) + '-' + code.slice(4);
}

/**
 * Normalises a user-supplied pairing code (possibly formatted as XXXX-XXXX):
 *  - Uppercases the input
 *  - Strips hyphens and spaces
 *  - Validates length == 8 and all chars in CROCKFORD
 * Throws Error('invalid_pairing_code') on validation failure.
 */
export function normalisePairingCode(input: string): string {
  const stripped = input.toUpperCase().replace(/[-\s]/g, '');
  if (stripped.length !== 8) {
    throw new Error('invalid_pairing_code');
  }
  for (const ch of stripped) {
    if (!CROCKFORD.includes(ch)) {
      throw new Error('invalid_pairing_code');
    }
  }
  return stripped;
}

/**
 * SHA-256 of the given data, returned as a raw 32-byte Buffer suitable for
 * Postgres `bytea` columns. NOT a hex string.
 */
export function sha256(data: Buffer | string): Buffer {
  return createHash('sha256').update(data).digest();
}

/**
 * Generates a one-time device token: `tcd_` prefix + base64url of 32 random bytes.
 * Show exactly once at pairing redemption; never persist the plaintext.
 */
export function generateDeviceToken(): string {
  return 'tcd_' + randomBytes(32).toString('base64url');
}
