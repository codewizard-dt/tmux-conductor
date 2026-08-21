---
topic: "Notification system for tmux-conductor dashboard: dismissible banner-style notifications in a top-right container, triggered when an agent transitions into 'waiting' (awaiting input) status or 'no tasks' status, with a grace period to avoid flickering on brief status changes, auto-dismiss when the agent leaves that status, and click-to-focus behavior (opens the agent's modal and focuses the terminal for direct input)"
slug: agent-status-notifications
researched: 2026-08-15
sources: [./sources.md]
---

# Research: Agent Status Notification Banners

> The dashboard already computes exactly the two trigger statuses (`awaiting` → "waiting", `empty` → "no tasks") via `deriveStatus()`/`STATUS_CONFIG`, and already has a working prior-art transition detector (`prevStatusRef` + the `agent-update` SSE handler in `AgentList.tsx`) that plays a doorbell sound on the same transition this feature needs to notify on. The recommended approach is a small bespoke `NotificationStack` component (no new dependency — matches the codebase's existing pattern of hand-built `ConfirmDialog`/`StatusBadge` over pulling in a UI library), fed by extending that same SSE handler with a debounced (grace-period) notification-open call and an immediate notification-close call on transition-out, reusing the existing `expandedAgent({id, armInteract: true})` modal-open + Direct-Input-focus mechanism for the click handler.

## Research Questions
1. Does the dashboard already have a way to detect "agent status became waiting / no-tasks" transitions, and where?
2. What are the exact status values to key the notification off of, and are they already labeled "waiting" / "no tasks" in the UI?
3. Is there an existing toast/notification/banner component or pattern in `frontend/src/` to extend instead of building new?
4. How does the existing "open modal + focus terminal for input" flow work today, so the notification click can reuse it verbatim?
5. Is a third-party toast library warranted, or does a bespoke component fit the codebase's conventions better?

## Current State (Codebase)

- **Status model**: `host-server/state.ts` defines `AgentRunState = 'no-window' | 'exited' | 'idle' | 'busy' | 'awaiting' | 'stalled' | 'starting' | 'unknown'` [S1]. `awaiting` is set when the pane's last non-blank line matches `AWAITING_PATTERN` (permission dialogs, `AskUserQuestion`, `[Y/n]` prompts); `stalled` is a derived-only state (never written to the state file) for a `busy` file gone stale with no pattern match [S1].
- **Frontend status derivation**: `frontend/src/components/AgentList.tsx::deriveStatus()` maps `agent.state === 'awaiting'` → `'awaiting'` and `agent.state === 'idle' && agent.queuedTasks === 0` → `'empty'` [S2]. `STATUS_CONFIG` already labels these exactly as the user described: `awaiting: { label: 'waiting', ... }` and `empty: { label: 'no tasks', ... }` [S3] — confirming the screenshot's "agent 1: needs input" / "agent 4: no tasks" map onto `awaiting`/`empty` respectively (the screenshot's own wording is a mockup annotation, not existing UI copy).
- **Existing transition-detection prior art**: `AgentList.tsx`'s `useSSEEvent<Agent>('agent-update', ...)` handler (~line 1333) already tracks `prevStatusRef: Map<number, AgentStatus>` per agent id, computes `newStatus`/`prevStatus` on every SSE update, and on the transition `needsAttention(newStatus) && !needsAttention(prevStatus)` plays a doorbell sound (`playDoorbell`); on `wasWorking && isDone` it plays a completion chime (`playChime`) [S4]. `needsAttention()` currently covers `awaiting || stalled` [S5] — the notification trigger set (`awaiting` + `empty`/"no tasks") is a different, slightly broader set the new code will need its own transition check for (reusing the same `prevStatusRef` pattern, not `needsAttention()` itself, since `empty` isn't "needs attention" today).
- **No existing toast/banner/notification component**: a full listing of `frontend/src/components/` shows no `Toast`, `Notification`, or `Banner` component — only `ConfirmDialog.tsx` as the closest "overlay UI" precedent, which is a bespoke, hand-styled modal (no external dialog/toast library) [S6]. This is a hand-rolled codebase: no toast library is currently a dependency.
- **Click-to-focus mechanism already exists and is directly reusable**: `AgentItem`'s card CTA calls `onExpand(armInteract: boolean)` [S7]; `AgentList`'s top-level component stores `expandedAgent: { id: number; armInteract: boolean } | null` state and passes `armInteract` into `AgentDetailModal`, which turns it into `interactSignal` — "Incrementing signal (re)enables Direct Input in LogTail; seeded by the card CTA" [S8]. So "click notification → open agent's modal, focus terminal for input" is exactly `setExpandedAgent({ id: agent.id, armInteract: true })` — the same call the existing needsAttention CTA already makes.
- **Where this lives**: `AgentList.tsx` is the single component owning agents state, SSE wiring, and modal state — not a separate top-level `Dashboard` container. `App.tsx`'s `Dashboard` only wires `NavBar` + routes; `AgentList` is rendered solely on `AgentsPage` (`/`) [S9]. A top-right notification container therefore belongs inside `AgentList.tsx` (or a new component it renders), not in `App.tsx`/`NavBar` — it won't currently persist across `/projects` navigation since `AgentList` unmounts there.

