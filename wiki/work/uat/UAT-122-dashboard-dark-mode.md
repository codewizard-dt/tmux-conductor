---
id: UAT-122
aliases: [UAT-122]
title: "UAT: Dashboard dark mode — theme toggle over the Tailwind color tokens"
status: pending
task: TASK-122
created: 2026-08-21
updated: 2026-08-21
---

# UAT-122 — UAT: Dashboard dark mode — theme toggle over the Tailwind color tokens

implements::[[TASK-122]]

> **Source task**: [[TASK-122]]
> **Generated**: 2026-08-21

---

## Prerequisites

- [ ] `make dev` running from the repo root (host-server on `:8788`, frontend on `:4321`)
- [ ] Browser access to `http://localhost:4321` with devtools available (for `localStorage` inspection and `prefers-color-scheme` emulation)
- [ ] `frontend/` dependencies installed (`npm install`), so `npx vitest run` can execute the repeatable unit tests below

---

## Test Cases

### UAT-UI-001: Toggle switches the dashboard between light and dark themes without a page reload
- **Page**: `http://localhost:4321/` (the toggle lives in `NavBar`, rendered globally by `frontend/src/App.tsx` on every route, including `/projects`)
- **Component**: `frontend/src/components/NavBar.tsx`
- **Description**: Verifies the core toggle mechanism — clicking the button flips `document.documentElement`'s `dark` class instantly, with no navigation or reload.
- **Steps**:
  1. Navigate to `http://localhost:4321/`. Confirm the page renders in the light palette (canvas `#f6f7f9`, ink `#0b0b0d` per `frontend/src/styles/global.css`).
  2. Locate the circular toggle button at the far right of the `NavBar` header (title/`aria-label` "Switch to dark mode", showing a 🌙 icon).
  3. Click it.
  4. Observe the entire page (background, text, borders, cards) switches immediately to the dark palette (canvas `#16171c`, ink `#eef0f4`) with no page navigation or flash of a blank page.
  5. Confirm the button now reads "Switch to light mode" and shows a ☀️ icon.
  6. Click it again and confirm the page reverts to the light palette and the button reverts to 🌙/"Switch to dark mode".
- **Expected Result**: Theme flips instantly on click, in both directions, without a reload; button icon and `aria-label`/`title` track the current theme.
- **Repeatable Unit Test**: Created: `frontend/src/components/NavBar.test.tsx`
- **Unit Test Command**: `npx vitest run src/components/NavBar.test.tsx`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-22 -->

### UAT-UI-002: Theme choice persists to localStorage and survives a page reload
- **Page**: `http://localhost:4321/`
- **Component**: `frontend/src/components/NavBar.tsx` (write) + `frontend/index.html` inline bootstrap `<script>` (read-on-load)
- **Description**: Verifies the chosen theme is written to `localStorage` and restored on reload, per Acceptance Criterion 2.
- **Steps**:
  1. Click the theme toggle to switch to dark mode.
  2. Open devtools console and run `localStorage.getItem('theme')`; confirm it returns `"dark"`.
  3. Reload the page (F5 / Cmd+R).
  4. Confirm the dashboard renders in dark mode immediately on load — no visible flash of the light theme before the dark theme applies.
  5. Confirm the toggle button still shows ☀️/"Switch to light mode" after reload.
  6. Toggle back to light, reload again, and confirm it now loads in light mode with `localStorage.getItem('theme')` returning `"light"`.
- **Expected Result**: `localStorage['theme']` is set on every toggle; a reload restores the stored theme before first paint (no FOUC), because `frontend/index.html`'s inline `<script>` (in `<head>`, before `main.tsx` loads) applies the stored class synchronously.
- **Repeatable Unit Test**: Created: `frontend/src/components/NavBar.test.tsx` (covers the `localStorage.setItem` write path; the pre-paint reload restore itself runs in an inline `<script>` in `index.html`, outside what a component-level unit test can exercise — see UAT-UI-003)
- **Unit Test Command**: `npx vitest run src/components/NavBar.test.tsx`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-22 -->

