---
id: TASK-0179
aliases: [TASK-0179]
title: "Add a sidebar minimize toggle with a hover-to-expand overlay flyout and a sticky sidebar header"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0170, TASK-0173, TASK-0177]
blocks: []
parallel_safe_with: [TASK-0171, TASK-0174, TASK-0178]
uat: "[[UAT-0179]]"
tags: [frontend, agents-page, sidebar, layout, accessibility, terminal]
---

# TASK-0179 — Add a sidebar minimize toggle with a hover-to-expand overlay flyout and a sticky sidebar header

relates_to::[[sidebar-hover-expand]]
depends_on::[[TASK-0170]]
depends_on::[[TASK-0173]]
depends_on::[[TASK-0177]]

> **Depends on**: TASK-0170 (AgentSidebar), TASK-0173 (pane selection + `terminalSizeProbe` re-base), TASK-0177 (docked `InactiveAgentsPanel`) — all shipped in code (commit 6957b9c), UATs still pending.
> **Parallel-safe with**: TASK-0171, TASK-0174, TASK-0178 (same files, code already shipped; only UAT work remains).
> Research: `raw/research/sidebar-hover-expand/index.md` (wiki: [[sidebar-hover-expand]], [[hover-expand-overlay-flyout-pattern]], [[terminal-size-coupling-to-layout-width]]).

## Objective

Let the user minimize the Agents-page sidebar to a 56px icon rail and get it back on hover. A minimize toggle docks the sidebar to a rail of compact agent rows (status-colored right border, initial chip, attention dot). Hovering or keyboard-focusing the rail opens the full 320px sidebar as an **overlay flyout** over the detail pane — the docked layout width never changes on hover, so the xterm terminal is not refit and the host-side tmux size is not disturbed. Separately, the sidebar's top controls (minimize toggle, text filter, collapsible Inactive Agents section) become **sticky**, and only the project-grouped agent list scrolls beneath them.

## Approach

Decisions (from research + user Q&A, 2026-09-20):

- **Overlay, not push.** `LogTail`'s `ResizeObserver` (`LogTail.tsx` ~L386) refits the local xterm on any container-width change, while `terminalSizeProbe` hard-codes `SIDEBAR_WIDTH_PX` and only re-syncs the host on window `resize`. So hover must leave the docked width alone; only the minimize *toggle* changes the docked width, and it must re-probe.
- **Minimized = icon rail (~56px)**, not fully hidden.
- **Hover-intent:** open after 100 ms, close after 250 ms; `mouseenter`/`mouseleave` semantics; keyboard focus (`onFocus`) opens immediately; Esc closes and returns focus to the toggle (WCAG 1.4.13); selecting a row closes the flyout so the terminal is uncovered.
- **Typing guard (simplest option):** no `LogTail` signal plumbing. The open delay is 450 ms instead of 100 ms whenever keyboard focus is inside the detail pane (`document.activeElement` within the pane region) — this covers Direct Input, which `LogTail` arms by default. It is a delay, not a block.
- **Persistence:** minimized state in `localStorage` (`conductor:sidebarMinimized`), try/catch-guarded, default expanded.
- **Shortcut:** `Cmd+B` on macOS, `Ctrl+B` elsewhere; ignored while typing in `INPUT`/`TEXTAREA`/contentEditable and (non-mac) inside the Direct Input capture surface, where `Ctrl+B` is the tmux prefix / readline "back".
- **Sticky header (added mid-planning):** the sidebar becomes a column: a `flex-shrink-0` header (minimize/expand toggle, text filter, collapsible Inactive Agents section — interpreted from "sidebar button, active/inactive filter and text filter") above a `min-h-0 flex-1 overflow-y-auto` list. The Inactive Agents section's expanded list is height-capped (`max-h-[40vh] overflow-y-auto`) so it can never push the list off-screen. Applies in expanded, flyout and rail states (in the rail only the toggle is in the header).
- **No layout API break:** `SIDEBAR_WIDTH_PX = 320` remains the expanded width; in the default (non-minimized) state the `<aside>` still has inline `width: 320px` so existing width-asserting tests keep passing.
- `AgentSidebar` stays in `AgentList.tsx` (a new `AgentRailItem` lives beside `AgentItem` there) — extracting it would create an `AgentList` ⇄ new-file import cycle (UAT-0177 already gates this class of cycle). `AgentList.tsx` is a hot file: use symbol-level edits and re-read immediately before each edit.

