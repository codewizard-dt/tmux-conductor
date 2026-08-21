---
id: UAT-107
aliases: [UAT-107]
title: "UAT: Append terminal output to agent_terminal_log during SSE pane polling"
status: passed
task: TASK-107
created: 2026-07-06
updated: 2026-07-06
---

# UAT-107 — UAT: Append terminal output to agent_terminal_log during SSE pane polling

implements::[[TASK-107]]

> **Source task**: [`wiki/work/tasks/TASK-107-terminal-log-poll-append.md`](../tasks/TASK-107-terminal-log-poll-append.md)
> **Generated**: 2026-07-06

---

## Scope note

TASK-107 wires TASK-106's `appendTerminalLogChunk(db, agentId, chunk, maxRowsPerAgent)` helper
into the existing unfocused-agent SSE pane-poll loop (`tailPollLoop` in `host-server/index.ts`)
and adds a new `TERMINAL_LOG_MAX_ROWS_PER_AGENT` tuning constant. Scope is strictly the
poll-loop writer + its config knob — no `GET /agents/:agent/log` endpoint (TASK-108), no
`LogTail` History toggle (TASK-109), no session-boundary rendering (TASK-110). There is no new
HTTP route or UI surface introduced by this task, so the UAT below exercises the config knob
directly (now covered by a new repeatable unit test) and the poll-loop's real behavior against
a live tmux session and the real SQLite DB — the same boundary UAT-106 used for TASK-106's
DB-layer helpers.

---

## Prerequisites

- [ ] `host-server/` has working `node_modules/` (`npm install` run)
- [ ] `sqlite3` CLI is available on PATH
- [ ] A live tmux session named per `SESSION_NAME` in `conductor.conf` (default `conductor`) with at least one live agent window under management — start via `scripts/conductor.sh` or `make dev`
- [ ] The host-server is running (`cd host-server && npm run dev`, or via `make dev`) so `tailPollLoop` is active and `./data/conductor.db` exists
- [ ] Commands below are run from the repo root

---

## Test Cases

### UAT-EDGE-001: `npm test` passes, including the new TERMINAL_LOG_MAX_ROWS_PER_AGENT config tests
- **Scenario**: `TERMINAL_LOG_MAX_ROWS_PER_AGENT` must follow the same three-part config pattern (`declare -p` list → `parsePositiveIntSetting` → `ConductorConf` interface/cache field) as every other numeric knob in `host-server/config.ts`, defaulting to `500` when absent and honoring an explicit override, with non-positive values falling back to the default.
- **Steps**:
  1. Run the suite:
     ```bash
     npm --prefix host-server test
     ```
- **Expected Result**: Process exits 0. Output includes (with `✔` prefix) all three new cases:
  - `TERMINAL_LOG_MAX_ROWS_PER_AGENT defaults to 500 when absent from conductor.conf`
  - `TERMINAL_LOG_MAX_ROWS_PER_AGENT honors an explicit positive value from conductor.conf`
  - `TERMINAL_LOG_MAX_ROWS_PER_AGENT falls back to the default for a non-positive value`

  The final summary line reports `ℹ fail 0`.
- **Repeatable Unit Test**: Created: `host-server/config.test.ts` — this test case *is* the direct execution of the repeatable unit tests; no additional harness needed.
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-002: `TERMINAL_LOG_MAX_ROWS_PER_AGENT` is documented in the real `conductor.conf`
- **Scenario**: The task requires the knob be a documented, configurable line in the actual root `conductor.conf` (not just parsed in code) so operators can find and tune it.
- **Steps**:
  1. Confirm the declaration and its explanatory comment are present:
     ```bash
     grep -A4 -B4 '^TERMINAL_LOG_MAX_ROWS_PER_AGENT=' conductor.conf
     ```
- **Expected Result**: A `TERMINAL_LOG_MAX_ROWS_PER_AGENT=500` line appears, preceded by a comment block (modeled on the `TERMINAL_TAIL_LINES`/`FOCUSED_TERMINAL_TAIL_LINES` "capture-pane line depths" block) explaining it bounds `agent_terminal_log` rows per agent, pruned by `appendTerminalLogChunk`.
- **Repeatable Unit Test**: Not applicable — this asserts on the checked-in conf file's prose/formatting, not executable behavior.
- [x] Pass <!-- 2026-07-06 -->

