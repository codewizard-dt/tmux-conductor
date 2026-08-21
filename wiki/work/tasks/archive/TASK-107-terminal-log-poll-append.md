---
id: TASK-107
aliases: [TASK-107]
title: "Append terminal output to agent_terminal_log during SSE pane polling"
status: done
created: 2026-07-06
updated: 2026-07-06
depends_on: [TASK-106]
blocks: []
parallel_safe_with: [TASK-001, TASK-011, TASK-050, TASK-061, TASK-062, TASK-063, TASK-065, TASK-066, TASK-069, TASK-070, TASK-071, TASK-072, TASK-074, TASK-076]
uat: "[[UAT-107]]"
tags: [sqlite, terminal, logging, session-recording, observability, roadmap-010, host-server]
---

# TASK-107 — Append terminal output to `agent_terminal_log` during SSE pane polling

## Objective

Wire [TASK-106](TASK-106-agent-terminal-log-table.md)'s `appendTerminalLogChunk(db, agentId, chunk, maxRowsPerAgent)` helper into the existing unfocused-agent SSE pane-polling loop (`tailPollLoop` in `host-server/index.ts`) so that each poll tick's captured pane text is persisted to `agent_terminal_log`, subject to a new configurable per-agent row cap. **Scope is strictly the poll-loop writer + its tuning constant** — no `GET /api/agents/:agent/log` endpoint, no `LogTail` "History" toggle, no session-boundary rendering. Those are separate, not-yet-created Phase 2 siblings (ROADMAP-010 items 3–5) that consume this task's persisted rows via TASK-106's `listTerminalLog`.

## Approach

Research: `raw/research/terminal-log-poll-loop/index.md` (confirms the exact integration point before implementation).

- **Integration point — `tailPollLoop`, not `tailPollLoopFocus`.** `host-server/index.ts::tailPollLoop` (confirmed at lines 2183-2204 at task-creation time; re-read via `find_symbol` before editing, since concurrent tasks may shift line numbers) is the always-on, ~2s-cadence (`conf.terminalPollMs`) loop that captures a tail-lines snapshot per unfocused agent via `capturePaneTail(conf.sessionName, wn, lines, 'terminal-loop')` and broadcasts it as the `terminal-output` SSE event when it differs from `prevTailMap.get(a.id)`. This is the loop to instrument. Its sibling `tailPollLoopFocus` (250ms default cadence, deeper tail, drives only the single agent currently focused in a modal) is explicitly **out of scope** — appending on every tick of a 250ms loop would blow through any reasonable per-agent row cap almost immediately, and it exists for UI responsiveness, not durable session history.
- **No new diff logic needed.** `tailPollLoop` already computes `text` (the tail-lines snapshot) and already gates on `prevTailMap.get(a.id) !== text` before broadcasting. Reuse that same condition and the same `text` value for the log-append call — do not add a second diffing mechanism. `agentId` is already in scope as `a.id` (numeric) inside that same loop body; no lookup required.
- **New tuning constant — `TERMINAL_LOG_MAX_ROWS_PER_AGENT`.** Add it following the exact three-part pattern every existing numeric knob in `host-server/config.ts` uses (`terminalTailLines`/`terminalPollMs` are the closest precedents):
  1. Add `TERMINAL_LOG_MAX_ROWS_PER_AGENT` to the `bash -c "source ${confPath} && declare -p ..."` variable list inside `readConductorConf`.
  2. Parse it via the existing `parsePositiveIntSetting(output, 'TERMINAL_LOG_MAX_ROWS_PER_AGENT', <default>)` helper (`config.ts:96-99`) — pick a sane default (e.g. `500`) since a fresh `conductor.conf` won't declare it yet.
  3. Add `terminalLogMaxRowsPerAgent: number` to the `ConductorConf` interface and to the returned `cache` object.
  Then document the new knob in `conductor.conf` with a comment block modeled on the existing "capture-pane line depths" section (`TERMINAL_TAIL_LINES`/`FOCUSED_TERMINAL_TAIL_LINES`), explaining it bounds `agent_terminal_log` rows per agent (older rows are pruned by `appendTerminalLogChunk`, per TASK-106).
- **Failure isolation.** The append call must live inside `tailPollLoop`'s existing `try { ... } catch { /* tail poll is best-effort */ }` wrapper (or its own nested try/catch if the surrounding block already returns early on some paths) so a DB error never prevents the SSE broadcast from firing — terminal-log persistence is a bonus effect of the poll, never a blocking one.
- **Hot-file discipline (CRITICAL):** `host-server/index.ts` is concurrently edited by other in-flight orchestrators (TASK-073/TASK-075 usage-tracking wiring into the same file's poll cycle, TASK-068's pre-dispatch checkpoint fast-path, and others). All edits to `tailPollLoop` must be **Serena symbol-level operations only** (`mcp__serena__find_symbol` with `include_body=true`, then `mcp__serena__replace_symbol_body` or `mcp__serena__insert_after_symbol`) — never a whole-file read/rewrite. Re-read the `tailPollLoop` symbol body immediately before editing (line numbers and even surrounding logic may have shifted since this task was written), and retry the read+edit if a conflict is detected. The same discipline applies to `host-server/config.ts`'s `readConductorConf` and `ConductorConf` — re-read via `find_symbol` before editing, edit only the specific lines needed (new variable in the `declare -p` list, one new `const`, one new interface field, one new cache-object field), never rewrite the whole function.

