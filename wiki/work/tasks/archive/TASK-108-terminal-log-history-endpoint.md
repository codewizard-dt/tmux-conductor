---
id: TASK-108
title: "GET /api/agents/:id/log endpoint — retrieve full persisted terminal-log history"
status: done
created: 2026-07-06
updated: 2026-07-06
depends_on: [TASK-106]
blocks: []
parallel_safe_with: [TASK-001, TASK-011, TASK-050, TASK-061, TASK-062, TASK-063, TASK-066, TASK-069, TASK-070, TASK-071, TASK-072, TASK-074, TASK-076, TASK-107]
uat: "[[UAT-108]]"
tags: [terminal, logging, session-recording, observability, roadmap-010, host-server, api]
---

# TASK-108 — GET /api/agents/:id/log endpoint — retrieve full persisted terminal-log history

## Objective

Add a `GET /agents/:id/log` route to `host-server/index.ts` that returns the full persisted terminal-output history for an agent via [TASK-106](TASK-106-agent-terminal-log-table.md)'s `listTerminalLog(db, agentId)` helper. This is Phase 2 item 3 of ROADMAP-010 (Session Recording) — the read-side API that the not-yet-created "History" toggle (item 4) will consume. **Scope is strictly the one GET route + its import wiring.** Do not build the `LogTail` "History" toggle UI or session-boundary-marker rendering (items 4 and 5) — those are separate, not-yet-created Phase 2 siblings that consume this endpoint's response.

## Approach

Research: `raw/research/terminal-log-history-endpoint/index.md` (confirms the exact insertion anchor and response-shape convention before implementation).

- **House pattern for agent-scoped GET routes.** Every `/agents/:id/*` route in `host-server/index.ts` (`/agents/:id/skills`, `/agents/:id/tail`, `/agents/:id/diff`, `/agents/:id/base-branch`, `/agents/:id/usage`) follows the same validate-then-404 preamble:
  ```ts
  const agentId = parseInt(req.params.id, 10);
  if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
  const entry = getAgentById(db, agentId);
  if (!entry) {
    return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
  }
  ```
  The new route must follow this exact preamble — no deviation (no alternate param name, no different 400/404 payload shape).
