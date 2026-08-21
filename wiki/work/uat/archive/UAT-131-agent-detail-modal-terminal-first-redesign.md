---
id: UAT-131
aliases: [UAT-131]
title: "UAT: AgentDetailModal terminal-first redesign"
status: passed
task: TASK-131
created: 2026-08-15
updated: 2026-08-15
---

# UAT-131 — UAT: AgentDetailModal terminal-first redesign

implements::[[TASK-131]]

> **Source task**: [[TASK-131]]
> **Generated**: 2026-08-15

> **Why every case here is UI/manual, not API**: TASK-131 touches only `frontend/src/components/AgentList.tsx` and `frontend/src/components/LogTail.tsx` (React rendering/state/event-handler changes) plus `frontend/src/lib/terminalSizeProbe.ts` (a DOM-geometry fix). No backend route was added or changed. The product requirements — "the terminal is visually dominant by default", "Direct Input is on when the modal opens", "double-click expands the terminal", "wrapped lines land at the true edge" — are all observable only in a real rendered browser DOM, not via curl.
>
> **Why full component-level RTL tests were not written for the `<details>`/Direct-Input/double-click behavior**: `@testing-library/react` is installed (`frontend/package.json`) but no `*.test.tsx` file exists anywhere in this repo yet — this would be the first. `AgentDetailModal` and `LogTail` are both large, heavily-integrated components: `LogTail` mounts a real `xterm.js` `Terminal` (jsdom lacks `window.matchMedia`, which xterm.js requires — already noted as an unresolved gap in `terminalSizeProbe.test.ts`'s own comments), opens a WebSocket, subscribes to SSE, and `AgentDetailModal` additionally fires `fetch` calls to `/queue/:id` and `/agents/:id/skills` on mount and renders `TaskList`/`AddTaskForm`/`DiffPanel`/`UsageBreakdown`/`CheckpointList`/`ModeSwitcher` as live children. Building a faithful RTL harness for either (mocking xterm.js, WebSocket, SSE, and every fetch endpoint) is nontrivial new test infrastructure beyond this task's scope — recorded per-case below as `Blocked`, matching the precedent already set by UAT-130 (which also blocked full component/live-tmux tests and only promoted the narrow, cheaply-isolable DOM-geometry assertion).
>
> **Repeatable unit test created by this UAT run**: `frontend/src/lib/terminalSizeProbe.test.ts` gained one new test — `"mounts the throwaway terminal inside a bordered wrapper mirroring LogTail's captureRef (TASK-131)"` — asserting the probe's DOM ancestry now includes the bordered wrapper that was missing (the actual root cause of the one-column-early wrap; see TASK-131 Step 4's root-cause note). Verified: `npx vitest run src/lib/terminalSizeProbe.test.ts` → 4/4 pass; full frontend suite → 58/58 pass (57 pre-existing + 1 new); `tsc --noEmit` clean.

---

## Prerequisites

- [x] Host-server running on `http://127.0.0.1:8788` and frontend dev server on `http://localhost:4321` (`make dev`), with at least one agent spawned and its tmux window present. <!-- auto-verified 2026-08-15: /api/status 200, sessionAlive:true -->
- [x] A second agent spawned (for the agent-navigation case, UAT-EDGE-001) — `⌘←`/`⌘→` only does anything with `agentCount > 1`. <!-- auto-verified 2026-08-15: 4 agents present -->
- [x] For UAT-UI-001: one agent with `windowPresent: false` (close an agent's window via the "Close agent" button, keeping it registered) and one agent with at least one queued task (`/add-task` or the modal's "Add task" form) — needed to exercise the default-*open* branches of the collapsed panels. <!-- 2026-08-15: agent 10 (bootstrap-1) windowPresent:false; agent 13 (cryptwiz-1) queuedTasks:2 (queued /roadmap-assess x2) -->
- [ ] Browser DevTools available for inspecting DOM (`<details open>` state) — a visual check of whether the panel is expanded/collapsed is sufficient; DevTools is not strictly required.

---

## Test Cases

### UAT-UI-001: Details and Queued Tasks panels are collapsed by default, and open automatically only when actionable
- **Page**: `http://localhost:4321` — any agent's detail modal (`AgentDetailModal` in `frontend/src/components/AgentList.tsx`, the two `<details>` blocks that replaced the former always-expanded two-column grid).
- **Description**: Verifies the core "less noise, terminal gets the space" change — both panels default closed, except each has its own actionable-default-open condition (`open={!agent.windowPresent}` for Details, `open={agent.queuedTasks > 0}` for Queued tasks).
- **Steps**:
  1. Open the detail modal for an agent with `windowPresent: true` and zero queued tasks. Confirm both the "Details" and "Queued tasks (0)" panels render **collapsed** (summary line only, no expanded content), and the terminal occupies the space that would otherwise be taken by the expanded grid.
  2. Click each panel's summary to confirm it expands/collapses normally and still shows the original content (Command/Workdir/Window/ModeSwitcher for Details; the task list + add-task form for Queued tasks).
  3. Open the detail modal for an agent with `windowPresent: false` (closed window). Confirm the "Details" panel is **open by default** and the "Create window" button is visible without clicking anything.
  4. Open the detail modal for an agent with at least one queued task. Confirm the "Queued tasks (N)" panel is **open by default**, showing the queued items without clicking anything.
