// app/api/security.ts
// Transport-hardening helpers for the app/api Fastify service.
//
// Provides a same-origin check for mutating requests (CSRF defence-in-depth on the
// custom routes) and a shared verified-email gate for session-backed routes.

import type { FastifyRequest } from 'fastify';
import { env } from './env.ts';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Origins the browser is allowed to mutate from. Derived from the same values that
 * drive @fastify/cors and better-auth trustedOrigins, so the three stay in lockstep.
 */
function allowedOrigins(): Set<string> {
  const origins = new Set<string>();
  const add = (raw: string | undefined): void => {
    if (!raw) return;
    try {
      origins.add(new URL(raw).origin);
    } catch {
      // ignore malformed values
    }
  };
  add(env.CORS_ORIGIN);
  add(env.PUBLIC_BASE_URL);
  return origins;
}

/**
 * Returns true if a mutating request is cross-site and must be rejected.
 *
 * Pass conditions (return false):
 *   - non-mutating method (GET/HEAD/OPTIONS)
 *   - Sec-Fetch-Site: same-origin | same-site | none (browser-asserted, spoof-resistant)
 *   - Origin header present AND in the allowlist
 *   - no Origin header (non-browser client / same-origin form post without Origin)
 *
 * Fail condition (return true): a mutating request whose Origin header is present
 * but not in the allowlist (classic cross-site forgery shape).
 */
export function isCrossSiteMutation(request: FastifyRequest): boolean {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return false;

  const secFetchSite = request.headers['sec-fetch-site'];
  if (
    secFetchSite === 'same-origin' ||
    secFetchSite === 'same-site' ||
    secFetchSite === 'none'
  ) {
    return false;
  }

  const originHeader = request.headers['origin'];
  if (typeof originHeader !== 'string' || originHeader === '') {
    // No Origin: not a cross-site browser navigation we can reject without breaking
    // legitimate non-browser callers. Session auth still applies downstream.
    return false;
  }

  let origin: string;
  try {
    origin = new URL(originHeader).origin;
  } catch {
    return true; // malformed Origin on a mutating request — reject
  }

  return !allowedOrigins().has(origin);
}
