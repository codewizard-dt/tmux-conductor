---
id: TASK-122
aliases: [TASK-122]
title: "Dashboard dark mode — theme toggle over the Tailwind color tokens"
status: todo
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: []
parallel_safe_with: [TASK-123, TASK-124]
uat: ""
tags: [frontend, ui, theming, roadmap-017]
---

# TASK-122 — Dashboard dark mode — theme toggle over the Tailwind color tokens

## Objective

Add a dark mode to the dashboard, toggleable by the user and persisted across reloads, built on `frontend/tailwind.config.js`'s centralized color tokens (`canvas`, `surface`, `paper`, `card`, `ink`, `ink-2`, `muted`, `muted-2`, `line`, `line-2`, `accent.*`).

## Approach

**Correction to the roadmap wording** — the roadmap bullet describes this as using "the existing centralized Tailwind tokens," implying a dark variant already exists. It does not: `frontend/tailwind.config.js` (read in full during task creation) has **no `darkMode` key at all** (no `'class'` or `'media'` strategy configured) and every token under `theme.extend.colors` is a single hardcoded light-mode hex value (e.g. `canvas: '#f6f7f9'`, `ink: '#0b0b0d'`). There is no dark palette to "flip" — this task must **define** the dark palette and wire the toggle, not just enable a switch. What the roadmap got right: the tokens genuinely are centralized (all colors flow through these named Tailwind keys, not scattered hex literals in component files — confirm this holds for `frontend/src/components/*.tsx` before assuming full coverage, since a stray hardcoded hex would need converting too), so once a dark variant exists, propagation should be mechanical.

**Recommended mechanism**: convert `theme.extend.colors` from literal hex strings to Tailwind's `var(--token-name)` indirection, define the light values as CSS custom properties on `:root` in the app's base stylesheet, add `darkMode: 'class'` to `tailwind.config.js`, and define the dark overrides under a `.dark` (or `[data-theme="dark"]`) selector. This lets every existing `bg-canvas`/`text-ink`/etc. usage across the codebase keep working unchanged — only the token *definitions* move, not every call site. Pick a genuinely dark palette (not just inverted hex), and preserve enough contrast on `accent.*` (used for status/badge colors) that state colors (`accent.green`/`accent.red`/`accent.amber`) stay legible against a dark `canvas`.

**Toggle + persistence**: add a small control (e.g. in `NavBar`, `frontend/src/components/NavBar.tsx`) that flips a `dark` class on `<html>` (or sets `data-theme`) and persists the choice in `localStorage`; on load, read the stored preference before first paint if practical (avoids a flash of the wrong theme), falling back to `prefers-color-scheme: dark` when no stored preference exists.

**Verification is human-gated.** This repo has no frontend test runner (no vitest/jest, no `*.test.tsx` anywhere in `frontend/`) — confirmed independently by three agents earlier today (UAT-062/UAT-074/UAT-076 generation). `/uat-generate` for this task should expect every case to fail-close to `/uat-walk`; do not expect or require unit test promotion here.

## Steps

### 1. Convert color tokens to CSS-variable indirection  <!-- agent: general-purpose -->

- [ ] Read `frontend/tailwind.config.js` in full (re-read immediately before editing — concurrent Phase 3 tasks may also touch this file) and read the app's base CSS entrypoint (find it via `mcp__serena__search_for_pattern` for `@tailwind base` or similar, likely `frontend/src/index.css` or `frontend/src/App.css`).
- [ ] Define the current light values as CSS custom properties on `:root` in the base stylesheet (one variable per existing token: `--color-canvas`, `--color-surface`, `--color-paper`, `--color-card`, `--color-ink`, `--color-ink-2`, `--color-muted`, `--color-muted-2`, `--color-line`, `--color-line-2`, `--color-accent`, `--color-accent-red`, `--color-accent-green`, `--color-accent-blue`, `--color-accent-amber`, `--color-accent-violet`, `--color-accent-rose`).
- [ ] Update `theme.extend.colors` in `tailwind.config.js` so each key resolves via `var(--color-*, <original-hex-fallback>)` instead of a literal hex string — keep the fallback so any consumer bypassing the CSS-variable layer (e.g. a build tool inlining at a different stage) still gets a sane color.
- [ ] Add `darkMode: 'class'` to the Tailwind config root (sibling to `content`/`theme`).

### 2. Define the dark palette  <!-- agent: general-purpose -->

- [ ] In the base stylesheet, add a `.dark { ... }` (or `:root[data-theme="dark"]{ ... }` — pick one and use it consistently with Step 3's toggle mechanism) block redefining every `--color-*` variable from Step 1 with dark-appropriate values. Design goal: a calm, low-glare dark surface (not pure black), with `ink`/`ink-2` light enough to read against it, and `accent.*` state colors kept legible (test against the actual `StatusBadge`/`AgentTypeBadge`/badge components once wired).
- [ ] Spot-check for hardcoded hex/rgb literals outside the token system: `mcp__serena__search_for_pattern` for `#[0-9a-fA-F]{3,6}` and `rgb(` across `frontend/src/components/*.tsx` and any `.css` files. Anything found bypasses the token system and needs its own dark-mode handling (either convert it to a token or add an explicit dark-mode override) — note what you find even if out of scope to fix everything.

### 3. Add the toggle control  <!-- agent: general-purpose -->

- [ ] In `frontend/src/components/NavBar.tsx` (re-read immediately before editing), add a theme toggle control (button/switch) that flips the `dark` class (or `data-theme` attribute, matching Step 2's selector choice) on `document.documentElement` and writes the choice to `localStorage` (e.g. key `theme`, values `'light' | 'dark'`).
- [ ] Add a small inline script or early-executing effect that applies the stored `localStorage` preference (falling back to `window.matchMedia('(prefers-color-scheme: dark)')` when unset) before/at first paint, to avoid a flash of the wrong theme on load.

### 4. Typecheck and smoke  <!-- agent: general-purpose -->

- [ ] `npx tsc --noEmit` in `frontend/` — zero errors.
- [ ] `npm run build` in `frontend/` — clean.
- [ ] With `make dev` running, manually toggle dark mode and visually confirm the agent list, `AgentDetailModal`, badges (`StatusBadge`, `AgentTypeBadge`, `UsageBadge` if landed, `RoleBadge` if landed), and `FolderPickerModal`'s overlay all render legibly in both themes; reload the page and confirm the choice persists.

## Acceptance Criteria

- [ ] A user-facing toggle switches the dashboard between light and dark themes without a page reload.
- [ ] The chosen theme persists across page reloads (`localStorage`).
- [ ] Every existing Tailwind color-token usage (`bg-canvas`, `text-ink`, `border-line`, `accent.*`, etc.) resolves correctly in both themes with no separate per-component edits required, because the tokens themselves are theme-aware.
- [ ] Status/accent colors remain legible (sufficient contrast) against the dark `canvas`.
- [ ] `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/`.

## Dependencies

- None — UI-only, independent of the other ROADMAP-017 Phase 3 items.
- **Parallel-safe with** [TASK-123](TASK-123-replace-confirm-dialogs.md) and [TASK-124](TASK-124-agentlist-text-filter.md) — different concerns, though all three touch `frontend/src/components/`; re-read shared files (`NavBar.tsx` is not touched by 123/124, so low collision risk) immediately before editing per this repo's hot-file discipline.

### Roadmap

Implements ROADMAP-017 Phase 3, item "Add dark mode to the dashboard using the existing centralized Tailwind tokens in `frontend/tailwind.config.js`" — `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.