- **Expected Result**: Both panels closed by default in the common case; "Details" auto-opens only when the window is closed; "Queued tasks" auto-opens only when `N > 0`. All original functionality (Command/Workdir display, ModeSwitcher, Create window, task list reorder, add-task form) still works inside the collapsed panels.
- **Repeatable Unit Test**: Blocked: requires a full `AgentDetailModal` RTL render (fetch mocks for `/queue/:id` and `/agents/:id/skills`, plus every child component `LogTail` pulls in) — see the file-level note above. No existing component-test harness in this repo to extend.
- [x] Pass <!-- fixed 2026-08-15: gated LogTail's mount effect on loaded && windowPresent with a one-shot ref guard; re-verified live — inactive agent (bootstrap-1) modal now closes on Escape -->

### UAT-UI-002: Direct Input is on by default when the modal opens, and re-arms on agent switch
- **Page**: `http://localhost:4321` — any agent's detail modal, `frontend/src/components/LogTail.tsx`'s new mount-only effect.
- **Description**: Verifies the modal opens directly into Direct Input mode (amber "Direct Input — keys go to …" banner, terminal focused) without requiring a click, and that switching agents via `⌘←`/`⌘→` re-arms it (since `LogTail` remounts on `key={agent.id}` change).
- **Steps**:
  1. Open the detail modal for any agent with a live window. Immediately (without clicking anything) confirm the amber "Direct Input — keys go to {agentName}" banner is visible at the top of the terminal.
  2. Type a character (e.g. a letter) without clicking the terminal first. Confirm it's sent to the agent's pane (visible in the terminal output) — proving the terminal is actually focused, not just showing the banner.
  3. Press `⌘→` (or `Ctrl+→`) to navigate to the next agent (requires ≥2 agents). Confirm the banner is still showing and typing again is immediately captured, without needing to click the new agent's terminal.
  4. Click "Stop" on the Direct Input banner (or click the "Live"/"History" toggle) to exit Direct Input, confirm it can still be manually re-entered via the "Direct Input" button or by clicking the terminal.
- **Expected Result**: Direct Input is active immediately on modal open and after every agent switch, with the terminal already focused — no extra click required in either case. Manual toggle off/on still works.
- **Repeatable Unit Test**: Blocked: requires mocking `xterm.js`'s `Terminal` (jsdom lacks `window.matchMedia`) plus WebSocket/SSE/fetch to render `LogTail` in isolation — see the file-level note above.
- [x] Pass <!-- fixed 2026-08-15: same fix as UAT-UI-001 (gated mount effect); re-verified live — Direct Input activates with real DOM focus (amber ring, banner, "Stop Direct Input") on cryptwiz-1 and stays active 3.5+s with no drop-off -->

### UAT-UI-003: Double-clicking the terminal toggles fullscreen, matching `⌥F`
- **Page**: `http://localhost:4321` — any agent's detail modal, the `xtermContainerRef` div in `frontend/src/components/LogTail.tsx` (now carrying `onDoubleClick={onToggleExpand}` alongside its existing `onClick`).
- **Description**: Verifies double-clicking the terminal expands it to fill the modal (hiding Details/Queued Tasks/Skills/Diff/Usage/Checkpoints), exactly like pressing `⌥F` or the fullscreen icon button, and that double-clicking again (or `⌥F`, or the icon) collapses it back.
- **Steps**:
  1. Open the detail modal for any agent. Double-click anywhere inside the terminal panel (not on the Direct Input banner or the Send-form below it).
  2. Confirm the terminal expands to fill the modal — Details/Queued Tasks/Skills/Diff/Usage/Checkpoints all disappear, matching what `⌥F` already does.
  3. Double-click the (now expanded) terminal again. Confirm it collapses back to the normal layout.
  4. Repeat step 1, then instead press `⌥F` (Option+F on Mac, Alt+F elsewhere) to collapse instead of double-clicking — confirm both mechanisms toggle the same `logExpanded` state interchangeably (expand via double-click, collapse via `⌥F`, and vice versa).
  5. Single-click (not double) the terminal once — confirm it still enters/stays in Direct Input mode as before, without unexpectedly triggering fullscreen (single-click and double-click must not interfere with each other).
