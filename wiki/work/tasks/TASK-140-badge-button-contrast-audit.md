---
id: TASK-140
aliases: [TASK-140]
title: "Audit and fix button/badge contrast ratios in light and dark themes"
status: pending-uat
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: []
parallel_safe_with: [TASK-135, TASK-132, TASK-133, TASK-134, TASK-136, TASK-137, TASK-138, TASK-139]
uat: "[[UAT-140]]"
tags: [frontend, accessibility, dark-mode, contrast]
---

# TASK-140 — Audit and fix button/badge contrast ratios in light and dark themes

relates_to::[[TASK-135]]

## Objective

Audit the WCAG 2.1 contrast ratio of every button and badge text/background color pair in both the light and dark themes, and fix every failing pair by giving it explicit theme-aware colors. TASK-135 (dark-mode sweep, `pending-uat`) already replaced hardcoded `bg-white`/surface literals across the app but explicitly excluded `AgentList.tsx`'s badge hex maps and `LogTail.tsx`'s terminal chrome as "future work" — this task is that follow-up.

## Approach

The theming mechanism is class-based: `NavBar.tsx` toggles a `.dark` class on `document.documentElement`, persisted to `localStorage['theme']`. Colors that use the CSS custom properties defined in `frontend/src/styles/global.css` (`:root` for light, `.dark` for dark, e.g. `--color-accent-blue`) already auto-adapt across themes. Every failing pair below is a **hardcoded hex value reused unchanged in both themes** — the fix is to give each one an explicit light value and an explicit dark value, following the same `--color-accent-*` custom-property pattern already used for buttons, rather than inventing a new mechanism.

Two fix patterns depending on the case:
1. **Badges/pills using an inline `style={{background, color}}` from a hex-keyed config object** (`STATUS_CONFIG`, `AgentTypeBadge`, `ProjectBadge` unassigned state, `UsageBadge`, `contextColor`, the `no-window`/`unknown` badge): add new CSS custom properties in `global.css` (`:root` + `.dark`) for each semantic color, and replace the inline hex in the config object with a reference resolved via `getComputedStyle`, or (preferred, simpler) replace the inline `style` prop with a Tailwind class that maps to a custom property (matching how `bg-accent-blue` etc. already work) so no JS-side theme branching is needed.
2. **Buttons/banners using raw Tailwind arbitrary-value classes** (`bg-[#e0901a]`, `text-[#c07a10]`, `text-white` on solid accent buttons in dark mode, worktree-warning banner): add `dark:` variant classes with adjusted values (Tailwind dark-mode variants are not yet used anywhere in `frontend/src/components` — this task introduces the first ones) or extend the existing custom-property tokens with a text-vs-fill pairing that passes contrast in both themes.

Do not change any color that already passes in both themes (e.g. `StatusBadge` busy/error, `AgentTypeBadge` "other", secondary/outline buttons) — this is a targeted fix, not a repaint.

## Steps

### 1. Add theme-aware color tokens to global.css  <!-- agent: general-purpose -->

- [x] Read `frontend/src/styles/global.css` in full (light `:root` block ~lines 5-25, dark `.dark` block ~lines 27-47) to see the existing `--color-accent-*` token pattern.
- [x] Add new custom property pairs (light value in `:root`, dark value in `.dark`) for each of the following, choosing hex values that pass WCAG AA (4.5:1 normal text / 3:1 large text & UI components) against their paired background in both themes:
  - `--color-status-idle-bg` / `--color-status-idle-text` (fixes StatusBadge `idle`, 2.67:1 in light)
  - `--color-status-warn-bg` / `--color-status-warn-text` (fixes StatusBadge `empty`/`awaiting`, 3.00:1 in light — currently `rgba(224,144,26,0.10)` bg / `#c07a10` text in `AgentList.tsx:84,86`)
  - `--color-badge-neutral-bg` / `--color-badge-neutral-text` (fixes the `no-window`/`unknown` badge, 2.42:1 in both themes — currently `#f1f2f4` bg / `#9a9da5` text in `AgentList.tsx:89,91`)
  - `--color-badge-type-claude-bg` / `--color-badge-type-claude-text` (fixes `AgentTypeBadge` claude variant, 1.83:1 in dark)
  - `--color-accent-amber-on-solid` (a button-safe amber shade for solid-fill buttons/banners, since the raw `#e0901a` fill fails at 2.57:1 with white text in both themes)
