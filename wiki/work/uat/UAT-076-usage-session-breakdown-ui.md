---
id: UAT-076
aliases: [UAT-076]
title: "UAT: Per-session usage breakdown — GET /agents/:id/usage endpoint + session table in AgentDetailModal"
status: pending
task: TASK-076
created: 2026-08-15
updated: 2026-08-21
---

# UAT-076 — UAT: Per-session usage breakdown — GET /agents/:id/usage endpoint + session table in `AgentDetailModal`

implements::[[TASK-076]]

> **Source task**: [[TASK-076]]
> **Generated**: 2026-08-15
> **Route note**: all routes are registered under the `/api` prefix (`host-server/index.ts:2087`), so the live route under test is `GET /api/agents/:id/usage` (`host-server/index.ts:1560`), not the bare `/agents/:id/usage` shown in the task file's own code excerpt.
> **Split note**: the endpoint half is fully machine-verifiable via live curl against the running host-server (`getAgentById`/`listAgentUsage` are deterministic and the route has no auth gate) — UAT-API-001..004 all execute live commands. The pure client-side formatting/sorting logic (`formatSessionStart`, the `updatedAt`-DESC comparator) is pinned browser-free via a Node reference script in UAT-EDGE-001, same technique as UAT-074. Only the actual DOM rendering (`UsageBreakdown` in `frontend/src/components/AgentList.tsx:303-374`) fails closed to human verification — no frontend test harness exists in this repo (no vitest/jsdom, confirmed empty `frontend/src/**/*.test.ts*`), same precedent as UAT-062/074.

---

## Prerequisites

- [ ] Host-server running on `http://localhost:8788` (`make dev` or `npm start` in `host-server/`).
- [ ] The conductor tmux session is running under the name configured in `conductor.conf` (`SESSION_NAME`, default `conductor`) — `POST /api/agents` returns `409 { "error": "session not running" }` otherwise. A bare `tmux new-session -d -s conductor` is sufficient.
- [ ] `jq` and `sqlite3` installed (`sqlite3` seeds `agent_usage` rows directly — no accumulator/live Claude session is needed to exercise this endpoint).
- [ ] `DB_PATH` resolves to `./data/conductor.db` (the `conductor.conf` default, relative to the repo root) — confirm before using the `sqlite3 ./data/conductor.db ...` commands below, or substitute the configured path.
- [ ] Frontend dev server running on `http://localhost:4321` (`make dev`) — required for the UAT-UI-*/UAT-EDGE-001 cases only.
- [ ] Cleanup after every API test: `curl -sS -X DELETE "http://localhost:8788/api/agents/$ID"` for every throwaway agent created — this cascades its `agent_usage` rows (proven by the existing `usage totals aggregate across sessions and cascade on agent delete` test in `host-server/db.migration.test.ts`), so no separate `agent_usage` cleanup is needed.

---

## Test Cases

