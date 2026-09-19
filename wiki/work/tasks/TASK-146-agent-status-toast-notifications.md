---
id: TASK-146
aliases: [TASK-146]
title: "Toast-like notifications on agent status change (waiting / no tasks), click switches to that agent"
status: pending-uat
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: []
parallel_safe_with: [TASK-134, TASK-140, TASK-141]
uat: "[[UAT-146]]"
tags: [frontend, notifications, ux, dashboard, accessibility]
---

# TASK-146 — Toast-like notifications on agent status change (waiting / no tasks), click switches to that agent

## Objective

Add a dismissible, per-agent toast/banner notification to the dashboard that fires when an agent transitions into the `awaiting` ("waiting") or `empty` ("no tasks") status, and disappears when the agent leaves that status or the user dismisses it. Clicking a toast switches the dashboard to that agent by opening its detail modal with Direct Input already armed/focused — the same action the existing needs-attention card CTA performs. No new toast library dependency; this is a small bespoke component reusing machinery already in `AgentList.tsx`.

Scope (confirmed): trigger set is exactly `awaiting`/`empty` (not a broader "any status change" set); click action arms Direct Input (`armInteract: true`), not just a plain open.

Full research and citations: `raw/research/agent-status-notifications/index.md` and `raw/research/agent-status-notifications/index-2.md`; wiki synthesis at `wiki/knowledge/sources/agent-status-notifications.md` and `wiki/knowledge/concepts/accessible-toast-notification-pattern.md`.

## Approach

