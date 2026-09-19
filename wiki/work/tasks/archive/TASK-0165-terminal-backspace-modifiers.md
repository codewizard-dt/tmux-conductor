---
id: TASK-0165
aliases: [TASK-0165]
title: "Handle Cmd+Backspace and Option+Backspace in the Direct Input terminal"
status: done
created: 2026-09-13
updated: 2026-09-18
depends_on: []
blocks: []
parallel_safe_with: [TASK-149, TASK-0163]
uat: "[[UAT-0165]]"
tags: [frontend, terminal, keyboard]
---

# TASK-0165 — Handle Cmd+Backspace and Option+Backspace in the Direct Input Terminal

parallel_safe_with::[[TASK-149]]
parallel_safe_with::[[TASK-0163]]

## Objective

Fix two silently-broken Backspace modifier combos in the Direct Input terminal's `mapKey()` (`frontend/src/components/LogTail.tsx`): Cmd+Backspace is currently swallowed entirely (falls into the bare `e.metaKey` → `null` branch), and Option+Backspace silently degrades to a plain single-char Backspace (the Option modifier is dropped before reaching the `switch`). Both should perform their standard readline-equivalent line-edit actions in the remote shell.

## Approach

Map both combos to already-allowlisted Ctrl-letter tmux keys rather than introducing new symbolic key names:
- Cmd+Backspace → `C-u` (readline `unix-line-discard`, kill to start of line)
- Option+Backspace → `C-w` (readline `unix-word-rubout`, delete word backward)

Both `C-u` and `C-w` already match `host-server/index.ts`'s `TMUX_KEY_RE` (`C-[a-z]`) and are already exercised today by the existing Ctrl+letter branch, so this needs no backend regex change and no live-tmux byte-sequence verification — it's a frontend-only change in `mapKey()`.

Mirror TASK-149's exclusive-modifier guard style (`e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey`) so other chords (e.g. Shift+Cmd+Backspace) fall through unchanged instead of being silently misrouted.

An alternative — sending a literal `M-BSpace` tmux key name — was considered and rejected: `M-BSpace` isn't covered by `TMUX_KEY_RE`'s `M-[A-Za-z]` class (single letters only), so it would require both a regex addition and a fresh live-tmux verification of the byte sequence, mirroring TASK-149's methodology, for no behavioral benefit over `C-w`.

## Steps

### 1. Extend mapKey() in LogTail.tsx <!-- agent: general-purpose -->

- [x] In `frontend/src/components/LogTail.tsx`, locate `mapKey()` (currently ~lines 41-73)
  - The existing `if (e.metaKey) return null // keep Cmd+R, Cmd+W, …` line unconditionally drops all Cmd combos, including Cmd+Backspace
  - The existing `switch (e.key) { case 'Backspace': return { keys: ['BSpace'] } ... }` is only reached when neither `metaKey` nor `ctrlKey` is set, but does NOT check `altKey` — so Option+Backspace currently falls into this case with the Option modifier silently dropped
- [x] Add a new branch, placed alongside the existing Arrow-key modifier checks near the top of the function (same pattern TASK-149 used for Cmd/Ctrl/Option+Arrow) and evaluated before the unconditional `if (e.metaKey) return null` line:
  - `if (e.key === 'Backspace' && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) return { keys: ['C-u'] }`
  - `if (e.key === 'Backspace' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) return { keys: ['C-w'] }`
- [x] Verify plain Backspace (no modifiers) still falls through unchanged to `{ keys: ['BSpace'] }`, and that combos excluded by the exclusive-modifier guards (e.g. Shift+Cmd+Backspace, Shift+Option+Backspace) fall through without being misrouted to `C-u`/`C-w`

<!-- Updated: 2026-09-13 -->
<!-- Added the two guard lines (mapKey() now ~lines 48-82) at lines 61-62, right before the unconditional metaKey→null line. Added a new describe('mapKey (TASK-0165 Cmd/Option+Backspace)') block to LogTail.test.tsx with 4 tests: Cmd+Backspace→C-u, Option+Backspace→C-w, plain Backspace→BSpace unchanged, and a regression guard for Shift+Cmd+Backspace/Shift+Option+Backspace not being misrouted. Full suite 148/148 passed; tsc --noEmit clean. -->

### 2. Verify live in the running app <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Start the dev servers (`make dev` or equivalent) and open the Direct Input terminal for a live agent pane
- [DEFERRED-TO-UAT] Type a multi-word line into the shell prompt, press Cmd+Backspace, confirm the whole line before the cursor is cleared (kill-to-start-of-line behavior)
- [DEFERRED-TO-UAT] Type a multi-word line, press Option+Backspace, confirm only the last word is deleted (word-backward behavior), not just the last character
- [DEFERRED-TO-UAT] Confirm plain Backspace still deletes one character, and that Shift+Cmd+Backspace / other unrelated combos are unaffected (not silently misrouted)

<!-- Updated: 2026-09-13 -->
<!-- Runtime/browser verification is out of tackle's static-gates-only scope; deferred to UAT (/uat-generate + /uat-walk or /uat-auto). -->

## Testing

Live verification against a real tmux pane per Step 2 — this is a keyboard-input mapping fix with no meaningful unit-test surface (`mapKey()` has no existing test file); UAT should exercise both combos live via Playwright or manual walkthrough.
