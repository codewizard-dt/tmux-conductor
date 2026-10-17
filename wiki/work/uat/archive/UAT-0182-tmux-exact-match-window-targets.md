---
id: UAT-0182
aliases: [UAT-0182]
title: "UAT: Address tmux windows with exact-match `=` targets"
status: passed
task: TASK-0182
created: 2026-09-19
updated: 2026-09-19
---

# UAT-0182 — UAT: Address tmux windows with exact-match `=` targets

implements::[[TASK-0182]]

> **Source task**: [[TASK-0182]]
> **Generated**: 2026-09-19

---

## Prerequisites

- [ ] **The running host-server must be restarted to load TASK-0182's changes.** As of generation the server on `:8788` was `node --import tsx/esm index.ts` started Sep 18 23:02 — plain `npm run start`, **no `--watch`** — so it is still running the pre-fix code (a live `GET /api/agents/29/tail` still returned `windowPresent: true` for the dead agent). Restart with `make dev` (stops/starts host-server + frontend together via `concurrently`). Live cases UAT-API-001/002/003 and UAT-UI-001 are meaningless until this is done. UAT-EDGE-001/002/003 do not depend on the server.
- [ ] Live fixture (as of 2026-09-19): agent **id 29** `tmux-conductor-3` (project `tmux-conductor`, window name `tmux-conductor-tmux-conductor-3`) has **no tmux window**, while its clone agent **id 31** `tmux-conductor-3-copy` has a live window `tmux-conductor-tmux-conductor-3-copy`. Confirm before running: `curl -sS 'http://localhost:8788/api/agents' | jq -c '.[] | select(.name|startswith("tmux-conductor-3")) | {id,name}'` and `tmux list-windows -t conductor -F '#{window_name}'`. **If the ids or windows differ, substitute the ids below.** The fixture requires a stopped agent whose window name is a strict prefix of a live window's name.
- [ ] Agent id **32** `tmux-conductor-frontend-1` (window `tmux-conductor-tmux-conductor-frontend-1`) has a live window with no prefix sibling — used as the exact-name control. Agent id **15** `tmux-conductor-2` has no window and no prefix sibling.
- [ ] `tmux` >= 3.0 on PATH (the exact-match `=` prefix needs >= 2.1).
- [ ] **Do NOT click Stop or Delete on agent 29 (or any inactive agent with a running `-copy`) to test this task.** Before the fix those actions `kill-window` the clone. Their guard is the same `isTmuxWindowPresent` exercised by UAT-API-001/002; the kill path is intentionally not driven live.

---

## Test Cases

### UAT-EDGE-001: `isTmuxWindowPresent` / `capturePaneTail` do not prefix-match a sibling window
- **Scenario**: A tmux session has only a window named `foo-copy`. Asking whether window `foo` is present must be **false**, and capturing pane text for `foo` must return an empty string — not `foo-copy`'s pane. `windowTarget('s','foo')` must be `'s:=foo'`.
- **Steps**:
  1. Run the file-scoped unit test command below (it creates and kills its own throwaway `tc-test-*` tmux session; it never touches the live `conductor` session).
  2. Confirm the block `tmux exact-match window targets (TASK-0182)` passes, including `isTmuxWindowPresent does not prefix-match a sibling window`.
- **Command**:
  ```bash
  cd host-server && npx tsx --test state.test.ts
  ```
- **Expected Result**: exit 0; 22 tests pass, 0 fail (verified at generation). Reintroducing the bare `${sessionName}:${windowName}` target makes `isTmuxWindowPresent does not prefix-match a sibling window` fail with `true !== false` (verified red→green during Step 5).
- **Repeatable Unit Test**: Created: `host-server/state.test.ts`
- **Unit Test Command**: `cd host-server && npx tsx --test state.test.ts`
- [x] Pass <!-- 2026-09-19 -->
  - Evidence (auto): via unit test `host-server/state.test.ts` — 22 tests, 22 pass, 0 fail; block `tmux exact-match window targets (TASK-0182)` ran all 5 cases.

### UAT-EDGE-002: Bash regression script confirms `:=` resolves exactly and does not prefix-match
- **Scenario**: In a throwaway tmux session with a single window `foo-copy`, `has-session -t "$S:=foo-copy"` succeeds, `"$S:=foo"` fails, and (informationally) the bare `"$S:foo"` prefix-matches — documenting the hazard the task fixes.
- **Steps**:
  1. Run the script below (creates a unique `tc-verify-exact-*` session and removes it via `trap`).
  2. Confirm the last line is `PASS — exact-match window targets (TASK-0182) verified` and the exit code is 0.
- **Command**:
  ```bash
  bash scripts/verify-exact-window-targets.sh
  ```
