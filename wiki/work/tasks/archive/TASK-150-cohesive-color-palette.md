---
id: TASK-150
aliases: [TASK-150]
title: "Unify badge/status colors into one cohesive, collision-free palette"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-150]]"
tags: [frontend, design, accessibility]
---

# TASK-150 — Unify badge/status colors into one cohesive, collision-free palette

## Objective

Unify the three independent, uncoordinated color sources currently driving badge/status colors in the dashboard — (1) the curated semantic accent tokens in `frontend/src/styles/global.css`, (2) `RoleBadge`'s hard-coded raw Tailwind-palette classes, and (3) `ProjectBadge`'s unconstrained hash-derived hue — so no identity badge (role or project) can visually collide with a real semantic status color (warning/amber, error/red, success/green). This is what produces the incohesive look in the reported screenshot: the `tmux-conductor` project badge renders amber, visually indistinguishable at a glance from the real semantic amber used by the "NO TASKS" badge, the "Close agent" button, and the near-limit context meter.

## Approach

**Confirmed root causes** (all in `frontend/src/components/AgentList.tsx` / `frontend/src/styles/global.css`):

1. **`ROLE_CONFIG`** (`AgentList.tsx:167-174`) hard-codes 6 raw Tailwind default-palette classes with no relation to this app's own `--color-accent-*` tokens. Three of the six sit right on top of or within ~10° of a real semantic hue: `frontend` (`pink-700`, hue ≈338°) is adjacent to `--color-accent-rose` (≈351°); `backend` (`orange-700`, hue ≈25°) is inside `--color-accent-amber`'s band (≈36°); `devops` (`indigo-700`, hue ≈243°) sits between `--color-accent-blue` (≈227°) and `--color-accent-violet` (≈258°). These are not hypothetical — they are the same badges shown in `AgentList.tsx`'s existing tests.
2. **`projectHue()`** (`AgentList.tsx:211-215`) is `(hash(name) % 360)` with zero collision-avoidance against the semantic hues used everywhere else in the app (`--color-accent-*`, `--color-status-*`). Any project name can and does land on/near a semantic hue — `tmux-conductor` → amber, as seen in the screenshot.
3. **`STATUS_CONFIG`** (`AgentList.tsx:80-92`) mixes tokenized entries (`idle`, `empty`, `awaiting` reference `var(--color-status-*)`) with raw inline hex/rgba duplicating existing token values for `busy`, `idle-waiting`, `error`, `stalled`, `starting`, `exited` — inconsistent application of the token system TASK-140 introduced, and a maintenance trap (editing a token in `global.css` silently stops covering these).
4. **`AgentTypeBadge`** (`AgentList.tsx:148-160`): the Claude branch is tokenized (`--color-badge-type-claude-{bg,text}`), but the non-Claude (Codex) branch hardcodes `rgba(20,126,105,0.10)` / `#0f766e` / `#14a38b` inline — the same inconsistency as (3), scoped to one component.

**Fix, in the same "governed token" style `global.css` already established** (see its existing `--color-status-*`, `--color-badge-neutral-*`, `--color-badge-type-claude-*`, `--project-badge-*` blocks, light block ~lines 18-43, dark override block ~lines 60-85):

