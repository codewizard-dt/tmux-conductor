---
id: BUG-0005
aliases: [BUG-0005]
title: "Usage badge squeezes the agent name to invisible width on real card layouts"
status: open
severity: high
priority: "—"
created: 2026-08-24
updated: 2026-08-24
reporter: David Taylor
assignee: "—"
tags: "—"
linked_task: "[[TASK-074]]"
---

# BUG-0005 — Usage badge squeezes the agent name to invisible width on real card layouts

## Environment

- OS: macOS (Darwin 25.3.0)
- Browser: Chromium (Playwright)
- App: tmux-conductor dashboard
- Runtime: frontend (Vite dev server), 3-column agent card grid
- Config: default, no overrides

## Steps to Reproduce

1. Open the dashboard with at least one agent that has non-null usage data (so the usage badge renders).
2. View at the app's real 3-column card width (~351-378px per card, both at 1200px and 1920px viewport widths).
3. Observe Row 1 of the agent card: project badge, agent name, usage badge, agent-type badge, status badge.

## Expected Behavior

The agent's name remains readable (or gracefully truncated with a reasonable minimum width) alongside the other Row 1 badges, at realistic card widths — not squeezed to near-zero.

## Actual Behavior

The usage badge is a 4th `flex-shrink-0` (non-shrinking) pill added to an already-tight row. At the app's actual 3-column card width, the four non-shrinking badges plus their gaps consume nearly the entire row width, leaving the agent-name span (`min-w-0 flex-1 truncate`) squeezed to **2.4px wide (fully invisible)** at a 1200px viewport, or **~29px ("bo…")** even at 1920px. Reproduces on all cards with a non-null-usage agent. Measured via `getBoundingClientRect()` on the live DOM during Playwright-driven verification of UAT-074 (token/cost badge UI) on 2026-08-24 — not a one-off, confirmed across 5 live agent cards.

## Reproducibility

- **Frequency**: always
- **First seen**: 2026-08-24
- **Last seen**: 2026-08-24

## Root Cause Analysis

> _(filled at `/bug-close`)_

## Resolution

> _(filled at `/bug-close`)_

## Related

> [[BUG-0003]], [[BUG-0004]] — found by the same UAT verification pass on adjacent UI, unrelated code paths
