---
id: UAT-0179
aliases: [UAT-0179]
title: "UAT: Add a sidebar minimize toggle with a hover-to-expand overlay flyout and a sticky sidebar header"
status: pending
task: TASK-0179
created: 2026-10-17
updated: 2026-10-17
---

# UAT-0179 — UAT: Add a sidebar minimize toggle with a hover-to-expand overlay flyout and a sticky sidebar header

implements::[[TASK-0179]]

> **Source task**: [[TASK-0179]]
> **Generated**: 2026-10-17

All jsdom-reachable behavior for this feature (toggle, persistence, hover-intent timers, Escape/focus handling, probe-sync call counts, rail attention dot, sticky-header DOM structure) was already promoted to repeatable unit tests during `/tackle`, in `frontend/src/components/AgentList.test.tsx`'s `describe('AgentList sidebar minimize + hover flyout (TASK-0179)')` block (27 tests) and `frontend/src/lib/useHoverExpand.test.ts` (15 tests). This UAT file covers only what those cannot: real browser timing, real tmux/terminal non-interference, real focus/blur on element unmount, visual stacking, theming, and reduced-motion — the items `TASK-0179` step 6 marked `[DEFERRED-TO-UAT]`.

---

## Prerequisites

- [ ] Dev servers running (`make dev` from the repo root): host-server on `:8788`, frontend on `:4321`.
- [ ] Dashboard open at `http://localhost:4321/` with at least one project containing 2+ agents, including one agent in `awaiting` or `stalled` status and one `busy`, so the rail attention dot can be visually differentiated.
- [ ] Browser devtools available: Network tab, the "Emulate CSS media feature prefers-reduced-motion" setting, and the app's own light/dark theme toggle.
- [ ] (Optional, for UAT-UI-002) Shell access to the host tmux session, to run `tmux display -p '#{pane_width}'` against the selected agent's window.

---

## Test Cases

### UAT-UI-001: Minimize toggle collapses the sidebar to a 56px rail and widens the detail pane
- **Page**: `http://localhost:4321/` (Agents)
- **Description**: Verifies the toggle's visible effect and that exactly one terminal-size sync fires.
- **Steps**:
  1. Select an agent so its detail pane renders.
  2. Open the browser's Network tab and clear it.
  3. Click the sidebar's minimize button (the `‹` chevron at the top of the sidebar, `aria-label="Minimize sidebar"`).
  4. Observe the sidebar width, the detail pane width, the toggle's glyph/label, and the Network tab.
- **Expected Result**: The sidebar visually narrows to a 56px icon rail (initial-chip rows only, no filter text or group labels); the detail pane visibly widens; the toggle glyph flips to `›` with `aria-label="Expand sidebar"` and `aria-expanded="false"`; exactly one `POST /api/terminal-size` request appears in the Network tab after the click.
- **Repeatable Unit Test**: Not applicable: requires real browser layout and a real Network panel. The underlying state transition and the `setSidebarDockedWidth` call count are already unit-tested (`AgentList.test.tsx`, "the toggle minimizes to a 56px rail..." and "syncs the docked width to the terminal size probe...").
- [ ] Pass

### UAT-UI-002: Hovering the rail opens a flyout without resizing the terminal or re-syncing the host
- **Page**: `http://localhost:4321/` (Agents, sidebar minimized)
- **Description**: Verifies the core overlay guarantee — hover never touches the docked width or the live terminal.
- **Steps**:
  1. With the sidebar minimized (from UAT-UI-001) and a live agent selected, note the terminal's current text/cursor position.
  2. If shell access is available, run `tmux display -p '#{pane_width}'` for that agent's window and record the value.
  3. Clear the Network tab.
  4. Hover the mouse over the rail and hold for ~150ms.
- **Expected Result**: ~100ms after the hover starts, the sidebar visually expands to 320px as an overlay on top of the detail pane — the detail pane's own width and contents do not shift. The terminal text does not reflow or redraw. No new `POST /api/terminal-size` appears in the Network tab. If checked, `tmux display -p '#{pane_width}'` reports the same value as before.
- **Repeatable Unit Test**: Not applicable: requires a live tmux pane and real terminal rendering, not reproducible in jsdom.
- [ ] Pass

### UAT-UI-003: Moving the pointer away closes the flyout after the close delay
- **Page**: `http://localhost:4321/` (Agents, flyout open from UAT-UI-002)
- **Description**: Verifies the close delay feels deliberate, not instant or stuck.
- **Steps**:
  1. With the flyout open, move the pointer off the sidebar entirely.
  2. Time how long the flyout stays open before collapsing.
