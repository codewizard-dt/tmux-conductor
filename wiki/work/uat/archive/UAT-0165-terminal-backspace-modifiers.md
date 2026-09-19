---
id: UAT-0165
aliases: [UAT-0165]
title: "UAT: Handle Cmd+Backspace and Option+Backspace in the Direct Input Terminal"
status: passed
task: TASK-0165
created: 2026-09-17
updated: 2026-09-18
---

# UAT-0165 — UAT: Handle Cmd+Backspace and Option+Backspace in the Direct Input Terminal

implements::[[TASK-0165]]

> **Source task**: [[TASK-0165]]
> **Generated**: 2026-09-17

---

## Prerequisites

- [ ] Frontend dev server running (`make dev`, `http://localhost:4321`) for the two manual UI cases.
- [ ] A conductor tmux session exists with at least one registered agent whose tmux window is present, for a live Direct Input terminal to type into.
- [ ] A real macOS keyboard (Cmd/Option) for the UI cases — not a simulated/CI environment.

---

## Test Cases

### UAT-UI-001: Cmd+Backspace kills the line back to the start (readline unix-line-discard)
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal, Terminal tab, Direct Input active
- **Component**: `frontend/src/components/LogTail.tsx` (`mapKey()`, lines 60-61)
- **Description**: Before this fix, Cmd+Backspace fell into the unconditional `if (e.metaKey) return null` branch and was silently swallowed. It now maps to tmux `C-u`, which the shell's readline binds to `unix-line-discard` (kill everything before the cursor on the current line).
- **Steps**:
  1. Open an agent's detail modal for a live agent, activate Direct Input, and click into the terminal so it has real keyboard focus.
  2. Type `echo hello world` (do not press Enter).
  3. Press Cmd+Backspace.
- **Expected Result**: The entire typed line is cleared (empty prompt) — not just the last character, and not nothing (the pre-fix swallowed behavior).
- [SKIP: presumed working — not independently verified live, but implementation/behavior presumed correct per current code] <!-- 2026-09-18 -->

---

### UAT-UI-002: Option+Backspace deletes the word backward (readline unix-word-rubout)
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal, Terminal tab, Direct Input active
- **Component**: `frontend/src/components/LogTail.tsx` (`mapKey()`, lines 60-61)
- **Description**: Before this fix, Option+Backspace's Option modifier was silently dropped before reaching the `switch`, so it degraded to a plain single-character Backspace. It now maps to tmux `C-w`, which the shell's readline binds to `unix-word-rubout` (delete the word behind the cursor).
- **Steps**:
  1. Open an agent's detail modal for a live agent, activate Direct Input, and click into the terminal so it has real keyboard focus.
  2. Type `echo alpha beta gamma` (do not press Enter).
  3. Press Option+Backspace once.
- **Expected Result**: The line reads `echo alpha beta ` (only `gamma` removed, word-backward) — not `echo alpha beta gamm` (single-char delete, the pre-fix degraded behavior).
- [SKIP: presumed working — not independently verified live, but implementation/behavior presumed correct per current code] <!-- 2026-09-18 -->

---

### UAT-EDGE-001: mapKey() maps Cmd/Option+Backspace correctly and leaves plain/Shift-combined Backspace unaffected (regression)
- **Scenario**: `mapKey()`'s new Backspace branch must be scoped exactly to bare (no-Shift) Cmd+Backspace → `C-u` and bare Option+Backspace → `C-w`, evaluated before the pre-existing unconditional `metaKey → null` line. Plain Backspace (no modifiers) must remain `{ keys: ['BSpace'] }`, and combos excluded by the exclusive-modifier guards (Shift+Cmd+Backspace, Shift+Option+Backspace) must fall through unrouted rather than being misrouted to `C-u`/`C-w`.
- **Steps**: Covered directly by the `mapKey()` unit test suite (see Repeatable Unit Test below) — no live browser/tmux session required, since `mapKey()` is a pure function of a `KeyboardEvent`.
- **Expected Result**: `Backspace` + `metaKey` only → `{ keys: ['C-u'] }`; `Backspace` + `altKey` only → `{ keys: ['C-w'] }`; plain `Backspace` → `{ keys: ['BSpace'] }`; `Backspace` + `metaKey` + `shiftKey` → `null` (unchanged pre-existing `metaKey` fallthrough); `Backspace` + `altKey` + `shiftKey` → `{ keys: ['BSpace'] }` (unchanged pre-existing fallthrough, Option dropped as before this task).
- **Repeatable Unit Test**: Created: `frontend/src/components/LogTail.test.tsx` (`describe('mapKey (TASK-0165 Cmd/Option+Backspace)')`, lines 126-143 — 4 test cases, added during TASK-0165's implementation)
- **Unit Test Command**: `npx vitest run src/components/LogTail.test.tsx` (run from `frontend/`) — verified: 17/17 pass
- [x] Pass <!-- 2026-09-17 -->

---

### UAT-EDGE-002: No backend change needed — C-u/C-w are already allowlisted by TMUX_KEY_RE (regression guard)
- **Scenario**: TASK-0165 deliberately maps both combos to already-allowlisted Ctrl-letter tmux keys (`C-u`, `C-w`) rather than introducing new symbolic key names, specifically so no `host-server/index.ts` `TMUX_KEY_RE` change is required. This case locks in that `C-u`/`C-w` were already accepted before and after this task (no regex edit occurred).
- **Steps**: Covered directly by `host-server/tmuxKeyRe.test.ts` (pre-existing file from TASK-149, extended in place with one new literal assertion during this UAT's generation) — no live server required.
- **Expected Result**: `TMUX_KEY_RE.test('C-u')` and `TMUX_KEY_RE.test('C-w')` are both `true` (already covered by the pre-existing `C-[a-z]` alternative, unaffected by this task).
- **Repeatable Unit Test**: Created: `host-server/tmuxKeyRe.test.ts` (added one literal assertion for `C-u`/`C-w` to the pre-existing file from TASK-149, which previously only exercised the `C-[a-z]` class generically via `C-c`)
- **Unit Test Command**: `node --import tsx/esm --test tmuxKeyRe.test.ts` (run from `host-server/`) — verified: 5/5 pass
- [x] Pass <!-- 2026-09-17 -->

---

## Gaps

- No API-level curl test analogous to UAT-149's `UAT-API-001` — this task made no `host-server` change, so there is no new endpoint behavior to exercise end-to-end.
