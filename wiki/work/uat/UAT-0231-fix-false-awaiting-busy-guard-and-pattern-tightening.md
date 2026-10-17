---
id: UAT-0231
aliases: [UAT-0231]
title: "UAT: Fix false 'awaiting' (BUG-0013): guard awaiting with the busy footer and tighten AWAITING_PATTERN in monitor.sh and state.ts"
status: pending
task: TASK-0231
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0231 — UAT: Fix false 'awaiting' (BUG-0013): busy-footer guard and AWAITING_PATTERN tightening

implements::[[TASK-0231]]

> **Source task**: [[TASK-0231]]
> **Generated**: 2026-09-20

---

## Prerequisites

- [ ] Repo checkout at the tmux-conductor root; Node.js >= 26 (`host-server/package.json` engines) with `host-server/node_modules` installed; tmux >= 3.0; bash.
- [ ] **Safety (generation and autonomous runs)**: none of the automated cases touch the live fleet. Do NOT kill/restart the live `monitor` tmux window or the live host-server, and do NOT send keys to any real agent pane. Cases `UAT-INT-002` and `UAT-INT-003` run against a **private tmux server** (`TMUX_TMPDIR=./tmp/uat-0231-live/tmux`, `TMUX`/`TMUX_PANE` unset by the harness so the live server is never addressed) and clean up with `kill-session` on that private socket only. Never `tmux kill-server` in this UAT.
- [ ] **Deploy requirement (manual cases only)**: `host-server/config.ts` caches `conductor.conf`, and `monitor.sh` is long-lived. The fix (the `conductor.conf` `AWAITING_PATTERN` edit, `state.ts`, `monitor.sh`) takes effect on the live system only after restarting the host-server AND the `monitor` tmux window. `UAT-MAN-001` and `UAT-MAN-002` require this restart and are `[DEFERRED-TO-UAT manual]`: an autonomous run must NOT perform them.
- [ ] **Gate scope**: this task's gate is the five commands under `UAT-EDGE-001`..`UAT-EDGE-006`, `UAT-INT-001` and `UAT-EDGE-008`. The full `npm test` has one known failure in `host-server/transitionsLog.test.ts` ("buildSnapshot captures reason/matchedPattern/tail15 ..."), a source-regex assertion against `host-server/index.ts`, a file this task does not touch and that other agents edit concurrently. It is recorded as pre-existing/unrelated in `UAT-EDGE-008` unless it is shown to be caused by this task.
- [ ] **Isolated harness for `UAT-INT-002`/`UAT-INT-003`** (create once; lives under gitignored `./tmp/`, re-create if `tmp/` was wiped):
  ```bash
  mkdir -p tmp/uat-0231-live && cat > tmp/uat-0231-live/detect.sh <<'EOF'
  #!/usr/bin/env bash
  # usage: detect.sh <fixture-basename> <busy|idle|awaiting|none> <claude|codex>
  set -euo pipefail
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  D="$ROOT/tmp/uat-0231-live"
  FIX="$1"; STATE="$2"; LAUNCH="$3"
  unset TMUX TMUX_PANE
  export TMUX_TMPDIR="$D/tmux"
  mkdir -p "$D/tmux" "$D/logs/state"
  sed -e 's/^SESSION_NAME=.*/SESSION_NAME="uat0231"/' "$ROOT/conductor.conf" > "$D/conductor.conf"
  rm -f "$D/logs/state/agent-x.state"
  [ "$STATE" = none ] || printf '%s' "$STATE" > "$D/logs/state/agent-x.state"
  cat > "$D/detect.mts" <<TS
  import { readConductorConf } from '$ROOT/host-server/config.ts';
  import { capturePaneTail, detectAgentStatus } from '$ROOT/host-server/state.ts';
  const conf = readConductorConf(process.env.CONDUCTOR_CONF);
  const tail = capturePaneTail(conf.sessionName, 'agent-x', 15);
  console.log(JSON.stringify(detectAgentStatus(conf, 'agent-x', '$LAUNCH', tail, true, '$LAUNCH')));
  TS
  tmux kill-session -t uat0231 2>/dev/null || true
  tmux new-session -d -s uat0231 -n agent-x -x 120 -y 30 "cat '$ROOT/host-server/fixtures/awaiting-panes/$FIX.txt'; sleep 300"
  sleep 1
  trap 'tmux kill-session -t uat0231 2>/dev/null || true' EXIT
  (cd "$ROOT/host-server" && CONDUCTOR_CONF="$D/conductor.conf" node --import tsx/esm "$D/detect.mts" | tail -1)
  EOF
  ```
  (The `EOF` and `TS` terminators and the body must start at column 0 when pasted; the indentation above is only markdown nesting.)

