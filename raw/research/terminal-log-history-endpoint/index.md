---
topic: Confirm the exact insertion anchor and response-shape convention in host-server/index.ts for a new GET /agents/:id/log endpoint that returns the persisted terminal-log history via TASK-106's listTerminalLog(db, agentId) helper
slug: terminal-log-history-endpoint
researched: 2026-07-06
sources: [./sources.md]
---

# Research: GET /agents/:id/log insertion anchor and response shape

> The correct, minimal insertion point is directly after the `/agents/:id/usage` handler (currently `host-server/index.ts:1531-1539`) and before the `GET /agents` list-all route (`:1542`) — the new route should follow that handler's exact shape: `parseInt` → 400 on `NaN`, `getAgentById` → 404, then `return reply.send({ agent: entry.name, log: listTerminalLog(db, agentId) })`. TASK-106's `listTerminalLog`/`AgentTerminalLog`/`appendTerminalLogChunk` do not exist yet in `host-server/db.ts` — this task is blocked on TASK-106 landing, exactly as TASK-107 is.

## Research Questions
1. Exact current line range of the `/agents/:id/usage` handler in `host-server/index.ts`, and whether inserting the new `/agents/:id/log` route directly after it (before the `GET /agents` list-all route) is the correct minimal anchor.
2. Whether `listTerminalLog`/`AgentTerminalLog`/`appendTerminalLogChunk` exist yet in `host-server/db.ts` (TASK-106 dependency status).
3. The exact import line in `index.ts` listing named imports from `./db.ts`, so the task file can specify precisely where to append `listTerminalLog`.

## Current State (Codebase)

- **`/agents/:id/usage` handler** — `host-server/index.ts:1531-1539` (re-confirmed via `find_symbol`; had been 1530-1538 at TASK-106/107 authoring time and has already drifted by one line from concurrent edits, confirming the "re-read before editing" discipline is warranted):
  ```ts
  // Per-session usage breakdown (agent_usage rows) for the dashboard detail modal.
  api.get<{ Params: { id: string } }>('/agents/:id/usage', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    return reply.send({ agent: entry.name, sessions: listAgentUsage(db, agentId) });
  });

  // List all agents from the database.
  api.get('/agents', (_req, reply) => {
    return reply.send(listAgents(db));
  });
  ```
  Every agent-scoped `GET`/`POST`/`DELETE`/`PATCH` route in this file (`/agents/:id/skills`, `/agents/:id/tail`, `/agents/:id/diff`, `/agents/:id/base-branch`, `/agents/:id/usage`, `/agents/:id/focus`, `/agents/:id/window`, etc.) follows the identical validate-then-404 preamble: `parseInt(req.params.id, 10)` → `isNaN` → 400 `{ error: 'invalid agent id' }`; `getAgentById(db, agentId)` → falsy → 404 `` { error: `agent ${String(agentId)} not found` } ``. [S1]
- **`listTerminalLog`/`AgentTerminalLog`/`appendTerminalLogChunk` — zero matches** anywhere under `host-server/` (`search_for_pattern` across the whole directory). TASK-106 (`agent_terminal_log` table + DB helpers) is still `status: todo` in `wiki/work/tasks/TASK-106-agent-terminal-log-table.md` and has not been implemented in code yet. [S2]
- **`./db.ts` named-import line** — `host-server/index.ts:13`, single line, ends: `..., getAllAgentUsageTotals, listAgentUsage, type AgentUsageTotals } from './db.ts';`. The house convention (confirmed by every prior task touching this line, e.g. TASK-076 adding `listAgentUsage`) is to append the new name(s) to this existing list rather than adding a second import statement. `listTerminalLog` should be appended here once TASK-106 exports it. [S1]

## Key Findings

1. The insertion anchor is unambiguous and stable in relative position: immediately after the closing `});` of the `/agents/:id/usage` handler and immediately before the `// List all agents from the database.` comment that precedes `api.get('/agents', ...)`. Both neighboring routes are agent-scoped single-purpose reads, making this the natural grouping for a third "read persisted per-agent data" route. [S1]
2. The response-shape convention across sibling read endpoints is `{ agent: entry.name, <payloadKey>: <helperCall(db, agentId)> }` — `/agents/:id/skills` returns `{ agent, workdir, project, user }`, `/agents/:id/usage` returns `{ agent, sessions }`. The new endpoint should mirror this exactly: `{ agent: entry.name, log: listTerminalLog(db, agentId) }`, using `log` as the payload key (parallel to `sessions`) since the roadmap item and TASK-106 both call the concept "log"/"log history". [S1]
3. TASK-106 is an unmerged hard dependency — `listTerminalLog` cannot be imported or called until it exists. This mirrors TASK-107's identical blocking relationship on TASK-106 and confirms `depends_on: [TASK-106]` (not `TASK-107`) is the structurally correct — and minimal — dependency for the new endpoint task, since the endpoint only needs the read helper (from TASK-106), not the poll-loop writer (TASK-107). [S2]
4. `host-server/index.ts` continues to be a live hot file — the `/agents/:id/usage` handler's start line shifted from 1530 (recorded in TASK-106/107 at authoring time) to 1531 by the time this research ran, confirming other concurrent tasks are actively editing nearby code. Any implementer must re-run `find_symbol`/`search_for_pattern` immediately before editing rather than trusting these line numbers. [S1]

## Constraints

- Must not touch `host-server/db.ts` (TASK-106 owns it exclusively) or `tailPollLoop`/`config.ts` (TASK-107's territory) — this task's diff is confined to one new route block in `index.ts` plus one import-list edit.
- Must use Serena symbol-level edits (`find_symbol` on the neighboring `/agents/:id/usage` route callback, then `insert_after_symbol`) given `index.ts`'s declared hot-file status — never a whole-file rewrite.
- Hard-blocked until TASK-106 lands (`listTerminalLog` exported from `db.ts`) — verify via a fresh `search_for_pattern` for `listTerminalLog` before starting implementation, same "hard stop if not yet merged" gate TASK-107 uses.
- No pagination/filtering was requested or implied by the roadmap line — `listTerminalLog` returns the full per-agent chronological array as-is (TASK-106's designed contract); the endpoint is a thin pass-through, matching `/agents/:id/usage`'s equally unpaginated `sessions` array.

## Recommendation

Insert a new route directly after the `/agents/:id/usage` block (currently ending `host-server/index.ts:1539`) and before the `// List all agents from the database.` comment (`:1541`):

```ts
// Persisted terminal-log history (agent_terminal_log rows) — full chronological
// record for the dashboard's history view, backed by TASK-106's listTerminalLog.
api.get<{ Params: { id: string } }>('/agents/:id/log', (req, reply) => {
  const agentId = parseInt(req.params.id, 10);
  if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
  const entry = getAgentById(db, agentId);
  if (!entry) {
    return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
  }
  return reply.send({ agent: entry.name, log: listTerminalLog(db, agentId) });
});
```

Append `listTerminalLog` to the existing `./db.ts` import list at `index.ts:13`. Re-confirm both the exact current line numbers and that `listTerminalLog` is exported before editing, per the hot-file discipline already established for TASK-107.

## Next Steps

- `/task-add` — create TASK-108 scoped exactly to this endpoint, `depends_on: [TASK-106]` only (not TASK-107 — the endpoint doesn't need the poll-loop writer to exist to be buildable/testable, only rows to exist, which can be seeded directly via `appendTerminalLogChunk` in a smoke test).
