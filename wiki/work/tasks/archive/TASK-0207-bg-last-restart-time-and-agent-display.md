---
id: TASK-0207
aliases: [TASK-0207]
title: "Show last restart time and the triggering agent next to each process"
status: done
created: 2026-09-20
updated: 2026-10-17
depends_on: [TASK-0193, TASK-0205, TASK-0206]
blocks: [TASK-0208]
parallel_safe_with: [TASK-0202, TASK-0203, TASK-0204]
uat: "[[UAT-0207]]"
tags: [bg-processes, frontend, dashboard, restart, audit, roadmap-0024]
---

# TASK-0207 — Show last restart time and the triggering agent next to each process

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
depends_on::[[TASK-0193]]
depends_on::[[TASK-0205]]
depends_on::[[TASK-0206]]
blocks::[[TASK-0208]]

> ROADMAP-0024 Phase 4 (Dashboard & Verify). Data comes from `BgStatus.lastRestart` (`TASK-0193`); the rows it decorates are the Background tab (`TASK-0205`) and the tile, which `TASK-0206` also edits, so this runs after both. It is mostly frontend but includes one small server change (the SSE diff, below) that is required for the value to update live.

## Objective

Once agents and humans can both restart a shared dev server (`TASK-0190`/`0203`/`0206`), the first question anyone asks is "why did it just restart, and who did it?". `TASK-0193` records that in `logs/bg-restarts.jsonl` and exposes `lastRestart: { at, caller } | null` on `BgStatus`, but nothing shows it. Render the last restart time and the triggering caller next to each process, in the Background tab rows and on the bg process tile, and keep it live.

## Approach

