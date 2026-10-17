---
id: TASK-0182
aliases: [TASK-0182]
title: "Address tmux windows with exact-match `=` targets (inactive agent shows/acts on its `-copy` sibling's pane)"
status: done
created: 2026-09-19
updated: 2026-09-19
depends_on: []
blocks: []
parallel_safe_with: [TASK-0180]
uat: "[[UAT-0182]]"
tags: [bug, tmux, host-server, scripts, data-loss-risk]
---

# TASK-0182 — Address tmux windows with exact-match `=` targets

relates_to::[[inactive-agent-shows-other-agents-window]]
relates_to::[[tmux-window-target-prefix-matching]]

## Objective

Stop tmux's prefix-matching window resolution from routing an agent whose window is gone to a live sibling whose name it prefixes (e.g. `tmux-conductor-tmux-conductor-3` → running `tmux-conductor-tmux-conductor-3-copy`). Today the dashboard shows NO WINDOW next to the clone's live terminal, and Interact keys, image upload, Stop/Delete (`kill-window`), rename, queue dispatch and `monitor.sh` guards on the inactive agent can act on — or kill — the clone. Fix by addressing every window with tmux's exact-match form `session:=window` through one helper (TS) and the equivalent quoting in the bash scripts, and lock it with regression tests.

## Approach

Root cause and live verification (tmux 3.7c): `-t sess:win` resolves exact name → unique prefix → fnmatch; `sess:=win` is exact-only. See `raw/research/inactive-agent-shows-other-agents-window/index.md`. Chosen fix: **Option A** from that report — a single `windowTarget(sessionName, windowName)` helper returning `` `${sessionName}:=${windowName}` ``, applied to every read and write target; `isTmuxWindowPresent` becomes exact as a side effect, so every existing presence guard is repaired at once. Window ids (`@N`) are deliberately out of scope (only needed if duplicate window names must be tolerated; `windowState` already refuses duplicates). tmux `=` requires ≥ 2.1; the project requires ≥ 3.0.

Do **not** change `-t "$SESSION_NAME"` (session-only) targets, `new-window -t sessionName`, or the `list-windows -t sessionName` inventory calls — those address the session, not a window. `send-keys -t "$SESSION_NAME:monitor"` style fixed-name targets should also use `=` for consistency.

Host-server and script line numbers below are as of 2026-09-19 and will drift (TASK-0180 is editing `host-server/index.ts` concurrently) — locate by symbol/pattern (`grep`-equivalent via Serena `search_for_pattern` on `\$\{sessionName\}:`), not by line number.

## Steps

### 1. Add the `windowTarget` helper and fix `state.ts`  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-19 06:00 — step 1 done; tsc clean; state.test.ts 17/17 via `npx tsx --test` -->

- [x] In `host-server/state.ts`, add and export:
  ```ts
  /** Exact-match tmux window target. Bare `sess:win` PREFIX-matches (e.g. `foo` → `foo-copy`); `=` forbids that. */
  export function windowTarget(sessionName: string, windowName: string): string {
    return `${sessionName}:=${windowName}`;
  }
  ```
- [x] Replace every `` `${sessionName}:${windowName}` `` in `state.ts` with `windowTarget(sessionName, windowName)`: `capturePaneTail` (`-t` at ~line 64), `capturePaneTailRaw` (`const target`, ~83), `resizeAllWindows`' `resize-window` (~218), `isPaneDead`'s `display-message` (~282), `isTmuxWindowPresent`'s `has-session` (~481), and `sendTextToPane`'s `const target` (~519).
- [x] Update `isTmuxWindowPresent`'s JSDoc to say it is an exact-name check.
- [x] Leave `readTmuxWindowInventory` and `windowState`'s `list-windows -t sessionName` calls unchanged (session-only).

### 2. Replace the inline targets in `host-server/index.ts`  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-19 06:05 — step 2 done; tsc clean; npm test 164/164 -->