- **Expected Result**: The flyout closes back to the 56px rail roughly 250ms after the pointer leaves — not instantly, not indefinitely.
- **Repeatable Unit Test**: Not applicable: exact wall-clock timing in a real browser. The 250ms delay logic itself is unit-tested with fake timers (`useHoverExpand.test.ts`).
- [ ] Pass

### UAT-UI-004: Keyboard Tab opens the flyout and Escape returns focus to the toggle, with no focus loss or flicker
- **Page**: `http://localhost:4321/` (Agents, sidebar minimized)
- **Description**: The real-browser counterpart of a gap jsdom could not rule out — a `blur` fired with a null `relatedTarget` when the focused rail row unmounts could re-close the flyout the instant it opens.
- **Steps**:
  1. Click an empty area of the page so nothing is focused, then press Tab repeatedly until focus visibly reaches a rail row.
  2. Watch closely for any flicker (flyout opening then immediately closing) at the moment focus lands.
  3. Press Escape.
  4. Repeat once more.
- **Expected Result**: Tabbing onto a rail row opens the flyout immediately with no visible delay, and keeps it open with a stable, visible focus ring landing on the *same* agent's full row — never falling back to the page body. No flicker. Escape closes the flyout back to the 56px rail and moves the visible focus ring to the minimize/expand toggle button.
- **Repeatable Unit Test**: Not applicable: jsdom cannot reproduce real blur/focus timing on element unmount. The jsdom-reachable parts are already covered (`AgentList.test.tsx`, "focusing a rail row opens the flyout and restores focus to the same agent's full row (never <body>)" and "Escape after a focus-open returns focus to the toggle...").
- [ ] Pass

### UAT-UI-005: Cmd/Ctrl+B toggles the sidebar, except while typing
- **Page**: `http://localhost:4321/` (Agents)
- **Description**: Verifies the shortcut and its guards against a real OS/browser/terminal, not a simulated keydown.
- **Steps**:
  1. Click an empty area of the page, then press Cmd+B (macOS) or Ctrl+B (other OS).
  2. Click into the sidebar's filter text input and press the shortcut again.
  3. On a non-mac OS: select a live agent, click into its terminal so Direct Input is focused, and press Ctrl+B.
- **Expected Result**: Step 1 toggles the sidebar. Step 2 does not toggle it (focus stays in the input; sidebar state unchanged). Step 3 does not toggle the sidebar — the keystroke is left for the terminal, not intercepted.
- **Repeatable Unit Test**: Not applicable: real OS/browser keyboard-shortcut dispatch and real terminal focus. The handler's guard logic is unit-tested (`AgentList.test.tsx`, the "Cmd/Ctrl+B shortcut" describe block).
- [ ] Pass

### UAT-UI-006: Typing guard — hovering the rail while Direct Input is focused opens the flyout only after the longer delay
- **Page**: `http://localhost:4321/` (Agents)
- **Description**: Confirms a stray pointer pass over the rail doesn't pop the flyout open while the user is mid-keystroke in a real terminal.
- **Steps**:
  1. Select a live agent and click into its terminal so Direct Input is focused.
  2. With the sidebar minimized, hover the rail and time how long until the flyout opens.
- **Expected Result**: The flyout takes noticeably longer to open than in UAT-UI-002 (~450ms vs ~100ms).
- **Repeatable Unit Test**: Not applicable: real wall-clock timing against a live terminal focus state. The 450ms vs 100ms delay selection (`getOpenDelayMs`) is unit-tested (`AgentList.test.tsx`, "typing guard: with focus inside the detail pane, hover opens the flyout after 450ms, not 100ms").
- [ ] Pass

### UAT-UI-007: Sticky sidebar header stays pinned while only the agent list scrolls
- **Page**: `http://localhost:4321/` (Agents, sidebar expanded)
- **Description**: Visual confirmation of the sticky-header requirement added mid-task.
- **Steps**:
  1. In a project/session with enough agents to overflow the sidebar's height (or shrink the browser window height), scroll down inside the agent list.
- **Expected Result**: The minimize toggle, the filter input, and the Inactive Agents section (when present) stay visible and fixed at the top of the sidebar; only the project-grouped agent rows scroll underneath them.
- **Repeatable Unit Test**: Created (TASK-0179 tackle phase): `frontend/src/components/AgentList.test.tsx` — "keeps the toggle, filter and Inactive Agents section in a sticky header outside the scrolling list" asserts the DOM structure; this UAT case adds the real visual/scroll confirmation.
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx -t "keeps the toggle, filter and Inactive Agents section in a sticky header outside the scrolling list"` (run from `frontend/`)
- [ ] Pass

### UAT-UI-008: Dark mode — rail and flyout are opaque, with no terminal bleed-through
- **Page**: `http://localhost:4321/` (Agents)
- **Description**: The flyout and rail are deliberately opaque so the terminal underneath never shows through.
- **Steps**:
  1. Switch the app to the dark theme.
  2. Minimize the sidebar, then hover to open the flyout.
  3. Inspect the rail and flyout backgrounds.
