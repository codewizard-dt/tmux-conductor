---
id: agent-status-notifications
title: Agent Status Notification Banners Research
updated: 2026-08-15
sources:
  - ../../raw/research/agent-status-notifications/index.md
confidence: extracted
tags: [frontend, notifications, ux, dashboard]
---

# Agent Status Notification Banners Research

Research for a planned dashboard feature: dismissible, top-right banner notifications that fire when an agent transitions into `awaiting` ("waiting") or `empty` ("no tasks") status, debounced by a grace period to avoid flicker on brief transitions, auto-dismissed when the agent leaves that status, and click-to-focus into the agent's terminal.

**The two target statuses already exist and are already labeled exactly this way.** `frontend/src/components/AgentList.tsx::STATUS_CONFIG` labels `awaiting` as `"waiting"` and `empty` (idle with zero queued tasks) as `"no tasks"` — no new backend or status-derivation work is needed; `deriveStatus()` already computes both from `agent.state`/`agent.queuedTasks`.

**Directly reusable prior art exists for both halves of the feature.** The `agent-update` SSE handler in `AgentList.tsx` already keeps a `prevStatusRef: Map<agentId, AgentStatus>` and computes transitions on every update — currently used to play a doorbell/chime sound on `needsAttention` transitions (`needsAttention = awaiting || stalled`, notably *not* including `empty`, so the notification feature needs its own broader transition predicate). Separately, `uses::[[agent-detail-modal]]`'s `armInteract` prop (turned into LogTail's `interactSignal`) is exactly the "open the agent's modal and focus the terminal for input" mechanism the existing needs-attention card CTA already calls — the new notification's click handler should call the identical `setExpandedAgent({ id, armInteract: true })`.

**No toast/notification component exists in the codebase today**, and none is recommended — the codebase hand-rolls its overlay UI (e.g. `ConfirmDialog`) rather than depending on a toast library, and this feature's requirements (persistent until dismissed or status-exit, not a timed auto-expiring toast) don't match what libraries like `react-hot-toast`/`react-toastify` are built for anyway. A small bespoke `NotificationStack` component with no new dependency is recommended, fed by extending the existing SSE handler with a debounced open + immediate close-on-exit.

Full report, comparison, and citations: `raw/research/agent-status-notifications/index.md`.

relates_to::[[agent-detail-modal]]
relates_to::[[log-tail]]
