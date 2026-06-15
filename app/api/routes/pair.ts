// app/api/routes/pair.ts
// Fastify routes for the device pairing flow.
//
// POST /api/pair/code    — authenticated (better-auth session), generates a one-time
//                          pairing code for the signed-in user.
// POST /api/pair/redeem  — unauthenticated, redeems a pairing code atomically and
//                          returns a one-time device token.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth.ts';
import { getPool } from '../db.ts';
import {
  generatePairingCode,
  formatPairingCode,
  normalisePairingCode,
  sha256,
  generateDeviceToken,
} from '../lib/crypto.ts';

// ---------------------------------------------------------------------------
// Session helper — validates a better-auth session from an incoming request.
// Returns the session+user or null if not authenticated.
// ---------------------------------------------------------------------------
async function getSession(request: FastifyRequest) {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  const headers = fromNodeHeaders(request.headers);
  const req = new Request(url.toString(), { method: request.method, headers });
  return auth.api.getSession({ headers: req.headers });
}

// ---------------------------------------------------------------------------
// requireAllowed — inline session + allowlist guard.
// All users with a valid better-auth session are considered allowed (invite-code
// gate is enforced at signup). Sends 401/403 and returns false on failure.
// ---------------------------------------------------------------------------
async function requireAllowed(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ userId: string } | false> {
  const session = await getSession(request).catch(() => null);
  if (!session?.user) {
    await reply.status(401).send({ error: 'unauthenticated' });
    return false;
  }
  // Verify the user still exists in the "user" table (extra safety; shouldn't
  // fail unless the row was deleted outside normal flows).
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM "user" WHERE id = $1',
    [session.user.id],
  );
  if (rows.length === 0) {
    await reply.status(403).send({ error: 'forbidden' });
    return false;
  }
  return { userId: session.user.id };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
export default async function pairRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // POST /api/pair/code
  // Generates a one-time pairing code for the signed-in, allowlisted user.
  // -------------------------------------------------------------------------
  app.route({
    method: 'POST',
    url: '/pair/code',
    async handler(request, reply) {
      const allowed = await requireAllowed(request, reply);
      if (allowed === false) return; // reply already sent

      const { userId } = allowed;

      // Rate-limit: ≤5 unredeemed, non-expired codes per user.
      const countResult = await getPool().query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt
         FROM pairing_codes
         WHERE user_id = $1
           AND redeemed_at IS NULL
           AND expires_at > now()`,
        [userId],
      );
      const cnt = countResult.rows[0]?.cnt ?? 0;
      if (cnt >= 5) {
        return reply.status(429).send({
          error: 'too_many_pending_codes',
          message:
            'You have 5 unredeemed pairing codes. Wait for them to expire or use one first.',
        });
      }

      // Generate code and persist only the hash.
      const raw = generatePairingCode();
      const hash = sha256(raw);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await getPool().query(
        `INSERT INTO pairing_codes (user_id, code_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [userId, hash, expiresAt],
      );

      return reply.status(200).send({
        code: formatPairingCode(raw),
        expiresAt: expiresAt.toISOString(),
      });
    },
  });

  // -------------------------------------------------------------------------
  // POST /api/pair/redeem
  // Unauthenticated — called by the daemon with only the short-lived code.
  // Atomically redeems the code and returns a one-time device token.
  // -------------------------------------------------------------------------
  app.route({
    method: 'POST',
    url: '/pair/redeem',
    // Strict per-IP throttle on the unauthenticated redeem endpoint to defeat
    // online guessing of the ~40-bit pairing code within its 10-min TTL.
    // keyGenerator defaults to request.ip. The 429 body is intentionally generic
    // so it cannot be used as an oracle for pairing-code validity.
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        errorResponseBuilder(_request, context) {
          // Must echo the rate-limit status (429, or 403 on ban) so Fastify
          // sends it; returning a bare object without statusCode falls through
          // to a 500. Body stays generic so it cannot be used as a code oracle.
          return { statusCode: context.statusCode, error: 'too_many_requests' };
        },
      },
    },
    async handler(request, reply) {
      const body = request.body as Record<string, unknown> | null | undefined;

      if (!body || typeof body['code'] !== 'string') {
        return reply.status(400).send({ error: 'missing_code' });
      }

      let normalised: string;
      try {
        normalised = normalisePairingCode(body['code']);
      } catch {
        return reply.status(400).send({ error: 'invalid_or_expired_code' });
      }

      const hash = sha256(normalised);

      const client = await getPool().connect();
      try {
        await client.query('BEGIN');

        // Atomic single-use redemption.
        const redeemResult = await client.query<{ id: string; user_id: string }>(
          `UPDATE pairing_codes
           SET redeemed_at = now()
           WHERE code_hash = $1
             AND redeemed_at IS NULL
             AND expires_at > now()
           RETURNING id, user_id`,
          [hash],
        );

        if ((redeemResult.rowCount ?? 0) === 0) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'invalid_or_expired_code' });
        }

        const pairingCodeId = redeemResult.rows[0]!.id;
        const userId = redeemResult.rows[0]!.user_id;

        // Generate a one-time device token; store only the hash.
        const token = generateDeviceToken();
        const tokenHash = sha256(token);

        const deviceResult = await client.query<{ id: string }>(
          `INSERT INTO devices (user_id, token_hash)
           VALUES ($1, $2)
           RETURNING id`,
          [userId, tokenHash],
        );

        const deviceId = deviceResult.rows[0]!.id;

        // Link the device back to the pairing code row.
        await client.query(
          `UPDATE pairing_codes SET device_id = $1 WHERE id = $2`,
          [deviceId, pairingCodeId],
        );

        await client.query('COMMIT');

        // Return the plaintext token exactly once; never log it.
        return reply.status(200).send({ token, deviceId });
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore rollback error
        }
        throw err;
      } finally {
        client.release();
      }
    },
  });
}
