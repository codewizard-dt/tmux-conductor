---
id: UAT-123
aliases: [UAT-123]
title: "UAT: Replace window.confirm() destructive-action dialogs with the app's custom modal styling"
status: in-progress
task: TASK-123
created: 2026-08-15
updated: 2026-08-15
---

# UAT-123 — UAT: Replace window.confirm() destructive-action dialogs with the app's custom modal styling

implements::[[TASK-123]]

> **Source task**: [[TASK-123]]
> **Generated**: 2026-08-15
> **Note**: TASK-123 migrated 6 `window.confirm()` call sites across 3 files (`AgentList.tsx` x4, `InactiveAgentsPanel.tsx` x1, `CheckpointList.tsx` x1) to a shared `ConfirmDialog` component (`frontend/src/components/ConfirmDialog.tsx`), with 8 pre-existing promoted vitest cases in `ConfirmDialog.test.tsx` covering the dialog's own behavior. Per team-lead's brief, this UAT weights the **destructive-action safety properties** as the highest-value assertions — these dialogs guard agent removal and checkpoint rollback, where an exact call-count regression (e.g. Cancel accidentally also firing `onConfirm`) would be a real data-loss bug, not a cosmetic one. 7 of 13 cases are machine-verifiable (citing the 8 pre-existing `ConfirmDialog.test.tsx` cases as promoted coverage rather than duplicating them, plus 2 new cases added this generation); the remaining 6 — "does clicking each of the 6 real call sites' trigger button actually open the dialog in a browser" — are genuinely human-only, since they require the real component tree, real navigation, and real user interaction, not just `ConfirmDialog` in isolation.

---

## Prerequisites