- **Expected Result**: Both the 56px rail and the 320px flyout render with a solid, opaque dark background — no visible terminal text or bleed-through from the detail pane through either. The toggle glyph and status borders remain legible.
- **Repeatable Unit Test**: Not applicable: visual/theme rendering requires a real browser and the project's CSS-variable theme switching.
- [ ] Pass

### UAT-UI-009: `prefers-reduced-motion` disables the width transition
- **Page**: `http://localhost:4321/` (Agents)
- **Description**: Confirms `motion-reduce:transition-none` actually takes effect.
- **Steps**:
  1. In devtools, enable "Emulate CSS media feature `prefers-reduced-motion: reduce`".
  2. With the sidebar expanded, click the minimize toggle and observe whether the width change animates or snaps instantly.
  3. Turn the emulation off and repeat the toggle.
- **Expected Result**: With reduced motion emulated, the width change snaps instantly (no visible slide). With emulation off, the same toggle shows a brief (~150ms) width transition.
- **Repeatable Unit Test**: Not applicable: `prefers-reduced-motion` media-query behavior and the resulting CSS transition are invisible to jsdom's computed styles in this repo's test setup.
- [ ] Pass

### UAT-UI-010: Notifications and confirm dialogs remain visible above the open flyout
- **Page**: `http://localhost:4321/` (Agents)
- **Description**: Checks the flyout's `z-30` doesn't shadow `NotificationStack` (`z-40`) or a centered confirm dialog.
- **Steps**:
  1. Minimize the sidebar and hover the rail to open the flyout.
  2. Trigger an agent status-change notification toast (e.g. let an agent become `awaiting`) while the flyout is open.
  3. From a row inside the open flyout, open an agent's "Remove" confirm dialog.
- **Expected Result**: The notification toast (top-right) and the confirm dialog both render fully visible and interactable on top of the open flyout; the flyout never visually covers or intercepts clicks meant for either.
- **Repeatable Unit Test**: Not applicable: real stacking-context/visual overlay verification across multiple live-rendered components.
- [ ] Pass

### UAT-EDGE-001: Selecting a flyout row via Enter closes the flyout; focus intentionally does not restore to the sidebar
- **Scenario**: `flyout→rail` focus restoration was deliberately not implemented (restoring it would re-open the flyout through the hook's own focus handler) — this verifies the resulting focus landing spot doesn't leave the dashboard unusable.
- **Steps**:
  1. Open the flyout via keyboard Tab (as in UAT-UI-004).
  2. With a row focused inside the open flyout, press Enter to select that agent.
  3. Observe where focus lands, then press Tab once more.
- **Expected Result**: The agent is selected (its detail pane renders) and the flyout closes to the 56px rail. Focus is *not* restored to any sidebar row (expected, by design) and instead falls to the document body. Pressing Tab again moves focus to the next focusable element in normal document order — the app is not stuck. Note during the walkthrough whether this focus jump feels disorienting enough to warrant a follow-up task; it is a known limitation, not a hard failure.
- **Repeatable Unit Test**: Not applicable: real-browser focus-after-unmount behavior. The functional part (selection + close) is already covered (`AgentList.test.tsx`, "clicking a row inside the open flyout selects the agent and closes the flyout").
- [ ] Pass

### UAT-EDGE-002: Minimized state survives a full page reload with no flash of the expanded sidebar
- **Scenario**: `localStorage`-backed persistence must apply before first paint, not after a visible expanded→rail flip.
- **Steps**:
  1. Minimize the sidebar.
  2. Hard-reload the browser page.
- **Expected Result**: After reload, the sidebar renders already minimized (56px rail) — no visible flash of the expanded 320px state before it collapses.
- **Repeatable Unit Test**: Created (TASK-0179 tackle phase): `frontend/src/components/AgentList.test.tsx` — "starts minimized on a fresh render when localStorage already holds \"1\"" covers the read-on-mount mechanism; this UAT case adds the real-reload, flash-of-content check a fresh-render unit test cannot see.
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx -t "starts minimized on a fresh render when localStorage already holds \"1\""` (run from `frontend/`)
- [ ] Pass
