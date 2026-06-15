// Outbound WSS relay connector for the tmux-conductor daemon (TASK-052 Step 3).
//
// Dials the portal's `GET /relay/:deviceId` WebSocket upgrade route with a Bearer
// device token, then proxies inbound relay:request frames to local targets
// (host-server over TCP, daemon over its unix socket) and streams responses back.
//
// Design notes:
//  - The portal does NOT send server-side ping/pong, so we send our own client
//    pings and rely on a silence watchdog (>75s without any inbound frame,
//    including pong) to detect a dead socket and force a reconnect.
//  - Reconnect uses exponential backoff (1s -> 60s) with jitter; the attempt
//    counter resets on a successful open.
//  - Backpressure: while ws.bufferedAmount exceeds a threshold we pause reading
//    the local response and resume once it drains.

import * as http from 'http';
import { WebSocket } from 'ws';
import { readCredentials } from './credentials.ts';
import { SOCKET_PATH } from './paths.ts';
import { isInboundRelayFrame } from '../shared/relay-protocol.ts';
import type {
  CorrelationId,
  InboundRelayFrame,
  OutboundRelayFrame,
  RelayRequestFrame,
} from '../shared/relay-protocol.ts';

const HOST_SERVER_BASE = 'http://127.0.0.1:8788';

// Backoff bounds.
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

// Keepalive / liveness.
const PING_INTERVAL_MS = 30_000;
const SILENCE_TIMEOUT_MS = 75_000;
const WATCHDOG_INTERVAL_MS = 15_000;

// Backpressure threshold for buffered (not-yet-flushed) WS bytes.
const BUFFER_HIGH_WATERMARK = 1 * 1024 * 1024; // 1 MiB
const BUFFER_POLL_MS = 25;

export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface RelayConnectorOptions {
  logger?: Logger;
}

type AllowlistTarget =
  | { kind: 'http'; baseUrl: string; forwardPath: string }
  | { kind: 'unix'; socketPath: string; forwardPath: string };

/**
 * Map an inbound request path to a local target, or null if forbidden.
 *  - `/api` and `/api/...` -> host-server :8788, path forwarded as-is.
 *  - `/daemon` and `/daemon/...` -> daemon unix socket, `/daemon` prefix stripped.
 *  - anything else -> forbidden.
 */
export function resolveTarget(path: string): AllowlistTarget | null {
  if (path === '/api' || path.startsWith('/api/')) {
    return { kind: 'http', baseUrl: HOST_SERVER_BASE, forwardPath: path };
  }
  if (path === '/daemon' || path.startsWith('/daemon/')) {
    const stripped = path.slice('/daemon'.length);
    const forwardPath = stripped.length === 0 ? '/' : stripped;
    return { kind: 'unix', socketPath: SOCKET_PATH, forwardPath };
  }
  return null;
}

export class RelayConnector {
  private readonly log: Logger;
  private ws: WebSocket | null = null;
  private stopped = false;

  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private lastInboundAt = 0;

  private readonly inflight = new Map<CorrelationId, AbortController>();

  constructor(opts: RelayConnectorOptions = {}) {
    this.log = opts.logger ?? console;
  }

