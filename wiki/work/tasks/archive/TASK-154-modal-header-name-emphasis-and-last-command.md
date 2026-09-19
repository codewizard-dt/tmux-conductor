---
id: TASK-154
aliases: [TASK-154]
title: "Emphasize agent/project name in the modal header and surface the most recent dispatched command"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-154]]"
tags: [frontend]
---

# TASK-154 — Emphasize agent/project name in the modal header and surface the most recent dispatched command

## Objective

In `AgentDetailModal`'s header (`frontend/src/components/AgentList.tsx`), make the agent name and project name read as slightly more prominent (bigger, accented), and add a new row directly under the header showing the most recently dispatched command — reusing the `agent.activeTask` field the backend already tracks (`host-server/state.ts`'s `getActiveTask()`, reading `dispatch.jsonl`), which the agent card already displays but the modal currently does not.

## Approach

Per explicit user decisions:
1. **Agent name** (`AgentList.tsx:688`, currently `text-[15px] font-semibold tracking-tight text-ink`): bump to `text-[17px]` and change the color from plain `text-ink` to `text-accent-blue`.
2. **Project name**: today it only appears as the small `ProjectBadge` pill (`AgentList.tsx:218-239`, `text-[13px]`, per-project hue via `projectHue()`) — there is no separate plain-text project name anywhere to enlarge. Give `ProjectBadge` a new optional `size?: 'sm' | 'md'` prop (default `'sm'` = today's exact 13px behavior, used at every other call site) and have it render `text-[15px]` when `size="md"`. Only the modal header call site passes `size="md"`; the agent-card call site (`AgentList.tsx` ~line 950, inside `AgentItem`) keeps the default and is otherwise untouched. The badge's existing per-project `hsl()` coloring is unchanged and already satisfies "accented" for the project half.
3. **Most recent dispatched command**: reuse `agent.activeTask` (`Agent` type, `AgentList.tsx:37`) **exactly as it already behaves** — populated only while the agent is `busy`/`awaiting`/`stalled` (`host-server/state.ts`'s `getActiveTask()` returns `null` once idle), same as the agent card's existing use of this field (`AgentList.tsx` ~981-984). This is a frontend-only change: no backend field, no new API surface, no change to when `activeTask` is populated — only a new place in the UI that reads it. Render it in a new row that closes the header off, directly below it, mirroring the styling of the existing conditional error-banner row that already sits in that same slot (`AgentList.tsx:795`, `flex-shrink-0 border-b border-line ... px-5 py-1.5 text-[11px]`) but with neutral/monospace styling instead of the red error treatment, since this is informational, not an error.

**Concurrency note — re-locate before editing, do not trust the line numbers below verbatim**: `TASK-148` (actions dropdown) and `TASK-150` (color-palette unification) are both `in-progress` as of this task's filing and are editing this exact same file (`AgentList.tsx`) — `TASK-148` rewrites the action-row block that currently sits inside this same header `<div>` (today ~lines 704-792), and `TASK-150` rewrites `ProjectBadge`'s hue logic (today lines 210-239) as part of unifying the color palette. Before starting, re-read the current state of `AgentDetailModal`'s header block and `ProjectBadge` with Serena (`find_symbol`/`get_symbols_overview`) rather than assuming the line numbers cited here still match — they were current at filing time (2026-09-13) but are likely to have shifted.

## Steps

### 1. Agent name emphasis <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, locate `AgentDetailModal`'s header (re-locate via Serena rather than trusting the line number — was `AgentList.tsx:688` at filing time) and change the agent-name `<span>`'s className from `text-[15px] font-semibold tracking-tight text-ink leading-tight` to `text-[17px] font-semibold tracking-tight text-accent-blue leading-tight`. Leave the `agent.label` sibling span (the purple secondary label shown underneath, when present) unchanged.

### 2. ProjectBadge size variant <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, add an optional `size?: 'sm' | 'md'` prop to `ProjectBadge` (re-locate via Serena — was `AgentList.tsx:218-239` at filing time), defaulting to `'sm'`. Change the pill's `text-[13px]` to a size-conditional value: `'sm'` keeps `text-[13px]`, `'md'` uses `text-[15px]`. Apply this to both the named-project branch and the `null`/"Unassigned" branch for consistency.
- [x] At `AgentDetailModal`'s header call site (`<ProjectBadge name={project} />`, re-locate via Serena — was `AgentList.tsx:693` at filing time), pass `size="md"`. Leave the agent-card call site inside `AgentItem` (re-locate via Serena — was `AgentList.tsx` ~line 950 at filing time) unchanged (implicit `size="sm"` default).
- [x] If `frontend/src/components/AgentList.test.tsx` has a `ProjectBadge` test asserting its className/text-size literally, verify it still passes (it should, since the default `'sm'` behavior is unchanged) — do not add a new test for the `'md'` variant unless one already exists for `'sm'` to mirror.

### 3. Most-recent-command row under the header <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, inside `AgentDetailModal`, add a new conditional row immediately after the header `<div>` closes and before the existing `(renameError ?? closeError ?? removeError)` error-banner conditional (re-locate via Serena — these were adjacent at `AgentList.tsx:793`/`795` at filing time):
  ```tsx
  {agent.activeTask && (
    <div
      className="flex-shrink-0 border-b border-line bg-canvas/50 px-5 py-1.5 font-mono text-[11px] text-muted-2 truncate"
      title={agent.activeTask}
    >
      {agent.activeTask}
    </div>
  )}
  ```
  Do not touch `agent.activeTask`'s definition, population logic, or any other consumer (the agent card's existing use of this same field must keep working unchanged).

### 4. Verify <!-- agent: general-purpose -->

- [x] Run `npm run typecheck` and the existing frontend test suite (`npm test` in `frontend/`) — clean. (typecheck: clean; tests: 97 passed / 7 files passed)
- [DEFERRED-TO-UAT] Via `/run` or `make dev`, open an agent's detail modal: confirm the agent name reads larger and in the blue accent color, the project pill reads larger in the modal header specifically (compare against the same project's badge on its card, which should still be the smaller/default size), and — while that agent is actually busy or awaiting input — confirm the most-recent-command row appears directly under the header with the dispatched command text, and disappears once the agent returns to idle.

<!-- Updated: 2026-09-13 06:04 -->

## Notes

- Deliberately frontend-only: `agent.activeTask`'s existing idle-nulls-it-out behavior is unchanged by this task (a persistent "always show the last dispatched command even when idle" variant was considered and explicitly declined in favor of reusing the existing field as-is).
- See the Concurrency note in Approach — `TASK-148` and `TASK-150` are both mid-flight on this same file at filing time; re-verify current line numbers/structure before editing rather than trusting this file's citations literally. `TASK-152` (merge `AgentTypeBadge`+`RoleBadge` into one header pill, `todo` at filing time) also targets this same header row and may land before or during this task — re-check the header's current badge composition too, not just line numbers.
