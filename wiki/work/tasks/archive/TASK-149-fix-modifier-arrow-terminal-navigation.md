---
id: TASK-149
aliases: [TASK-149]
title: "Fix Cmd/Ctrl/Option+Arrow cursor navigation in the Direct Input terminal"
status: done
created: 2026-09-13
updated: 2026-09-18
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-149]]"
tags: [frontend, backend, keyboard-shortcuts, direct-input, terminal]
---

# TASK-149 — Fix Cmd/Ctrl/Option+Arrow cursor navigation in the Direct Input terminal

relates_to::[[TASK-141]]

## Objective

Cmd+Arrow, Ctrl+Arrow, and Option+Arrow currently do nothing when pressed in the dashboard's Direct Input terminal (`LogTail.tsx`). `mapKey()` unconditionally returns `null` for any `metaKey` (Cmd) chord and for any `ctrlKey` chord that isn't a bare letter, so both modifiers drop all arrow keys; separately, the arrow-key `switch` case isn't `altKey`-aware, so Option+Arrow silently degrades to a plain one-character arrow instead of word-jumping. Because the capture target is a plain non-editable `<div>` (not an `<input>`/`<textarea>`), there is no browser fallback for the dropped keystroke — it is simply swallowed with zero visible effect. This task makes all three modifier+arrow combinations do something useful, matching the macOS Terminal.app/iTerm2 conventions: Ctrl+Arrow → word-jump (generic convention), Cmd+Arrow → start/end of line, Option+Arrow → word-jump (macOS-native convention). See `raw/research/terminal-modifier-arrow-navigation/index.md` for the full root-cause analysis.

This directly unblocks `TASK-141`'s `UAT-141` (`UAT-UI-002`), which assumed Cmd+Left/Right would "just work" as terminal cursor navigation once the modal-level agent-switch shortcut was moved off it — that assumption does not hold without this fix.

**Note on a since-changed detail**: `TASK-141`'s own file and this research's initial wiki writeup describe the agent-switch shortcut as `Ctrl+Alt+Arrow`. As of this task's creation, `frontend/src/components/AgentList.tsx` (~line 579) has since been changed to `e.metaKey && e.shiftKey` (**Shift+Cmd+Arrow**), not `Ctrl+Alt+Arrow` — re-verify the actual current condition in that file at execution time rather than trusting either prior description. This does not change this task's own scope (bare, non-Shift Cmd+Arrow and bare Ctrl+Arrow are still untouched by agent-switching either way), but the Manual Verification step below must check against whatever shortcut is live at that time.

## Approach

Two independent layers currently agree with each other by both dropping these keys, and both must change together or the fix is incomplete (frontend sends a key name the server rejects, or the frontend never constructs it):

1. **`frontend/src/components/LogTail.tsx`'s `mapKey()`**: add explicit arrow-key handling, checked *before* today's unconditional `metaKey`/`ctrlKey` short-circuits, so it doesn't get shadowed by them:
   - `Ctrl+ArrowLeft/Right` → `{ keys: ['C-Left'] }` / `{ keys: ['C-Right'] }`
   - `Cmd+ArrowLeft/Right` → `{ keys: ['Home'] }` / `{ keys: ['End'] }`
   - `Option(Alt)+ArrowLeft/Right` → `{ keys: ['M-Left'] }` / `{ keys: ['M-Right'] }`
   - Everything else under `metaKey`/`ctrlKey` (including Ctrl+Up/Down, Cmd+Up/Down, and all non-arrow chords) keeps today's exact behavior — no change to `Cmd+R`, `Cmd+W`, `C-c`, `C-a`, `C-w`, `C-u`, `M-b`, `M-f`, etc.
2. **`host-server/index.ts`'s `TMUX_KEY_RE`**: add `C-(Left|Right|Up|Down)` and `M-(Left|Right|Up|Down)` as additional alternatives to the existing allowlist regex, so the new key names aren't silently rejected by the `/agents/:agent/keys` endpoint. tmux already delivers the correct standard escape sequences for these names (`\e[1;5D/C` for `C-Left/Right`, `\e[1;3D/C` for `M-Left/Right`) — this was independently measured against a live tmux 3.6a server in prior research (`wiki/knowledge/concepts/tmux-send-keys-key-names.md`), so no further tmux-side verification is needed, only the regex change.
3. Word-jump landing correctly still depends on the pane's shell (bash/zsh readline) having the default CSI `;5C`/`;5D`/`;3C`/`;3D` bindings — this is standard out of the box and outside this repo's control; do not add any shell configuration as part of this task.