- **Response shape mirrors `/agents/:id/usage` exactly**, which is the closest existing precedent (a thin read-through over a `db.ts` list helper, one payload key alongside `agent`): `/agents/:id/usage` returns `{ agent: entry.name, sessions: listAgentUsage(db, agentId) }`. This task's route returns `{ agent: entry.name, log: listTerminalLog(db, agentId) }` — `log` as the payload key (parallel to `sessions`), full unpaginated chronological array, no filtering/pagination params. `listTerminalLog` already returns full chronological order (`ORDER BY ts ASC, id ASC` per TASK-106) — the route is a pure pass-through, no re-sorting or transformation.
- **Insertion anchor — immediately after `/agents/:id/usage`, before `GET /agents`.** At task-creation time this is `host-server/index.ts:1531-1539` (the `/agents/:id/usage` handler) followed by `// List all agents from the database.` / `api.get('/agents', ...)` at `:1541-1544` — confirmed via `find_symbol` and already drifted by one line from TASK-106/107's original recording, proving the file is still actively edited concurrently. **Re-read via `find_symbol` on the `/agents/:id/usage` route immediately before editing** — do not trust the line numbers above.
- **Import wiring — append `listTerminalLog` to the existing `./db.ts` import list at `index.ts:13`** (single line, currently ending `..., getAllAgentUsageTotals, listAgentUsage, type AgentUsageTotals } from './db.ts';`). Do not add a second import statement or touch any other import grouping.
- **Shared hot line with TASK-107 (CRITICAL — real collision risk, not just a general hot-file caution):** TASK-107 also edits this exact same import line (adding `appendTerminalLogChunk`). Whichever of TASK-107/TASK-108 lands second must re-read line 13 fresh and append only its own missing name — never blind-replace the whole line from memory, and never revert the other task's addition. If a diff/merge conflict is detected on this line, re-fetch the current file content and redo the single-name append rather than overwriting.
- **Hard dependency, not merely hot-file caution:** `listTerminalLog` does not exist in `host-server/db.ts` yet (confirmed via `search_for_pattern` returning zero matches for `listTerminalLog`/`AgentTerminalLog`/`appendTerminalLogChunk` across `host-server/` at research time) — TASK-106 is `status: todo` and unmerged. **Hard stop if not yet merged** — verify with a fresh `find_symbol`/`search_for_pattern` for `listTerminalLog` in `host-server/db.ts` before starting Step 2 below.
- **Does not depend on TASK-107.** This endpoint only needs rows to exist in `agent_terminal_log` (which can be seeded directly via TASK-106's `appendTerminalLogChunk` in a smoke test) — it has no functional dependency on the poll-loop writer that populates those rows during normal operation. Kept out of `depends_on` deliberately, consistent with how TASK-076 depends only on TASK-072+075 elsewhere in this roadmap rather than on every task that happens to write the table it reads.

## Steps

### 1. Confirm current state  <!-- agent: Explore -->

- [x] `mcp__serena__search_for_pattern` for `listTerminalLog` in `host-server/db.ts` — confirm TASK-106 has landed and note its exact exported signature (`(db, agentId) => AgentTerminalLog[]`). **Hard stop if not yet merged** — do not proceed until it exists. **Confirmed: exists at db.ts:925, signature matches.**
- [x] `mcp__serena__find_symbol` on the `/agents/:id/usage` route callback in `host-server/index.ts` with `include_body=true` — confirm it still matches the preamble/response shape recorded above and note its current line range (may have shifted further since this task was written). **Confirmed: now at index.ts:1548-1556, body matches expected shape exactly.**
- [x] Read `index.ts:13`'s current `./db.ts` import line verbatim — confirm whether TASK-107 has already appended `appendTerminalLogChunk` to it, so the edit below appends `listTerminalLog` without disturbing that addition (or any other concurrent addition). **Deviation noted: import line is actually at index.ts:12, not 13. `appendTerminalLogChunk` NOT yet present (TASK-107 hasn't landed its addition) — append `listTerminalLog` alone.**

<!-- Updated: 2026-07-06 -->

### 2. Add the `listTerminalLog` import  <!-- agent: general-purpose -->

- [x] In `host-server/index.ts`, append `listTerminalLog` to the existing named-import list from `./db.ts` (single line, ~line 13) — re-read the line immediately before editing per the shared-hot-line note above; do not touch any other import. **Done: added at index.ts:12, before `type AgentUsageTotals`. `appendTerminalLogChunk` (TASK-107) not yet present at edit time; append-only edit leaves room for it to land without conflict.**

<!-- Updated: 2026-07-06 -->

### 3. Add the `GET /agents/:id/log` route  <!-- agent: general-purpose -->

