---
id: TASK-0201
aliases: [TASK-0201]
title: "Make the agent sidebar collapsible into a status-dot rail"
status: done
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0170, TASK-0173]
blocks: []
parallel_safe_with: []
uat: "[[UAT-0201]]"
tags: [frontend, agents-page, layout, sidebar, terminal-sizing]
---

# TASK-0201 — Make the agent sidebar collapsible into a status-dot rail

depends_on::[[TASK-0170]]
depends_on::[[TASK-0173]]
relates_to::[[agents-page-sidebar-layout]]

> **Depends on**: TASK-0170 (AgentSidebar), TASK-0173 (detail pane + probe re-based on `SIDEBAR_WIDTH_PX`) — both already in the working tree (pending-uat).
> **Touches the same code as** TASK-0171/0177/0178 (all pending-uat, implemented) — no conflict, but rebase mentally on their final `AgentSidebar` shape.

## Objective

Let the user collapse the Agents page sidebar (`AgentSidebar` in `frontend/src/components/AgentList.tsx`) to a narrow ~48px rail so the detail pane / terminal gets the extra width, and expand it again. The collapsed rail keeps one status-colored dot per agent (tooltip = name, click selects), so at-a-glance status and click-to-select survive collapse. The state persists across reloads, and the terminal size probe re-syncs the tmux window size when the sidebar width changes.

## Approach

**Collapsed form: icon rail, not fully hidden** (user decision). Width goes 320px → 48px; a header toggle button flips it. Rows in the rail are compact status dots built from the existing `getStatusColor()`/`STATUS_CONFIG` (`AgentList.tsx:88-106`), ordered by the same `sortAgentsForSidebar` so it matches what the expanded sidebar and Cmd+Shift+Arrow cycling walk. Filter input, "Show inactive" checkbox, "Reset to A–Z", project headers and drag-reorder are expanded-only (drag/reorder is not offered in the rail).

**tmux sizing: re-probe on toggle** (user decision). `terminalSizeProbe.ts` hard-codes `SIDEBAR_WIDTH_PX` as the hidden probe node's `left` and syncs cols/rows to every tmux window globally (`POST /api/terminal-size`). Collapsing/expanding changes the pane width, so the probe must measure the *current* sidebar width and re-sync (debounced, reusing the existing window-resize path) — accepting that each toggle resizes all agents' tmux windows. `LogTail` already refits xterm on pane size change via its `ResizeObserver` (`LogTail.tsx:385`), so no change is needed there.

**Shared state without an import cycle.** `layoutConstants.ts` must stay dependency-free (`AgentList → LogTail → terminalSizeProbe`; the probe must never import `AgentList`). Add a small new module `frontend/src/lib/sidebarState.ts` (imports only `layoutConstants`) that owns the persisted collapsed flag and a module-level "current sidebar width" the probe reads. `SIDEBAR_WIDTH_PX` stays exported as the *expanded* width (existing tests assert `320`).

**Persistence: localStorage only, no hotkey** (user decision). Key `conductor:sidebarCollapsed`, same try/catch pattern as `frontend/src/lib/agentOrder.ts` (`loadOrder`/`saveOrder`). Default expanded. No keyboard shortcut — the toggle is a button only (avoids conflicts with terminal key capture and Cmd+Shift+Arrow cycling).

