// Wire protocol for the tmux-conductor outbound relay. Imported by both portal (TASK-035) and daemon connector (Phase 4). Do not change field names without updating both sides.

export type CorrelationId = string;

export type RelayRequestFrame = {
  type: 'relay:request';
  correlationId: CorrelationId;
  method: string;          // e.g. 'GET', 'POST'
  path: string;            // e.g. '/api/status' — portal strips /relay/:deviceId prefix
  headers: Record<string, string>;
  body?: string;           // base64-encoded request body, omitted for bodyless methods
};

export type RelayResponseHeadFrame = {
  type: 'relay:response:head';
  correlationId: CorrelationId;
  statusCode: number;
  headers: Record<string, string>;
};

export type RelayBodyChunkFrame = {
  type: 'relay:body:chunk';
  correlationId: CorrelationId;
  data: string;            // base64-encoded body chunk
};

export type RelayResponseEndFrame = {
  type: 'relay:response:end';
  correlationId: CorrelationId;
};

export type RelayCancelFrame = {
  type: 'relay:cancel';
  correlationId: CorrelationId;
};

export type RelayErrorFrame = {
  type: 'relay:error';
  correlationId: CorrelationId;
  error: string;           // human-readable error message
  code?: string;           // optional machine-readable code, e.g. 'ECONNREFUSED'
};

export type RelayFrame =
  | RelayRequestFrame
  | RelayResponseHeadFrame
  | RelayBodyChunkFrame
  | RelayResponseEndFrame
  | RelayCancelFrame
  | RelayErrorFrame;

export type InboundRelayFrame = RelayRequestFrame | RelayCancelFrame;
export type OutboundRelayFrame =
  | RelayResponseHeadFrame
  | RelayBodyChunkFrame
  | RelayResponseEndFrame
  | RelayErrorFrame;

const RELAY_TYPES = new Set<string>([
  'relay:request', 'relay:response:head', 'relay:body:chunk',
  'relay:response:end', 'relay:cancel', 'relay:error',
]);

export function isRelayFrame(x: unknown): x is RelayFrame {
  if (typeof x !== 'object' || x === null) return false;
  const rec = x as Record<string, unknown>;
  return (
    typeof rec['type'] === 'string' &&
    RELAY_TYPES.has(rec['type'] as string) &&
    typeof rec['correlationId'] === 'string'
  );
}

export function isInboundRelayFrame(x: unknown): x is InboundRelayFrame {
  return isRelayFrame(x) && (x.type === 'relay:request' || x.type === 'relay:cancel');
}
