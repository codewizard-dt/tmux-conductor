---
id: TASK-0227
aliases: [TASK-0227]
title: "Replace activeTask with the last payload in the sidebar agent card (full width, truncated)"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0226]
blocks: []
parallel_safe_with: []
uat: "[[UAT-0227]]"
tags: [agents, dashboard, frontend, sidebar, last-payload]
---

# TASK-0227 — Replace activeTask with the last payload in the sidebar agent card (full width, truncated)

relates_to::[[hook-authoritative-last-prompt]]
relates_to::[[last-user-message-capture]]
depends_on::[[TASK-0226]]

> **Roadmap**: ROADMAP-0027 Phase 3, item 4. Research: `raw/research/last-user-message-capture/index.md` (builds on `raw/research/terminal-typed-command-persistence/index.md`).
> **Collision note**: edits `AgentItem` in `frontend/src/components/AgentList.tsx`, the same file TASK-0226 (detail-pane strip), TASK-0200 and TASK-0201 (collapsible sidebar rail, already present in the file as `SidebarRailDot` / the `collapsed` branch of `AgentSidebar`) edit. Sequence after TASK-0226; re-locate every anchor by symbol name, not line number.

## Objective

Show each agent's retained last user-written payload in the sidebar agent card instead of the transient `activeTask`. The line uses the full width of the card, is single-line truncated, carries the full text in its `title`, and renders nothing when the agent has no stored payload. `activeTask` stays in the API/status contract and in the `Agent` interface; only its display use in the card is replaced. The detail-pane strip is TASK-0226; this task reuses its rendering rather than duplicating it.

## Approach

