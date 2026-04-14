# UAT: Fix `is_idle` / `IDLE_PATTERN` for Claude Code v2.x

> **Source task**: [`.docs/tasks/active/004-idle-detection-fix.md`](../../tasks/active/004-idle-detection-fix.md)
> **Generated**: 2026-04-14

This task fixes shell-script idle detection in `monitor.sh` + `conductor.conf`. There is no HTTP API or web UI — tests exercise shell behavior directly (fixture replay) and live tmux dispatch. Test sections below are adapted to that reality: "Behavioral Tests" replace API tests, "Integration Tests" cover live dispatch.

---

## Prerequisites

- [x] Working directory is the repo root: `/Users/davidtaylor/Repositories/tmux-conductor`
- [x] Step-1 fixture files exist at `./tmp/pane-clean.txt`, `./tmp/pane-plan.txt`, `./tmp/pane-busy.txt` (created during `/tackle` Step 1). If missing, recapture per task Step 1.
- [x] Live `conductor` tmux session with a `jobfinder` window running Claude Code v2.x (only required for UAT-INT-001)
- [x] `bash` 4+ available on PATH (macOS: `brew install bash` — the system `/bin/bash` 3.2 also works for these tests)

---

## Behavioral Tests (shell)

### UAT-BEH-001: `monitor.sh` parses cleanly
- **Description**: Confirms the patched `is_idle()` didn't introduce a shell syntax error.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  bash -n monitor.sh && echo OK
  ```
- **Expected Result**: Single line `OK`. Any other output (especially lines containing `syntax error`) is a failure.
- [x] Pass <!-- 2026-04-14 -->

### UAT-BEH-002: `conductor.conf` sources and exports the new `IDLE_PATTERN`
- **Description**: Confirms `IDLE_PATTERN` is syntactically valid when shell-sourced and holds the footer-based pattern.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  bash -c 'source conductor.conf && printf "%s\n" "$IDLE_PATTERN"'
  ```
- **Expected Result**: Exactly `\?[[:space:]]+for[[:space:]]+shortcuts|(accept edits|bypass permissions) on`
- [x] Pass <!-- 2026-04-14 -->

### UAT-BEH-003: Clean-prompt fixture classifies as IDLE
- **Description**: Replays the captured clean-prompt pane state (`? for shortcuts` footer) through the same pipeline `is_idle()` uses and asserts it matches.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  bash -c 'source conductor.conf && cat ./tmp/pane-clean.txt | grep -v "^[[:space:]]*$" | tail -5 | grep -qE "$IDLE_PATTERN" && echo IDLE || echo BUSY'
  ```
- **Expected Result**: `IDLE`
- [x] Pass <!-- 2026-04-14 -->

### UAT-BEH-004: Plan-mode fixture classifies as BUSY
- **Description**: Replays the captured plan-mode pane state (`⏸ plan mode on (shift+tab to cycle)` footer) and asserts it does NOT match the idle pattern. Plan mode must stay BUSY so the conductor doesn't clobber a pending plan approval.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  bash -c 'source conductor.conf && cat ./tmp/pane-plan.txt | grep -v "^[[:space:]]*$" | tail -5 | grep -qE "$IDLE_PATTERN" && echo IDLE || echo BUSY'
  ```
- **Expected Result**: `BUSY`
- [x] Pass <!-- 2026-04-14 -->

### UAT-BEH-005: Mid-task fixture classifies as BUSY
- **Description**: Replays the captured actively-running pane state (`esc to interrupt` footer, spinner above) and asserts it does NOT match.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  bash -c 'source conductor.conf && cat ./tmp/pane-busy.txt | grep -v "^[[:space:]]*$" | tail -5 | grep -qE "$IDLE_PATTERN" && echo IDLE || echo BUSY'
  ```
- **Expected Result**: `BUSY`
- [x] Pass <!-- 2026-04-14 -->

### UAT-BEH-006: Blank-line stripping actually fires
- **Description**: Sanity-check that the `grep -v '^[[:space:]]*$'` filter added in Step 2 removes the trailing blank padding Claude Code leaves below the prompt. If the filter were a no-op, `tail -5` on the clean fixture would return five blank lines and nothing would match.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  bash -c 'printf "filtered=%d total=%d\n" "$(grep -v "^[[:space:]]*$" ./tmp/pane-clean.txt | wc -l)" "$(wc -l < ./tmp/pane-clean.txt)"'
  ```
- **Expected Result**: `filtered=<N>  total=<M>` where `N < M` (more total lines than filtered lines — confirms blank stripping removes at least one line).
- [x] Pass <!-- 2026-04-14 -->

---

## Edge Case Tests

