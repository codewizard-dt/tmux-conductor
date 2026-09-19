---
id: TASK-143
aliases: [TASK-143]
title: "Add transitions.jsonl log to the host-server, capturing reason + pane snapshot per status change"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: [TASK-142]
blocks: [TASK-145]
parallel_safe_with: [TASK-144]
uat: "[[UAT-143]]"
tags: [host-server, observability, logging, roadmap-019]
---

# TASK-143 — Add transitions.jsonl log to the host-server, capturing reason + pane snapshot per status change

depends_on::[[TASK-142]]
blocks::[[TASK-145]]

## Objective

`host-server`'s `pollAndDiff` already detects every agent status transition (all state pairs, every 2s) and already appends a thin `status_transition` event to `observability.jsonl` (`{agentId, agent, previousState, nextState}`, from TASK-089) — but that record carries no detection reason and no pane text, so a transition can't be retroactively analyzed to see *why* it happened or *what the terminal actually showed*. Add a new, dedicated `logs/transitions.jsonl` stream that captures the full picture for every transition, reusing TASK-142's widened `detectAgentStatus` return and the pane tail `buildSnapshot` already captures once per agent per tick — no new `capture-pane` calls.

## Approach

Keep the existing `status_transition` → `observability.jsonl` call in `pollAndDiff` (`host-server/index.ts:2392-2400`) unchanged — it stays the perf/timing surface (per `wiki/knowledge/concepts/local-observability.md`). Add a **new, separate** write to `logs/transitions.jsonl` right alongside it, with a richer payload:

```json
{
  "ts": "2026-09-13T18:04:22.101Z",
  "agentId": 7,
  "agent": "cryptwiz-1",
  "from": "busy",
  "to": "idle",
  "reason": "state-file",
  "matchedPattern": "idle",
  "stateFileAgeS": 31.2,
  "windowPresent": true,
  "queuedTasks": 2,
  "paneTail": ["...", "..."]
}
```

`reason`/`matchedPattern` come from TASK-142's widened `detectAgentStatus` return (threaded through `buildSnapshot` into a per-agent map so `pollAndDiff` can read them for the *current* tick's agent — `pollAndDiff` diffs `current` vs `prevSnapshot`, so the reason must be captured at snapshot-build time and carried on the `Snapshot`'s per-agent entry, not recomputed). `paneTail` reuses `buildSnapshot`'s existing `tail15` capture (`host-server/index.ts:2298`, `capturePaneTail(sessionName, wn, 15, 'snapshot')`) split into lines — do not add a second `capture-pane` call for this.

Follow the existing `appendObservabilityLog` pattern exactly (try/catch, `mkdirSync` + `appendFileSync`, never throw) for the new writer — name it `appendTransitionLog` — so a failure here can never break the poll loop or SSE broadcasting.

## Steps

### 1. Thread reason/matchedPattern/paneTail through the snapshot <!-- agent: general-purpose -->
<!-- Updated: 2026-09-13 15:00 -->

- [x] In `buildSnapshot` (`host-server/index.ts`, ~line 2293-2338), after TASK-142 lands, capture the full `{state, reason, matchedPattern}` from `detectAgentStatus` per agent and store `reason`/`matchedPattern` alongside the existing per-agent fields returned by `buildSnapshot` (extend the `Snapshot`'s per-agent shape with `reason`/`matchedPattern`, or maintain a parallel `Map<agentId, {reason, matchedPattern}>` if extending the public `Snapshot` type is undesirable — prefer whichever keeps the existing `agentStatuses[]` shape's other consumers unaffected). Implemented as module-level `lastDetectionByAgentId: Map<number, {reason, matchedPattern, tail15}>` (~line 2244), populated inside buildSnapshot's per-agent loop (~line 2305).
- [x] Keep the `tail15` string already captured per agent (`host-server/index.ts:2298`) accessible at the same point (it's already a local in `buildSnapshot`'s per-agent map function — thread it the same way as reason/matchedPattern, e.g. into the same side-channel map, since it must not become part of the public `agentStatuses[]` API contract that gets JSON-serialized to every SSE client on every diff). `tail15` is stored in the same `lastDetectionByAgentId` map entry; public `Snapshot.agents[]`/SSE payloads unchanged (verified via find_referencing_symbols).