Source under test:
- `host-server/state.ts`: exported `awaitingWindow(tail)` (last 8 non-blank lines after dropping `^\s*❯\s+\S` draft lines), `matchesAwaiting`, and the `state === 'awaiting'` branch of `detectAgentStatus` (reverts to `busy` / `reason: 'state-file'` when the dialog is gone OR, for non-codex, `BUSY_PATTERN` is visible in the last 15 lines).
- `scripts/monitor.sh` `is_idle()` plus the new `awaiting_window` and `busy_visible` helpers (busy case, idle case, awaiting-revert case, regex fallback).
- `conductor.conf` `AWAITING_PATTERN`: the `>` alternative is now `^\s*>\s*$`.
- Shared fixtures: `host-server/fixtures/awaiting-panes/manifest.json` (14 cases: 6 awaiting, 6 not-awaiting, 2 codex) plus one `.txt` pane capture each.
- `scripts/verify-awaiting-detection.sh` (monitor.sh side), `scripts/report-false-awaiting.mjs` (measurement).

Coverage note: EDGE cases 001-006 are unit-backed by the file-scoped commands listed under each. INT-001 is a repeatable shell verifier (stubbed tmux). INT-002/003 are automated but use a private real tmux server. MAN cases are manual and deferred. DOC-001 is a static check.

---

## Test Cases

### UAT-EDGE-001: Genuine dialogs and prompts still read `awaiting` in state.ts (no regression)
- **Scenario**: The six BUG-0002/dialog fixtures with no busy footer must still classify as `awaiting`: AskUserQuestion dialog (`Enter to select · Tab/Arrow keys to navigate · Esc to cancel`), `[Y/n]` confirm, plan approval (`shift+tab to approve`), `Verdict? P/F/Fix/Skip` with an idle state file, multi-line `Pass / Fail / Fix now / Skip?` above the input box with an idle state file, and a bare `>` prompt line (regex fallback).
- **Steps**:
  1. Run the unit test command below from the repo root.
  2. Confirm every `awaiting-pane fixtures (TASK-0231)` case whose manifest `expected.state` is `awaiting` passes (`ask-user-question-dialog`, `yn-confirm-prompt`, `plan-approval-dialog`, `uat-verdict-idle-file`, `uat-pass-fail-multiline-idle-file`, `bare-gt-prompt`).
