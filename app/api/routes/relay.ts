// app/api/routes/relay.ts
// Fastify plugin that mounts:
//   GET  /relay/:deviceId        — WebSocket upgrade endpoint for the daemon
//   ALL  /relay/:deviceId/*      — HTTP catch-all that mux-forwards to the daemon
//
// Auth on WS upgrade: daemon sends "Authorization: Bearer <token>" in the handshake
// headers. We SHA-256 the raw token and look it up in the devices table.
// Rejection: socket.close(1008, 'Unauthorized').
//
// Inbound daemon frames (OutboundRelayFrame) are routed to the matching in-flight entry
// in the mux. On socket close, all pending in-flight requests are failed with 503.

import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import websocketPlugin, { type WebSocket } from '@fastify/websocket';
import type {
  RelayResponseHeadFrame,
  RelayBodyChunkFrame,
  RelayResponseEndFrame,
  RelayErrorFrame,
} from '../../../shared/relay-protocol.ts';
import { query } from '../db.ts';
import {
  register,
  deregister,
  getInFlightEntry,
  touchDeviceLastSeen,
} from '../relay/registry.ts';
import { relayRequest } from '../relay/mux.ts';
// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

interface DeviceRow {
  id: string;
  user_id: string;
}

async function validateDeviceToken(rawToken: string): Promise<DeviceRow | null> {
  const tokenHash = createHash('sha256').update(rawToken).digest();
  const result = await query<DeviceRow>(
    `SELECT id, user_id FROM devices WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Outbound frame type guard (daemon → portal direction)
// ---------------------------------------------------------------------------

type OutboundFrame =
  | RelayResponseHeadFrame
  | RelayBodyChunkFrame
  | RelayResponseEndFrame
  | RelayErrorFrame;

function isOutboundFrame(x: unknown): x is OutboundFrame {
  if (typeof x !== 'object' || x === null) return false;
  const t = (x as Record<string, unknown>)['type'];
  return (
    t === 'relay:response:head' ||
    t === 'relay:body:chunk' ||
    t === 'relay:response:end' ||
    t === 'relay:error'
  );
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default async function relayRoutes(app: FastifyInstance): Promise<void> {
  // Register the @fastify/websocket plugin scoped to this sub-instance.
  await app.register(websocketPlugin);

  // -------------------------------------------------------------------------
  // GET /relay/:deviceId — WebSocket upgrade; daemon connects here after pairing.
  // -------------------------------------------------------------------------
  app.get<{ Params: { deviceId: string } }>(
    '/relay/:deviceId',
    { websocket: true },
    async (connection: WebSocket, request) => {
      const { deviceId } = request.params;
      const ws = connection;

      // --- Auth: validate Bearer token from the upgrade request headers ---
      const authHeader = request.headers['authorization'] ?? '';
      const match = /^Bearer\s+(\S+)$/.exec(authHeader);
      if (!match) {
        ws.close(1008, 'Unauthorized');
        return;
      }
      const rawToken = match[1]!;

      let device: DeviceRow | null;
      try {
        device = await validateDeviceToken(rawToken);
      } catch (err) {
        app.log.error({ err }, 'relay: DB error validating device token');
        ws.close(1011, 'Internal error');
        return;
      }

      if (device === null) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      // Confirm the :deviceId in the URL matches the token's device row.
      if (device.id !== deviceId) {
        ws.close(1008, 'Forbidden');
        return;
      }

      app.log.info({ deviceId, event: 'relay:connect' }, 'relay: daemon connected');
      app.log.info({ deviceId, event: 'relay:connect' }, 'relay: daemon connected');
      // registry stores WebSocket directly (not SocketStream).
      register(deviceId, ws);
      // Force a last_seen_at write on connect (first activity), bypassing throttle.
      touchDeviceLastSeen(deviceId, app.log, true);

      // --- Route inbound frames from daemon to in-flight mux entries ---
      ws.on('message', (data: Buffer) => {
        // Keep the connection fresh on ongoing traffic (throttled, best-effort).
        touchDeviceLastSeen(deviceId, app.log);
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString('utf8'));
        } catch {
          app.log.warn({ deviceId }, 'relay: received non-JSON frame — ignored');
          return;
        }

        if (!isOutboundFrame(parsed)) {
          // Do NOT log `parsed` — an outbound frame can carry base64 body/headers.
          // Log only the safe shape descriptor so the line stays leak-free.
          const frameType =
            typeof parsed === 'object' && parsed !== null && 'type' in parsed
              ? String((parsed as { type: unknown }).type)
              : 'unknown';
          app.log.warn(
            { deviceId, frameType, event: 'relay:bad-frame' },
            'relay: unrecognised outbound frame — ignored',
          );
          return;
        }

        const frame = parsed;
        const correlationId = frame.correlationId;
        const entry = getInFlightEntry(deviceId, correlationId);

        if (entry === undefined) {
          // Could be a late frame after timeout — silently discard.
          app.log.debug(
            { deviceId, correlationId, type: frame.type },
            'relay: no in-flight entry for frame',
          );
          return;
        }

        switch (frame.type) {
          case 'relay:response:head':
            entry.onHead(frame);
            break;
          case 'relay:body:chunk':
            entry.onChunk(frame);
            break;
          case 'relay:response:end':
            entry.onEnd(frame);
            break;
          case 'relay:error':
            entry.onError(frame as RelayErrorFrame);
            break;
        }
      });

      // --- On close: deregister and fail all pending in-flight ---
      ws.on('close', (closeCode: number) => {
        app.log.info(
          { deviceId, event: 'relay:disconnect', closeCode },
          'relay: daemon disconnected',
        );
        // Record the last-seen moment as the disconnect time (force, best-effort).
        touchDeviceLastSeen(deviceId, app.log, true);
        // deregister() calls failAllInFlight() internally — all in-flight get 503.
        deregister(deviceId);
      });

      ws.on('error', (err: Error) => {
        app.log.error({ err, deviceId }, 'relay: WebSocket error');
        deregister(deviceId);
      });
    },
  );

  // -------------------------------------------------------------------------
  // ALL /relay/:deviceId/* — HTTP catch-all forwarded to the daemon via mux.
  // -------------------------------------------------------------------------
  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    url: '/relay/:deviceId/*',
    async handler(request, reply) {
      const params = request.params as { deviceId: string; '*': string };
      return relayRequest(params['deviceId'], request, reply);
    },
  });
}
