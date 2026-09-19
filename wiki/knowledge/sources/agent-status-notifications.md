---
id: agent-status-notifications
title: Agent Status Notification Banners Research
updated: 2026-09-13
sources:
  - ../../raw/research/agent-status-notifications/index.md
  - ../../raw/research/agent-status-notifications/index-2.md
confidence: extracted
tags: [frontend, notifications, ux, dashboard, accessibility]
---

# Agent Status Notification Banners Research

Research for a planned dashboard feature: dismissible, top-right banner notifications that fire when an agent transitions into `awaiting` ("waiting") or `empty` ("no tasks") status, debounced by a grace period to avoid flicker on brief transitions, auto-dismissed when the agent leaves that status, and click-to-focus into the agent's terminal.

**The two target statuses already exist and are already labeled exactly this way.** `frontend/src/components/AgentList.tsx::STATUS_CONFIG` labels `awaiting` as `"waiting"` and `empty` (idle with zero queued tasks) as `"no tasks"` — no new backend or status-derivation work is needed; `deriveStatus()` already computes both from `agent.state`/`agent.queuedTasks`.

**Directly reusable prior art exists for both halves of the feature.** The `agent-update` SSE handler in `AgentList.tsx` already keeps a `prevStatusRef: Map<agentId, AgentStatus>` and computes transitions on every update — currently used to play a doorbell/chime sound on `needsAttention` transitions (`needsAttention = awaiting || stalled`, notably *not* including `empty`, so the notification feature needs its own broader transition predicate). Separately, `uses::[[agent-detail-modal]]`'s `armInteract` prop (turned into LogTail's `interactSignal`) is exactly the "open the agent's modal and focus the terminal for input" mechanism the existing needs-attention card CTA already calls — the new notification's click handler should call the identical `setExpandedAgent({ id, armInteract: true })`.

**No toast/notification component exists in the codebase today**, and none is recommended — the codebase hand-rolls its overlay UI (e.g. `ConfirmDialog`) rather than depending on a toast library, and this feature's requirements (persistent until dismissed or status-exit, not a timed auto-expiring toast) don't match what libraries like `react-hot-toast`/`react-toastify` are built for anyway. A small bespoke `NotificationStack` component with no new dependency is recommended, fed by extending the existing SSE handler with a debounced open + immediate close-on-exit.

Full report, comparison, and citations: `raw/research/agent-status-notifications/index.md`.

**2026-09-13 update** (re-asked as "toast-like messages for agent status changes, click switches to that agent"): confirmed still unimplemented one month later — no `NotificationStack`/toast component exists in `AgentList.tsx`. This round adds three things the 08-15 report didn't cover:
- **Fresh library data doesn't change the "build bespoke" conclusion.** Sonner is now the 2026 default (47.2M weekly downloads vs. react-hot-toast's 4.8M, 9.1 KB gzipped), but the reasoning was never "no good library exists" — it's that this feature is a persistent, per-agent, click-or-status-exit-dismissed banner, not the timed fire-and-forget toast these libraries are built for.
- **Accessibility, unaddressed before**: the live-region container must be empty-on-mount and present in the initial markup — text set into a freshly-created element carrying its own `aria-live` attribute is not reliably announced. `role="status"` + `aria-live="polite"` fits a non-urgent status change; the toast must never steal keyboard focus merely by appearing (WCAG 4.1.3) — only an explicit click may act. See `uses::[[accessible-toast-notification-pattern]]`.
- **Two scope questions this phrasing reopens, unresolved by either round**: (1) does "agent status changes" mean the 08-15 report's `awaiting`/`empty` pair specifically, or a broader/all-transitions set (the full `AgentDisplayStatus` union has 10 values, and the existing `prevStatusRef` diffing machinery already generalizes to all of them with no new derivation work — this is a product choice, not a technical gap); (2) does "switch to that agent" mean the plain `onExpand(false)` card-click path, or the 08-15 report's `armInteract: true` (open + focus terminal for input) — these are one boolean apart in the existing `setExpandedAgent({ id, armInteract })` call but change the click's behavior meaningfully.

Full update, comparison, and citations: `raw/research/agent-status-notifications/index-2.md`.

relates_to::[[agent-detail-modal]]
relates_to::[[log-tail]]
relates_to::[[accessible-toast-notification-pattern]]