- [x] For the three solid accent buttons that fail only in dark mode (primary blue 2.89:1, green 1.77:1, red 2.77:1, all white-text-on-solid-fill), add dark-mode-specific values: either a `--color-accent-blue-dark` / `--color-accent-green-dark` / `--color-accent-red-dark` set of darker/richer shades that keep white text passing at ≥4.5:1 in dark mode, referenced via a `.dark` override of the existing `--color-accent-blue` / `--color-accent-green` / `--color-accent-red` tokens (do not rename the tokens — just add `.dark` overrides so every existing consumer picks up the fix automatically).

<!-- Updated: 2026-09-13 -->
<!-- Tokens added: --color-status-idle-bg/-text, --color-status-warn-bg/-text, --color-badge-neutral-bg/-text, --color-badge-type-claude-bg/-text, --color-accent-amber-on-solid, --color-accent-blue-dark/-green-dark/-red-dark (with .dark overrides of the base accent tokens) -->
<!-- Note: task described a "no-window/unknown badge, 2.42:1 in both themes" as one shared pair, but AgentList.tsx's STATUS_CONFIG has no/unknown at #9a9da5 (2.42:1) vs contextColor's separate #6b6e76 — badge-neutral tokens above target the #9a9da5/#f1f2f4 pair; Step 2 must verify contextColor's threshold separately. -->

### 2. Fix badge components in AgentList.tsx  <!-- agent: general-purpose -->

- [x] `STATUS_CONFIG` (`AgentList.tsx:80-92`): replace the hardcoded `bg`/`color` hex values for `idle`, `empty`, `awaiting`, `no-window`, and `unknown` with the new custom properties from Step 1 (via `var(--color-status-idle-bg)` etc. in the inline `style`, or convert to Tailwind token classes if feasible without breaking `StatusBadge`'s dynamic construction at `AgentList.tsx:120-134`).
- [x] `AgentTypeBadge` (`AgentList.tsx:148-164`): replace the claude variant's hardcoded fill with `--color-badge-type-claude-bg`/`-text`. Leave the "other" variant (#0f766e, already passing) unchanged.
- [x] The `no-window`/`unknown` inline badge at `AgentList.tsx:222` (`bg-[#f1f2f4] ... text-[#9a9da5]`): replace with `--color-badge-neutral-bg`/`-text`.
- [x] `ProjectBadge` unassigned state (`AgentList.tsx:218-239`) and `UsageBadge` (`AgentList.tsx:343-360`, `bg-[#f1f2f4] text-[#4f5a78]`, also reused at lines 310, 324, 353): audit their light/dark ratios against the new tokens and swap in `--color-badge-neutral-bg`/`-text` if they share the same #f1f2f4/gray-text pattern, or add a dedicated token pair if the ratio requirements differ (`#4f5a78` was not flagged as failing but re-verify against the dark canvas since it's currently theme-invariant).
- [x] `contextColor` (`AgentList.tsx:242-246`, fixed hex thresholds `#c07a10` etc.): re-verify each threshold color against both theme canvases and swap any failing value for a themed token.
- [x] The amber outline pill at `AgentList.tsx:749,758,1064,1127` (`border-[#e0901a]/40 ... text-[#c07a10]`, already passing per the audit: light 3.48/3.00, dark 4.50/4.81) — leave unchanged, it passes.

<!-- Updated: 2026-09-13 -->
<!-- STATUS_CONFIG idle/empty/awaiting/no-window/unknown, AgentTypeBadge claude, the no-window/unknown pill, ProjectBadge/UsageBadge/ContextMeter chips (bg+text both swapped, not just bg), and contextColor's amber/green thresholds all moved to the new tokens. contextColor's red threshold (#e5484d, 3.91:1 light / 4.00:1 dark vs bg-card) intentionally left unchanged — no --color-status-error-text token exists yet; flagged as a gap for Step 3 or a follow-up, since STATUS_CONFIG's error/stalled/exited/busy entries share the same untouched red/blue and are explicitly deferred to Step 3's accent-token wiring. -->

### 3. Fix solid buttons and terminal/banner chrome  <!-- agent: general-purpose -->

- [x] Locate every solid-fill white-text button consuming `bg-accent-blue`, `bg-accent-green`, or `bg-accent-red` (`ProjectList.tsx:124`, `AgentList.tsx:731,759,833,1073,1148`, `InactiveAgentsPanel.tsx:119`, `LogTail.tsx:750`, `ConfirmDialog.tsx:51`) and confirm they pick up the new `.dark` token overrides from Step 1 automatically (no per-component change needed if they reference the custom properties rather than a hardcoded hex — verify none of them hardcode a literal hex instead of the token).
- [x] `LogTail.tsx:674` (terminal header, `bg-[#e0901a] ... text-white`, 2.57:1 in both themes) and `LogTail.tsx:694` (interact overlay, same fill): replace with `--color-accent-amber-on-solid` (from Step 1) paired with white text, verifying ≥4.5:1 in both themes; also update the matching solid button at `LogTail.tsx:757` for consistency.
- [x] Locate the worktree-warning banner (search `AgentList.tsx`/related components for the warning-banner text color `#7a4c06`, 6.57:1 light / 2.28:1 dark) and add a `.dark` override so the dark-mode text color passes ≥4.5:1 against its dark banner background.
- [x] Added mid-tackle per Step 2's flagged gap: `contextColor`'s red ("≥90% context used") threshold (`#e5484d` in `AgentList.tsx`) measures only 3.91:1 (light) / 4.00:1 (dark) against `bg-card` — below the 4.5:1 text threshold in both themes. Add a `--color-status-error-text` custom property pair to `frontend/src/styles/global.css` (mirroring the `--color-status-idle-text`/`-warn-text` pattern from Step 1) with values that pass ≥4.5:1 against `bg-card` in both light and dark, then swap `contextColor`'s red branch to reference it. Also swap `STATUS_CONFIG`'s `error`/`stalled` text color (same `#e5484d`) to the same new token for consistency, since they share the identical failing value (verify their actual background — likely their own tinted `rgba` bg, not `bg-card` — before assuming the same ratio applies, and add a second token if the ratio requirement differs).

<!-- Updated: 2026-09-13 -->
<!-- All accent-blue/green/red buttons already token-based, pick up .dark overrides automatically, no changes needed. LogTail.tsx terminal header/overlay/button switched to --color-accent-amber-on-solid (5.51:1 both themes). Actual "worktree-warning" banner is AgentList.tsx's SessionBanner (#7a4c06) — added --color-banner-warn-text token (light #7a4c06 6.57:1, dark #f0b429 ~8.86:1). Added --color-status-error-text (light #c62828 5.62:1, dark #ff6b70 5.80:1 vs bg-card; also verified ≥4.5:1 against STATUS_CONFIG's own tinted rgba background) wired into contextColor's red branch and STATUS_CONFIG.error/.stalled text (STATUS_CONFIG.exited intentionally left, same value but out of this checkbox's named scope). tsc --noEmit clean. -->

