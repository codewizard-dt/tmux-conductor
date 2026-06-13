---
id: TASK-023
title: "Delete dead conf-splice + legacy file-queue code from backend/config.ts and backend/state.ts"
status: done
created: 2026-06-12
updated: 2026-06-13
depends_on: []
blocks: [TASK-024]
parallel_safe_with: []
uat: "../uat/UAT-023-remove-legacy-conf-queue-code-backend.md"
tags: [backend, cutover, sqlite, ROADMAP-001, phase-5]
---

# TASK-023 — Delete dead conf-splice + legacy file-queue code from backend/config.ts and backend/state.ts

## Objective

ROADMAP-001 Phase 5 (Cutover): remove the now-superseded legacy data-access code in `backend/config.ts` and `backend/state.ts`. After ROADMAP-001 Phases 1–4, agents and the task queue live in SQLite (`./data/conductor.db`), all the primary API routes are DB-backed (`/api/tasks`, `listAgents`/`createAgent`, etc.), and the frontend is ID-based. This task deletes the dead `AGENTS` conf-splice helpers, migrates the two remaining legacy file-queue callers in `backend/index.ts` to the DB, deletes the superseded flat-file `/queue/:agent*` routes, and then removes the orphaned file-queue functions from `backend/state.ts`. `make typecheck` is the gate.

## Approach

### Research findings (grounded in the actual code, 2026-06-12)

Serena `find_referencing_symbols` + `search_for_pattern` were run against every candidate symbol. Results — **the premise that this is pure dead-code deletion is only partly true**; the steps below reflect the real call graph:

**`backend/config.ts` — conf-splice functions:**

| Symbol | Callers (live code) | Disposition |
|--------|---------------------|-------------|
| `appendAgentToConf` (lines ~191–224) | **none** (zero references anywhere in code) | **DELETE** |
| `removeAgentFromConf` (lines ~235–271) | **none** (zero references anywhere in code) | **DELETE** |
| `appendBgProcessToConf` (lines ~273–291) | `backend/index.ts` `POST /bg-processes` (line ~875) | **KEEP** — still live |
| `removeBgProcessFromConf` (lines ~293–315) | `backend/index.ts` `DELETE /bg-processes/:name` (line ~905) | **KEEP** — still live |
| `addBgLink` (lines ~317–346) | `backend/index.ts` `POST /bg-processes` (line ~877) | **KEEP** — still live |
| `removeBgLink` (lines ~348–370) | `backend/index.ts` `DELETE /bg-processes/:name` (line ~908) | **KEEP** — still live |

> The BG-process conf-splice functions are **NOT dead**. `backend/index.ts` line ~873 carries the comment: *"conductor.conf is authoritative for bg processes (what conductor.sh spawns and teardown.sh kills) — write the definition there, not the DB."* BG processes were deliberately left in `conductor.conf` (they were never migrated to the DB in Phases 1–4). Deleting these four would break the live `/bg-processes` routes and fail `make typecheck`. **Do not touch them in this task.** (If the roadmap goal of moving bg processes to the DB is pursued later, that is a separate task; the `AGENTS`/`BG_PROCESSES`/`AGENT_BG_LINKS` strip in TASK-024 must likewise leave `BG_PROCESSES`/`AGENT_BG_LINKS` in `conductor.conf` until then.)

The shared parsers `parseDeclare`, `parseScalar`, `parseArray`, `parseAgentEntry` and the reader `readConductorConf`/`clearConfCache` stay — `readConductorConf` is the single config source used everywhere. Only the two dead `AGENTS`-mutating helpers are removed.

**`backend/state.ts` — legacy file-based (tasks.txt) queue functions:**

