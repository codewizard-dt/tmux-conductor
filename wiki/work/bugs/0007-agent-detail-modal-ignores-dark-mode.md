---
id: BUG-0007
aliases: [BUG-0007]
title: "AgentDetailModal ignores dark mode (hardcoded bg-white on the outer container)"
status: open
severity: high
priority: "—"
created: 2026-08-24
updated: 2026-08-24
reporter: David Taylor
assignee: "—"
tags: "—"
linked_task: "[[TASK-122]]"
---

# BUG-0007 — AgentDetailModal ignores dark mode (hardcoded bg-white on the outer container)

## Environment

- OS: macOS (Darwin 25.3.0)
- Browser: Chromium (Playwright)
- App: tmux-conductor dashboard
- Runtime: frontend (Vite dev server)
- Config: default, no overrides

## Steps to Reproduce

1. Toggle the dashboard into dark mode.
2. Click any agent tile to open its `AgentDetailModal`.
3. Observe the modal's background and every section nested inside it (Details, Queued tasks, Log output, Skills, Changes/Diff, Usage, Checkpoints).

## Expected Behavior

The modal and all of its nested sections render in the dark palette, consistent with the rest of the dashboard.

## Actual Behavior

`AgentDetailModal` renders entirely in the light palette regardless of dark mode being active. Root cause (found via source read + `getComputedStyle` during live verification, not yet fixed): `frontend/src/components/AgentList.tsx` line 686 hardcodes `bg-white` as a plain Tailwind utility class on the modal's outer container `div`, instead of a theme token (`bg-card`/`bg-surface`) — so it never picks up the `.dark` CSS variable overrides the rest of the app uses. Confirmed via `getComputedStyle`: `backgroundColor: rgb(255,255,255)` while `document.documentElement.className === "dark"`. Because the light background never changes, every section nested inside the modal (Details, Queued tasks, Log output chrome, Skills, the Diff panel, Usage breakdown, Checkpoints list) also reads as light-on-light or otherwise fails to re-theme, even though those child components themselves may use proper tokens.

This is distinct from — and not covered by — TASK-122's own pre-flagged known-gap list (which covered `AgentList.tsx`'s `STATUS_CONFIG`/role-color maps and a handful of specific arbitrary-hex classes elsewhere, not this line or a plain `bg-white` utility class).

Found during live Playwright-driven verification of UAT-122 (dashboard dark mode) on 2026-08-24.

## Reproducibility

- **Frequency**: always
- **First seen**: 2026-08-24
- **Last seen**: 2026-08-24

## Root Cause Analysis

> _(filled at `/bug-close`)_

## Resolution

> _(filled at `/bug-close`)_

## Related

> [[BUG-0003]], [[BUG-0004]], [[BUG-0005]], [[BUG-0006]] — found by the same UAT verification pass on adjacent UI, unrelated code paths
