---
id: UAT-142
aliases: [UAT-142]
title: "UAT: Widen detectAgentStatus's return type to expose detection reason and matched pattern"
status: passed
task: TASK-142
created: 2026-09-13
updated: 2026-09-13
---

# UAT-142 — UAT: Widen detectAgentStatus's return type to expose detection reason and matched pattern

implements::[[TASK-142]]

> **Source task**: [`wiki/work/tasks/TASK-142-widen-detect-agent-status-reason.md`](../tasks/TASK-142-widen-detect-agent-status-reason.md)
> **Generated**: 2026-09-13

TASK-142 is a pure type-widening/refactor: `detectAgentStatus()` (`host-server/state.ts:324-439`) now returns `{ state, reason, matchedPattern? }` instead of a bare `AgentRunState` string, with `reason`/`matchedPattern` set mechanically at each of its 18 existing return sites (mapping confirmed against `raw/research/detect-agent-status-reason-mapping/index.md`). No detection logic, patterns, or `capture-pane` calls changed, and `reason`/`matchedPattern` are explicitly **not** threaded into any HTTP/SSE payload in this task — that is TASK-143's job. Every test below targets only what this task changed: the new return shape's correctness at each branch, and that the existing API/SSE contract is provably unaffected.

---

## Prerequisites

- [ ] `host-server/` has working `node_modules/` (`cd host-server && npm install`)
- [ ] For UAT-API-001 only: host-server is running on port 8788 (`make dev`, or `cd host-server && npm run dev`) — an existing live conductor session is fine, the test only reads `GET /api/status`
- [ ] UAT-EDGE-001..018 need no live server or tmux session — `host-server/state.test.ts` drives `detectAgentStatus` directly with explicit `windowPresent`/`paneCurrentCommand`/`precapturedTail` arguments

---

## Test Cases

