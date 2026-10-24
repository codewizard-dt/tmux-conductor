---
id: UAT-0201
aliases: [UAT-0201]
title: "UAT: Make the agent sidebar collapsible into a status-dot rail"
status: skipped
task: TASK-0201
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0201 — UAT: Make the agent sidebar collapsible into a status-dot rail

implements::[[TASK-0201]]

> **Source task**: [[TASK-0201]]
> **Generated**: 2026-09-20

---

## Prerequisites

- [ ] Dev servers running: `make dev` (host-server on port 8788, frontend on port 4321). Live cases use `http://localhost:4321/` (NOT `:4173`, a stale preview build). The Agents page is the `/` route (`frontend/src/App.tsx`).
- [ ] At least two active agents with live tmux windows (`GET http://localhost:8788/api/status` lists `windowPresent: true`), ideally in different statuses (one `busy`, one `idle`) so dot colors can be compared. Viewport at least 768px wide.
- [ ] Browser starts with the sidebar expanded: in devtools run `localStorage.removeItem('conductor:sidebarCollapsed')` and reload before each live case that says "fresh".
- [ ] Do NOT use Clone, Stop or Destroy on a real agent during live cases.

Source under test:
- `frontend/src/components/AgentList.tsx`: `AgentList` (`sidebarCollapsed` state initialised from `loadSidebarCollapsed()`; toggle handler calls `setSidebarCollapsed(next)`, the React setter, then `reprobeTerminalSize()`), `AgentSidebar` (`aside#agent-sidebar[aria-label=Agents]`, inline width `48px` collapsed / `320px` expanded, `motion-safe:transition-[width]`, padding `p-1.5` / `p-3`; toggle `button[aria-controls=agent-sidebar][aria-expanded]` labelled `Collapse sidebar` / `Expand sidebar` with matching `title`; collapsed body is only `SidebarRailDot` buttons in `sortAgentsForSidebar` order), `SidebarRailDot` (`button[aria-label=<agent name>][title=<agent name>]`, `aria-current="true"` and `bg-line ring-2 ring-accent` when selected, 10px inner dot coloured by `getStatusColor(deriveStatus(agent))`).
- `frontend/src/lib/sidebarState.ts` (`conductor:sidebarCollapsed` in localStorage, try/catch on every access, module-level width read by the probe) and `frontend/src/lib/layoutConstants.ts` (`SIDEBAR_WIDTH_PX = 320`, `SIDEBAR_COLLAPSED_WIDTH_PX = 48`).
- `frontend/src/lib/terminalSizeProbe.ts` (`probeAndSyncTerminalSize()` sets the hidden node's `left` from `getSidebarWidthPx()` on every probe; `reprobeTerminalSize()` and the window `resize` listener share one 400ms debounce) posting `{cols, rows}` to `POST /api/terminal-size` (`host-server/index.ts`: cols 20–500, rows 10–200, applied globally to every tmux window in the session).
- `frontend/src/components/LogTail.tsx` refits xterm through its own `ResizeObserver` when the pane width changes.

Coverage note: unit-backed cases run in jsdom (`frontend/src/components/AgentList.test.tsx`, `frontend/src/lib/sidebarState.test.ts`, `frontend/src/lib/terminalSizeProbe.test.ts`; xterm and layout are not real). No unit test covers pixel geometry, the width transition, real xterm refit, real dot colours in light/dark, keyboard focus order, or actual tmux window sizes — those claims are live-only below. Cases wholly covered by a unit test are typed EDGE so `/uat-auto` can judge them from the unit-test evidence; live steps in those cases are optional confirmation. TASK-0201 Step 5's deferred live check (browser + tmux resize + reload) is covered by UAT-INT-001 to UAT-INT-003.

---

## Test Cases

### UAT-EDGE-001: Collapsing shrinks the sidebar to a 48px rail of named dots and hides the expanded-only controls
- **Scenario**: Clicking `Collapse sidebar` sets the aside's inline width to `48px`, removes the filter input, "Show inactive", "Reset to A–Z" and project headers, and leaves the toggle plus exactly one dot button per visible agent, each labelled with the agent's bare name (not `<name> detail`).
- **Steps**:
  1. Run the unit test command below.
  2. Live (fresh): open `http://localhost:4321/`, click the chevron button at the top of the sidebar.
  3. In devtools: `document.querySelector('#agent-sidebar').style.width`, then `[...document.querySelectorAll('#agent-sidebar button')].map(b => b.getAttribute('aria-label'))`.
- **Expected Result**: Unit test passes. Live: width returns `"48px"`; the label list is `['Expand sidebar', <agent names in sidebar order>…]`; no filter input, checkbox, or project heading is visible in the rail.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList collapsible sidebar (TASK-0201) > collapsing sets the inline width to 48px, …`; written by the TASK-0201 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "collapsing sets the inline width to 48px"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-002: Clicking a rail dot selects that agent and renders its detail pane
- **Scenario**: A rail dot's click calls the same select callback as an expanded row (`onExpand(agent.id, false)`): the `<name> detail` region appears to the right of the rail, the clicked dot gets `aria-current="true"`, and the previously selected dot loses it.
- **Steps**:
  1. Run the unit test command below.
  2. Live: collapse the sidebar, click one dot, then a different dot.
  3. In devtools: `document.querySelector('#agent-sidebar [aria-current="true"]')?.getAttribute('aria-label')` after each click.
- **Expected Result**: Unit test passes. Live: the detail view (tab strip incl. Terminal) shows in the pane, switches to the second agent on the second click, and the devtools expression returns the clicked agent's name each time; the selected dot shows a ring.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList collapsible sidebar (TASK-0201) > clicking a rail dot selects that agent and renders its detail pane`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "clicking a rail dot selects that agent"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-003: The toggle's accessible name, title and aria-expanded flip with state
- **Scenario**: Expanded: button named `Collapse sidebar`, `aria-expanded="true"`, `aria-controls="agent-sidebar"`, `title="Collapse sidebar"`. Collapsed: `Expand sidebar`, `aria-expanded="false"`, `title="Expand sidebar"`. Expanding again restores `320px`.
- **Steps**:
  1. Run the unit test command below.
  2. Live: with devtools' accessibility pane (or a screen reader) inspect the toggle in each state.
- **Expected Result**: Unit test passes. Live: name/expanded state match the scenario in both states and the aside's `id` is `agent-sidebar`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList collapsible sidebar (TASK-0201) > flips aria-expanded and the toggle label on each toggle`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "flips aria-expanded and the toggle label"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-004: Collapsed state persists across an unmount/re-render and is written to localStorage
- **Scenario**: Collapsing writes `'true'` under `conductor:sidebarCollapsed`; a fresh mount reads it back and renders the 48px rail with `Expand sidebar` and no filter input. Expanding writes `'false'`.
- **Steps**:
  1. Run the unit test commands below.
  2. Live: collapse, then reload the page (Cmd+R); expand, reload again.
  3. In devtools: `localStorage.getItem('conductor:sidebarCollapsed')` after each action.
- **Expected Result**: Unit tests pass. Live: after collapse + reload the page loads directly in the rail (no flash of the expanded sidebar longer than initial paint) and the key is `"true"`; after expand + reload it loads expanded and the key is `"false"`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`… > persists the collapsed state across an unmount and re-render`) and `frontend/src/lib/sidebarState.test.ts` (`round-trips true and false`, `initialises collapsed from a stored value at module load`, `flips with setSidebarCollapsed and persists the choice`)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/sidebarState.test.ts src/components/AgentList.test.tsx -t "TASK-0201"` — verified: sidebarState 8 passed, AgentList 6 passed (file-scoped run of both files)
- [ ] Pass

---

### UAT-EDGE-005: Unavailable or garbage localStorage falls back to an expanded sidebar without throwing
- **Scenario**: `getItem` throwing, `setItem` throwing (private mode / quota), an absent key, or any stored value other than `'true'` (e.g. `'garbage'`, `'1'`) yields `loadSidebarCollapsed() === false`; toggling still works in memory for the session.
- **Steps**:
  1. Run the unit test command below.
  2. Live (optional): in devtools set `localStorage.setItem('conductor:sidebarCollapsed','garbage')`, reload.
- **Expected Result**: Unit tests pass. Live: the page loads expanded (320px) with no console errors, and the toggle still collapses the sidebar.
- **Repeatable Unit Test**: Created: `frontend/src/lib/sidebarState.test.ts` (`defaults to expanded when nothing is stored`, `treats a garbage stored value as expanded`, `does not throw when localStorage.getItem throws`, `does not throw when localStorage.setItem throws`)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/sidebarState.test.ts` — verified: 8 passed
- [ ] Pass