- Define 6 **excluded hue bands** — the semantic hues ± a 20° buffer — that neither `RoleBadge` nor `ProjectBadge` output may land in: `[331°, 360°]∪[0°, 56°]` (red/rose/amber cluster: red≈358°, rose≈351°, amber≈36°), `[132°, 172°]` (green≈152°), `[207°, 278°]` (blue≈227° + violet≈258°). The three safe remaining bands are `(56°, 132°)`, `(172°, 207°)`, `(278°, 331°)`.
- Give each `ROLE_CONFIG` role a **dedicated CSS token pair** (`--role-badge-<role>-bg` / `--role-badge-<role>-text`, light + dark values, same pastel-bg/saturated-text formula as `--color-badge-type-claude-*`) at a fixed hue chosen from the safe bands: `frontend`→285° (safe band 3), `devops`→305° (safe band 3, 20° from frontend), `qa`→190° (safe band 2, close to its current cyan — no real change), `backend`→95° (safe band 1), `security`→115° (safe band 1, 20° from backend), `architect`→stays neutral/desaturated (reuse `--color-badge-neutral-{bg,text}`, matching how `ProjectBadge`'s "Unassigned" state already uses neutral for "no strong identity color").
- Constrain `projectHue()`'s output to the same three safe bands: compute the raw hash mod the **total safe-band width** (56+35+53 = 144°) instead of mod 360, then walk the three safe sub-ranges in order to place the result inside whichever sub-range it falls in (a standard "remap onto a circle with excluded arcs" technique) — deterministic and stable per project name, just never lands in an excluded band.
- Add the two missing `STATUS_CONFIG` token pairs this needs (`--color-status-busy-{bg,text}`, `--color-status-neutral-{bg,text}` for `starting`) and point `busy`/`idle-waiting`/`error`/`stalled`/`starting`/`exited` at tokens instead of inline literals — same visible colors, just sourced from `global.css` like every other status already is.
- Add `--color-badge-type-codex-{bg,text}` (light + dark) with the Codex branch's current values, and reference them from `AgentTypeBadge` instead of the inline `rgba(20,126,105,0.10)` /`#0f766e`/`#14a38b`.

**Explicitly out of scope**: the semantic accent hues themselves (red/green/blue/amber/violet/rose) are not changing — warning-amber should still mean "warning" everywhere; this task only stops *other* things from accidentally looking like them.

## Steps

### 1. Add new CSS tokens to global.css <!-- agent: general-purpose -->

- [x] In `frontend/src/styles/global.css`'s light block (~lines 18-43), add: `--role-badge-frontend-bg`/`-text`, `--role-badge-devops-bg`/`-text`, `--role-badge-qa-bg`/`-text`, `--role-badge-backend-bg`/`-text`, `--role-badge-security-bg`/`-text` at hues 285°/305°/190°/95°/115° respectively (background: pastel wash, `hsl(<hue> 65% 94%)`-ish, matching `--project-badge-bg-s`/`-l`'s light values of `65%`/`94%`; text: saturated, `hsl(<hue> 55% 32%)`-ish, matching `--project-badge-text-s`/`-l`'s light values of `55%`/`32%`). `architect` keeps using `--color-badge-neutral-{bg,text}` directly — no new token needed for it.
- [x] In the dark override block (~lines 60-85), add the same 5 tokens at the same hues but dark-mode lightness (background ≈18% lightness, text ≈78% lightness, matching `--project-badge-*`'s dark values).
- [x] Add `--color-status-busy-bg`/`-text` (same value as current inline `rgba(59,110,246,0.10)`/`#3b6ef6` for light, and the dark-mode equivalent using `--color-accent-blue`'s dark value `#6c93ff`) and `--color-status-neutral-bg`/`-text` (current inline `rgba(79,90,120,0.08)`/`#4f5a78` for light, dark equivalent) to both blocks.
- [x] Add `--color-badge-type-codex-bg`/`-text` (light: `rgba(20,126,105,0.10)`/`#0f766e`; choose a dark-mode pair with equivalent contrast to the existing Claude dark pair) to both blocks.
- [x] Run `npm run typecheck` — CSS custom properties aren't typechecked, this just confirms no accidental TS breakage from later steps; real verification is Step 5's contrast check.

### 2. Migrate ROLE_CONFIG off raw Tailwind classes <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, change `ROLE_CONFIG` (lines 167-174) from `className: 'bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300'`-style Tailwind classes to inline `style={{ background: 'var(--role-badge-<role>-bg)', color: 'var(--role-badge-<role>-text)' }}` on `RoleBadge` (lines 196-208), following the exact pattern `StatusBadge` (lines 120-133) already uses for its `cfg.bg`/`cfg.color`. `architect` points at `--color-badge-neutral-bg`/`-text`.
- [x] Update `resolveRoleBadge`'s return type (`AgentList.tsx:187-194`) from `{ role, className, dot }` to `{ role, bg, text, dot }` (or keep `dot` as a literal hex per role, unchanged — the colored dot doesn't need to move to a token since it's a one-off decorative accent, but should still shift to the new hues for consistency: `#c026d3`-ish for 285°, `#c026a0`-ish for 305°, keep existing `#06b6d4` for qa/190°, pick new dot hexes for backend/security matching 95°/115°).
- [x] Update `frontend/src/components/AgentList.test.tsx`'s existing `resolveRoleBadge` test(s) (search for `resolveRoleBadge` — there is a `dark:bg-pink-950` or similar className assertion from TASK-140) to assert the new `bg`/`text` token-reference shape instead of a Tailwind className string.

### 3. Constrain projectHue() to the safe bands <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, rewrite `projectHue()` (lines 210-215): keep the existing `(h * 31 + charCode) % 360`-style hash as the entropy source, but instead of returning it directly mod 360, mod it by the total safe width (144), then map the result into the correct safe sub-range by walking the three ranges `(56,132]` (width 76), `(172,207]` (width 35), `(278,331]` (width 53) in order (e.g. `if (x < 76) return 56 + x; x -= 76; if (x < 35) return 172 + x; x -= 35; return 278 + x`). Keep the function pure and deterministic — same project name must always produce the same hue. [Implemented with +1 offset per branch (57+x/173+x/279+x) since ranges are open-below — the literal example formula would land x=0 on the excluded boundary itself; caught by the new test.]
- [x] Add a unit test in `frontend/src/components/AgentList.test.tsx` asserting `projectHue()` never returns a value inside any excluded band for a representative sample of project names (reuse the existing test file's project-badge test setup, e.g. the `cryptwiz`/`tmux-conductor` hues already referenced by TASK-140's added test) — pin the new hues for those two specific names since existing tests may already assert the old raw-hash hue values and need updating. [tmux-conductor→71, cryptwiz→131; 20-name band-exclusion test added]

### 4. Detokenize STATUS_CONFIG and AgentTypeBadge <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, change `STATUS_CONFIG`'s `busy`, `idle-waiting`, `error`, `stalled`, `starting`, `exited` entries (lines 81, 83, 85, 87-88, 90) from inline `rgba(...)`/hex literals to `var(--color-status-busy-bg)`/`var(--color-status-busy-text)` (for `busy`), `var(--color-accent-green)`-derived tokens for `idle-waiting` (or a dedicated pair if the bg tint differs from `idle`'s), `var(--color-status-error-bg)`/`-text` for `error`/`stalled`/`exited` (add a `--color-status-error-bg` token if one doesn't already exist — check `global.css` first, `--color-status-error-text` exists but a background may currently be the inline `rgba(229,72,77,0.10)` repeated 3 times), and `var(--color-status-neutral-bg)`/`-text` for `starting`. No visible color should change — this step only removes duplication. [Added `--color-status-error-bg` + dedicated `--color-status-success-{bg,text}` for idle-waiting; `exited`'s text/dot kept literal since it wasn't byte-identical to the error token — avoids a visual change.]
- [x] In `AgentTypeBadge` (`AgentList.tsx:148-160`), change the non-Claude branch's `{ bg: 'rgba(20,126,105,0.10)', color: '#0f766e', dot: '#14a38b' }` to reference `var(--color-badge-type-codex-bg)`/`var(--color-badge-type-codex-text)` (keep `dot` as a literal hex, matching the Claude branch's own `dot: '#7e57c2'` which also stays a literal).

### 5. Verify <!-- agent: general-purpose -->

- [x] Run the full frontend test suite (`npm test` in `frontend/`) and `npm run typecheck` — clean. [72/72 tests passed, typecheck clean]
- [DEFERRED-TO-UAT] Via `/run` or `make dev`, open the dashboard in both light and dark mode; confirm: role badges (all 6) render at their new hues and remain legible (spot-check contrast — this is a genuinely new set of colors, not a re-verification of TASK-140's already-audited set, so don't assume TASK-140's audit covers these); the `tmux-conductor` project badge (and a few other real project names) no longer render in the amber/red/green semantic bands; status badges/buttons/context-meter colors are visually unchanged from before this task.
- [DEFERRED-TO-UAT] Screenshot the same agent-modal header view as the reported screenshot and confirm the project badge and the amber "Close agent"/"NO TASKS" chrome are now visually distinct hue families, not both reading as "orange."

## Notes

- Builds on top of (but does not depend on / need to wait for) `TASK-135` (dark-mode hardcoded-surface sweep) and `TASK-140` (badge/button contrast audit), both `pending-uat` but already merged — this task edits the same files but different concerns (identity-badge hue collisions, not dark-mode support or contrast ratios) and can proceed independently.
- The exact `hsl()` saturation/lightness percentages given above are starting points mirroring `--project-badge-*`'s existing formula — nudge them during Step 5's live check if a specific hue reads as too washed-out or too saturated next to the existing tokens, but do **not** deviate from the chosen hues (285/305/190/95/115) or the excluded-band math, since hue placement is the actual fix.

<!-- Updated: 2026-09-13 15:00 — Step 1 done: 16 tokens added to global.css (light+dark), typecheck pass -->
<!-- Updated: 2026-09-13 15:15 — Step 2 done: ROLE_CONFIG/resolveRoleBadge/RoleBadge migrated to tokens; test updated; 44/44 tests + typecheck pass -->
<!-- Updated: 2026-09-13 15:30 — Step 3 done: projectHue() constrained to safe bands (off-by-one fixed); 45/45 tests + typecheck pass -->
<!-- Updated: 2026-09-13 15:45 — Step 4 done: STATUS_CONFIG + AgentTypeBadge detokenized, zero visual regression; 45/45 tests + typecheck pass -->
<!-- Updated: 2026-09-13 16:00 — Step 5 static gates done: 72/72 tests + typecheck clean; live dashboard/screenshot checks deferred to UAT phase per tackle convention -->
