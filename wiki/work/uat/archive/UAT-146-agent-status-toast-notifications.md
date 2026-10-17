---
id: UAT-146
aliases: [UAT-146]
title: "UAT: Toast-like notifications on agent status change (waiting / no tasks), click switches to that agent"
status: passed
task: TASK-146
created: 2026-09-13
updated: 2026-09-19
---

# UAT-146 — UAT: Toast-like notifications on agent status change (waiting / no tasks), click switches to that agent

implements::[[TASK-146]]

> **Source task**: [[TASK-146]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Frontend dev server running (`make dev`, `http://localhost:4321`) for the UAT-UI/UAT-INT cases.
- [ ] At least one live agent that can be driven into `awaiting` (send it a prompt that triggers `AskUserQuestion`/plan approval, or a shell command needing confirmation) and/or `empty` (idle with an empty task queue) for UAT-INT-001.
- [ ] The `frontend/src/components/AgentList.test.tsx` suite (vitest + jsdom) for the UAT-EDGE cases — no live servers needed.

---

## Test Cases

### UAT-EDGE-001: `empty` transition shows a toast with the "no tasks" label
- **Scenario**: `isNotifiable` fires on the set `{awaiting, empty}`. Only the `awaiting` branch had any coverage before this UAT — `empty` is reached via a *different* source signal (`agent.state === 'idle' && agent.queuedTasks === 0` in `deriveStatus`, `AgentList.tsx` L110-123), not a literal `state: 'empty'`, so it needs its own exercised transition.
- **Steps**:
  1. Render `<AgentList />` with one agent in `busy` state.
  2. Fire an `agent-update` SSE event for that agent with `{ state: 'idle', queuedTasks: 0 }`.
  3. Advance fake timers by `NOTIFICATION_GRACE_MS` (3000ms).
  4. Confirm a toast appears labeled with `STATUS_CONFIG.empty.label` ("no tasks").
- **Expected Result**: The toast for the `empty` transition renders after the grace period, using the same label/color as the badge.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('shows a toast for an \`empty\` transition (idle with zero queued tasks), with the "no tasks" label')`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass

### UAT-EDGE-002: sr-only live-region announcer mirrors the latest toast's text
- **Scenario**: `NotificationStack.tsx`'s single persistent `role="status" aria-live="polite" aria-atomic="false"` element (L22) must always be present in the DOM — never created fresh per toast, per the task's accessibility requirement — and must mirror `${agentName} is ${STATUS_CONFIG[status].label}` for the most recently added toast.
- **Steps**:
  1. Render `<AgentList />` with zero toasts showing; query `role="status"`.
  2. Confirm it exists and has empty text content.
  3. Fire an `agent-update` SSE event transitioning an agent into `awaiting`; advance past the grace period.
  4. Confirm the same `role="status"` element's text content is now `"<agent name> is waiting"`.
- **Expected Result**: The announcer element is present before any toast exists (not conditionally rendered) and its text mirrors the newest toast once one appears.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('the sr-only announcer mirrors the latest toast's text, and is present-but-empty before any toast shows')`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass

### UAT-EDGE-003: Multiple simultaneous toasts stack, and the announcer reflects only the most recent
- **Scenario**: `notifications` is a `Map<agentId, {...}>`; `NotificationStack` renders one card per entry and mirrors only `notifications[notifications.length - 1]` into the announcer (NotificationStack.tsx L15, L23). Two agents entering `awaiting` in the same tick must both render as separate cards, with the announcer text reflecting only the second (later-scheduled) one.
- **Steps**:
  1. Render `<AgentList />` with two agents (one known via the initial `/status` fetch, one introduced purely via SSE, matching the existing `agent-removed` cleanup test's pattern of upserting unknown ids).
  2. Fire `agent-update` for both, transitioning each into `awaiting`, back-to-back in the same tick.
  3. Advance fake timers past the grace period.
  4. Confirm both toast cards are present (by agent name + label), and the announcer's text content matches only the second agent's message.
- **Expected Result**: Both toasts stack in the DOM; the announcer never concatenates or reflects the first (superseded) toast.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('stacks multiple simultaneous toasts, and the announcer reflects only the most recently added')`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass

### UAT-EDGE-004: Keyboard activation (Enter) opens the modal and removes the toast
- **Scenario**: The task requires the toast card to be keyboard-operable — `role="button" tabIndex={0}` plus an `onKeyDown` handler for `Enter`/`Space` (NotificationStack.tsx L30-33), matching `AgentItem`'s own existing pattern. The existing 7 tests from `/tackle` only exercise mouse `click`; this exercises the keyboard path end-to-end through `AgentList`.
- **Steps**:
  1. Render `<AgentList />`, drive one agent into `awaiting`, let its toast appear.
  2. Dispatch a `keydown` with `key: 'Enter'` on the toast element (not the dismiss button).
  3. Confirm the agent's detail modal opens (`role="dialog"`, `aria-label="<agent> detail"`) and the toast is removed.
- **Expected Result**: Enter on the toast body performs the identical action as a mouse click — opens the modal and clears the toast — without requiring a pointer device.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('pressing Enter on a toast opens the modal (armed for Direct Input) and removes the toast, matching click behavior')`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass

### UAT-EDGE-005: A toast never steals focus automatically on mount
- **Scenario**: The task's Approach explicitly requires "Card must never receive focus automatically on mount — only the explicit click/keydown interaction may act" (TASK-146 Approach, `NotificationStack` bullet). Nothing in `NotificationStack.tsx` calls `.focus()` on mount, but this had no regression guard.
- **Steps**:
  1. Render `<AgentList />`, drive an agent into `awaiting`, let the toast appear after the grace period.
  2. Read `document.activeElement` immediately after the toast mounts.
  3. Confirm it is not the toast element.
- **Expected Result**: `document.activeElement` never becomes the toast card as a side effect of it appearing — focus stays wherever it already was.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('a toast never receives focus automatically when it mounts')`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass

### UAT-EDGE-006: A brand-new agent's very first SSE update already reporting `awaiting`/`empty` (no prior recorded status)
- **Scenario**: The `/tackle` implementation note on Step 1 flags a deliberate judgment call: the notify-in check (`isNotifiable && !wasNotifiable`, `AgentList.tsx` ~L1760) has **no** `prevStatus !== undefined` guard, unlike the sibling `needsAttention` doorbell-sound check three lines above it (`needsAttention(newStatus) && prevStatus !== undefined && !needsAttention(prevStatus)`, L1739). This means a freshly-spawned agent whose very first `agent-update` SSE payload already reports `awaiting` or `empty` schedules a grace-period toast, even though there is no genuine "transition" — the agent never had a prior status to transition away from. The task's own comment flags this as "worth a second look if this misfires on freshly-spawned agents," i.e. the requirement does not explicitly settle this case.
- **Steps**:
  1. Spawn (or simulate) a brand-new agent whose first-ever status report is `awaiting` (e.g. an agent that immediately hits an `AskUserQuestion` on startup) or `empty` (idle with no queued tasks from the moment it appears).
  2. Observe whether a toast appears for it ~3s later.
  3. Judge whether that is desirable: a just-spawned agent sitting empty/idle before any task is queued is arguably not "waiting for the user's attention" the way a genuinely-transitioned agent is, and could produce a spurious toast on every fresh spawn.
- **Expected Result**: Undetermined by the current requirement — this is a design gap, not a verified regression. **Report back to the task owner** whether the current behavior (toast fires) or the `needsAttention`-style guard (toast suppressed for an agent's first-ever status report) is correct, and update TASK-146's Approach once decided.
- **Repeatable Unit Test**: Not applicable — the correct behavior is undetermined by the source requirement (see Test Integrity: never assert current implementation behavior as required when the requirement doesn't settle it). Do not promote a unit test here until the design question above is resolved.
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

### UAT-UI-001: Toast stack renders as a fixed top-right portal, stacks correctly, and animates in
- **Page**: Dashboard SPA (`http://localhost:4321`)
- **Component**: `frontend/src/components/NotificationStack.tsx` (`createPortal` into `document.body`, `fixed top-4 right-4 z-40 flex flex-col gap-2` container, `animate-popIn` per card — `frontend/tailwind.config.js` L54/65)
- **Description**: jsdom/vitest can assert a portaled element exists in the DOM but cannot confirm real fixed-positioning, stacking order, z-index layering above other UI (the needs-attention `!` badge, the agent grid, any open modal), or that the `animate-popIn` CSS animation actually plays. This is genuine visual verification.
- **Steps**:
  1. Open the dashboard with at least two agents.
  2. Drive one agent into `awaiting` (or `empty`) and wait ~3 seconds.
  3. Confirm a card animates in at the top-right of the viewport (not overlapping the header/nav), does not shift the agent grid layout, and sits above the grid (z-40).
  4. Drive a second agent into `awaiting`/`empty` a few seconds later.
  5. Confirm the second card stacks below the first with visible spacing, both remain independently dismissible, and each new card animates in on its own.
  6. Resize to a narrow/mobile viewport and confirm the stack does not overflow or get clipped off-screen.
- **Expected Result**: Toasts render as a floating top-right stack, animate in on mount, stack cleanly with multiple simultaneous toasts, and never occlude or shift the rest of the dashboard.
- **Repeatable Unit Test**: Not applicable — real fixed-positioning, CSS animation playback, and visual stacking/z-index are not observable in jsdom.
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

### UAT-UI-002: Clicking a toast opens the agent's modal with Direct Input actually armed (not just the prop set)
- **Page**: Dashboard SPA (`http://localhost:4321`) — agent detail modal, Terminal tab
- **Component**: `frontend/src/components/AgentList.tsx` (`AgentDetailModal`, `armInteract` prop forces `setActiveTabId('terminal')` at L644 and increments `interactSignal` at L612, which (re-)enables Direct Input in the real `LogTail`/xterm.js terminal — `LogTail.tsx` is stubbed out entirely in the vitest suite, so this path is only unit-tested up to "the Terminal tab shows `aria-selected=true`", never that the real terminal actually becomes interactive)
- **Description**: This is the actual end-user payoff of the click action ("click switches to that agent... with Direct Input already armed/focused"), and requires a live xterm.js session — not reproducible in jsdom.
- **Steps**:
  1. Have a live agent transition into `awaiting`/`empty` and let its toast appear.
  2. Click the toast body (not the ✕).
  3. Confirm the agent's detail modal opens directly to the Terminal tab.
  4. Confirm Direct Input is live — type a character and confirm it lands in the real terminal without an extra click to "arm" it.
- **Expected Result**: A single click on the toast is sufficient to land the user in a ready-to-type terminal for that agent — no secondary step needed.
- **Repeatable Unit Test**: Not applicable — requires a real browser and a live xterm.js terminal session; `LogTail` is mocked in the unit-test environment.
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

### UAT-UI-003: Toast status pill colors match the badge colors for both `awaiting` and `empty`, in light and dark theme
- **Page**: Dashboard SPA (`http://localhost:4321`)
- **Component**: `frontend/src/components/NotificationStack.tsx` (reuses `STATUS_CONFIG[status].bg`/`.color`/`.dot` inline styles, L26, L37-44) vs. the agent card's own `StatusBadge` using the same `STATUS_CONFIG`
- **Description**: Both the toast and the source task explicitly required reusing `STATUS_CONFIG` rather than duplicating colors so the toast visually matches the agent card's own status badge. This is a CSS-custom-property resolution check (`var(--color-status-warn-bg)` etc.) that only resolves correctly in a real browser paint, not jsdom.
- **Steps**:
  1. Drive an agent into `awaiting`; compare the toast's status pill color/label against that same agent's status badge in the grid — they should be identical (amber "waiting").
  2. Drive an agent into `empty`; compare the toast's pill against the badge — identical (amber "no tasks", note `awaiting` and `empty` intentionally share the warn color tokens).
  3. Toggle the dashboard to dark mode (or switch OS theme) and repeat both comparisons.
- **Expected Result**: Toast pill colors are pixel-identical to the corresponding status badge in both themes — no separate/duplicated palette.
- **Repeatable Unit Test**: Not applicable — CSS custom-property resolution and cross-theme visual comparison require a real browser paint.
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

### UAT-INT-001: End-to-end — a real agent transitioning via the live host-server SSE stream produces a toast, and dismiss/click both work against real state
- **Page**: Dashboard SPA (`http://localhost:4321`), backed by the live host-server (`http://localhost:8788`)
- **Description**: Every UAT-EDGE case above drives `AgentList` via a synthetic `CapturingEventSource`/`fireSSE` harness, not the real `GET /events` SSE stream from `host-server/index.ts`. This case verifies the full pipeline: a real tmux agent's status actually changing → the host-server's `pollAndDiff`/`detectAgentStatus` detecting it → an `agent-update` SSE event → the browser's real `EventSource` → the grace-period timer → a rendered toast — plus that dismiss and click-to-open behave correctly against the live `agents` state (not a test double).
- **Steps**:
  1. Start the full stack (`make dev`).
  2. Get a real agent into `awaiting` (send a command that triggers a y/n confirmation or `AskUserQuestion`) or `empty` (let its queue drain with nothing queued).
  3. Wait ~3 seconds (`NOTIFICATION_GRACE_MS`) and confirm a toast appears without a page refresh.
  4. Dismiss it via ✕; confirm it's gone and no modal opened.
  5. Repeat, this time clicking the toast body; confirm the agent's own detail modal opens armed for Direct Input.
  6. Resolve the agent's `awaiting`/`empty` condition before the grace period elapses on a fresh trigger, and confirm no toast appears for that instance.
- **Expected Result**: The full real pipeline (tmux → host-server detection → SSE → dashboard) produces, dismisses, and click-opens toasts identically to the synthetic-SSE unit tests.
- **Repeatable Unit Test**: Not applicable — requires a live tmux session, the real host-server process, and real SSE transport end-to-end.
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->