- **Type.** Add `lastRestart?: { at: string; caller: string | null } | null` to the frontend `BgProcess` type (`frontend/src/components/AgentList.tsx` ~66; `TASK-0193` only adds it to the host-server `BgStatus`, and `TASK-0191` established that the frontend type lives there, not in `api.ts`). `caller` is the raw `X-Conductor-Agent` value (the agent's tmux window name, `<project>-<name>`), or `null` for a dashboard/human caller.
- **Presentational component.** New `frontend/src/components/BgLastRestart.tsx`, props `{ lastRestart, className? }`, rendering one muted line:
  - `Restarted 3m ago by cool-agent` for an agent caller (`caller` shown verbatim in mono; full ISO timestamp and the raw caller in the `title` tooltip);
  - `Restarted 3m ago from the dashboard` when `caller === null`;
  - `No restarts recorded` when `lastRestart` is null/absent (an older host-server without the field renders the same, no error).
  - Semantic `<time dateTime={at}>` for the timestamp. Do not present the caller as verified: the name is self-reported (`TASK-0193`'s guardrail-not-authentication caveat), so the tooltip says "reported by the caller".
- **Relative time.** Add a pure `formatRelativeTime(iso: string, now: number): string` in `frontend/src/lib/formatRelativeTime.ts` (`just now` < 5 s, `Ns`, `Nm`, `Nh`, `Nd` ago; invalid/future timestamps degrade to the absolute time) with unit tests. The repo already has two private near-duplicates (`CheckpointList.tsx` `formatRelativeTimestamp`, `ScheduleList.tsx` `formatRelative`); do not refactor them here (out of scope), but note in the file comment that they could migrate. Add a tiny `useNow(intervalMs)` hook (`frontend/src/lib/useNow.ts`, 30 s tick, cleared on unmount) so the label ages without a data change; only components that render a relative time subscribe.
- **Placement.**
  - `BackgroundProcessesTab.tsx` (`TASK-0205`, Restart button from `TASK-0206`): second line under each row's name/badge.
  - Tile `BgProcessRow` (`AgentList.tsx` ~1437+): after the launch-command span, on the same wrapping row (`flex-wrap`), before the right-aligned action buttons. Keep the tile from growing: the line is `text-[11px] text-muted-2`, `truncate` with `title`.
- **Live updates: one server-side diff fix.** The dashboard learns about a changed bg process through `bg-update` SSE events, broadcast by `pollAndDiff` only when `windowPresent`, `state`, `liveness` or `linkedAgent` differ (`host-server/index.ts` ~2786). A restart that lands while the window stays present and liveness stays `running` changes only `lastRestart`, so the UI would show a stale value until reload. Fix in this task: (1) add `lastRestart` (compare `at` and `caller`) to that diff condition; (2) confirm `TASK-0190`'s restart route broadcasts `bg-update` with the fresh `BgStatus` (including `lastRestart`) right after a success, and add it if `TASK-0190`/`TASK-0193` did not. This is a two-line change to `host-server/index.ts` plus a unit test for the diff predicate; extract the predicate into a pure `bgStatusChanged(prev, next)` helper (in `host-server/state.ts` or a small `bgDiff.ts`) so it is testable, since `pollAndDiff` itself has no test harness. The initial SSE snapshot (`prevSnapshot.bgProcesses` replay, ~2504) already sends whole objects and needs no change.
- **Optimistic update from `TASK-0206`.** The restart button's optimistic patch should also set `lastRestart: { at: <result.restartedAt>, caller: null }` so the line updates instantly; the SSE event then reconciles (`caller` stays `null` for dashboard callers).
- **Not in scope**: a history list of past restarts (the audit log has it; a viewer would be a separate task), rendering denied/cooldown attempts, linking the caller name to the agent page (would need window-name to agent-id matching, which is non-injective, see `TASK-0194`).

## Steps

### 1. Confirm inputs  <!-- agent: Explore -->

- [x] With Serena `find_symbol`, read the merged `BgStatus.lastRestart` in `host-server/index.ts` (`buildBgStatuses`, `RestartHistory` in `host-server/bgRestartPolicy.ts`), the `pollAndDiff` bg diff (~2784-2790), and the restart route's post-success behavior (does it `broadcastSSE('bg-update', ...)`?); record both answers in this task's Approach
- [x] Read `BackgroundProcessesTab.tsx`, `BgRestartButton.tsx` and `BgProcessRow` after `TASK-0205`/`TASK-0206` landed; note the row layout to place the new line

### 2. Server: keep it live  <!-- agent: general-purpose -->

- [x] Extract `bgStatusChanged(prev, next)` (pure; compares `windowPresent`, `state`, `liveness`, `linkedAgent` while it still exists, and `lastRestart.at`/`lastRestart.caller`) and use it in `pollAndDiff` in place of the inline condition
- [x] Ensure the restart route broadcasts `bg-update` with the fresh status after success (add if missing) — decided NOT to add (see Completion notes): the route deliberately emits no SSE and the poll diff now carries `lastRestart` within one 2s tick; an immediate broadcast could publish a transient liveness that the next poll (matching `prevSnapshot`) would never correct
- [x] Add `host-server` unit tests for `bgStatusChanged` (each field flips it; identical statuses do not; null to non-null `lastRestart` flips it; both null does not); run `cd host-server && npx tsc --noEmit && npm test`

### 3. Frontend  <!-- agent: general-purpose -->

- [x] Add `lastRestart` to `BgProcess` in `AgentList.tsx` (already present from TASK-0193); create `frontend/src/lib/formatRelativeTime.ts`, `frontend/src/lib/useNow.ts` and `frontend/src/components/BgLastRestart.tsx`
- [x] Render `<BgLastRestart>` in `BackgroundProcessesTab.tsx` rows and in `BgProcessRow` (tile); extend the optimistic patch in `handleBgRestarted` (`TASK-0206`) to set `lastRestart` from the response's `restartedAt`

### 4. Tests  <!-- agent: general-purpose -->

- [x] `frontend/src/lib/formatRelativeTime.test.ts`: each unit boundary, `just now`, invalid string, future timestamp
- [x] `frontend/src/components/BgLastRestart.test.tsx`: agent caller text and tooltip, `null` caller renders "from the dashboard", null/absent `lastRestart` renders "No restarts recorded", `<time dateTime>` set, the label ages when `useNow` ticks (`vi.useFakeTimers`)
- [x] Extend `AgentList.test.tsx` and `BackgroundProcessesTab.test.tsx`: the line appears on a tile and on a tab row; a `bg-update` SSE carrying a new `lastRestart` updates the rendered text
- [x] Run `cd frontend && npx tsc --noEmit`, the frontend unit tests and eslint on the touched files
- [x] [DEFERRED-TO-UAT] Record a live recipe (owned by `TASK-0208`'s UAT): restart a throwaway process via the dashboard (line reads "from the dashboard" immediately, no reload) and via `dev-commands.sh restart` from an agent in the same project (line shows that agent's window name within a couple of seconds); reload the page and the value persists (comes from `bg-restarts.jsonl`, not memory)

## Completion notes

<!-- Updated: 2026-09-20 02:45 -->

- **Step 1 findings.** `buildBgStatuses` sets `lastRestart: getRestartHistory(logDir).lastRestart(slug)` (log-seeded `RestartHistory`). `pollAndDiff` compared only `windowPresent`/`state`/`liveness` (`linkedAgent` is already gone from `BgStatus`, TASK-0197/0198). The restart route (`POST /bg-processes/:slug/restart`) emits no SSE by design (its comment says `bg-update` comes from the poll diff); the frontend types `BgLastRestart`/`BgProcess.lastRestart` already existed from TASK-0193, so no type work was needed.
- **Server.** New `host-server/bgDiff.ts` exports pure `bgStatusChanged(prev, next)` (structural `DiffableBg`, mirrors `agentDiff.ts`); `pollAndDiff` now calls it (also compares `lastRestart.at`/`caller`; undefined and null are equal). Test: `host-server/bgDiff.test.ts` (9 cases). No route broadcast added: the poll diff picks the change up within one 2 s tick, and an immediate broadcast from the route could publish a transient liveness (`stopped`/`exited` mid-respawn) that the following poll would not correct because it would equal `prevSnapshot`. The route comment was updated to mention `lastRestart`.
- **Frontend.** New `lib/formatRelativeTime.ts` (+ test; invalid becomes `unknown time`, more than 5 s in the future degrades to the absolute local time, up to 5 s of skew reads `just now`), `lib/useNow.ts` (30 s tick), `components/BgLastRestart.tsx` (+ test; `data-testid="bg-last-restart"`). Tile: rendered in `BgProcessRow` after the launch-command span with `min-w-0 max-w-full truncate`. Tab: the `<li>` became a column and the line sits under the select/restart row, outside the select button so its accessible name is unchanged. The `AgentList.tsx` type import is aliased `BgLastRestart as BgLastRestartValue` to avoid clashing with the component name.
- **Callback signature change.** `BgRestartButton.onRestarted` already passed the result; `BackgroundProcessesTab.onBgRestarted`, `AgentDetailViewProps.onBgRestarted`, `BgProcessRow.onRestarted`, `BgProcessSection.onRestarted` and `handleBgRestarted` now take `(slug, result: BgRestartResult)`, and `handleBgRestarted` also sets `lastRestart: { at: result.restartedAt, caller: null }`. Two existing `BackgroundProcessesTab.test.tsx` assertions were updated for the extra argument.
- **Gates.** `frontend`: `tsc --noEmit` clean, eslint clean on all touched files, vitest (`formatRelativeTime`, `BgLastRestart`, `BackgroundProcessesTab`, `BgRestartButton`, `AgentList`) all pass. `host-server`: `tsc --noEmit` clean, `bgDiff.test.ts` 9/9; full `npm test` has 1 failure in `transitionsLog.test.ts` (source pin on `buildSnapshot`'s `lastDetectionByAgentId` capture, outside this task's region, from another in-flight session).
- **[DEFERRED-TO-UAT] live recipe (owned by TASK-0208's UAT).** Restart a throwaway process from the dashboard: the line reads "Restarted just now from the dashboard" immediately, with no reload. Restart it via `dev-commands.sh restart` from an agent in the same project: the line shows that agent's window name within a couple of seconds. Reload the page: the value persists (comes from `logs/bg-restarts.jsonl`, not memory).

## Files touched

- New: `frontend/src/components/BgLastRestart.tsx` (+ test), `frontend/src/lib/formatRelativeTime.ts` (+ test), `frontend/src/lib/useNow.ts`
- Edited: `frontend/src/components/AgentList.tsx`, `AgentList.test.tsx`, `BackgroundProcessesTab.tsx` (+ test), `host-server/index.ts` (diff predicate call site, possibly one broadcast), `host-server/state.ts` or new `host-server/bgDiff.ts` (+ test)
- Collision notes: `host-server/index.ts` is hot (concurrent backend tasks; two-line edit, re-read before editing); frontend files are shared with `TASK-0205` and `TASK-0206`, which must land first.

## Dependencies

- Depends on: `TASK-0193` (`lastRestart` on `BgStatus` and the audit log it is derived from), `TASK-0205` (Background tab rows), `TASK-0206` (Restart button and its optimistic patch, same rows).
- Blocks: `TASK-0208` (UAT verifies the display).
- Parallel-safe with `TASK-0202`, `TASK-0203`, `TASK-0204` (skill/script only).
