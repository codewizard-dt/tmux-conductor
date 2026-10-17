---
id: TASK-135
aliases: [TASK-135]
title: "Dark-mode sweep — replace remaining hardcoded bg-white/surface literals across every page and component"
status: done
created: 2026-08-27
updated: 2026-09-19
depends_on: []
blocks: []
parallel_safe_with: [TASK-128, TASK-129, TASK-132, TASK-133]
uat: "[[UAT-135]]"
tags: [frontend, dark-mode, playwright]
---

# TASK-135 — Dark-mode sweep — replace remaining hardcoded bg-white/surface literals across every page and component

> **Caution — do not run concurrently with:** TASK-134 (Clone button in AgentDetailModal) and TASK-130 (dynamic terminal pane sizing) both edit `AgentList.tsx`/`LogTail.tsx`, the same files this sweep touches. Not a hard dependency (neither is a prerequisite), but avoid dispatching this task and either of those two to run at the same time — sequence them instead.

## Objective

BUG-0007 and BUG-0008 fixed two instances of the same defect: a component hardcodes `bg-white` (a literal, non-theme-aware Tailwind color) instead of a CSS-variable-backed token, so it never re-themes when `.dark` is toggled and renders light-on-dark or with broken contrast. `TASK-122` (the original dark-mode rollout) explicitly found and catalogued more instances of this exact defect but left them out of scope (see `wiki/work/tasks/TASK-122-dashboard-dark-mode.md`, Step 4's "Found, left as-is" note). This task closes that gap: sweep every page and component for the same class of hardcoded surface/border literal, fix each one to use the existing theme-token system, and verify every affected page live in both light and dark mode via Playwright — not just a code-level grep.

**Scope boundary (deliberately excluded, confirmed with user 2026-08-27):**
- `AgentList.tsx`'s hardcoded hex status/role-badge color maps (`STATUS_STYLES` and similar, plus the `bg-[#f1f2f4]`/`text-[#...]`/`bg-[#ede9fe]` arbitrary-value pill classes around lines 222, 310, 324, 329, 337, 353, 690, 749, 954) — these are semantic badge colors (green/red/purple) that need actual light+dark color pairs designed, not a mechanical token swap. Leave as-is; flag as a candidate for its own future task if you want it addressed.
- `LogTail.tsx`'s xterm.js terminal theme colors and the `bg-[#0b0b0d]`/`border-[#e0901a]` terminal-chrome classes (lines ~667-758) — this is an intentional fixed terminal color scheme (matches real terminal conventions), not surface chrome that should follow the app's light/dark palette. Leave as-is.
- Anything that is genuinely meant to stay a fixed color regardless of theme (e.g. a white icon glyph on a colored badge) — leave it, and note why in your commit/PR notes if you skip a match for this reason.

## Approach

1. Re-run the literal search fresh (don't trust the list below blindly — it's a snapshot from 2026-08-26/27) to catch anything new, then triage each hit: is it a card/modal/panel surface (→ `bg-card`), or something else this app's token system already has a name for? Reuse `frontend/src/styles/global.css`'s existing tokens — do not invent new ones:
   - `--color-canvas` (`bg-canvas`) — page/app background
   - `--color-card` (`bg-card`) — card, modal, dropdown, form-panel surfaces (this is what BUG-0007/BUG-0008 used)
   - `--color-ink` / `--color-ink-2` (`text-ink`, `text-ink-2`) — primary/secondary text
   - `--color-muted` / `--color-muted-2` (`text-muted`, `text-muted-2`) — tertiary text
   - `--color-line` / `--color-line-2` (`border-line`, `border-line-2`) — borders
2. Fix each real hit in place — a mechanical `bg-white` → `bg-card` swap in the vast majority of cases, matching the exact pattern BUG-0007/BUG-0008 already established. Check each swap keeps correct pairing with whatever text/border token sits alongside it (don't just swap background and leave a now-wrong-contrast text color).
3. Visually verify every affected page/component live in the actual running app with Playwright, in BOTH light and dark mode — code-level correctness is necessary but not sufficient (BUG-0007/0008 were themselves found via live verification, not a grep). Screenshot evidence into `./tmp/` (never `/tmp`).
4. Typecheck + existing test suite must stay green.

## Steps

### 1. Fresh sweep and triage <!-- agent: general-purpose -->

<!-- Updated: 2026-08-27 -->
<!-- Result: 41 confirmed in-scope bg-white -> bg-card hits across 20 files (12 new beyond the seed list: AddAgentForm.tsx:262,354; AddBgProcessForm.tsx:131; InactiveAgentsPanel.tsx:127; AgentList.tsx:724,738,934,1139,1157; AddTaskForm.tsx:172; LogTail.tsx:744,758-partial). All seed "confirm before fixing" items verified real (no grep-truncation false positives). bg-gray-/other plain-utility sweep: zero additional instances. Full triage table with exclusion list captured for Step 2. -->

- [x] Re-run `mcp__serena__search_for_pattern` for `bg-white` across `frontend/src` (code files) to get the current, authoritative hit list (the list below is a snapshot, treat it as a starting point, not ground truth).
  - Known hits as of 2026-08-26/27 (file:line, verify each still applies before fixing):
    - `ConfirmDialog.tsx:33,44`
    - `ScheduleForm.tsx:65,74,84,92`
    - `AddProjectForm.tsx:16,72`
    - `AddAgentForm.tsx:170` (note: `AddAgentForm.tsx`'s `inputCls`, a *different* line, was already fixed under BUG-0008 — don't re-touch that one, this is a second, separate `bg-white` spot in the same file)
    - `AddBgProcessForm.tsx:17,91`
    - `FolderPickerModal.tsx:66,150`
    - `ProjectList.tsx:72`
    - `InactiveAgentsPanel.tsx:75`
    - `TaskHistoryPage.tsx:40`
    - `ProjectDetailPage.tsx:117,136,167`
    - `AgentList.tsx:1433` (a remaining spot beyond the two already fixed under BUG-0007/BUG-0008)
    - `LogTail.tsx:602,758` (button variant strings — confirm these are reachable/rendered class names, not dead code, before fixing)
    - `TaskList.tsx:33`, `ScheduleList.tsx:135`, `AddTaskForm.tsx:130,140`, `ModeSwitcher.tsx:57`, `CheckpointList.tsx:95,118`, `DiffPanel.tsx:87` — grep truncated these in the original sweep; read each fully via `get_symbols_overview`/`find_symbol` to confirm whether `bg-white` is actually present (some may be false positives from truncated matches) before editing.
  - Also grep for `bg-gray-` and any other plain (non-token, non-arbitrary-hex) Tailwind background color utility across `frontend/src` — the same defect class could exist under a different literal color name, not just `bg-white`.
  - For each real hit, note in your working notes: file, line, current classes, and which token it should become (`bg-card` for the near-totality of these — card/modal/dropdown/form-panel surfaces — but verify each one visually fits that mold rather than assuming).

### 2. Fix each hit <!-- agent: general-purpose -->

<!-- Updated: 2026-08-27 -->
<!-- Result: all 41 confirmed hits swapped bg-white -> bg-card (2 partial: AddAgentForm.tsx:354, AddBgProcessForm.tsx:131, LogTail.tsx:758 kept their amber/orange accent classes untouched) across 19 files. Verified via git diff (71 insertions/50 deletions) and a repo-wide re-search: exactly one bg-white remains in frontend/src, LogTail.tsx:675, the deliberately-skipped status dot. cd frontend && npm run typecheck clean. -->

- [x] For every triaged hit from Step 1, replace the hardcoded literal with the correct token via Serena's `replace_content` (small, targeted edits — do not rewrite whole files).
  - Explicitly skip (do not touch): `AgentList.tsx`'s `STATUS_STYLES`/role-color hex maps and `bg-[#...]`/`text-[#...]` pill classes; `LogTail.tsx`'s xterm terminal-theme/chrome classes. These are out of scope per this task's Objective.
  - If a hit turns out to be intentionally theme-invariant (e.g. a literal white icon on a colored badge), leave it and record why in your final report — don't force a token onto something that isn't actually a re-themeable surface.

### 3. Live Playwright verification, every affected page <!-- agent: general-purpose -->

<!-- Updated: 2026-08-27 -->
<!-- Result: all 14 reachable components verified live in both light and dark mode via getComputedStyle (dark rgb(33,35,43) / light rgb(255,255,255)) plus screenshots (31 saved under ./tmp/task135-*.png, spot-checked visually, confirmed genuine). AddBgProcessForm and ScheduleForm/ScheduleList are dead code (not mounted anywhere reachable) - verified bg-card via source read instead per the task's own guidance not to force a fixture through a dead path. "Host-server not reachable" panel and TaskList/ScheduleList drag-item ternary also verified via source only (unsafe/unable to trigger live without mutating real fleet state). Both dev servers were already running; nothing to tear down. Noticed one unrelated pre-existing bug (agent-rename input pattern attribute console error) - out of scope, not touched. -->

- [x] Start the frontend dev server if one isn't already running (check first to avoid a port conflict — see `CLAUDE.md`'s `make dev`/`make ports`, default port 4321).
- [x] For every component/page touched in Step 2, navigate to (or open, for modals/dialogs/forms) the real UI surface that renders it, toggle dark mode, and confirm via `mcp__playwright__browser_snapshot`/`browser_take_screenshot` plus a `getComputedStyle` check (via `browser_evaluate`) that the background is now the dark token value (`rgb(33, 35, 43)` per `--color-card` dark, or whichever token you used) and text/border contrast is correct — not just that the class name changed in source.
  - This includes dialogs/forms that require a trigger action first (e.g. `ConfirmDialog` needs a delete/destructive action to open, `AddProjectForm`/`AddAgentForm`/`AddBgProcessForm`/`FolderPickerModal`/`ScheduleForm` need their respective "Add"/"Schedule" entry points, `ProjectDetailPage`/`TaskHistoryPage` need direct navigation).
  - Also re-check the SAME pages in light mode to confirm you haven't broken light-mode contrast with the token swap (tokens resolve differently per mode — verify both, don't assume).
  - Save screenshots to `./tmp/` (never `/tmp`) as evidence, named per component (e.g. `./tmp/task135-confirmdialog-dark.png`).
