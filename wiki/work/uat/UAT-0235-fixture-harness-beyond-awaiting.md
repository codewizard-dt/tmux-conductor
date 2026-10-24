---
id: UAT-0235
aliases: [UAT-0235]
title: "UAT: Extend the Shared Pane-Fixture Harness to Cover stalled/exited (Beyond awaiting)"
status: pending
task: TASK-0235
created: 2026-10-17
updated: 2026-10-17
---

# UAT-0235 — UAT: Extend the Shared Pane-Fixture Harness to Cover stalled/exited (Beyond awaiting)

implements::[[TASK-0235]]

> **Source task**: [[TASK-0235]]
> **Generated**: 2026-10-17

---

## Prerequisites

- [ ] Run from the repo root `/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] `host-server` dependencies installed (`cd host-server && npm install` if `node_modules` is missing)
- [ ] No other process holding `scripts/verify-awaiting-detection.sh`'s stubbed `tmux`/`PATH` state (the script is self-contained and safe to run concurrently with other work)

---

## Test Cases

### UAT-EDGE-001: TS-side `stalled` classification via the shared manifest fixture
- **Scenario**: `host-server/fixtures/awaiting-panes/manifest.json`'s `stalled-no-pattern-match-bash-busy-equivalent` entry (`stateFile: "busy"`, `ageS: 400` — over the 300s `STALL_TIMEOUT` default) must make `detectAgentStatus()` classify the pane as `stalled` with reason `inventory-timeout`, since its pane text (`stalled-no-pattern-match.txt`) matches none of `BUSY_PATTERN`/`IDLE_PATTERN`/`AWAITING_PATTERN`.
- **Steps**:
  1. `cd host-server`
  2. Run the command below.
- **Command**:
  ```bash
  node --import tsx/esm --test --test-name-pattern="stalled-no-pattern-match" state.test.ts
  ```
- **Expected Result**: `tests 1`, `pass 1`, `fail 0`. Test name reads `stalled-no-pattern-match-bash-busy-equivalent: claude / state-file busy -> stalled`.
- **Repeatable Unit Test**: Not applicable: this case is the pre-existing parametrized fixture-loop test in `host-server/state.test.ts`'s `describe('shared pane fixtures (TASK-0231, extended TASK-0235)')` block (created as part of this task's own implementation) — no further unit test needed on top of it.
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern="stalled-no-pattern-match" state.test.ts`
- [x] Pass <!-- 2026-10-17 -->

### UAT-EDGE-002: TS-side `exited` classification via the new `paneCurrentCommand` manifest field
- **Scenario**: The `exited-shell-prompt` manifest entry carries the new optional `paneCurrentCommand: "zsh"` field. The fixture loop (`host-server/state.test.ts:310`) must thread `c.paneCurrentCommand ?? c.launch` into `detectAgentStatus()`'s 6th argument instead of the literal launch command, so a non-shell launch (`claude`) observed with a live shell pane command (`zsh`) is classified `exited` / `exited` — proving the fixture can actually exercise this branch (previously impossible, since the 6th arg was hardcoded to `c.launch` for every case).
- **Steps**:
  1. `cd host-server`
  2. Run the command below.
- **Command**:
  ```bash
  node --import tsx/esm --test --test-name-pattern="exited-shell-prompt" state.test.ts
  ```
- **Expected Result**: `tests 1`, `pass 1`, `fail 0`. Test name reads `exited-shell-prompt: claude / state-file busy -> exited`.
- **Repeatable Unit Test**: Not applicable: pre-existing parametrized fixture-loop test, same block as UAT-EDGE-001.
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern="exited-shell-prompt" state.test.ts`
- [x] Pass <!-- 2026-10-17 -->

### UAT-EDGE-003: TS-side `busy-recovered` classification (age-gated recovery branch)
- **Scenario**: The `busy-recovered-idle-footer` manifest entry (`stateFile: "busy"`, `ageS: 40` — over `POLL_INTERVAL * 2` = 30s but under the 300s stall timeout) with a pane matching `IDLE_PATTERN` and not `BUSY_PATTERN` must recover to `idle` with reason `busy-recovered`, exercising the previously-untested age-gated recovery branch (covers a missed `Stop` hook).
- **Steps**:
  1. `cd host-server`
  2. Run the command below.
- **Command**:
  ```bash
  node --import tsx/esm --test --test-name-pattern="busy-recovered-idle-footer" state.test.ts
  ```
- **Expected Result**: `tests 1`, `pass 1`, `fail 0`. Test name reads `busy-recovered-idle-footer: claude / state-file busy -> idle`.
- **Repeatable Unit Test**: Not applicable: pre-existing parametrized fixture-loop test, same block as UAT-EDGE-001.
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern="busy-recovered-idle-footer" state.test.ts`
- [x] Pass <!-- 2026-10-17 -->