- **Expected Result**: Exit code 0, 0 failures across the whole file. Each of the six cases returns `state: awaiting` with `reason` `awaiting-pattern` (or `regex-fallback` for `bare-gt-prompt`).
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (describe `awaiting-pane fixtures (TASK-0231)`, driven by `host-server/fixtures/awaiting-panes/manifest.json`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts awaitingPattern.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-002: BUG-0013 false-positive panes no longer read `awaiting` in state.ts
- **Scenario**: Panes that previously tripped `AWAITING_PATTERN` while the agent was working or idle: busy file + `esc to interrupt` footer + assistant line `Verdicts (2–4)?` -> `busy`; busy file + footer + `### 1. Implement the fix <!-- agent: general-purpose -->` -> `busy`; idle file + `❯ still running?` typed draft -> `idle`; idle file + `❯ /research <topic or question to research>` -> `idle`; fresh busy file + `❯ /wiki-query <question>` and no busy footer -> `busy`.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the `busy-footer-verdicts-question-line`, `busy-footer-agent-comment-heading`, `idle-typed-question-input`, `idle-slash-command-template` and `busy-fresh-wiki-query-typed` cases pass.
- **Expected Result**: Exit code 0. None of the five cases returns `awaiting`; states are `busy`, `busy`, `idle`, `idle`, `busy` respectively, each with `reason: state-file`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (same describe block as EDGE-001)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts awaitingPattern.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-003: An `awaiting` state file is reverted to `busy` when the busy footer is visible; `awaitingWindow` drops `❯` draft lines
- **Scenario**: (a) `detectAgentStatus` with an `awaiting` state file and a pane that shows a `?` assistant line AND `esc to interrupt` returns `{state: busy, reason: state-file}` with no `matchedPattern` (reuses the existing "dialog gone" return; no new `DetectionReason`). (b) `awaitingWindow` removes blank lines and `❯ <text>` draft lines, keeps the last 8, and keeps a bare `❯` line.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the tests named `detectAgentStatus: awaiting state-file + busy footer + "?" line reverts to busy (BUG-0013 site 9 shape)` and `awaitingWindow drops ❯ draft lines and blank lines and keeps the last 8` pass.
- **Expected Result**: Exit code 0, both named tests pass.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts awaitingPattern.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-004: `AWAITING_PATTERN` `>` alternative matches only a bare `>` line; live conf value round-trips
- **Scenario**: The real `conductor.conf` pattern (read through `config.ts` and run through `grep -qE` exactly as `monitor.sh` and `state.ts` do) matches `>` and `  >  `, and does NOT match `### 1. Implement the fix <!-- agent: general-purpose -->`, `aider>`, `❯ /research <topic or question to research>`, or `foo <bar>`. It still matches every pre-existing documented case (`Rotate anyway?`, `Continue? [Y/n]`, `Verdict? P/F/Fix/Skip`, `Enter to select · Esc to cancel`, `ctrl+g to edit · shift+tab to approve`) and still rejects `myproject ?2 ~` and lowercase `esc to interrupt`.
- **Steps**: Run the unit test command below.
- **Expected Result**: Exit code 0, all 4 `AWAITING_PATTERN ...` tests in `awaitingPattern.test.ts` pass (this also proves `config.ts` loads the new `^\s*>\s*$` value from `conductor.conf`).
- **Repeatable Unit Test**: Created: `host-server/awaitingPattern.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test awaitingPattern.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-005: Codex is exempt from the new busy guard (non-regression)
- **Scenario**: A codex pane with `Running` in scrollback and an `Esc to cancel` confirm open, with an `awaiting` state file, stays `awaiting` in state.ts (reason `state-file`); a codex pane with a bare `>` idle prompt and no state file is `idle` via `regex-fallback`, not awaiting. Codex's awaiting pattern is unchanged.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm `codex-esc-to-cancel-confirm` (expects `awaiting`) and `codex-bare-gt-idle-prompt` (expects `idle`) pass.
- **Expected Result**: Exit code 0; both codex cases pass.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (fixtures `codex-esc-to-cancel-confirm`, `codex-bare-gt-idle-prompt`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts awaitingPattern.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-006: `scripts/report-false-awaiting.mjs` counts correctly, is read-only and validates its arguments
- **Scenario**: Against a hand-written JSONL under `./tmp/` (3 `to: awaiting` records, 1 non-awaiting record, 1 malformed line) the script reports total 3, no-dialog-marker 2 (66.7%), `esc to interrupt` visible 1 (33.3%), malformed 1, with the correct `from | reason` breakdown; `--since` excludes older records; the input file is byte- and mtime-identical after a run; a missing file exits 1; a bad `--since` value or unknown flag exits 2.
- **Steps**: Run the unit test command below.
- **Expected Result**: Exit code 0, 4 tests pass, and the `./tmp/report-false-awaiting-*` scratch directory is removed afterward.
- **Repeatable Unit Test**: Created: `host-server/reportFalseAwaiting.test.ts` (added by `/uat-generate`; sibling layout, same runner as the rest of `host-server/`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test reportFalseAwaiting.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-001: monitor.sh `is_idle()` classifies every shared fixture the same way as state.ts (dispatch-path parity)
- **Scenario**: `scripts/verify-awaiting-detection.sh` extracts the live `is_idle`, `agent_type`, `agent_*_pattern`, `pane_dead`, `pane_tail5`, `awaiting_window`, `busy_visible`, `launch_cmd_name` and `is_shell_cmd` from `scripts/monitor.sh`, stubs `tmux` on `PATH` (only `capture-pane`/`display-message` allowed), loads the literal patterns from `conductor.conf`, and runs all 14 manifest cases plus one guard assertion. Mapping: expected `awaiting` -> state file `awaiting` and return 1; `busy` -> state file not `awaiting` and return 1; `idle` -> return 0. The extractor used by the older `verify-transitions-jsonl-emit.sh` must still work after the `monitor.sh` edits, and `monitor.sh` must still parse.
- **Steps**:
  1. Run `bash scripts/verify-awaiting-detection.sh`.
  2. Run `bash scripts/verify-transitions-jsonl-emit.sh`.
  3. Run `bash -n scripts/monitor.sh`.
- **Command**:
  ```bash
  bash scripts/verify-awaiting-detection.sh
  ```
- **Expected Result**: `Passed: 15  Failed: 0` (14 fixture cases plus the "stub tmux saw only capture-pane/display-message" guard), exit 0. Step 2 prints `Passed: 10  Failed: 0`. Step 3 prints nothing and exits 0. Scratch files under `./tmp/` are cleaned on exit.
- **Repeatable Unit Test**: Created: `scripts/verify-awaiting-detection.sh` (repeatable shell verifier, not a node test)
- **Unit Test Command**: `bash scripts/verify-awaiting-detection.sh`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-002: Real tmux capture-pane — an `awaiting` state file with the busy footer visible reads `busy` (BUG-0013 site 9), on a private tmux server
- **Scenario**: Uses the real `capturePaneTail` (real `tmux capture-pane`) and the real `detectAgentStatus` with the real `conductor.conf` patterns, against a pane on an isolated tmux server. The pane shows the `awaiting-file-busy-footer-question-line` capture (a `?` assistant line plus `esc to interrupt`) while the state file says `awaiting`. This stands in for the live monitor-written `awaiting` file that BUG-0013 evidence showed lingering while the agent ran. It is not a substitute for `UAT-MAN-001` (the live monitor loop and hooks are not exercised).
- **Steps**:
  1. Create the isolated harness from Prerequisites if `tmp/uat-0231-live/detect.sh` is missing.
  2. Run the command below (it starts and kills only the `uat0231` session on the private server).
- **Command**:
  ```bash
  bash tmp/uat-0231-live/detect.sh awaiting-file-busy-footer-question-line awaiting claude
  ```
- **Expected Result**: Last stdout line is `{"state":"busy","reason":"state-file"}` (no `matchedPattern`). `tmux display-message -p '#{session_name}'` afterwards still names the live session (the live server was never addressed).
- **Repeatable Unit Test**: Not applicable: exercises the real tmux `capture-pane` boundary and a private tmux server; the pure-logic equivalent is `UAT-EDGE-003` (fixture-injected).
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-003: Real tmux capture-pane — a genuine AskUserQuestion dialog still reads `awaiting`; codex exemption holds; bare `>` fallback works, on a private tmux server
- **Scenario**: Same private-server harness as INT-002, three panes: (1) `ask-user-question-dialog` with a `busy` state file (dialog footer, no busy footer) must be `awaiting`; (2) `codex-esc-to-cancel-confirm` with an `awaiting` state file and launch `codex` must stay `awaiting` (Codex exempt from the busy guard); (3) `bare-gt-prompt` with no state file must be `awaiting` via the regex fallback; and the idle typed-draft pane (4) `idle-slash-command-template` with an `idle` file must remain `idle`.
- **Steps**:
  1. Create the isolated harness from Prerequisites if missing.
  2. Run the four commands below in order.
- **Command**:
  ```bash
  bash tmp/uat-0231-live/detect.sh ask-user-question-dialog busy claude && bash tmp/uat-0231-live/detect.sh codex-esc-to-cancel-confirm awaiting codex && bash tmp/uat-0231-live/detect.sh bare-gt-prompt none claude && bash tmp/uat-0231-live/detect.sh idle-slash-command-template idle claude
  ```
- **Expected Result**: Four JSON lines, in order: `{"state":"awaiting","reason":"awaiting-pattern","matchedPattern":"awaiting"}`, `{"state":"awaiting","reason":"state-file","matchedPattern":"awaiting"}`, `{"state":"awaiting","reason":"regex-fallback","matchedPattern":"awaiting"}`, `{"state":"idle","reason":"state-file","matchedPattern":"idle"}`.
- **Repeatable Unit Test**: Not applicable: real tmux boundary; the fixture-injected equivalents are `UAT-EDGE-001`, `UAT-EDGE-002` and `UAT-EDGE-005`.
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-007: Noted gap (pre-existing, out of scope): Codex with a `busy` state file — state.ts reports busy, monitor.sh would say awaiting
- **Scenario**: Documented divergence, recorded as a **noted gap, not a failure**. With a `busy` state file and the codex confirm pane (`Running` in scrollback plus `Esc to cancel`), `host-server/state.ts` returns `busy` (its unchanged busy-branch guard at `state.ts:436` sees Codex's broad busy pattern `Running`), whereas `monitor.sh`'s busy case would match the codex awaiting pattern and write `awaiting`. TASK-0231's Notes (Step 2 note) explicitly scopes this out; the Codex fixture therefore uses an `awaiting` state file. This case only checks the divergence is still exactly as documented and does not silently grow to Claude agents.
- **Steps**:
  1. Create the isolated harness from Prerequisites if missing.
  2. Run the command below.
  3. Record the outcome. Do NOT change `state.ts` or `monitor.sh` to "fix" it under this task; if it should be fixed, file a separate bug.
- **Command**:
  ```bash
  bash tmp/uat-0231-live/detect.sh codex-esc-to-cancel-confirm busy codex
  ```
- **Expected Result**: `{"state":"busy","reason":"state-file","matchedPattern":"busy"}` (the documented state.ts behavior for codex + `busy` file). Mark Pass when the output matches this description and the gap stays documented; a `busy` result here is not a regression of TASK-0231. A Claude-launch equivalent (`ask-user-question-dialog busy claude`, INT-003 step 1) must still be `awaiting`, proving the divergence is Codex-only.
- **Repeatable Unit Test**: Not applicable: records a known out-of-scope divergence rather than a requirement; asserting the current behavior in a unit test would enshrine it.
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-008: Task gate scope and the pre-existing `transitionsLog.test.ts` failure
- **Scenario**: The TASK-0231 gate is typecheck plus the task-owned test files. One failure exists in the wider suite: `host-server/transitionsLog.test.ts`, test "buildSnapshot captures reason/matchedPattern/tail15 into lastDetectionByAgentId right after the single per-agent capturePaneTail/detectAgentStatus call ...", a source-regex assertion against `host-server/index.ts`. TASK-0231 does not edit `index.ts` (other agents modify it concurrently), so the failure is recorded as **pre-existing/unrelated** unless it is shown to be caused by this task.
- **Steps**:
  1. Run `cd host-server && npx tsc --noEmit` (must be clean).
  2. Run the command below; expect exactly the one named failure in `transitionsLog.test.ts` and no failure in any TASK-0231 file (`state.test.ts`, `awaitingPattern.test.ts`, `reportFalseAwaiting.test.ts`).
  3. If the failing test's name or the failure count changes, or if the failure now points at `state.ts`/`monitor.sh`/`conductor.conf`, treat it as caused by this task and FAIL.
- **Command**:
  ```bash
  cd host-server && npx tsc --noEmit && node --import tsx/esm --test transitionsLog.test.ts
  ```
- **Expected Result**: `tsc` exits 0 with no output. The `transitionsLog.test.ts` run reports `pass 6` and `fail 1`, the one failure being the `buildSnapshot captures reason/matchedPattern/tail15 ...` test. Verdict Pass = failure is exactly that one and remains attributable to `index.ts` source text, not to this task. (Because the command chains with `&&`, the `node` test step's non-zero exit is the expected outcome; judge on the reported counts.)
- **Repeatable Unit Test**: Not applicable: a pre-existing, unrelated failing test is being tracked, not a new behavior of this task. The task-owned gates are the commands under EDGE-001..006.
- [x] Pass <!-- 2026-09-20 -->

### UAT-DOC-001: Documentation and wiki reflect the shipped behavior
- **Scenario**: Static check that the docs describe what shipped, not the old "last non-blank line" behavior.
- **Steps**:
  1. Read the "Waiting/stalled detection" bullet in `CLAUDE.md` (and the matching sentence in `AGENTS.md`): it must say the window is the last 8 non-blank lines, `❯ <draft>` lines are dropped, `>` means a line that is only `>` (`^\s*>\s*$`), the busy footer (`BUSY_PATTERN`, last 15 lines) suppresses the `?`/`>` heuristics and reverts an `awaiting` file to `busy` for non-Codex agents, Codex is exempt, and both implementations share `host-server/fixtures/awaiting-panes/manifest.json`.
  2. `scripts/README.md` lists `verify-awaiting-detection.sh`.
  3. `wiki/knowledge/concepts/agent-state-determination.md` has a `## BUG-0013 false-awaiting` section.
  4. The comment block above `AWAITING_PATTERN` in `conductor.conf` describes the 8-line window, the `❯` draft-line drop, the busy guard and the bare-`>` rule, and cites BUG-0013.
  5. `wiki/work/bugs/0013-agent-marked-waiting-while-thinking.md` frontmatter has `linked_task: "[[TASK-0231]]"` and its status/Resolution are still untouched (closing is `/bug-close BUG-0013`'s job).
- **Expected Result**: All five statements hold; the phrase "last non-blank pane line" no longer appears in `CLAUDE.md`, `AGENTS.md` or the two `state.ts` doc comments.
- **Repeatable Unit Test**: Not applicable: prose/documentation review.
- [FAIL: auto-judge: manual test requires human verification (static evidence gathered by auto run: all five statements hold and "last non-blank pane line" is absent from CLAUDE.md, AGENTS.md, host-server/*.ts, monitor.sh, conductor.conf)] <!-- 2026-09-20 -->

### UAT-MAN-001: Live verification — false-awaiting no longer fires on a running throwaway agent, and a real dialog still does `[DEFERRED-TO-UAT manual]`
- **Scenario**: Task Step 9 item 1. Requires the fix to be live, a throwaway agent, and a human at the dashboard. **An autonomous run (`/uat-auto`) must skip this case as manual; it must not restart anything.**
- **Steps**:
  1. Deploy: restart the host-server (its `conductor.conf` cache) AND the `monitor` tmux window, in that order, at a time when no real task is mid-dispatch. Note the restart timestamp (ISO) for `UAT-MAN-002`.
  2. Add a throwaway Claude agent (project workdir of your choice) via the dashboard, and let it reach `idle`.
  3. Queue or type a prompt whose visible output during the running turn includes a line ending in `?` and a line ending in `-->` (for example: "Print a line ending with a question mark and a line ending with an HTML comment close, then run `sleep 60`, then finish.").
  4. While the turn is running (spinner and `esc to interrupt` visible) watch the dashboard badge and run `tail -f logs/transitions.jsonl`.
  5. After the turn finishes, trigger a real AskUserQuestion dialog (for example ask the agent to use AskUserQuestion to ask you a choice) and watch the badge.
  6. Remove the throwaway agent.
- **Expected Result**: During step 4 the badge stays `busy` the whole time and `logs/transitions.jsonl` gains no record with `to: "awaiting"` for that agent. At step 5 the badge changes to `awaiting` ("waiting") with the Interact CTA, and a `to: "awaiting"` transition is logged for that agent whose `paneTail` contains `Enter to select`.
- **Repeatable Unit Test**: Not applicable: requires the live host-server, the live monitor window, Claude Code hooks and a running LLM agent; the deterministic core is covered by EDGE-001..005, INT-001..003.
- [ ] Pass

### UAT-MAN-002: Post-deploy measurement — false-awaiting share falls against the BUG-0013 baseline `[DEFERRED-TO-UAT manual]`
- **Scenario**: Task Step 9 item 2. Needs a day or two of normal use after the `UAT-MAN-001` restart. Baseline before the fix (2026-09-13..2026-09-20): 329 `awaiting` transitions, 178 (54%) with no dialog marker in the last 8 pane lines, 21 (6%) with `esc to interrupt` visible.
- **Steps**:
  1. After 1-2 days of normal use following the restart, run the command below, substituting the restart timestamp recorded in `UAT-MAN-001`.
  2. Record the printed numbers in BUG-0013's Resolution when running `/bug-close BUG-0013`.
- **Command**:
  ```bash
  node scripts/report-false-awaiting.mjs --since 2026-09-21T00:00:00Z
  ```
  (Replace `2026-09-21T00:00:00Z` with the real restart timestamp; read-only, writes nothing. Do not run this before the restart as a pass check: pre-restart records include the old false positives.)
- **Expected Result**: `'esc to interrupt' visible` is `0`, and the "No dialog marker" share is well below the 54% baseline. A non-zero busy-visible count after the restart means a code path still writes/reports `awaiting` while the spinner shows (investigate the `from | reason` breakdown and `logs/transitions.jsonl` `paneTail`); FAIL in that case.
- **Repeatable Unit Test**: Not applicable: depends on days of real production transition data.
- [ ] Pass