---

### UAT-EDGE-006: Filter text is preserved across collapse and expand, and the rail respects the active filter
- **Scenario**: The typed filter lives in `AgentList` state, not the sidebar. With filter text set, collapsing shows dots only for matching agents; expanding restores the filter input with the same text.
- **Steps**:
  1. Run the unit test command below.
  2. Live: type part of one agent's name in the filter, collapse, note the dots, expand.
- **Expected Result**: Unit test passes. Live: the rail shows only matching agents; after expanding the input still contains the typed text and the list is still filtered.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList collapsible sidebar (TASK-0201) > expanding restores the filter input with the previously typed text preserved`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "expanding restores the filter input"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-007: The size probe positions its hidden node at the current sidebar width and re-syncs with a debounce
- **Scenario**: After `setSidebarCollapsed(true)` a probe positions its hidden node's `left` at `48px`; a cached probe mount follows a width change between probes (same node, still one in the DOM); three rapid `reprobeTerminalSize()` calls produce one `syncTerminalSize`; toggling the sidebar calls `reprobeTerminalSize` once per toggle.
- **Steps**:
  1. Run the unit test commands below.
- **Expected Result**: All pass.
- **Repeatable Unit Test**: Created: `frontend/src/lib/terminalSizeProbe.test.ts` (`positions the probe node at the collapsed rail width…`, `a cached probe mount picks up a sidebar width change between probes…`, `reprobeTerminalSize is debounced…`) and `frontend/src/components/AgentList.test.tsx` (`… > re-probes the terminal size on every toggle`)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/terminalSizeProbe.test.ts` — verified: 8 passed; and `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "re-probes the terminal size on every toggle"` — verified: 1 passed
- [ ] Pass

