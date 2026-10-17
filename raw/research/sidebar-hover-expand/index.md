---
topic: when the sidebar is minimzied, but then it gains a "hover", it should expand
slug: sidebar-hover-expand
researched: 2026-09-20
sources: [./sources.md]
---

# Research: Sidebar Hover-to-Expand When Minimized

> The Agents-page sidebar has **no minimized state today** — `AgentSidebar` is a fixed 320 px `<aside>` (`SIDEBAR_WIDTH_PX = 320`) — so this request is really two features: (1) a minimize/collapse control that docks the sidebar to a narrow rail, and (2) hover-to-expand on that rail. The important design decision is that hover-expand must be an **overlay flyout**, not a reflow: the rail keeps its docked width in the flex layout and the full-width panel is absolutely positioned over the detail pane. A reflowing (push) expansion would resize the xterm container on every hover (`LogTail`'s `ResizeObserver` refits it) and desynchronize the terminal from the size the host-server was last told about (`terminalSizeProbe` hard-codes `left: SIDEBAR_WIDTH_PX`). Recommended: React-state-driven flyout with hover-intent delays, `focus-within` + Esc-to-dismiss (WCAG 1.4.13), a persisted minimize toggle, and a compact "rail" rendering of `AgentItem` so hidden controls are not left in the tab order.

## Research Questions
1. Does a minimized/collapsed sidebar already exist, and what does the sidebar layout currently look like?
2. What else in the codebase depends on the sidebar's width (terminal sizing, tests)?
3. What are the established patterns for hover-to-expand collapsed sidebars — overlay vs. push, hover-intent, pinning?
4. What accessibility requirements apply to hover-triggered expansion?
5. What is the lowest-risk implementation given the existing stack (React 19, Tailwind 3.4, Vitest/RTL)?

## Current State (Codebase)

- **No minimize state exists.** `AgentSidebar` (`frontend/src/components/AgentList.tsx:1725-1789`) renders `<aside aria-label="Agents" style={{ width: SIDEBAR_WIDTH_PX }} className="flex-shrink-0 overflow-y-auto border-r border-line bg-canvas/40 p-3">` with the filter input, `InactiveAgentsPanel`, and project groups of `AgentItem`s. It takes no collapsed prop and there is no toggle anywhere. A repo-wide symbol/text search for collapse/minimize/hover on the sidebar finds only `InactiveAgentsPanel`'s own collapsed section. [S1] [S8]
- **Layout:** `AgentList` (`AgentList.tsx:1791-2204`) renders `<div className="flex min-h-0 flex-1 border-t border-line">` containing `<AgentSidebar …/>` and then the detail region (`flex min-h-0 min-w-0 flex-1 flex-col`) or the empty-state pane. The sidebar is a flex sibling, so changing its docked width reflows the detail pane. Selection lives in `expandedAgent` state in `AgentList`; the sidebar receives `selectedAgentId` and `onExpand`. [S2]
- **Width constant:** `SIDEBAR_WIDTH_PX = 320` in `frontend/src/lib/layoutConstants.ts:5`. Consumers: `AgentSidebar` (inline width), `terminalSizeProbe.getProbeMount` (positions a hidden probe with `outer.style.left = \`${SIDEBAR_WIDTH_PX}px\``), and two tests that assert it (`AgentList.test.tsx` ~3172-3181 checks `sidebar.style.width === '320px'`; `terminalSizeProbe.test.ts` ~113-119 checks `outer.style.left`). [S3] [S4]
- **Terminal sizing coupling (the key constraint):** `LogTail` mounts xterm in `xtermContainerRef` and attaches `new ResizeObserver(() => fitWithRightEdgeMargin(term, fitAddon))` (`LogTail.tsx:386`), so any change in the detail pane's width refits the *local* terminal immediately. Separately, `terminalSizeProbe.registerResizeListener` only reacts to `window` `resize` (debounced 400 ms) and calls `probeAndSyncTerminalSize()`, which builds an offscreen xterm in a probe mount that assumes the sidebar occupies `SIDEBAR_WIDTH_PX`, fits it, and pushes `cols`/`rows` to the host via `syncTerminalSize`. A sidebar width change never fires a window `resize`, so today's probe would go stale if the docked width changed. [S4] [S5]
- **Row content:** `AgentItem` (`AgentList.tsx:1172-1247`) is a `role="button"` card with `border-r-[4px]` status color from `getStatusColor(status)`, project/type/role/status badges, label, context meter, branch, active task, and a "Direct Input — needs you" CTA. It is designed for ~320 px and has no compact variant. [S6]
- **Stack:** React ^19.2.7, Tailwind ^3.4.17, Vite ^6.3.5, Vitest ^4.1.10 with `@testing-library/react`; no animation or headless-UI dependency. [S7]
- **Prior work:** the sidebar itself was introduced by ROADMAP-0023 (see `agents-page-sidebar-layout` research). That research and roadmap do not mention a minimized state. [S8]

## Key Findings

- **Overlay, not push, is the established shape for hover-expand.** A concrete recent proposal (Chatwoot #15710) specifies: "Hovering over the rail expands the full sidebar over the page, without shifting conversation content. Moving away collapses the preview after a short delay." Pinning is the separate action that "reserves space in the layout and persists the user's preference." [S10] The shadcn sidebar's `collapsible="icon"` mode likewise centres on a fixed icon width constant (`SIDEBAR_WIDTH_ICON = "3rem"`) plus a persisted open/closed state. [S16]
- **In this codebase, push-style expansion is actively harmful.** Each hover would resize the xterm container (refit via `ResizeObserver`, `LogTail.tsx:386`) and the host-side pane size would not follow (probe only runs on window resize and assumes 320 px), producing a terminal whose local cols disagree with what tmux was told. An overlay keeps the docked width constant, so neither the refit nor the probe is affected. [S4] [S5] (inference from the two code paths — no source states this directly)
- **The docked (minimized) width does change layout**, so toggling minimize — unlike hover — *must* re-run `probeAndSyncTerminalSize()` and the probe must read the current docked width instead of the constant. [S4] (inference)
- **Hover-intent:** reacting instantly to hover-off makes edge-grazing flicker; the established remedy is to "wait a split second" before responding, and the "opposite… unhover intent" — react to hover-on immediately but delay hover-off. [S14] Use `mouseenter`/`mouseleave` (not `mouseover`/`mouseout`); a StackOverflow answer shows child hovers (form fields) breaking an expand/collapse sidebar with the latter and working with the former. React's `onMouseEnter`/`onMouseLeave` are the enter/leave semantics. [S15]
- **Accessibility (WCAG 1.4.13, AA):** content revealed on hover/focus must be dismissible, hoverable, and persistent; for an overlay that "obscure[s] page content" the guidance is to "provide a way for users to dismiss any additional content without the need to move their mouse or keyboard focus, such as pressing the Esc key." [S12] Chatwoot's proposal asks for the same: "Escape to dismiss a temporary preview; navigation must not depend exclusively on hover." [S10] CSS-only variants recommend `:has(:focus-within)` so keyboard focus also opens the rail. [S11]
- **Collapsed content must leave the tab order:** "collapsed groups do not leave hidden links in the tab order", and the toggle "exposes aria-expanded." [S13] The rail should therefore *render* a compact variant rather than clip the full one with `overflow-hidden`.
- **Touch:** `:hover` does not fire on touchscreens; provide a click toggle as fallback. [S11] (This is a localhost desktop dashboard, so low priority, but the toggle covers it.)
- **Persistence:** minimized state saved to `localStorage` and restored on mount is the common convention. [S17] Per the harness guidance, this is a per-viewer convenience so reads/writes must be wrapped in try/catch and the page must render correctly without it.
- **Motion:** Tailwind v3 provides `motion-reduce:` / `motion-safe:` variants (`motion-reduce:transition-none`) for honouring `prefers-reduced-motion`. [S9]

## Constraints

- Docked width (rail) must be the only width participating in the flex layout; the expanded panel must not.
- `SIDEBAR_WIDTH_PX` (320) stays the *expanded* width and existing tests asserting `style.width === '320px'` for the default (non-minimized) state must keep passing.
- Terminal probe (`terminalSizeProbe.ts`) and its test must be updated in lockstep with any docked-width change; a dock toggle must trigger a re-probe.
- No new dependencies are needed or wanted (Tailwind 3.4 + React state suffice).
- `AgentList.tsx` is a hot, concurrently edited file (~2200 lines): use symbol-level edits; consider extracting the sidebar chrome into its own component/file to limit collision surface.
- `AgentItem` selection state, status border color, notifications, and Cmd+Shift+Arrow cycling operate on `expandedAgent`/`orderedAgentIds`, not on the DOM — they are unaffected by a rail rendering as long as row handlers are preserved.

## Solution Comparison

| Criteria | A. Overlay flyout (state + hover-intent) | B. Push on hover (animate docked width) | C. CSS-only `group-hover`/`focus-within` overlay |
|----------|------------------------------------------|------------------------------------------|---------------------------------------------------|
| **Approach** | Rail keeps docked width; inner panel is `absolute` at 320 px over the detail pane, opened by hover-intent timers, focus-within, or toggle; Esc dismisses | Docked width animates 56 → 320 on hover, reflowing the detail pane | Same overlay geometry as A but opened purely by `:hover`/`:focus-within`, no JS state |
| **Pros** | No terminal refit or probe churn; matches Chatwoot/VS Code-style behaviour; hover-intent avoids flicker; easy Esc-dismiss and pin | Simplest mental model | Zero JS, no timers to clean up |
| **Cons** | A bit of state + two timers; needs unit tests with fake timers | Refits xterm on every hover; local cols ≠ tmux cols; content jumps under the pointer | No enter/leave delay (flicker), no Esc-dismiss without JS (fails WCAG 1.4.13 dismissible), can't suppress while typing in terminal |
| **Complexity** | Medium | Low to build, High to make correct (probe sync) | Low |
| **Dependencies** | None | None | None |
| **Codebase fit** | Good — isolates layout impact to the dock toggle | Poor — collides with `LogTail`/`terminalSizeProbe` design | Fair |
| **Maintenance** | Small hook + constants | Ongoing terminal-size bugs | Low, but a11y debt |

## Recommendation

**Option A — overlay flyout.** Because "minimized" doesn't exist yet, ship it as one task with two parts (minimize toggle, hover-expand), since hover-expand is meaningless without the rail.

Implementation outline:
1. `layoutConstants.ts`: add `SIDEBAR_RAIL_WIDTH_PX` (≈56) and a `sidebarDockedWidthPx(minimized)` helper; keep `SIDEBAR_WIDTH_PX` as the expanded width.
2. `AgentList`: add `sidebarMinimized` state (lazy init from `localStorage` in try/catch; write on change), a toggle button with `aria-expanded`/`aria-controls`/label, and (optional) a Cmd/Ctrl+B shortcut mirroring the shadcn convention. [S16]
3. `AgentSidebar`: wrap in `<div className="relative flex-shrink-0" style={{ width: docked }}>`; the `<aside>` becomes `absolute inset-y-0 left-0 z-30` with width `docked` ↔ `SIDEBAR_WIDTH_PX` (`transition-[width] motion-reduce:transition-none`, shadow only when overlaying). When not minimized, render exactly as today so existing tests stay green.
4. Hover state via a small hook (e.g. `frontend/src/lib/useHoverExpand.ts`): open on `onMouseEnter` after ~100 ms, close on `onMouseLeave` after ~250-300 ms, open on `onFocus` (focus-within), close on Esc and on blur-out; `clearTimeout` on unmount. Use enter/leave semantics, not over/out. [S14] [S15]
5. Rail rendering: add a `mode: 'full' | 'rail'` to the row so the rail shows a compact row (status-colored right border via `getStatusColor`, project initial/dot, truncated name, unchanged `aria-label`, `aria-current`); the filter input, `InactiveAgentsPanel`, and badges render only in the expanded panel so nothing hidden stays tabbable. [S13]
6. `terminalSizeProbe.ts`: read the docked width (module-level setter or `data-` attribute) instead of the constant; call `probeAndSyncTerminalSize()` after a dock toggle settles. Overlay open/close must not trigger it.
7. Tests (Vitest + RTL fake timers): enter→expanded after delay, leave→collapsed after delay, quick graze doesn't open, focus-within opens, Esc closes, docked width unchanged during hover, probe `left` follows docked width, persistence wrapped in try/catch, default expanded state still `320px`.
8. Verify in the running app (Playwright MCP / `/run`): hover, drag pointer into the terminal, type in an interacting terminal with the rail minimized.

Risks and mitigations:
- *Overlay covers the terminal while typing:* hover-intent delay + Esc; optionally suppress hover-open while the terminal is `interacting` (state lives in `LogTail`, so this would need a small shared signal — decide during implementation).
- *Edge flicker:* asymmetric delays; the flyout is a DOM descendant of the same hover target so moving rail→panel never fires a leave.
- *Stale probe after a dock toggle:* explicit re-probe (step 6); covered by a test.
- *Merge conflicts in `AgentList.tsx`:* extract sidebar chrome to its own file first.
- *z-index collisions:* `NotificationStack` and modals must stay above the flyout — verify.

Alternative if constraints change: if "minimized" should mean *fully hidden* (VS Code auto-hide), keep the same overlay mechanics but use a ~8 px edge hot-zone as the trigger instead of a rail; then the compact row rendering (step 5) is unnecessary.

## Next Steps

- Confirm the intended minimized shape (icon rail vs. fully hidden edge) — the recommendation assumes a rail.
- To create a task: `/task-add sidebar minimize toggle with hover-to-expand overlay flyout (see raw/research/sidebar-hover-expand)`; consider `--roadmap ROADMAP-0023` if that roadmap is still active.
- After implementation, add a UAT covering hover/leave/focus/Esc and terminal sizing.
