---
id: UAT-140
aliases: [UAT-140]
title: "UAT: Audit and fix button/badge contrast ratios in light and dark themes"
status: pending
task: TASK-140
created: 2026-09-13
updated: 2026-09-13
---

# UAT-140 — UAT: Audit and fix button/badge contrast ratios in light and dark themes

implements::[[TASK-140]]

> **Source task**: [[TASK-140]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] `make dev` is running (host-server on :8788, frontend on :4321) with at least one project and one agent registered, so `AgentList` renders real badge/button chrome instead of the empty state
- [ ] Browser dev tools available (Elements panel + computed-style inspector) for spot-checking a rendered element's actual `background-color`/`color` against the token values below when a given state isn't naturally present in the live session
- [ ] Familiarity with the theme toggle: the sun/moon button in `NavBar.tsx`, `aria-label="Switch to dark mode"` (light mode) / `"Switch to light mode"` (dark mode) — flips `.dark` on `<html>` and persists to `localStorage['theme']`

All cases below are visual/UI or code-level edge checks — this task changed only CSS custom properties, Tailwind classes, and inline styles, so there are no API test cases.

---

## Test Cases

### UAT-UI-001: Status, type, and neutral badges in AgentList — dark mode
- **Page**: `/` (AgentsPage → `AgentList`)
- **Description**: Verifies the `STATUS_CONFIG` status pills, `AgentTypeBadge`'s claude variant, the `no-window`/`unknown` neutral pill, `UsageBadge`, and `ContextMeter`'s percentage-chip/threshold colors are all legible against the dark canvas, using the new tokens (`--color-status-idle-bg/-text`, `--color-status-warn-bg/-text`, `--color-status-error-text`, `--color-badge-neutral-bg/-text`, `--color-badge-type-claude-bg/-text`) instead of the old hardcoded hex values.
- **Steps**:
  1. Load `/`, switch to dark mode via the NavBar toggle.
  2. For each agent card present, read the status pill's dot + text (idle / empty ("no tasks") / awaiting ("waiting") / error / stalled / no-window / unknown) and confirm the text is clearly readable against its pill background — no pill should look washed-out or unreadable.
  3. Confirm any `claude`-type `AgentTypeBadge` chip (small pill next to the agent name) renders as a violet-toned, legible chip, not the very-low-contrast fill it had before the fix.
  4. If a `UsageBadge` (cost · tokens) or a `ContextMeter` model-only chip is visible, confirm it reads as a neutral gray pill with legible text (uses `--color-badge-neutral-bg/-text`).
  5. If an agent's context usage is at or above 70% (warn) or 90% (error), confirm the `ContextMeter` percentage text is legible against the card background in that color (amber for 70-89%, red for ≥90%). If no agent is naturally in that range, use dev tools to inspect the computed `color` of a `ContextMeter` percentage span and confirm it resolves to the `--color-status-warn-text` (`#f0b429`) or `--color-status-error-text` (`#ff6b70`) dark-mode value rather than a raw `#c07a10`/`#e5484d`.
- **Expected Result**: Every status/type/neutral badge and context-meter color is clearly legible against its background in dark mode; none render as the old low-contrast (near-invisible-text) hardcoded hex pairs.
- **Repeatable Unit Test**: Not applicable: `STATUS_CONFIG`, `AgentTypeBadge`, and `contextColor` are private (non-exported) symbols in `AgentList.tsx`, and the assertion is rendered-color legibility, which jsdom cannot compute — this is a live-render visual check, not a deterministic value jsdom can verify.
- [ ] Pass

