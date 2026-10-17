---
id: TASK-0231
aliases: [TASK-0231]
title: "Fix false 'awaiting' (BUG-0013): guard awaiting with the busy footer and tighten AWAITING_PATTERN in monitor.sh and state.ts"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: []
blocks: []
parallel_safe_with: [TASK-0199, TASK-0221, TASK-0222]
uat: "[[UAT-0231]]"
tags: [bug-0013, status-detection, monitor, host-server, awaiting]
---

# TASK-0231 — Fix false 'awaiting' (BUG-0013): guard awaiting with the busy footer and tighten AWAITING_PATTERN in monitor.sh and state.ts

relates_to::[[BUG-0013]]
relates_to::[[agent-state-determination]]
relates_to::[[dispatch-path-parity]]

> Fixes [BUG-0013](../bugs/0013-agent-marked-waiting-while-thinking.md) (P0, critical, in-progress). Its `## Root Cause Analysis` has the evidence and file/line pointers; read it first. Closing the bug is `/bug-close BUG-0013`'s job once the fix commit and regression tests exist, not this task's. Overlaps files with `TASK-0191`, `TASK-0128` (both pending-uat, already implemented) and `TASK-133` (`monitor.sh` dispatch gating): do not edit `scripts/monitor.sh` concurrently with any of them.

## Objective

Stop the dashboard and the monitor from reporting an agent as `awaiting` (badge "waiting", Interact CTA, queue dispatch held back) when it is still working or when the only trigger is ordinary pane text. Evidence from `logs/transitions.jsonl` (2026-09-13 to 2026-09-20): 329 transitions into `awaiting`, 178 with no dialog footer in the last 8 pane lines, 21 with `esc to interrupt` visible (agent demonstrably running); genuine dialog transitions never showed `esc to interrupt` (0 of 148). The fix is approach B from triage: (1) never write or report `awaiting` while the busy footer is visible, in both `scripts/monitor.sh` and `host-server/state.ts`; (2) make `AWAITING_PATTERN`'s `>` alternative match a bare-prompt line only; (3) ignore Claude Code's `❯ <typed draft>` input lines when looking for `?`. Both implementations share one fixture set so they cannot drift.

## Approach

**Three defects, one fix each** (details and evidence in BUG-0013):

| Defect | Where | Fix |
|---|---|---|
| Awaiting checked without the busy guard | `scripts/monitor.sh` `is_idle()` busy case (~`:248-256`), idle case (~`:296-305`), awaiting-revert case (~`:316-330`); `host-server/state.ts` `state === 'awaiting'` branch (~`:473-480`) | If `BUSY_PATTERN` matches the last 15 non-blank lines, do not write/report awaiting; in the awaiting cases treat it as busy |
| `>\s*$` matches any line ending in `>` (`<!-- … -->`, `❯ /research <topic…>` hint placeholders) | `conductor.conf:100` | Change to `^\s*>\s*$` (a line that is only `>`) |
| User's typed `❯ …?` draft counts as a prompt | `matchesAwaiting` (`state.ts:428`) and monitor's `tail -8` windows | Drop lines matching `^\s*❯\s+\S` before windowing |

**Decisions made in planning**
- **Codex is exempt from the new busy guard.** Codex's busy pattern is broad (`[Ww]orking|[Tt]hinking|[Rr]unning|[Ee]xecuting|[Aa]pplying`) and can match scrollback while a real confirm dialog is open; suppressing awaiting there would regress it. The guard applies only when `agent_type` is not `codex` (monitor) / `type !== 'codex'` (state.ts). The host-server's existing busy-branch behavior (`state.ts:437`) is not changed.
- **No new return site in `detectAgentStatus`.** The awaiting-branch guard reuses the existing "dialog gone → busy" return (site 9, `{state:'busy', reason:'state-file'}`), so the 18-site matrix in `state.test.ts` and `DetectionReason` stay unchanged.
- **Window = last 8 non-blank lines after dropping draft lines**, matching `conductor.conf`'s comment. The docs currently say "last non-blank line" (CLAUDE.md, `state.ts:370`, `state.ts:438`); those are corrected, not the behavior.
- **Regex-fallback path** (`monitor.sh` ~`:339-359`) already checks busy before awaiting; it only switches from `pane_tail5` to the shared 8-line window so both implementations agree.
- **Known non-goals:** `⎿ Interrupted · What should Claude do instead?` still counts as awaiting (a real wait for the user); the multi-line `?` prompts BUG-0002 needed (`Verdict? P/F/Fix/Skip`, `Pass / Fail / Fix now / Skip?`) must keep working, so the `?` alternatives keep the 8-line window.
- **Deploy note:** `host-server/config.ts` caches `conductor.conf`; restart the host-server after the conf edit, and restart the `monitor` window (it is long-lived) for `monitor.sh` changes.