### UAT-API-001: GET /api/status never leaks the new reason/matchedPattern fields into the API contract
- **Endpoint**: `GET /api/status`
- **Description**: TASK-142's Acceptance Criteria requires every existing caller to "behave identically — no change to `agentStatuses[].state`, `status` contract, SSE payloads, or dashboard-visible behavior," and its Approach explicitly forbids threading `reason`/`matchedPattern` into the SSE/API payload. `buildAgentStatusContract` (`host-server/index.ts:656-710`) already computes its own, unrelated, coarser `status.reason` string (one of exactly 4 fixed values: `"tmux window is absent"`, `"pane command fell back to a shell"`, `"state file plus pane evidence"`, `"pane regex fallback"`) from `filePresent`/`state` — it must keep doing so, not be overwritten by `detectAgentStatus`'s new `DetectionReason` value, and no agent object may gain a `matchedPattern` key anywhere.
- **Steps**:
  1. Ensure the host-server is running on port 8788
  2. Run the command below
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '[.agents[] | {state, statusReason: .status.reason, hasMatchedPattern: (.status | has("matchedPattern")), hasTopLevelReason: has("reason")}]'
  ```
- **Expected Result**: HTTP 200. For every element of the returned array: `state` is one of `no-window|exited|idle|busy|awaiting|stalled|starting|unknown`; `statusReason` is one of the 4 fixed strings above (never a `DetectionReason` value like `"busy-recovered"`/`"awaiting-pattern"`/`"regex-fallback"`/`"inventory-timeout"`); `hasMatchedPattern` is `false`; `hasTopLevelReason` is `false`. Verified live against the real running host-server at generation time: every agent showed `statusReason: "state file plus pane evidence"`, `hasMatchedPattern: false`, `hasTopLevelReason: false`.
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-001: no-window (site 1)
- **Scenario**: `hasWindow` is false → the function must return before touching pane/state-file logic.
- **Steps**: `detectAgentStatus(conf, 'agent-x', 'claude', undefined, false, null)`
- **Expected Result**: `{ state: 'no-window', reason: 'no-window' }` (no `matchedPattern` key).
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: no-window when the tmux window is absent (site 1)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-002: exited via explicit pane-command shell fallback (sites 2/3)
- **Scenario**: The pane's current command fell back to a plain shell (`zsh`) while the launch command is not a shell — both the explicit `paneCurrentCommand` check (site 2) and the `isPaneDead` tmux fallback (site 3, not independently unit-tested since it requires a live tmux target) map to the same `reason`.
- **Steps**: `detectAgentStatus(conf, 'agent-x', 'claude', undefined, true, 'zsh')`
- **Expected Result**: `{ state: 'exited', reason: 'exited' }`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: exited when the pane fell back to a plain shell (site 2)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-003: busy state-file, unmodified fallthrough (site 8)
- **Scenario**: State file reads `busy`, pane tail still shows the busy indicator — reported verbatim.
- **Steps**: state-file `busy`; tail `"esc to interrupt"`
- **Expected Result**: `{ state: 'busy', reason: 'state-file', matchedPattern: 'busy' }`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: busy state-file with the busy pattern visible is an unmodified fallthrough (site 8)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-004: busy state-file, dialog open → awaiting (site 4)
- **Scenario**: State file reads `busy` but the pane shows an AskUserQuestion-style dialog footer.
- **Steps**: state-file `busy`; tail `"Enter to select · Esc to cancel"`
- **Expected Result**: `{ state: 'awaiting', reason: 'awaiting-pattern', matchedPattern: 'awaiting' }`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: busy state-file with an open dialog is reported awaiting (site 4)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-005: codex safety net recovers old busy file to idle (site 5)
- **Scenario**: Codex agent, `busy` file older than `2 × pollInterval`, pane tail matches codex's idle pattern and not its busy pattern.
- **Steps**: `launchCmd='codex'`; state-file `busy` aged 10s with `pollInterval=1`; tail `"codex>"`
- **Expected Result**: `{ state: 'idle', reason: 'busy-recovered', matchedPattern: 'idle' }`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: codex safety net recovers an old busy file to idle (site 5)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-006: hook-failure safety net recovers old busy file to idle for non-codex agents (site 6)
- **Scenario**: Claude/custom agent, `busy` file older than `2 × pollInterval`, pane tail matches the idle pattern (the Stop hook never fired).
- **Steps**: `launchCmd='claude'`; state-file `busy` aged 10s with `pollInterval=1`; tail `"accept edits on (shift+tab to cycle)"`
- **Expected Result**: `{ state: 'idle', reason: 'busy-recovered', matchedPattern: 'idle' }`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: hook-failure safety net recovers an old busy file to idle for non-codex agents (site 6)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-007: old busy file matching nothing → stalled (site 7)
- **Scenario**: Busy file older than `stallTimeout`, pane tail matches no busy/idle/awaiting pattern at all.
- **Steps**: state-file `busy` aged 5s with `stallTimeout=1`; tail `"nothing recognizable here"`
- **Expected Result**: `{ state: 'stalled', reason: 'inventory-timeout' }` (no `matchedPattern`).
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: an old busy file matching no pattern at all is reported stalled (site 7)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-008: awaiting state-file reverts to busy once the dialog is gone (site 9)
- **Scenario**: State file reads `awaiting` but the pane no longer shows a dialog footer — the agent resumed on its own.
- **Steps**: state-file `awaiting`; tail `"just some ordinary output"`
- **Expected Result**: `{ state: 'busy', reason: 'state-file' }` — `matchedPattern` is `undefined` (no key at all).
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: awaiting state-file reverts to busy once the dialog is gone (site 9)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-009: awaiting state-file persists while the dialog is still open (site 10)
- **Scenario**: State file reads `awaiting` and the dialog footer is still visible.
- **Steps**: state-file `awaiting`; tail `"Enter to select · Esc to cancel"`
- **Expected Result**: `{ state: 'awaiting', reason: 'state-file', matchedPattern: 'awaiting' }`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: awaiting state-file persists while the dialog is still open (site 10)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-010: idle state-file overridden to busy (site 11)
- **Scenario**: State file reads `idle` but the pane shows the busy indicator (agent relaunched without hook env on top of a stale idle file).
- **Steps**: state-file `idle`; tail `"esc to interrupt"`
- **Expected Result**: `{ state: 'busy', reason: 'state-file', matchedPattern: 'busy' }`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: idle state-file is overridden to busy when the busy pattern is visible (site 11)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-011: idle state-file overridden to awaiting (site 12)
- **Scenario**: State file reads `idle` but the pane shows a dialog/prompt footer.
- **Steps**: state-file `idle`; tail `"Rotate anyway?"`
- **Expected Result**: `{ state: 'awaiting', reason: 'awaiting-pattern', matchedPattern: 'awaiting' }`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: idle state-file is overridden to awaiting when a dialog is visible (site 12)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-012: idle state-file, unmodified fallthrough (site 13)
- **Scenario**: State file reads `idle`, pane shows nothing special.
- **Steps**: state-file `idle`; tail `"nothing interesting here"`
- **Expected Result**: `{ state: 'idle', reason: 'state-file', matchedPattern: 'idle' }`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: idle state-file with no overriding pattern is an unmodified fallthrough (site 13)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-013: no state file, empty pane tail → starting (site 14)
- **Scenario**: No state file (custom/pre-hook agent), and the pane produces no capturable output at all.
- **Steps**: no state file written; a nonexistent tmux window so the real `capture-pane` fallback returns `''`
- **Expected Result**: `{ state: 'starting', reason: 'starting' }`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: no state file and an empty pane tail is reported starting (site 14)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-014: no state file, regex fallback → busy (site 15)
- **Scenario**: No state file, pane tail matches `BUSY_PATTERN`.
- **Steps**: no state file; tail `"esc to interrupt"`
- **Expected Result**: `{ state: 'busy', reason: 'regex-fallback', matchedPattern: 'busy' }`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: no state file, regex fallback reports busy when BUSY_PATTERN matches (site 15)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-015: no state file, regex fallback → awaiting (site 16)
- **Scenario**: No state file, pane tail matches `AWAITING_PATTERN`.
- **Steps**: no state file; tail `"Rotate anyway?"`
- **Expected Result**: `{ state: 'awaiting', reason: 'regex-fallback', matchedPattern: 'awaiting' }`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: no state file, regex fallback reports awaiting when AWAITING_PATTERN matches (site 16)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-016: no state file, regex fallback → idle (site 17)
- **Scenario**: No state file, pane tail matches `IDLE_PATTERN`.
- **Steps**: no state file; tail `"? for shortcuts"`
- **Expected Result**: `{ state: 'idle', reason: 'regex-fallback', matchedPattern: 'idle' }`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: no state file, regex fallback reports idle when IDLE_PATTERN matches (site 17)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-EDGE-017: no state file, regex fallback default (site 18)
- **Scenario**: No state file, pane tail matches none of the busy/awaiting/idle patterns — final catch-all.
- **Steps**: no state file; tail `"totally unrecognized pane content"`
- **Expected Result**: `{ state: 'busy', reason: 'regex-fallback' }` — `matchedPattern` is `undefined`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`'detectAgentStatus: no state file, regex fallback defaults to busy when nothing matches (site 18)'`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [x] Pass <!-- 2026-09-13 -->

---

## Gaps

- **Site 3** (`isPaneDead` tmux fallback, when `paneCurrentCommand` is not supplied by the caller) is not independently unit-tested — it requires a live tmux pane to exercise `spawnSync('tmux', ['display-message', ...])`, and it maps to the same `reason: 'exited'` value already pinned by UAT-EDGE-002's `paneCurrentCommand`-based test. No behavioral risk identified; noted for completeness rather than dropped silently.