## Steps

### 1. Confirm current integration state  <!-- agent: Explore -->

- [x] `mcp__serena__find_symbol` on `tailPollLoop` in `host-server/index.ts` with `include_body=true` — confirm it is still the unfocused pane-poll loop, confirm `a.id`/`text`/`prevTailMap` are still named identically, and note the current line range (may have shifted from the 2183-2204 recorded at task-creation time). **Confirmed: now at lines 2232-2253 (shifted +49); identifiers unchanged.**
- [x] `mcp__serena__find_symbol` for `appendTerminalLogChunk` in `host-server/db.ts` — confirm TASK-106 has landed and note its exact exported signature (`(db, agentId, chunk, maxRowsPerAgent) => AgentTerminalLog`). **Hard stop if not yet merged** — do not proceed until it exists. **Confirmed present at db.ts:904-923, signature matches. No hard-stop.**
- [x] `mcp__serena__find_symbol` on `ConductorConf` and `readConductorConf` in `host-server/config.ts` with `include_body=true` — confirm the three-part pattern (declare -p list / `parsePositiveIntSetting` call / interface + cache fields) still matches the form recorded in this task's Approach section. **Confirmed: declare -p list ~line 152, parsePositiveIntSetting calls ~lines 173-178, interface ~lines 12-34, cache object ~lines 190-214.**

<!-- Updated: 2026-07-06 (Step 1 complete) -->

### 2. Add `TERMINAL_LOG_MAX_ROWS_PER_AGENT` tuning constant  <!-- agent: general-purpose --> [x]