## Steps

### 1. Constants and terminal probe  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 09:47 — done; tsc/eslint clean, terminalSizeProbe.test.ts 8/8. Note: worktree has no node_modules; agents symlink the main repo's root + frontend node_modules temporarily to run gates, then remove the symlinks. -->

- [x] `frontend/src/lib/layoutConstants.ts`: keep `SIDEBAR_WIDTH_PX = 320`; add exported constants `SIDEBAR_RAIL_WIDTH_PX = 56`, `SIDEBAR_MINIMIZED_STORAGE_KEY = 'conductor:sidebarMinimized'`, `HOVER_OPEN_DELAY_MS = 100`, `HOVER_OPEN_DELAY_TYPING_MS = 450`, `HOVER_CLOSE_DELAY_MS = 250`.
- [x] `frontend/src/lib/terminalSizeProbe.ts`:
  - Add module state `let dockedSidebarWidthPx = SIDEBAR_WIDTH_PX` and `let probeOuterEl: HTMLDivElement | null = null`.
  - In `getProbeMount`, replace `outer.style.left = \`${SIDEBAR_WIDTH_PX.toString()}px\`` with `\`${dockedSidebarWidthPx.toString()}px\`` and store `probeOuterEl = outer`.
  - Export `setSidebarDockedWidth(px: number): void`: no-op if `px === dockedSidebarWidthPx`; otherwise update the variable and `probeOuterEl.style.left` (if the probe mount exists); then call `probeAndSyncTerminalSize()` **only if** `hasProbedOnce` is already true (the pending first-render probe will otherwise pick up the new width itself).
