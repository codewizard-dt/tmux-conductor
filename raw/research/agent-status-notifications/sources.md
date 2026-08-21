---
topic: "Notification system for tmux-conductor dashboard: dismissible banner-style notifications in a top-right container, triggered when an agent transitions into 'waiting' (awaiting input) status or 'no tasks' status, with a grace period to avoid flickering on brief status changes, auto-dismiss when the agent leaves that status, and click-to-focus behavior (opens the agent's modal and focuses the terminal for direct input)"
slug: agent-status-notifications
researched: 2026-08-15
---

# Primary Sources — Agent Status Notification Banners

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/state.ts` (AgentRunState type, ~L6; awaitingPattern/stalled docs ~L285-419) | 2026-08-15 | Confirms `awaiting`/`stalled` server-side state values and how `awaiting` is detected (pane-tail regex against `AWAITING_PATTERN`) |
| S2 | codebase | `frontend/src/components/AgentList.tsx::deriveStatus` (L103-116) | 2026-08-15 | Maps `agent.state`/`agent.queuedTasks` to the frontend `AgentStatus` union, incl. `awaiting` and `empty` |
| S3 | codebase | `frontend/src/components/AgentList.tsx::STATUS_CONFIG` (L80-92) | 2026-08-15 | `awaiting` labeled `"waiting"`; `empty` labeled `"no tasks"` — exact copy already in use |
| S4 | codebase | `frontend/src/components/AgentList.tsx` `useSSEEvent<Agent>('agent-update', ...)` handler (~L1333-1366) | 2026-08-15 | Existing per-agent `prevStatusRef` transition-tracking pattern; plays `playDoorbell`/`playChime` on specific status transitions — the direct precedent for the new notification trigger logic |
| S5 | codebase | `frontend/src/components/AgentList.tsx::needsAttention` (L99-101) | 2026-08-15 | `needsAttention(status) = status === 'awaiting' \|\| status === 'stalled'` — shows the existing "attention" set does NOT include `empty`, so the new feature needs its own transition predicate |
| S6 | codebase | `frontend/src/components/` directory listing (via `mcp__serena__list_dir`) | 2026-08-15 | No existing Toast/Notification/Banner component; `ConfirmDialog.tsx` is the closest bespoke-overlay precedent — confirms no toast library is currently a dependency |
| S7 | codebase | `frontend/src/components/AgentList.tsx` `AgentItem` `onExpand: (armInteract: boolean) => void` prop (~L924) | 2026-08-15 | Existing card CTA already opens the modal with an `armInteract` flag |
| S8 | codebase | `frontend/src/components/AgentList.tsx::AgentDetailModal` (L513-546) and `expandedAgent` state (L1271-1567) | 2026-08-15 | `armInteract` becomes `interactSignal`, described inline as "Incrementing signal (re)enables Direct Input in LogTail; seeded by the card CTA" — the exact mechanism to reuse for notification-click → focused terminal input |
| S9 | codebase | `frontend/src/App.tsx` (L1-27), `frontend/src/pages/AgentsPage.tsx`, `frontend/src/pages/ProjectDetailPage.tsx` (via `mcp__serena__search_for_pattern` for `AgentList`) | 2026-08-15 | `AgentList` renders only on the `/` route (`AgentsPage`); `App.tsx`'s `Dashboard` wraps `NavBar` + routes only — establishes where the notification container must live to see all agent SSE updates |
| S10 | web | https://www.developerway.com/posts/debouncing-in-react | 2026-08-15 | Confirms standard React debounce pattern (setTimeout + clear-on-change) for suppressing flicker from rapid state changes — no library required |
| S11 | web | https://ethora.com/blog/react-toastify-complete-guide-to-toast-notifications-in-react-2026/ | 2026-08-15 | Describes what toast libraries (react-toastify) solve (portals, ARIA, stacking, timed auto-dismiss) — used to justify why a bespoke component fits better than a toast library for this persistent/status-bound requirement |

## Excerpts

### S3 — STATUS_CONFIG (frontend/src/components/AgentList.tsx)
```
empty: { bg: 'rgba(224,144,26,0.10)', color: '#c07a10', dot: '#e0901a', label: 'no tasks' },
awaiting: { bg: 'rgba(224,144,26,0.10)', color: '#c07a10', dot: '#e0901a', label: 'waiting' },
```

### S8 — AgentDetailModal interactSignal (frontend/src/components/AgentList.tsx)
> // Incrementing signal (re)enables Direct Input in LogTail; seeded by the card CTA.
> const interactSignal = armInteract ? 1 : 0

### S10 — developerway.com, "How to debounce and throttle in React without losing your mind"
> Underneath, debounce is just a function, that accepts a function, returns another function, and has a tracker inside that detects whether the passed function was called sooner than the provided interval. If sooner - then skip the execution and re-start the clock.

### S11 — ethora.com, "React Toastify Guide"
> Even a minimal homegrown toast setup needs render portals, z-index management, ARIA live regions, animation cleanup, and some way to handle stacked notifications. None of that is rocket science individually, but it adds up.