## Key Findings

- The two target statuses are already named exactly as the user wants them displayed: "waiting" (`awaiting`) and "no tasks" (`empty`) [S3].
- Grace-period debouncing before showing a transient UI element on rapid state changes is a standard, well-established React pattern — delay the "open" side of the transition by N ms in a `setTimeout`, and cancel that timeout if the status changes away before it fires; no library needed [S10].
- Popular toast libraries (`react-hot-toast`, `react-toastify`) exist and solve portals/ARIA/z-index/stacking for time-based auto-dismiss toasts, but this feature is explicitly **not** a timed toast — it's a persistent, click-or-status-dismiss banner keyed to per-agent state, which doesn't match what those libraries are built for (promise-based one-shot toasts) [S11]. Given the codebase already hand-rolls its overlay UI (`ConfirmDialog`), a bespoke component is the better fit and keeps zero new dependencies.

## Constraints

- Notification lifecycle must be per-agent, keyed by `agent.id` (mirrors `prevStatusRef`'s existing keying), so multiple simultaneous notifications (one per agent) stack independently in the container.
- The SSE `agent-update` handler is the only place status transitions are currently observed client-side — the grace-period timer and auto-dismiss logic both need to live in/near that handler (or a hook it calls), not in a polling loop.
- `expandedAgent` state (and thus modal-open + terminal-focus) already lives inside `AgentList`'s top-level function scope — the new notification-click handler must call the same `setExpandedAgent({ id, armInteract: true })` to stay consistent with the existing card-CTA behavior rather than inventing a second modal-opening path.
- `agents` can be removed via the `agent-removed` SSE event (`prevStatusRef.current.delete(id)`) [S9-adjacent] — any notification for a removed agent must also be cleared, or it will point at a modal for an agent that no longer exists.
- No existing notification-count/unread badge exists elsewhere in the UI (e.g. `NavBar`) to coordinate with — this is a net-new UI surface, not a v2 of something.

## Recommendation

**Build a bespoke `NotificationStack` (or similarly named) component, rendered inside `AgentList.tsx`'s top-level return, fixed-positioned top-right, fed by extending the existing SSE `agent-update` handler.**

Implementation outline:
1. Add a `notifications` state (e.g. `Map<agentId, { status: 'awaiting' | 'empty'; agentName: string; openedAt }>`) plus a `pendingTimersRef: Map<agentId, ReturnType<typeter,setTimeout>>` inside `AgentList`.
2. In the existing `agent-update` SSE handler, alongside the current doorbell/chime logic: when `newStatus` enters `{awaiting, empty}` and `prevStatus` did not, start a grace-period `setTimeout` (a few seconds, configurable) that adds the notification if the agent is *still* in that status when the timer fires (re-check current status, don't just fire blindly). When `newStatus` leaves `{awaiting, empty}` (or the agent is removed via `agent-removed`), clear any pending timer for that agent and remove any live notification for it immediately.
3. Render the notification stack as a fixed `top-right` container of banner cards, each dismissible via an explicit close button (does not auto-dismiss on a timer — per the requirement, only user-dismiss or status-exit removes it).
4. Wire each banner's click handler to `setExpandedAgent({ id: agent.id, armInteract: true })` — the exact call the existing needsAttention CTA uses — so the click opens `AgentDetailModal` with Direct Input already armed/focused, with no new modal-opening code path.
5. No new dependency required.

Risks and mitigations:
- **Stale closures in the SSE handler** — `useSSEEvent` callbacks capture state; use functional state updates (`setNotifications(prev => ...)`) and refs for timers, mirroring the existing `prevStatusRef`/`audioCtxRef` pattern already in the file.
- **Notification for an agent whose modal is already open** — decide (in Q&A) whether a notification should still fire/show while the user already has that agent's modal open, or suppress it; not yet resolved by research.
- **Grace period duration** — needs a concrete default (research found no project precedent for this number); should be a small named constant, easy to tune later.

Alternative if constraints change: if a future need arises for timed auto-expiring toasts elsewhere in the app (e.g. transient success confirmations), `react-hot-toast` would be worth reconsidering then — but it does not fit this specific persistent/status-bound requirement today.

## Next Steps

- Proceed to `/roadmap-create` (in progress) — phase this as: (1) backend/derivation is already done, no new host-server work needed; (2) frontend notification state + grace-period + auto-dismiss logic; (3) `NotificationStack` UI component; (4) click-to-focus wiring.
- Open questions to resolve in the roadmap Q&A: exact grace-period duration, whether an already-open modal for that agent should suppress its own notification, and container stacking order (newest-on-top vs. oldest-on-top) / max visible count.