---

### UAT-UI-001: The collapsed rail looks right and its dots match each agent's status
- **Page**: `http://localhost:4321/`
- **Description**: Visual check of geometry and status colours, which jsdom cannot verify.
- **Steps**:
  1. Fresh (expanded) load. Note the status-coloured right border of each expanded row (busy vs idle agent).
  2. Click the chevron. Observe the rail: it should be a narrow column, dots vertically stacked and centred, toggle at the top centred, no horizontal scrollbar on the aside, detail pane/empty state widened to fill the freed space.
  3. Compare each dot's colour against the same agent's row border in step 1 (busy vs idle differ). Hover a dot: name tooltip appears.
  4. Select an agent: its dot gets a ring and a subtle background.
  5. Toggle the theme (light ↔ dark) and re-check dot visibility against the sidebar background.
- **Expected Result**: Dot colours correspond to the row status colours; the selected dot is clearly distinguishable; dots are legible in both themes; nothing is clipped or overflowing at 48px; the toggle chevron flips direction (left when expanded, right when collapsed).
- [ ] Pass

---

### UAT-UI-002: Keyboard access and agent cycling work while collapsed
- **Page**: `http://localhost:4321/`
- **Description**: The toggle and rail dots are real buttons; existing Cmd+Shift+Arrow cycling follows the rail order and no new shortcut was added.
- **Steps**:
  1. Fresh load. Press Tab until the sidebar toggle is focused (visible focus indicator). Press Enter: sidebar collapses. Press Space: sidebar expands.
  2. Collapse again, Tab to a rail dot, press Enter: that agent is selected and its detail pane renders.
  3. With an agent selected and the sidebar collapsed, press Cmd+Shift+Right (Ctrl+Shift+Right off macOS) and Cmd+Shift+Left.
  4. Press Cmd/Ctrl+B in the page (outside the terminal).
- **Expected Result**: Enter/Space activate the toggle and dots; focus stays on the toggle after activation; cycling moves the ringed dot in the rail's top-to-bottom order and swaps the detail pane accordingly; Cmd/Ctrl+B does nothing sidebar-related (no shortcut exists).
- [ ] Pass

---

### UAT-UI-003: Width change is animated normally and instant under reduced motion
- **Page**: `http://localhost:4321/`
- **Description**: `motion-safe:transition-[width]` gates the animation.
- **Steps**:
  1. Fresh load with default OS motion settings. Click the toggle and watch the sidebar.
  2. Enable "Reduce motion" in the OS (macOS: System Settings → Accessibility → Display) or emulate `prefers-reduced-motion: reduce` in devtools Rendering, reload, and toggle again.