- **Expected Result**: exit 0; output contains `ok: '<S>:=foo-copy' resolves (exact name)`, `ok: '<S>:=foo' does not resolve (no prefix match)`, `hazard confirmed: bare '<S>:foo' DOES prefix-match 'foo-copy'` (that line is informational — a future tmux that stops prefix-matching would print a note instead, not fail), then `PASS`. Verified at generation. No `tc-*` session remains afterwards (`tmux list-sessions`).
- **Repeatable Unit Test**: Not applicable: exercises real tmux + a bash script; it is itself the repeatable check.
- [x] Pass <!-- 2026-09-19 -->
  - Evidence (auto): `bash scripts/verify-exact-window-targets.sh` exited 0 with `ok: '<S>:=foo-copy' resolves (exact name)`, `ok: '<S>:=foo' does not resolve (no prefix match)`, `hazard confirmed: bare '<S>:foo' DOES prefix-match 'foo-copy'`, `PASS — exact-match window targets (TASK-0182) verified`; afterwards `tmux list-sessions` shows only `conductor` (no `tc-*` leftover).

### UAT-EDGE-003: Edited scripts parse and no bare window target remains
- **Scenario**: Every script edited for TASK-0182 is syntactically valid, and the window targets in them use the exact-match `:=` form.
- **Steps**:
  1. Run `bash -n` on all edited scripts plus dispatch.sh and the new verify script.
  2. Using Serena `search_for_pattern` (multiline off) for `SESSION_NAME[}"]*:\$` and `SESSION_NAME:[a-z_]` in `scripts/*.sh` (excluding `verify-*.sh`), confirm zero hits; and for `sessionName\}:\$\{` / `conf\.sessionName\}:\$\{` in `host-server/*.ts` (excluding tests), confirm zero hits.
- **Command**:
  ```bash
  bash -n scripts/monitor.sh scripts/broadcast.sh scripts/teardown.sh scripts/conductor.sh scripts/dispatch.sh scripts/verify-exact-window-targets.sh
  ```
- **Expected Result**: `bash -n` prints nothing and exits 0; the Serena searches return no matches. The only remaining `${sessionName}:=${windowName}` text is inside `windowTarget` itself in `host-server/state.ts`.
- **Repeatable Unit Test**: Not applicable: static syntax/pattern audit of shell scripts.
- [x] Pass <!-- 2026-09-19 -->
  - Evidence (auto): `bash -n` on the 6 scripts exited 0 with no output. Serena search of `scripts/` for `SESSION_NAME.{0,3}:` lists only `:=` window targets (conductor.sh 66/84/95/96/103, broadcast.sh 25, teardown.sh 27/33, monitor.sh 505/572, README.md 122) plus `CONDUCTOR_SESSION_NAME:-` expansions; zero bare `SESSION_NAME:$x`. Search of `host-server/` for `sessionName\}:` returns only `state.ts:60` (`windowTarget` itself).