### 2. Add the appendTransitionLog writer <!-- agent: general-purpose -->
<!-- Updated: 2026-09-13 15:05 -->

- [x] Add `function appendTransitionLog(payload: Record<string, unknown>): void` next to `appendObservabilityLog` (`host-server/index.ts:432`), same try/catch/mkdirSync/appendFileSync pattern, writing `${JSON.stringify({ts: new Date().toISOString(), ...payload})}\n` to `path.join(logDir, 'transitions.jsonl')`. Inserted at lines ~445-456, mirrors appendObservabilityLog's logDir resolution via readConductorConf() and silent-catch. Typecheck clean.

### 3. Call it from pollAndDiff <!-- agent: general-purpose -->
<!-- Updated: 2026-09-13 15:10 -->

- [x] In `pollAndDiff`'s transition-detection block (`host-server/index.ts:2392-2400`, right after the existing `appendObservabilityLog('status_transition', ...)` call), add a call to `appendTransitionLog` with the shape shown in Approach above — `from`/`to` from `prev.state`/`agent.state` (same values already used for the existing `status_transition` event), `reason`/`matchedPattern` from the side-channel captured in Step 1, `stateFileAgeS`/`windowPresent`/`queuedTasks` from fields already present on `agent`/`prev`, and `paneTail` as `tail15.split('\n')` (empty array if no tail was captured, e.g. `no-window`). Implemented at ~line 2415: `stateFileAgeS` from `agent.status.evidence.stateFile.ageSeconds`, `windowPresent`/`queuedTasks` from `agent.windowPresent`/`agent.queuedTasks`, `reason` falls back to `'state-file'` if map entry missing. Existing `status_transition` call left byte-for-byte unchanged. Typecheck clean.

### 4. Verify <!-- agent: general-purpose -->
<!-- Updated: 2026-09-13 15:15 -->

- [x] `npm --prefix host-server run typecheck` passes.
- [DEFERRED-TO-UAT] Start the host-server locally (or via the repo's existing dev command) with at least one live tmux agent, force a real status transition (e.g. dispatch a task to an idle agent, or manually flip a `.state` file), and confirm a new line appears in `logs/transitions.jsonl` with a non-empty `paneTail` and a plausible `reason`.
- [x] Confirm the existing `observability.jsonl` `status_transition` event is unchanged (same fields as before — this task only adds a new stream, never modifies the old one). Verified: `appendObservabilityLog('status_transition', {agentId, agent, previousState, nextState})` at index.ts:2414-2419 is byte-for-byte the pre-existing 4-field shape; `appendTransitionLog` is a separate call added right after it.

## Acceptance Criteria

- [x] Every agent status transition detected by `pollAndDiff` produces one `logs/transitions.jsonl` record with `from`, `to`, `reason`, `matchedPattern` (when applicable), `stateFileAgeS`, `windowPresent`, `queuedTasks`, and `paneTail`. (implemented; live confirmation deferred to UAT)
- [x] No new `capture-pane` subprocess calls are introduced — `paneTail` reuses the tail already captured in `buildSnapshot` (via the `lastDetectionByAgentId` side-channel's `tail15`).
- [x] `observability.jsonl`'s existing `status_transition` event is untouched — verified byte-for-byte identical at index.ts:2414-2419.
- [x] The writer never throws — `appendTransitionLog` wraps its body in try/catch with an empty catch (never rethrows).

## Verification

- [x] `npm --prefix host-server run typecheck`
- [DEFERRED-TO-UAT] Live transition observed in `logs/transitions.jsonl` (manual, documented above)

### Roadmap

Implements [[ROADMAP-019]] Phase 1 — `wiki/work/roadmaps/ROADMAP-019-agent-status-transition-observability.md`. Grounded in `raw/research/transition-observability/index.md` (recommended Option B and its Implementation outline steps 3-4).