### UAT-EDGE-001: Synthetic `accept edits on` footer reads as IDLE
- **Scenario**: Per the project's workflow, `⏵⏵ accept edits on (shift+tab to cycle)` is still a user-waiting / ready-for-input state and must read as IDLE. No live fixture was captured for this mode, so the test synthesizes the footer.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  bash -c 'source conductor.conf && printf "  \xE2\x8F\xB5\xE2\x8F\xB5 accept edits on (shift+tab to cycle)\n" | grep -qE "$IDLE_PATTERN" && echo IDLE || echo BUSY'
  ```
- **Expected Result**: `IDLE`
- [x] Pass <!-- 2026-04-14 -->

### UAT-EDGE-002: Synthetic `bypass permissions on` footer reads as IDLE
- **Scenario**: This is the default footer for the `jobfinder` agent (runs with `--dangerously-skip-permissions` in a dev container per `conductor.conf` line 16). The idle check must accept it, or end-to-end dispatch will never fire in the real workflow.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  bash -c 'source conductor.conf && printf "  \xE2\x8F\xB5\xE2\x8F\xB5 bypass permissions on (shift+tab to cycle)\n" | grep -qE "$IDLE_PATTERN" && echo IDLE || echo BUSY'
  ```
- **Expected Result**: `IDLE`
- [x] Pass <!-- 2026-04-14 -->

### UAT-EDGE-003: Synthetic `plan mode on` footer reads as BUSY
- **Scenario**: Explicit negative test — plan mode footer must never match the idle pattern, even with surrounding whitespace.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  bash -c 'source conductor.conf && printf "  \xE2\x8F\xB8 plan mode on (shift+tab to cycle)\n" | grep -qE "$IDLE_PATTERN" && echo IDLE || echo BUSY'
  ```
- **Expected Result**: `BUSY`
- [x] Pass <!-- 2026-04-14 -->

### UAT-EDGE-004: `? for shortcuts` with leading whitespace variations still matches
- **Scenario**: tmux `capture-pane` output can vary in leading-space count depending on pane width. The pattern uses `[[:space:]]+` (one-or-more) between `?` and `for`; there's no leading anchor. Confirm it still matches regardless of indent.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  bash -c 'source conductor.conf && for indent in "" " " "    " "\t"; do printf "%b? for shortcuts\n" "$indent" | grep -qE "$IDLE_PATTERN" && echo "indent=[$indent] IDLE" || echo "indent=[$indent] BUSY"; done'
  ```
- **Expected Result**: All four lines end in `IDLE`.
- [x] Pass <!-- 2026-04-14 -->

---

## Integration Tests

### UAT-INT-001: Live dispatch of a queued task to `jobfinder` (end-to-end)
- **Components**: `tasks.txt` (queue) → running `monitor.sh` → `is_idle(conductor:jobfinder)` → `dispatch.sh` → `tmux send-keys` → Claude Code pane
- **Flow**: A queued `jobfinder:`-scoped task should be popped and sent to the agent within one `POLL_INTERVAL` (15s) plus a few seconds of slack, once jobfinder is idle. Before this fix, it never fired because `is_idle` never returned true.
- **Prerequisites for this test only**:
  - `conductor` tmux session running with `jobfinder` window
  - `jobfinder` pane currently idle (footer reads `? for shortcuts` or `⏵⏵ bypass permissions on` — NOT `esc to interrupt` and NOT plan mode)
  - Any running `monitor.sh` has been restarted since `conductor.conf` was patched (old pattern lingers in the already-forked process environment). Verify with `pgrep -af monitor.sh` and check the process start time against `git log -1 --format=%cI conductor.conf`.
- **Steps**:
  1. Back up the live queue: `cp tasks.txt tasks.txt.bak 2>/dev/null || true`
  2. Write a single harmless test line: `printf 'jobfinder: /help\n' > tasks.txt`
  3. Ensure the monitor is running fresh: `pkill -f 'bash.*monitor.sh'; nohup ./monitor.sh >/dev/null 2>&1 &`
  4. Within ~20 seconds, watch for the dispatch. Tail the monitor log:
     ```bash
     tail -f ./logs/monitor.log
     ```
     (or the log path configured in `conductor.conf`; Ctrl-C once you see the dispatch line)
  5. Restore the original queue: `mv tasks.txt.bak tasks.txt 2>/dev/null || true`
- **Expected Result**:
  - Monitor log contains a line like `jobfinder — dispatching task: /help` (or the vendor's equivalent wording from `monitor.sh`)
  - `tasks.txt` is empty after dispatch (the line was popped)
  - `jobfinder` tmux pane shows the Claude Code `/help` output and returns to the `❯` prompt with an idle footer
- [ ] Pass

### UAT-INT-002: No stray `capture-pane` call sites broke
- **Description**: The Step-2 patch only touched `is_idle()`, but verify no other function in `monitor.sh` relied on the old blank-line-inclusive `capture-pane | tail -5` shape.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -nE 'capture-pane' monitor.sh
  ```
- **Expected Result**: Exactly one match, on the line inside `is_idle()` (currently `monitor.sh:65`). Any second match means another code path reads the pane and may need the same blank-stripping treatment.
- [ ] Pass

---

## Notes / Gaps

- **No API tests**: this task has no HTTP surface.
- **No UI tests**: this task has no browser surface.
- **No live `accept edits on` / `bypass permissions on` fixture**: Step 1 only captured clean / plan / busy. UAT-EDGE-001 and UAT-EDGE-002 synthesize the footer text with UTF-8 escapes instead. If a future regression is suspected, recapture live fixtures by toggling the mode with `shift+tab` in the pane.
- **Doc updates (task Steps 6–7)**: if the operator wants to assert CLAUDE.md / README.md reflect the new pattern, add a manual read-through during walkthrough — the tests here verify behavior, not docs.