## Steps

### 1. Confirm inputs and line numbers  <!-- agent: Explore -->

- [x] Re-read `scripts/monitor.sh` `is_idle()` and the helpers it calls (`agent_type`, `agent_awaiting_pattern`, `agent_busy_pattern`, `pane_dead`, `pane_tail5`) and `host-server/state.ts` `detectAgentStatus`/`matchesAwaiting`, and record current line numbers in this task's Notes (BUG-0013's numbers were taken on 2026-09-20 and may drift)
- [x] Search the repo (Serena `search_for_pattern`, include `conductor.conf`, `*.md`, `scripts/`, `install.sh`, any `conductor.conf.example`) for other copies of the pattern text `>\s*$` / `AWAITING_PATTERN=` and list every place that must change; record whether any supported agent (Aider, `custom`) relies on `>\s*$` matching a non-bare line such as `aider>` (the conf only lists it as an IDLE example, so expect none) and note the finding

### 2. Shared fixtures  <!-- agent: general-purpose -->

- [x] Create `host-server/fixtures/awaiting-panes/manifest.json`: an array of `{ "name", "launch": "claude"|"codex", "stateFile": "busy"|"idle"|"awaiting"|null, "ageS": number, "pane": "<file>.txt", "expected": { "state": "busy"|"idle"|"awaiting", "reason"?: string } }`, plus one synthetic `.txt` pane capture per case (15 lines max, no real paths or user text from the logs)
- [x] Cases that must read **awaiting** (genuine dialogs, no busy footer): AskUserQuestion dialog (`Enter to select · Tab/Arrow keys to navigate · Esc to cancel`); `[Y/n]` confirm; plan approval (`shift+tab to approve`); BUG-0002 `Verdict? P/F/Fix/Skip` with an idle state file; multi-line `Pass / Fail / Fix now / Skip?` above the input box with an idle state file; a bare `>` prompt line
- [x] Cases that must NOT read awaiting (BUG-0013 evidence): busy state file + `esc to interrupt` footer + assistant line `Verdicts (2–4)?` → busy; busy state file + `esc to interrupt` footer + `### 1. Implement the fix <!-- agent: general-purpose -->` → busy; **awaiting** state file + `esc to interrupt` footer + a `?` line → busy; idle state file + `❯ still running?` → idle; idle state file + `❯ /research <topic or question to research>` → idle; busy state file (fresh) + `❯ /wiki-query <question>` and no busy footer → busy
- [x] Codex non-regression cases: codex pane with `Running` in scrollback and an `Esc to cancel` confirm open → awaiting; codex bare `>` idle prompt → not awaiting

### 3. host-server/state.ts  <!-- agent: general-purpose -->

- [x] Add an exported pure helper `awaitingWindow(tail: string): string` in `host-server/state.ts`: split on `\n`, drop blank lines, drop lines matching `/^\s*❯\s+\S/`, keep the last 8, join with `\n`; make `matchesAwaiting` call `grepMatches(awaitingPattern, awaitingWindow(tail))` (replaces the raw `slice(-8)` at ~`:428`)
- [x] In the `state === 'awaiting'` branch (~`:473-480`) change the "dialog gone" condition to also fire when the busy footer is visible for non-codex agents: `if (tail !== '' && (!matchesAwaiting(tail) || (type !== 'codex' && busyPattern && grepMatches(busyPattern, tail))))` returning the existing `{ state: 'busy', reason: 'state-file' }` (no new return site)
- [x] Correct the doc comments that say "last non-blank line" (~`:370` and ~`:438`) to describe the 8-line window, draft-line drop and busy guard
- [x] Do not change `DetectionReason`, the busy-branch guard at ~`:437`, the idle branch, or the fallback branch

### 4. scripts/monitor.sh  <!-- agent: general-purpose -->

- [x] Add two helpers near `pane_tail5` (~`:198`): `awaiting_window target` = `tmux capture-pane -t "$1" -p | grep -v '^[[:space:]]*$' | grep -Ev '^[[:space:]]*❯[[:space:]]+[^[:space:]]' | tail -8`, and `busy_visible target busy_pattern launch` that returns 0 only when `agent_type "$launch"` is not `codex`, `busy_pattern` is non-empty, and `tmux capture-pane -t "$1" -p | grep -v '^[[:space:]]*$' | tail -15 | grep -qE "$busy_pattern"`
- [x] busy case (~`:248-256`): skip the awaiting check entirely when `busy_visible` is true; otherwise use `awaiting_window` in place of the inline `tail -8`
- [x] idle case (~`:296-313`): run the `busy_visible` check before the awaiting write and return 1 (busy) without writing `awaiting` when it holds; keep the existing `BUSY_PATTERN`/`pane_tail5` fallback check below it, and use `awaiting_window` for the awaiting match
- [x] awaiting case (~`:316-330`): revert the state file to `busy` when `busy_visible` is true **or** the pattern no longer matches `awaiting_window`
- [x] regex-fallback (~`:339-359`): use `awaiting_window` for the awaiting match (busy check already runs first); leave the idle match on `pane_tail5`
- [x] Add `# BUG-0013` comments at each guard explaining why (busy footer never appears with a real dialog; codex exempt) and run `bash -n scripts/monitor.sh`