- **Reuse, do not duplicate.** TASK-0226 introduces the shared display logic in `AgentList.tsx`: `useLastPayload(agentId)` (from `frontend/src/lib/lastPayload.ts`, TASK-0224) and the `firstLinePreview()` helper (multi-line payloads display their first line; the full text stays in `title`). Import/call those exact helpers here. If TASK-0226 inlined `firstLinePreview()` inside the detail component, hoist it to module scope (or into `lib/lastPayload.ts`) as part of this task so both call sites share one definition. No second copy.
- **Where it goes.** In `AgentItem` (`AgentList.tsx`, compact sidebar row; the block commented `{/* Active task — own slot when present */}` immediately after the branch badge, currently `{agent.activeTask && (<span className="block truncate font-mono text-[10px] text-muted-2" title={agent.activeTask}>…)}`, ~L1272 at time of writing). Replace it with the last-payload line: `const lastPayload = useLastPayload(agent.id)` at the top of `AgentItem` (hooks must stay above any early return; `AgentItem` has none today), and render `{lastPayload && (<span className="block truncate font-mono text-[10px] text-muted-2" title={lastPayload.text}>{firstLinePreview(lastPayload.text)}</span>)}`. Keep the same classes so card layout/typography does not change. Update the comment to "Last payload — own slot when present".
- **Full width.** `AgentItem`'s root is `flex flex-col gap-1.5`, so a `block truncate` child spans the card's content box; verify no sibling row wraps it in a shrink container. In the 320px sidebar (`SIDEBAR_WIDTH_PX`, `frontend/src/lib/layoutConstants.ts`) the card is ~296px minus padding and border; `truncate` (overflow hidden + ellipsis + nowrap) needs the parent to have a bounded width, which the column flex gives it (`min-w-0` is not needed for a block child of a column flex container, but confirm with a very long unbroken string in the test/UAT).
- **Collapsed 48px rail (TASK-0201).** The rail branch of `AgentSidebar` renders `SidebarRailDot` (a status dot with the name only in `aria-label`/`title`), not `AgentItem`, so it renders no payload text and needs no change. Add a test that in collapsed mode the stored payload text is not in the DOM (`queryByText` null), so a future refactor that mounts `AgentItem` in the rail is caught.
- **Hook cost with many agents.** `useLastPayload` is called once per card. Confirm (read TASK-0224's `lib/lastPayload.ts`) that each per-agent snapshot is referentially stable between changes: `getSnapshot` must return the cached parsed object for an unchanged `localStorage` string (cache keyed by agent id, invalidated only by `saveLastPayload`/`clearLastPayload`/the `storage` event), never `JSON.parse` a fresh object per call, otherwise `useSyncExternalStore` re-renders every card on every store tick or loops. Also confirm the listener notification is per-agent (or that a cheap identity check stops unaffected cards re-rendering). If TASK-0224 does not guarantee this, add a stable-snapshot regression test there or raise it in this task's Notes rather than working around it in `AgentItem`.
- **Empty state.** Nothing rendered (no placeholder line) when the store has no payload or the stored text is empty/whitespace. Agents with no hook and no Add Task submissions therefore look exactly as they do today when idle.
- **Out of scope**: the detail-pane strip (TASK-0226); mirroring SSE `lastPrompt` into the store (TASK-0225); Add Task capture (TASK-0223); clearing the store on agent delete and clone-separation checks (a separate ROADMAP-0027 item); any change to `activeTask` in the API, `Agent` interface or status contract.

## Steps

### 1. Reuse the shared helpers  <!-- agent: general-purpose -->

- [x] Re-locate `AgentItem` and TASK-0226's usage of `useLastPayload` / `firstLinePreview` in `frontend/src/components/AgentList.tsx` via Serena (`find_symbol` `AgentItem` with `include_body=true`); do not trust line numbers.
- [x] If `firstLinePreview()` is not already module-scope-shared (or exported from `lib/lastPayload.ts`), hoist it so the detail strip and the card call the same function.
- [x] Read `frontend/src/lib/lastPayload.ts` (TASK-0224) and confirm the per-agent snapshot stability and per-agent notification described above; record the finding in the Notes below.

### 2. Replace the card line  <!-- agent: general-purpose -->

- [x] In `AgentItem`, add `const lastPayload = useLastPayload(agent.id)` and replace the `activeTask` span with the last-payload span (same classes, `title={lastPayload.text}`, content `firstLinePreview(lastPayload.text)`), rendered only when there is a non-empty payload.
- [x] Leave `agent.activeTask` in the `Agent` interface and everywhere else untouched (the detail modal tests and API contract still use it).
- [x] Confirm the line spans the card width and truncates with an ellipsis in the 320px sidebar; confirm `SidebarRailDot` (collapsed 48px rail) still renders dots only.

### 3. Tests  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.test.tsx`: locate any existing case that asserts the sidebar card shows `activeTask` (the TASK-154 cases near "AgentDetailModal header emphasis and last-command row" scope to the detail dialog via `within(dialog)`; those belong to TASK-0226) and update any card-scoped `activeTask` assertions to the stored-payload behaviour. Scope card queries to `screen.getByRole('complementary', { name: 'Agents' })` so they do not match the detail strip, which will also show the same text.
- [x] Add: (a) card shows the stored payload truncated: seed via `saveLastPayload(agent.id, { text, ts, source: 'hook' })` (or `localStorage.setItem` of `conductor:lastPayload:<id>`), assert the span inside the sidebar has `title` equal to the full text, the truncate class, and only the first line as text for a multi-line payload; (b) card empty state: no stored payload renders no last-payload line, even when `agent.activeTask` is set (the field is no longer displayed in the card); (c) two agents keep separate payloads: seed different payloads for two agents, assert each card shows only its own; (d) collapsed rail renders no payload text.
- [x] Clear `localStorage` (and the store's in-memory cache, via the test reset helper exported by TASK-0224, or `clearLastPayload`) in `beforeEach`/`afterEach` so cases do not leak into each other.

### 4. Verify  <!-- agent: general-purpose -->

- [x] `cd frontend && npm run typecheck && npm run lint && npx vitest run src/components/AgentList.test.tsx src/lib/lastPayload.test.ts`.
- [ ] [DEFERRED-TO-UAT] Human check in a browser: type a message into an agent, reload, and confirm the sidebar card and the detail strip show the same text; check a very long unbroken payload truncates without widening the card; collapse the sidebar to the rail and confirm dots only. Live-fleet verification is a documented UAT step for a human, not something an autonomous agent performs.

## Files expected to be touched

`frontend/src/components/AgentList.tsx`, `frontend/src/components/AgentList.test.tsx`. (Only if the `firstLinePreview()` hoist or a stable-snapshot fix is needed: `frontend/src/lib/lastPayload.ts` and `frontend/src/lib/lastPayload.test.ts`, both owned by TASK-0224 — coordinate rather than fork.)

## Dependencies

- TASK-0226

## Notes

- **Guardrails for the implementer:** never run `install-hooks.sh` against the real `~/.claude` and never edit `~/.claude/settings.json`; never kill or restart tmux windows/sessions or the running host-server/dev servers; live-fleet verification is a documented UAT step for a human, not something an autonomous agent performs.
- **Concurrent-edit hazard:** `AgentList.tsx` is edited by other tasks (TASK-0200, TASK-0201, TASK-0226). Re-read the file and re-locate `AgentItem` via Serena immediately before editing; make a minimal, anchored replacement of the one `activeTask` span.
- **Display shape** (shared design): payload record is `{ text, ts, source: 'hook' | 'add-task' }` under `localStorage` key `conductor:lastPayload:<agentId>`; newest `ts` wins; every storage access is try/catch; `useLastPayload(agentId)` is a `useSyncExternalStore` hook backed by a same-tab listener set.
<!-- Updated: 2026-09-20 -->
- **Implementation (2026-09-20):** `AgentItem` calls `useLastPayload(agent.id)` and `firstLinePreview(lastPayload.text)` (both already exported from `lib/lastPayload.ts` by TASK-0224, imported by TASK-0226; no hoist needed, no second helper). The slot that showed `agent.activeTask` now renders the payload span with the same classes (`block truncate font-mono text-[10px] text-muted-2`), `title` = full stored text, content = first line (+ ' …' for multi-line). It renders nothing when there is no payload or the preview is empty/whitespace. `activeTask` is untouched in the `Agent` interface/API.
- **Snapshot stability finding (TASK-0224 `lib/lastPayload.ts`):** `getLastPayloadSnapshot` returns a per-agent cached object (cache invalidated only by `saveLastPayload`/`clearLastPayload`/`storage` event), so the snapshot is referentially stable. `notify()` wakes every subscribed listener (not per-agent), but `useSyncExternalStore` compares the snapshot by identity, so cards of unaffected agents do not re-render. Existing `lastPayload.test.ts` covers stability and render counts; no change needed there.
- **Rail:** the collapsed 48px rail renders `SidebarRailDot`, not `AgentItem`; verified unchanged and covered by a new test (no payload text or title in the sidebar when collapsed).
- **Tests:** new `describe('AgentList sidebar card last payload (TASK-0227)')` in `AgentList.test.tsx` (6 cases: long single-line truncate + title, multi-line first line, empty state even with `activeTask` set, payload wins over `activeTask`, per-agent isolation + live update, collapsed rail). No pre-existing card-scoped `activeTask` assertion existed; two stale TASK-0226 comments that said the card still showed `activeTask` were updated. Scoped run `-t "sidebar card last payload"`: 6 passed. Full `AgentList.test.tsx` + `lastPayload.test.ts`: 279 passed.
- **Caveat (concurrent edits by another session):** `tsc --noEmit` and eslint report `BgLastRestart` unused (AgentList.tsx:17) and a TS2322 at the `BackgroundProcessesTab` call site (~L1085); both are the other session's bg-restart work, not this task's lines, and were not touched. No diagnostics point at lines edited here.
- The detail-pane strip and the card show the same value by design; a queue-dispatched command can therefore appear as the "last message" (the hook cannot tell typed from dispatched; see ROADMAP-0027 Notes).
