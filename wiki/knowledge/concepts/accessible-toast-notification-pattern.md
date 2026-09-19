---
id: accessible-toast-notification-pattern
title: Accessible Toast/Notification Pattern (No Library)
updated: 2026-09-13
sources:
  - ../../raw/research/agent-status-notifications/index-2.md
confidence: extracted
tags: [frontend, accessibility, ux, pattern, notifications]
---

# Accessible Toast/Notification Pattern (No Library)

Reference notes for building a toast/notification UI by hand, gathered while researching `derived_from::[[agent-status-notifications]]` (a planned per-agent status-change notification for tmux-conductor's dashboard). No toast library is a dependency in this project (`frontend/package.json` has none), and the planned feature's shape — persistent, click-or-status-exit-dismissed, per-agent-keyed — doesn't match what toast libraries (Sonner, react-hot-toast, react-toastify) are built for (timed, fire-and-forget, one-shot). Sonner is the 2026 community default by download count (47.2M weekly vs. react-hot-toast's 4.8M) and bundle size (9.1 KB gzipped) if a *different*, genuinely timed/fire-and-forget toast need ever arises elsewhere in the app.

**Live region correctness is the most common way these break, and it has nothing to do with visible styling.** A screen reader announces a live region by watching an element already present in the accessibility tree and speaking whatever text subsequently appears inside it. If code creates a fresh DOM node that carries both the `aria-live` attribute and its message text in the same paint, the region usually isn't being observed yet and the message is never spoken. The fix: render one static, empty live-region container on initial mount (e.g. `<div role="status" aria-live="polite" aria-atomic="false">`), and only ever mutate its contents afterward — never recreate the container per-toast.

**Politeness level**: `role="status"` + `aria-live="polite"` fits a non-urgent status change (an agent needing input, a queue going empty); reserve `role="alert"`/`aria-live="assertive"` for something demanding immediate interruption. `aria-atomic="false"` ensures only the newly-added toast text is read, not the whole stack, when several are visible at once.

**Focus discipline (WCAG 4.1.3)**: a toast must be announceable to assistive tech without ever receiving focus automatically. Appearance must never steal keyboard focus — only an explicit user click/keypress on the toast may trigger a focus-moving action (e.g. opening a modal). This matters specifically for a *clickable* toast (vs. a purely informational one), since the natural instinct is to auto-focus the thing you just told the user about.

**Deduplication**: the standard toast-library idiom is a stable per-source id (a "toastId") so a second call for the same source replaces or no-ops instead of stacking a duplicate. For a per-entity notification (e.g. one toast per agent), keying the notification state by that entity's own id (`agent.id`) already *is* this dedup mechanism — no extra bookkeeping needed.

relates_to::[[agent-status-notifications]]
relates_to::[[agent-detail-modal]]
relates_to::[[accessible-dropdown-menu-pattern]]
