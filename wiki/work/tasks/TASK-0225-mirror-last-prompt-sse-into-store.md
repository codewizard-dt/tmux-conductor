---
id: TASK-0225
aliases: [TASK-0225]
title: "Mirror incoming lastPrompt SSE values into the per-agent store, newest timestamp wins"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0222, TASK-0224]
blocks: []
parallel_safe_with: []
uat: "[[UAT-0225]]"
tags: [agents, dashboard, frontend, sse, last-prompt, roadmap-0027]
---

# TASK-0225 — Mirror incoming lastPrompt SSE values into the per-agent store, newest timestamp wins

relates_to::[[hook-authoritative-last-prompt]]
relates_to::[[last-user-message-capture]]
depends_on::[[TASK-0222]]
depends_on::[[TASK-0224]]

> **Roadmap**: ROADMAP-0027 Phase 3, item 2 (`wiki/work/roadmaps/ROADMAP-0027-last-user-payload-per-agent.md`). Research: `raw/research/last-user-message-capture/index.md`, `raw/research/terminal-typed-command-persistence/index.md`.
> **Collision note**: edits `frontend/src/components/AgentList.tsx` (the local `Agent` interface and the two places agent snapshots arrive), the same file TASK-0200, TASK-0201, TASK-0209 and the two ROADMAP-0027 display tasks (TASK-0226/0227) edit. Sequence them; do not parallelize. Re-locate every anchor below via Serena (`find_symbol` / `search_for_pattern`), never trust line numbers. `frontend/src/lib/lastPayload.ts` is owned by TASK-0224 and must NOT be edited here.

## Objective

Make the browser retain the host-server's authoritative `lastPrompt` per agent. When an agent snapshot carrying `lastPrompt: { text, ts }` arrives (initial `GET /status` load or an SSE `agent-update`), write it into the per-agent `localStorage` store from TASK-0224 as `{ text, ts, source: 'hook' }`, keyed by `agent.id`. The store's newest-timestamp-wins rule decides whether it overwrites what is already there (for example a newer Add Task submission from TASK-0223). This is a side-effect-only change: nothing renders differently yet — display is TASK-0226 (detail-pane strip) and TASK-0227 (sidebar card).

## Approach

- **Side effect, not state.** Do not put the payload in React state. The store (`saveLastPayload` + the `useLastPayload(agentId)` hook from TASK-0224) is the single source the display tasks read, so this task only calls `saveLastPayload` from the two snapshot-ingest points.
- **Newest wins lives in the store.** `saveLastPayload` already ignores an incoming value whose `ts` is older than the stored one (TASK-0224 contract). This task must not re-implement that comparison; it only feeds the store and tests the observable outcome.
- **Type.** Add `lastPrompt?: { text: string; ts: string } | null` to the local `Agent` interface in `AgentList.tsx`, next to `activeTask`. The field is optional because older host-server builds, and the clone/spawn one-shot `agent-update` payloads, omit it; `undefined` and `null` both mean "write nothing".
- **`frontend/src/lib/api.ts` needs no change.** Its `activeTask` (`AgentStatusContract`) belongs to the per-agent status-evidence contract, not the `/status` snapshot; the snapshot shape is the local `Agent`/`SessionState` in `AgentList.tsx`. Touch `api.ts` only if the typecheck proves otherwise.
- **Small helper.** Add one module-level function in `AgentList.tsx`, e.g. `mirrorLastPrompt(agent: Pick<Agent, 'id' | 'lastPrompt'>): void`, that returns early unless `lastPrompt` is a non-null object with a non-empty string `text` and a string `ts`, then calls `saveLastPayload(agent.id, { text, ts, source: 'hook' })`. Both ingest points call it; no logic is duplicated.
- **Where it runs.**
  1. The initial `/status` load: inside the `useEffect` that does `fetch(`${apiUrl}/status`)`, in the `.then((data) => ...)` branch, iterate `agentList` and call `mirrorLastPrompt` for each agent. Keep it inside the existing `!hasReceivedSSEStateRef.current` branch only if that is the sole place `agentList` is available; otherwise mirror before the guard, since newest-wins makes a redundant write harmless.
  2. The `useSSEEvent<Agent>('agent-update', (updated) => ...)` handler: call `mirrorLastPrompt(updated)` once, at the top, before `setAgents`.
- **Failure isolation.** `saveLastPayload` is try/catch-wrapped inside the store; still wrap nothing extra here. A storage failure must never break agent rendering or the status/attention logic that shares these handlers.
- **Out of scope**: displaying the payload (TASK-0226/0227), recording Add Task submissions (TASK-0223), clearing on agent delete (a later ROADMAP-0027 item), hook and server capture (TASK-0221/0222).

## Steps

### 1. Type and ingest helper  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.tsx`: import `saveLastPayload` from `../lib/lastPayload` (the module exists once TASK-0224 lands; do not create or edit it).
- [x] Add `lastPrompt?: { text: string; ts: string } | null` to the local `Agent` interface, directly after `activeTask: string | null`.
- [x] Add the module-level `mirrorLastPrompt` helper described above (early return on absent, `null`, empty `text` or non-string `ts`).