### UAT-API-001: GET /agents/:id/usage returns sessions ordered newest-first with the full camelCase shape
- **Endpoint**: `GET /api/agents/:id/usage`
- **Description**: For an agent with `agent_usage` rows, the route returns `{ agent: entry.name, sessions: listAgentUsage(db, agentId) }` untransformed. `listAgentUsage` queries `ORDER BY session_start DESC`, so the response must list the newest session first, and every session object must carry the full 9-key camelCase shape with no snake_case leakage.
- **Steps**:
  1. Create a disposable agent (no git workdir needed — this endpoint has no worktree dependency):
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat076happy","workdir":"/tmp/uat076-nonexistent-nogit-dir","launchCmd":"sleep 300"}'
     ```
  2. From the response, note `agent.id` as `$UID`.
  3. Seed two usage rows directly (substitute `$UID`):
     ```bash
     sqlite3 ./data/conductor.db "INSERT INTO agent_usage (agent_id, session_start, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cost_usd) VALUES ($UID, '2026-07-06T09:00:00Z', 1200, 3400, 500, 250000, 0.42), ($UID, '2026-07-06T10:00:00Z', 800, 1600, 100, 90000, 0.11)"
     ```
  4. Run the command below (substitute `$UID`).
  5. Cleanup: `curl -sS -X DELETE "http://localhost:8788/api/agents/$UID"`.
- **Command**:
  ```bash
  curl -sS "http://localhost:8788/api/agents/$UID/usage" | jq '.agent=="uat076happy" and (.sessions|length==2) and .sessions[0].sessionStart=="2026-07-06T10:00:00Z" and .sessions[1].sessionStart=="2026-07-06T09:00:00Z" and ((.sessions[0]|keys|sort)==["agentId","cacheCreationInputTokens","cacheReadInputTokens","costUsd","id","inputTokens","outputTokens","sessionStart","updatedAt"])'
  ```
- **Expected Result**: Prints `true` — `agent` matches the created agent's name, `sessions` has 2 entries, the `10:00:00Z` session (later `session_start`) is first, the `09:00:00Z` session is second, and every session object exposes exactly the 9 camelCase keys the `AgentUsage` interface declares (no `session_start`/`cache_read_input_tokens`/etc. leakage).
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (test `TASK-076: listAgentUsage returns [] for a usage-less agent and full camelCase rows ordered by session_start DESC` — pins the same DESC-ordering and camelCase-shape guarantee at the DB layer this route composes untransformed).
- **Unit Test Command**: `node --import tsx/esm --test db.migration.test.ts` (run from `host-server/`)
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-002: GET /agents/:id/usage returns an empty sessions array for an agent with no usage rows
- **Endpoint**: `GET /api/agents/:id/usage`
- **Description**: A freshly created agent has no `agent_usage` rows. The route must return `200 { agent, sessions: [] }`, never an error, matching the task's stated contract ("For an existing agent the endpoint returns `sessions: []`, never an error").
- **Steps**:
  1. Create a disposable agent with no usage seeded:
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat076zero","workdir":"/tmp/uat076-nonexistent-nogit-dir2","launchCmd":"sleep 300"}'
     ```
  2. From the response, note `agent.id` as `$ZID`.
  3. Run the command below (substitute `$ZID`) immediately — no usage rows are seeded for this agent.
  4. Cleanup: `curl -sS -X DELETE "http://localhost:8788/api/agents/$ZID"`.
- **Command**:
  ```bash
  curl -sS "http://localhost:8788/api/agents/$ZID/usage" | jq '.agent=="uat076zero" and .sessions==[]'
  ```
- **Expected Result**: Prints `true` — `sessions` is an empty array, not `null`/absent, and the call is `200` (no error body).
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (same `TASK-076` test as UAT-API-001 — its first assertion is `listAgentUsage(db, agent.id)` deep-equals `[]` for a freshly created agent before any usage rows exist).
- **Unit Test Command**: `node --import tsx/esm --test db.migration.test.ts` (run from `host-server/`)
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-003: GET /agents/:id/usage returns 404 for an unknown agent id
- **Endpoint**: `GET /api/agents/:id/usage`
- **Description**: `getAgentById` returns `undefined` for an id with no matching row; the route must respond `404 { error: "agent <id> not found" }` before ever calling `listAgentUsage`.
- **Steps**:
  1. Run the command below as-is (`999999` is not expected to be a live agent id).
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' 'http://localhost:8788/api/agents/999999/usage'
  ```
- **Expected Result**: Prints `404`. (Body, if inspected without `-o /dev/null`, is `{"error":"agent 999999 not found"}`.)
- **Repeatable Unit Test**: Not applicable: the 404 branch is a two-line Fastify route guard (`if (!entry) return reply.status(404)...`) with no independent logic to isolate from the HTTP layer — verified live only, same precedent as the adjacent `/agents/:id/skills` route's 404 case (UAT-001).
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-004: GET /agents/:id/usage returns 400 for a non-numeric agent id
- **Endpoint**: `GET /api/agents/:id/usage`
- **Description**: `parseInt(req.params.id, 10)` on a non-numeric segment yields `NaN`; the route must respond `400 { error: "invalid agent id" }` before touching the DB.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' 'http://localhost:8788/api/agents/abc/usage'
  ```
- **Expected Result**: Prints `400`. (Body, if inspected without `-o /dev/null`, is `{"error":"invalid agent id"}`.)
- **Repeatable Unit Test**: Not applicable: single-line `isNaN` guard with no independent logic to isolate from the HTTP layer — verified live only.
- [x] Pass <!-- 2026-08-15 -->

