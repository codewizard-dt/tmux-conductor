// app/api/routes/devices.ts
// Fastify plugin for device management routes.
//
// GET    /api/devices        — list the signed-in user's devices (with connected flag)
// PATCH  /api/devices/:id   — rename a device
// DELETE /api/devices/:id   — revoke a device (marks revoked_at, closes live relay)
//
// All routes enforce ownership via `WHERE id = $1 AND user_id = $2`.
// A device that exists but belongs to a different user always returns 404
// (avoids leaking existence to other users).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth.ts';
import { getPool } from '../db.ts';
import {
  isDeviceConnected,
  closeRelayConnection,
  HEARTBEAT_THROTTLE_MS,
} from '../relay/registry.ts';

// A device counts as "connected" if it has a live relay WS in the registry, OR
// its last_seen_at heartbeat is within this recency window (2× the heartbeat
// throttle, so a freshly-written heartbeat never lapses between writes).
const CONNECTED_RECENCY_MS = HEARTBEAT_THROTTLE_MS * 2;

// ---------------------------------------------------------------------------
// Session helper — identical pattern to pair.ts
// ---------------------------------------------------------------------------
async function getSession(request: FastifyRequest) {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  const headers = fromNodeHeaders(request.headers);
  const req = new Request(url.toString(), { method: request.method, headers });
  return auth.api.getSession({ headers: req.headers });
}

// ---------------------------------------------------------------------------
// Auth guard — mirrors requireAllowed from pair.ts
// Returns { userId } or sends 401/403 and returns false.
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
// Row shape from the DB
// ---------------------------------------------------------------------------
interface DeviceRow {
  id: string;
  name: string | null;
  created_at: Date;
  last_seen_at: Date | null;
  revoked_at: Date | null;
}

function formatDevice(row: DeviceRow) {
  const recentLastSeen =
    row.last_seen_at !== null &&
    Date.now() - row.last_seen_at.getTime() < CONNECTED_RECENCY_MS;
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    connected: isDeviceConnected(row.id) || recentLastSeen,
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
export default async function devicesRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // GET /api/devices
  // Returns the signed-in user's devices.
  // Query param: ?include_revoked=1 to include revoked devices (default: no).
  // -------------------------------------------------------------------------
  app.route({
    method: 'GET',
    url: '/api/devices',
    async handler(request, reply) {
      const allowed = await requireAllowed(request, reply);
      if (allowed === false) return;

      const { userId } = allowed;
      const query = request.query as Record<string, string | undefined>;
      const includeRevoked = query['include_revoked'] === '1';

      const { rows } = await getPool().query<DeviceRow>(
        `SELECT id, name, created_at, last_seen_at, revoked_at
         FROM devices
         WHERE user_id = $1
           AND ($2 OR revoked_at IS NULL)
         ORDER BY created_at DESC`,
        [userId, includeRevoked],
      );

      return reply.status(200).send(rows.map(formatDevice));
    },
  });

  // -------------------------------------------------------------------------
  // PATCH /api/devices/:id
  // Renames a device. Returns the updated device object.
  // -------------------------------------------------------------------------
  app.route({
    method: 'PATCH',
    url: '/api/devices/:id',
    async handler(request, reply) {
      const allowed = await requireAllowed(request, reply);
      if (allowed === false) return;

      const { userId } = allowed;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown> | null | undefined;

      if (!body || typeof body['name'] !== 'string') {
        return reply.status(400).send({ error: 'missing_name' });
      }

      const name = (body['name'] as string).trim();
      if (name.length === 0 || name.length > 100) {
        return reply.status(400).send({
          error: 'invalid_name',
          message: 'name must be between 1 and 100 characters',
        });
      }

      const { rows, rowCount } = await getPool().query<DeviceRow>(
        `UPDATE devices
         SET name = $1
         WHERE id = $2 AND user_id = $3
         RETURNING id, name, created_at, last_seen_at, revoked_at`,
        [name, id, userId],
      );

      if ((rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: 'not_found' });
      }

      return reply.status(200).send(formatDevice(rows[0]!));
    },
  });

  // -------------------------------------------------------------------------
  // DELETE /api/devices/:id
  // Revokes a device: sets revoked_at = now(), closes live relay connection.
  // Returns 204 No Content. Returns 404 if already revoked, non-existent, or
  // owned by a different user.
  // -------------------------------------------------------------------------
  app.route({
    method: 'DELETE',
    url: '/api/devices/:id',
    async handler(request, reply) {
      const allowed = await requireAllowed(request, reply);
      if (allowed === false) return;

      const { userId } = allowed;
      const { id } = request.params as { id: string };

      const { rowCount } = await getPool().query<{ id: string }>(
        `UPDATE devices
         SET revoked_at = now()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
         RETURNING id`,
        [id, userId],
      );

      if ((rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: 'not_found' });
      }

      closeRelayConnection(id);
      return reply.status(204).send();
    },
  });
}
