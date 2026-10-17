---
id: TASK-0211
aliases: [TASK-0211]
title: "Propagate a newly created worktree/branch to all clients without a reload"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: []
blocks: [TASK-0218]
parallel_safe_with: [TASK-0212]
uat: "[[UAT-0211]]"
tags: [worktree, agents, dashboard, sse, live-update]
---

# TASK-0211 — Propagate a newly created worktree/branch to all clients without a reload

relates_to::[[worktree-on-any-agent]]
blocks::[[TASK-0218]]

> **Roadmap**: ROADMAP-0025 Phase 1, item 3. Research: `raw/research/worktree-on-any-agent/index.md` (Constraints: "No SSE broadcast for worktree changes today").
> **Collision note**: edits `frontend/src/components/AgentList.tsx` (AgentDetailView props + AgentList render) and `host-server/index.ts` (`pollAndDiff` predicate + one route comment). Sequence after TASK-0209 and TASK-0210, which edit the same file. No hard blocker on either.

## Objective

After a worktree is created for an agent (from the menu, the Details button, or a clone), every open dashboard — including the sidebar row's `⎇ <branch>` badge and the sidebar filter — shows the new branch without a page reload. Today only the detail view of the acting client updates (via local `worktreeOverride` state); other clients and the acting client's sidebar wait for a reload.

## Approach

- **Why nothing propagates today.** `POST /agents/:id/worktree` deliberately does not broadcast (a partial `{worktreePath, branch}` `agent-update` would be merged as a status change). And `pollAndDiff()` (`host-server/index.ts` ~2673) only broadcasts an agent when one of `state`/`status.*`/`mode`/`queuedTasks`/`windowPresent`/`activeTask`/`modelId`/`contextPct`/`label`/`usage.*` changed — `worktreePath` and `branch` are in the snapshot (`buildSnapshot` spreads `resolveAgentWorktree(agent)`) and in the broadcast body, but are **not in the change predicate**, so a worktree created on an otherwise-idle agent produces no event at all.
- **Chosen mechanism: extend the diff predicate (poll refresh, full-shaped payload).** Add `prev.worktreePath !== agent.worktreePath || prev.branch !== agent.branch` to the predicate. The periodic broadcast already carries the complete status-shaped record, so there is no partial-payload hazard, and it also covers worktrees created by other paths (clone, out-of-band DB edits, the read-side self-heal that clears a vanished worktree). Latency is at most one `statusPollMs` tick (default 2000 ms, `host-server/config.ts`). Rejected alternative: broadcasting a hand-built payload from the route — it would duplicate the ~15-field status shape and drift (the clone route's hand-built payload already omits `status`, `role`, `worktreePath`, `branch`; fixing that is TASK-0215).
- **Testability.** `pollAndDiff` is inline in the `index.ts` monolith, so extract the predicate into a pure `agentSnapshotChanged(prev, next)` in a new `host-server/agentDiff.ts` (structural types, no imports from `index.ts`) and unit-test it. The existing regex-style source test `sseRolePayloadParity.test.ts` stays valid (the broadcast body is not reordered).
- **Acting client feels instant.** Add an `onWorktreeCreated(id, worktreePath, branch)` callback from `AgentDetailView` to `AgentList` that patches `agents` state (same pattern as `onRoleChanged`), so the acting client's sidebar badge updates immediately rather than after the next tick. Other clients get it from the SSE event. The local `worktreeOverride` in `AgentDetailView` stays as-is (it is `agent.worktreePath ?? override`, so it is harmless once state catches up).

## Steps

### 1. Extract and extend the change predicate  <!-- agent: general-purpose -->

- [x] Create `host-server/agentDiff.ts` exporting `DiffableAgent` (fields: `state`, `status: { display; reason; needsAttention }`, `mode`, `queuedTasks`, `windowPresent`, `activeTask`, `modelId`, `contextPct`, `label`, `usage: { costUsd?: number; outputTokens?: number } | null`, `worktreePath: string | null`, `branch: string | null`) and `agentSnapshotChanged(prev: DiffableAgent | undefined, next: DiffableAgent): boolean` — the exact current predicate from `pollAndDiff` (~2675–2690) plus the two worktree comparisons.
- [x] `host-server/index.ts` `pollAndDiff`: replace the inline `if (!prev || … )` condition with `if (agentSnapshotChanged(prev, agent))`; keep the transition-log and idle-dispatch blocks unchanged inside it (they read `prev`, so keep `const prev = …` and use `prev` where they already do). Do not reorder the `broadcastSSE('agent-update', …)` body (`sseRolePayloadParity.test.ts` asserts `worktreePath`, `branch`, `role` are adjacent).
- [x] Update the comment on `POST /agents/:id/worktree` (~1197–1202): it currently says "the next status poll picks up worktreePath/branch for everyone else", which was false; say instead that the periodic diff now emits a full-shaped `agent-update` within one status tick because `worktreePath`/`branch` are part of `agentSnapshotChanged`.
<!-- Updated: 2026-09-20 step 1 done -->
- [x] Create `host-server/agentDiff.test.ts`: (a) identical agents → `false`; (b) `worktreePath` null→set → `true`; (c) `branch` null→set → `true`; (d) worktree cleared (set→null, the self-heal case) → `true`; (e) `!prev` → `true`; (f) one representative pre-existing field per group (`state`, `status.display`, `queuedTasks`, `usage.costUsd`) still triggers, guarding against the extraction dropping a clause.

### 2. Optimistic patch for the acting client's sidebar  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.tsx` `AgentDetailView` props (~600): add optional `onWorktreeCreated?: (id: number, worktreePath: string, branch: string) => void`; in `handleCreateWorktree` (~715) call it right after `setWorktreeOverride(...)`.
<!-- Updated: 2026-09-20 step 2 done -->
- [x] In `AgentList` (~2222–2247) pass `onWorktreeCreated={(id, worktreePath, branch) => { setAgents((prev) => prev.map((a) => a.id === id ? { ...a, worktreePath, branch } : a)) }}` next to `onRoleChanged`, with a one-line comment that the SSE `agent-update` from the host-server reconciles for every other client.

### 3. Frontend tests  <!-- agent: general-purpose -->

<!-- Updated: 2026-09-20 step 3 done (note: sub-agent appended tests via bash heredoc, a mcp-tools guide deviation; append-only, verified passing) -->
- [x] `frontend/src/components/AgentList.test.tsx`: (a) creating a worktree from the detail view makes the sidebar row show `⎇ conductor/<id>` immediately (assert the badge inside the sidebar row, not the Details tab); (b) an incoming SSE `agent-update` carrying `worktreePath`/`branch` for an agent that had none updates its sidebar badge and the detail view's Worktree row (use the file's existing SSE test helper for `agent-update`); (c) an SSE update with `worktreePath: null, branch: null` removes the badge (self-heal path).

