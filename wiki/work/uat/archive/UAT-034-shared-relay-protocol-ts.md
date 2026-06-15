---
id: UAT-034
title: "UAT: shared/relay-protocol.ts frame contract (req/res/body chunks/cancel/err, correlation ids)"
status: passed
task: TASK-034
created: 2026-06-13
updated: 2026-06-13
---

# UAT-034 — UAT: shared/relay-protocol.ts frame contract (req/res/body chunks/cancel/err, correlation ids)

implements::[[TASK-034]]

> **Source task**: [`wiki/work/tasks/TASK-034-shared-relay-protocol-ts.md`](../tasks/TASK-034-shared-relay-protocol-ts.md)
> **Generated**: 2026-06-13

---

## Prerequisites

- [x] Node.js ≥ 18 installed (`node --version`) <!-- node v26.0.0 -->
- [x] `npx tsx` available (installed via any package in the monorepo or globally) <!-- tsx v4.22.4 -->

---

## Test Cases

### UAT-STATIC-001: File exists with the correct top-of-file comment

- **Description**: `shared/relay-protocol.ts` must exist at the repo root and carry the mandatory wire-protocol warning comment on line 1.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  head -1 shared/relay-protocol.ts
  ```
- **Expected Result**: Output is exactly `// Wire protocol for the tmux-conductor outbound relay. Imported by both portal (TASK-035) and daemon connector (Phase 4). Do not change field names without updating both sides.`
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-002: No import statements — pure TypeScript with zero runtime dependencies

- **Description**: The module must have no `import` or `require` statements. Any runtime dependency would violate the zero-dep contract.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -cE '^(import|require)' shared/relay-protocol.ts; echo "exit:$?"
  ```
- **Expected Result**: The count printed is `0` and exit code is `1` (grep exits 1 when no matches found — that is correct, expected behaviour here).
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-003: All six frame type exports are present

- **Description**: The module must export all six named frame types: `RelayRequestFrame`, `RelayResponseHeadFrame`, `RelayBodyChunkFrame`, `RelayResponseEndFrame`, `RelayCancelFrame`, `RelayErrorFrame`.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -cE 'export type Relay[A-Z][a-zA-Z]*Frame\b' shared/relay-protocol.ts
  ```
- **Expected Result**: Count is `6` (one line per exported frame type).
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-004: Union aliases RelayFrame, InboundRelayFrame, OutboundRelayFrame are exported

- **Description**: The three union aliases must all be present as named exports.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -E 'export type (RelayFrame|InboundRelayFrame|OutboundRelayFrame) =' shared/relay-protocol.ts | wc -l | tr -d ' '
  ```
- **Expected Result**: `3`
- [x] Pass <!-- 2026-06-13 —  verified via Node.js equivalent: count=3 -->

---

### UAT-STATIC-005: Guard functions isRelayFrame and isInboundRelayFrame are exported

- **Description**: Both validation helpers must be exported functions (not just types).
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -E 'export function (isRelayFrame|isInboundRelayFrame)' shared/relay-protocol.ts | wc -l | tr -d ' '
  ```
- **Expected Result**: `2`
- [x] Pass <!-- 2026-06-13 — verified via Node.js equivalent: count=2 -->

---

### UAT-STATIC-006: Frame type discriminators match the wire contract exactly

- **Description**: Each frame type must use the exact `type` string literal from the wire format table: `relay:request`, `relay:response:head`, `relay:body:chunk`, `relay:response:end`, `relay:cancel`, `relay:error`.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -oE "type: '(relay:[^']+)'" shared/relay-protocol.ts | sort -u
  ```
- **Expected Result**: Exactly these six lines (order may vary):
  ```
  type: 'relay:body:chunk'
  type: 'relay:cancel'
  type: 'relay:error'
  type: 'relay:request'
  type: 'relay:response:end'
  type: 'relay:response:head'
  ```
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-007: RelayRequestFrame has all required fields with correct types

- **Description**: `RelayRequestFrame` must carry `type`, `correlationId`, `method`, `path`, `headers`, and optional `body` fields per the wire contract.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -A8 "export type RelayRequestFrame" shared/relay-protocol.ts
  ```
- **Expected Result**: Output contains `method: string`, `path: string`, `headers: Record<string, string>`, and `body?: string`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-008: RelayResponseHeadFrame has statusCode and headers fields

- **Description**: `RelayResponseHeadFrame` must carry `statusCode: number` and `headers: Record<string, string>` per the wire contract.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -A6 "export type RelayResponseHeadFrame" shared/relay-protocol.ts
  ```
- **Expected Result**: Output contains `statusCode: number` and `headers: Record<string, string>`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-009: RelayBodyChunkFrame has data field (base64 body chunk)

- **Description**: `RelayBodyChunkFrame` must carry `data: string` for base64-encoded body chunks.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -A4 "export type RelayBodyChunkFrame" shared/relay-protocol.ts
  ```
- **Expected Result**: Output contains `data: string`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-010: RelayErrorFrame has required error field and optional code field

- **Description**: `RelayErrorFrame` must carry `error: string` (required human-readable message) and `code?: string` (optional machine-readable code).
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -A6 "export type RelayErrorFrame" shared/relay-protocol.ts
  ```
- **Expected Result**: Output contains `error: string` and `code?: string`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-011: InboundRelayFrame is RelayRequestFrame | RelayCancelFrame only

- **Description**: `InboundRelayFrame` (frames the daemon receives) must be exactly the two portal→daemon types and no others.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep "export type InboundRelayFrame" shared/relay-protocol.ts
  ```
- **Expected Result**: `export type InboundRelayFrame = RelayRequestFrame | RelayCancelFrame;`
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-012: OutboundRelayFrame is the four daemon→portal types