### UAT-API-001: An inactive agent whose window name prefixes a live window reports NO window (tail endpoint)
- **Endpoint**: `GET /api/agents/:id/tail?lines=5`
- **Description**: Route `api.get('/agents/:id/tail')` (`host-server/index.ts`) calls `isTmuxWindowPresent(conf.sessionName, agentWindowName(entry))`; when false it replies `{ agent, agentId, lines, windowPresent: false, text: '' }`. Before the fix agent 29 resolved to its clone `…-3-copy` (`windowPresent: true`, copy's text).
- **Steps**:
  1. Prerequisite restart done (`make dev`).
  2. Run the curl below for agent 29 (dead `tmux-conductor-3`).
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/agents/29/tail?lines=5' | jq -c '{agent,agentId,windowPresent,text}'
  ```
- **Expected Result**: `{"agent":"tmux-conductor-3","agentId":29,"windowPresent":false,"text":""}`. `text` must be the empty string — it must NOT contain the clone's terminal output.
- **Repeatable Unit Test**: Not applicable: real HTTP route + live tmux state; the underlying guard is covered by UAT-EDGE-001.
- [x] Pass <!-- 2026-09-19 -->
  - Evidence (auto): `{"agent":"tmux-conductor-3","agentId":29,"windowPresent":false,"text":""}` — exact expected body; `text` empty (no clone output). Server confirmed restarted (pid 39506, started 01:11:13, after the last source edit at 01:04:46).

### UAT-API-002: Direct-input keys to an inactive agent are rejected and never reach its clone
- **Endpoint**: `POST /api/agents/:id/keys`
- **Description**: `sendDirectInput` (`host-server/index.ts`) throws `agent window not present` when `isTmuxWindowPresent` is false; the route maps that message to HTTP 409 (`message.includes('window not present')`). Before the fix the guard passed on the prefix match and the keystroke was typed into `…-3-copy`'s pane. The probe key `C-l` (a redraw — valid under `TMUX_KEY_RE` `C-[a-z]`) is deliberately low-harm in case of regression.
- **Steps**:
  1. Run only **after** UAT-API-001 passed (server restarted with the fix).
  2. Run the curl below for agent 29.
  3. Look at the clone's pane (tmux window `tmux-conductor-tmux-conductor-3-copy`) — it must show no sign of the keystroke (no redraw/clear).
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/agents/29/keys' -H 'Content-Type: application/json' -d '{"keys":["C-l"]}'
  ```
- **Expected Result**: HTTP 409 with body `{"error":"agent window not present"}`; nothing is sent to the clone's pane.
- **Repeatable Unit Test**: Not applicable: needs the live route, live tmux state, and a human/agent glance at another pane; the guard itself is covered by UAT-EDGE-001.
- [x] Pass <!-- 2026-09-19 -->
  - Evidence (auto): `HTTP/1.1 409 Conflict`, body `{"error":"agent window not present"}` (run with `-i` to capture the status line). `sendDirectInput` throws `agent window not present` at its `isTmuxWindowPresent` guard before any `send-keys` call, so nothing can have been sent to the clone by construction; the "no visible effect on the clone's pane" clause is not independently machine-checkable and is covered by that code path.

### UAT-API-003: Exact-name agents still resolve (regression control)
- **Endpoint**: `GET /api/agents/:id/tail?lines=5`
- **Description**: Switching to `session:=window` must not break agents whose window name matches exactly — including the clone itself and an agent with no prefix siblings.
- **Steps**:
  1. Run the curl below for agent 32 (`tmux-conductor-frontend-1`, live, exact-name window).
  2. Run it again for agent 31 (`tmux-conductor-3-copy`, live clone) by replacing `32` with `31`.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/agents/32/tail?lines=5' | jq -c '{agent,agentId,windowPresent,textLen:(.text|length)}'
  ```
- **Expected Result**: for id 32 and id 31: `windowPresent: true` and `textLen` > 0 (their real pane text). For agent 15 (`tmux-conductor-2`, no window, no sibling) the same call returns `windowPresent: false`, unchanged from before the fix.
- **Repeatable Unit Test**: Not applicable: live-server regression control; `isTmuxWindowPresent(name, 'foo-copy') === true` (exact hit) is already asserted in UAT-EDGE-001's unit test.
- [x] Pass <!-- 2026-09-19 -->
  - Evidence (auto): id 32 → `{"agent":"tmux-conductor-frontend-1","agentId":32,"windowPresent":true,"textLen":373}`; id 31 → `{"agent":"tmux-conductor-3-copy","agentId":31,"windowPresent":true,"textLen":373}`; id 15 → `{"agent":"tmux-conductor-2","agentId":15,"windowPresent":false,"textLen":0}` (unchanged from pre-fix).

### UAT-UI-001: Dashboard shows "Window not present." for the inactive agent, and the clone still shows its own terminal
- **Page**: `http://localhost:4321/` → Agents (sidebar + detail pane)
- **Description**: `LogTail.tsx` renders `Window not present.` when the tail/WebSocket payload has `windowPresent: false`. Before the fix agent 29's pane rendered the clone's live terminal next to a NO WINDOW badge (the reported bug, screenshot 12.50.14 AM).
- **Steps**:
  1. Prerequisite restart done. Open the dashboard Agents page; enable the sidebar "Show inactive" checkbox if the inactive agent is hidden.
  2. Click agent `tmux-conductor-3` (project `tmux-conductor`, badge NO WINDOW) → open the **Terminal** tab.
  3. Observe the terminal area.
  4. Click `tmux-conductor-3-copy` and observe its Terminal tab.
  5. Click `tmux-conductor-2` (no window, no clone) and observe its Terminal tab.
- **Expected Result**: step 3 shows the italic line "Window not present." and **no** terminal output/cursor from the clone; step 4 shows the clone's live terminal; step 5 shows "Window not present." (unchanged). The NO WINDOW badge and the pane text now agree for every inactive agent.
- **Repeatable Unit Test**: Not applicable: browser rendering of live agent state.
- [SKIP: skipped by user — dashboard visual check not performed; the API behind it is verified by UAT-API-001] <!-- 2026-09-19 -->
  - Supporting evidence (not a verdict): the API behind this pane now returns `windowPresent:false` for agent 29 (UAT-API-001), which is what drives the "Window not present." text in `LogTail.tsx`.

---

## Notes / not covered live

- Stop (`kill-window`), Delete, rename and the image-upload `send-keys` all use the same exact-match `windowTarget` + `isTmuxWindowPresent` guard as UAT-API-001/002. They are **deliberately not driven live**: before the fix a Stop/Delete on agent 29 would have killed the running clone. UAT-EDGE-001 covers the guard at unit level.
- The `terminal-loop`/`focused-terminal-loop` clear-once behavior (one empty-text `terminal-output` SSE broadcast when an agent's window vanishes) has no cheap deterministic test; it is observable in UAT-UI-001 as the terminal clearing rather than showing stale text. Note: TASK-0182 Step 3 found both loops already filtered on the exact window inventory, correcting the original research's claim that they captured every agent unguarded.
- Cosmetic, accepted: `monitor.sh` debug lines and `dispatch.sh`/`broadcast.sh` messages now print targets as `conductor:=win`.
