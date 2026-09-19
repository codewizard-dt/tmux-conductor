---
id: BUG-0005
aliases: [BUG-0005]
title: "Usage badge squeezes the agent name to invisible width on real card layouts"
status: closed
severity: high
priority: "—"
created: 2026-08-24
updated: 2026-08-26
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

`AgentItem`'s Row 1 (`frontend/src/components/AgentList.tsx`, `AgentItem` function) laid its five badges (`ProjectBadge`, `UsageBadge`, `AgentTypeBadge`, `RoleBadge`, `StatusBadge`) and the agent-name span out in a single-line `flex items-center gap-2` container. `ProjectBadge` and `UsageBadge` set `flex-shrink-0` explicitly; `AgentTypeBadge`/`RoleBadge`/`StatusBadge` have no shrink override but their min-content width (a colour dot + a short label) is effectively their full rendered width, so in practice none of the five badges yield any space. The only flexible element was the name span (`min-w-0 flex-1 truncate`), which absorbs 100% of the overflow — at the real 3-column card width (~351px) the five badges' combined content + gaps left the name at 2.4px.

## Resolution

Changed the Row 1 container from `flex items-center gap-2` to `flex flex-wrap items-center gap-x-2 gap-y-1`, and changed the name span from `min-w-0 flex-1 truncate` to `min-w-[72px] flex-1 truncate` (`AgentList.tsx` `AgentItem`, ~line 936). With `flex-1` giving the name span a `flex-basis: 0%`, the wrap algorithm now uses the explicit 72px floor (not 0) as its contribution when deciding what fits on the first line — badges that don't fit after that floor wrap onto a second line instead of squeezing the name further.

### Verification performed

- Playwright against the live dev server (`localhost:4321`, real data — 5 live agents with non-null usage): at 1200px viewport (real card width 351.3px) every agent name now renders 82-124px wide (previously 2.4px), and Row 1's measured height (46.5px) confirms it wrapped to two lines as designed. Screenshot: `tmp/bug0005-row1-wrap-1920w.png`.
- `cd frontend && npm run typecheck` — clean. `npm test` — 65/65 pass (no dedicated layout test existed to extend; this is a CSS/flex layout defect better covered by the live-DOM measurement above than a jsdom unit test, which doesn't lay out flex-wrap the same way a real browser does).

## Related

> [[BUG-0003]], [[BUG-0004]] — found by the same UAT verification pass on adjacent UI, unrelated code paths