  start(): void {
    if (this.stopped) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer('reconnectTimer');
    this.clearTimer('pingTimer');
    this.clearTimer('watchdogTimer');

    for (const [, controller] of this.inflight) {
      controller.abort();
    }
    this.inflight.clear();

    if (this.ws) {
      // Detach handlers so the close event does not schedule a reconnect.
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  private connect(): void {
    if (this.stopped) return;

    const creds = readCredentials();
    if (!creds) {
      this.log.warn('[relay] no device credentials found; will retry');
      this.scheduleReconnect();
      return;
    }

    const wsBase = creds.portalUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    const url = `${wsBase}/relay/${encodeURIComponent(creds.deviceId)}`;

    this.log.info(`[relay] connecting to portal as device ${creds.deviceId}`);

    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${creds.token}` },
    });
    this.ws = ws;
    this.lastInboundAt = Date.now();

    ws.on('open', () => {
      this.log.info('[relay] connected');
      this.attempt = 0;
      this.lastInboundAt = Date.now();
      this.startKeepalive();
    });

    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      this.lastInboundAt = Date.now();
      this.handleMessage(data, isBinary);
    });

    ws.on('pong', () => {
      this.lastInboundAt = Date.now();
    });

    ws.on('error', (err: Error) => {
      this.log.warn(`[relay] socket error: ${err.message}`);
      // 'close' will follow and drive the reconnect.
    });

    ws.on('close', (code: number) => {
      this.log.info(`[relay] disconnected (code ${code})`);
      this.onDisconnected();
    });
  }

  private onDisconnected(): void {
    this.clearTimer('pingTimer');
    this.clearTimer('watchdogTimer');
    this.ws = null;

    // Abort any in-flight requests tied to the dead socket.
    for (const [, controller] of this.inflight) {
      controller.abort();
    }
    this.inflight.clear();

    if (!this.stopped) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.attempt);
    // +/- 25% jitter.
    const jitter = exp * 0.25 * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.round(exp + jitter));
    this.attempt += 1;
    this.log.info(`[relay] reconnecting in ${delay}ms (attempt ${this.attempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startKeepalive(): void {
    this.clearTimer('pingTimer');
    this.clearTimer('watchdogTimer');

    this.pingTimer = setInterval(() => {
      const ws = this.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch {
          /* ignore */
        }
      }
    }, PING_INTERVAL_MS);

    this.watchdogTimer = setInterval(() => {
      if (Date.now() - this.lastInboundAt > SILENCE_TIMEOUT_MS) {
        this.log.warn('[relay] silence watchdog fired; terminating socket');
        const ws = this.ws;
        if (ws) {
          try {
            ws.terminate();
          } catch {
            /* ignore */
          }
        }
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  private clearTimer(name: 'reconnectTimer' | 'pingTimer' | 'watchdogTimer'): void {
    const t = this[name];
    if (t) {
      clearTimeout(t);
      clearInterval(t);
      this[name] = null;
    }
  }

  // ── Frame handling ────────────────────────────────────────────────────────

  private handleMessage(data: WebSocket.RawData, isBinary: boolean): void {
    if (isBinary) {
      this.log.warn('[relay] ignoring unexpected binary frame');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      this.log.warn('[relay] ignoring non-JSON frame');
      return;
    }
    if (!isInboundRelayFrame(parsed)) {
      this.log.warn('[relay] ignoring invalid inbound frame');
      return;
    }
    const frame: InboundRelayFrame = parsed;
    if (frame.type === 'relay:request') {
      void this.handleRequest(frame);
    } else {
      this.handleCancel(frame.correlationId);
    }
  }

  private handleCancel(correlationId: CorrelationId): void {
    const controller = this.inflight.get(correlationId);
    if (controller) {
      controller.abort();
      this.inflight.delete(correlationId);
    }
  }

  private async handleRequest(frame: RelayRequestFrame): Promise<void> {
    const { correlationId, method, path } = frame;

    const target = resolveTarget(path);
    if (!target) {
      this.log.warn(`[relay] forbidden path: ${method} ${path}`);
      this.send({
        type: 'relay:error',
        correlationId,
        error: `path not allowed: ${path}`,
        code: 'forbidden',
      });
      return;
    }

    const controller = new AbortController();
    this.inflight.set(correlationId, controller);

    const headers = sanitizeHeaders(frame.headers);
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const body = hasBody && frame.body !== undefined ? Buffer.from(frame.body, 'base64') : undefined;

    try {
      if (target.kind === 'http') {
        await this.proxyHttp(correlationId, target, method, headers, body, controller.signal);
      } else {
        await this.proxyUnix(correlationId, target, method, headers, body, controller.signal);
      }
    } catch (err) {
      this.handleProxyError(correlationId, controller.signal, err);
    } finally {
      this.inflight.delete(correlationId);
    }
  }

  // ── HTTP target (host-server) via global fetch ────────────────────────────

  private async proxyHttp(
    correlationId: CorrelationId,
    target: Extract<AllowlistTarget, { kind: 'http' }>,
    method: string,
    headers: Record<string, string>,
    body: Buffer | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const init: RequestInit = { method, headers, signal };
    if (body !== undefined) {
      // Copy into a fresh ArrayBuffer. A concrete ArrayBuffer satisfies every
      // BodyInit variant; Buffer/Uint8Array (and the ArrayBufferLike backing a
      // Buffer) do not match the active lib's narrowed BodyInit union.
      const ab = new ArrayBuffer(body.byteLength);
      new Uint8Array(ab).set(body);
      init.body = ab;
    }
    const res = await fetch(`${target.baseUrl}${target.forwardPath}`, init);

    this.send({
      type: 'relay:response:head',
      correlationId,
      statusCode: res.status,
      headers: collectFetchHeaders(res.headers),
    });

    if (!res.body) {
      this.send({ type: 'relay:response:end', correlationId });
      return;
    }

    const reader = res.body.getReader();
    try {
      for (;;) {
        if (signal.aborted) throw abortError();
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          await this.sendChunk(correlationId, Buffer.from(value), signal);
        }
      }
      this.send({ type: 'relay:response:end', correlationId });
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
  }

  // ── Unix socket target (daemon) via http.request ──────────────────────────

  private proxyUnix(
    correlationId: CorrelationId,
    target: Extract<AllowlistTarget, { kind: 'unix' }>,
    method: string,
    headers: Record<string, string>,
    body: Buffer | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          socketPath: target.socketPath,
          path: target.forwardPath,
          method,
          headers,
        },
        (res) => {
          this.send({
            type: 'relay:response:head',
            correlationId,
            statusCode: res.statusCode ?? 502,
            headers: collectNodeHeaders(res.headers),
          });

          const onAbort = (): void => {
            res.destroy();
          };
          if (signal.aborted) {
            res.destroy();
            reject(abortError());
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });

          const pump = async (): Promise<void> => {
            try {
              for await (const chunk of res) {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
                if (buf.length > 0) await this.sendChunk(correlationId, buf, signal);
              }
              this.send({ type: 'relay:response:end', correlationId });
              resolve();
            } catch (err) {
              reject(err);
            } finally {
              signal.removeEventListener('abort', onAbort);
            }
          };
          void pump();
        },
      );

      req.on('error', (err) => {
        if (signal.aborted) reject(abortError());
        else reject(err);
      });

      if (signal.aborted) {
        req.destroy();
        reject(abortError());
        return;
      }
      const onReqAbort = (): void => {
        req.destroy();
      };
      signal.addEventListener('abort', onReqAbort, { once: true });
      req.on('close', () => signal.removeEventListener('abort', onReqAbort));

      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  // ── Outbound send helpers ─────────────────────────────────────────────────

  private async sendChunk(
    correlationId: CorrelationId,
    chunk: Buffer,
    signal: AbortSignal,
  ): Promise<void> {
    await this.awaitDrain(signal);
    this.send({
      type: 'relay:body:chunk',
      correlationId,
      data: chunk.toString('base64'),
    });
  }

  /** Block while the WS send buffer is over the high-water mark (backpressure). */
  private async awaitDrain(signal: AbortSignal): Promise<void> {
    for (;;) {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount <= BUFFER_HIGH_WATERMARK) return;
      if (signal.aborted) throw abortError();
      await delay(BUFFER_POLL_MS);
    }
  }

  private handleProxyError(
    correlationId: CorrelationId,
    signal: AbortSignal,
    err: unknown,
  ): void {
    const e = err as { name?: string; code?: string; message?: string };

    // Abort triggered by a received relay:cancel — the portal initiated it.
    if (signal.aborted) {
      this.send({
        type: 'relay:error',
        correlationId,
        error: 'request aborted',
        code: 'aborted',
      });
      return;
    }

    if (e && (e.code === 'ECONNREFUSED' || e.code === 'ENOENT')) {
      this.send({
        type: 'relay:error',
        correlationId,
        error: e.message ?? 'target unreachable',
        code: 'unreachable',
      });
      return;
    }

    if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) {
      this.send({
        type: 'relay:error',
        correlationId,
        error: 'request timed out',
        code: 'timeout',
      });
      return;
    }

    this.send({
      type: 'relay:error',
      correlationId,
      error: e?.message ?? 'proxy error',
      code: 'unreachable',
    });
  }

  private send(frame: OutboundRelayFrame): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(frame));
    } catch (err) {
      this.log.warn(`[relay] send failed: ${(err as Error).message}`);
    }
  }
}

/** Construct and start a connector. Returns the instance for later .stop(). */
export function startConnector(opts: RelayConnectorOptions = {}): RelayConnector {
  const connector = new RelayConnector(opts);
  connector.start();
  return connector;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strip hop-by-hop / host-specific headers before re-issuing locally. */
function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === 'host' || lower === 'connection' || lower === 'content-length') continue;
    out[k] = v;
  }
  return out;
}

function collectFetchHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function collectNodeHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}
