---
id: UAT-150
aliases: [UAT-150]
title: "UAT: Unify badge/status colors into one cohesive, collision-free palette"
status: passed
task: TASK-150
created: 2026-09-13
updated: 2026-09-13
---

# UAT-150 — UAT: Unify badge/status colors into one cohesive, collision-free palette

implements::[[TASK-150]]

> **Source task**: [[TASK-150]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Repo checked out at `frontend/` with dependencies installed (`npm install` already run — the existing `node_modules` in this repo is sufficient)
- [ ] For the UAT-UI cases only: frontend dev server running via `make dev` (or `/run`) so the dashboard is reachable at `http://localhost:4321/` — the UI/visual cases are explicitly deferred from `/tackle` to this UAT phase per TASK-150 Step 5's own `[DEFERRED-TO-UAT]` markers
- [ ] For UAT-UI-003 specifically: at least one registered agent whose project resolves to a hue that used to collide with the amber semantic band pre-fix (`tmux-conductor` is the example cited in the task's own screenshot bug report and in the repo's own dogfood session)

---

## Test Cases

### UAT-UNIT-001: ROLE_CONFIG / resolveRoleBadge migrated off raw Tailwind classes onto the new per-role CSS token pairs
- **Scenario**: TASK-150 Step 2 replaced `ROLE_CONFIG`'s hard-coded Tailwind `className` strings (e.g. `bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300`) with inline `style={{ background, color }}` referencing the new `--role-badge-<role>-{bg,text}` tokens from `frontend/src/styles/global.css`, for every role except `architect` (which reuses `--color-badge-neutral-{bg,text}`).
- **Steps**:
  1. From `frontend/`, run the command below.
  2. Confirm `resolveRoleBadge('qa')` resolves to `{ role: 'qa', bg: 'var(--role-badge-qa-bg)', text: 'var(--role-badge-qa-text)', dot: '#06b6d4' }` (and the null/undefined/`generic`/unrecognized-role cases still return `null`).
- **Repeatable Unit Test**: Created (pre-existing, added during `/tackle` Step 2 — `resolveRoleBadge`/`ROLE_VALUES` describe blocks, `frontend/src/components/AgentList.test.tsx` lines ~101-138)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx -t "resolveRoleBadge|ROLE_VALUES"`
- [x] Pass <!-- 2026-09-13 -->

### UAT-UNIT-002: projectHue() constrained to the three safe hue bands — never collides with a semantic status hue
- **Scenario**: TASK-150 Step 3 rewrote `projectHue()` (`frontend/src/components/AgentList.tsx`) to remap its char-code hash onto one of three safe sub-ranges — `(56,132]`, `(172,207]`, `(278,331]` — instead of raw `% 360`, so no project name can land inside the ±20° exclusion bands around the red/rose/amber/green/blue/violet semantic hues.
- **Steps**:
  1. From `frontend/`, run the command below.
  2. Confirm the pinned-hue assertions (`cryptwiz` → 131, `tmux-conductor` → 71) and the 20-name band-exclusion sweep (real project names from this repo's own working directories plus synthetic edge cases: 1-char, 50-char, Unicode, mixed-case/separator styles) all pass.
- **Repeatable Unit Test**: Created (pre-existing, added during `/tackle` Step 3 — `ProjectBadge` describe block, `frontend/src/components/AgentList.test.tsx` lines ~246-310)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx -t "ProjectBadge"`
- [x] Pass <!-- 2026-09-13 -->

### UAT-UNIT-003: STATUS_CONFIG and AgentTypeBadge's Codex branch reference the new CSS tokens instead of inline hex/rgba literals
- **Scenario**: TASK-150 Step 4 removed inline color literals from `STATUS_CONFIG`'s `busy`/`idle-waiting`/`error`/`stalled`/`starting` entries and from `AgentTypeBadge`'s non-Claude (Codex) branch, pointing them at `--color-status-busy-*`, `--color-status-success-*` (idle-waiting), `--color-status-error-*` (error/stalled), `--color-status-neutral-*` (starting), and `--color-badge-type-codex-*` respectively — with no visible color change. `STATUS_CONFIG`/`AgentTypeBadge`/`StatusBadge` are module-private (not exported from `AgentList.tsx`), so this is asserted through the full `AgentList` render tree by inline-style equality, the same technique the pre-existing `ProjectBadge` tests use for hue tokens.
- **Steps**:
  1. From `frontend/`, run the command below.
  2. Confirm all 5 cases pass: `busy` badge uses `var(--color-status-busy-{bg,text})`; `starting` uses `var(--color-status-neutral-{bg,text})`; an idle Codex agent with zero queued tasks renders `idle/waiting` via `var(--color-status-success-{bg,text})` *and* a `codex` type badge via `var(--color-badge-type-codex-{bg,text})` in the same render; `stalled` and `error` both use `var(--color-status-error-{bg,text})`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (new `describe('status and agent-type badge tokens (TASK-150 Step 4 detokenization)')` block, inserted directly after the existing `ProjectBadge` describe block)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx -t "TASK-150 Step 4 detokenization"`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-001: exited/no-window/unknown statuses are intentionally out of this unit test's reach — StatusBadge's "exited" partial-tokenization isn't independently verifiable here
- **Scenario**: `STATUS_CONFIG.exited` tokenizes only its `bg` (`var(--color-status-error-bg)`); its `color`/`dot` deliberately stay the literal `#e5484d` (per the task's own Step 4 annotation: "`exited`'s text/dot kept literal since it wasn't byte-identical to the error token — avoids a visual change"). `columnFor()` excludes `exited`/`no-window`/`unknown` from `AgentList`'s own kanban columns — those statuses render via `InactiveAgentsPanel.tsx` (a separate component, out of TASK-150's scope), not through `AgentList`'s `StatusBadge`. An agent fixture with `state: 'exited'` therefore never reaches a `StatusBadge` in `AgentList`'s render tree, so this specific literal-vs-token claim cannot be asserted the same way UAT-UNIT-003 asserts the others.
- **Steps**: N/A — documented gap, not a runnable check.
- **Expected Result**: No regression is claimed or verified here for the `exited` literal-color decision beyond the static code read performed during UAT generation (confirmed present in `AgentList.tsx`'s `STATUS_CONFIG.exited` entry). If `InactiveAgentsPanel.tsx` is ever brought into a future color-token pass, it needs its own UAT coverage.
- **Repeatable Unit Test**: Not applicable: the code path under test is not reachable through `AgentList`'s render tree; testing it would require covering `InactiveAgentsPanel.tsx`, which is a different component outside TASK-150's stated scope.
- [x] Pass <!-- 2026-09-13 --> — verified via Serena code read (not just re-recorded): `STATUS_CONFIG.exited` in `AgentList.tsx` confirmed as `{ bg: 'var(--color-status-error-bg)', color: '#e5484d', dot: '#e5484d', label: 'exited' }` (bg tokenized, color/dot literal, matching the claim exactly), and `COLUMNS`/`columnFor()` confirmed to omit `exited`/`no-window`/`unknown` from the three kanban columns (`attention`, `busy`, `ready`), routing them elsewhere. The documented gap is accurate as of this verification.

### UAT-EDGE-002: global.css defines all new token pairs, at the specified hues, in both the light (:root) and dark (.dark) blocks
- **Scenario**: TASK-150 Step 1 added `--role-badge-{frontend,devops,qa,backend,security}-{bg,text}` (hues 285/305/190/95/115), `--color-status-busy-{bg,text}`, `--color-status-neutral-{bg,text}`, `--color-badge-type-codex-{bg,text}`, and `--color-status-error-bg`/`--color-status-success-{bg,text}` to `frontend/src/styles/global.css`, in both the `:root` (light) and `.dark` blocks.
- **Steps**:
  1. Open `frontend/src/styles/global.css`.
  2. In the `:root` block, confirm: `--role-badge-frontend-{bg,text}: hsl(285 ...)`, `--role-badge-devops-{bg,text}: hsl(305 ...)`, `--role-badge-qa-{bg,text}: hsl(190 ...)`, `--role-badge-backend-{bg,text}: hsl(95 ...)`, `--role-badge-security-{bg,text}: hsl(115 ...)`, plus `--color-status-busy-{bg,text}`, `--color-status-neutral-{bg,text}`, `--color-badge-type-codex-{bg,text}`, `--color-status-error-bg`, `--color-status-success-{bg,text}` are all present with concrete values (not empty/`unset`).
  3. Repeat for the `.dark` block, confirming the same hues at dark-mode lightness (bg ≈18% L, text ≈78% L for the 5 role tokens) and confirming the busy/neutral/codex/error/success tokens have distinct dark-mode values (not simply copy-pasted from light).
- **Expected Result**: All listed custom properties exist in both blocks with the hues fixed at 285/305/190/95/115 for the 5 role tokens — verified present as of this UAT's generation (2026-09-13).
- **Repeatable Unit Test**: Not applicable: CSS custom property values are not exercised by the TypeScript/JS test runner (`tsc`/`vitest`) — there is no compile-time or runtime check that a `--token` exists or holds a given value; this is a static-file check only.
- [x] Pass <!-- 2026-09-13 --> — verified via direct read of `frontend/src/styles/global.css`: all listed custom properties present in both `:root` (lines 45-63) and `.dark` (lines 106-124) blocks. Role-badge hues confirmed exactly 285/305/190/95/115 in both blocks; light values are `hsl(<hue> 65% 94%)` bg / `hsl(<hue> 55% 32%)` text; dark values are `hsl(<hue> 50% 18%)` bg / `hsl(<hue> 55% 78%)` text (matches the ≈18%/≈78% spec exactly). `--color-status-busy/neutral/error/success` and `--color-badge-type-codex` all present in both blocks with distinct (not copy-pasted) light/dark values.

### UAT-EDGE-003: TASK-150-scoped test selection is green; typecheck errors (if any) are confined to unrelated pre-existing test-file breakage, never to AgentList.tsx or global.css
- **Scenario**: TASK-150's own Step 5 verification claim was "72/72 tests + typecheck clean" at the time of `/tackle`. Since then, this repo's live-editing dev environment (per this project's own memory note: concurrent agents edit files mid-session) has left `frontend/src/components/AgentList.test.tsx` with an unrelated, pre-existing structural break in its `AgentDetailModal Skills section (flattened list)` block (a `describe(...)` called from inside another test's `it(...)` callback, around what is currently line ~648 — TASK-153 scope, not TASK-150) that currently fails the whole-file `npm test`/`npm run typecheck` run. This is an environment-drift caveat, not a TASK-150 regression: confirmed during UAT generation that `npm run typecheck`'s reported errors are 100% confined to `AgentList.test.tsx` — none reference `AgentList.tsx` or `global.css`, the only two files TASK-150 changed.
- **Steps**:
  1. From `frontend/`, run the Unit Test Command below (a `-t` filter scoped to every describe block TASK-150 touches or added).
  2. Separately run `npm run typecheck` and confirm any reported errors are all in `src/components/AgentList.test.tsx` (and ideally: check with the project owner / TASK-153's UAT whether that structural break has since been fixed — if it has, `npm test`/`npm run typecheck` should be fully clean again with no filter needed).
- **Expected Result**: The filtered vitest run reports all tests passing (16 passed as of generation: `resolveRoleBadge` ×4, `ROLE_VALUES`/`isValidAgentRole` ×2, `ProjectBadge` ×7, the new TASK-150 Step 4 describe ×5 — note some of these iterate a names/roles loop as a single `it`, so the raw count may differ slightly by vitest version; verify via passing count, not an exact number). `npm run typecheck`'s error list (if non-empty) contains zero lines matching `AgentList.tsx(` or `global.css`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (this is the same filtered command as UAT-UNIT-001/002/003 combined into one sweep; no additional file needed)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx -t "ProjectBadge|resolveRoleBadge|ROLE_VALUES|TASK-150"`
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-001: Light-mode dashboard — role badges render at their new hues and remain legible; no other visible colors regress
- **Page**: `http://localhost:4321/` (`AgentsPage`, the root route — see `frontend/src/App.tsx`'s `<Route path="/" element={<AgentsPage />} />`)
- **Description**: Manual/Playwright visual check deferred from `/tackle` (TASK-150 Step 5's `[DEFERRED-TO-UAT]` item). Confirms the 6 role badges render at their new dedicated hues (frontend 285°, devops 305°, qa 190°/unchanged, backend 95°, security 115°, architect neutral) and remain legible against their pastel backgrounds, and that nothing else visibly changed (status badges, buttons, context meter).
- **Steps**:
  1. Ensure `document.documentElement` has no `dark` class (light mode is the default — confirm via the NavBar toggle button showing 🌙 / `aria-label="Switch to dark mode"`, meaning it is currently light).
  2. Navigate to `http://localhost:4321/`.
  3. Take a full-page screenshot (`mcp__playwright__browser_take_screenshot`) of the agent grid.
  4. Visually confirm: any agent card carrying a `role` badge (frontend/devops/qa/backend/security/architect) shows a distinct pastel background + saturated text pairing per role, with no two of the 5 non-neutral roles reading as the same hue family, and no role badge reading as amber/red/green (the semantic status colors).
  5. Confirm status badges (busy/idle/awaiting/error/etc.), the "Close agent" button, and the context-usage meter still show their pre-existing amber/red/green/blue colors, unchanged from before this task.
- **Expected Result**: All 6 role badges are legible and hue-distinct from each other and from the semantic status colors; status/button/meter colors are visually identical to pre-TASK-150 screenshots.
- **Repeatable Unit Test**: Not applicable: visual legibility/contrast and cross-badge hue distinctness are rendering/perception checks, not deterministic logic — the deterministic half of this claim (that the computed hues fall in the safe bands) is already covered by UAT-UNIT-001/002/003.
- [x] Pass <!-- 2026-09-13 --> — verified live via Playwright against the running dashboard (`localhost:4321`), confirmed light mode (no `dark` class). Full-page screenshot (`tmp/uat150-light-full.png`) and per-card crops (`tmp/uat150-light-tmuxcond2-card.png`, `tmp/uat150-light-waiting-card.png`) show all visible role badges (architect=neutral, frontend=magenta-violet) legible with saturated text on pastel bg. Computed-style extraction confirmed the FRONTEND badge resolves to exactly hue 285° (bg hsl(285 66% 94%), text hsl(285 55% 32%)) — matches the token spec bit-for-bit; devops/qa/backend/security aren't render-reachable with the currently-registered live agents (only architect/frontend/generic roles exist), so their live legibility rests on UAT-UNIT-001's exact-token assertions plus this UAT's own UAT-EDGE-002 static confirmation that all 5 tokens exist correctly. Status/type badges (WAITING/NO TASKS = warn amber #fdf0da/#8a5a06, CLAUDE = #ede9fe/#5b21b6, ARCHITECT = #e4e5e9/#5b5e68) computed exactly equal to their pre-existing `global.css` values — unchanged from before TASK-150, no regression.

### UAT-UI-002: Dark-mode dashboard — same role-badge legibility check, plus dark-mode-specific token values
- **Page**: `http://localhost:4321/`
- **Description**: Repeats UAT-UI-001 in dark mode, since TASK-150 added separate dark-mode hue/lightness values for every new token and the task's own notes flag this as "a genuinely new set of colors, not a re-verification of TASK-140's already-audited set."
- **Steps**:
  1. Navigate to `http://localhost:4321/`.
  2. Click the theme toggle button in `NavBar` (`button[aria-label="Switch to dark mode"]`, shows 🌙) to switch to dark mode; confirm `document.documentElement` gains the `dark` class and the button now reads `aria-label="Switch to light mode"` / ☀️.
  3. Take a full-page screenshot of the agent grid in dark mode.
  4. Repeat the same 6-role-badge legibility/hue-distinctness check as UAT-UI-001 Step 4, against the dark-mode token values (bg ≈18% lightness, text ≈78% lightness per the task's Step 1 spec).
  5. Confirm status/button/meter colors are unchanged from pre-TASK-150 dark-mode screenshots.
- **Expected Result**: Same as UAT-UI-001, evaluated against the dark palette.
- **Repeatable Unit Test**: Not applicable: same reasoning as UAT-UI-001 (visual/perceptual check; the deterministic half is unit-covered).
- [x] Pass <!-- 2026-09-13 --> — verified live via Playwright: clicked the theme toggle (`Switch to dark mode` → `document.documentElement` gained `dark` class, confirmed via evaluate). Full-page dark screenshot (`tmp/uat150-dark-full.png`) shows all badges remain legible against the dark canvas. Computed-style extraction confirmed the FRONTEND badge resolves to exactly hue 285° in dark mode too (bg hsl(285 50% 18%), text hsl(285 55% 78%)) — bit-for-bit match to the dark-mode token spec, and numerically distinct from its light-mode values (not a copy-paste). Status/type/neutral tokens (WAITING/NO TASKS = #3a2c0f/#f0b429, CLAUDE = #2f2748/#c4b5fd, ARCHITECT = #2c2e37/#b7bac4) all computed exactly equal to `global.css`'s `.dark` block. Same live-agent-role coverage caveat as UAT-UI-001 (only architect/frontend/generic roles currently registered) applies, with the same unit+static-CSS backstop for devops/qa/backend/security.

### UAT-UI-003: Hue-collision spot check — the reported screenshot's specific bug (tmux-conductor project badge reading as the same "orange" as the amber status chrome) is fixed
- **Page**: `http://localhost:4321/` → click an agent card whose project resolves to a formerly-colliding hue (e.g. any agent with `projectName: "tmux-conductor"`) to open `AgentDetailModal`
- **Description**: Directly re-creates the originally reported screenshot (cited in TASK-150's Objective): the `tmux-conductor` project badge previously rendered amber, visually indistinguishable from the real semantic amber used by "NO TASKS", "Close agent", and the near-limit context meter. Confirms the fix at the exact location the bug was found.
- **Steps**:
  1. Navigate to `http://localhost:4321/`.
  2. Locate an agent card whose project badge reads "tmux-conductor" (or another project name known to have previously landed in an excluded band — cross-check against UAT-UNIT-002's sample list).
  3. Click the card to open `AgentDetailModal` (per `AgentList.tsx`'s own comment: "clicking the tile opens it").
  4. In the modal header, screenshot the project badge alongside any visible amber chrome — the "NO TASKS" status badge (if the agent has zero queued tasks), the "Close agent" button, or a near-limit context meter (whichever is present).
  5. Visually compare the project badge's hue family against the amber chrome's hue family.
- **Expected Result**: The project badge (now hue 71° per UAT-UNIT-002's pinned assertion for "tmux-conductor" — safely inside the `(56,132]` green/chartreuse band, well clear of the `[331°,360°]∪[0°,56°]` red/rose/amber exclusion band) and the amber status chrome read as two clearly distinct hue families at a glance — not "both orange," as in the originally reported screenshot.
- **Repeatable Unit Test**: Not applicable: this is the perceptual "do these two colors look alike" judgment call the task exists to fix — the underlying numeric guarantee (hue 71° is outside the amber exclusion band) is already unit-covered by UAT-UNIT-002's band-exclusion sweep, but "looks distinct at a glance" itself requires a human/visual judgment.
- [x] Pass <!-- 2026-09-13 --> — directly re-created the reported bug scenario: navigated to `tmux-conductor-2` (project `tmux-conductor`, currently `no tasks`), clicked to open `AgentDetailModal`, and screenshotted the header (`tmp/uat150-dark-modal-header.png`) — the project badge and the amber "NO TASKS" badge sit side-by-side, exactly the collision location from the original report. They read as clearly distinct hue families (olive/chartreuse-green vs. amber/orange), confirmed both visually and numerically: computed project-badge hue = 71° (exact match to UAT-UNIT-002's pinned `tmux-conductor` → 71 assertion, extracted live from the rendered DOM, not just the unit test), vs. computed amber-badge hue ≈ 38-42° (both light and dark mode) — well outside the `(56,132]` safe band that 71° sits in. Also confirmed on the grid card itself (`tmp/uat150-light-tmuxcond2-card.png`) in light mode. No collision in either theme — the originally reported bug is fixed.

---

## Gaps (dropped or narrowed from initial research)

- **`exited`/`no-window`/`unknown` status colors** (`STATUS_CONFIG` in `AgentList.tsx`) are not reachable through `AgentList`'s own render tree — `columnFor()` routes them to `InactiveAgentsPanel.tsx`, a separate component outside TASK-150's stated scope. UAT-EDGE-001 documents this as a scoped-out gap rather than approximating a test against the wrong component.
- **Whole-suite `npm test` / `npm run typecheck`** currently fail for reasons unrelated to TASK-150 — a pre-existing structural break in `AgentList.test.tsx`'s `AgentDetailModal Skills section (flattened list)` block (TASK-153 scope: a `describe(...)` call nested inside another test's `it(...)` callback). UAT-EDGE-003 narrows the verification to a `-t`-filtered sweep of exactly the describe blocks TASK-150 touches/added, plus a check that typecheck's error list never references `AgentList.tsx` or `global.css`. This should be revisited (re-run the unfiltered commands) once TASK-153's own UAT/fix lands.
