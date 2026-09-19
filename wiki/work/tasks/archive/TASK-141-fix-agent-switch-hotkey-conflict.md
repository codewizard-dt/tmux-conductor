---
id: TASK-141
aliases: [TASK-141]
title: "Replace Cmd/Ctrl+Arrow agent-switch hotkey to stop conflicting with terminal cursor navigation"
status: done
created: 2026-09-13
updated: 2026-09-18
depends_on: []
blocks: []
parallel_safe_with: [TASK-136, TASK-137, TASK-138, TASK-139]
uat: "[[UAT-141]]"
tags: [frontend, keyboard-shortcuts, direct-input]
---

# TASK-141 — Replace Cmd/Ctrl+Arrow agent-switch hotkey to stop conflicting with terminal cursor navigation

relates_to::[[TASK-138]]

## Objective

`AgentDetailModal`'s document-level keydown handler currently binds `Cmd+ArrowLeft/Right` (and `Ctrl+ArrowLeft/Right`) to switch the open agent. `Cmd+Left/Right` is the standard macOS readline/text-navigation shortcut (move cursor to start/end of line), and the app embeds a real terminal via xterm.js in Direct Input mode. `LogTail.tsx` already deliberately lets the browser handle any Cmd-chord in the terminal (`mapKey()` returns `null` for `e.metaKey`) so Cmd+Left/Right keeps its normal cursor-navigation meaning while typing — but the modal's handler only exempts literal `INPUT`/`TEXTAREA` focus targets, so a focus edge case (adjacent to the xterm mousedown focus-steal tracked in TASK-138) lets the modal intercept the keystroke as "switch agent" instead of letting it reach the terminal as cursor navigation. This task removes the conflict entirely by moving off the Cmd+Arrow/Ctrl+Arrow combo.

## Approach

Replace the agent-switch shortcut with **Ctrl+Alt+Arrow** (Ctrl+Option+Left/Right on macOS). This combo has no macOS or browser default binding, does not collide with readline's Cmd+Left/Right, does not collide with Option+Left/Right (word-left/right navigation), and does not collide with the existing bare `Alt+F` log-expand shortcut (which explicitly requires `!ctrlKey`). This is a straight key-combo swap in the existing handler — no change to the focus-exemption logic itself (that's TASK-138's scope) and no change to `onNavigate`'s behavior.

## Steps

### 1. Update the keydown handler  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, locate the `AgentDetailModal` keydown `useEffect` (~lines 569-588) containing:
  ```js
  if (e.metaKey || e.ctrlKey) {
    if (e.key === 'ArrowRight') { e.preventDefault(); onNavigate('next') }
    if (e.key === 'ArrowLeft') { e.preventDefault(); onNavigate('prev') }
  }
  ```
- [x] Replace the condition so it only fires on **Ctrl+Alt+Arrow** (`e.ctrlKey && e.altKey`, both required) and no longer matches on `e.metaKey` alone or `e.ctrlKey` alone:
  ```js
  if (e.ctrlKey && e.altKey) {
    if (e.key === 'ArrowRight') { e.preventDefault(); onNavigate('next') }
    if (e.key === 'ArrowLeft') { e.preventDefault(); onNavigate('prev') }
  }
  ```
- [x] Check whether `e.altKey` firing on macOS with certain keyboard layouts alters `e.key` (some layouts turn Option+Arrow into a different key code) — verify manually in Step 3 below; if it does, fall back to checking `e.code` (`ArrowLeft`/`ArrowRight`) instead of `e.key`. <!-- deferred to Step 4 manual verification, per this step's own guidance -->

<!-- Updated: 2026-09-13 -->

### 2. Update in-app documentation/hints  <!-- agent: general-purpose -->

- [x] Search `frontend/src/components/AgentList.tsx` and any tooltip/help text near the modal for a rendered hint mentioning "⌘←/→", "Cmd+Arrow", or similar that documents the old shortcut to users, and update it to reflect "Ctrl+Option+←/→" (or the platform-neutral "Ctrl+Alt+Arrow").

<!-- Updated: 2026-09-13 -->
<!-- Found and updated the <kbd> hint pair (was {isMac ? '⌘' : 'Ctrl'} ←/→) to literal "Ctrl+Alt ←/→"; removed the now-unused `isMac` const. -->

### 3. Update and run tests  <!-- agent: general-purpose -->

- [x] Update `AgentList.test.tsx:496` (and any neighboring assertions) which currently fires `keyDown(document, { key: 'ArrowRight', metaKey: true })` to instead fire `keyDown(document, { key: 'ArrowRight', ctrlKey: true, altKey: true })`, and add a companion assertion that a bare `metaKey`/`ctrlKey`-only ArrowRight/ArrowLeft event no longer triggers `onNavigate` (regression guard against reintroducing the conflict).
- [x] Run the frontend test suite and confirm it passes.

<!-- Updated: 2026-09-13 -->
<!-- Added metaKey-only and ctrlKey-only no-op regression assertions ahead of the real ctrlKey+altKey navigation assertion in the existing "next-agent navigation still reaches an agent hidden by the current filter" test. Full suite: 67/67 passed (6 files); AgentList.test.tsx: 40/40 passed. -->