- **Trigger detection**: extend the existing `useSSEEvent<Agent>('agent-update', ...)` handler in `frontend/src/components/AgentList.tsx` (~L1344-1377), which already tracks `prevStatusRef: Map<agentId, AgentStatus>` and computes `newStatus`/`prevStatus` on every update (this is the same block that plays `playDoorbell`/`playChime` today). Add a notify-in/notify-out check alongside the existing `needsAttention`/`wasWorking && isDone` checks, keyed on the set `{awaiting, empty}` rather than `needsAttention()`'s `{awaiting, stalled}` (they're different sets — `empty` is not currently in `needsAttention()`, see `AgentList.tsx` L99-101).
- **Grace period (debounce)**: on entering `{awaiting, empty}` from something else, don't show a toast immediately — start a `setTimeout` (`NOTIFICATION_GRACE_MS`, a named constant, default `3000`) and only add the toast if, when the timer fires, the agent (re-checked from current state, not the stale closure) is *still* in `{awaiting, empty}`. On leaving `{awaiting, empty}` (or on `agent-removed`), clear any pending timer for that agent id immediately and remove any already-shown toast for it immediately — no auto-dismiss timer on the visible toast itself.
- **Suppress-when-already-open**: skip creating a toast if `expandedAgent?.id === updated.id` at the moment the grace-period timer fires (the user is already looking at that agent's modal). Re-check this at fire time, not schedule time, since the modal could open/close during the grace period.
- **State shape** (added to `AgentList`'s top-level function scope, next to `prevStatusRef`/`audioCtxRef` at ~L1307-1309):
  - `const [notifications, setNotifications] = useState<Map<number, { agentName: string; status: 'awaiting' | 'empty' }>>(new Map())`
  - `const pendingNotifyTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())`
  - Use functional updates (`setNotifications(prev => ...)`) throughout — `useSSEEvent` callbacks close over stale state otherwise, exactly like the existing `prevStatusRef`/`audioCtxRef` pattern already guards against.
- **Cleanup on removal**: in the existing `useSSEEvent<{ id?: number }>('agent-removed', ...)` handler (~L1379-1385), also clear any pending timer and delete any notification for that id, mirroring the existing `prevStatusRef.current.delete(id)` line.
- **New component**: `frontend/src/components/NotificationStack.tsx` — props `{ notifications: Array<{ agentId: number; agentName: string; status: 'awaiting' | 'empty' }>, onDismiss: (agentId: number) => void, onOpen: (agentId: number) => void }`.
  - Fixed `top-4 right-4 z-40` container, `flex flex-col gap-2`, rendered via `createPortal` into `document.body` (mirrors `AgentDetailModal`'s own portal pattern).
  - **One persistent, empty-on-mount** `<div role="status" aria-live="polite" aria-atomic="false" className="sr-only">` announcer element inside the container, always present regardless of whether any toast is currently showing — do not create a fresh `aria-live` element per toast (screen readers won't reliably observe a live-region attribute and its text arriving in the same paint). Mirror each toast's message text into this announcer's content when it's added.
  - Each toast card: agent name, a status label reusing `STATUS_CONFIG[status].label`/`.color`/`.bg` from `AgentList.tsx` (import or lift `STATUS_CONFIG` if needed — it's currently module-private to `AgentList.tsx`), an explicit dismiss button (✕), `onClick` on the card body (not the dismiss button) calling `onOpen(agentId)`. Card must never receive focus automatically on mount — only the explicit click/keydown interaction may act.
  - Reuse the existing Tailwind `animate-popIn` class (`frontend/tailwind.config.js` L54/65) for the mount-in animation — matches `AgentItem`'s own card animation, no new CSS.
- **Wiring in `AgentList`'s render**: render `<NotificationStack notifications={[...notifications].map(([agentId, n]) => ({ agentId, ...n }))} onDismiss={(id) => setNotifications(prev => { const next = new Map(prev); next.delete(id); return next })} onOpen={(id) => { setExpandedAgent({ id, armInteract: true }); setNotifications(prev => { const next = new Map(prev); next.delete(id); return next }) }} />` near the top-level return, alongside where `expandedModalAgent`/`AgentDetailModal` is rendered (~L1424 onward) — opening the modal from a toast should also clear that toast.

## Steps

### 1. Notification state, SSE-handler wiring, and cleanup <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, add `NOTIFICATION_GRACE_MS = 3000` as a module-level constant near `STATUS_CONFIG`.
- [x] Add `notifications` state and `pendingNotifyTimersRef` inside the `AgentList` function, next to `prevStatusRef`/`hasReceivedSSEStateRef`/`audioCtxRef` (~L1307-1309).
- [x] In the `useSSEEvent<Agent>('agent-update', ...)` handler (~L1344-1377), after the existing `prevStatus`/`newStatus` computation and before `prevStatusRef.current.set(updated.id, newStatus)`:
  - If `newStatus` is `'awaiting'` or `'empty'` and `prevStatus` was neither: clear any existing pending timer for `updated.id`, then schedule a new one via `setTimeout(..., NOTIFICATION_GRACE_MS)` that re-derives the agent's *current* status from the latest `agents` state (via a functional `setAgents`-style read, or a ref mirroring `agents`) before adding to `notifications` — skip adding if the status has since changed away from `{awaiting, empty}`, or if `expandedAgentRef.current?.id === updated.id` (add a ref mirror of `expandedAgent` for this same reason — the SSE handler closure can't safely read the latest `expandedAgent` state directly).
  - If `newStatus` is neither `'awaiting'` nor `'empty'` and `prevStatus` was one of them: clear any pending timer for `updated.id` and remove any existing entry from `notifications` for that id, immediately (no grace period on the way out).
- [x] In the `useSSEEvent<{ id?: number }>('agent-removed', ...)` handler (~L1379-1385), also clear the pending timer (if any) and delete the `notifications` entry for that id.
- [x] Add a cleanup effect (or extend the existing cleanup in the `/status` fetch `useEffect`'s return, ~L1339-1341) that clears all pending timers in `pendingNotifyTimersRef.current` on unmount.

<!-- Updated: 2026-09-13 -- implemented in AgentList.tsx (~L80-85 constant, ~L1671-1694 state/refs incl. expandedAgentRef/agentsRef mirrors, ~L1733-1810 agent-update handler, ~L1812+ agent-removed handler, ~L1724-1730 unmount cleanup). tsc --noEmit clean; added a temporary `void notifications` line since nothing reads the state yet -- step 2 must remove it once NotificationStack consumes `notifications`. Judgment call: entering {awaiting,empty} with prevStatus === undefined (a brand-new agent's first SSE update) is treated as a notify-in per the literal spec, unlike the existing doorbell logic's explicit prevStatus !== undefined guard -- worth a second look if this misfires on freshly-spawned agents. -->

### 2. `NotificationStack` component <!-- agent: general-purpose -->

- [x] Create `frontend/src/components/NotificationStack.tsx` implementing the props/shape described in Approach above: `createPortal`-rendered fixed top-right stack, one persistent `role="status" aria-live="polite" aria-atomic="false"` announcer element (visually hidden, e.g. Tailwind `sr-only`, but always present in the DOM — not conditionally rendered), one card per notification with agent name + status label + dismiss button, `animate-popIn` on each card.
- [x] If `STATUS_CONFIG` is not already exported from `AgentList.tsx`, export it (or the subset needed: `label`/`bg`/`color` for `awaiting`/`empty`) so `NotificationStack` can reuse the exact same colors/labels rather than duplicating the config.
- [x] Ensure the card's `onClick` fires only on explicit user interaction (click or Enter/Space via `role="button"` + `tabIndex={0}` + `onKeyDown`, matching `AgentItem`'s own existing pattern at ~L938-945) — never on mount.
- [x] Import and render `<NotificationStack />` from `AgentList.tsx`'s top-level return, wired to `notifications`/`setExpandedAgent`/`setNotifications` per the Approach section.

<!-- Updated: 2026-09-13 -- NotificationStack.tsx created (62 lines); STATUS_CONFIG exported from AgentList.tsx (L87); placeholder void notifications removed; component wired in near BgProcessSection/AgentDetailModal render (~L2032). tsc --noEmit clean (fixed one noUncheckedIndexedAccess hit on notifications[length-1]). -->

### 3. Tests <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.test.tsx` (or a new sibling `NotificationStack.test.tsx`, following this repo's established sibling-test-file convention), add test cases using fake timers (`vi.useFakeTimers()`):
  - A transition into `awaiting` does not show a toast before `NOTIFICATION_GRACE_MS` elapses, and does show it after, with the correct agent name and "waiting" label.
  - A transition into `awaiting` that reverts to `busy` before the grace period elapses never shows a toast.
  - A toast for an agent that then leaves `awaiting`/`empty` is removed immediately (before any grace period would apply on the way out).
  - Dismissing a toast via its ✕ button removes it and does not reopen the agent's modal.
  - Clicking a toast's body calls `setExpandedAgent` with `{ id: agent.id, armInteract: true }` (verify via the existing modal-open assertion pattern already used elsewhere in `AgentList.test.tsx`, e.g. asserting `getByRole('dialog', { name: '<agent> detail' })` appears) and removes the toast.
  - No toast is created for an agent whose modal is already open (`expandedAgent.id === agent.id`) when its status enters `awaiting`/`empty`.
  - `agent-removed` for an agent with a pending grace-period timer or a visible toast clears both without error.
- [x] Run `npx vitest run src/components/AgentList.test.tsx` (and the new test file if separate) — must be green.
- [x] Run `npx tsc --noEmit` from `frontend/` — must be clean.

<!-- Updated: 2026-09-13 -- 7 new test cases added to AgentList.test.tsx (~L1691-1912): CapturingEventSource + fireSSE helper (repo had no working SSE-delivery test mechanism before this), MockAudioContext stub for the doorbell-sound side effect, describe block covering all 7 checklist cases. vitest: 88 passed (81 pre-existing + 7 new), 0 failed. tsc --noEmit clean. -->
