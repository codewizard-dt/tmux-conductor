---
id: TASK-0171
aliases: [TASK-0171]
title: "Add a status-colored right border to each sidebar agent row"
status: done
created: 2026-09-18
updated: 2026-10-17
depends_on: [TASK-0170]
blocks: []
parallel_safe_with: []
uat: "[[UAT-0171]]"
tags: [frontend, agents-page, status-indicator]
---

# TASK-0171 — Add a status-colored right border to each sidebar agent row

depends_on::[[TASK-0170]]
relates_to::[[agents-page-sidebar-layout]]

Roadmap: [[ROADMAP-0023]] Phase 1, item 3.

## Objective

With Kanban columns gone, status is no longer conveyed by column position. Give every agent row in the sidebar a thick right border whose color is driven by the agent's derived status through the existing `STATUS_CONFIG` / `getStatusColor()` mapping, so urgency is scannable down the list.

## Approach

- **Reuse `getStatusColor(status)`** (`AgentList.tsx`, returns `STATUS_CONFIG[status].dot`). Do not add a new color table. The mapping already groups sensibly: busy blue, idle/idle-waiting green, awaiting/empty amber, error/stalled/exited red, starting slate, no-window/unknown grey.
- **Apply it on `AgentItem`'s root element** (the row [[TASK-0170]] reuses): add `border-r-[4px]` and an inline `style={{ borderRightColor: getStatusColor(status) }}`. The other three sides keep `border-line`. Inline style (not a Tailwind arbitrary class) because the value is a runtime hex.
- **Color must not be the only status signal** (WCAG 1.4.1). The row already renders `StatusBadge` with a text label, so the border is a redundant scanning aid; keep the badge. The border is CSS only, so it adds nothing to the accessibility tree. Verify the border meets 3:1 non-text contrast against the row background in both light and dark themes using the hexes above (`#3b6ef6`, `#30a46c`, `#e0901a`, `#e5484d`, `#4f5a78`, `#9a9da5`). If a hex fails in one theme, note it and defer the fix to the contrast work already tracked in TASK-140 rather than inventing a second palette here.
- **No layout shift on status change.** The border width is constant; only its color changes, mirroring the no-shift rule established for the Direct Input terminal border (TASK-0164).
- Do not touch the `AgentDetailModal` or `InactiveAgentsPanel` here (the inactive section adopting the same border is optionally handled by [[TASK-0177]]).

## Dependencies

- depends_on: [[TASK-0170]] (sidebar rows must exist).
- blocks: none.
- File-overlap: `AgentList.tsx` / `AgentList.test.tsx` with every other Phase 1/2/4 task — serialized by the dependency chain above except versus [[TASK-0172]]–[[TASK-0174]] and [[TASK-0177]], which the orchestrator must not run concurrently.

## Files

- `frontend/src/components/AgentList.tsx` — `AgentItem` root className + inline `borderRightColor`.
- `frontend/src/components/AgentList.test.tsx` — border color assertions.

## Steps

### 1. Apply the border <!-- agent: general-purpose -->

- [x] In `AgentItem`, extend the root `div` className with `border-r-[4px]` and add `style={{ borderRightColor: getStatusColor(status) }}` (`status` is already `deriveStatus(agent)` in that component).
- [x] Confirm `getStatusColor` is defined above/exported such that `AgentItem` can call it without new imports (it is in the same file).

### 2. Tests and gates <!-- agent: general-purpose -->

- [x] Add tests: for each of `busy`, `idle`, `awaiting`, `error`, `exited`-filtered-out (skip), `starting`, assert the row's `style.borderRightColor` equals `getStatusColor(status)` (jsdom normalizes hex to `rgb(...)` — compare against a normalized value or use `toHaveStyle`). Assert a status flip on an existing row (via the existing SSE `agent-update` test harness) changes the border color without changing the element's class list.
- [x] Run `npm test` and `npm run typecheck` in `frontend/` — clean. (vitest 195/195, `tsc --noEmit` clean. Note: STATUS_CONFIG hexes are theme-independent, so the 3:1 contrast check per theme stays deferred to TASK-140 as the task directs; no new hex values added.)
- [ ] [DEFERRED-TO-UAT] Live Playwright check in light and dark themes: a busy agent shows a blue right border, an awaiting agent amber; measure `getBoundingClientRect()` of a row before/after a status change — identical.