- [ ] `frontend/` dependencies installed, including the vitest/RTL harness from TASK-127 (this UAT's machine-verifiable cases depend on it existing).
- [ ] For the `UAT-UI-*` cases: host-server running on `http://localhost:8788` and frontend dev server on `http://localhost:4321` (`make dev`), with at least one live agent, one background process, and one agent with a recorded checkpoint (see each case's own steps for how to get one).
- [ ] Fixtures: none needed for the machine-verifiable cases — all run against the real `frontend/src` tree and mocked API modules, no scratch files under `./tmp/` required.

---

## Test Cases

### UAT-EDGE-001: No file under `frontend/src` still calls `window.confirm`
- **Scenario**: The headline structural guarantee of this task — every native confirm dialog is gone, repo-wide, not just at the 6 sites the task inventoried. A repo-wide search assertion is cheap and catches a regression (a careless revert, a new call site that skips the shared component) that per-component tests can't.
- **Steps**: Walk every `.ts`/`.tsx` file under `frontend/src` (excluding `*.test.tsx` files themselves) and assert none contain the substring `window.confirm`.
- **Expected Result**: Zero offending files.
- **Repeatable Unit Test**: Created (new, this generation): `frontend/src/components/ConfirmDialog.test.tsx` (`describe('window.confirm elimination — UAT-123 regression guard')`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/ConfirmDialog.test.tsx`
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-002: Clicking Confirm calls `onConfirm` exactly once and never calls `onCancel`
- **Scenario**: The core safety property for the *accept* path — clicking the destructive-action button must trigger the destructive action, and must never also fire the cancel callback (which could otherwise mask a real double-invocation bug).
- **Steps**: Render `ConfirmDialog` with `open=true` and both callbacks as spies; click the confirm button.
- **Expected Result**: `onConfirm` called exactly once; `onCancel` called zero times.
- **Repeatable Unit Test**: Created (pre-existing from TASK-123's own implementation): `ConfirmDialog.test.tsx` (`'clicking the confirm button calls onConfirm exactly once and does not call onCancel'`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/ConfirmDialog.test.tsx`
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-003: Clicking Cancel calls `onCancel` exactly once and never calls `onConfirm`
- **Scenario**: The first of the three dismiss paths. This is the property with the highest real-world stakes: a Cancel click that somehow also triggers the destructive action would be silent, unrecoverable data loss (an agent removed, a checkpoint rolled back) the user explicitly tried to avoid.
- **Steps**: Render `ConfirmDialog` with `open=true` and both callbacks as spies; click the cancel button.
- **Expected Result**: `onCancel` called exactly once; `onConfirm` called zero times.
- **Repeatable Unit Test**: Created (pre-existing): `ConfirmDialog.test.tsx` (`'clicking the cancel button calls onCancel exactly once and does not call onConfirm'`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/ConfirmDialog.test.tsx`
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-004: Pressing Escape calls `onCancel` exactly once and never calls `onConfirm`; the listener is inert while closed
- **Scenario**: The second dismiss path. Also verifies the Escape key listener is only live while the dialog is actually open — a listener that stayed attached after close/unmount could fire `onCancel` on an unrelated, later keypress against stale closures.
- **Steps**: Render `ConfirmDialog` with `open=true`, dispatch an `Escape` keydown, assert callback counts. Separately, render with `open=false` and dispatch `Escape`, assert `onCancel` was never called.
- **Expected Result**: `open=true` + Escape → `onCancel` called exactly once, `onConfirm` never. `open=false` + Escape → `onCancel` never called (no dangling listener).
- **Repeatable Unit Test**: Created (pre-existing): `ConfirmDialog.test.tsx` (`'pressing Escape calls onCancel and does not call onConfirm'` and `'does not attach the Escape listener when closed (no onCancel call on Escape)'`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/ConfirmDialog.test.tsx`
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-005: Clicking the overlay backdrop calls `onCancel`, but clicking inside the card does not
- **Scenario**: The third dismiss path, plus its direct counter-case in the same test file — an accidental click *inside* the card (e.g. on the message text, or anywhere that isn't a button) must not be misread as an overlay click and silently dismiss the dialog, which would be a confusing near-miss for a user about to confirm a destructive action.
- **Steps**: Render `ConfirmDialog` with `open=true`; click the overlay backdrop element directly and assert `onCancel` fires; separately click an element inside the card (not a button) and assert `onCancel` does not fire.
- **Expected Result**: Overlay click → `onCancel` called. Inside-card click → `onCancel` not called, dialog stays open.
- **Repeatable Unit Test**: Created (pre-existing): `ConfirmDialog.test.tsx` (`'clicking the overlay backdrop calls onCancel'` and `'clicking inside the card does not call onCancel'`) — both rely on the `e.target === e.currentTarget` overlay-click idiom (`ConfirmDialog.tsx`'s `handleOverlayClick`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/ConfirmDialog.test.tsx`
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-006: When `open=false`, `ConfirmDialog` renders nothing
- **Scenario**: The dialog must not leave any stray DOM (an invisible-but-present overlay could still intercept clicks or Escape). Complements UAT-EDGE-004's "listener is inert while closed" with the DOM-level guarantee.
- **Steps**: Render `ConfirmDialog` with `open=false`.
- **Expected Result**: The component renders `null` — no overlay, no card, nothing in the container.
- **Repeatable Unit Test**: Created (pre-existing): `ConfirmDialog.test.tsx` (`'renders nothing when open is false'`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/ConfirmDialog.test.tsx`
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-007: `CheckpointList`'s rollback confirmation still warns that uncommitted work will be overwritten
- **Scenario**: The most dangerous of the 6 migrated call sites — `git stash apply` against a live worktree, which can silently clobber uncommitted changes if the user didn't mean to roll back. Pinned at the rendered-DOM level (not a source-text grep) so a future refactor that touches `CheckpointList.tsx` and quietly softens or drops the warning — e.g. simplifying the message to a generic "Are you sure?" — fails a real test, not just code review.
- **Steps**: Mock `../lib/api`'s `fetchAgentCheckpoints` to resolve one checkpoint; render `<CheckpointList agentId={42} />`; wait for and click the "Rollback" button; assert the confirmation dialog's text.
- **Expected Result**: The rendered dialog contains text matching `/will overwrite uncommitted work in the worktree/i` — the exact substance of `CheckpointList.tsx`'s `message="Roll back to this checkpoint? This will overwrite uncommitted work in the worktree."` prop.
- **Repeatable Unit Test**: Created (new, this generation): `frontend/src/components/CheckpointList.test.tsx` (`'warns that uncommitted work will be overwritten when the Rollback confirmation dialog opens'`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/CheckpointList.test.tsx`
- [x] Pass <!-- 2026-08-15 -->

### UAT-UI-001: Removing an agent shows the styled confirm dialog, preserving the original message
- **Page**: `http://localhost:4321/` — agent detail modal
- **Description**: `AgentList.tsx`'s `handleRemove` (agent) call site.
- **Steps**:
  1. Open any agent's detail modal.
  2. Click "Remove agent."
  3. Observe the dialog.
- **Expected Result**: The styled `ConfirmDialog` appears (not a native browser confirm box) with message `Remove agent "<name>"? This kills its tmux window, deletes it from conductor.conf, and drops its queued tasks.` and a "Remove" confirm button. Cancel/Escape/overlay-click all dismiss with no side effect (agent still present); Confirm removes the agent.
- **Repeatable Unit Test**: Not applicable: requires the real component tree, real navigation, and a real agent — browser-only.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-15 -->

### UAT-UI-002: Closing an agent's window shows the styled confirm dialog, preserving the original message
- **Page**: `http://localhost:4321/` — agent detail modal
- **Description**: `AgentList.tsx`'s `handleCloseWindow` (agent) call site.
- **Steps**:
  1. Open any agent (with a live window) detail modal.
  2. Click "Close agent."
  3. Observe the dialog.
- **Expected Result**: Styled dialog with message `Close agent "<name>"'s window? The agent stays registered and can be relaunched with "Create window".` and a "Close" confirm button. Cancel/Escape/overlay-click dismiss with no side effect; Confirm closes the window (agent stays registered).
- **Repeatable Unit Test**: Not applicable: browser-only.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-15 -->

### UAT-UI-003: Removing a background process shows the styled confirm dialog, preserving the original message
- **Page**: `http://localhost:4321/` — background process row
- **Description**: `AgentList.tsx`'s bg-process `handleRemove` call site.
- **Steps**:
  1. Locate a background process row.
  2. Click "Remove."
  3. Observe the dialog.
- **Expected Result**: Styled dialog with message `Remove background process "<name>"? This kills its tmux window (if any) and removes it from the conductor registry.` and a "Remove" confirm button. Same dismiss-path guarantees as UAT-UI-001.
- **Repeatable Unit Test**: Not applicable: browser-only.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-15 -->

### UAT-UI-004: Closing a background process's window shows the styled confirm dialog, preserving the original message
- **Page**: `http://localhost:4321/` — background process row
- **Description**: `AgentList.tsx`'s bg-process `handleCloseWindow` call site.
- **Steps**:
  1. Locate a background process row with a live window.
  2. Click "Close."
  3. Observe the dialog.
- **Expected Result**: Styled dialog with message `Close "<name>"'s window? The process stays registered and can be relaunched with "Open window".` and a "Close" confirm button.
- **Repeatable Unit Test**: Not applicable: browser-only.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-15 -->

### UAT-UI-005: Removing an inactive agent shows the styled confirm dialog, preserving the original message
- **Page**: `http://localhost:4321/` — inactive agents panel
- **Description**: `InactiveAgentsPanel.tsx`'s `handleRemoveInactive` call site.
- **Steps**:
  1. Locate an inactive agent (status `no-window`/`exited`/`error`/`unknown`) in the Inactive Agents panel.
  2. Click "Remove."
  3. Observe the dialog.
- **Expected Result**: Styled dialog with message `Remove agent "<name>"? This deletes it from conductor.conf and drops its queued tasks.` and a "Remove" confirm button.
- **Repeatable Unit Test**: Not applicable: browser-only.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-15 -->

### UAT-UI-006: Rolling back a checkpoint shows the styled confirm dialog with the uncommitted-work warning
- **Page**: `http://localhost:4321/` — agent detail modal, Checkpoints section
- **Description**: `CheckpointList.tsx`'s `handleRollback` call site — the DOM-level browser companion to UAT-EDGE-007, which already pins the warning text in isolation; this case confirms it's reachable from the real "Rollback" button on a real checkpoint row, and that confirming actually calls `rollbackAgent` and reloads the list.
- **Steps**:
  1. Open a git-backed agent's detail modal with at least one recorded checkpoint (dispatch a task to a git-backed agent to trigger TASK-068's pre-dispatch checkpoint, or use an existing one).
  2. Expand the "Checkpoints" section; click "Rollback" on any row.
  3. Observe the dialog; test Cancel first, then re-open and Confirm.
- **Expected Result**: Styled dialog reads `Roll back to this checkpoint? This will overwrite uncommitted work in the worktree.` with a "Roll back" confirm button. Cancel dismisses with no API call (verify via Network tab — no `POST .../rollback`). Confirm issues `POST /api/agents/:id/rollback` and, on success, the checkpoint list and diff panel refresh.
- **Repeatable Unit Test**: Not applicable: the dialog text itself is pinned browser-free by UAT-EDGE-007; this case is specifically about the real button → real API call → real refresh chain, which needs a browser and a live backend.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-15 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| All 6 `window.confirm()` call sites are replaced with `ConfirmDialog` | UAT-UI-001 through 006 (each site individually), UAT-EDGE-001 (structural — nothing "left behind") |
| `window.confirm` no longer appears anywhere under `frontend/src/` | UAT-EDGE-001 |
| Each replaced dialog preserves its original message text and post-confirm behavior exactly | UAT-UI-001 through 006 (message text per site), UAT-EDGE-007 (CheckpointList's warning specifically, pinned browser-free) |
| `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/` | Already checked off in [[TASK-123]]'s own tackle steps; not re-run here since it carries no new runtime behavior beyond what those steps already confirmed, same precedent as UAT-063/076/110's typecheck-line convention |
| *(implied — the whole point of a shared component)* Confirm/Cancel/Escape/overlay-click all behave correctly and consistently across every call site, not just per-site copy-paste | UAT-EDGE-002 through 006 pin the shared `ConfirmDialog` component's behavior once, which every one of the 6 sites reuses verbatim — a regression in the shared component would be caught here without needing 6x duplicated browser walkthroughs |

---

## Notes

- **7 of 13 cases are machine-verifiable** (54%) — a strong ratio for a UI task, achieved specifically because TASK-127's harness landed first and because `ConfirmDialog`'s destructive-action safety properties (exact call counts per dismiss/confirm path) are pure, isolatable component behavior, not dependent on the 6 individual call sites' surrounding app state. The remaining 6 (46%) are genuinely human-only per team-lead's framing — each one is specifically "does clicking this particular trigger button, in the real app, open the right dialog" — which cannot be verified without the real component tree, routing, and (for `CheckpointList`) a live backend and a real git worktree.
- 5 of the 7 machine-verifiable cases cite `ConfirmDialog.test.tsx`'s 8 pre-existing promoted tests (added during TASK-123's own implementation) rather than duplicating them — this UAT adds exactly 2 new cases: the repo-wide `window.confirm` regression guard (UAT-EDGE-001) and the `CheckpointList` rollback-warning DOM pin (UAT-EDGE-007), both requested explicitly by team-lead and not covered by the pre-existing suite.
- `uatGenerate.promoteTests` resolves (via the legacy `true` → `dedicated` mapping) to "write to a dedicated test directory," but the repo's own layout overrides it — `frontend/src/components/` already holds `ConfirmDialog.test.tsx`/`AgentList.test.tsx`/`LogTail.test.tsx` as siblings of the modules they test, established by TASK-127 and TASK-123's own implementation. Both new tests this generation follow that same sibling convention (one extends `ConfirmDialog.test.tsx` in place, one creates `CheckpointList.test.tsx` as a new sibling) rather than a dedicated folder.
- The new `CheckpointList.test.tsx` mocks `../lib/api` (`fetchAgentCheckpoints`/`rollbackAgent`) rather than hitting a real network/host-server — no fixtures were written under `./tmp/`, and no live backend is touched by any machine-verifiable case in this file.