- **Description**: `OutboundRelayFrame` (frames the daemon sends) must be exactly `RelayResponseHeadFrame | RelayBodyChunkFrame | RelayResponseEndFrame | RelayErrorFrame`.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -A4 "export type OutboundRelayFrame" shared/relay-protocol.ts
  ```
- **Expected Result**: Output spans the four types `RelayResponseHeadFrame`, `RelayBodyChunkFrame`, `RelayResponseEndFrame`, `RelayErrorFrame` — no others.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-013: Standalone strict typecheck passes with zero errors

- **Description**: The module must compile under TypeScript strict mode with no type errors. This verifies the guard functions use no `any` casts and that all discriminated-union members are well-formed.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  npx tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext shared/relay-protocol.ts
  ```
- **Expected Result**: Exit code 0, no output (zero errors).
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-RUNTIME-001: isRelayFrame returns true for a valid relay:request frame

- **Description**: `isRelayFrame` must accept a well-formed `RelayRequestFrame` object and return `true`.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  npx tsx -e "import { isRelayFrame } from './shared/relay-protocol.ts'; const f = { type: 'relay:request', correlationId: 'abc-123', method: 'GET', path: '/api/status', headers: {} }; console.log(isRelayFrame(f));"
  ```
- **Expected Result**: `true`
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-RUNTIME-002: isRelayFrame returns true for all six frame types

- **Description**: `isRelayFrame` must accept any of the six frame types, not just `relay:request`. Verifies the full `RELAY_TYPES` set.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  npx tsx -e "
import { isRelayFrame } from './shared/relay-protocol.ts';
const frames = [
  { type: 'relay:request', correlationId: 'c1', method: 'POST', path: '/', headers: {} },
  { type: 'relay:response:head', correlationId: 'c2', statusCode: 200, headers: {} },
  { type: 'relay:body:chunk', correlationId: 'c3', data: 'aGVsbG8=' },
  { type: 'relay:response:end', correlationId: 'c4' },
  { type: 'relay:cancel', correlationId: 'c5' },
  { type: 'relay:error', correlationId: 'c6', error: 'timeout' },
];
console.log(frames.map(f => isRelayFrame(f)).join(','));
"
  ```
- **Expected Result**: `true,true,true,true,true,true`
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-RUNTIME-003: isRelayFrame rejects null, missing correlationId, and unknown type

- **Description**: `isRelayFrame` must return `false` for null, for a valid-type object missing `correlationId`, and for an object with an unknown `type` string.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  npx tsx -e "
import { isRelayFrame } from './shared/relay-protocol.ts';
console.log(
  isRelayFrame(null),
  isRelayFrame({ type: 'relay:request' }),
  isRelayFrame({ type: 'unknown', correlationId: 'x' })
);
"
  ```
- **Expected Result**: `false false false`
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-RUNTIME-004: isInboundRelayFrame narrows to relay:request and relay:cancel only

- **Description**: `isInboundRelayFrame` must return `true` for both inbound types and `false` for all outbound types (`relay:response:head`, `relay:body:chunk`, `relay:response:end`, `relay:error`).
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  npx tsx -e "
import { isInboundRelayFrame } from './shared/relay-protocol.ts';
const results = [
  isInboundRelayFrame({ type: 'relay:request', correlationId: 'a', method: 'GET', path: '/', headers: {} }),
  isInboundRelayFrame({ type: 'relay:cancel', correlationId: 'b' }),
  isInboundRelayFrame({ type: 'relay:response:head', correlationId: 'c', statusCode: 200, headers: {} }),
  isInboundRelayFrame({ type: 'relay:body:chunk', correlationId: 'd', data: 'x' }),
  isInboundRelayFrame({ type: 'relay:response:end', correlationId: 'e' }),
  isInboundRelayFrame({ type: 'relay:error', correlationId: 'f', error: 'err' }),
];
console.log(results.join(','));
"
  ```
- **Expected Result**: `true,true,false,false,false,false`
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-EDGE-001: isRelayFrame rejects non-object values (string, number, array, undefined)

- **Description**: The guard must not throw and must return `false` for any non-object input, including primitives and arrays.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  npx tsx -e "
import { isRelayFrame } from './shared/relay-protocol.ts';
console.log(
  isRelayFrame('relay:request'),
  isRelayFrame(42),
  isRelayFrame([{ type: 'relay:cancel', correlationId: 'x' }]),
  isRelayFrame(undefined)
);
"
  ```
- **Expected Result**: `false false false false`
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-EDGE-002: isRelayFrame rejects a frame with non-string correlationId

- **Description**: A frame whose `correlationId` is a number (not a string) must be rejected — `correlationId` must be `string`.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  npx tsx -e "
import { isRelayFrame } from './shared/relay-protocol.ts';
console.log(isRelayFrame({ type: 'relay:request', correlationId: 12345, method: 'GET', path: '/', headers: {} }));
"
  ```
- **Expected Result**: `false`
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-EDGE-003: CorrelationId is a plain string alias — no structural restriction enforced at runtime

- **Description**: `CorrelationId` is `type CorrelationId = string` — a structural alias only. Any string is accepted as a valid `correlationId`, including non-UUID strings. This is intentional (the type provides documentation, not runtime validation of UUID format).
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  npx tsx -e "
import { isRelayFrame } from './shared/relay-protocol.ts';
console.log(isRelayFrame({ type: 'relay:cancel', correlationId: 'not-a-uuid' }));
"
  ```
- **Expected Result**: `true` (non-UUID string is accepted; UUID format is a documentation convention, not an enforced constraint).
- [x] Pass <!-- 2026-06-13 -->