## Steps

### 1. Extend `mapKey()` in `LogTail.tsx`  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/LogTail.tsx`, locate `mapKey()` (currently ~lines 36-58).
- [x] Before the existing `if (e.metaKey) return null` line, add a check that handles `e.key === 'ArrowLeft' || e.key === 'ArrowRight'` combined with `e.ctrlKey`, `e.metaKey`, or `e.altKey`:
  - `e.ctrlKey && !e.metaKey && !e.altKey` and `e.key === 'ArrowLeft'` → `{ keys: ['C-Left'] }`; `'ArrowRight'` → `{ keys: ['C-Right'] }`
  - `e.metaKey && !e.ctrlKey && !e.altKey` and `e.key === 'ArrowLeft'` → `{ keys: ['Home'] }`; `'ArrowRight'` → `{ keys: ['End'] }`
  - `e.altKey && !e.metaKey && !e.ctrlKey` and `e.key === 'ArrowLeft'` → `{ keys: ['M-Left'] }`; `'ArrowRight'` → `{ keys: ['M-Right'] }`
  - Any other modifier combination on an arrow key (e.g. `Shift+Cmd+Arrow`, `Ctrl+Alt+Arrow`, `Shift+Arrow`, or an arrow with more than one of `ctrlKey`/`metaKey`/`altKey` held) falls through to the existing logic unchanged (do not add new behavior for combinations not listed above) — this matters because the exact combo `AgentList.tsx` currently reserves for agent-switching (verify which one is live at execution time; see the note above) must keep reaching that handler undisturbed, not get intercepted here.
- [x] Confirm the existing `metaKey → null` and `ctrlKey → letter-only` branches are unreached for the three combinations above (i.e. the new check runs first) but otherwise untouched — every other `Cmd+*`/`Ctrl+*` chord (e.g. `Cmd+R`, `C-c`, `C-a`, `C-w`, `C-u`) must produce byte-identical output to before this change.
- [x] Do not add `ArrowUp`/`ArrowDown` handling for any of these three modifiers — leave those falling through to today's behavior (bare `Up`/`Down` under no modifier, `null` under `metaKey`, `null` under non-letter `ctrlKey`).
- [x] Run `cd frontend && npx tsc --noEmit` to confirm no type errors.

### 2. Extend `TMUX_KEY_RE` in `host-server/index.ts`  <!-- agent: general-purpose -->

- [x] In `host-server/index.ts`, locate `TMUX_KEY_RE` (currently ~line 73):
  ```
  const TMUX_KEY_RE = /^(Enter|Escape|Tab|BTab|Space|BSpace|DC|IC|Up|Down|Left|Right|Home|End|PPage|NPage|F([1-9]|1[0-2])|C-[a-z]|M-[A-Za-z])$/;
  ```
- [x] Add `C-(Left|Right|Up|Down)` and `M-(Left|Right|Up|Down)` as additional alternatives in the regex, e.g.:
  ```
  const TMUX_KEY_RE = /^(Enter|Escape|Tab|BTab|Space|BSpace|DC|IC|Up|Down|Left|Right|Home|End|PPage|NPage|F([1-9]|1[0-2])|C-[a-z]|M-[A-Za-z]|C-(Left|Right|Up|Down)|M-(Left|Right|Up|Down))$/;
  ```