### UAT-UI-001: Usage section renders one row per session (newest first) with a totals footer, and hides while the log is expanded
- **Page**: `http://localhost:4321/`
- **Description**: `AgentDetailModal` renders `UsageBreakdown` for any agent, which lazy-fetches `GET /api/agents/:id/usage` on mount and, once `sessions.length > 0`, shows a `<details>` block titled `Usage (N sessions)` with a table (columns: Session · In · Out · Cache W · Cache R · Total · Cost) sorted by `updatedAt` DESC, plus a bold `Total` footer row. The section is hidden whenever the modal's log view is expanded (`{!logExpanded && <UsageBreakdown .../>}`).
- **Auth-Required**: false
- **Steps**:
  1. Create a fixture agent and seed two usage rows exactly as in UAT-API-001 Steps 1–3, using a distinct name (e.g. `uat076uihappy`) so it doesn't collide with a concurrently running API test.
  2. Open the dashboard at `http://localhost:4321/`.
  3. Click the `uat076uihappy` agent's card to open its detail modal.
  4. Below the Skills section, locate the `Usage (2 sessions)` collapsible summary and click it to expand.
  5. Observe the table: 2 rows, the row for the `10:00:00Z` session listed above the row for the `09:00:00Z` session (both were `upsertAgentUsage`d — hence `updatedAt` — in that same relative order in UAT-API-001's seed, so DESC-by-`updatedAt` should also show `10:00:00Z` first here); each row shows a formatted start time, In/Out/Cache W/Cache R token counts (compact `Nk` form), a Total column, and a Cost column (`$0.42`/`$0.11`).
  6. Observe a `Total` footer row below the sessions, bold, summing each numeric column across both rows.
  7. In the modal's terminal log panel, use its expand/collapse control to expand the log view.
  8. Confirm the Usage section (and the Details/Skills area above it) is no longer visible while the log is expanded.
  9. Collapse the log view again and confirm the Usage section reappears, still showing the same 2 rows.
  10. Cleanup: close the modal, then `curl -sS -X DELETE "http://localhost:8788/api/agents/$UID"` for this fixture's id.
- **Expected Result**: The `Usage (2 sessions)` section expands to a 7-column table with exactly 2 rows in the order described, a bold totals footer row, and disappears entirely (not just collapses) while `logExpanded` is true, reappearing unchanged once the log is collapsed again. No console errors.
- **Repeatable Unit Test**: Not applicable: verifies browser rendering, DOM ordering, and conditional-visibility of a React component; the frontend has no component test harness (no vitest/jsdom present in this repo).
- [FAIL: auto-judge: prerequisite not satisfied — host-server on :8788 and frontend dev server on :4321 both unreachable] <!-- 2026-08-21 -->

### UAT-UI-002: No Usage section renders for an agent with zero usage rows
- **Page**: `http://localhost:4321/`
- **Description**: `UsageBreakdown` returns `null` when `sessions.length === 0` — no empty table, no placeholder text, no `<details>` element at all.
- **Auth-Required**: false
- **Steps**:
  1. Create a fixture agent with no usage seeded, as in UAT-API-002 Step 1, using a distinct name (e.g. `uat076uizero`).
  2. Open the dashboard at `http://localhost:4321/`.
  3. Click the `uat076uizero` agent's card to open its detail modal.
  4. Inspect the area below the Skills section (and above the Checkpoints section, if present) for any "Usage" heading or table.
  5. Cleanup: close the modal, then `curl -sS -X DELETE "http://localhost:8788/api/agents/$ZID"` for this fixture's id.
- **Expected Result**: No "Usage" text, `<details>` element, or table appears anywhere in the modal for this agent. The rest of the modal (name, status, Skills section if applicable, log panel) renders normally.
- **Repeatable Unit Test**: Not applicable: verifies absence of a rendered DOM element in the browser; no frontend component test harness exists.
- [FAIL: auto-judge: prerequisite not satisfied — host-server on :8788 and frontend dev server on :4321 both unreachable] <!-- 2026-08-21 -->

### UAT-EDGE-001: `formatSessionStart` truncation branch and the updatedAt-DESC sort comparator
- **Scenario**: TASK-075's accumulator keys a session by the first assistant record's ISO timestamp, falling back to the raw `sessionId` UUID when unavailable. `formatSessionStart` (`frontend/src/components/AgentList.tsx:217-223`) does `new Date(s)`; when `Number.isNaN(d.getTime())` it must return `` `${s.slice(0, 8)}…` `` instead of a parsed date string. Separately, `UsageBreakdown`'s row ordering (`AgentList.tsx:317-318`) sorts by `updatedAt` DESC — explicitly *not* `sessionStart` — because a UUID fallback key sorts lexicographically ahead of any ISO date string, which would silently misorder rows if the code sorted on `sessionStart` instead. Both are pure, deterministic functions (no DOM, no fetch); the source is reproduced verbatim below.
- **Steps**:
  1. Write the reference script (byte-for-byte copy of `formatSessionStart` from `AgentList.tsx:217-223` and the sort comparator from `AgentList.tsx:317-318`, plus a UUID-vs-ISO matrix):
     ```bash
     mkdir -p /Users/davidtaylor/Repositories/tmux-conductor/tmp
     cat > /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat076-formatters.mjs <<'EOF'
     function formatSessionStart(s) {
       const d = new Date(s)
       if (!Number.isNaN(d.getTime())) {
         return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
       }
       return `${s.slice(0, 8)}…`
     }
     let ok = true
     const uuid = 'a1b2c3d4-5678-90ab-cdef-1234567890ab'
     const truncated = formatSessionStart(uuid)
     if (truncated !== 'a1b2c3d4…') { ok = false; console.log('MISMATCH truncation', JSON.stringify(truncated), '!== "a1b2c3d4…"') }
     const dated = formatSessionStart('2026-07-06T10:00:00Z')
     if (dated.endsWith('…')) { ok = false; console.log('MISMATCH date-branch', JSON.stringify(dated), 'should not end with the UUID-fallback ellipsis') }
     const sessions = [
       { sessionStart: uuid, updatedAt: '2026-08-15T17:20:00Z' },
       { sessionStart: '2026-07-06T09:00:00Z', updatedAt: '2026-08-15T17:25:00Z' },
     ]
     const sorted = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
     if (sorted[0].updatedAt !== '2026-08-15T17:25:00Z' || sorted[1].updatedAt !== '2026-08-15T17:20:00Z') {
       ok = false; console.log('MISMATCH sort order', JSON.stringify(sorted))
     }
     console.log(ok ? 'ALL PASS' : 'FAIL')
     EOF
     ```
  2. Run the command below as-is.
- **Command**:
  ```bash
  node /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat076-formatters.mjs
  ```
- **Expected Result**: Prints `ALL PASS` with no `MISMATCH` lines (verified by running this exact script before writing this file). Cleanup: `rm /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat076-formatters.mjs`.
- **Repeatable Unit Test**: Blocked: `formatSessionStart` and the sort comparator are promotable in principle (pure, deterministic, no I/O) but `frontend/` has no configured test runner (no vitest/jest, no `*.test.tsx` anywhere in `frontend/`) — adding one would be new test infrastructure, out of scope for this run. The reference script above pins the exact logic read from source as a browser-free, re-runnable check in lieu of a promoted file.
- [x] Pass <!-- 2026-08-15 -->

### UAT-UI-003: Non-parseable sessionStart renders as a truncated monospace id with a full-UUID tooltip
- **Page**: `http://localhost:4321/`
- **Description**: DOM-only companion to UAT-EDGE-001 — the *value* `formatSessionStart` returns for a UUID fallback key is pinned browser-free there; this case confirms that value is actually what renders in the table cell, styled `font-mono`, with the raw `sessionStart` as the `title` tooltip (`AgentList.tsx:348`: `className` conditionally appends `font-mono` when `started.endsWith('…')`, and `title={s.sessionStart}`).
- **Auth-Required**: false
- **Steps**:
  1. Create a fixture agent:
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat076edge","workdir":"/tmp/uat076-nonexistent-nogit-dir3","launchCmd":"sleep 300"}'
     ```
  2. From the response, note `agent.id` as `$EID`.
  3. Seed one usage row whose `session_start` is a UUID-shaped string rather than an ISO timestamp (substitute `$EID`):
     ```bash
     sqlite3 ./data/conductor.db "INSERT INTO agent_usage (agent_id, session_start, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cost_usd) VALUES ($EID, 'a1b2c3d4-5678-90ab-cdef-1234567890ab', 100, 200, 0, 0, 0)"
     ```
  4. Open the dashboard, open this agent's detail modal, expand the "Usage (1 session)" section.
  5. Observe the "Session" cell for this row; hover it.
  6. Cleanup: close the modal, then `curl -sS -X DELETE "http://localhost:8788/api/agents/$EID"`.
- **Expected Result**: The Session cell renders `a1b2c3d4…` in a visibly monospace font (never `Invalid Date` or a blank cell), and hovering it shows the full UUID (`a1b2c3d4-5678-90ab-cdef-1234567890ab`) as a tooltip.
- **Repeatable Unit Test**: Not applicable: verifies rendered CSS (monospace font) and a browser tooltip in the actual DOM; no frontend component test harness exists. The underlying string value is pinned browser-free in UAT-EDGE-001.
- [FAIL: auto-judge: prerequisite not satisfied — host-server on :8788 and frontend dev server on :4321 both unreachable] <!-- 2026-08-21 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| `GET /agents/:id/usage` returns `{ agent, sessions }` (camelCase) for a valid agent; `[]` for no usage; 400 non-numeric; 404 unknown agent | UAT-API-001, UAT-API-002, UAT-API-003, UAT-API-004 |
| Modal shows a collapsible "Usage" section, one row per session, newest first, totals footer | UAT-UI-001 |
| Non-date `sessionStart` renders as truncated monospace id, never `Invalid Date`; ordering remains correct | UAT-UI-003, string value + sort comparator pinned by UAT-EDGE-001 |
| Zero usage rows → no Usage section | UAT-UI-002 |
| Usage section hidden while the log is expanded | UAT-UI-001 (steps 7–9) |
| Card-level UI (`AgentItem`) untouched; no snapshot/SSE changes; `db.ts`/`api.ts` untouched; `index.ts` diff limited to route + import | Static/code-review concern already gated by [[TASK-076]]'s own steps — not a new runtime behavior, so no separate UAT case (same precedent as UAT-063's typecheck line). |
| `npx tsc --noEmit` / `npm run build` clean | Already checked off in [[TASK-076]] step 5; not re-run here as it carries no new runtime behavior beyond what that step already confirmed. |

Fetch-failure degradation (`Agents with... fetch failures degrade to no section, never a crash`) is asserted by the source (`.catch(() => {})` leaves `sessions` at its initial `null`, and `if (!sessions...) return null` covers `null`) but is not given its own UAT case — reliably forcing a fetch failure requires browser-level network interception with no simpler deterministic trigger available, and no UI symptom would look any different from UAT-UI-002's already-covered "no section" state.

**Note on `uatGenerate.promoteTests`**: the stored preference (`true`, legacy grammar) maps to `dedicated` for this run, but the repo's own layout overrides it — every existing `host-server/` test file sits as a sibling next to the module it tests (`db.migration.test.ts` beside `db.ts`, etc.), with no dedicated `test/` directory anywhere. Following that established local pattern, the promoted backend test was added directly to the existing `host-server/db.migration.test.ts` rather than a new dedicated-folder file. `frontend/` has no test runner at all (no vitest/jest, no existing test files) — promoting `formatSessionStart`/the sort comparator into a real test file would mean introducing new frontend test infrastructure, out of scope for this generation, so that logic is instead pinned as a machine-verifiable, browser-free reference script inside UAT-EDGE-001 (same approach as UAT-074).

**Split summary**: 5 of 8 cases execute a real, machine-checkable verdict with no human in the loop (UAT-API-001..004 via live curl, UAT-EDGE-001 via a verified Node reference script); the remaining 3 (UAT-UI-001, UAT-UI-002, UAT-UI-003) are DOM-rendering-only and fail-close to human verification via `/uat-walk`, per UAT-CORE's UI rule.
