---
id: TASK-0179
aliases: [TASK-0179]
title: "Remove the toast notification feature (TASK-146)"
status: done
created: 2026-09-19
updated: 2026-09-19
depends_on: []
blocks: []
parallel_safe_with: []
uat: ""
tags: [frontend, agents-page, cleanup]
---

# TASK-0179 — Remove the toast notification feature (TASK-146)

relates_to::[[TASK-146]]

## Objective

TASK-146 added a dismissible toast/banner (`NotificationStack`) that fires when an agent enters `awaiting`/`empty` and stays there past a grace period, clicking it to select the agent with Direct Input armed. Remove this feature entirely: delete the component, strip its state and SSE wiring out of `AgentList.tsx`, and remove the now-dead tests from `AgentList.test.tsx` — without touching the shared SSE test scaffolding those tests share with unrelated describe blocks (cycling, doorbell/chime sound).

## Approach

**Delete outright**: `frontend/src/components/NotificationStack.tsx` (the whole file — its only consumer is `AgentList.tsx`).

**Strip from `frontend/src/components/AgentList.tsx`**:
- The `import NotificationStack from './NotificationStack'` line (~L14).
- The `NOTIFICATION_GRACE_MS` module-level constant (~L87) and its preceding comment.
- The `notifications` state and `pendingNotifyTimersRef` ref (~L1865-1873), including their explanatory comments.
- The `pendingNotifyTimersRef` cleanup loop inside the mount effect's cleanup function (~L1916-1920) — remove only the toast-timer-clearing lines, not the whole cleanup function (it also closes `audioCtxRef`, which stays — the doorbell/chime sound feature is explicitly out of scope for this task).
- Inside the `useSSEEvent<Agent>('agent-update', ...)` handler: the entire notify-in/notify-out block (~L1947-1990, from the `// Toast-like notification bookkeeping` comment through the `setNotifications` `else if` branch) — but keep everything else in that handler (the doorbell/chime `needsAttention`/`wasWorking && isDone` block above it, and the `prevStatusRef`/`setAgents` calls below it) untouched.
- Inside the `useSSEEvent<{ id?: number }>('agent-removed', ...)` handler: the pending-timer-clear + `setNotifications` cleanup block (~L2006-2017) — keep `prevStatusRef.current.delete(id)`, `setAgents((prev) => prev.filter(...))`, and the `setExpandedAgent` deselect-on-removal logic untouched.
- The `<NotificationStack .../>` element in the render return (~L2194-2201), including its `onDismiss`/`onOpen` inline handlers. Do **not** remove the `</div>` it sits alongside or any other JSX in that render block.

**Leave untouched**: `STATUS_CONFIG` (exported — used extensively by `StatusBadge`/`getStatusColor` and by unrelated test assertions on status badges and the sidebar row status border, not just by the removed toast feature); the doorbell/chime `needsAttention`/`playDoorbell`/`playChime` sound feature (a separate, still-desired feature that happens to live in the same SSE handler); `expandedAgentRef`/`agentsRef` mirrors (still used by cycling/selection logic elsewhere, not just by the removed toast-suppression check — verify with `find_referencing_symbols` before assuming, but do not remove speculatively).