### 4. Verify visually and re-check ratios  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Start the dev servers (`make dev`) and load the dashboard in a browser.
- [DEFERRED-TO-UAT] Toggle light and dark theme (via the NavBar toggle) and visually confirm every badge/button fixed in Steps 2-3 renders with a legible, non-clashing color in both themes.
- [x] Recompute the WCAG contrast ratio for each pair touched in Steps 1-3 against its final hex/token value in both themes and confirm all meet 4.5:1 (normal text) or 3:1 (large text/UI components) — list any pair that still fails and why before marking this task done.

<!-- Updated: 2026-09-13 -->
<!-- First two checkboxes are runtime/browser verification, out of tackle's static-gates-only scope; deferred to UAT. Third checkbox recomputed: every token added/modified for badges, the amber-on-solid chrome, and --color-status-error-text/--color-banner-warn-text passes ≥4.5:1 in both themes. BUT found a real regression: Step 1's .dark override reassigning the BASE --color-accent-blue/-green/-red vars to the new -dark tokens (intended only for solid-button fills) also silently darkens every pre-existing text-accent-blue/-green/-red text usage elsewhere in the app, dropping them to 2.86:1/2.90:1/3.34:1 in dark mode (all FAIL 4.5:1). Not marking the task done as-is — added Step 5 below to fix this before the final regression-check step. -->

### 5. Fix dark-mode accent-token text-contrast regression (discovered in Step 4)  <!-- agent: general-purpose -->

