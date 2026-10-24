---
id: TASK-0235
aliases: [TASK-0235]
title: "Extend the Shared Pane-Fixture Harness to Cover stalled/exited (Beyond awaiting)"
status: pending-uat
created: 2026-10-17
updated: 2026-10-17
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-0235]]"
tags: [testing, agent-state, host-server, fixtures]
---

# TASK-0235 — Extend the Shared Pane-Fixture Harness to Cover stalled/exited (Beyond awaiting)

relates_to::[[state-detector-evaluation-tiers]]

## Objective

`host-server/fixtures/awaiting-panes/manifest.json` plus its two consumers (`host-server/state.test.ts`'s `describe('awaiting-pane fixtures (TASK-0231)')` block and `scripts/verify-awaiting-detection.sh`) give `awaiting` dual-detector regression protection: the same manifest drives both `host-server/state.ts`'s `detectAgentStatus()` (TS) and `scripts/monitor.sh`'s `is_idle()` (bash), so the two cannot silently drift (built for BUG-0013/TASK-0231). As of 2026-10-17 all 14 manifest entries have `expected.state` of `awaiting`, `busy`, or `idle` only — there is no fixture for `stalled` or `exited`, and no fixture specifically exercising the age-gated `busy-recovered`/`inventory-timeout` branches. Extend the same manifest + both consumers to cover `stalled` and `exited`, and add at least one `busy-recovered` case, without building a second, parallel fixture mechanism.

## Approach

Reuse the existing manifest schema (`{name, launch, stateFile, ageS, pane, expected: {state, reason}}`) — do not invent a new schema. Keep the fixture directory named `host-server/fixtures/awaiting-panes/` (lowest-risk, matches the codebase's style of not renaming things without a concrete need); just note in the manifest's neighboring docs that it now covers more than `awaiting`.

Three findings from reading the live code change what "just add manifest entries" means in practice — read these before writing code:

1. **`exited` needs a new manifest field, not just a new row.** `host-server/state.test.ts`'s fixture loop (`host-server/state.test.ts:308`) calls `detectAgentStatus(conf, 'agent-x', c.launch, pane, true, c.launch)` — the 6th argument, `paneCurrentCommand`, is hardcoded to `c.launch` for every case. `detectAgentStatus`'s `exited` branch (`host-server/state.ts:422-426`) only fires when `paneCurrentCommand` is a shell command *different from* the (non-shell) launch command, so with the current hardcoding an `exited` case can never trigger. Add an optional `paneCurrentCommand` field to the manifest schema (default: fall back to `c.launch` when absent, to keep all 14 existing rows unchanged) and thread it through this call instead of the literal `c.launch`. Mirror this in `AwaitingPaneCase` (`host-server/state.test.ts:280-287`).
2. **`scripts/verify-awaiting-detection.sh` has the identical hardcoding.** Its stub `tmux` returns `$FIXTURE_CMD_NAME` for `display-message` (used by `pane_dead()`), and the harness exports `FIXTURE_CMD_NAME="$launch"` verbatim (`scripts/verify-awaiting-detection.sh:220`) before calling `is_idle`. Add a `pane_cmd` column to `CASES_TSV` (default to `launch` when the manifest field is absent) and export that as `FIXTURE_CMD_NAME` instead.
3. **`stalled` is host-server-only — `scripts/monitor.sh` has no equivalent branch.** `host-server/state.ts`'s stall detection (`ageSeconds > stallTimeout`, default 300s via `STALL_TIMEOUT` in `conductor.conf`, read in `host-server/config.ts:178`) has no counterpart in `scripts/monitor.sh`'s `is_idle()`: its busy case (`scripts/monitor.sh:262-315`) only ever recovers a stale busy file to `idle` (the `busy-recovered` branches, lines 292-313) or falls through to `return 1` at line 314 — there is no `STALL_TIMEOUT` variable, no stall branch, and no distinct state written for it. This matches the documented asymmetry in `CLAUDE.md`'s "Waiting/stalled detection" bullet ("host-server-only, derived, never written to the state file"). Consequently a `stalled` fixture case **cannot assert matching classifications across both detectors** the way `awaiting` cases do. `scripts/verify-awaiting-detection.sh`'s expected-value mapping for a `stalled` manifest entry must therefore assert the bash-side-correct behavior — `rc == 1` and the state file still reads `busy` (i.e. bash classifies it exactly like an ordinary busy case) — not a `stalled` string that bash can never produce. Document this explicitly in both the manifest (a comment field or a `name` suffix like `-bash-busy-equivalent`) and the verify script's mapping comment, so a future reader doesn't mistake it for a bug.

Given (1)-(3), `host-server/state.test.ts`'s generic assertion (`result.state === case.expected.state`, `result.reason === case.expected.reason` at lines 309-312) already works for any TS-side state value including `stalled`/`exited` with zero changes beyond the `paneCurrentCommand` threading in (1) — confirm this holds when writing the new cases. `scripts/verify-awaiting-detection.sh`'s `case "$expected" in awaiting|busy|idle)` block (lines 228-253) is the piece that needs a real code change: extend it to a five-way `case` adding `stalled` (mapped per finding 3, reading the harness's `LAST_DETECTION`/`LAST_STATE_VALUE` globals that `is_idle` already sets — confirm these remain readable as plain globals after `source`ing the extracted functions, same way the script already reads `$after` from the state file) and `exited` (mapped as `rc == 1 && LAST_DETECTION == "pane-dead"`, the value `scripts/monitor.sh:246` sets in its `pane_dead` branch).

**Sequencing note:** `TASK-0236` (sequential-poll tests for `busy-recovered`/`inventory-timeout`) also edits `host-server/state.test.ts`; whoever tackles both should not run them as literally concurrent edits to the same file — no hard `depends_on`, just avoid clobbering each other's diff.

## Steps

### 1. Add new pane fixtures and manifest entries  <!-- agent: general-purpose -->

- [x] Add a `stalled` case to `host-server/fixtures/awaiting-panes/manifest.json`: `stateFile: "busy"`, `ageS` greater than `stallTimeout` (300), `launch: "claude"`, a new synthetic pane-text file (e.g. `stalled-no-pattern-match.txt`, 15 lines max, matching none of `BUSY_PATTERN`/`IDLE_PATTERN`/`AWAITING_PATTERN` from `conductor.conf`), `expected: {state: "stalled", reason: "inventory-timeout"}` (this is the TS-side expectation; see Step 2 for the bash-side divergence)
- [x] Add an `exited` case: new field `paneCurrentCommand: "zsh"` (or another shell name from `SHELL_COMMANDS` in `host-server/state.ts`), `launch: "claude"` (non-shell), a pane-text file showing a plain shell prompt, `expected: {state: "exited", reason: "exited"}`
- [x] Add a `busy-recovered` case: `stateFile: "busy"`, `ageS` greater than `pollInterval * 2` (default `POLL_INTERVAL` is 15, so use something like 40) but under `stallTimeout`, a pane-text file matching `IDLE_PATTERN` and not `BUSY_PATTERN`, `expected: {state: "idle", reason: "busy-recovered"}`
- [x] Update the `AwaitingPaneCase` interface in `host-server/state.test.ts` (around line 280) to add the optional `paneCurrentCommand?: string` field matching the manifest

### 2. Wire the new field through host-server/state.test.ts  <!-- agent: general-purpose -->

- [x] In the `describe('awaiting-pane fixtures (TASK-0231)')` loop (`host-server/state.test.ts:294-318`), change the `detectAgentStatus(...)` call (line 308) to pass `c.paneCurrentCommand ?? c.launch` instead of the literal `c.launch` for the 6th argument, so the new `exited` case's distinct pane command actually reaches the function under test
- [x] Run the new `stalled`/`exited`/`busy-recovered` cases through the existing generic assertions (no new assertion logic needed per the Approach's finding) and confirm all three pass with the manifest entries from Step 1
- [x] Rename the `describe` block label if it now reads oddly covering more than awaiting (e.g. `'shared pane fixtures (TASK-0231, extended TASK-0235)'`) — cosmetic only, do not change the `it()` title format

### 3. Extend scripts/verify-awaiting-detection.sh's expected-value mapping  <!-- agent: general-purpose -->

- [x] Add a `pane_cmd` column to the `CASES_TSV` generation (`scripts/verify-awaiting-detection.sh:202-207`): extract `c.get('paneCurrentCommand', c['launch'])` per case alongside the existing fields
- [x] Update the `while IFS=$'\t' read -r ...` loop (line 210) to read the new column, and export it as `FIXTURE_CMD_NAME` (line 220-221) instead of the literal `"$launch"`, so `pane_dead()`'s `display-message` stub call reflects the fixture's intended pane command
- [x] Extend the `case "$expected" in ...)` block (lines 228-253) from three arms to five:
  - `stalled` → assert `rc == 1` and the state file still reads `busy` (NOT `stalled` — bash has no such state; see Approach finding 3) and optionally assert `$LAST_DETECTION == "state-file"` / `$LAST_STATE_VALUE == "busy"` for extra signal that it fell through the ordinary busy path rather than hitting `pane-dead`
  - `exited` → assert `rc == 1` and `$LAST_DETECTION == "pane-dead"` (set at `scripts/monitor.sh:246`)
- [x] Update the mapping comment block at the top of the script (lines 20-23) to document the full five-way mapping, explicitly calling out that `stalled`'s bash-side assertion differs from its TS-side `expected.state` by design

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run `cd host-server && npx tsc --noEmit && npm test`; fix any failures without weakening assertions
- [x] Run `bash scripts/verify-awaiting-detection.sh`; fix any failures without weakening assertions
- [x] Confirm `bash -n scripts/monitor.sh` still parses cleanly (unchanged by this task, but the extractor pulls from the live file — a stale extraction target would fail silently otherwise)

### 5. Docs  <!-- agent: general-purpose -->

- [x] Update the `scripts/verify-awaiting-detection.sh` row in `scripts/README.md` to mention it now also covers `stalled`/`exited`, not just `awaiting`
- [x] Note in this task's Notes section (do not edit now; flag for whoever tackles it) that `CLAUDE.md`'s / `AGENTS.md`'s "shared fixture set" sentence and `wiki/knowledge/concepts/agent-state-determination.md`'s "Shared fixtures" paragraph should be updated to reflect the broadened coverage once this task lands

## Notes

- Fixture directory intentionally kept as `host-server/fixtures/awaiting-panes/` — renaming to something state-agnostic (e.g. `agent-state-panes/`) was considered but rejected as unnecessary churn across `host-server/state.test.ts`, `scripts/verify-awaiting-detection.sh`, and the CLAUDE.md/wiki references for a directory name that is otherwise working fine.
- Follow-up (flagged, not edited): the "shared fixture set" sentence in CLAUDE.md / AGENTS.md and the "Shared fixtures" paragraph of `wiki/knowledge/concepts/agent-state-determination.md` should be updated to say the manifest now also covers stalled/exited/busy-recovered.
- Static gates passed 2026-10-17: tsc clean, state.test.ts 64/64, verify-awaiting-detection.sh 18/18, bash -n monitor.sh and the verify script. Runtime checks deferred to UAT.
<!-- Updated: 2026-10-17 -->
- `STALL_TIMEOUT` default is 300s (`host-server/config.ts:178`); `POLL_INTERVAL` default is 15s. Use these as the basis for `ageS` values in new fixtures so they exercise the real default thresholds, not arbitrary numbers.