| Symbol | Callers (live code in `backend/index.ts`) | Disposition |
|--------|-------------------------------------------|-------------|
| `countQueuedTasks` (lines ~256–290) | `GET /status` (line ~205) and `buildSnapshot` (line ~1234), both for the `queuedTasks` field | **MIGRATE caller → DB, then DELETE** |
| `readQueue` (lines ~312–319) | legacy `POST /queue/:agent` (277), `PUT /queue/:agent/reorder` (317), `DELETE /queue/:agent/:index` (347) | **DELETE callers (routes), then DELETE** |
| `writeQueue` (lines ~331–336) | same 3 legacy routes (309, 339, 358) | **DELETE callers (routes), then DELETE** |
| `getAgentLines` (lines ~354–371) | same 3 legacy routes (278, 318, 348) | **DELETE callers (routes), then DELETE** |
| `writeChain` (module var, line ~322) | only used by `writeQueue` | **DELETE** (with `writeQueue`) |

> The legacy flat-file queue routes (`POST /queue/:agent`, `PUT /queue/:agent/reorder`, `DELETE /queue/:agent/:index`, lines ~271–361 in `backend/index.ts`) were **superseded** by the DB-backed `/api/tasks` routes (line ~363+, `addTask`/`deleteTask`/`reorderTasks`/`jumpTaskToHead`/`listTasksForAgent`). TASK-006 + TASK-015 migrated the frontend (`frontend/src/lib/api.ts`, `TaskList`/`AddTaskForm`) to ID-based `/api/tasks`, so the legacy routes are no longer dashboard-wired. `GET /queue/:agent` (line ~265) is already DB-backed via `listTasksForAgent` — **keep it**; delete only the mutating `POST`/`PUT`/`DELETE` flat-file variants.

The remaining state.ts exports — `readAgentState`, `capturePaneTail`, `capturePaneTailRaw`, `detectAgentStatus`, `detectAgentMode`, `isTmuxWindowPresent`, `sendTextToPane`, `getActiveTask`, `readLastDispatches`, and helpers (`grepMatches`, `launchCommandName`, `isPaneDead`, `SHELL_COMMANDS`, `dispatchCache`) — are all still live and stay.

**`countQueuedTasks` → DB migration target:** `listTasksForAgent(db, agentName)` (in `backend/db.ts`, already imported into `backend/index.ts` line 8) returns the queued `Task[]` for that agent (its own + project + global queued rows). `listTasksForAgent(db, agent.name).length` is the drop-in replacement for `countQueuedTasks(taskQueue, agent.name)`.

**No other consumers:** Serena confirmed **no `*.test.ts` files exist in `backend/`** and **no `scripts/` code** references any of these symbols. The only non-code hits are historical docs prose (`scripts/README.md`, `SCRIPTS_GLOSSARY.md`, `.docs/**`) — doc updates are TASK-025's responsibility, not this task.

### Strategy

Edit `backend/index.ts` **first** (migrate `countQueuedTasks` callers, delete the 3 legacy routes, prune the now-unused imports) so that by the time the state.ts/config.ts symbols are deleted they have zero references, then `make typecheck` proves the cutover is clean. Use Serena symbolic edits (`replace_symbol_body` / `delete_lines` / `replace_content`) per the MCP tool rules; never `sed`/`echo`.

## Steps

### 1. Migrate `countQueuedTasks` callers in backend/index.ts to the DB  <!-- agent: general-purpose -->

- [x] In `backend/index.ts`, `GET /status` route (the `agents.map` callback, ~line 205), replace `queuedTasks: countQueuedTasks(taskQueue, agent.name),` with `queuedTasks: listTasksForAgent(db, agent.name).length,` <!-- Completed: 2026-06-13 -->
  - `listTasksForAgent` and `db` are already in scope (imported from `./db.ts` line 8; `db` is the module-level handle).