**Accessibility.** Toggle is a `<button type="button">` with `aria-expanded`, `aria-controls` (the sidebar's id) and a label that flips between "Collapse sidebar" / "Expand sidebar". Rail dots are `role="button"` (or `<button>`) with `aria-label={agent.name}` and `title`, `aria-current` on the selected agent. Width transition uses `motion-safe:` so reduced-motion users get an instant change.

## Steps

### 1. Sidebar collapsed-state module  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 -->
<!-- Step 1 done: typecheck, eslint, sidebarState tests 8/8 green -->


- [x] In `frontend/src/lib/layoutConstants.ts` add `export const SIDEBAR_COLLAPSED_WIDTH_PX = 48` next to `SIDEBAR_WIDTH_PX = 320`; update the header comment to say `SIDEBAR_WIDTH_PX` is the *expanded* width. Keep the file import-free.
- [x] Create `frontend/src/lib/sidebarState.ts` importing only `./layoutConstants`:
  - `export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'conductor:sidebarCollapsed'`
  - `loadSidebarCollapsed(): boolean` — `localStorage.getItem` inside try/catch, `'true'` → `true`, anything else/throw → `false` (mirror `loadOrder` in `agentOrder.ts`)
  - `saveSidebarCollapsed(collapsed: boolean): void` — try/catch `setItem`, swallow errors
  - module-level `let currentCollapsed = loadSidebarCollapsed()` and `getSidebarWidthPx(): number` returning `SIDEBAR_COLLAPSED_WIDTH_PX` or `SIDEBAR_WIDTH_PX`
  - `setSidebarCollapsed(collapsed: boolean): void` — updates `currentCollapsed` and calls `saveSidebarCollapsed`
- [x] Create `frontend/src/lib/sidebarState.test.ts`: default `false`; round-trips `true`/`false`; garbage value → `false`; `localStorage` throwing on get/set does not throw; `getSidebarWidthPx()` flips with `setSidebarCollapsed`. Use `vi.resetModules()` + dynamic import where module-init state matters.

### 2. Terminal size probe tracks live sidebar width  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 -->
<!-- Step 2 done: tsc, eslint, probe + sidebarState tests 16/16 green. registerResizeListener registers scheduleReprobe directly as the resize handler; new probe tests depend on file's sequential module-state order. -->


- [x] In `frontend/src/lib/terminalSizeProbe.ts` replace the `SIDEBAR_WIDTH_PX` import with `getSidebarWidthPx` from `./sidebarState`. In `getProbeMount()` keep creating the node once, but update `outer.style.left = getSidebarWidthPx().toString() + 'px'` at the top of `probeAndSyncTerminalSize()` (every probe), not only at creation, so a cached mount follows the current width. Store the `outer` element in a module variable alongside `probeMountEl`.
- [x] Extract the debounced re-probe used by `registerResizeListener` into a shared `scheduleReprobe()` (400ms, single timer) and export `reprobeTerminalSize(): void` that calls it. `registerResizeListener` now calls `scheduleReprobe()` from the `resize` handler. Rapid toggling therefore coalesces into one sync.
- [x] Do not change `maybeProbeOnFirstRender()` semantics (one-shot); it now naturally picks up the persisted collapsed width because `sidebarState` initialises from localStorage.
- [x] Update `frontend/src/lib/terminalSizeProbe.test.ts`: the existing test at ~line 113 (`positions the probe node to the right of the sidebar using the shared SIDEBAR_WIDTH_PX`) still holds for the expanded default; add cases that (a) after `setSidebarCollapsed(true)` a probe positions `outer.style.left` at `48px`, (b) `reprobeTerminalSize()` is debounced (fake timers: three calls → one `syncTerminalSize`), (c) a cached mount picks up a width change between probes.

### 3. Collapsible AgentSidebar UI  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 -->
<!-- Step 3 done: tsc + eslint clean, AgentList.test.tsx 158/158 (default-expanded 320px assertion still passes). Collapse behavior not yet exercised in a browser — UAT's job. -->


- [x] In `frontend/src/components/AgentList.tsx`: import `SIDEBAR_COLLAPSED_WIDTH_PX`, `SIDEBAR_WIDTH_PX` from `../lib/layoutConstants`, and `loadSidebarCollapsed`, `setSidebarCollapsed` from `../lib/sidebarState`, plus `reprobeTerminalSize` from `../lib/terminalSizeProbe`.
- [x] Hold `sidebarCollapsed` in `AgentList` (`useState(loadSidebarCollapsed)`, next to `agentOrder`), and pass `collapsed` + `onToggleCollapsed` into `AgentSidebar`. The handler does `setSidebarCollapsed(next)` (module state + persistence), `setState(next)`, then `reprobeTerminalSize()` — only when a terminal has been probed is this meaningful, but calling it unconditionally is harmless (it just re-syncs).
- [x] `AgentSidebar` (`AgentList.tsx:1733`): give the `<aside>` an `id` (e.g. `agent-sidebar`), set `style={{ width: collapsed ? SIDEBAR_COLLAPSED_WIDTH_PX : SIDEBAR_WIDTH_PX }}`, add `motion-safe:transition-[width]`, switch padding to `p-1.5` when collapsed and keep `p-3` expanded, and keep `overflow-y-auto`, `flex-shrink-0`, `border-r`. Keep `aria-label="Agents"`.
- [x] Add the toggle button at the top of the aside (visible in both modes, right-aligned expanded / centered collapsed): chevron icon (rotate/flip by state), `aria-expanded={!collapsed}`, `aria-controls="agent-sidebar"`, `aria-label`/`title` flipping between "Collapse sidebar" and "Expand sidebar". Match the existing button styling (`text-muted hover:text-ink`).
- [x] Collapsed body: skip the filter input, "Show inactive" checkbox, "Reset to A–Z", project headers and the `DndContext`. Render `sortAgentsForSidebar(agents, agentOrder)` as a vertical stack of `SidebarRailDot` buttons (new small component next to `SortableAgentRow`): a ~10px dot using `getStatusColor(deriveStatus(agent))` (or the matching `STATUS_CONFIG[...].dot` class), `aria-label={agent.name}`, `title={agent.name}`, `aria-current={selected ? 'true' : undefined}`, a ring/background highlight when `selected`, `onClick={() => { onExpand(agent.id, false) }}` — same selection callback the rows use. Show the empty-state text only in the expanded view (rail simply renders nothing when there are no agents).
- [x] Verify `SortableAgentRow`/`AgentItem` are not mounted while collapsed so their hover/animate styles and dnd sensors do not run needlessly; expanding remounts them (acceptable — list is local state driven by SSE).

### 4. Tests  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 -->
<!-- Step 4 done: 3 files / 180 tests pass (6 new), tsc clean, eslint clean on AgentList.test.tsx only (not the whole-src lint script). Agent used an inline python3 replace for one test fix instead of Serena — deviation from the mandate, test-file-only. -->


- [x] In `frontend/src/components/AgentList.test.tsx` (existing sidebar test at ~line 3092 asserts inline width `320px`): keep it passing for the default; clear `localStorage` in `beforeEach` so persisted state can't leak between tests. Add tests:
  - clicking "Collapse sidebar" sets inline width to `48px`, hides the filter input and project headers, and shows one dot button per visible agent labelled with its name
  - clicking a rail dot selects that agent and renders the detail pane (same as clicking an expanded row)
  - `aria-expanded` and the button label flip on toggle
  - collapsed state persists: render, collapse, unmount, re-render → still collapsed (`localStorage['conductor:sidebarCollapsed'] === 'true'`)
  - toggling calls `reprobeTerminalSize` (mock `../lib/terminalSizeProbe` alongside the existing `LogTail` mocks)
  - expanding restores the filter input, and the previously typed filter text is preserved (state lives in `AgentList`, not the sidebar)
- [x] Run `cd frontend && npx vitest run src/lib/sidebarState.test.ts src/lib/terminalSizeProbe.test.ts src/components/AgentList.test.tsx`, then `npx tsc --noEmit` and the frontend lint script; all clean.

### 5. Verify live and update docs  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 -->
<!-- Step 5: wiki doc note done; live browser/tmux verification [DEFERRED-TO-UAT] (tackle runs static gates only). The "no keyboard shortcut" claim in the wiki page was recorded from the task, not re-verified in code. -->


- [DEFERRED-TO-UAT] With `make dev` running, open the Agents page (Playwright MCP acceptable): collapse and expand, confirm the terminal refits, and confirm via `GET /api/...` logs or `tmux display -p '#{window_width}'` that the tmux window size changes after the debounce on each toggle. Confirm reload keeps the collapsed state and the first probe uses the collapsed width.
- [x] Update `wiki/knowledge/sources/agents-page-sidebar-layout.md` (the sidebar layout page) with a short "Collapsible sidebar" note linking this task, and mention the `sidebarState.ts` / probe coupling. No other wiki pages required.