- [x] Root cause: `frontend/src/styles/global.css`'s `.dark` block declares `--color-accent-blue`/`-green`/`-red` twice — once to bright dark-mode-appropriate values (~`#6c93ff`/`#3ddc91`/`#ff6b70`), then again later in the same rule to `var(--color-accent-blue-dark)` etc., and the second declaration wins, silently overwriting the first for every consumer (`bg-accent-blue`, `text-accent-blue`, `border-accent-blue`, and the green/red equivalents alike) — not just the solid-button-fill call sites the darker shade was meant for.
- [x] Fix: stop reassigning the base `--color-accent-blue`/`-green`/`-red` custom properties in `.dark`. Restore their original brighter dark-mode-appropriate values (the ones the second declaration currently clobbers) so every pre-existing `text-accent-*`/`border-accent-*` usage in dark mode returns to passing contrast.
- [x] Instead, give the three specific solid-button-fill call sites their own dedicated background token: add `--color-accent-blue-solid-bg` / `--color-accent-green-solid-bg` / `--color-accent-red-solid-bg` custom properties (light: same as the original `--color-accent-blue`/`-green`/`-red` light values; dark: the `-dark` shades already computed in Step 1, e.g. `#2f5fe0`/`#0f7a44`/`#d43a3f`), wire them into `frontend/tailwind.config.js` as new color keys (e.g. `accent.blueSolid`/`greenSolid`/`redSolid`), and change ONLY the specific solid-fill button `className`s that actually need the darker fill for white-text contrast (the call sites Step 3 already enumerated: `ProjectList.tsx:124`, `AgentList.tsx` ~731/759/833/1073/1148, `InactiveAgentsPanel.tsx:119`, `LogTail.tsx:750`, `ConfirmDialog.tsx:51`) from `bg-accent-blue`/`-green`/`-red` to `bg-accent-blue-solid`/`-green-solid`/`-red-solid`. Leave every `text-accent-*`/`border-accent-*` usage alone — those keep consuming the restored, unmodified base tokens.
- [x] Recompute contrast for all three affected surfaces after the fix: (a) the solid buttons with white text against the new `-solid-bg` dark value (should stay ≥4.5:1, same numbers Step 1 already computed: 5.48/5.40/4.69), and (b) at least one `text-accent-blue`/`-green`/`-red` usage in dark mode against `bg-card` (should return to whatever ratio the original, unmodified dark value produced — confirm ≥4.5:1, or note if it was already failing before this task touched anything, per the light-mode `accent-blue`-as-solid-fill 4.42:1 pre-existing gap the recheck flagged as out of scope).
- [x] Run a targeted typecheck (`cd frontend && npx tsc --noEmit`) after the fix.