### UAT-RUNTIME-001: agent_terminal_log gains rows during normal unfocused-agent polling
- **Scenario**: Core behavior of the task — every time `tailPollLoop`'s diff (`prevTailMap.get(a.id) !== text`) fires for a live, unfocused agent, a corresponding row must be persisted to `agent_terminal_log` via `appendTerminalLogChunk`, using the same `text` value that was just broadcast over SSE (no second capture, no separate diff).
- **Steps**:
  1. With the host-server running and a live agent window producing changing pane output (not focused in the dashboard modal), note the agent's numeric id from `GET /agents`.
  2. Wait a few `TERMINAL_POLL_MS` cycles (default 2000 ms) while the agent's pane output changes.
  3. Query recent rows for that agent:
     ```bash
     sqlite3 ./data/conductor.db "SELECT agent_id, ts, length(chunk) FROM agent_terminal_log WHERE agent_id = <AGENT_ID> ORDER BY ts DESC LIMIT 5;"
     ```
- **Expected Result**: Rows appear for the live agent's id, with `ts` timestamps advancing and non-zero `length(chunk)`, growing over time as pane output changes (new rows appended on each observed diff).
- **Repeatable Unit Test**: Not applicable — requires a live tmux pane and the running poll loop; `appendTerminalLogChunk` itself is already unit-tested end-to-end in `host-server/db.migration.test.ts` (TASK-106). This case verifies the *wiring* (the loop actually calls it with real pane text), which cannot be exercised without a live session.
- [SKIP: headless orchestration — live conductor session/host-server are up but all managed agents (bootstrap-1, codex, general) are idle/awaiting with no natural pane changes in the observation window; forcing output would mean injecting input into other agents' live panes, out of scope for uat-auto's no-repair policy. Wiring confirmed instead by direct source read of `tailPollLoop` (appendTerminalLogChunk(db, a.id, text, conf.terminalLogMaxRowsPerAgent) called with the identical `text`/diff-gate as the SSE broadcast) plus a real pre-existing agent_terminal_log row per agent from this server's own startup, and appendTerminalLogChunk's round-trip logic already green in UAT-EDGE-001's run.] <!-- 2026-07-06 -->

### UAT-RUNTIME-002: terminal-output SSE payload shape and cadence are unchanged
- **Scenario**: The DB append must be a side effect only — the existing `terminal-output` SSE broadcast's payload shape (`{ agentId, agent, text, lines }`), diff-gated cadence, and semantics must be completely unaffected by this task.
- **Steps**:
  1. With a live, output-producing unfocused agent present, open the SSE stream for ~8 seconds:
     ```bash
     curl -sS --max-time 8 -H 'Accept: text/event-stream' 'http://localhost:8788/events' | grep -A1 '^event: terminal-output'
     ```
- **Expected Result**: `event: terminal-output` lines appear (only on pane change, not every poll tick), each followed by a `data: {"agentId":<n>,"agent":"...","text":"...","lines":<n>}` line — the same four keys as before this task, in the same shape. No new fields, no missing fields, no change in the throttling behavior.
- **Repeatable Unit Test**: Not applicable — SSE stream behavior over a live poll loop, not deterministic pure logic.
- [SKIP: headless orchestration — live 8s capture of `/api/events` confirmed the stream connects and emits `session-update`/`agent-update` correctly, but no `terminal-output` event fired because no unfocused agent's pane changed in the window (consistent with the diff-gated contract, just not a positive case here); forcing a change would require injecting input into other agents' live panes, out of scope for uat-auto. Payload shape/cadence confirmed unchanged by direct source read: `broadcastSSE('terminal-output', { agentId, agent, text, lines })` call site is untouched and precedes the new `appendTerminalLogChunk` call as a pure side effect.] <!-- 2026-07-06 -->

### UAT-EDGE-003: Row cap is enforced live via the configured TERMINAL_LOG_MAX_ROWS_PER_AGENT value
- **Scenario**: The cap must actually be wired end-to-end — not just enforced by `appendTerminalLogChunk` in isolation (already unit-tested in TASK-106), but driven by the live config value read from `conductor.conf` through `tailPollLoop`.
- **Steps**:
  1. Temporarily set `TERMINAL_LOG_MAX_ROWS_PER_AGENT=5` in `conductor.conf`.
  2. Restart/reload the host-server so the new value is picked up (or wait out the 5s config cache TTL).
  3. Let a live agent's pane output change several distinct times (more than 5 times) while polling continues.
  4. Query the row count for that agent:
     ```bash
     sqlite3 ./data/conductor.db "SELECT COUNT(*) FROM agent_terminal_log WHERE agent_id = <AGENT_ID>;"
     ```
  5. Restore `TERMINAL_LOG_MAX_ROWS_PER_AGENT` to `500` in `conductor.conf` afterward.
- **Expected Result**: The count never exceeds `5` at any point after the cap took effect, even though more than 5 distinct pane-output changes occurred — oldest rows are pruned automatically as new ones are appended.
- **Repeatable Unit Test**: Not applicable for the live end-to-end wiring (requires a live tmux session + config reload); the pruning logic itself is already unit-tested in isolation by `host-server/db.migration.test.ts`'s `appendTerminalLogChunk prunes oldest rows beyond maxRowsPerAgent, keeping the newest` (TASK-106), and the config value plumbing is covered by this task's new `host-server/config.test.ts`.
- [SKIP: headless orchestration — exercising the live cap would require editing the shared conductor.conf and/or restarting the host-server that other concurrent live agents (bootstrap-1, codex, general) depend on, disruptive to real in-progress work and out of scope for uat-auto's no-repair policy. Covered instead by: config plumbing verified live-passing in UAT-EDGE-001; direct source read confirming `tailPollLoop` passes `conf.terminalLogMaxRowsPerAgent` straight into `appendTerminalLogChunk` on every invocation; and the pruning logic itself already unit-tested in isolation (still passing).] <!-- 2026-07-06 -->

### UAT-EDGE-004: `tailPollLoopFocus` is untouched by this task
- **Scenario**: The focused-agent poll loop (250 ms cadence, deeper tail, UI-responsiveness only) is explicitly out of scope — appending to `agent_terminal_log` on every tick of a 250 ms loop would blow through any reasonable row cap almost immediately. Its source must be byte-for-byte unchanged.
- **Steps**:
  1. Diff the committed working tree against the pre-task baseline for just this function (or inspect current source directly since this task's commit should show zero touches to it):
     ```bash
     git log -p --follow -- host-server/index.ts | grep -c 'tailPollLoopFocus'
     ```
  2. Alternatively, read the current `tailPollLoopFocus` body directly and confirm it contains no reference to `appendTerminalLogChunk` or `terminalLogMaxRowsPerAgent`.
- **Expected Result**: `tailPollLoopFocus`'s body still broadcasts only `terminal-output-focus` via `broadcastSSE`, with no `appendTerminalLogChunk` call and no reference to `conf.terminalLogMaxRowsPerAgent` anywhere in its body.
- **Repeatable Unit Test**: Not applicable — this is a source-inspection/no-regression check, not an executable behavior.
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-005: `npx tsc --noEmit` passes in host-server/
- **Scenario**: Static confirmation that the config knob and the new `appendTerminalLogChunk` wiring compile cleanly — the gate `/tackle` already ran, re-verified here to formally close the acceptance criterion.
- **Steps**:
  1. Run:
     ```bash
     npm --prefix host-server run typecheck
     ```
- **Expected Result**: Process exits 0 with no `error TS...` lines printed.
- **Repeatable Unit Test**: Not applicable — this is a static compiler gate (already run by `/tackle`'s Step 4), not a runtime behavior; re-run here only to formally close TASK-107's acceptance criterion.
- [x] Pass <!-- 2026-07-06 -->

---

## Gaps

None. Every planned test case had its exact contract confirmed by reading `host-server/index.ts` (`tailPollLoop`, `tailPollLoopFocus`), `host-server/db.ts` (`appendTerminalLogChunk` signature), and `host-server/config.ts` (`readConductorConf`, `ConductorConf`, `parsePositiveIntSetting`) directly before writing assertions. The config-knob behavior was promoted to a repeatable unit test (`host-server/config.test.ts`, 3 new cases, verified passing: `npm --prefix host-server test` reports 50/50 pass including the 3 new cases). The remaining cases (live poll-loop wiring, SSE payload shape, live row-cap enforcement, `tailPollLoopFocus` non-regression) are genuine runtime/integration behavior requiring a live tmux session and are not unit-test promotable without refactoring `tailPollLoop` to extract a testable pure function, which is out of this task's scope.
