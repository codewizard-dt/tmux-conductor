// app/api/relay/mux.ts
// Request multiplexer: forwards incoming HTTP requests over the daemon's relay WS.
//
// relayRequest() is registered as the HTTP handler for ALL /relay/:deviceId/* routes.
// It:
//  1. Looks up the device's WS in the registry — 503 if not connected.
//  2. Enforces a per-device in-flight cap (MAX_IN_FLIGHT = 64) — 503 if exceeded.
//  3. Generates a correlationId, sends a relay:request frame to the daemon.
//  4. Registers the correlation in the in-flight map with a 30s hard time-to-head timeout.
//  5. Streams relay:response:head / relay:body:chunk / relay:response:end back to the caller.
//  6. On relay:error → 502; on timeout → relay:cancel + 504; on WS close → 503.

import { randomUUID } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { RelayRequestFrame, RelayCancelFrame } from '../../../shared/relay-protocol.ts';
import {
  getDeviceWs,
  inFlightCount,
  registerInFlight,
  deregisterInFlight,
} from './registry.ts';

const MAX_IN_FLIGHT = 64;
// Hard time-to-first-byte (time-to-head) timeout: a single timer armed when the
// relay:request frame is sent. It fires if no response head arrives within this
// window and is NOT rearmed on chunks — once the head is received it is cleared,
// so a slow/streaming body (e.g. SSE) is not killed mid-stream.
const HEAD_TIMEOUT_MS = 30_000;

// Headers that must NEVER cross the relay boundary in either direction. Includes the
// standard hop-by-hop set plus a credential safelist: the browser's session cookie and
// any Authorization header must not be forwarded to the daemon/host-server, and no
// Set-Cookie/Authorization echoed back from the host-server must reach the browser.
const HOP_BY_HOP = new Set([
  'connection', 'upgrade', 'keep-alive', 'transfer-encoding',
  'te', 'trailer', 'proxy-authorization', 'proxy-authenticate', 'host',
  'cookie', 'authorization', 'set-cookie',
]);