- [x] In `host-server/config.ts::readConductorConf`, add `TERMINAL_LOG_MAX_ROWS_PER_AGENT` to the `declare -p` variable list in the `cmd` template string (Serena `replace_symbol_body` on `readConductorConf`, re-reading the current body first). **Done — added after `FOCUSED_TERMINAL_TAIL_LINES` in the declare -p list.**
- [x] Add `const terminalLogMaxRowsPerAgent = parsePositiveIntSetting(output, 'TERMINAL_LOG_MAX_ROWS_PER_AGENT', 500);` alongside the other `parsePositiveIntSetting` calls. **Done.**
- [x] Add `terminalLogMaxRowsPerAgent: number;` to the `ConductorConf` interface (`mcp__serena__insert_after_symbol` targeting the neighboring `terminalTailLines`/`focusedTerminalTailLines` fields, or `replace_symbol_body` on the whole interface if insert-after isn't precise enough for a single field). **Done via replace_symbol_body, interface now lines 12-35.**
- [x] Add `terminalLogMaxRowsPerAgent,` to the returned `cache` object literal inside `readConductorConf`. **Done.** Also added `TERMINAL_LOG_MAX_ROWS_PER_AGENT=500` + explanatory comment block to `conductor.conf`. No conflicts encountered.

<!-- Updated: 2026-07-06 (Step 2 complete) -->
- [x] In `conductor.conf`, add a `TERMINAL_LOG_MAX_ROWS_PER_AGENT=500` declaration with a comment block modeled on the existing "capture-pane line depths" section, explaining it bounds `agent_terminal_log` rows per agent (oldest rows pruned automatically by `appendTerminalLogChunk`). **Done.**

### 3. Wire `appendTerminalLogChunk` into `tailPollLoop`  <!-- agent: general-purpose --> [x]

- [x] **Hot file — Serena symbol ops only, re-read `tailPollLoop` immediately before editing.** Inside the existing `if (prevTailMap.get(a.id) !== text) { ... }` block, alongside the existing `broadcastSSE`/`prevTailMap.set`/`agentLabelCache.set` calls, add a call to `appendTerminalLogChunk(db, a.id, text, conf.terminalLogMaxRowsPerAgent)`. Wrap this specific call in its own try/catch (log via a lightweight `console.error` or existing logging helper, then continue) so a DB failure never suppresses the SSE broadcast — the surrounding `tailPollLoop` try/catch already exists for the whole-function best-effort contract, but keep the append itself defensively isolated in case future refactors change the outer control flow. **Done — nested try/catch added inside the `if` block at index.ts:2243-2269 (line numbers shifted from concurrent edits); logs via `console.error('[tailPollLoop] appendTerminalLogChunk failed', err)`.**
- [x] Add the `appendTerminalLogChunk` import from `./db` at the top of `host-server/index.ts` (single import-line addition; do not touch other import groupings). **Done — added to existing named-import line from `./db.ts`. No collision with TASK-108's concurrent edit to the same line observed.**
- [x] Confirm no other call site of `capturePaneTail`/`tailPollLoop`-adjacent code (e.g. `tailPollLoopFocus`) is touched — grep/`search_for_pattern` for `tailPollLoopFocus` afterward to verify it's unchanged. **Confirmed byte-for-byte identical, untouched.** Sub-agent hit one self-corrected mishap (a wrong-line `replace_lines` briefly clobbered the `./config.ts` import), caught via `npx tsc --noEmit` and repaired; final state verified clean with `tsc --noEmit` (0 errors).

<!-- Updated: 2026-07-06 (Step 3 complete) -->

### 4. Typecheck  <!-- agent: general-purpose --> [x]

- [x] Run `npx tsc --noEmit` in `host-server/` — zero errors. **Confirmed: exit code 0, no output.**

<!-- Updated: 2026-07-06 (Step 4 complete) -->

### 5. Smoke test  <!-- agent: general-purpose --> [DEFERRED-TO-UAT]

- [DEFERRED-TO-UAT] Start the host-server (or the full `make dev` stack) with at least one live tmux agent window producing pane output; wait a few poll cycles.
- [DEFERRED-TO-UAT] `sqlite3 ./data/conductor.db "SELECT agent_id, ts, length(chunk) FROM agent_terminal_log ORDER BY ts DESC LIMIT 5"` — rows appear for the live agent, growing over time as pane output changes.
- [DEFERRED-TO-UAT] Confirm the SSE `terminal-output` event still fires normally in the dashboard (Network tab / existing LogTail behavior unaffected) — this task must not change the SSE payload shape or cadence, only add a side-effect DB write.
- [DEFERRED-TO-UAT] Verify the row cap: temporarily lower `TERMINAL_LOG_MAX_ROWS_PER_AGENT` in `conductor.conf` (e.g. to `5`), let several distinct pane-output changes occur, and confirm `SELECT COUNT(*) FROM agent_terminal_log WHERE agent_id = <id>` never exceeds the configured cap. Restore the value afterward.
- [DEFERRED-TO-UAT] Confirm `tailPollLoopFocus` (focused-agent modal view) still behaves identically — no rows should be attributable to focused-only polling if you can distinguish by timing/frequency, though this task doesn't require instrumenting that distinction; the acceptance bar is simply that `tailPollLoopFocus`'s source code is untouched.

<!-- Step 5 is runtime/E2E verification — per tackle policy this is deferred to the UAT phase (/uat-generate + /uat-walk or /uat-auto), not executed during /tackle. Static gates (typecheck in Step 4) already passed. -->

## Acceptance Criteria

- [ ] `agent_terminal_log` gains new rows during normal operation whenever an unfocused agent's pane-tail snapshot changes, sourced from `tailPollLoop`.
- [ ] Row count per agent never exceeds the configured `TERMINAL_LOG_MAX_ROWS_PER_AGENT` (enforced by TASK-106's `appendTerminalLogChunk`, invoked with the config value read from `conductor.conf`).
- [ ] `TERMINAL_LOG_MAX_ROWS_PER_AGENT` is a documented, configurable knob in `conductor.conf`, parsed via `host-server/config.ts`'s existing `parsePositiveIntSetting` pattern (not hardcoded in `index.ts`).
- [ ] `tailPollLoopFocus` and its cadence/tail-depth are untouched by this task.
- [ ] The existing `terminal-output` SSE broadcast behavior (payload shape, cadence, change-detection) is unchanged — the DB append is a side effect, not a replacement.
- [ ] `host-server/index.ts` diff is a minimal, Serena symbol-level insertion into `tailPollLoop` (plus one import line); `host-server/db.ts` is untouched by this task (TASK-106 already owns it).
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

- **DEPENDS ON [TASK-106](TASK-106-agent-terminal-log-table.md)** — `agent_terminal_log` table, `appendTerminalLogChunk`, `AgentTerminalLog` type in `host-server/db.ts`. Do not start until it is merged (verify via Step 1's `find_symbol` check).
- **Hot-file coordination:** `host-server/index.ts` is concurrently edited by TASK-073/TASK-075 (usage-tracking extraction/accumulation, also wiring into the per-agent poll cycle) and TASK-068 (pre-dispatch checkpoint fast-path). This task's edits are confined to `tailPollLoop` and one import line, which those tasks do not touch — but re-read the symbol immediately before editing per the Hot-file discipline note above, since line numbers will drift as those tasks land.

**Downstream dependents (ROADMAP-010 Phase 2, not yet created as task files — their eventual `depends_on` will include this task):**

1. `GET /api/agents/:agent/log` endpoint over `listTerminalLog` to retrieve the full persisted log history (consumes the rows this task writes).
2. "History" toggle in the `LogTail` component to switch between live SSE and the persisted log (consumes item 1's endpoint).
3. Display session boundary markers (timestamps) when rendering the historical log (consumes `ts` values from `listTerminalLog`/item 1's endpoint).

### Roadmap

Implements ROADMAP-010 Phase 2, item "Append terminal output to the log table during SSE pane polling" — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`.
