---
id: TASK-142
aliases: [TASK-142]
title: "Widen detectAgentStatus's return type to expose detection reason and matched pattern"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: [TASK-143]
parallel_safe_with: [TASK-144]
uat: "[[UAT-142]]"
tags: [host-server, observability, state, roadmap-019]
---

# TASK-142 — Widen detectAgentStatus's return type to expose detection reason and matched pattern

blocks::[[TASK-143]]

## Objective

`detectAgentStatus()` (`host-server/state.ts`) already computes, at every internal branch, exactly why it landed on the state it returns (state-file value/age, which pattern matched, whether a pane capture was needed) — but only the bare final `AgentRunState` string is returned to callers. Widen the return so that reasoning is available to any caller, without changing the resolved state or any existing behavior. This is the prerequisite for TASK-143 (adding a `transitions.jsonl` log that records *why* a transition happened, not just what it changed to).

## Approach

Change `detectAgentStatus`'s return type from a bare `AgentRunState` to a small object, e.g.:

```ts
export type DetectionReason =
  | 'no-window' | 'exited' | 'starting'
  | 'state-file' | 'busy-recovered' | 'awaiting-pattern'
  | 'regex-fallback' | 'inventory-timeout';

export interface DetectedStatus {
  state: AgentRunState;
  reason: DetectionReason;
  matchedPattern?: 'busy' | 'idle' | 'awaiting';
}
```

Set `reason`/`matchedPattern` at each existing `return` site inside `detectAgentStatus` (`host-server/state.ts:314-423`) — this is mechanical: every `return 'idle'`/`return 'busy'`/etc. site already knows which branch it took (see the function's own doc comment above it, lines 285-313, which already enumerates the branch names — reuse those exact names as `DetectionReason` values so the doc comment and the code stay in sync). No new detection logic, no new `capture-pane` calls, no behavior change to the resolved `state` value.

Update every call site (`mcp__serena__find_referencing_symbols` on `detectAgentStatus`) to destructure `.state` where only the state is needed today (preserving the existing public `agentStatuses[].state` / `status` contract unchanged), while keeping the full `{state, reason, matchedPattern}` object available in `buildSnapshot`'s local scope for TASK-143 to consume later. Do not thread `reason`/`matchedPattern` into the SSE/API payload in this task — that's out of scope; this task only widens the function's own return shape and fixes its callers to compile.

## Steps

### 1. Inspect current signature and call sites <!-- agent: general-purpose -->

- [x] `mcp__serena__find_symbol` on `detectAgentStatus` in `host-server/state.ts` with `include_body=true` to confirm every current `return` statement and its branch condition (no-window, exited, busy/awaiting/idle from state-file, busy-recovered via codex/hook-failure safety net, regex-fallback, starting).
- [x] `mcp__serena__find_referencing_symbols` on `detectAgentStatus` to enumerate every call site (expect `host-server/index.ts`'s `buildSnapshot` at minimum; check for any others, e.g. tests).

### 2. Widen the return type <!-- agent: general-purpose -->

- [x] In `host-server/state.ts`, add the `DetectionReason` union type and `DetectedStatus` interface (or an equivalent shape) near `AgentRunState`'s existing definition.
- [x] Change `detectAgentStatus`'s signature to return `DetectedStatus` instead of `AgentRunState`.
- [x] At each existing `return <value>` site inside the function, replace it with `return { state: <value>, reason: '<matching-reason>', matchedPattern: <'busy'|'idle'|'awaiting'|undefined> }` — derive `reason`/`matchedPattern` from the branch's own condition (e.g. the `busy-recovered` codex/hook-failure branches use `reason: 'busy-recovered'`; the plain regex-fallback tail at the bottom of the function uses `reason: 'regex-fallback'`). Exact per-site mapping resolved via `/research`, see `raw/research/detect-agent-status-reason-mapping/index.md`.

### 3. Fix call sites <!-- agent: general-purpose -->

- [x] In `host-server/index.ts`'s `buildSnapshot` (around line 2299, `const state = detectAgentStatus(...)`), destructure the new return shape (e.g. `const { state, reason, matchedPattern } = detectAgentStatus(...)`) and keep using `state` exactly as before for every existing downstream use (`agentLabelCache`, `buildAgentStatusContract`, `getActiveTask`, the returned `agentStatuses[]` object's `state` field). Keep `reason`/`matchedPattern` as local variables in scope for now (unused is fine — TASK-143 will consume them) rather than threading them further, to keep this task's diff isolated and easy to verify.
- [x] Fix any other call site `find_referencing_symbols` turned up the same way. (6 call sites total, all in `host-server/index.ts`: lines 231, 914, 1032, 1095, 2072, 2298 — see `<!-- Updated -->` note below.)

### 4. Verify <!-- agent: general-purpose -->

- [x] `npm --prefix host-server run typecheck` (or the repo's equivalent strict-typecheck command) passes clean.
- [x] Confirm via `mcp__serena__search_for_pattern` that no call site still expects a bare string from `detectAgentStatus` (e.g. `=== 'idle'` compared directly against the function's own return value rather than against a destructured `.state`). Zero matches for `detectAgentStatus\([^)]*\)\s*===`; exactly 6 call sites (all destructured/`.state`-accessed) + 1 definition confirmed.

## Acceptance Criteria

- [x] `detectAgentStatus` returns `{ state, reason, matchedPattern? }` instead of a bare state string.
- [x] Every existing caller compiles and behaves identically — no change to `agentStatuses[].state`, `status` contract, SSE payloads, or dashboard-visible behavior.
- [x] `reason` values match the branch names already documented in the function's own doc comment (state-file, busy-recovered, pane-dead/exited, regex-fallback, awaiting-pattern, no-window, starting). Full 18-site mapping (including the `inventory-timeout` and unlabeled-site resolutions) recorded in `raw/research/detect-agent-status-reason-mapping/index.md`.

## Verification

- [x] `npm --prefix host-server run typecheck`

<!-- Updated: 2026-09-13 (step 3 complete; all 6 call sites destructured .state, npm --prefix host-server run typecheck now clean, zero errors) -->

### Roadmap

Implements [[ROADMAP-019]] Phase 0 — `wiki/work/roadmaps/ROADMAP-019-agent-status-transition-observability.md`. Grounded in `raw/research/transition-observability/index.md` (Finding F-3: "detectAgentStatus does not currently expose which pattern matched or which branch fired... Widening its return type is the correct fix since the function already has all the information inline at each return site").
