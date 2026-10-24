---
id: TASK-0236
aliases: [TASK-0236]
title: "Add Sequential-Poll (1-Switch) Tests for busy-recovered and inventory-timeout Branches"
status: todo
created: 2026-10-17
updated: 2026-10-17
depends_on: []
blocks: []
parallel_safe_with: []
uat: ""
tags: [testing, agent-state, host-server]
---

# TASK-0236 — Add Sequential-Poll (1-Switch) Tests for busy-recovered and inventory-timeout Branches

relates_to::[[state-detector-evaluation-tiers]]

## Objective

`host-server/state.ts`'s `detectAgentStatus()` has three age-gated branches inside the `state === 'busy'` handling that recover or re-classify an agent based on how long its state file has been stale: a Codex-specific safety net that recovers to `idle` (reason `busy-recovered`), a generic hook-failure safety net that recovers to `idle` (reason `busy-recovered`), and a branch that reports `stalled` (reason `inventory-timeout`) once the busy file is older than `conf.stallTimeout` with no pane pattern match at all. These are history-dependent branches: formal state-transition-testing terminology calls exercising every individual transition once "0-switch coverage" and exercising consecutive *pairs* of transitions "1-switch coverage" — the latter "catches defects where the system's history matters." `host-server/state.test.ts` currently exercises every one of `detectAgentStatus`'s 18 return sites (see `TASK-142`/`site N` comments throughout the file), but every single existing test calls `detectAgentStatus` exactly once — there is no test that simulates two sequential polls against the same evolving state file and asserts on the resulting pair. This task closes that gap for the two age-gated recovery branches plus the stall branch.

## Approach

No live tmux, no live DB, no real wall-clock sleeps — matches the project's established constraint for this kind of test (see `raw/research/monitor-sh-transition-emit-testability/index.md` for background; this task does not require reading it). Use the file's existing fixture idiom: `makeStateDir`, `baseConf`, `writeState(stateDir, windowName, value, ageMs)` (the last of which backdates the state file's mtime via `fs.utimesSync`, so "time passing" is faked without sleeping), and `detectAgentStatus` itself — all already imported/defined at the top of `host-server/state.test.ts`.

Each new test calls `detectAgentStatus` **twice in direct sequence** against the same `windowName`/state-file: first at a low/fresh age to assert the branch's own single-call precondition still holds (e.g. still `busy`, not yet recovered/stalled), then again after rewriting the state file to an older `ageMs` (via a second `writeState` call with the same window name) to assert the branch actually fires. Derive every fake age from `conf.pollInterval`/`conf.stallTimeout` (`baseConf()`'s defaults, 15 and 300 respectively — do not override `pollInterval` the way the existing single-call `site 5`/`site 6`/`site 7` tests do, since we want ages computed off the real defaults), never as hardcoded magic-number milliseconds, so the tests stay correct if those tunables change.

Note: `TASK-0235` (extending the shared pane-fixture manifest to cover `stalled`/`exited`) also edits `host-server/state.test.ts`. Whoever tackles both tasks should not run them as literally concurrent edits to the same file — sequence them, or merge carefully.

## Steps

### 1. Add the sequential-poll describe block  <!-- agent: general-purpose -->

- [ ] In `host-server/state.test.ts`, add a new `describe('detectAgentStatus: sequential-poll (1-switch) coverage for age-gated recovery branches', () => { ... })` block, placed after the existing `site 7` ("an old busy file matching no pattern at all is reported stalled") test (~line 146), before the "Branch 3 continued" awaiting section comment.
- [ ] Inside it, add `test('hook-failure safety net recovers idle only after the second, older poll', () => { ... })`:
  - Create a state dir via `makeStateDir('sequential-hook-failure-recovered')` and `baseConf(dir)` (defaults: `pollInterval: 15`, `stallTimeout: 300`).
  - First call: `writeState(dir, 'agent-x', 'busy', 0)`, then `detectAgentStatus(conf, 'agent-x', 'claude', 'accept edits on (shift+tab to cycle)', true, 'claude')`. Assert the result is still `{ state: 'busy', reason: 'state-file', matchedPattern: 'busy' }` (fresh age, busy footer visible — not recovered yet; note the first tail has the busy footer so the branch's `tail !== '' && !(busyPattern && grepMatches(...))` guard does not even enter the age checks — this call documents the starting condition, not the recovery precondition).
  - Second call, same window: `writeState(dir, 'agent-x', 'busy', conf.pollInterval * 2 * 1000 + 5000)` (just over the `pollInterval * 2` threshold with a 5s buffer), then `detectAgentStatus(conf, 'agent-x', 'claude', 'idle and waiting for input', true, 'claude')` — the tail must match `conf.idlePattern` and not `conf.busyPattern` (reuse the tail text pattern already used by other idle-fallback tests in this file; verify by reading `conf.idlePattern`/`conf.busyPattern` from `readConductorConf` in a quick scratch check if unsure). Assert `assert.deepEqual(result, { state: 'idle', reason: 'busy-recovered', matchedPattern: 'idle' })`.
  - `cleanup(dir)` in a `finally`.
- [ ] Add `test('codex safety net recovers idle only after the second, older poll', () => { ... })`, same two-call shape as above but with `launchCmd` `'codex'` and `paneCurrentCommand` `'codex'` on both calls (mirroring how the existing `site 5` test at ~line 112 identifies a Codex agent), using a tail that matches `idlePattern` and not `busyPattern` on the second call only (first call: fresh age, assert still `busy`; second call: `ageMs` just over `conf.pollInterval * 2 * 1000`, assert `{ state: 'idle', reason: 'busy-recovered', matchedPattern: 'idle' }`).
- [ ] Add `test('inventory-timeout only fires once the busy file crosses stallTimeout', () => { ... })`:
  - First call: `writeState(dir, 'agent-x', 'busy', conf.stallTimeout * 1000 - 5000)` (just *under* `stallTimeout`, 5s buffer) with a tail matching no pattern (reuse `'nothing recognizable here'` from the existing `site 7` test at ~line 141). Assert the result is still `{ state: 'busy', reason: 'state-file', matchedPattern: 'busy' }` — not yet stalled.
  - Second call, same window: `writeState(dir, 'agent-x', 'busy', conf.stallTimeout * 1000 + 5000)` (just *over* `stallTimeout`), same non-matching tail. Assert `assert.deepEqual(result, { state: 'stalled', reason: 'inventory-timeout' })`.
- [ ] For every test added in this step, confirm the exact tail strings chosen genuinely satisfy/fail `grepMatches(busyPattern/idlePattern, tail)` for the `conductor.conf` patterns the test's `baseConf()` resolves (call `readConductorConf(DEFAULT_CONF_PATH)` mentally or via a throwaway `console.log` while iterating, then remove the debug line) — do not guess from memory, since a wrong tail string makes the assertion pass for the wrong reason.

### 2. Verify  <!-- agent: general-purpose -->

- [ ] From `host-server/`, run `npm test` (i.e. `node --import tsx/esm --test`) and confirm all new and existing tests in `state.test.ts` pass.
- [ ] From `host-server/`, run `npx tsc --noEmit` and confirm no new type errors.
- [ ] If any new test fails, fix the test's fixture setup (tail text, ageMs buffer, conf overrides) — do not weaken or remove assertions to make it pass.