### UAT-UI-003: No stored preference falls back to the OS `prefers-color-scheme`
- **Page**: `http://localhost:4321/`
- **Component**: `frontend/index.html` inline bootstrap `<script>` (lines 11-21)
- **Description**: Verifies the documented fallback — `stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches` — for a first-time visitor with no `theme` key set.
- **Steps**:
  1. In devtools console, run `localStorage.removeItem('theme')`.
  2. Open devtools' rendering panel and set "Emulate CSS media feature `prefers-color-scheme`" to `dark`.
  3. Reload the page. Confirm the dashboard loads in dark mode with no toggle click.
  4. Switch the emulation to `light`, reload again, and confirm the dashboard loads in light mode.
- **Expected Result**: With no `localStorage['theme']`, the initial theme follows the OS/browser `prefers-color-scheme` media query.
- **Repeatable Unit Test**: Not applicable: this fallback logic lives entirely in the inline `<script>` in `frontend/index.html`'s `<head>` (intentionally not an importable module, so it can run synchronously before `main.tsx` loads and avoid a flash of the wrong theme) — it isn't reachable from a jsdom-based component test.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-22 -->

### UAT-UI-004: Every existing Tailwind color-token usage re-themes with no separate per-component edits
- **Pages**: `http://localhost:4321/` (Agents) and `http://localhost:4321/projects` (Projects), plus the components reachable from them
- **Components**: `frontend/src/components/AgentList.tsx` (agent cards, `AgentDetailModal`), `frontend/src/components/ProjectList.tsx`, `frontend/src/components/FolderPickerModal.tsx`, `frontend/src/components/AddAgentForm.tsx`, `frontend/src/components/AddProjectForm.tsx`, `frontend/src/components/AddBgProcessForm.tsx`, `frontend/src/components/LogTail.tsx`, `frontend/src/components/DiffPanel.tsx`, `frontend/src/components/CheckpointList.tsx`
- **Description**: Verifies Acceptance Criterion 3 — because the token *definitions* moved to CSS variables (`frontend/tailwind.config.js` + `.dark` block in `frontend/src/styles/global.css`), every existing `bg-canvas`/`text-ink`/`border-line`/`bg-surface`/`bg-paper`/`bg-card` usage should re-theme automatically with no code change at the call site.
- **Steps**:
  1. With dark mode on, visit `/` and confirm the agent list cards, headers, and borders render in the dark palette.
  2. Click an agent tile to open `AgentDetailModal`; confirm its background/borders/text are dark-themed.
  3. Open `FolderPickerModal` (via "Add Agent" → folder picker) and confirm its overlay/card render in the dark palette.
  4. Open `AddAgentForm`, `AddProjectForm`, `AddBgProcessForm`; confirm each form's inputs/card background are dark-themed.
  5. Visit `/projects`; confirm `ProjectList` renders dark-themed.
  6. Open the `LogTail` panel for a running agent and confirm its chrome (not the xterm terminal itself — see note below) is dark-themed.
  7. Open `DiffPanel` and `CheckpointList` (if a checkpoint exists) and confirm both are dark-themed.