- [x] Kill any dev server you started yourself once verification is complete.

### 4. Regression check and bookkeeping <!-- agent: general-purpose -->

<!-- Updated: 2026-08-27 -->
<!-- Result: cd frontend && npm run typecheck && npm test both clean (independently re-verified by the orchestrator too): typecheck no errors, 65/65 vitest tests pass across 6 files. Full change/skip/verification summary captured across Steps 1-3's outline annotations above. -->

- [x] `cd frontend && npm run typecheck && npm test` — must be clean.
- [x] Update `wiki/work/tasks/TASK-135-dark-mode-hardcoded-surface-sweep.md`'s own status when done (this is handled by `/tackle`/`/uat-generate` per the normal task lifecycle — do not hand-edit status here mid-implementation).
- [x] In your final report, list every file:line actually changed (before/after class names), every hit you deliberately skipped and why, and a summary of what the Playwright verification actually showed per page (describe what you saw — don't just claim success).

## Related

`relates_to::[[TASK-122]]` — TASK-122's dashboard dark-mode rollout originally catalogued this exact gap and deferred it; this task closes it.
`relates_to::[[BUG-0007]]`, `relates_to::[[BUG-0008]]` — same defect class, already-fixed instances that established the `bg-white` → `bg-card` fix pattern this task reuses.