### UAT-UI-002: RoleBadge and inline skill-source badges — dark mode
- **Page**: `/` (AgentsPage → `AgentList`, agent detail modal's Skills tab for the skill-source spans)
- **Description**: Verifies the 6 `ROLE_CONFIG` role pills (frontend/backend/qa/devops/security/architect) and the 3 inline `SkillBadge` spans ("project", "auto-only", "manual") — previously raw light-only Tailwind classes with zero dark-mode awareness — now render as legible dark-tinted chips via their new `dark:bg-{color}-950/40 dark:text-{color}-300` variants.
- **Steps**:
  1. In dark mode, open (or create via "Spawn Agent") an agent with a role set to one of `frontend`, `backend`, `qa`, `devops`, `security`, `architect` and confirm its `RoleBadge` pill (uppercase role name next to the agent name) is a legible dark-tinted chip, not a washed-out light pill.
  2. Repeat for at least 2 more of the 6 roles (role can be edited via the agent's detail modal or by spawning additional agents) to spot-check more than one color.
  3. Open an agent's detail modal and expand its Skills list; if any skill is `source: 'project'`, not `userInvocable`, or `autoOnly`, confirm the corresponding "project" / "auto-only" / "manual" inline badge next to it is legible against the dark modal background.
- **Expected Result**: All 6 role pills and all 3 skill-source badges are legible dark-tinted chips in dark mode (no light/washed-out pills floating on the dark canvas).
- **Repeatable Unit Test**: Not applicable for the 3 skill-source spans — `SkillBadge`/`SkillRow` are not exported and require a live agent+skills fetch to render. For `ROLE_CONFIG`, an existing unit test already pins the exact dark-mode className this task added: `AgentList.test.tsx`'s `resolveRoleBadge` describe block asserts `resolveRoleBadge('qa')` equals `{ role: 'qa', className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300', dot: '#06b6d4' }` — referenced, not duplicated, per the task's own note that this test was updated mid-tackle to match the new className.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t resolveRoleBadge`
- [ ] Pass

### UAT-UI-003: Named-project ProjectBadge pills — dark mode
- **Page**: `/` (AgentsPage → `AgentList`, any agent card with a project assigned)
- **Description**: Verifies `ProjectBadge`'s named-project pill — computed via `projectHue(name)` into an inline `hsl(hue, sat, lightness)` style — now reads its saturation/lightness from theme-aware `--project-badge-{bg,text}-{s,l}` CSS custom properties instead of a hardcoded 94%-lightness background, across at least 2 different project name hues.
- **Steps**:
  1. In dark mode, create or view at least 2 agents assigned to differently-named projects (e.g. one named `cryptwiz`, one named `tmux-conductor`, or any 2 distinct names) via `/projects` or the agent's project assignment.
  2. On `/`, confirm each named-project pill renders as a dark, saturated chip with clearly legible text — not a pale, near-white chip floating on the dark canvas.
  3. Confirm the two pills render in visibly different hues (the hash-derived hue differs per name) while both remain legible.
- **Expected Result**: Every named-project pill is a dark-toned, legible chip in dark mode regardless of the project name's hash-derived hue.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (new `describe('ProjectBadge', ...)` block) — pins the unassigned pill's neutral-badge token classes and asserts the named-project pill's inline `style.background`/`style.color` now literally reads `hsl(<hue> var(--project-badge-bg-s) var(--project-badge-bg-l))` / `hsl(<hue> var(--project-badge-text-s) var(--project-badge-text-l))` for two representative names (`cryptwiz` → hue 218, `tmux-conductor` → hue 14, computed from the same char-code hash `projectHue` uses), locking in the token-based fix so a future edit can't silently reintroduce a hardcoded, theme-invariant lightness value. Verified green via the command below before this UAT file was written.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t ProjectBadge`
- [ ] Pass

### UAT-UI-004: SessionBanner warning text and LogTail terminal chrome — dark mode
- **Page**: `/` (AgentsPage, `SessionBanner` — only visible when the tmux session is offline) and an agent's expanded log/terminal view (`LogTail.tsx`)
- **Description**: Verifies `SessionBanner`'s warning text (`--color-banner-warn-text`) and `LogTail`'s amber terminal-header/interact-overlay/button chrome (`--color-accent-amber-on-solid`) are legible in dark mode, replacing the old flat `#e0901a`-on-white-text combination that measured 2.57:1 in both themes.
- **Steps**:
  1. In dark mode, trigger the offline-session banner (stop the host-server or wait for a monitor restart window) and confirm the "Session offline — showing last known state" / "Monitor offline — restarting…" text is clearly legible against the amber-tinted banner background.
  2. Open an agent's expanded terminal view and enable Direct Input / Interact mode; confirm the "Direct Input — keys go to `<agent>`" header strip (solid amber fill, white text) is legible.
  3. Press Escape once while interacting to trigger the "Press esc again to close the modal" overlay; confirm its white text is legible against the solid amber overlay background.
  4. Confirm the Interact toggle button itself (amber solid fill when active) reads clearly with white text.
- **Expected Result**: All four amber-chrome surfaces (banner text, terminal header, esc overlay, interact button) are clearly legible in dark mode, not the old washed-out ~2.57:1 pairing.
- **Repeatable Unit Test**: Not applicable: `SessionBanner` and `LogTail` are not exported and require a live SSE/fetch/xterm harness to render meaningfully; the assertion is rendered-color legibility, which jsdom cannot compute.
- [ ] Pass

### UAT-UI-005: Solid-fill accent buttons (blue/green/red) — dark mode
- **Page**: Various — `ConfirmDialog` (delete confirmations), `ProjectList` ("Spawn agent" row action), `AgentList` (approve/reject/reconnect actions), `InactiveAgentsPanel` (restart action), `LogTail` (send/interact button)
- **Description**: Verifies the 9+ solid-fill white-text buttons that consume `bg-accent-blue-solid` / `bg-accent-green-solid` / `bg-accent-red-solid` now render with the darker, higher-contrast dark-mode fill (`--color-accent-{blue,green,red}-solid-bg` `.dark` overrides) instead of the plain `--color-accent-*` value, which this task found was too light for white text at ≥4.5:1 in dark mode.
- **Steps**:
  1. In dark mode, trigger a delete confirmation dialog (`ConfirmDialog`) and confirm its red "Delete"-style button has clearly legible white text against a rich, dark-enough red fill (not a lighter red that washes out white text).
  2. On `/projects`, trigger a blue solid action button (e.g. "Spawn agent" on a project row) and confirm the same — clearly legible white text on a rich blue fill.
  3. On `/`, trigger a green solid action button (e.g. an approve/confirm action in an agent card) and confirm legible white text on a rich green fill.
  4. Confirm none of these solid buttons appear as a pale/washed pastel fill with low-contrast white text.
- **Expected Result**: All solid-fill accent buttons (blue/green/red) show clearly legible white text in dark mode.
- **Repeatable Unit Test**: Not applicable: the fix is a static Tailwind className swap (`bg-accent-blue` → `bg-accent-blue-solid`, etc.) already confirmed against source in this UAT's research — there is no logic branch to assert on, and the remaining question (rendered contrast) is a live-render visual check jsdom cannot answer.
- [ ] Pass

### UAT-UI-006: Primary action buttons ("Spawn Agent", "Add task", etc.) — dark mode
- **Page**: `/` ("Spawn Agent" in `AddAgentForm`, "Add project" in `AddAgentForm`'s inline project sub-form), `/` agent detail modal ("Create schedule" in `ScheduleForm`, "Add task" in `AddTaskForm`), `/projects` ("Create Project" in `AddProjectForm`), background-process spawn form ("Spawn Process" in `AddBgProcessForm`), folder picker ("Select this folder" in `FolderPickerModal`)
- **Description**: Verifies the real bug the user found via screenshot — 7 "primary action" buttons were using `bg-ink` (a *text*-color token that flips to near-white in dark mode) as a button *background*, rendering white text on a near-white background (~1:1 contrast). Confirms all 7 now use the dedicated `bg-button-primary`/`text-button-primary-text` tokens (dark: `#3d4150` bg / white text, ≥10:1) and are clearly visible buttons in dark mode.
- **Steps**:
  1. In dark mode on `/`, confirm the "Spawn Agent" button (bottom of the add-agent form) is a clearly visible dark-gray button with legible white text — not an invisible near-white-on-near-white shape.
  2. In the same form's inline "+ Add project" sub-section, confirm the "Add project" button is equally visible.
  3. Open an agent's detail modal, go to the Tasks tab, confirm "Add task" is visible.
  4. In the same modal's Schedule tab, confirm "Create schedule" is visible.
  5. On `/projects`, open "+ Add project" and confirm "Create Project" is visible.
  6. Trigger the background-process spawn form and confirm "Spawn Process" is visible.
  7. Open the folder picker (used by the add-agent/add-project workdir field) and confirm "Select this folder" is visible.
- **Expected Result**: All 7 primary-action buttons render as clearly visible dark-gray buttons with legible white text in dark mode — none are invisible or near-invisible against the surrounding dark background.
- **Repeatable Unit Test**: Not applicable: each is a static Tailwind className swap (`bg-ink text-white` → `bg-button-primary text-button-primary-text`) already confirmed against source (`AddAgentForm.tsx:309,444`, `ScheduleForm.tsx:113`, `AddTaskForm.tsx:179`, `AddProjectForm.tsx:157`, `AddBgProcessForm.tsx:186`, `FolderPickerModal.tsx:158`) in this UAT's research; the remaining question is rendered-contrast legibility, a live-render visual check.
- [ ] Pass

### UAT-EDGE-001: Regression guard — plain text-accent-blue/-green/-red usages still legible in dark mode
- **Scenario**: Mid-tackle, this task discovered and fixed a real regression: an earlier draft of the `.dark` block reassigned the *base* `--color-accent-blue`/`-green`/`-red` custom properties (intended only to darken the 3 solid-button-fill call sites) which silently broke every pre-existing `text-accent-*`/`border-accent-*` consumer elsewhere in the app, dropping them to ~2.86-3.34:1 in dark mode. The fix separated "text accent" tokens (restored to the original bright dark-mode values, e.g. `#6c93ff`/`#3ddc91`/`#ff6b70`) from "solid button fill" tokens (the new `-solid-bg` tokens). This case re-checks that separation holds.
- **Steps**:
  1. In dark mode, trigger a form validation/error message that uses `text-accent-red` (e.g. leave a required field blank in `AddAgentForm`, `AddProjectForm`, `AddTaskForm`, or `ScheduleForm` and submit to surface its inline error `<p>`).
  2. Confirm the red error text is clearly legible against the dark form background (not a dim/desaturated red).
  3. Trigger a `text-accent-green` success message (e.g. successfully spawn an agent via `AddAgentForm` — "Agent spawned ✓") and confirm it is clearly legible.
  4. In an agent's detail modal, open the Skills list and confirm the `/{skill.name}` command labels (`text-accent-blue`, `AgentList.tsx:502`) are clearly legible, not dim.
  5. As a direct code-level cross-check (no browser needed): open dev tools on any dark-mode page, inspect the computed `color` of a `text-accent-blue` element, and confirm it resolves to `#6c93ff` (not a darker `#2f5fe0`-family "-solid-bg" value, which would indicate the regression has recurred).
- **Expected Result**: Every plain `text-accent-blue`/`-green`/`-red` usage remains clearly legible in dark mode, resolving to the original bright dark-mode accent values, never the darker `-solid-bg` values reserved for solid button fills.
- **Repeatable Unit Test**: Not applicable: this is a CSS custom-property resolution regression, observable only in a live rendered/computed-style context (jsdom does not resolve `var()` cascade values) — the safeguard is this UAT case itself plus the `global.css` structure documented in Step 5 of TASK-140.
- [ ] Pass

### UAT-UI-007: Light-mode regression sweep
- **Page**: `/`, `/projects`, agent detail modal, `LogTail` expanded terminal
- **Description**: This task touched a large number of shared CSS custom properties and Tailwind classes; this case confirms none of that shuffling introduced a light-mode regression to anything that looked correct before.
- **Steps**:
  1. Toggle back to light mode via the NavBar toggle.
  2. Revisit each surface checked in UAT-UI-001 through UAT-UI-006 (status/type/neutral badges, role pills, skill-source badges, named-project pills, SessionBanner/LogTail amber chrome, solid accent buttons, the 7 primary-action buttons) and confirm every one still renders exactly as it did before this task — normal light-theme colors, no washed-out, inverted, or mismatched pairs.
  3. Pay particular attention to the 3 solid accent buttons and the primary-action buttons, since both moved to newly-introduced tokens (`-solid-bg`, `button-primary`) whose light values were defined to exactly match the pre-existing light-mode appearance.
- **Expected Result**: Light mode is visually unchanged from before this task across every surface it touched.
- **Repeatable Unit Test**: Not applicable: this is a pure visual non-regression check across already-covered UI surfaces; no new deterministic logic exists to unit test beyond what UAT-UI-003 already pins (`ProjectBadge`'s light-mode HSL values, `65%`/`94%`/`55%`/`32%`, are unchanged per the task's own note and remain covered by that same unit test's light-mode-shaped assertions — no separate test needed).
- [ ] Pass

---

## Gaps

- None of the planned cases were dropped for insufficient research — every claim in TASK-140's steps was verified directly against current source (`global.css`, `tailwind.config.js`, `AgentList.tsx`, `LogTail.tsx`, and the 6 form components) before being written into a test case above.
- `STATUS_CONFIG.exited`'s red text color remains the raw `#e5484d` hex (task file explicitly left it unchanged, "out of this checkbox's named scope") — not covered by any case above since it was never fixed by this task; flagging only for visibility, not as a defect of this UAT.