**Strip from `frontend/src/components/AgentList.test.tsx`** — this file mixes toast tests into blocks that also cover unrelated behavior, and defines shared SSE test scaffolding that must survive:
1. Delete the whole `describe('NotificationStack grace-period toasts (TASK-146 Step 3)', () => { ... })` block (~L2883 through its closing `})`, currently ending around L3143) and its immediately preceding section-header comment (~L2809 `// ── NotificationStack grace-period toasts ...` through the end of that comment block, ~L2823).
2. **Keep** the `CapturingEventSource` class, the `fireSSE` function, `MockAudioContext`, and `mockAudioParam` (~L2824-2878, sitting between the comment block and the toast describe) — `find_referencing_symbols` on each first to confirm they're still referenced by the cycling describe block (`AgentList cycling order and arm-interact against the pane selection (TASK-0174)`) and other tests after this task's edits; they are shared SSE/audio test infrastructure, not toast-specific, despite living next to the toast tests. Rewrite the explanatory comment above `CapturingEventSource` (~L2809-2823) to drop the NotificationStack-specific framing ("NotificationStack itself is a dumb renderer...") while keeping the still-accurate parts (why a capturing stub is needed vs. the simpler no-op `MockEventSource` used elsewhere, the `capturedEventSource` reset-per-test pattern).
3. **Keep** the `NOTIFICATION_GRACE_MS` local constant (~L2880-2881) only if something still references it after step 4 below; otherwise delete it along with its comment. Re-check with `search_for_pattern` after finishing steps 1 and 4 — do not assume up front.
4. Inside `describe('AgentList cycling order and arm-interact against the pane selection (TASK-0174)', ...)` (~L1491-1882): delete exactly these 3 `it(...)` blocks and nothing else in this describe:
   - `'a toast click selects the agent, shows the Terminal tab and arms Direct Input (interactSignal 1), even while a different agent is selected'` (~L1625-1645)
   - `'a toast is suppressed at fire time for the currently selected agent, but not for one that was selected only after the transition'` (~L1647-1665)
   - `'suppresses a toast already scheduled for an agent that is selected during the grace period (checked at fire time, not schedule time)'` (~L1667-1693)
   Keep every other `it(...)` in this describe (the Shift+Cmd cycling tests, the prev/next-button test, the filtered-cycling test, the OS-aware-shortcut test, the plain-click-vs-CTA-arm test, the inactive-agent no-op test) untouched — they test unrelated cycling/arm-interact behavior and reuse the same `stubFetchWithAgents`/`openAgent` helpers this task must not disturb.
5. Inside `describe('AgentList sidebar + pane selection gaps (TASK-0173 UAT)', ...)` (~L3143-3390): delete the single `it('a toast click drives through AgentList to the target agent pane with its Terminal tab active, replacing another agent\'s pane and tab', ...)` block (~L3360-3389, the last test in this describe, immediately before its closing `})`). Keep every other test in this describe untouched.

**Verify no orphaned imports remain**: after the edits, `search_for_pattern` for `NotificationStack`, `NOTIFICATION_GRACE_MS`, and `pendingNotifyTimersRef` across `frontend/src` — all should return zero matches. `STATUS_CONFIG` will still have many matches (expected — it is not being removed).

## Steps

### 1. Delete the component and strip AgentList.tsx <!-- agent: general-purpose -->
<!-- Updated: 2026-09-19 06:06 -->

- [x] `git rm` (or delete + let the next commit pick it up) `frontend/src/components/NotificationStack.tsx`.
- [x] In `frontend/src/components/AgentList.tsx`, remove the `NotificationStack` import.
- [x] Remove the `NOTIFICATION_GRACE_MS` constant and its comment.
- [x] Remove the `notifications` state and `pendingNotifyTimersRef` ref and their comments.
- [x] Remove the toast-timer-clearing lines from the mount effect's cleanup function, keeping `audioCtxRef.current?.close()...` untouched.
- [x] Remove the notify-in/notify-out block from the `agent-update` SSE handler, keeping the doorbell/chime block above it and `prevStatusRef.current.set(...)`/`setAgents(...)` below it untouched.
- [x] Remove the pending-timer-clear + `setNotifications` cleanup from the `agent-removed` SSE handler, keeping `prevStatusRef.current.delete(id)`, the `setAgents` filter, and the `setExpandedAgent` deselect logic untouched.
- [x] Remove the `<NotificationStack .../>` render block from the component's return.
- [x] Confirm via `find_referencing_symbols` that `expandedAgentRef`/`agentsRef` still have other consumers before assuming they're safe to leave; if either turns out to have been toast-only, remove it too (unexpected — verify, don't assume). — Verified toast-only (sole reads were inside the grace-period timeout); both refs and their two sync effects removed.