export async function relayRequest(
  deviceId: string,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const wsOrUndefined = getDeviceWs(deviceId);
  if (wsOrUndefined === undefined) {
    req.log.info(
      { event: 'relay:request', deviceId, method: req.method, status: 503 },
      'relay request rejected: device not connected',
    );
    return reply.code(503).send({ error: 'device_not_connected' });
  }
  const ws = wsOrUndefined;

  if (inFlightCount(deviceId) >= MAX_IN_FLIGHT) {
    req.log.info(
      { event: 'relay:request', deviceId, method: req.method, status: 503 },
      'relay request rejected: too many in-flight',
    );
    return reply.code(503).send({ error: 'too_many_in_flight' });
  }

  const correlationId = randomUUID();
  const startedAt = Date.now();
  let completionLogged = false;

  // Structured per-relay-request completion log. Safe correlation fields ONLY —
  // no headers, no body, no token. `req.log` carries the Fastify reqId.
  const logCompletion = (status: number): void => {
    if (completionLogged) return;
    completionLogged = true;
    req.log.info(
      {
        event: 'relay:request',
        deviceId,
        correlationId,
        method: req.method,
        path: forwardPath,
        status,
        durationMs: Date.now() - startedAt,
      },
      'relay request completed',
    );
  };

  // Strip the /relay/:deviceId prefix — the daemon receives only the inner path.
  const rawUrl = req.url;
  const prefixPattern = `/relay/${deviceId}`;
  const prefixIdx = rawUrl.indexOf(prefixPattern);
  const forwardPath =
    prefixIdx !== -1 ? rawUrl.slice(prefixIdx + prefixPattern.length) || '/' : rawUrl;

  // Extract the request body to forward. GET/HEAD carry no body. For other methods,
  // Fastify will have parsed req.body according to the content-type:
  //   - Buffer  → octet-stream parser ran (binary upload); base64 it directly.
  //   - string  → text parser ran; encode the UTF-8 bytes.
  //   - object  → JSON parser ran; re-serialise then encode.
  // Anything else (undefined/null) means no body.
  let bodyB64: string | undefined;
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const body: unknown = req.body;
    let buf: Buffer | undefined;
    if (Buffer.isBuffer(body)) {
      buf = body;
    } else if (typeof body === 'string') {
      buf = Buffer.from(body, 'utf8');
    } else if (body !== undefined && body !== null) {
      buf = Buffer.from(JSON.stringify(body), 'utf8');
    }
    if (buf !== undefined && buf.length > 0) {
      bodyB64 = buf.toString('base64');
    }
  }

  // Build safe headers to forward.
  const forwardHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && typeof v === 'string') {
      forwardHeaders[k] = v;
    }
  }

  const frame: RelayRequestFrame = {
    type: 'relay:request',
    correlationId,
    method: req.method,
    path: forwardPath,
    headers: forwardHeaders,
    ...(bodyB64 !== undefined ? { body: bodyB64 } : {}),
  };

  return new Promise<void>((resolve) => {
    let settled = false;
    let headSent = false;
    let finalized = false; // onEnd/onError ran — no cancel on client disconnect.
    let headStatus = 0; // upstream status code once the head frame arrives.

    // --- Bounded write-queue + drain handling (portal → browser backpressure) ---
    // Incoming WS frames drive onChunk synchronously; we cannot block them. Instead we
    // buffer chunks and a writer drains them, pausing when reply.raw.write() returns
    // false and resuming on 'drain'. The daemon throttles its upstream read on
    // ws.bufferedAmount, which provides the real global backpressure; the portal must
    // only avoid unbounded in-memory buffering here.
    const writeQueue: Buffer[] = [];
    let writableBlocked = false;
    let drainAttached = false;

    function flushQueue(): void {
      while (writeQueue.length > 0) {
        const chunk = writeQueue.shift()!;
        const ok = reply.raw.write(chunk);
        if (!ok) {
          // Kernel/socket buffer full — wait for 'drain' before writing more.
          writableBlocked = true;
          if (!drainAttached) {
            drainAttached = true;
            reply.raw.once('drain', () => {
              drainAttached = false;
              writableBlocked = false;
              flushQueue();
            });
          }
          return;
        }
      }
    }

    // --- Hard time-to-head timeout: armed once, fires if no response head arrives
    // within HEAD_TIMEOUT_MS. Cleared (not rearmed) on the first head frame, so a
    // slow streaming body cannot be killed once it has started. ---
    function onTimeout(): void {
      if (settled) return;
      // Send relay:cancel so the daemon can abort the proxied request.
      const cancelFrame: RelayCancelFrame = { type: 'relay:cancel', correlationId };
      try {
        ws.send(JSON.stringify(cancelFrame));
      } catch {
        // ignore — WS may already be closed
      }
      finalized = true;
      settle();
      logCompletion(504);
      if (headSent) {
        // reply.hijack() was already called — reply.send() would throw; close the raw socket.
        reply.raw.end();
      } else {
        reply.code(504).send({ error: 'relay_timeout', correlationId });
      }
      resolve();
    }
    const timeout: ReturnType<typeof setTimeout> = setTimeout(onTimeout, HEAD_TIMEOUT_MS);

    function settle(): void {
      if (settled) return;
      settled = true;
      deregisterInFlight(deviceId, correlationId);
    }

    // --- Cancel on genuine client (browser) disconnect ---
    // Listen on the RESPONSE socket, not req.raw: req.raw 'close' fires as soon as the
    // request body finishes being read, which happens for every POST/PUT/PATCH with a
    // body — that is not a disconnect and must not trigger a cancel. The response
    // socket's 'close' fires once the response lifecycle ends. If it closes while the
    // response has NOT been fully flushed (writableFinished === false) and we have not
    // already finalized via onEnd/onError/onTimeout, the client gave up mid-flight
    // (aborted upload or mid-stream SSE) — abort the upstream by sending relay:cancel.
    reply.raw.on('close', () => {
      if (finalized || settled) return;
      if (reply.raw.writableFinished) return; // response completed normally
      finalized = true;
      clearTimeout(timeout);
      const cancelFrame: RelayCancelFrame = { type: 'relay:cancel', correlationId };
      try {
        ws.send(JSON.stringify(cancelFrame));
      } catch {
        // ignore — WS may already be closed
      }
      settle();
      // 499 (client closed request) — non-standard but conventional for aborts.
      logCompletion(499);
      resolve();
    });

    registerInFlight(deviceId, correlationId, {
      onHead(headFrame) {
        // Head arrived within the window — disarm the hard time-to-head timer. The
        // body may now stream for arbitrarily long without being cut off here.
        clearTimeout(timeout);
        // Hijack the reply so Fastify stops managing it; we write the status line and
        // headers directly to the raw socket, preserving the upstream status code and
        // content-type (and any other headers) without Fastify overwriting them on send().
        reply.hijack();
        const rawHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(headFrame.headers)) {
          if (!HOP_BY_HOP.has(k.toLowerCase())) {
            rawHeaders[k] = v;
          }
        }
        // For SSE responses, ensure proxies / the DO edge do not buffer the stream.
        const contentType = (rawHeaders['content-type'] ?? rawHeaders['Content-Type'] ?? '')
          .toLowerCase();
        if (contentType.includes('text/event-stream')) {
          const hasHeader = (name: string): boolean =>
            Object.keys(rawHeaders).some((h) => h.toLowerCase() === name);
          if (!hasHeader('cache-control')) rawHeaders['Cache-Control'] = 'no-cache';
          if (!hasHeader('x-accel-buffering')) rawHeaders['X-Accel-Buffering'] = 'no';
        }
        reply.raw.writeHead(headFrame.statusCode, rawHeaders);
        headSent = true;
        headStatus = headFrame.statusCode;
      },
      onChunk(chunkFrame) {
        const buf = Buffer.from(chunkFrame.data, 'base64');
        writeQueue.push(buf);
        if (!writableBlocked) {
          flushQueue();
        }
      },
      onEnd(_endFrame) {
        clearTimeout(timeout);
        finalized = true;
        settle();
        logCompletion(headStatus || 200);
        // Flush any queued chunks before ending. If the socket is still blocked,
        // end() will flush remaining buffered writes once it drains.
        flushQueue();
        reply.raw.end();
        resolve();
      },
      onError(err) {
        clearTimeout(timeout);
        finalized = true;
        settle();
        logCompletion(502);
        if (!headSent && !reply.sent) {
          // Head not yet sent — Fastify still owns the reply; send a 502 normally.
          reply.code(502).send({ error: err.error, code: err.code });
        } else {
          // reply.hijack() was already called (or reply was already sent another way);
          // cannot use reply.send() — just close the raw socket.
          reply.raw.end();
        }
        resolve();
      },
      timeout,
    });

    // Send the relay:request frame to the daemon.
    try {
      ws.send(JSON.stringify(frame));
    } catch (sendErr) {
      clearTimeout(timeout);
      finalized = true;
      settle();
      logCompletion(502);
      if (!reply.sent) {
        reply.code(502).send({ error: 'failed_to_send_relay_frame' });
      }
      resolve();
    }
  });
}