- **Expected Result**: Double-click toggles the identical fullscreen state that `⌥F` and the icon button already control; single-click continues to only affect Direct Input, never fullscreen.
- **Repeatable Unit Test**: Blocked: requires the same `LogTail`-in-isolation RTL harness noted above (xterm.js/WebSocket/SSE mocking) to simulate a `dblclick` DOM event and assert `onToggleExpand` fired.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-001: Agent navigation and Escape/Escape-twice still work with the terminal auto-focused on open
- **Page**: `http://localhost:4321` — any agent's detail modal, with ≥2 agents available.
- **Description**: This is the risk flagged in TASK-131's Approach section: auto-focusing `captureRef` (a plain `<div>`, not an `<input>`/`<textarea>`) on mount bypasses the modal's `tag === 'TEXTAREA' || tag === 'INPUT'` bail-out used to protect `⌘←/→` from being captured by form fields. Confirms that bypass does not actually break agent-nav or Escape handling in practice.
- **Steps**:
  1. Open the detail modal for any agent (Direct Input auto-arms per UAT-UI-002).
  2. Press `⌘←` and `⌘→` (or `Ctrl+←`/`Ctrl+→`) repeatedly. Confirm the modal switches between agents each time, exactly as before this task's changes.
  3. Press `Escape` once. Confirm the "Press esc again to close the modal" hint appears (and does **not** close the modal).
  4. Press `Escape` a second time within ~800ms. Confirm the modal closes.
  5. Re-open the modal, enter Direct Input, and press `⌘/Ctrl+Escape` (or the platform equivalent held together). Confirm a literal Escape keystroke is sent to the agent's pane instead of triggering the modal's close-hint behavior.
- **Expected Result**: `⌘←/→` agent navigation, single-Escape hint, double-Escape close, and `⌘/Ctrl+Escape`-sends-literal-Escape all behave identically to before TASK-131 — the terminal now being auto-focused on open does not regress any of these.
- **Repeatable Unit Test**: Not applicable: keyboard-event routing across two independent `document`/element-level listeners is exactly the kind of case Step 2.5 excludes (real browser event dispatch/focus semantics, not deterministic pure logic) — best verified live.
- [x] Pass <!-- 2026-08-15: verified live — ⌘→ agent-nav, single-Escape hint, double-Escape close (dispatched on the focused terminal div, 300ms apart), and Ctrl+Escape sends literal escape without closing, all confirmed via Playwright -->

### UAT-EDGE-002: Long terminal lines wrap exactly at the visible edge, with the cursor aligned to the wrap point (scrollbar/border off-by-one fix)
- **Page**: `http://localhost:4321` — any agent's detail modal or card terminal, ideally the expanded/fullscreen modal for maximum width (`frontend/src/lib/terminalSizeProbe.ts`'s `getProbeMount()` fix).
- **Description**: This is the user-reported regression folded into TASK-131 (screenshot: `tmp/dashboard-drops/1786833660749-Screenshot-2026-08-15-at-5.39.51-PM.png`) — confirms the fix (adding a bordered wrapper to the probe's DOM, mirroring `LogTail`'s `captureRef`, so the probed `cols` no longer overshoots the real terminal's available width by one column).
- **Steps**:
  1. Do a hard refresh of the dashboard (the probe's `hasProbedOnce` guard is per page load) and open any agent's terminal to trigger the first-render probe.
  2. Send a command that produces a long single line at or beyond the terminal's width — e.g. `ls -la` in a directory with long filenames, or ask the agent to print a ~150+ character line.
  3. Observe exactly where the line wraps in the browser terminal panel, and where the block cursor is drawn relative to the wrapped text.
- **Expected Result**: The line wraps at the panel's true visible right edge (not one character early, leaving a one-character gap before the scrollbar/edge), and the cursor is drawn on the character it's actually at — not one column/row behind the text. Compare against the reported-bug screenshot for the "before" state.
- **Repeatable Unit Test**: Created: `frontend/src/lib/terminalSizeProbe.test.ts` — the new test `"mounts the throwaway terminal inside a bordered wrapper mirroring LogTail's captureRef (TASK-131)"` proves the DOM-structure half of the fix (the bordered ancestor now exists in the probe's mount chain, matching the real terminal's chain). The visual wrap/cursor-position half remains genuinely manual/browser-only — `FitAddon.fit()`'s actual column arithmetic against live font metrics isn't something the mocked-`Terminal` unit test exercises.
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/terminalSizeProbe.test.ts`
- [x] Pass <!-- unit-test half verified at generation time: 2026-08-15, 4/4 pass including the new regression test; visual half requires a live browser and is left for /uat-walk -->