### 5. conductor.conf  <!-- agent: general-purpose -->

- [x] In `conductor.conf` `AWAITING_PATTERN` (~`:100`) replace the `>\s*$` alternative with `^\s*>\s*$`; leave every other alternative byte-for-byte
- [x] Update the comment block above it (~`:63-99`): window is the last 8 non-blank lines after dropping `❯ …` draft-input lines; `?` and `>` heuristics are ignored while `BUSY_PATTERN` is visible (non-Codex); `>` now means a line that is only `>`; cite BUG-0013
- [x] Update every other copy found in Step 1 (docs, examples); confirm `host-server/config.ts` `parseScalar(parseDeclare(...,'AWAITING_PATTERN'))` round-trips the new value by running the conf through `declare -p` (a small assertion in `config.test.ts` if a pattern-loading test exists; otherwise covered by the fixtures in Step 6)

### 6. Tests  <!-- agent: general-purpose -->

- [x] In `host-server/state.test.ts` add a `describe` that reads the Step 2 manifest and, for each case, calls `detectAgentStatus(baseConf(dir), 'agent-x', <launch>, <pane text>, true, <'claude'|'codex'>)` with the state file written per the manifest, asserting `.state` (and `.reason` when given); use `baseConf(...)` so the real `conductor.conf` patterns are exercised
- [x] Add named tests: awaiting state-file + busy footer + `?` line reverts to busy (BUG-0013 site 9 shape); `awaitingWindow` drops `❯` draft lines and blank lines and keeps the last 8; codex awaiting state-file with `Running` scrollback stays awaiting
- [x] Create `scripts/verify-awaiting-detection.sh` following `scripts/verify-transitions-jsonl-emit.sh` (verbatim quote-aware extraction of `is_idle`, `agent_type`, `agent_*_pattern`, `pane_dead`, `pane_tail5`, `awaiting_window`, `busy_visible`, `launch_cmd_name`, `is_shell_cmd` from the live `monitor.sh`; stub `tmux` on `PATH` returning the fixture for `capture-pane` and the launch command name for `display-message`; patterns loaded by extracting the literal `AWAITING_PATTERN=`/`BUSY_PATTERN=`/`IDLE_PATTERN=` lines from `conductor.conf`; scratch under `./tmp/`, cleaned on exit) and run every manifest case through `is_idle`, mapping expected `awaiting` → state file `awaiting` and return 1, `busy` → not `awaiting` and return 1, `idle` → return 0
- [x] Run `cd host-server && npx tsc --noEmit && npm test`, `bash scripts/verify-awaiting-detection.sh`, `bash scripts/verify-transitions-jsonl-emit.sh` (extractor still works after the monitor edits) and `bash -n scripts/monitor.sh`; fix failures, do not weaken assertions

### 7. Measurement script  <!-- agent: general-purpose -->

- [x] Create `scripts/report-false-awaiting.mjs` (read-only, stdlib only): reads `$LOG_DIR/transitions.jsonl` (default `logs/transitions.jsonl`, optional `--since <ISO>`), and prints, for `to: "awaiting"` records, the total, the count with no dialog marker in the last 8 pane lines (`Enter to (select|confirm|submit)|Esc to (cancel|go back)|\[Y/n\]|\[y/N\]|ctrl.g to edit|shift.tab to approve`), the count with `esc to interrupt` visible, and a breakdown by `from | reason`; record the pre-fix baseline in the header comment (2026-09-13 to 2026-09-20: 329 total, 178 no dialog, 21 busy-visible)
- [x] Smoke it against a small hand-written JSONL under `./tmp/` and against the real log; it must not write anywhere

### 8. Docs and bug link  <!-- agent: general-purpose -->

- [x] Correct the "Waiting/stalled detection" bullet in `CLAUDE.md` (window is the last 8 non-blank lines, not the last non-blank line; busy footer suppresses the heuristics except for Codex; `❯` draft lines ignored; `>` means a bare prompt line), and add a row for `scripts/verify-awaiting-detection.sh` where the other verify scripts are listed in `scripts/README.md`
- [x] Add a short "BUG-0013 false-awaiting" section to `wiki/knowledge/concepts/agent-state-determination.md` (cause, the guard, the draft-line rule, the shared fixtures) and, if `dispatch-path-parity` is the better home for the "two implementations, one fixture set" point, one sentence there
- [x] Set `linked_task: "[[TASK-0231]]"` in `wiki/work/bugs/0013-agent-marked-waiting-while-thinking.md` frontmatter (done at task creation on 2026-09-20; its status and Resolution are left for `/bug-close`)