### 4. Verify  <!-- agent: general-purpose -->

<!-- Updated: 2026-09-20 step 4 done. Gates on touched files clean; host-server typecheck/lint also reports db.migration.test.ts(1547) `bgHasLinkedAgentColumn` undefined — TASK-0212's in-flight file, not touched by this task. -->
- [x] `cd host-server && npm run typecheck && npm run lint && node --import tsx/esm --test agentDiff.test.ts sseRolePayloadParity.test.ts transitionsLog.test.ts`; `cd frontend && npm run typecheck && npm run lint && npx vitest run src/components/AgentList.test.tsx`.
- [x] [DEFERRED-TO-UAT] Deferred to TASK-0218 (needs two browsers): create a worktree in browser A and watch browser B's sidebar badge appear within ~2 s with no reload.

## Files expected to be touched

`host-server/agentDiff.ts` (new), `host-server/agentDiff.test.ts` (new), `host-server/index.ts` (`pollAndDiff` + one route comment), `frontend/src/components/AgentList.tsx`, `frontend/src/components/AgentList.test.tsx`.

## Dependencies

- No hard blockers. Sequence after TASK-0209/0210 purely for file collisions (`AgentList.tsx`, `index.ts`).
- **Blocks** TASK-0218 (UAT).
- Parallel-safe with TASK-0212 (`git.ts`/`db.ts` only).
- Related: TASK-0215 fixes the clone route's separate hand-built `agent-update` payload; this task does not touch it.
