---
id: BUG-0008
aliases: [BUG-0008]
title: "Form inputs (AgentList filter, AddAgentForm) have near-invisible text in dark mode"
status: closed
severity: high
priority: "—"
created: 2026-08-24
updated: 2026-08-26
reporter: David Taylor
assignee: "—"
tags: "—"
linked_task: "[[TASK-124]]"
---

# BUG-0008 — Form inputs (AgentList filter, AddAgentForm) have near-invisible text in dark mode

## Environment

- OS: macOS (Darwin 25.3.0)
- Browser: Chromium (Playwright)
- App: tmux-conductor dashboard
- Runtime: frontend (Vite dev server)
- Config: default, no overrides

## Steps to Reproduce

1. Toggle the dashboard into dark mode.
2. Click into the `AgentList` text-filter input and type some text.
3. Observe the typed text's contrast against the input's background.
4. Separately, open "Add Agent" and type into the Name field — observe the same issue.

## Expected Behavior

Typed text in form inputs remains clearly legible in dark mode, matching the rest of the dashboard's dark-themed contrast.

## Actual Behavior

Typed filter/form text is nearly invisible in dark mode. Root cause (found via `getComputedStyle` during live verification, not yet fixed): `frontend/src/components/AgentList.tsx`'s filter-input `className` (~line 1521) hardcodes `bg-white` (a literal, non-theme-aware Tailwind colour) while pairing it with `text-ink`, a CSS-variable token that resolves to a light colour in dark mode — measured `background-color: rgb(255,255,255)` vs `color: rgb(238,240,244)`, a contrast ratio of roughly 1.05:1. The same defect is present in `AddAgentForm.tsx`'s shared `inputCls` (confirmed via the same computed-style check on its Name field), so this is an app-wide pattern, not a single isolated spot. This combination was correct before dark mode existed but TASK-122's dark-mode token rollout hasn't reached these input classNames. Not covered by TASK-122's own pre-flagged known-gaps list — a new, previously unrecorded instance of that same defect family (see also [[BUG-0007]]).

Found during live Playwright-driven verification of UAT-124 (AgentList text filter) on 2026-08-24.

## Reproducibility

- **Frequency**: always
- **First seen**: 2026-08-24
- **Last seen**: 2026-08-24

## Root Cause Analysis

Same defect family as [[BUG-0007]]: `AgentList.tsx`'s filter-input className and `AddAgentForm.tsx`'s shared `inputCls` both hardcoded the literal `bg-white` utility paired with the theme-token `text-ink` — `text-ink` correctly resolves to a light colour in dark mode (`--color-ink: #eef0f4`), but the literal white background never changes, producing ~1.05:1 contrast.

## Resolution

Replaced `bg-white` with `bg-card` in both locations: `AgentList.tsx`'s filter-input `className` (~line 1520) and `AddAgentForm.tsx`'s `inputCls` (~line 22).

### Verification performed

- Playwright against the live dev server with dark mode forced on: focused the `AgentList` filter input and typed text, then read `getComputedStyle` — `background-color: rgb(33, 35, 43)` / `color: rgb(238, 240, 244)`, correct dark-on-light... (dark background, light text) contrast, up from the previous ~1.05:1.
- `cd frontend && npm run typecheck && npm test` — clean, 65/65 pass.
- Did not independently re-screenshot `AddAgentForm.tsx`'s Name field beyond the source-level identical fix (same `inputCls` constant, same `bg-white`→`bg-card` change) — the class is shared verbatim so the AgentList filter verification transfers directly.

Note (same out-of-scope observation as BUG-0007): the identical `bg-white` + `text-ink`/similar pattern also appears in `ScheduleForm.tsx`, `AddProjectForm.tsx`, `AddBgProcessForm.tsx`, and other form components not named in this bug report — left untouched as out of scope, but they carry the same latent defect.

## Related

> [[BUG-0007]] — same defect family (hardcoded light-mode Tailwind colour not re-themed for dark mode), different component