### 9. Live verification  <!-- agent: general-purpose -->

- [ ] `[DEFERRED-TO-UAT]` Restart the host-server (conf cache) and the `monitor` window, then with a throwaway agent run a prompt whose visible output includes a line ending in `?` and one ending in `-->` while the turn is still running: the badge stays `busy` and `logs/transitions.jsonl` gains no `to: "awaiting"` record; then open a real AskUserQuestion dialog and confirm it still reads `awaiting`
- [ ] `[DEFERRED-TO-UAT]` After a day or two of normal use run `node scripts/report-false-awaiting.mjs --since <restart timestamp>`: expected `esc to interrupt visible` = 0 and the no-dialog share falling well below the 54% baseline; record the numbers in BUG-0013's Resolution when closing

## Dependencies

- Depends on: none.
- Blocks: `/bug-close BUG-0013` (needs the fix commit and the regression tests from Step 6).
- Parallel-safe with `TASK-0199`, `TASK-0221`, `TASK-0222` (different files). Sequence, do not parallelize, with any task editing `scripts/monitor.sh`, `host-server/state.ts` or `conductor.conf` (`TASK-133`, and the pending-uat `TASK-0191`/`TASK-0128` if reopened).

## Notes

- Step 1 findings (2026-09-20, current line numbers; supersede the `~` numbers in the steps): `scripts/monitor.sh` `agent_type` 125, `agent_idle_pattern` 136, `agent_busy_pattern` 143, `agent_awaiting_pattern` 150, `pane_dead` 163, `pane_tail5` 198-200, `is_idle` 202-359; busy-case awaiting check 244-255 (private `tail -8`), idle-case awaiting check 295-304, awaiting-revert case 315-330, regex-fallback 338-358 (awaiting block 347-352; uses `pane_tail5` = 5 lines). `host-server/state.ts` `matchesAwaiting` 427-428, busy-branch guard 436, "Last-non-blank-line" comment 437 (not 438), `awaiting` branch 472-480, idle branch 481-490, `tail5()` there returns a 15-line tail; doc comment 370. `AWAITING_PATTERN` lives at `conductor.conf:89` (not `:100`; block comment 52-88, line 82 mentions `>\s*$`, line 61 says "pane_tail5"). Codex patterns are not in the conf: they are in `monitor.sh` 136-158 and `state.ts` `CODEX_STATUS_PROFILE` (36-46); codex awaiting pattern already excludes `>` and `?`.
- Other places to change: `CLAUDE.md:65` and `AGENTS.md:63` ("last non-blank pane line"). Historical `raw/research/*` and archived bug pages are left alone. No `install.sh`/`hooks/`/`frontend/`/`scripts/` copies of the pattern; no `conductor.conf.example`. No supported agent (Aider, custom) relies on `>\s*$` matching a non-bare line (Aider appears only as an IDLE example `^aider>`). `host-server/awaitingPattern.test.ts` already runs the live conf pattern through `grep -qE` (extend it with non-bare `>` cases); `config.test.ts` has no pattern-loading test, so the round trip is covered by `awaitingPattern.test.ts` plus the Step 2 fixtures. `verify-transitions-jsonl-emit.sh` extracts functions with a quote-aware python brace counter into `tmp/`; Step 6's script should copy that structure.
- Step 2 note: 14 cases in `host-server/fixtures/awaiting-panes/` (6 awaiting, 6 not-awaiting, 2 codex). The codex "Running scrollback + Esc to cancel" case uses an `awaiting` state file (a `busy` file reads busy in `state.ts` for codex because the unchanged busy-branch guard sees `Running`, whereas `monitor.sh` would say awaiting; that pre-existing divergence is out of scope).
<!-- Updated: 2026-09-20 -->
- Step 6 results: `tsc --noEmit` clean; `state.test.ts` 61/61; `verify-awaiting-detection.sh` 15/15; `verify-transitions-jsonl-emit.sh` 10/10; `bash -n scripts/monitor.sh` ok. `npm test` 497/498: the one failure is `transitionsLog.test.ts` ("buildSnapshot captures reason/matchedPattern/tail15 ..."), a source-regex assertion against `host-server/index.ts`, which this task does not touch and which another agent has modified concurrently; not caused by this task.
<!-- Updated: 2026-09-20 -->
- Evidence (2026-09-20): of 329 `awaiting` transitions, non-dialog origins were idle via `>` 50, idle via `?` 32, busy via `?` 55, busy via `>` 6, stalled 4; 21 busy-with-`esc to interrupt` records came only from the monitor-written state-file path (median episode 8 s, max 29 s).
