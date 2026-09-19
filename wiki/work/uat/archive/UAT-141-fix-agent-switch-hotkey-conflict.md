---
id: UAT-141
aliases: [UAT-141]
title: "UAT: Replace Cmd/Ctrl+Arrow agent-switch hotkey to stop conflicting with terminal cursor navigation"
status: passed
task: TASK-141
created: 2026-09-13
updated: 2026-09-18
---

# UAT-141 — UAT: Replace Cmd/Ctrl+Arrow agent-switch hotkey to stop conflicting with terminal cursor navigation

implements::[[TASK-141]]

> **Source task**: [[TASK-141]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Frontend dev server running (`make dev`, `http://localhost:4321`) for the two manual UI cases.
- [ ] A project with at least 2 agents registered, so `AgentDetailModal` renders with `agentCount > 1` (the hint buttons and Shift+Cmd navigation are hidden/inert with a single agent).
- [ ] A real macOS keyboard for UAT-EDGE-003 (not a simulated/CI environment).

---

## Test Cases

### UAT-EDGE-001: Bare Cmd-only ArrowRight/ArrowLeft, and the old Ctrl+Alt combo, no longer switch agents
- **Scenario**: Regression guard — the keydown handler in `AgentDetailModal` (`frontend/src/components/AgentList.tsx`) now requires `e.metaKey && e.shiftKey` (Shift+Cmd). A bare Cmd (metaKey-only) keydown must be a no-op, since Cmd+Left/Right needs to reach the embedded terminal as ordinary readline cursor navigation instead, and the previous Ctrl+Alt combo must also no longer trigger navigation.
- **Steps**:
  1. Open an agent's detail modal in a project with 2+ agents.
  2. Dispatch a `keydown` on `document` with `{ key: 'ArrowRight', metaKey: true }` (no `shiftKey`).
  3. Dispatch a `keydown` on `document` with `{ key: 'ArrowRight', ctrlKey: true, altKey: true }` (the retired combo).
  4. Confirm the modal is still showing the same agent after both (no navigation occurred).
- **Expected Result**: Neither a bare `metaKey` keydown nor the old `ctrlKey && altKey` combo calls `onNavigate` or changes the open agent.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentList keyboard navigation ignores the grid filter')`, ~lines 530-536 — asserts the modal stays on `node-beta` after a `metaKey`-only keydown and after a `ctrlKey && altKey` keydown)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass

### UAT-EDGE-002: Shift+Cmd+ArrowRight/ArrowLeft switches to the adjacent agent
- **Scenario**: The current shortcut combo (`e.metaKey && e.shiftKey`) must actually perform the agent-switch.
- **Steps**:
  1. Open an agent's detail modal in a project with 2+ agents.
  2. Dispatch a `keydown` on `document` with `{ key: 'ArrowRight', metaKey: true, shiftKey: true }`.
  3. Confirm the modal now shows the next agent in `orderedAgentIds`.
  4. Dispatch `{ key: 'ArrowLeft', metaKey: true, shiftKey: true }` and confirm it returns to the previous agent.
- **Expected Result**: `onNavigate('next')`/`onNavigate('prev')` fire and the modal's `aria-label` (`"<agent.name> detail"`) updates to the adjacent agent.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (same test as above — asserts the modal advances from `node-beta` to `node-gamma` on `metaKey && shiftKey`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass

### UAT-UI-001: Clicking the "Shift+Cmd ←" / "Shift+Cmd →" hint buttons switches agents by mouse
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal, header action row
- **Component**: `frontend/src/components/AgentList.tsx` (`AgentDetailModal`, the `agentCount > 1` block rendering two `<button aria-label="Previous agent">`/`<button aria-label="Next agent">` elements)
- **Description**: The `Shift+Cmd ←`/`Shift+Cmd →` hint pills were converted from decorative `<kbd>` text into real `<button type="button">` elements calling `onNavigate('prev')`/`onNavigate('next')`, so a mouse-only user can switch agents without using the keyboard shortcut.
- **Steps**:
  1. Open an agent's detail modal in a project with 2+ agents (desktop viewport — the hint row is `hidden ... sm:flex`, so it only renders at `sm` breakpoint and above).
  2. Click the button labeled "Next agent" (showing "Shift+Cmd →").
  3. Confirm the modal switches to the next agent.
  4. Click the button labeled "Previous agent" (showing "Shift+Cmd ←").
  5. Confirm the modal returns to the original agent.
- **Expected Result**: Both buttons are real, clickable, keyboard-focusable controls (not inert text) with the visual pill style preserved, and each click performs the same navigation as its keyboard equivalent.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('clicking the Ctrl+Alt prev/next hint buttons calls onNavigate with the correct direction')` — test name predates the Shift+Cmd combo swap but still exercises the same click-only behavior, unaffected by the keyboard-combo change; clicks both buttons by `role: 'button'`/`name` and asserts the modal navigates `node-beta` → `node-gamma` → `node-beta`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass

### UAT-UI-002: Cmd+Left/Right reaches the embedded terminal as cursor navigation; Shift+Cmd+Arrow still switches agents while the terminal has focus
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal with Direct Input active
- **Component**: `frontend/src/components/LogTail.tsx` (embedded xterm.js terminal, Direct Input mode) + `frontend/src/components/AgentList.tsx` (`AgentDetailModal` keydown handler)
- **Description**: This is the actual conflict TASK-141 fixes. It requires a live browser and a real terminal session/focus — not reproducible in jsdom. Note: Shift+Cmd+Arrow is itself a real terminal/text-editing shortcut (extend-selection-to-line-start/end) distinct from plain Cmd+Arrow (move-cursor), so this case should also confirm Shift+Cmd+Arrow doesn't get intercepted as a selection-extend inside the terminal in the same way plain Cmd+Arrow originally was.
- **Steps**:
  1. Open an agent's detail modal for a live agent (2+ agents in the project) with Direct Input active, and click into the terminal so it has real keyboard focus (on `.xterm-helper-textarea`).
  2. Type some text into the terminal prompt, then press Cmd+Left (macOS, no Shift).
  3. Confirm the terminal's own cursor moves to the start of the line (readline behavior) — the agent-switch modal must NOT change agent.
  4. Press Shift+Cmd+Right while the terminal still has focus.
  5. Confirm the modal switches to the next agent (or, if focus-exemption logic intentionally blocks shortcuts while typing in the terminal, confirm that exemption applies consistently — record whichever behavior is observed and whether it matches the intended design in TASK-141's Approach section).
- **Expected Result**: Cmd+Left/Right (no Shift) always behaves as terminal cursor navigation while Direct Input has focus, never triggering an agent switch; Shift+Cmd+Arrow switches agents.
- **Repeatable Unit Test**: Not applicable — requires a real browser, live xterm.js terminal, and native OS/browser Cmd+Arrow readline forwarding; not reproducible in jsdom/vitest.
- [SKIP: presumed working — not independently verified live, but implementation/behavior presumed correct per current code] <!-- 2026-09-18 -->

### UAT-EDGE-003: Shift+Cmd+Arrow still resolves correctly under non-US macOS keyboard layouts
- **Scenario**: TASK-141's Step 1 flagged an open question (deferred to manual verification, originally scoped against the Ctrl+Alt combo but equally applicable to Shift+Cmd): on some macOS keyboard layouts, a modifier held alongside an arrow key can alter the browser's reported `e.key` value instead of leaving it as `'ArrowLeft'`/`'ArrowRight'`, which would silently break the shortcut for those users. The current implementation checks `e.key` only, with no `e.code` fallback.
- **Steps**:
  1. On a real macOS machine (not headless/CI), open an agent's detail modal in a project with 2+ agents.
  2. Switch to a non-US/non-default keyboard layout if available.
  3. Press Shift+Cmd+Left/Right and observe whether the browser's `keydown` event still reports `e.key === 'ArrowLeft'`/`'ArrowRight'`.
  4. Confirm whether agent navigation still fires.
- **Expected Result**: Shift+Cmd+Arrow switches agents regardless of active keyboard layout. If a layout is found where `e.key` is remapped and navigation silently fails, file a follow-up bug recommending the `e.code`-based fallback the task already anticipated.
- **Repeatable Unit Test**: Not applicable — depends on real OS keyboard-layout/IME behavior that jsdom cannot simulate.
- [SKIP: presumed working — not independently verified live, but implementation/behavior presumed correct per current code] <!-- 2026-09-18 -->