- [x] Update the comment immediately above `TMUX_KEY_RE` if it enumerates the permitted shapes, so it stays accurate. (Comment does not enumerate shapes — no change needed.)
- [x] Run `cd host-server && npx tsc --noEmit` (or the repo's equivalent host-server typecheck command) to confirm no type errors.

### 3. Add regression tests for the new `mapKey()` behavior  <!-- agent: general-purpose -->

- [x] Check whether `LogTail.tsx` has an existing test file (`mcp__serena__find_file` for `LogTail.test.tsx` under `frontend/src/components/`). If `mapKey()` is not exported, either export it for testing or test it indirectly by dispatching `keydown` events on the rendered capture `<div>` and asserting the resulting `sendAgentKeys`/`enqueue` call payload (mirror whatever pattern `AgentList.test.tsx` already uses for its own keydown assertions). (Existing file found; `mapKey` exported and tested directly.)
- [x] Add test cases asserting:
  - `Ctrl+ArrowLeft`/`Ctrl+ArrowRight` (no other modifiers) → `{ keys: ['C-Left'] }` / `{ keys: ['C-Right'] }`
  - `Cmd(meta)+ArrowLeft`/`Cmd+ArrowRight` (no other modifiers) → `{ keys: ['Home'] }` / `{ keys: ['End'] }`
  - `Alt(option)+ArrowLeft`/`Alt+ArrowRight` (no other modifiers) → `{ keys: ['M-Left'] }` / `{ keys: ['M-Right'] }`
  - A regression guard that plain `Cmd+R`-style chords (`metaKey` with a non-arrow key) and plain `Ctrl+c`-style chords (`ctrlKey` with a letter) still produce their pre-existing output (`null` for the former, `{ keys: ['C-c'] }` for the latter) — this guards against the new arrow-specific branch accidentally widening scope.
  - A regression guard that whatever combo `AgentList.tsx` currently reserves for agent-switching (check the live condition — see the note under Objective) is NOT altered by this change: an arrow keydown carrying that exact modifier combination must still fall through to `mapKey()`'s pre-existing (non-arrow-specific) behavior, not the new branches added here.
- [x] Add a corresponding test (or extend an existing host-server test file, if `TMUX_KEY_RE` has one — check via `mcp__serena__find_file`) asserting `TMUX_KEY_RE.test('C-Left')`, `.test('C-Right')`, `.test('M-Left')`, `.test('M-Right')` are all `true`, and that a few adjacent invalid strings (e.g. `'C-Delete'`, `'S-Left'`) remain `false` (regression guard against the allowlist becoming too permissive). (No existing file; `host-server/index.ts` boots the Fastify server as an import-time side effect so it can't be imported directly from a test — added `host-server/tmuxKeyRe.test.ts` using `node:test`, following the established static-source-assertion precedent from `perfBudgets.test.ts`/`sseRolePayloadParity.test.ts`/`rolePresets.test.ts`: it extracts the live `TMUX_KEY_RE` literal straight out of `index.ts`'s source text and reconstructs a real `RegExp` from it, so the assertions always exercise the actual current pattern instead of a hand-copied one that could drift.)
- [x] Run the full frontend and host-server test suites and confirm they pass. (Frontend: `npx vitest run` — 128/128 pass. Host-server: `npm test` — 141/144 pass; the 3 failures are in `db.migration.test.ts`, pre-existing/unrelated to this task — that file and `db.ts` carry substantial uncommitted WIP from a different, concurrently in-progress task (93/39 lines changed, untouched by this task), confirmed via `git diff --stat`. All TASK-149 tests, including the new `mapKey` and `TMUX_KEY_RE` regression tests, pass.)

### 4. Manual verification  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Start the dev servers (`make dev`), open an agent's detail modal, activate Direct Input, click into the terminal, type some text, then:
  - Press Ctrl+Left/Right and confirm the shell's cursor jumps by word (readline `forward-word`/`backward-word`).
  - Press Cmd+Left/Right and confirm the shell's cursor jumps to the start/end of the line.
  - Press Option+Left/Right and confirm the shell's cursor jumps by word.
  - Confirm none of these three combinations trigger the modal's current agent-switch shortcut (check `AgentList.tsx` for the live combo — described as `Ctrl+Alt+Arrow` in `TASK-141` but observed as `Shift+Cmd+Arrow` at the time this task was written; verify fresh), and confirm that shortcut still switches agents as before.
- [DEFERRED-TO-UAT] Confirm `UAT-141`'s `UAT-UI-002` now passes as originally written (Cmd+Left moves the terminal's own cursor to the start of the line).

## Notes

- Both `mapKey()` (frontend) and `TMUX_KEY_RE` (backend) must be extended together — the two-file coupling is intentional and already documented as a hazard in `wiki/knowledge/concepts/tmux-send-keys-key-names.md` (`TMUX_KEY_RE` is the only thing standing between a typo and garbage text being typed into a live agent's prompt; never widen it to a broad pattern, only an explicit enumeration).
- Once this lands, revisit `UAT-141`'s `UAT-UI-002` (currently unchecked) — it should be walkable and expected to pass.
- The agent-switch shortcut in `AgentList.tsx` changed at least once today (`Ctrl+Alt+Arrow` per `TASK-141` → `Shift+Cmd+Arrow` observed live) — this task's own execution should re-check the current condition rather than trusting either historical description, including this one.