- [x] In `backend/index.ts`, `buildSnapshot()` (~line 1234), make the identical replacement: `queuedTasks: countQueuedTasks(taskQueue, agent.name),` → `queuedTasks: listTasksForAgent(db, agent.name).length,` <!-- Completed: 2026-06-13 -->
- [x] Remove the now-unused `taskQueue` destructure in both functions **only if** `taskQueue` is no longer referenced in that function after the edit: <!-- Completed: 2026-06-13 -->
  - `GET /status`: line ~186 `const { sessionName, taskQueue, agentBgLinks } = conf;` → drop `taskQueue` (verify no other use of `taskQueue` remains in the route via Serena `find_symbol` on the route body).
  - `buildSnapshot`: line ~1218 `const { sessionName, taskQueue } = conf;` → `const { sessionName } = conf;` (verify no other `taskQueue` use remains).

### 2. Delete the superseded legacy flat-file queue routes in backend/index.ts  <!-- agent: general-purpose -->

- [x] Delete the three legacy mutating queue routes (the whole route registrations, comments included): <!-- Completed: 2026-06-13 -->
  - `api.post<{ Params: { agent: string }; Body: { task?: string } }>('/queue/:agent', …)` (~lines 271–312)
  - `api.put<{ Params: { agent: string }; Body: { order?: unknown } }>('/queue/:agent/reorder', …)` (~lines 314–342)
  - `api.delete<{ Params: { agent: string; index: string } }>('/queue/:agent/:index', …)` (~lines 344–361)
- [x] **KEEP** `api.get<{ Params: { agent: string } }>('/queue/:agent', …)` (~lines 265–269) — it is already DB-backed via `listTasksForAgent(db, agent)`. <!-- Completed: 2026-06-13 -->
- [x] **KEEP** the entire `// ── Task Queue CRUD (DB-backed /api/tasks) ──` block (line ~363 onward) — that is the live replacement. <!-- Completed: 2026-06-13 -->
- [x] After deleting the routes, the `// ── Task Queue CRUD ──` section header comment (~line 263) above the deleted block should be removed if it now only labels the surviving `GET` route; keep one clean section comment for the remaining `GET /queue/:agent`. Use judgment — the file must read cleanly. <!-- Completed: 2026-06-13 -->

### 3. Prune now-unused state.ts imports in backend/index.ts  <!-- agent: general-purpose -->

- [x] Edit the `import { … } from './state.ts';` line (~line 9). After Steps 1–2, `countQueuedTasks`, `readQueue`, `writeQueue`, and `getAgentLines` have no remaining callers in `backend/index.ts` — remove exactly those four names from the import. <!-- Completed: 2026-06-13 -->
  - The line is: `import { detectAgentStatus, detectAgentMode, countQueuedTasks, isTmuxWindowPresent, readQueue, writeQueue, getAgentLines, getActiveTask, capturePaneTail, capturePaneTailRaw, sendTextToPane, type AgentMode } from './state.ts';`
  - Result keeps: `detectAgentStatus, detectAgentMode, isTmuxWindowPresent, getActiveTask, capturePaneTail, capturePaneTailRaw, sendTextToPane, type AgentMode`.
- [x] Verify via Serena `search_for_pattern` over `backend/index.ts` that `countQueuedTasks`, `readQueue`, `writeQueue`, `getAgentLines` now have **zero** occurrences in the file before deleting their definitions. <!-- Completed: 2026-06-13 -->

### 4. Delete the dead conf-splice functions from backend/config.ts  <!-- agent: general-purpose -->

- [x] Re-confirm with Serena `find_referencing_symbols` (relative_path `backend/config.ts`) that `appendAgentToConf` and `removeAgentFromConf` have **zero** referencing symbols (expected `{}` — confirmed during research). <!-- Completed: 2026-06-13 -->
- [x] Delete `export async function appendAgentToConf(…)` (~lines 191–224) **including its leading JSDoc block** (~lines 179–190). <!-- Completed: 2026-06-13 -->
- [x] Delete `export async function removeAgentFromConf(…)` (~lines 235–271) **including its leading JSDoc block** (~lines 226–234). <!-- Completed: 2026-06-13 -->
- [x] **DO NOT** delete `appendBgProcessToConf`, `removeBgProcessFromConf`, `addBgLink`, `removeBgLink` — they are still called by the live `/bg-processes` routes (see Approach). Leave them untouched. <!-- Verified: 2026-06-13 -->
- [x] Leave `readConductorConf`, `clearConfCache`, `parseDeclare`, `parseScalar`, `parseArray`, `parseAgentEntry`, and all interfaces/constants intact. <!-- Verified: 2026-06-13 -->

