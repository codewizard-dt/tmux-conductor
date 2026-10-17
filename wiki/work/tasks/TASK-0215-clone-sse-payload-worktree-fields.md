---
id: TASK-0215
aliases: [TASK-0215]
title: "Include worktreePath and branch in the clone agent-update SSE payload"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0213]
blocks: [TASK-0218]
parallel_safe_with: [TASK-0214, TASK-0217]
uat: "[[UAT-0215]]"
tags: [worktree, agents, clone, sse, host-server]
---

# TASK-0215 — Include worktreePath and branch in the clone agent-update SSE payload

relates_to::[[worktree-on-any-agent]]
depends_on::[[TASK-0213]]
blocks::[[TASK-0218]]

> **Roadmap**: ROADMAP-0025 Phase 2, item 3. Research: `raw/research/worktree-on-any-agent/index.md` ("The clone SSE payload omits `worktreePath`/`branch`").
> **Collision note**: `host-server/index.ts` — the clone route (also edited by TASK-0213, hence the dependency), and the two sibling one-shot broadcasts in `POST /agents` and `POST /projects/:id/agents`. TASK-0217 edits the `DELETE /agents/:id` region of the same file; disjoint but sequence the commits.

## Objective

The `agent-update` event the host-server broadcasts immediately after `POST /agents/:id/clone` carries `worktreePath` and `branch` (and `role`), so every client shows the clone's `⎇ conductor/<cloneId>` badge from the first event instead of a badge-less row that only fills in on a later poll tick. Today (`index.ts` ~1587–1592) the payload lists `id, name, projectId, projectName, state, mode, agentType, windowPresent, queuedTasks, launchCmd, workdir, linkedBg, activeTask` plus context fields and nothing about the worktree.

## Approach

- **Pure payload builder instead of another hand-built literal.** Four sites hand-assemble the same one-shot `agent-update` body (`POST /agents` ~1110, `POST /agents/:id/window` respawn ~1173, clone ~1587, project spawn ~2344 region) and each has drifted from the periodic full-shaped broadcast. Extract `buildNewAgentUpdate(agent, live)` into `host-server/agentUpdatePayload.ts` (no imports from `index.ts`), returning the existing fields **plus** `worktreePath`, `branch`, `role`, and the `inGitRepo` field from TASK-0209, and unit-test the returned object. Use it in the clone route (this item) and, because the omission is the same bug, in `POST /agents` (the `useWorktree` create path) and `POST /projects/:id/agents`. The respawn payload is left alone (it describes an existing agent whose worktree did not change; the periodic diff from TASK-0211 covers it).
- **Why this is not redundant with TASK-0211.** The periodic diff will broadcast a full record for a brand-new agent within one `statusPollMs` tick (`!prev` is always a change), so the gap self-heals in ~2 s. This task removes the interim badge-less flash and makes the immediate event self-consistent, which matters because TASK-0214 selects the clone the moment `cloneAgent` resolves.
- **Merge semantics.** The frontend does `{ ...next[idx], ...updated }` for known ids and appends `updated` for unknown ones (`AgentList.tsx` ~2062–2070, `useAgents.ts` ~41). Setting `worktreePath: null, branch: null` explicitly for a non-worktree clone is correct (an absent key would also be fine); always send the real value rather than omitting it.

## Steps

### 1. Payload builder  <!-- agent: general-purpose -->

- [x] Create `host-server/agentUpdatePayload.ts` exporting `buildNewAgentUpdate(agent: Pick<Agent, 'id'|'name'|'projectId'|'projectName'|'launchCmd'|'workdir'|'worktreePath'|'branch'|'role'>, live: { state; mode; agentType; windowPresent; queuedTasks?: number; linkedBg?: string | null; activeTask?: string | null; inGitRepo?: boolean; context: Record<string, unknown> })` returning the same key set as the current literal (spread `context` last, as today) plus `worktreePath: agent.worktreePath ?? null`, `branch: agent.branch ?? null`, `role: agent.role`, `inGitRepo`. Import the `Agent` type from `./db.ts` as a type-only import.
- [x] Create `host-server/agentUpdatePayload.test.ts`: (a) a worktree-backed agent yields `worktreePath`/`branch` equal to the agent's values; (b) a non-worktree agent yields explicit `null` for both (keys present); (c) `role` is included; (d) defaults (`queuedTasks` 0, `linkedBg` null, `activeTask` null) match today's clone literal; (e) context fields spread through untouched.

### 2. Adopt it in the three creation routes  <!-- agent: general-purpose -->

- [x] `host-server/index.ts` `POST /agents/:id/clone` (~1580–1593): replace the literal with `broadcastSSE('agent-update', buildNewAgentUpdate(newAgent, { state, mode: windowPresent ? detectAgentMode(...) : 'unknown', agentType, windowPresent, inGitRepo: isInGitRepoCached(newAgent.workdir), context: ctx }))`. Keep the surrounding tmux/status detection lines exactly as they are.
- [x] `POST /agents` (~1110–1115) and the `POST /projects/:id/agents` broadcast (~2344 region): same replacement, passing `newAgent` (which already has `worktreePath`/`branch` set by `createAgent`).
- [x] Do not reorder or touch the periodic `pollAndDiff` broadcast body (`host-server/sseRolePayloadParity.test.ts` regex-asserts `worktreePath`, `branch`, `role` adjacency there).

### 3. Frontend test  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.test.tsx`: an SSE `agent-update` for an **unknown** agent id carrying `worktreePath`/`branch`/`role` appends the agent and its sidebar row shows `⎇ <branch>`; a follow-up periodic-shaped update for the same id keeps the badge. (No production frontend change is expected; if the append path drops `worktreePath`/`branch`, fix it in the handler at ~2062.)

### 4. Verify  <!-- agent: general-purpose -->

- [x] `cd host-server && npm run typecheck && npm run lint && node --import tsx/esm --test agentUpdatePayload.test.ts sseRolePayloadParity.test.ts`; `cd frontend && npm run typecheck && npx vitest run src/components/AgentList.test.tsx`.
- [x] [DEFERRED-TO-UAT] Deferred to TASK-0218 (live): subscribe to `GET /api/events` with `curl -N`, clone with `forceWorktree`, and confirm the first `agent-update` for the new id includes `"worktreePath"` and `"branch"`.

<!-- Updated: 2026-09-20 all steps done. Deviation: the builder omits `linkedBg` (retired by TASK-0197; host-server/bgLinkRetired.test.ts bans the identifier in index.ts/db.ts/config.ts and the current literals no longer carry it). `context` is typed `AgentContext` (not `Record<string, unknown>`) so tsc accepts the spread and the return type stays concrete. The AgentList append path already preserved worktreePath/branch, so no production frontend change. -->

## Files expected to be touched

`host-server/agentUpdatePayload.ts` (new), `host-server/agentUpdatePayload.test.ts` (new), `host-server/index.ts` (clone route + `POST /agents` + project-spawn broadcast sites), `frontend/src/components/AgentList.test.tsx` (test only, unless the append path needs a fix).

## Dependencies

- **Depends on** TASK-0213 (the clone route is rewritten there; a clone can only carry a worktree once the force option exists, and both edit the same handler).
- **Blocks** TASK-0218 (UAT).
- Parallel-safe with TASK-0214 (frontend `AgentList.tsx` menu) and TASK-0217 (DELETE route/teardown module).
