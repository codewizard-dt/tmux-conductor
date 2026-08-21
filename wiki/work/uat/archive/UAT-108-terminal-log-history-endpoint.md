---
id: UAT-108
aliases: [UAT-108]
title: "UAT: GET /api/agents/:id/log endpoint — retrieve full persisted terminal-log history"
status: passed
task: TASK-108
created: 2026-07-06
updated: 2026-07-06
---

# UAT-108 — UAT: GET /api/agents/:id/log endpoint — retrieve full persisted terminal-log history

implements::[[TASK-108]]

> **Source task**: [[TASK-108]]
> **Generated**: 2026-07-06
> **Note**: TASK-107 (the `tailPollLoop` writer that calls `appendTerminalLogChunk`) has already landed, so some agents may already have live rows in `agent_terminal_log` by the time this is run. Agent ids below (`21`, `11`) were verified at generation time via `curl -sS http://127.0.0.1:8788/api/agents | jq '[.[] | {id, name}]'` — substitute if they've changed. Agent `21` had zero terminal-log rows at generation time (confirm via the sqlite3 command in UAT-API-001 before relying on it); agent `11` already had one live row from the poll loop.

---

## Prerequisites

- [x] Host-server running on `http://127.0.0.1:8788` (`make dev` or `npm --prefix host-server run dev`)
- [x] At least one agent with zero `agent_terminal_log` rows and one with at least one row. Verify via:
  ```bash
  sqlite3 ./data/conductor.db "SELECT agent_id, COUNT(*) FROM agent_terminal_log GROUP BY agent_id;"
  ```
  and cross-reference agent ids/names with `curl -sS http://127.0.0.1:8788/api/agents | jq '[.[] | {id, name}]'`. Substitute the ids used below if they no longer match this shape.
- [x] `sqlite3` and `jq` installed

---

## Test Cases

### UAT-API-001: GET returns empty array for an agent with zero persisted log rows
- **Endpoint**: `GET /api/agents/:id/log`
- **Description**: An agent with no rows in `agent_terminal_log` returns `{ agent, log: [] }`, not an error — confirms the route is a pure pass-through over `listTerminalLog` with no special-casing of the empty result.
- **Steps**:
  1. Confirm agent 21 has zero rows:
     ```bash
     sqlite3 ./data/conductor.db "SELECT COUNT(*) FROM agent_terminal_log WHERE agent_id=21;"
     ```
     If this returns anything other than `0`, pick a different agent id with zero rows (cross-reference via the Prerequisites query) and substitute it in the command below.
  2. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents/21/log'
  ```
- **Expected Result**: HTTP 200; body is exactly `{"agent":"steno-2","log":[]}` (agent name may differ if id 21 no longer maps to `steno-2` — the `log` array must be empty regardless)
- **Repeatable Unit Test**: Not applicable: Fastify route wiring is registered inline in `host-server/index.ts` with no injectable app export; `listTerminalLog`'s empty-result and chronological-order behavior is already covered by repeatable unit tests in `host-server/db.migration.test.ts` (added under TASK-106)
- [x] Pass <!-- 2026-07-06 -->

### UAT-API-002: GET returns rows in chronological order with the full AgentTerminalLog shape
- **Endpoint**: `GET /api/agents/:id/log`
- **Description**: After seeding two rows with distinct explicit `ts` values (oldest first), the endpoint returns both, ordered oldest-first, each with `{ id, agentId, ts, chunk }` — matching `listTerminalLog`'s `ORDER BY ts ASC, id ASC` with no re-sorting or transformation by the route.
- **Steps**:
  1. Seed two rows for agent 21 with explicit, out-of-insertion-order timestamps to prove the response is ts-ordered, not insertion-ordered:
     ```bash
     sqlite3 ./data/conductor.db "INSERT INTO agent_terminal_log (agent_id, ts, chunk) VALUES (21, '2026-07-01T00:00:00Z', 'uat-108 chunk B (earlier ts, inserted second)');"
     ```
  2. ```bash
     sqlite3 ./data/conductor.db "INSERT INTO agent_terminal_log (agent_id, ts, chunk) VALUES (21, '2026-07-02T00:00:00Z', 'uat-108 chunk A (later ts, inserted first)');"
     ```
  3. Run the command below and confirm the `chunk` field of the first array element is `"uat-108 chunk B (earlier ts, inserted second)"` and the second element's `chunk` is `"uat-108 chunk A (later ts, inserted first)"` — i.e. ordered by `ts` ascending, not by insertion order
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents/21/log' | jq '.log | map({ts, chunk})'
  ```
- **Expected Result**: HTTP 200; `jq` output is a 2-element array: `[{"ts":"2026-07-01T00:00:00Z","chunk":"uat-108 chunk B (earlier ts, inserted second)"},{"ts":"2026-07-02T00:00:00Z","chunk":"uat-108 chunk A (later ts, inserted first)"}]`. Also spot-check one full element via `curl -sS 'http://127.0.0.1:8788/api/agents/21/log' | jq '.log[0]'` and confirm it has exactly the keys `id`, `agentId` (numeric, `21`), `ts`, `chunk` — no extra or renamed fields.
- **Repeatable Unit Test**: Not applicable: route-level integration over the live server; `listTerminalLog`'s chronological-ordering guarantee is already covered by a repeatable unit test (`'appendTerminalLogChunk/listTerminalLog round-trip in chronological order without cross-agent contamination'`) in `host-server/db.migration.test.ts` (added under TASK-106)
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-001: Non-numeric agent id returns 400
- **Scenario**: The `:id` param does not parse as an integer (`parseInt` → `NaN`).
- **Steps**:
  1. Run the command below as-is
     ```bash
     curl -sS -i 'http://127.0.0.1:8788/api/agents/abc/log'
     ```
- **Expected Result**: HTTP 400 with body `{"error":"invalid agent id"}`
- **Repeatable Unit Test**: Not applicable: param parsing lives inline in the route handler; verified against the live server only
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-002: Unknown agent id returns 404
- **Scenario**: A syntactically valid numeric id has no matching row in the `agents` table.
- **Steps**:
  1. Run the command below as-is (`999999` must not be a real agent id)
     ```bash
     curl -sS -i 'http://127.0.0.1:8788/api/agents/999999/log'
     ```
- **Expected Result**: HTTP 404 with body `{"error":"agent 999999 not found"}`
- **Repeatable Unit Test**: Not applicable: Fastify route wiring is registered inline with no injectable app export; verified against the live server only
- [x] Pass <!-- 2026-07-06 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| `GET /agents/:id/log` returns `{ agent, log: AgentTerminalLog[] }` in chronological order (oldest-first), sourced from `listTerminalLog` | UAT-API-002 |
| Invalid (`NaN`) id → 400 `{ error: 'invalid agent id' }` | UAT-EDGE-001 |
| Unknown id → 404 `{ error: 'agent <id> not found' }` | UAT-EDGE-002 |
| Agent with no persisted log rows returns `{ agent, log: [] }`, not an error | UAT-API-001 |
| `host-server/index.ts` diff is a minimal Serena symbol-level insertion; no other route or poll loop touched | Verified during /tackle (code-review scope, not re-tested here) |
| `host-server/db.ts` untouched by this task | Verified during /tackle (code-review scope, not re-tested here) |
| `npx tsc --noEmit` passes in `host-server/` | Static gate — verified during /tackle (not re-tested here) |