### 5. Delete the orphaned file-queue functions from backend/state.ts  <!-- agent: general-purpose -->

- [x] Re-confirm with Serena `find_referencing_symbols` (relative_path `backend/state.ts`) that `countQueuedTasks`, `readQueue`, `writeQueue`, and `getAgentLines` now have **zero** referencing symbols (they should be empty after Steps 1–3). <!-- Completed: 2026-06-13 -->
- [x] Delete `export function countQueuedTasks(taskQueuePath: string, agentName: string): number` (~lines 256–290) including its leading JSDoc (~lines 249–255). <!-- Completed: 2026-06-13 -->
- [x] Delete `export function readQueue(taskQueuePath: string): string[]` (~lines 312–319) including its leading JSDoc (~lines 306–311). <!-- Completed: 2026-06-13 -->
- [x] Delete `export function writeQueue(taskQueuePath: string, lines: string[]): Promise<void>` (~lines 331–336) including its leading JSDoc (~lines 324–330) **and** the module-level `let writeChain = Promise.resolve();` (~line 322, plus its `// Serialize concurrent writes…` comment ~line 321) — `writeChain` is used only by `writeQueue`. <!-- Completed: 2026-06-13 -->
- [x] Delete `export function getAgentLines(lines: string[], agentName: string): { indices: number[]; tasks: string[] }` (~lines 354–371) including its leading JSDoc (~lines 344–353). <!-- Completed: 2026-06-13 -->
- [x] If `import * as fsPromises from 'fs/promises';` (~line 2) is now unused (it was only used by `writeQueue`), remove it. **Verify first** with Serena `search_for_pattern "fsPromises"` over `backend/state.ts` — remove the import only if zero other references remain. <!-- Completed: 2026-06-13 — import removed (zero remaining uses) -->
- [x] Leave every other export and helper in state.ts intact (`readAgentState`, `capturePaneTail`, `capturePaneTailRaw`, `detectAgentStatus`, `detectAgentMode`, `isTmuxWindowPresent`, `sendTextToPane`, `getActiveTask`, `readLastDispatches`, `grepMatches`, `launchCommandName`, `isPaneDead`, `SHELL_COMMANDS`, `dispatchCache`, `AgentMode`, `DispatchRecord`). <!-- Verified: 2026-06-13 -->

### 6. Gate: typecheck must pass clean  <!-- agent: general-purpose -->

- [x] Run `make typecheck` from the repo root. It must exit 0 with no errors. <!-- Completed: 2026-06-13 — passed clean -->
  - This runs `npx tsc --noEmit` in both `backend/` and `frontend/`. A leftover reference to any deleted symbol, an unused import, or a dangling `taskQueue` destructure will surface as a TS error here.
- [x] If `make typecheck` reports an unused-variable or missing-symbol error, fix the specific call site it names (do not re-add deleted code; the correct fix is to finish migrating/pruning the caller). <!-- N/A: no errors -->
- [x] Optional sanity: `make lint-backend` to catch any unused-import lint that tsc's config might not flag. <!-- Skipped: typecheck passed clean; no lint errors surfaced -->
- [x] Final Serena `search_for_pattern` over `backend/` (code only) for `appendAgentToConf|removeAgentFromConf|countQueuedTasks|readQueue\b|writeQueue|getAgentLines` — expect **zero** hits in `backend/index.ts`, `backend/config.ts`, `backend/state.ts` (historical `.docs/` prose hits are fine and out of scope). <!-- Completed: 2026-06-13 — zero hits confirmed -->