### 2. Wire both snapshot-ingest points  <!-- agent: general-purpose -->

- [x] In the initial `/status` load inside `AgentList`'s `useEffect`, call `mirrorLastPrompt(agent)` for every element of `agentList` (locate it via `search_for_pattern` on `fetch(`${apiUrl}/status`)`).
- [x] In the `useSSEEvent<Agent>('agent-update', ...)` callback, call `mirrorLastPrompt(updated)` before `setAgents`. Do not alter the chime/attention logic, `prevStatusRef` bookkeeping or the `{ ...next[idx], ...updated }` merge.
- [x] Do not touch the `agent-removed` handler (store cleanup on delete is a separate roadmap item).

### 3. Tests  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.test.tsx`: add a `describe` block following the existing `fireSSE('agent-update', ...)` pattern (`localStorage.clear()` already runs per test at the top of the file; use the real store, do not mock `../lib/lastPayload`). Cases:
  - (a) an `agent-update` whose payload has `lastPrompt: { text: 'hello', ts: '2026-09-20T10:00:00.000Z' }` results in `localStorage.getItem('conductor:lastPayload:<agent.id>')` parsing to `{ text: 'hello', ts: '2026-09-20T10:00:00.000Z', source: 'hook' }`.
  - (b) newest wins: pre-seed `localStorage` for that agent id with a newer `ts` (and, for example, `source: 'add-task'`), fire an `agent-update` with an older `lastPrompt.ts`, and assert the stored value is unchanged.
  - (c) the converse: an incoming `lastPrompt` with a newer `ts` than the stored one replaces it.
  - (d) `lastPrompt: null` and an omitted `lastPrompt` write nothing (`getItem` returns `null`).
  - (e) the initial `GET /status` response carrying `lastPrompt` for an agent writes the store (reuse the file's existing `fetch` mock pattern for `/status`).
  - (f) keyed by agent id: two agents with different ids and payloads write two separate keys.
- [x] Do not assert any rendered text for the payload; there is no render change in this task.

### 4. Verify  <!-- agent: general-purpose -->

- [x] `cd frontend && npm run typecheck && npm run lint && npx vitest run src/components/AgentList.test.tsx src/lib/lastPayload.test.ts`. Result 2026-09-20: the 6 new TASK-0225 tests plus lastPayload.test.ts pass (7 passed with `-t`). Whole-file gates fail ONLY on other in-flight tasks' code (worktree-menu/BgRestart work: typecheck TS2375 at AgentList.tsx BackgroundProcessesTab/BgProcess sites, eslint unused worktree/restart state, 6 vitest failures in the TASK-0209/0211 describes); no diagnostics point at the TASK-0225 lines (import, `lastPrompt` field, `mirrorLastPrompt`, two call sites, new describe).
- [ ] [DEFERRED-TO-UAT] Live-fleet round trip (type in a real agent, Enter, reload, see the value in the strip and card) is a documented human UAT step under ROADMAP-0027 Phase 4, not an autonomous-agent step.

## Files expected to be touched

`frontend/src/components/AgentList.tsx`, `frontend/src/components/AgentList.test.tsx`, `frontend/src/lib/api.ts` (only if the typecheck requires it).

## Dependencies

- TASK-0222 (host-server puts `lastPrompt` on the agent snapshot and both SSE builders; without it there is nothing to mirror).
- TASK-0224 (`frontend/src/lib/lastPayload.ts` store with `saveLastPayload`; this task imports it and relies on its newest-wins rule).
- Blocks the display tasks TASK-0226 and TASK-0227 in practice (they read the store this task fills), and is not parallel-safe with any other task editing `frontend/src/components/AgentList.tsx` (TASK-0200, TASK-0201, TASK-0209, TASK-0226, TASK-0227).

## Notes

Implementation decisions (2026-09-20): `mirrorLastPrompt` sits before `deriveStatus` in `AgentList.tsx`; the `/status` mirror runs before the `!hasReceivedSSEStateRef.current` guard (agentList is now computed above it; newest-wins makes a redundant write harmless); the SSE connect replay and periodic broadcast both arrive as `agent-update` events, so the single handler call covers them; no `api.ts` change was needed.

Guardrails for whoever implements this task:

- Never run `install-hooks.sh` against the real `~/.claude`, and never edit `~/.claude/settings.json`.
- Never kill or restart tmux windows or sessions, and never kill or restart the running host-server or dev servers; they hot-reload (`tsx watch` / Vite).
- Live-fleet verification (real agents, real hook fires, page reload) is a documented UAT step for a human, not something an autonomous agent performs. Verify with unit tests only.
- Other agents edit this repo concurrently, including `AgentList.tsx`: re-read the target symbols via Serena immediately before editing, and make small targeted edits rather than rewriting the file.
- Shared design (already decided, encode consistently): store key `conductor:lastPayload:<agentId>`, value `{ text, ts, source: 'hook' | 'add-task' }`, newest `ts` wins, every storage access in try/catch, helpers `loadLastPayload` / `saveLastPayload` / `clearLastPayload` and the `useLastPayload(agentId)` hook. Server field: `lastPrompt: { text: string, ts: string } | null`.