- [x] `frontend/src/lib/terminalSizeProbe.test.ts`: keep the existing default-`left` assertion (320px). Add tests (mirroring the file's existing module-reset pattern — note the file must run whole; `-t` on its last case fails standalone): `setSidebarDockedWidth(56)` updates `outer.style.left` to `56px` and triggers a re-probe; calling it again with the same value does not re-probe; calling it before any first probe updates the value but does not probe.

### 2. Hover-expand hook  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 09:52 — done; tsc/eslint clean, useHoverExpand.test.ts 15/15. Discovered: disabling the hook while `open` leaves its internal state true (derived `open && enabled` reads false, but resurfaces if `enabled` returns) — see the subtask added to step 3. -->

- [x] Create `frontend/src/lib/useHoverExpand.ts` exporting `useHoverExpand({ enabled, containerRef, getOpenDelayMs })` returning `{ open, close, containerProps }` where `containerProps = { onMouseEnter, onMouseLeave, onFocus, onBlur, onKeyDown }` spread onto the flyout's container.
  - `open` is derived: return `open && enabled` (do not reset state in an effect — the repo's eslint config flags `react-hooks/set-state-in-effect`).
  - `onMouseEnter`: clear the close timer; if already open do nothing; else start an open timer of `getOpenDelayMs()` ms (`HOVER_OPEN_DELAY_MS` default, evaluated at enter time) that sets `open` true.
  - `onMouseLeave`: clear the open timer; if `containerRef.current` contains `document.activeElement` do **not** close (keyboard focus is inside); else start a `HOVER_CLOSE_DELAY_MS` timer that sets `open` false.
  - `onFocus`: clear both timers, `setOpen(true)` immediately.
  - `onBlur`: if `e.relatedTarget` is not inside `containerRef.current`, `setOpen(false)`.
  - `onKeyDown`: on `Escape` while open, `e.stopPropagation()` is **not** used (Direct Input's own Escape handling lives in `LogTail`); only `close()` when the event target is inside the container.
  - `close()` clears timers and sets `open` false. Clear all timers on unmount (`useEffect` cleanup) and use `useRef<ReturnType<typeof setTimeout> | null>` for timer ids.
- [x] Create `frontend/src/lib/useHoverExpand.test.ts` using `renderHook` from `@testing-library/react` and `vi.useFakeTimers()`: enter opens only after 100 ms; a quick enter→leave never opens; leave closes after 250 ms; re-enter within 250 ms cancels the close; `getOpenDelayMs` returning 450 delays opening to 450 ms; focus opens immediately; blur-out closes; blur-within does not; leave with focus inside does not close; `enabled: false` keeps `open` false and ignores events; unmount clears pending timers (no state update warnings).

### 3. Rail row and sidebar restructure  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 09:55 — done; tsc clean, eslint 0 errors (1 pre-existing exhaustive-deps warning on pendingNotifyTimersRef), full vitest 283/283, no existing tests modified. AgentSidebar call site currently passes PLACEHOLDERS (`minimized={false}`, no-op toggle, `getOpenDelayMs={() => HOVER_OPEN_DELAY_MS}`) — step 4 replaces them. Rail mode uses `p-2` (not `p-3`) so the 32px chip fits 56px. -->

- [x] `frontend/src/components/AgentList.tsx`, beside `AgentItem`: add `AgentRailItem({ agent, selected, onSelect })` — a `role="button" tabIndex={0}` compact row (Enter/Space activate, same handler pattern as `AgentItem`), `aria-label={\`${agent.name} detail\`}` (identical to `AgentItem` so existing selectors keep working), `aria-current={selected ? 'true' : undefined}`, `title={\`${agent.name} — ${STATUS_CONFIG[status].label}\`}`. Content: a rounded initial chip (first character of `agent.name`, uppercased), 4px right border `style={{ borderRightColor: getStatusColor(status) }}` (`border-r-[4px]`, same as `AgentItem`), selected styling `ring-2 ring-accent-blue/50 bg-canvas`, and — when `needsAttention(status)` — a small pulsing dot (`#e5484d` for `stalled`, `#e0901a` otherwise, matching the Direct Input CTA colors) so the attention signal survives the loss of the CTA. Add `motion-reduce:animate-none` to the pulse.
- [x] Restructure `AgentSidebar` (currently `AgentList.tsx` ~L1725): add props `minimized: boolean`, `onToggleMinimized: () => void`, `getOpenDelayMs: () => number`.
  - Outer wrapper `<div ref={containerRef} className="relative flex-shrink-0" style={{ width: minimized ? SIDEBAR_RAIL_WIDTH_PX : SIDEBAR_WIDTH_PX }} {...hover.containerProps}>` — its width is the **docked** width and never changes on hover.
  - Inside it, the existing `<aside id="agents-sidebar" aria-label="Agents">` becomes `absolute inset-y-0 left-0 flex flex-col overflow-hidden border-r border-line` with inline `style={{ width: minimized && !hover.open ? SIDEBAR_RAIL_WIDTH_PX : SIDEBAR_WIDTH_PX }}` (so the non-minimized case keeps inline `320px`), `transition-[width] duration-150 motion-reduce:transition-none`, `bg-canvas/40` when not minimized and **opaque `bg-canvas`** plus `shadow-lg z-30` when minimized (the flyout must not show the terminal through it). `railMode = minimized && !hover.open`.
  - **Sticky header** (`flex-shrink-0`, padding `p-3 pb-0`, bottom border when the list is scrolled is optional): row with the toggle button, then (full mode only) the filter `<input>` (unchanged props/classes), then `InactiveAgentsPanel` wrapped in `<div className="max-h-[40vh] overflow-y-auto">`. Keep the existing `totalAgentCount > 0` guards.
  - **Scrolling list** (`min-h-0 flex-1 overflow-y-auto p-3`): the existing empty-state paragraphs and project groups. In `railMode` render `AgentRailItem`s per group (group label replaced by a thin divider between projects; no `ProjectBadge`/filter/Inactive panel); otherwise render `AgentItem` exactly as today.
  - **Toggle button** (`type="button"`, ref `toggleRef`, `aria-controls="agents-sidebar"`, `aria-expanded={!minimized}`, `aria-label={minimized ? 'Expand sidebar' : 'Minimize sidebar'}`, `title` the same plus the shortcut hint, chevron glyph `‹`/`›`, `focus-visible` ring): calls `onToggleMinimized`. When the flyout is open it acts as the "pin open" control.
  - Selecting a row while `minimized` calls `hover.close()` after `onExpand` so the flyout uncovers the terminal. `Escape` (via `hover.containerProps.onKeyDown`) closes the flyout and moves focus to `toggleRef.current`.
  - Use `useHoverExpand({ enabled: minimized, containerRef, getOpenDelayMs })`.
- [x] (Discovered in step 2) Whenever the toggle flips `minimized`, call `hover.close()` in the toggle's click handler (before/alongside `onToggleMinimized`) so a stale internal `open` cannot resurface as an instant flyout the next time the sidebar is minimized. Add a test for it in step 5 (minimize → hover open → un-minimize → minimize again: flyout stays closed until hovered).

### 4. AgentList state, shortcut, probe sync, typing guard  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 09:59 — done; tsc clean, eslint 0 errors (7 exhaustive-deps warnings on untouched lines/effects in AgentList.tsx + LogTail.tsx), full vitest 283/283. `isMac` is computed inside the shortcut effect (AgentDetailView unchanged). Placeholders from step 3 replaced with real state. -->

- [x] `AgentList` (top-level hooks, **above** the `loading`/`error`/session-dead early returns, per the existing comment about the Rules of Hooks): 
  - `const [sidebarMinimized, setSidebarMinimized] = useState(() => { try { return localStorage.getItem(SIDEBAR_MINIMIZED_STORAGE_KEY) === '1' } catch { return false } })`.
  - `toggleSidebarMinimized = useCallback(...)` that flips state and writes `'1'`/`'0'` in try/catch (compute the next value from the current state, not inside the state updater, so the storage write is not a side effect of the updater).
  - `useEffect(() => { setSidebarDockedWidth(sidebarMinimized ? SIDEBAR_RAIL_WIDTH_PX : SIDEBAR_WIDTH_PX) }, [sidebarMinimized])` (imports from `../lib/terminalSizeProbe` and `../lib/layoutConstants`).
  - Shortcut effect: `document.addEventListener('keydown', …)`; handle `(isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b'`; bail if `e.target` is `INPUT`/`TEXTAREA`/`isContentEditable`; on non-mac also bail when `(e.target as HTMLElement).closest('[data-terminal-capture]')`; then `e.preventDefault()` and toggle. Reuse the `/mac/i.test(navigator.userAgent)` idiom already used by `AgentDetailView`.
  - `detailPaneRef = useRef<HTMLDivElement>(null)`; `getOpenDelayMs = useCallback(() => detailPaneRef.current?.contains(document.activeElement) ? HOVER_OPEN_DELAY_TYPING_MS : HOVER_OPEN_DELAY_MS, [])`.
- [x] In the render: pass `minimized`, `onToggleMinimized`, `getOpenDelayMs` to `AgentSidebar`; attach `ref={detailPaneRef}` to the `role="region"` detail wrapper `<div>` (the selected-agent branch).
- [x] `frontend/src/components/LogTail.tsx`: add `data-terminal-capture="true"` to the `captureRef` div (the Direct Input capture surface) so the non-mac shortcut guard can recognize it. No behavior change otherwise.

### 5. Tests  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 10:30 — 24 new tests added (new top-level describe "AgentList sidebar minimize + hover flyout (TASK-0179)"); tsc clean, eslint 0 errors, full vitest 307 passed (baseline 283). Production fixes made by the test agent: (1) AgentSidebar.handleKeyDown now focuses the toggle BEFORE close() on Escape (previously the focus re-opened the flyout); (2) added data-testid="rail-attention-dot". CAVEAT: one earlier full-suite run reported 1 failed/306 passed (906s, output truncated, not reproduced in 4 later green runs — cause unconfirmed, suspected machine contention); step 6 re-runs the full suite. CLOSED (2026-09-20 10:34, step 5b): focus-loss subtask — rail→flyout focus restore via `data-agent-id` + `useLayoutEffect` keyed on `railMode` (3 new tests; full vitest 310/310, tsc clean, eslint 0 errors). Flyout→rail restore intentionally NOT done (would re-fire the hook's onFocus and re-open the flyout). Real-browser blur behaviour on unmount is unverified → deferred to UAT (see step 6). -->

- [x] `frontend/src/components/AgentList.test.tsx` (reuse `stubSidebarFetch` and the existing `AgentsPage` render helper; clear `localStorage` in `beforeEach`; use `vi.useFakeTimers()` only in the hover cases):
  - Default state unchanged: `aside` `style.width === '320px'`, filter present, no toggle regression (existing TASK-0173 width test must still pass).
  - Toggle button (`aria-label` "Minimize sidebar", `aria-expanded="true"`) minimizes: wrapper docked width `56px`, rows render as rail items (project group labels and filter absent), label flips to "Expand sidebar" with `aria-expanded="false"`; clicking again restores.
  - Persistence: after minimizing, `localStorage['conductor:sidebarMinimized'] === '1'`; a fresh render with that value starts minimized; a throwing `localStorage.getItem` (spy) falls back to expanded without crashing.
  - Flyout: with the sidebar minimized, `mouseEnter` on the wrapper + advancing 100 ms → `aside` width `320px` and full rows/filter visible while the **wrapper's** inline width stays `56px`; `mouseLeave` + 250 ms → back to `56px`; a graze (enter then leave < 100 ms) never opens; focus on a rail row opens immediately; `Escape` closes and focuses the toggle; clicking a rail row selects the agent (detail pane renders) and closes the flyout.
  - Typing guard: with focus inside the detail pane (focus an element in the `role="region"` pane) hover opens only after 450 ms, not 100 ms.
  - Shortcut: `Meta+B` (mac userAgent) / `Ctrl+B` toggles; ignored when the event target is the filter `INPUT`; non-mac ignored when the target has an ancestor with `data-terminal-capture`.
  - Rail attention dot: an `awaiting`/`stalled` agent's rail item renders the attention dot; a busy agent's does not.
  - Sticky header: the `aside` is `flex flex-col`; the filter `<input>` and toggle button are **not** descendants of the scrolling list container (`overflow-y-auto`), and the project groups are; the Inactive Agents section wrapper carries the `max-h-[40vh]` cap.
  - Probe sync: mock `../lib/terminalSizeProbe`'s `setSidebarDockedWidth` and assert it is called with `56` on minimize and `320` on restore, and **not** called on hover open/close.
- [x] Update any existing sidebar test that asserts the `aside`'s overflow/padding classes (search `AgentList.test.tsx`/`InactiveAgentsPanel.test.tsx` for the old `overflow-y-auto`/`p-3` class-string assertions) to the new structure.

- [x] (Discovered in step 5) Fix keyboard focus loss when the flyout opens on keyboard focus: focusing a rail row (Tab) opens the flyout, `AgentSidebar` swaps `AgentRailItem`s for `AgentItem`s (different components, so React remounts them), and DOM focus drops to `document.body` — a keyboard/AT regression. Restore focus to the full row for the same agent after the swap (e.g. give both row variants a `data-agent-id` attribute, remember the focused agent id on `onFocus` from a rail row, and in a `useLayoutEffect` keyed on `railMode` focus `[data-agent-id="<id>"]` inside the aside when the mode flips), and symmetrically restore focus to the rail row when the flyout closes while focus is inside (Escape already focuses the toggle — keep that). Must not re-trigger the hook's `onFocus` open loop (Step 5 already fixed one such loop: focus the toggle *before* `close()` on Escape). Add tests to the TASK-0179 describe in `AgentList.test.tsx`: Tab/focus a rail row → flyout opens and `document.activeElement` is the matching full row (same agent name via aria-label); Escape returns focus to the toggle; no focus loss to `body`. Static gates only.

### 6. Verification and quality gates  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 10:38 — static gates done: tsc clean; eslint src 0 errors / 7 exhaustive-deps warnings (1 in AgentList.tsx:~2133, 6 in LogTail.tsx; believed pre-existing but base commit not linted); vitest run twice, 12 files / 310 of 310 both times (the earlier unexplained 1-failure run did NOT reproduce; cause unconfirmed); no import cycles (useHoverExpand.ts imports only react + layoutConstants; AgentList.tsx is the only component using useHoverExpand/setSidebarDockedWidth). Wiki pages agent-sidebar + sidebar-hover-expand updated. The live browser checks and the real-browser focus check remain [DEFERRED-TO-UAT]. -->

- [x] From `frontend/`: run the project's typecheck (`/typecheck` skill / `tsc --noEmit`), ESLint, and the full Vitest suite; all must pass (baseline before this task was 265/265 per the UAT-0178 partial run). Fix any `restrict-template-expressions` findings with `.toString()` per the repo's existing pattern.
- [x] Confirm no import cycle was introduced (`AgentList.tsx` ⇄ new modules): `useHoverExpand.ts` and the new constants must import nothing from `components/`.
- [DEFERRED-TO-UAT] Live check with the dev servers (`make dev`, dashboard on :4321) using the Playwright MCP or `/run`: (a) minimize → the rail appears and the detail pane widens; the Network tab shows exactly one `POST /api/terminal-size` after the toggle; (b) hover the rail → flyout opens over the pane; **no** new `POST /api/terminal-size`, and `tmux display -p '#{pane_width}'` for the selected agent's pane is unchanged, and the terminal text does not reflow; (c) move the pointer out → flyout closes after ~250 ms; (d) Tab into the rail opens it, Esc closes it and returns focus to the toggle; (e) with Direct Input active, rest the pointer on the rail — it opens after ~450 ms, not 100 ms; (f) scroll a long agent list — toggle, filter and Inactive Agents header stay put; (g) check `NotificationStack` toasts and any confirm dialogs still render **above** the flyout (compare their z-index classes with the flyout's `z-30`; raise theirs or lower the flyout if needed); (h) light and dark themes; (i) `prefers-reduced-motion` disables the width transition.
- [DEFERRED-TO-UAT] (Discovered in step 5b) Real-browser focus check: Tab to a rail row → flyout opens and focus lands on the same agent's full row. jsdom cannot show whether a browser fires `blur` with a null `relatedTarget` when the focused rail row unmounts; if it does, the hook's `onBlur` would close the flyout right after it opens (open/close flicker or a flyout that never stays open on keyboard focus). Also verify: pressing Enter on a flyout row selects the agent and closes the flyout, and focus then falls to `<body>` (the selected row's component unmounts; flyout→rail focus restore is intentionally not implemented) — decide during UAT whether that needs a follow-up.
- [x] After it ships, update `wiki/knowledge/entities/components/agent-sidebar.md` (minimize/flyout/sticky-header now built; `SIDEBAR_RAIL_WIDTH_PX`, `setSidebarDockedWidth`) and append a note to `wiki/knowledge/sources/sidebar-hover-expand.md` — do not edit `raw/`.