- **Expected Result**: Step 1: the width eases between 320px and 48px with no content jump or text wrapping glitch mid-transition beyond the expanded controls disappearing. Step 2: the width changes instantly.
- [ ] Pass

---

### UAT-UI-004: The terminal fills the freed width after collapsing and shrinks back after expanding
- **Page**: `http://localhost:4321/` → select an agent with a live window → Terminal tab
- **Description**: `LogTail` refits xterm via its `ResizeObserver` when the pane resizes.
- **Steps**:
  1. Expanded: select an agent and open its Terminal tab; note the terminal's right edge relative to the pane and that lines aren't clipped.
  2. Collapse the sidebar. Wait about a second.
  3. Expand the sidebar. Wait about a second.
- **Expected Result**: After collapsing, the terminal grows to use the extra ~272px with no horizontal scrollbar and no clipped or double-wrapped lines; after expanding it shrinks back without clipping the right edge (one-column right-edge margin as before). The cursor draws in the correct column at both widths.
- [ ] Pass

---

### UAT-INT-001: Toggling re-syncs the tmux window width to the new pane width
- **Flow**: toggle click → `reprobeTerminalSize()` (400ms debounce) → hidden probe measured at `getSidebarWidthPx()` → `POST /api/terminal-size {cols, rows}` → `applyGlobalPaneSize` resizes every tmux window in the session.
- **Steps**:
  1. Open devtools Network tab filtered to `terminal-size`. Fresh load, select an agent with a live window (so a terminal has mounted and probed once).
  2. Get the tmux session name and one agent's window name from the status endpoint (see command below).
  3. Note the current width: `tmux display -p -t '<session>:<window>' '#{window_width}'`.
  4. Collapse the sidebar; wait about a second. Note the new `POST /api/terminal-size` request body and re-run the tmux command.
  5. Expand the sidebar; wait about a second; note the request body and re-run the tmux command.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '{session, windows: [.agents[] | {name, windowPresent}]}'
  ```
- **Expected Result**: Each toggle produces exactly one `POST /api/terminal-size` (200). Collapsed `cols` is larger than expanded `cols` (roughly 272px more, i.e. ~30–40 more columns depending on font metrics). `#{window_width}` equals the posted `cols` after each toggle (collapsed > expanded), and it is the same for every agent window in the session (global resize).
- [ ] Pass

---

### UAT-INT-002: Rapid toggling coalesces into a single terminal-size sync
- **Flow**: multiple `reprobeTerminalSize()` calls inside 400ms share one debounce timer.
- **Steps**:
  1. Network tab filtered to `terminal-size`, cleared. With an agent's Terminal open, click the toggle 4 times within ~1 second (ending in the same state you'd expect from an even count, i.e. back to where you began).
  2. Wait 1 second and count the `POST /api/terminal-size` requests. Read the final request's `cols`.
  3. Repeat with an odd number of clicks (3) and compare the final `cols` to the width for the resulting state.
- **Expected Result**: Exactly one request per burst (not one per click). Its `cols` reflects the sidebar state at the end of the burst (expanded `cols` after an even count from expanded; collapsed `cols` after an odd count).
- [ ] Pass

---

### UAT-INT-003: A persisted collapsed state is reflected in the first probe after reload
- **Flow**: `sidebarState` initialises its module width from localStorage at import → `maybeProbeOnFirstRender()` positions the probe at 48px → the first `POST /api/terminal-size` already carries the wider cols.
- **Steps**:
  1. Collapse the sidebar (so `conductor:sidebarCollapsed` is `"true"`), then reload with the Network tab open (Preserve log on, filtered to `terminal-size`).
  2. Select an agent with a live window so its Terminal mounts (this triggers the one-shot first probe). Read the request body's `cols`.
  3. Clear the key (`localStorage.removeItem('conductor:sidebarCollapsed')`), reload, select an agent again, and read the `cols` of that first probe.
- **Expected Result**: Step 2's `cols` (collapsed load) is greater than step 3's `cols` (expanded load) at the same viewport width, by roughly the same margin as UAT-INT-001, and the tmux window width matches each posted value. The first request after a collapsed reload does not use the expanded width.
- [ ] Pass