### 4. Manual verification  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Start the dev servers (`make dev`), open an agent's detail modal, and confirm Ctrl+Alt+Left/Right switches to the adjacent agent.
- [DEFERRED-TO-UAT] With Direct Input active and focus in the embedded terminal, confirm Cmd+Left/Right now moves the terminal cursor (readline behavior) instead of switching agents, and confirm Ctrl+Alt+Left/Right still switches agents even while the terminal has focus (if that is still the desired behavior — otherwise confirm it's correctly exempted like other document-level shortcuts).

<!-- Updated: 2026-09-13 -->
<!-- Runtime/browser verification is out of tackle's static-gates-only scope; deferred to UAT (/uat-generate + /uat-walk). -->

### 5. Make the shortcut hints clickable buttons  <!-- agent: general-purpose -->

- [x] Added mid-tackle per user request (screenshot `tmp/dashboard-drops/1789286722548-Screenshot-2026-09-13-at-3.02.59-AM.png`): the `Ctrl+Alt ←` / `Ctrl+Alt →` `<kbd>` hints added in Step 2 are currently decorative text only. Convert both into actual clickable `<button>` elements that call `onNavigate('prev')` / `onNavigate('next')` respectively (the same handler the keydown shortcut calls), so a mouse user can switch agents by clicking the hint directly, not just by reading it as documentation.
- [x] Preserve the existing visual style (same `<kbd>`-like pill appearance showing "Ctrl+Alt ←"/"Ctrl+Alt →") — wrap or restyle as a `<button>` with the same look (e.g. keep the `<kbd>`-style classes on the button, or nest a styled span inside the button) rather than introducing a visually different control.
- [x] Give each button an accessible label (`aria-label="Previous agent"` / `aria-label="Next agent"`) and ensure it's keyboard-focusable and doesn't also submit/trigger anything unintended (e.g. `type="button"` if inside a `<form>`-like context).
- [x] Disable or hide each button appropriately at the edges of the agent list if `onNavigate('prev')`/`onNavigate('next')` has a no-op boundary case (check how the existing keydown handler / `onNavigate` behaves at the first/last agent — mirror that same boundary behavior for the new buttons, e.g. `disabled` when there's no prev/next agent, if such a concept already exists in the surrounding code).
- [x] Update `AgentList.test.tsx` with a test asserting a click on each new button calls `onNavigate` with the correct direction (in addition to the existing keydown-based tests) — do not remove the existing keydown tests.
- [x] Run the frontend test suite and confirm it passes.

<!-- Updated: 2026-09-13 -->
<!-- Converted both <kbd> hints to <button type="button"> with the same visual classes plus hover/active states; onClick calls onNavigate('prev'/'next'); aria-label added. onNavigate wraps modulo-style with no boundary/no-op case (confirmed via handleNavigate in the parent), so no disabled state was needed beyond the existing agentCount>1 gate. New click test added to AgentList.test.tsx; full suite 68/68 passed. -->

### 6. Swap the shortcut combo to Shift+Cmd+Arrow  <!-- agent: general-purpose -->

- [x] Added mid-tackle per user request: replace the Ctrl+Alt+Arrow combo (from Step 1) with **Shift+Cmd+Arrow** (`e.metaKey && e.shiftKey`, both required) in `AgentDetailModal`'s keydown handler in `frontend/src/components/AgentList.tsx`. This is a straight condition swap — no change to the `TEXTAREA`/`INPUT` focus exemption or to `onNavigate`'s behavior.
- [x] Update the two hint `<button>` elements (added in Step 5) from showing "Ctrl+Alt ←"/"Ctrl+Alt →" to "Shift+Cmd ←"/"Shift+Cmd →" (or the symbol form "⇧⌘ ←"/"⇧⌘ →" if that better matches the existing pill's visual style — check how the pill currently renders the combo text and keep it consistent).
- [x] Update `AgentList.test.tsx`: change the existing `ctrlKey: true, altKey: true` navigation assertion to `metaKey: true, shiftKey: true`, and update the no-op regression guards to cover the combos that must NOT trigger navigation any more — a bare `metaKey`-only keydown (no `shiftKey`) must still be a no-op (this is the exact case the task originally fixed: plain Cmd+Arrow must reach the terminal as cursor navigation, not agent-switch), and a bare `ctrlKey`+`altKey` keydown (the previous combo) must also no longer trigger navigation.
- [x] Run the frontend test suite and confirm it passes.
- [x] Run a targeted typecheck (`cd frontend && npx tsc --noEmit`).

<!-- Updated: 2026-09-13 -->
<!-- Keydown condition changed to e.metaKey && e.shiftKey; hint buttons now read "Shift+Cmd ←"/"Shift+Cmd →" (kept word form matching the pill's existing style); test's no-op guards now cover bare metaKey-only AND the old ctrlKey+altKey combo, real assertion uses metaKey+shiftKey. Click-based hint-button test untouched (doesn't reference the key combo). Full suite 71/71 passed; tsc --noEmit clean. -->