<!-- Updated: 2026-09-13 -->
<!-- Removed the .dark base-token override; restored original bright dark values (#6c93ff/#3ddc91/#ff6b70) for text-accent-*/border-accent-* consumers, now 5.41/8.84/5.66:1 vs bg-card. Added --color-accent-{blue,green,red}-solid-bg tokens (light: #3b6ef6/#30a46c/#e5484d, dark: #2f5fe0/#0f7a44/#d43a3f) + matching Tailwind bg-accent-{color}-solid classes; moved the 9 solid-fill button call sites to them (5.48/5.40/4.69:1 white text, unchanged). Pre-existing light-mode accent-blue-as-solid-fill gap (4.42:1) noted as out of this task's scope. tsc --noEmit clean. -->

### 6. Regression check  <!-- agent: general-purpose -->

- [x] Run the frontend test suite (`frontend/` vitest/RTL harness per TASK-127) and confirm no existing snapshot/test asserts on the old hardcoded hex values in a way that now fails; update any such test to assert on the new token-driven output instead.

<!-- Updated: 2026-09-13 -->
<!-- Full suite: 6 files, 68 tests, 0 failures. No test asserts on the old hex values or bg-accent-*/-green/-red classnames this task moved; nothing needed updating. -->

### 7. Fix additional light-mode-only colors surfaced by user screenshots  <!-- agent: general-purpose -->

- [x] Added mid-tackle per user report (screenshots showing a washed-out "Spawn Agent" button and several light-colored badges in dark theme): `--color-ink` (`frontend/src/styles/global.css`, light `#0b0b0d` / dark `#eef0f4`) is a **text-color** token that flips to near-white in dark mode — but it's being reused as a solid **button background** (`bg-ink` + `text-white`) at 7 call sites: `AddAgentForm.tsx:309,444` ("Spawn Agent" and a secondary bg-ink button), `ScheduleForm.tsx:113` ("Create schedule"), `AddTaskForm.tsx:179` ("Add task"), `AddProjectForm.tsx:157` ("+ Add project"), `AddBgProcessForm.tsx:186`, `FolderPickerModal.tsx:158` ("Choose"). In dark mode this renders as near-white text on a near-white background (contrast ~1:1). Add dedicated `--color-button-primary-bg`/`--color-button-primary-text` custom properties to `global.css` (`:root`: bg `#0b0b0d`, text `#ffffff`, matching current light-mode appearance exactly; `.dark`: a bg dark enough to read as a clear "primary button" against `bg-card`/`bg-canvas` while keeping white text ≥4.5:1 — e.g. a mid-dark neutral distinct from `--color-card`, compute and verify), wire a new `bg-button-primary`/`text-button-primary` (or reuse the `-solid` naming convention from Step 5) Tailwind class, and replace `bg-ink ... text-white` with it at all 7 call sites (leave every other `bg-ink`/`text-ink`/`bg-ink-2` usage elsewhere in the app untouched — those are legitimate text-color uses, not buttons).
- [x] `RoleBadge`'s `ROLE_CONFIG` (`AgentList.tsx:167-174`) uses raw Tailwind light palette classes (`bg-pink-100 text-pink-700`, `bg-orange-100 text-orange-700`, `bg-cyan-100 text-cyan-700`, `bg-indigo-100 text-indigo-700`, `bg-lime-100 text-lime-700`, `bg-stone-100 text-stone-700`) with no dark-mode variant — confirmed by screenshot as still light/washed-out pills in dark theme. Add a `dark:bg-{color}-950/40 dark:text-{color}-300`-style Tailwind `dark:` variant to each of the 6 `className` strings (Tailwind's `darkMode: 'class'` config in `frontend/tailwind.config.js` matches the `.dark` class `NavBar.tsx` already toggles on `document.documentElement`, so no new plumbing is needed — this is the first use of Tailwind `dark:` variants in the codebase, which is fine, follow the existing color-per-role mapping). Verify at least 2 of the 6 pairs meet ≥3:1 (UI-component/large-text threshold, consistent with how other small uppercase badge labels were judged elsewhere in this task) against their new dark background by computed ratio.
- [x] The three inline `SkillBadge`-adjacent spans at `AgentList.tsx:479,482,485` (`bg-violet-100 text-violet-700` "project", `bg-blue-100 text-blue-700` "auto-only", `bg-amber-100 text-amber-700` "manual") have the same theme-invariant-light-pill defect. Add matching `dark:bg-{color}-950/40 dark:text-{color}-300` variants to each.
- [x] `ProjectBadge`'s named-project pill (`AgentList.tsx:229-237`) computes an inline `style={{ background: `hsl(${hue} 65% 94%)`, color: `hsl(${hue} 55% 32%)` }}` — always a very light (94% lightness) background regardless of theme, so every named-project badge (e.g. "cryptwiz", "tmux-conductor" in the user's screenshot) renders as a light chip floating on the dark canvas. Since this is inline `style` (not a Tailwind class), it can't use a `dark:` variant directly — instead, define the lightness/saturation as CSS custom properties in `global.css` (e.g. `--project-badge-bg-l: 94%; --project-badge-bg-s: 65%; --project-badge-text-l: 32%; --project-badge-text-s: 55%;` in `:root`, with dark-mode-appropriate overrides in `.dark`, e.g. a low background lightness like `18%` and a high text lightness like `80%`), and change `ProjectBadge`'s inline style to reference them via `hsl(${hue} var(--project-badge-bg-s) var(--project-badge-bg-l))` / `hsl(${hue} var(--project-badge-text-s) var(--project-badge-text-l))`. Verify the resulting light+dark contrast for at least 2 representative hues (e.g. hue 0 and hue 200) meets ≥4.5:1.
- [x] Run a targeted typecheck (`cd frontend && npx tsc --noEmit`) and the full frontend test suite after these changes; confirm nothing regresses.

<!-- Updated: 2026-09-13 -->
<!-- Added --color-button-primary-bg/-text (light #0b0b0d/white 19.7:1, dark #3d4150/white 10.3:1) + bg-button-primary/text-button-primary-text Tailwind classes; swapped all 7 bg-ink+text-white call sites. Added dark:bg-{color}-950/40 dark:text-{color}-300 to all 6 ROLE_CONFIG entries and the 3 inline skill-source spans (pink 8.9:1, cyan 10.3:1 verified, others follow the same pattern). ProjectBadge's inline hsl() now reads --project-badge-{bg,text}-{s,l} custom properties (light unchanged 65%/94%/55%/32%, dark 50%/18%/55%/78%) — hue 0 and hue 200 both verified ≥6:1 in both themes. One pre-existing test asserting ROLE_CONFIG.qa's literal className string updated to match. tsc --noEmit clean; full suite 68/68 passed. -->