- [x] **Hot file — Serena symbol-level insertion only, re-read `/agents/:id/usage` immediately before editing.** Using `mcp__serena__insert_after_symbol` targeting the `/agents/:id/usage` route callback, add:
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
  **Done: inserted at index.ts:1558-1568 via content-anchored `replace_content` (route callback isn't a named symbol). `/agents/:id/usage` above (1547-1556) verified untouched.**
- [x] Confirm the new route sits before the `// List all agents from the database.` / `api.get('/agents', ...)` block and does not alter it. **Deviation: due to concurrent edits from other tasks, the actual immediate neighbor below is now `/agents/:id/checkpoints` (starting line 1570), not the `/agents` list-all block — confirmed intact and unmodified. The list-all route still exists later in the file; ordering intent (after usage, unmodified neighbors) is satisfied.**

<!-- Updated: 2026-07-06 -->

### 4. Typecheck  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` in `host-server/` — zero errors. **Done: first run hit a transient TS error in config.ts (`terminalLogMaxRowsPerAgent`/`ConductorConf` null-assignment) from a concurrent in-flight task's mid-edit snapshot — unrelated to TASK-108 (neither error touched index.ts or db.ts). Immediate re-run was clean, zero errors.**

<!-- Updated: 2026-07-06 -->

### 5. Smoke test  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Seed a few rows for a real agent id via `appendTerminalLogChunk` (a small `tsx` snippet in `./tmp/`, or wait for TASK-107 if already landed and let the live poll loop populate rows).
- [DEFERRED-TO-UAT] `curl -s localhost:8788/agents/<id>/log | jq` — returns `{ agent: "<name>", log: [ { id, agentId, ts, chunk }, ... ] }` in chronological (oldest-first) order matching insertion order.
- [DEFERRED-TO-UAT] `curl -s -w '%{http_code}' localhost:8788/agents/not-a-number/log` — 400 `{ error: 'invalid agent id' }`.
- [DEFERRED-TO-UAT] `curl -s -w '%{http_code}' localhost:8788/agents/999999/log` — 404 `` { error: 'agent 999999 not found' } ``.
- [DEFERRED-TO-UAT] Confirm an agent with zero terminal-log rows returns `{ agent: "<name>", log: [] }`, not an error.

Runtime/E2E verification deferred to the UAT phase per tackle's verification-scope convention (curl/server smoke tests are not run during static-gate execution).

<!-- Updated: 2026-07-06 -->

## Acceptance Criteria

- [ ] `GET /agents/:id/log` returns `{ agent: string, log: AgentTerminalLog[] }` in chronological order (oldest-first), sourced from TASK-106's `listTerminalLog`.
- [ ] Invalid (`NaN`) id → 400 `{ error: 'invalid agent id' }`; unknown id → 404 `` { error: `agent <id> not found` } `` — matching the exact preamble used by `/agents/:id/usage`, `/agents/:id/skills`, and other sibling routes.
- [ ] Agent with no persisted log rows returns `{ agent, log: [] }`, not an error.
- [ ] `host-server/index.ts` diff is a minimal Serena symbol-level insertion (one new route block, inserted after `/agents/:id/usage`) plus one import-list addition (`listTerminalLog`); no other route or the `tailPollLoop`/`tailPollLoopFocus` loops are touched.
- [ ] `host-server/db.ts` is untouched by this task (TASK-106 already owns it).
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

- **DEPENDS ON [TASK-106](TASK-106-agent-terminal-log-table.md)** — `agent_terminal_log` table, `listTerminalLog`, `AgentTerminalLog` type in `host-server/db.ts`. Do not start until it is merged (verify via Step 1's `search_for_pattern` check).
- **Does NOT depend on [TASK-107](TASK-107-terminal-log-poll-append.md).** This endpoint only reads via `listTerminalLog`; it does not need the poll-loop writer to exist to be buildable or testable (rows can be seeded directly through `appendTerminalLogChunk` in a smoke test). Kept minimal per house convention (cf. TASK-076 depending only on TASK-072+075, not every upstream writer).
- **Shared hot line with TASK-107:** both tasks append a name to the same `./db.ts` import line (`index.ts:13`) — whichever lands second must re-read the line fresh and append only its own missing name, never blind-overwrite.
- **Hot-file coordination (general):** `host-server/index.ts` is concurrently edited by TASK-012 (SSE tail stream), TASK-068 (pre-dispatch checkpoint fast-path), TASK-073/TASK-075 (usage-tracking poll-cycle wiring), and TASK-107 (terminal-log poll-cycle wiring) — none of which touch the `/agents/:id/usage`-adjacent route block this task inserts into, but re-read the insertion anchor via `find_symbol` immediately before editing per the Approach section, since line numbers will keep drifting as those tasks land.

**Downstream dependents (ROADMAP-010 Phase 2, not yet created as task files — their eventual `depends_on` will include this task):**

1. "History" toggle in the `LogTail` component to switch between live SSE and the persisted log (consumes this task's `GET /agents/:id/log` endpoint).
2. Display session boundary markers (timestamps) when rendering the historical log (consumes `ts` values from this task's endpoint response, which passes through `listTerminalLog`'s rows unmodified).

### Roadmap

Implements ROADMAP-010 Phase 2, item "Add `GET /api/agents/:agent/log` endpoint to retrieve the full persisted log history" — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`.
