// app/api/relay/registry.ts
// In-memory connection registry for the relay WS endpoint.
//
// Single-instance only — registry is in-memory; deploy/app.yaml instance_count:1.
// Phase 5 pub/sub required before horizontal scale.
//
// Stores one active WebSocket per device. A second connect for the same device
// closes the first and fails all its pending in-flight requests with a relay:error.

import type WebSocket from 'ws';
import type {
  RelayResponseHeadFrame,
  RelayBodyChunkFrame,
  RelayResponseEndFrame,
} from '../../../shared/relay-protocol.ts';

// ---------------------------------------------------------------------------
// In-flight request tracking
// ---------------------------------------------------------------------------

export interface InFlightEntry {
  /** Called when relay:response:head arrives for this correlation. */
  onHead: (frame: RelayResponseHeadFrame) => void;
  /** Called for each relay:body:chunk for this correlation. */
  onChunk: (frame: RelayBodyChunkFrame) => void;
  /** Called when relay:response:end arrives for this correlation. */
  onEnd: (frame: RelayResponseEndFrame) => void;
  /** Called on relay:error or WS close — rejects the pending request. */
  onError: (err: { error: string; code?: string }) => void;
  /** clearTimeout handle for the per-request 30-second deadline. */
  timeout: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Module-level registry state
// ---------------------------------------------------------------------------

/** One active WebSocket per deviceId. */
const connections = new Map<string, WebSocket>();

/** In-flight correlation map: deviceId → correlationId → InFlightEntry. */
const inFlight = new Map<string, Map<string, InFlightEntry>>();

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function ensureInFlight(deviceId: string): Map<string, InFlightEntry> {
  let m = inFlight.get(deviceId);
  if (m === undefined) {
    m = new Map();
    inFlight.set(deviceId, m);
  }
  return m;
}

function failAllInFlight(deviceId: string, reason: string): void {
  const m = inFlight.get(deviceId);
  if (m === undefined) return;
  for (const [, entry] of m) {
    clearTimeout(entry.timeout);
    entry.onError({ error: reason, code: 'WS_CLOSED' });
  }
  m.clear();
  inFlight.delete(deviceId);
}

// ---------------------------------------------------------------------------
// Connection registry API
// ---------------------------------------------------------------------------

/**
 * Register a new WebSocket for a device.
 * If a prior connection exists for this device it is closed after failing all
 * its pending in-flight requests with an error.
 */
export function register(deviceId: string, ws: WebSocket): void {
  const prior = connections.get(deviceId);
  if (prior !== undefined) {
    failAllInFlight(deviceId, 'Device reconnected — prior connection closed');
    try {
      prior.close(1001, 'Replaced by new connection');
    } catch {
      // ignore errors closing an already-closing socket
    }
  }
  connections.set(deviceId, ws);
  ensureInFlight(deviceId);
}

/**
 * Remove the device's registry entry and fail all pending in-flight requests.
 * Does NOT close the socket — the caller owns the socket lifecycle.
 */
export function deregister(deviceId: string): void {
  connections.delete(deviceId);
  failAllInFlight(deviceId, 'Device disconnected');
}

/**
 * Returns true if the device currently has an active relay WebSocket registered.
 */
export function isDeviceConnected(deviceId: string): boolean {
  return connections.has(deviceId);
}

/**
 * Close and remove the device's WebSocket, failing all pending in-flight requests.
 * Safe to call when no connection exists.
 */
export function closeRelayConnection(deviceId: string): void {
  const ws = connections.get(deviceId);
  if (ws !== undefined) {
    failAllInFlight(deviceId, 'Connection closed by server');
    try {
      ws.close(1000, 'Closed by server');
    } catch {
      // ignore
    }
  }
  connections.delete(deviceId);
  inFlight.delete(deviceId);
}

/**
 * Returns the live WebSocket for a device, or undefined if not connected.
 */
export function getDeviceWs(deviceId: string): WebSocket | undefined {
  return connections.get(deviceId);
}

// ---------------------------------------------------------------------------
// In-flight registration API
// ---------------------------------------------------------------------------

/** Register a correlation ID in the in-flight map for a device. */
export function registerInFlight(
  deviceId: string,
  correlationId: string,
  entry: InFlightEntry,
): void {
  ensureInFlight(deviceId).set(correlationId, entry);
}

/** Remove a correlation from the in-flight map (e.g. on completion or timeout). */
export function deregisterInFlight(deviceId: string, correlationId: string): void {
  inFlight.get(deviceId)?.delete(correlationId);
}

/** Return the in-flight entry for a correlation, or undefined if not found. */
export function getInFlightEntry(
  deviceId: string,
  correlationId: string,
): InFlightEntry | undefined {
  return inFlight.get(deviceId)?.get(correlationId);
}

/** Return the current number of in-flight requests for a device. */
export function inFlightCount(deviceId: string): number {
  return inFlight.get(deviceId)?.size ?? 0;
}