- **Expected Result**: All listed surfaces switch to the dark palette with the single toggle — no component required its own separate dark-mode styling.
- **Known, documented gap (do not fail the case for these — confirm they're visually as expected and move on)**: TASK-122 Step 2 already found and recorded these as intentionally out of scope — they bypass the token system via hardcoded hex/rgba and will **not** re-theme: `AgentList.tsx`'s `STATUS_CONFIG`/role-color maps (~lines 80-92, 152-153, 168-173, 1062-1160) and several `bg-[#f1f2f4]`/`text-[#...]` arbitrary-value classes (lines 222, 310, 324, 329, 337, 353, 690, 699, 749, 952, 982); `LogTail.tsx`'s xterm.js theme object and `bg-[#0b0b0d]`/`border-[#e0901a]` arbitrary classes (lines 276, 667-758); one hardcoded `bg-white`/`rgb(...)` literal each in `FolderPickerModal.tsx`, `AddAgentForm.tsx`, `AddProjectForm.tsx`, `AddBgProcessForm.tsx`.
- **Repeatable Unit Test**: Not applicable: this is a visual check of compiled Tailwind CSS cascading across many rendered components in a real browser — component unit tests run in jsdom without the compiled stylesheet loaded, so they cannot observe computed colors.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-22 -->

### UAT-UI-005: Status/accent colors remain legible against the dark canvas
- **Page**: `http://localhost:4321/`
- **Components**: `frontend/src/components/NavBar.tsx` (token-based `accent-green` usage), `frontend/src/components/AgentList.tsx` (`StatusBadge`/`AgentTypeBadge`/`RoleBadge`/`UsageBadge`, hardcoded — see UAT-UI-004's known gap)
- **Description**: Verifies Acceptance Criterion 4. Token-based accent usage (e.g. `NavBar`'s `bg-accent-green` status dot and `border-accent-green` active-nav underline) should read the dark palette's `--color-accent-green: #3ddc91` and remain legible against the dark canvas (`#16171c`)/surface (`#1c1d24`).
- **Steps**:
  1. With dark mode on, inspect the small green status dot and "conductor" wordmark in `NavBar`, and the active nav-link's green underline — confirm sufficient contrast against the dark header background.
  2. Inspect the `StatusBadge`/`AgentTypeBadge`/`RoleBadge`/`UsageBadge` pills on agent cards (hardcoded colors, not token-driven per UAT-UI-004). Confirm they remain legible even though untouched by the dark palette — each badge paints its own low-opacity tinted background rather than relying on `canvas`, so contrast is expected to hold, but confirm visually rather than assuming.
- **Expected Result**: Token-driven accent colors are legible against the dark palette; the untouched hardcoded status badges are also still legible (self-contained backgrounds), matching TASK-122's documented scope decision.
- **Repeatable Unit Test**: Not applicable: color-contrast/legibility is a visual judgment call, not a deterministic assertion.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-22 -->

### UAT-EDGE-001: Initial render syncs to a class already applied to `<html>` (bootstrap-script handoff)
- **Scenario**: `frontend/index.html`'s inline bootstrap script may have already added the `dark` class to `<html>` before React mounts (to avoid a flash of the wrong theme). `NavBar`'s `getInitialTheme()` must read that pre-existing class on first render rather than defaulting to light and clobbering it.
- **Steps**: Unit-tested — render `NavBar` with `dark` already present on `document.documentElement.classList` before mount; assert the toggle button shows ☀️/"Switch to light mode" on the very first render (no mismatch/flash).
- **Expected Result**: `getInitialTheme()` (`frontend/src/components/NavBar.tsx:6-8`) returns `'dark'` when the class is already present, so React state starts in sync with the DOM the bootstrap script already set up.
- **Repeatable Unit Test**: Created: `frontend/src/components/NavBar.test.tsx`
- **Unit Test Command**: `npx vitest run src/components/NavBar.test.tsx`
- [x] Pass <!-- 2026-08-22 --> <!-- via unit test frontend/src/components/NavBar.test.tsx: "syncs initial state to a 'dark' class already applied to <html>" -->

### UAT-EDGE-002: Rapid double-toggle returns to the original state
- **Scenario**: A user clicks the toggle twice in quick succession (e.g. double-click, or click-undo).
- **Steps**: Unit-tested — click the toggle button twice; assert both `document.documentElement`'s `dark` class and `localStorage['theme']` end back at the original light state.
- **Expected Result**: No state gets stuck mid-toggle; two clicks are a no-op overall.
- **Repeatable Unit Test**: Created: `frontend/src/components/NavBar.test.tsx`
- **Unit Test Command**: `npx vitest run src/components/NavBar.test.tsx`
- [x] Pass <!-- 2026-08-22 --> <!-- via unit test frontend/src/components/NavBar.test.tsx: "clicking twice returns both the DOM class and localStorage to the original light state" -->

### UAT-EDGE-003: localStorage unavailable (private browsing) doesn't break the toggle
- **Scenario**: `localStorage.setItem` throws (Safari private browsing, storage disabled by policy, quota exceeded, etc.).
- **Steps**: Unit-tested — mock `Storage.prototype.setItem` to throw; click the toggle; assert no uncaught error propagates out of the click handler and the DOM `dark` class still toggles (persistence silently fails per `NavBar.tsx`'s `try { localStorage.setItem(...) } catch { /* won't persist */ }`).
- **Expected Result**: The visual toggle keeps working even when persistence is unavailable; the failure is swallowed, not surfaced as a crash.
- **Repeatable Unit Test**: Created: `frontend/src/components/NavBar.test.tsx`
- **Unit Test Command**: `npx vitest run src/components/NavBar.test.tsx`
- [x] Pass <!-- 2026-08-22 --> <!-- via unit test frontend/src/components/NavBar.test.tsx: "does not throw and still toggles the DOM class when localStorage.setItem throws" -->

---

## Notes for `/uat-walk` and `/uat-auto`

- This task has no backend/API surface — all cases are frontend-only (no `UAT-API-*` cases).
- 5 of 8 cases (`UAT-UI-001`, `UAT-UI-002`, `UAT-EDGE-001/002/003`) are backed by the repeatable unit test file `frontend/src/components/NavBar.test.tsx` (6 tests, all passing as of generation — verified via `npx vitest run src/components/NavBar.test.tsx`), giving `/uat-auto` a real evidence channel instead of fail-closing them to a human pass.
- 3 cases (`UAT-UI-003`, `UAT-UI-004`, `UAT-UI-005`) are genuinely browser/visual-only and will fail-close to `/uat-walk` for a human pass — this matches TASK-122's own note that "every case should expect to fail-close to `/uat-walk`" for the parts that are inherently visual, though the toggle/persistence mechanics themselves are now unit-covered.

## Test-infra correction (found during generation, out of TASK-122's stated scope but required to make these unit tests pass)

TASK-122's Approach section states this repo has "no frontend test runner (no vitest/jest, no `*.test.tsx` anywhere in `frontend/`)" — that was true when TASK-122 was created (2026-08-15) but is now stale: `frontend/package.json` has `vitest`/`@testing-library/react`/`jsdom` and 4 pre-existing `*.test.tsx` files (added by a concurrent task, likely TASK-123's `ConfirmDialog.test.tsx`). While adding `frontend/src/components/NavBar.test.tsx` for this UAT, all 6 tests initially failed: **`localStorage` was `undefined`** in every test. Root cause, confirmed by reading `node_modules/vitest`'s jsdom-environment source: Node ≥22 defines its own inert `globalThis.localStorage` accessor (returns `undefined` without the unset `--localstorage-file` flag); vitest's `populateGlobal()` only copies a jsdom `window` key onto the test global when that key is *not already present* on `global` (or is on an explicit allowlist `"localStorage"` isn't part of) — so Node's broken accessor silently wins over jsdom's real, working `Storage` implementation. Fixed in `frontend/vitest.setup.ts` by pulling the real implementation from `globalThis.jsdom.window.localStorage`/`sessionStorage` (vitest stashes the underlying `JSDOM` instance there) and reassigning it onto `globalThis`. Verified: full suite (`npx vitest run`) — 6 test files, 64 tests, all passing; `npx tsc --noEmit` clean; `npm run build` clean. This fix is generic (not NavBar-specific) and also unblocks any future test of `LogTail.tsx`/`AddTaskForm.tsx`'s existing `localStorage`-backed draft-persistence code, neither of which had coverage before.