- [x] Import `windowTarget` from `./state.js` (match the file's existing import style/extension).
- [x] Replace each `` `${sessionName}:${…}` `` window target with `windowTarget(sessionName, …)`. Sites (find with `search_for_pattern` `\$\{sessionName\}:` and `\$\{sessionName\}:\$\{`; also `conf.sessionName`):
  - `spawnAgentWindow`: `const target` (~266) — the post-`new-window` `send-keys`/`pipe-pane` target.
  - monitor bootstrap `send-keys -t …:monitor` (~125).
  - `sendDirectInput`: `const target` (~613).
  - wake/respawn `kill-window` (~1128), mode-switch `BTab` `send-keys` (~1234), agent Stop `kill-window` (~1282), upload `send-keys` (~1363), agent delete `execSync` `kill-window` (~1390), agent rename `rename-window` (~1480).
  - bg-process routes: create `send-keys`+`pipe-pane` (~1933-1934), delete `kill-window` (~1995), start `send-keys`+`pipe-pane` (~2028-2029), stop `kill-window` (~2051).
- [x] (execSync sites kept as execSync with `windowTarget(...)` interpolated in place; existing quoting unchanged) The `execSync` template-string commands (`tmux kill-window -t ${…}`, `tmux send-keys -t …`, `tmux pipe-pane -t …`) build a shell string — the `=` is safe unquoted, but keep the existing quoting; do **not** widen the shell-interpolation surface. Prefer converting the `execSync` window-target sites to `spawnSync('tmux', [...])` argv form where the edit is trivial and behavior-identical; otherwise interpolate `windowTarget(...)` directly.
- [x] Double-check no `${sessionName}:${…}` window target remains afterwards: re-run the search and confirm zero hits outside comments/tests.

### 3. Stop capturing panes for windowless agents in the terminal loops  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-19 06:10 — step 3 done; tsc clean; npm test 164/164 -->

- [x] (CORRECTION found in step 3: both loops ALREADY filtered on the exact `readTmuxWindowInventory` and skipped on timeout; the change added is a one-time empty-text clear broadcast for agents whose window vanished) In `host-server/index.ts`, the `terminal-loop` (~2708-2714) and `focused-terminal-loop` (~2737-2743) call `capturePaneTail`/`capturePaneTailRaw` for every agent with no presence check. Reuse the exact window inventory already read for the tick (or one `readTmuxWindowInventory(sessionName)` call per loop iteration) and `continue` for agents whose `agentWindowName(a)` is not in it; when a window disappears, broadcast the same empty-text payload the existing not-present path uses so the frontend clears the terminal (mirror the `windowPresent: false, text: ''` shape at ~1587/1712). Do not add a per-agent tmux call — the inventory is one call.
- [x] Confirm the `extractPaneLabel(text)` label update (~2714/2743) is skipped for windowless agents so the clone's label can never be assigned to the inactive agent.
- [x] The two duplicated wrappers `capturePaneTail`/`capturePaneTailRaw` in `index.ts` (~477, ~543) just add instrumentation around the `state.ts` implementations; leave them, but confirm they call the `state.ts` functions (which now use `windowTarget`) and add no target of their own.

### 4. Fix the bash scripts  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-19 06:15 — step 4 done; bash -n clean. Cosmetic: debug/echo lines now show `conductor:=win`; `verify-sqlite-migration.sh` (~502/519) left bare (own throwaway session) -->

- [x] `scripts/monitor.sh`: `target="$SESSION_NAME:$window_name"` (~505) → `target="$SESSION_NAME:=$window_name"`; `bg_target="$SESSION_NAME:$bg_name"` (~572) → `"$SESSION_NAME:=$bg_name"`. Confirm every downstream use of `$target` (`has-session`, `capture-pane`, `display-message`, `dispatch.sh "$target"`) is agnostic to the `=`; check the `is_idle()`/`tmux display-message -p -t "$target"` helpers around lines 172-178 and the `$1` capture helper at ~178.
- [x] `scripts/broadcast.sh` (~25): `target="$SESSION_NAME:$name"` → `"$SESSION_NAME:=$name"`.
- [x] `scripts/teardown.sh`: `dispatch.sh "$SESSION_NAME:$window_name" "/exit"` (~27) and `send-keys -t "$SESSION_NAME:$name" C-c` (~33) → `:=`.
- [x] `scripts/conductor.sh`: `send-keys -t "$SESSION_NAME:$window_name"` (~66, ~84), `"$SESSION_NAME:$name"` (~95, ~96 incl. `pipe-pane`), `"$SESSION_NAME:monitor"` (~103) → `:=`.
- [x] `scripts/spawn.sh` (session-only `-t "$SESSION_NAME"` targets, pane-split layout) — leave unchanged; confirm and note it in the task's completion notes.
- [x] `scripts/dispatch.sh` takes `$TARGET` from its caller — verify it needs no change (it passes `-t "$TARGET"` verbatim).
- [x] Update `scripts/README.md` line ~122 (`tmux has-session -t "$SESSION_NAME:$bg_name"`) to the `:=` form.
- [x] Sanity check syntax: `bash -n scripts/monitor.sh scripts/broadcast.sh scripts/teardown.sh scripts/conductor.sh`.

### 5. Regression tests  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-19 06:20 — step 5 done -->

- [x] In `host-server/state.test.ts`, add a `describe('tmux exact-match window targets (TASK-0182)')` block:
  - Unit: `windowTarget('s', 'foo')` === `'s:=foo'`.
  - Integration (skip with `it.skipIf(!tmuxAvailable)` when `tmux -V` fails): create a throwaway session (unique name, e.g. `tc-test-<pid>-<Date.now()>`) with `tmux new-session -d -s <name> -n foo-copy`, then assert `isTmuxWindowPresent(name, 'foo-copy') === true`, `isTmuxWindowPresent(name, 'foo') === false` (this is the failing-before-fix case), `capturePaneTail(name, 'foo', 5) === ''`, and `capturePaneTail(name, 'foo-copy', 5)` does not throw. Always kill the session in `afterAll`/`finally`. Any files go under `./tmp/`, never `/tmp`.
- [x] (written + `bash -n` clean; execution is [DEFERRED-TO-UAT]. The bare-target check is informational/non-fatal by design so a future tmux that stops prefix-matching doesn't break it.) Add a bash regression check `scripts/verify-exact-window-targets.sh` following the existing `scripts/verify-*.sh` conventions (look at `verify-teardown-window-mapping.sh` for the harness style): throwaway session with windows `foo-copy`, assert `tmux has-session -t "$S:=foo"` fails while `"$S:=foo-copy"` succeeds and bare `"$S:foo"` still (demonstrably) succeeds, killing the session on exit via `trap`.
- [x] (red→green proven: with bare target the `isTmuxWindowPresent` sibling assertion failed `true !== false`; restored, state.test.ts 22/22, npm test 169/169, tsc clean. The `capturePaneTail(...) === ''` assertion is weak — a fresh pane is blank either way; `isTmuxWindowPresent` is the real guard.) Run the state tests (NOTE from Step 1: `host-server/state.test.ts` uses `node:test`, not vitest — run `cd host-server && npx tsx --test state.test.ts`, or the package's `npm test`); ensure the new integration test fails when `windowTarget` is temporarily reverted to the bare form (verify once, then restore).

### 6. Verify  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-19 06:25 — step 6 static gates done; live checks deferred to UAT -->

- [x] (static half done: host-server + frontend tsc exit 0, host-server npm test 169/169, `bash -n` clean on all edited scripts, no bare targets remain. Executing `verify-exact-window-targets.sh` is [DEFERRED-TO-UAT].) `cd host-server && npx tsc --noEmit` clean; `cd host-server && npm test` (full suite) passes; run `scripts/verify-exact-window-targets.sh` and any existing `scripts/verify-*.sh` that touch the edited scripts (`verify-teardown-window-mapping.sh`).
- [DEFERRED-TO-UAT] Live check (host-server dev server hot-reloads): with `tmux-conductor-3` stopped and `…-3-copy` running, the dashboard's `tmux-conductor-3` detail pane shows "Window not present." (not the copy's terminal), and `POST /api/agents/<id>/keys` on it returns 409 `agent window not present` without typing into the copy. Do **not** click Stop/Delete against a live clone to test — check via the presence route responses only.
- [x] Note in the completion summary that window names containing `:` or `.` remain unaddressable (pre-existing, out of scope), and that duplicate names are still refused by `windowState`.
