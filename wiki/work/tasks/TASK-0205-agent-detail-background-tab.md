---
id: TASK-0205
aliases: [TASK-0205]
title: "Add a Background tab to the agent detail tablist listing the agent's project's bg processes with a running/exited badge and live output tail (tab hidden when the agent has no project)"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0191, TASK-0192, TASK-0195, TASK-0196]
blocks: [TASK-0206, TASK-0207, TASK-0208]
parallel_safe_with: [TASK-0202, TASK-0203, TASK-0204]
uat: "[[UAT-0205]]"
tags: [bg-processes, frontend, dashboard, agent-detail, liveness, output, roadmap-0024]
---

# TASK-0205 — Add a Background tab to the agent detail tablist listing the agent's project's bg processes with a running/exited badge and live output tail (tab hidden when the agent has no project)

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
relates_to::[[accessible-tabs-pattern]]
relates_to::[[agents-page-sidebar-layout]]
depends_on::[[TASK-0191]]
depends_on::[[TASK-0192]]
depends_on::[[TASK-0195]]
depends_on::[[TASK-0196]]
blocks::[[TASK-0206]]
blocks::[[TASK-0207]]
blocks::[[TASK-0208]]

> ROADMAP-0024 Phase 4 (Dashboard & Verify). Backend inputs are already implemented: the `BgStatus.liveness` field (`TASK-0191`, `pending-uat`) and `GET /bg-processes/:slug/tail` (`TASK-0192`, `pending-uat`). It should start after `TASK-0196` (slug identity changes the bg key/route everywhere in `AgentList.tsx` and `api.ts`) and `TASK-0195` (removes the "Unassigned" bucket, so an agent's project always owns its bg processes). `TASK-0206` (Restart button) and `TASK-0207` (last-restart display) extend the component this task creates.

## Objective

The dashboard shows bg processes only in `BgProcessSection`, which is rendered when **no agent is selected** and groups every project's processes together, with a badge that says `running` whenever the tmux window exists (a crashed dev server at a shell prompt still reads `running`). An agent-detail view offers no way to see the dev servers its own project depends on or read their output. Add a **Background** tab to the agent detail tablist (`AgentInfoTabs` in `AgentDetailView`, `frontend/src/components/AgentList.tsx`) that lists the bg processes of the selected agent's project, each with a real `running`/`exited`/`stopped` badge, and a live, ANSI-clean output tail for the selected process. The tab is omitted entirely when the agent has no project, per the roadmap.

## Approach

- **Two new files, minimal edits to `AgentList.tsx`** (the file is large and hot: `TASK-0196`, `TASK-0201`, and the Phase 4 siblings all touch it):
  - `frontend/src/components/BgLivenessBadge.tsx`: pure presentational badge, `liveness` -> label + color (`running` green, `exited` red, `stopped` amber, undefined -> derive from `windowPresent`: present -> `running`, absent -> `stopped`, so an older host-server without the field still renders). Reuse the theme-aware tokens TASK-140 established (the `text-accent-green`/`--color-status-warn-text` style already used in `AgentDetailView`), not the inline hex values `BgProcessRow` uses today, and check both themes. Accessible name via visible text (never colour alone).
  - `frontend/src/components/BackgroundProcessesTab.tsx`: the tab body. Props: `bgs: BgProcess[]` (already filtered to the agent's project), `projectName: string`, `active: boolean` (whether this tab is the active one).
- **Data source: reuse the live list already in `AgentList` state.** `AgentList` holds `bgs` (`useState<BgProcess[]>`, hydrated from `GET /status` and kept fresh by the `bg-update`/`bg-removed` SSE handlers, keyed by `name` today and by `slug` after `TASK-0196`). Do not add a second fetch or SSE subscription: filter `bgs` by `bg.projectId === agent.projectId` in `AgentList` and pass the result into `AgentDetailView` as a new prop `projectBgs`. This is exactly the data `GET /projects/:id/bg-processes` would give, but with `windowPresent`/`liveness` already attached and updated live.
- **Tab wiring in `AgentDetailView`'s `tabs` array**: `{ id: 'background', label: 'Background (N)' with N = projectBgs.length, present: projectId !== null, content: <BackgroundProcessesTab ... active={activeTabId === 'background'} /> }`, placed after `queued-tasks` and before the data-driven `diff`/`usage`/`checkpoints` tabs. `present: false` omits the tab (no disabled tab), and `AgentInfoTabs` already falls back to the first visible tab if the active one disappears. When the project has no bg processes the tab is still present and shows an empty state ("No background processes in <project>. Add one from the navbar.") pointing at the existing Add Background Process trigger rather than hiding the tab (only "no project" hides it).
- **Live output tail, gated on the active tab.** `AgentInfoTabs` keeps **every** present tab's content mounted (`AgentInfoTabDef.content` comment), so a naive effect would poll a hidden panel forever. The tab component polls `bgTail(slug, 200)` (already typed in `frontend/src/lib/api.ts`) **only while** `active && selectedBg && !document.hidden`, every 2 s, with an in-flight guard (skip a tick if the previous request is still pending), an `AbortController`/`cancelled` flag on unmount and on selection change, and it stops when the tab deactivates. Polling is chosen over a new SSE event because the backend already ships the endpoint and adding a `bg-output` broadcast would add server work outside this roadmap; record "SSE push for bg output" as a follow-up in the Notes, mirroring TASK-012's agent precedent. Render `lines` in a `<pre>` (`font-mono text-[11px]`, `whitespace-pre-wrap break-all`, the panel scrolls itself: `AgentInfoTabs` panels are `overflow-y-auto`), auto-scroll to bottom while the user has not scrolled up (stick-to-bottom flag with a threshold), show a small "output truncated to last N lines" hint when `truncated` is true, an `updated <relative time>` from `updatedAt`, and highlight `--- restart <ts> ---` marker lines (muted divider style) since `TASK-0190` writes them. Only re-render when the tail changed (`updatedAt`/`sizeBytes` differ) to avoid churn.
- **List and selection.** A compact process list on top (one row per bg: slug label, `BgLivenessBadge`, launch command truncated with the full command in `title`), selected process highlighted (`aria-current`/`aria-pressed`), default selection = first `exited` process else first process, selection kept by slug across live updates and reset if the selected process disappears. Keyboard: rows are buttons in normal tab order (no custom roving needed for a short list).
- **Error states**: `bgTail` failure shows an inline muted "Could not load output" with a Retry button (next poll also retries); a process with `stopped` liveness still shows its last log (the endpoint reads the file, so the reason it died is visible).
- **The existing tile badge lies too**: `BgProcessRow` still shows `running` from `windowPresent` alone (`AgentList.tsx` ~1440-1447). Swap that badge to `BgLivenessBadge` in this task (small, same component, keeps the two views consistent). This is the only change to `BgProcessRow` here; the Restart action on the tile is `TASK-0206`.
- **Types**: extend `BgProcess` (`AgentList.tsx` ~66) with `liveness` (already added by `TASK-0191`) and, once `TASK-0196` lands, `slug: string`; use `bg.slug ?? bg.name` as the key/route param through one helper `bgKey(bg)` so a later slug change touches one line. `lastRestart` is added by `TASK-0207`, not here.

## Steps

### 1. Confirm inputs  <!-- agent: Explore -->

- [x] With Serena `find_symbol`, read the merged `BgStatus` payload shape (`host-server/index.ts` `buildBgStatuses`: `slug`, `liveness`, `projectId`), the `bgTail` helper and `BgTail` type (`frontend/src/lib/api.ts` ~440-458), the `bg-update`/`bg-removed` SSE handlers and `handleBgUpdated` (`AgentList.tsx` ~2095-2125), and how `AgentDetailView` receives props; record the final key field (`slug` or `name`) in this task
  - Recorded: final key field is **`slug`** (TASK-0196). `BgProcess` (AgentList.tsx ~66) has `slug`, `liveness?: 'running'|'exited'|'stopped'`, `projectId: number`; `bgTail(slug, lines?)` returns `BgTail {slug,name,lines,truncated,sizeBytes,logPath,updatedAt|null}`; no `bgKey` helper exists, everything uses `b.slug`; `bgs` state lives in `AgentList`, `AgentDetailView` has no bgs prop yet.
- [x] Read `frontend/src/components/AgentInfoTabs.tsx` and `TaskList.tsx`/`DiffPanel.tsx` (`onPresenceChange`) for the conventions a tab body follows; check `frontend/src/styles/global.css` and the TASK-140 tokens for the badge colours
  - Recorded: all present tabs stay mounted (inactive panels `hidden`), so polling must gate on an `active` prop; `CheckpointList` (parent-gated synchronous `present`) is the model; tokens `text-accent-green`, `text-accent-red`, `text-[var(--color-status-warn-text)]`, `text-muted`, `border-line`, `bg-canvas`.
<!-- Updated: 2026-09-20 -->
  - Step 3 note: `projectBgs` is a required prop, so 21 direct `<AgentDetailView>` renders in `AgentList.test.tsx` need `projectBgs={[]}` (Step 4), and the "bg-update merges by slug" test (~3314) asserts the old `window missing` text.


### 2. Badge and tab components  <!-- agent: general-purpose -->

- [x] Create `frontend/src/components/BgLivenessBadge.tsx` per Approach (props `{ liveness?: BgProcess['liveness']; windowPresent: boolean }`)
- [x] Create `frontend/src/components/BackgroundProcessesTab.tsx`: process list, selection state, gated polling effect with in-flight guard/abort, `<pre>` output with stick-to-bottom, truncation hint, restart-marker styling, empty and error states
- [x] Put the polling logic in a small hook `useBgTail(slug, enabled)` in the same file (or `frontend/src/lib/useBgTail.ts`) so it is unit-testable with fake timers

### 3. Wire into `AgentList.tsx`  <!-- agent: general-purpose -->

- [x] Add the `projectBgs` prop to `AgentDetailViewProps`, compute it in `AgentList` (`bgs.filter(b => b.projectId === selectedAgent.projectId)`, null project -> empty) and pass it at the `<AgentDetailView>` call (~2225)
- [x] Add the `background` entry to the `tabs` array (~853) with `present: projectId !== null` and `active={activeTabId === 'background'}`
- [x] Replace the inline window-based badge in `BgProcessRow` (~1440-1447) with `<BgLivenessBadge>`
- [x] Update the comment at `AgentList.tsx` ~641-655 only if the tab list description there enumerates tabs

### 4. Tests  <!-- agent: general-purpose -->

- [x] `frontend/src/components/BgLivenessBadge.test.tsx`: each liveness value renders its label; undefined liveness falls back to `windowPresent`
- [x] `frontend/src/components/BackgroundProcessesTab.test.tsx` (vitest + Testing Library, `afterEach(cleanup)` like `AgentInfoTabs.test.tsx`; mock `bgTail`, `vi.useFakeTimers`): lists only the passed bgs with badges; default selection prefers an `exited` process; polling does **not** start while `active` is false and starts when it flips true; polls again after 2 s; no second request while one is in flight; stops on unmount and on tab deactivation; restart marker lines styled; `truncated` hint shown; empty state text; error state with Retry
- [x] Extend `frontend/src/components/AgentList.test.tsx`: Background tab is present with the count for an agent whose project has bg processes; **absent** for an agent with `projectId: null`; absent tab does not break the tablist; only the agent's own project's bgs are listed when two projects have processes; the tile badge shows `exited` for a `liveness: 'exited'` bg with `windowPresent: true`
- [x] Run `cd frontend && npx tsc --noEmit`, the frontend unit tests, and eslint on the new/edited files; run `cd host-server && npx tsc --noEmit` only if any shared type was touched (none expected)
- [x] Record a live UI recipe marked `[DEFERRED-TO-UAT]` (owned by `TASK-0208`'s UAT): select an agent in a project with a running dev server, open Background, see `running` + scrolling clean output; crash the process in its tmux window and see the badge flip to `exited` within a poll; select an agent with no project and confirm no Background tab; switch to another tab and confirm (network panel) polling stops

## Files touched

- New: `frontend/src/components/BgLivenessBadge.tsx`, `frontend/src/components/BackgroundProcessesTab.tsx`, their `.test.tsx` files
- Edited: `frontend/src/components/AgentList.tsx` (prop threading, one tab entry, one badge swap), `frontend/src/components/AgentList.test.tsx`
- No `host-server/` edits. Collision notes: `AgentList.tsx`/`AgentList.test.tsx` are also edited by `TASK-0196` (key/route by slug, must land first), `TASK-0201` and Phase 4 siblings `TASK-0206`/`TASK-0207`, which extend the files this task creates and must run after it.

## Dependencies

- Depends on: `TASK-0191` (`liveness` on the status payload), `TASK-0192` (tail endpoint), `TASK-0195` (every bg process has a project), `TASK-0196` (slug identity used for keys and tail requests).
- Blocks: `TASK-0206` (Restart action sits in this tab), `TASK-0207` (last restart shown in this tab and on the tile), `TASK-0208` (UAT walks through the tab).
- Parallel-safe with `TASK-0202`, `TASK-0203`, `TASK-0204` (skill/script only, no frontend files).

## Notes

- Implementation complete 2026-09-20 (static gates only): `frontend` `tsc --noEmit` clean, eslint clean on touched files, full frontend vitest suite green (329 tests). Live UI verification remains `[DEFERRED-TO-UAT]` (recipe in Step 4, owned by TASK-0208's UAT). `projectBgs` is a required `AgentDetailView` prop; the tile's window-only badge now uses `BgLivenessBadge` (the old `window missing` label became `stopped`).
- Follow-up (not in scope): an SSE `bg-output` push replacing the 2 s poll, mirroring what TASK-012 did for agent terminal output; needs a host-server broadcast loop.