### 2. Strip the dead tests from AgentList.test.tsx, preserving shared scaffolding <!-- agent: general-purpose -->
<!-- Updated: 2026-09-19 06:10 — 16 toast tests removed total (12 + 3 + 1, counted from source); AgentList.test.tsx 144/144 passing after edits (no pre-edit baseline was run) -->

- [x] Delete the `describe('NotificationStack grace-period toasts (TASK-146 Step 3)', ...)` block and its section-header comment, per Approach. — Deviation: the describe held 13 `it` blocks; 12 toast tests deleted, 1 non-toast test (`'agent-removed for the selected agent returns the pane to the empty state (TASK-0173)'`) kept, so the describe shell survives, renamed `'AgentList agent-removed SSE handling (TASK-0173)'`.
- [x] Confirm `CapturingEventSource`, `fireSSE`, `MockAudioContext`, `mockAudioParam` still have other referencing tests via `find_referencing_symbols`; keep them, and rewrite the comment above `CapturingEventSource` to remove the NotificationStack-specific framing while keeping the still-accurate rationale.
- [x] Delete the 3 toast-specific `it(...)` blocks inside the `AgentList cycling order and arm-interact...` describe, per Approach — leave every other test in that describe untouched.
- [x] Delete the 1 toast-specific `it(...)` block inside the `AgentList sidebar + pane selection gaps (TASK-0173 UAT)` describe, per Approach — leave every other test in that describe untouched.
- [x] Re-check whether `NOTIFICATION_GRACE_MS` (the test file's local copy) still has any references; delete it and its comment if not.
- [x] `search_for_pattern` for `NotificationStack`, `NOTIFICATION_GRACE_MS`, and `pendingNotifyTimersRef` across `frontend/src` — confirm zero matches.

### 3. Gates <!-- agent: general-purpose -->
<!-- Updated: 2026-09-19 06:14 -->

- [x] Run `cd frontend && npx tsc --noEmit` — clean, no orphaned-import or unused-variable errors. — Exit 0, empty output.
- [x] Run `cd frontend && npm test` — 11 files / 241 tests passed, 0 failed. The exact 16-test drop (12 + 3 + 1) is counted from source, not measured against a pre-edit run (no baseline was taken). Original criterion: confirm the total test count dropped by exactly 4 (the 3 embedded toast tests + 1 sidebar toast test) plus however many `it(...)` blocks were inside the deleted `NotificationStack grace-period toasts` describe (count them when you delete the block and report the number), and that every other previously-passing test in the touched describes still passes unmodified.
- [x] (Result: one stale comment left for a human call — `AgentList.tsx:648` "…needs-attention CTA / notification-toast"; `animate-popIn` still has live consumers, kept.) `search_for_pattern` for `toast` (case-insensitive) across `frontend/src` to confirm no leftover toast-specific UI copy, CSS classes (e.g. `animate-popIn` if it has no other consumer — check before removing anything in `tailwind.config.js`, it may be reused elsewhere), or comments remain. Report anything found that looks like a leftover reference so a human can decide whether it's in scope.

## Notes

- This reverses TASK-146 (`wiki/work/tasks/archive/TASK-146-agent-status-toast-notifications.md`), which was already closed via `/uat-auto-plus` + explicit user-directed skip of its remaining UI/manual UAT cases (see `wiki/work/uat/archive/UAT-146-agent-status-toast-notifications.md`). One of those skipped cases (UAT-EDGE-006) was an unresolved product question about whether a brand-new agent's first-ever `awaiting`/`empty` status should toast — that question is now moot.
- No active task currently touches `AgentList.tsx`/`AgentList.test.tsx` mid-edit (the ROADMAP-0023 tasks that also edit these files are `pending-uat`, i.e. implementation-complete and not being actively edited) — no dependency conflicts, but re-check `wiki/work/tasks/index.md` at execution time since this can change.
- Filed directly by user request: "remove the toast notifications."