### UAT-EDGE-004: bash-side five-way expected-value mapping in `scripts/verify-awaiting-detection.sh`
- **Scenario**: `scripts/verify-awaiting-detection.sh`'s `case "$expected" in ...)` block must now handle all five manifest state values. For `stalled`, since `scripts/monitor.sh` has no `stalled` branch, the script must assert the **bash-side-correct equivalent** — `rc == 1` and the state file still reads `busy` (NOT a `stalled` string, which bash can never produce) — per the task's documented TS/bash asymmetry. For `exited`, it must assert `rc == 1` and `$LAST_DETECTION == "pane-dead"`, reading the new `pane_cmd` TSV column (exported as `FIXTURE_CMD_NAME`) instead of the previously hardcoded `$launch`.
- **Steps**:
  1. From the repo root, run the command below (exercises the full manifest, all 17 pane cases + 1 stub-hygiene check through the real `monitor.sh` functions with a stubbed `tmux`).
- **Command**:
  ```bash
  bash scripts/verify-awaiting-detection.sh
  ```
- **Expected Result**: Output includes `PASS: stalled-no-pattern-match-bash-busy-equivalent (claude, state-file busy -> stalled)` and `PASS: exited-shell-prompt (claude, state-file busy -> exited)` among the per-case lines, and the summary line reads `Passed: 18  Failed: 0`.
- **Repeatable Unit Test**: Not applicable: `scripts/verify-awaiting-detection.sh` is itself the repeatable regression check for the bash-side detector (shell script, no additional JS/TS unit test harness applies).
- **Unit Test Command**: `bash scripts/verify-awaiting-detection.sh`
- [x] Pass <!-- 2026-10-17 -->

### UAT-INT-001: Manifest stays the single source of truth across both detectors (no drift)
- **Scenario**: The whole point of the shared-fixture mechanism (BUG-0013/TASK-0231, extended here) is that `host-server/state.ts`'s TS detector and `scripts/monitor.sh`'s bash detector are checked against the exact same `host-server/fixtures/awaiting-panes/manifest.json` entries, so they cannot silently drift. This case confirms both consumers process the now-17-entry manifest (14 original `awaiting`/`busy`/`idle` cases + the 3 new `stalled`/`exited`/`busy-recovered` cases from this task) end-to-end without any case being skipped, miscounted, or newly broken.
- **Steps**:
  1. `cd host-server && node --import tsx/esm --test state.test.ts` — full file, not just the fixture block.
  2. `cd .. && bash scripts/verify-awaiting-detection.sh`
- **Expected Result**: Step 1: all tests in `state.test.ts` pass (`fail 0`), including all entries under `shared pane fixtures (TASK-0231, extended TASK-0235)`. Step 2: `Passed: 18  Failed: 0`.
- **Repeatable Unit Test**: Not applicable: this is itself the full-file/full-script regression run; `state.test.ts` and `verify-awaiting-detection.sh` already are the repeatable unit tests.
- **Unit Test Command**: `node --import tsx/esm --test state.test.ts` (run from `host-server/`)
- [x] Pass <!-- 2026-10-17 -->

### UAT-DOC-001: Deferred documentation update reflects the broadened fixture coverage
- **Scenario**: The task's Notes section explicitly flagged (but deferred) updating `CLAUDE.md`'s "Waiting/stalled detection" bullet and `wiki/knowledge/concepts/agent-state-determination.md`'s "Shared fixtures" paragraph to say the manifest now also covers `stalled`/`exited`/`busy-recovered`, not just `awaiting`. This case confirms that update landed.
- **Steps**:
  1. This repo's `SERENA-FIRST` hook blocks `grep`/`cat` on markdown files, so verify via Serena instead of a shell command: `mcp__serena__search_for_pattern(substring_pattern="stalled.*exited.*busy-recovered", relative_path="CLAUDE.md")` and the same pattern against `wiki/knowledge/concepts/agent-state-determination.md`.
- **Expected Result**: Both files report at least one match — `CLAUDE.md`'s "Waiting/stalled detection" bullet and the wiki concept page's "Shared fixtures" paragraph each mention the broadened `stalled`/`exited`/`busy-recovered` coverage.
- **Repeatable Unit Test**: Not applicable: documentation-prose check, not executable business logic.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-10-17 -->

---

## Gaps

None. All planned cases were research-backed against the live code (manifest entries read directly, `state.test.ts` fixture-loop call site and `describe` rename confirmed, `verify-awaiting-detection.sh`'s five-way `case` block and `pane_cmd`/`FIXTURE_CMD_NAME` wiring confirmed) and every `Command`/`Unit Test Command` above was executed once during generation to verify it runs and passes as written:
- `stalled-no-pattern-match` isolated run: 1/1 pass.
- `exited-shell-prompt` isolated run: 1/1 pass.
- `busy-recovered-idle-footer` isolated run: 1/1 pass.
- `bash scripts/verify-awaiting-detection.sh`: 18/18 pass (fresh run, includes the new three cases plus the stub-hygiene check).

No new unit test files were created: all behavior under test was already captured as repeatable unit tests (`host-server/state.test.ts`'s fixture loop, `scripts/verify-awaiting-detection.sh`) by TASK-0235's own implementation. `uatGenerate.promoteTests` resolved to legacy value `true` → treated as `dedicated`; no additional dedicated-folder test was needed since the dedicated tests already exist and were verified directly.
