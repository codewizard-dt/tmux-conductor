---
id: UAT-0221
aliases: [UAT-0221]
title: "UAT: Persist the submitted prompt as last_prompt in the hook sidecar merge"
status: pending
task: TASK-0221
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0221 — UAT: Persist the submitted prompt as last_prompt in the hook sidecar merge

implements::[[TASK-0221]]

> **Source task**: [[TASK-0221]]
> **Generated**: 2026-09-20

---

## Prerequisites

- [ ] Repo checkout at the tmux-conductor root; Node.js >= 18 and `host-server/node_modules` installed (the runner is `node --import tsx/esm --test`).
- [ ] **Safety**: none of these cases touch the live fleet. Do NOT run `install-hooks.sh` against the real `~/.claude`, do NOT edit `~/.claude/settings.json`, and do NOT kill/restart tmux windows or the running host-server/dev servers. The unit-backed cases spawn the real repo scripts (`hooks/on-prompt-submit.js`, `hooks/on-stop.js`, `hooks/on-session-start.js`, `hooks/on-stop-failure.js`) with a per-case temp `CONDUCTOR_STATE_DIR`/`CONDUCTOR_LOG_DIR` under `./tmp/` (removed in `after`), so they exercise the actual `writeState` path.
- [ ] Verification-scope caveat: a concurrent in-flight task (TASK-0222) may leave the full host-server `npm run typecheck` / `npm test` transiently red in ITS files (`agentDiff.test.ts`, `lastPrompt.test.ts`). Every command below is scoped to files belonging to TASK-0221. A red full-suite result in those TASK-0222 files is not a TASK-0221 failure.

Source under test:
- `hooks/lib/write-state.js`: `LAST_PROMPT_MAX_CHARS = 2000`, `normalizePrompt` (paste-wrapper unwrap, only when the prompt contains `<pasted_content`), `capPrompt` (cap-1 chars plus one `…`, drops a dangling high surrogate), and the `if (payload) { ... }` sidecar merge in `writeState(value, event)` that sets `meta.last_prompt = { text, ts[, prompt_id] }` only for a non-empty string prompt and reuses one `now` for `meta.ts` and `last_prompt.ts`.
- `hooks/on-prompt-submit.js` (`writeState('busy', 'prompt-submit')`), `hooks/on-stop.js`, `hooks/on-session-start.js`, `hooks/on-stop-failure.js` (unchanged; they only call `writeState`).
- `host-server/hookLastPrompt.test.ts` (22 `node:test` cases, sibling layout of the host-server runner; there is no hooks-side test runner, and the repo's sibling layout outranks the legacy `uatGenerate.promoteTests` value).

Coverage note: every EDGE case is unit-backed by the same file-scoped command; the test names that back each case are listed under it. DOC cases are static checks. MAN cases are manual/documented. The live human round trip is `UAT-MAN-003` and is `[DEFERRED-TO-UAT manual]`: an autonomous run must NOT perform it.

---

## Test Cases

### UAT-EDGE-001: A normal prompt writes last_prompt {text, ts}, keeps session fields, and the state stays busy
- **Scenario**: `on-prompt-submit.js` receives `{ prompt: 'hello', session_id: 's1', transcript_path: '/t/s1.jsonl' }`.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `on-prompt-submit stores prompt text and ts, keeps session fields, writes busy`.
- **Expected Result**: `<agent>.meta.json` has `last_prompt.text === 'hello'` and an ISO-8601 `last_prompt.ts` equal to `meta.ts`; `session_id` and `transcript_path` are preserved; `<agent>.state` reads `busy`. Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: prompt_id is stored as last_prompt.prompt_id when the payload has one
- **Scenario**: the payload carries a non-empty string `prompt_id` (a TASK-0219 finding).
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `prompt_id is stored when present`.
- **Expected Result**: `last_prompt.prompt_id === 'pid-123'` for a payload with `prompt_id: 'pid-123'`. Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: A multi-line prompt is stored verbatim
- **Scenario**: the prompt contains real `\n` newlines, a blank line, indentation and a tab (an embedded newline typed via `send-keys -l` arrives as a real `\n`).
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `multi-line prompt is stored verbatim`.
- **Expected Result**: `last_prompt.text` is byte-identical to `'line one\nline two\n\n    indented line four\ttab'`: no trimming, no newline collapsing. Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: A later prompt replaces an earlier one
- **Scenario**: two consecutive `UserPromptSubmit` events, `first` then `second`.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `a later prompt replaces an earlier one`.
- **Expected Result**: after both events `last_prompt.text === 'second'` (only the most recent prompt is kept, no history). Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-005: Other events leave last_prompt untouched
- **Scenario**: after a stored prompt, `on-stop.js`, `on-session-start.js` and `on-stop-failure.js` run with payloads that have no `prompt` (only `UserPromptSubmit` carries it).
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing tests `on-stop without a prompt leaves last_prompt unchanged but refreshes meta.ts` and `session-start and stop-failure events leave last_prompt unchanged`.
- **Expected Result**: `JSON.stringify(meta.last_prompt)` is byte-for-byte identical before and after each of the three events, every hook exits 0, and for `on-stop.js` `meta.ts` is still refreshed and the state file reads `idle`. Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-006: Empty, whitespace-only, missing and non-string prompts never overwrite or create last_prompt
- **Scenario**: `UserPromptSubmit` payloads whose `prompt` is `''`, `'   \n\t '`, `123`, `null`, or absent, on a fresh sidecar and on one that already holds `'real prompt'`.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `empty, whitespace-only, missing and non-string prompts never overwrite`.
- **Expected Result**: on a fresh sidecar `last_prompt` stays `undefined` for every bad value; on a populated sidecar `last_prompt` is byte-for-byte unchanged after each bad value. Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-007: The 2000-character cap keeps 1999 characters plus one ellipsis; a prompt of exactly the cap is untouched
- **Scenario**: a 2500-character prompt, and a prompt of exactly 2000 characters (`LAST_PROMPT_MAX_CHARS`, TASK-0220 rule b).
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing tests `a prompt longer than the cap is truncated to exactly the cap with one marker` and `a prompt of exactly the cap is stored untouched`.
- **Expected Result**: the 2500-char prompt is stored as exactly `'x'.repeat(1999) + '…'` (length 2000, one marker); the exactly-2000-char prompt is stored unchanged with no marker. Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-008: The cap never splits a surrogate pair
- **Scenario**: an emoji straddles the cut point (indices 1998-1999), and another fits entirely before the marker (indices 1997-1998).
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing tests `a cut that lands inside a surrogate pair drops the dangling high surrogate` and `a surrogate pair that fits entirely before the marker is kept whole`.
- **Expected Result**: the straddling case stores `'a'.repeat(1998) + '…'` (dangling high surrogate dropped, no lone surrogate); the fitting case stores `'a'.repeat(1997) + '😀' + '…'` (length 2000, emoji whole). Neither result contains a lone surrogate. Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-009: The real bracketed-paste wrapper (TASK-0219 finding) is unwrapped before the empty-check and the cap
- **Scenario**: a paste reaches the hook as `"\n\n<pasted_content id=\"N\">\n…\n</pasted_content id=\"N\">\n"`, including the real TASK-0219 payload (id `8822`, an indented line and an inner blank line), typed text around the wrapper, an empty wrapper, and an oversized paste.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing tests `paste-wrapped prompt is unwrapped to the inner text`, `real TASK-0219 paste payload (indent and blank line inside) round-trips its inner text`, `typed text before and after a paste wrapper is preserved`, `a prompt that is only an empty paste wrapper does not overwrite` and `a paste wrapper is unwrapped before the cap is applied`.
- **Expected Result**: `last_prompt.text` is `'line one\nline two'` for the simple wrapper; `'paste line one\npaste line two\n\n    paste indented line four'` for the real payload (inner blank line and indent kept verbatim); `'please review:\n\ndiff body\nthanks'` with typed text kept; an empty wrapper leaves the previous `last_prompt` unchanged; a 2500-char paste is stored as `'z'.repeat(1999) + '…'` (no bare tag or blank first line). Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-010: Emoji, non-ASCII and shell-special characters round-trip verbatim
- **Scenario**: a prompt with quotes, backticks, `$VAR`, a backslash, an emoji, accented Latin and CJK text.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `emoji and non-ASCII text round-trip verbatim`.
- **Expected Result**: `last_prompt.text` is identical to the input string. Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-011: Exit 0 with a corrupt pre-existing meta.json
- **Scenario**: `<agent>.meta.json` already exists containing `{not json`.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `exit status is 0 for a corrupt pre-existing meta.json`.
- **Expected Result**: the hook exits 0, `<agent>.state` reads `busy`, and the sidecar is rebuilt from `{}` with `last_prompt.text === 'after corrupt'`. Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-012: Exit 0 with non-JSON stdin
- **Scenario**: the hook's stdin is `this is not json`.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `exit status is 0 for non-JSON stdin and no sidecar is written`.
- **Expected Result**: the hook exits 0, the state file still reads `busy`, and no `<agent>.meta.json` is created. Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-013: Exit 0 when the state dir is unwritable
- **Scenario**: `CONDUCTOR_STATE_DIR` points at a path that is a regular file, so `mkdirSync` fails.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `exit status is 0 when the state dir is unwritable`.
- **Expected Result**: the hook exits 0 (never breaks the agent) even though nothing can be written. Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-014: The prompt text (and prompt_id) is never written to hooks.jsonl
- **Scenario**: a prompt containing a marker string is submitted; the transition log is then read (TASK-0221 Notes: no extra logging of prompt text into `hooks.jsonl`).
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `the prompt text is never written to hooks.jsonl`.
- **Expected Result**: `hooks.jsonl` has a transition record but contains neither the prompt marker text nor the `prompt_id`. Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-015: A custom slash command is stored as the raw typed `/name args`
- **Scenario**: TASK-0219 (Claude Code 2.1.278) showed custom slash commands fire `UserPromptSubmit` with `prompt` set to the raw `/name args`; a payload of that shape must be stored like any other prompt.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `a custom slash command prompt is stored as the raw typed text`.
- **Expected Result**: `last_prompt.text === '/review-pr 123 --strict'`. Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/hookLastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-DOC-001: hooks/README.md and the wiki entity describe last_prompt, the cap, and the re-install caveat
- **Scenario**: TASK-0221 Step 3 documentation deliverables.
- **Steps**:
  1. Run the command below and read the matches.
  2. Run the second command against the wiki entity page.
- **Command**:
  ```bash
  grep -n 'last_prompt\|re-runs `install-hooks.sh`\|2000' hooks/README.md
  ```
  ```bash
  grep -n 'last_prompt\|## The submitted prompt is persisted' wiki/knowledge/entities/components/claude-code-hooks.md
  ```
- **Expected Result**: `hooks/README.md` lists a responsibility that persists `last_prompt: { text, ts }` into `<agent>.meta.json` and states the cap (2000), that only non-empty string prompts overwrite, and that the installed copy under `~/.claude/hooks/tmux-conductor/` only picks this up after a human re-runs `install-hooks.sh` and restarts agents. The wiki page has a section titled `## The submitted prompt is persisted as \`last_prompt\`` (not the old "parsed, then discarded" heading) and its intro sentence mentions `last_prompt: { text, ts }`, while keeping `relates_to::[[hook-authoritative-last-prompt]]`.
- **Repeatable Unit Test**: Not applicable: documentation content check, not deterministic runtime logic
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-DOC-002: No UserPromptExpansion registration was added, and the other hook scripts and installer are untouched
- **Scenario**: TASK-0219/0221 settled that `UserPromptSubmit` alone is enough for slash commands; TASK-0221 edits only `hooks/lib/write-state.js` (plus README/test/wiki) and must not change the other hook scripts or registrations.
- **Steps**:
  1. Run the first command below.
  2. Run the second command below.
- **Command**:
  ```bash
  grep -rn 'UserPromptExpansion' hooks/register-hooks.jq hooks/register-codex-hooks.jq hooks/on-prompt-submit.js install-hooks.sh
  ```
  ```bash
  git status --short hooks/ install-hooks.sh
  ```
- **Expected Result**: the `grep` prints nothing (exit 1: no match). `git status` lists only `hooks/README.md` and `hooks/lib/write-state.js` as modified among tracked hook files (no `on-*.js`, no `*.jq`, no `install-hooks.sh`). If another concurrent task has since touched a listed file, judge by `git diff -- <file>` that the change is not part of TASK-0221 rather than failing this case.
- **Repeatable Unit Test**: Not applicable: repo-state/registration check, not runtime logic
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-001: TASK-0221's own files pass the file-scoped static gates
- **Scenario**: `npm run typecheck` / `npm test` over the whole host-server may be transiently red in TASK-0222's files (`agentDiff.test.ts`, `lastPrompt.test.ts`); the gates are therefore scoped to the TASK-0221 test file (`write-state.js` is outside the host-server eslint base path and is covered by the test run only).
- **Steps**:
  1. Run the first command below (expect no output).
  2. Run the second command below (expect exit 0, no findings).
- **Command**:
  ```bash
  cd host-server && npx tsc --noEmit 2>&1 | grep 'hookLastPrompt.test.ts'
  ```
  ```bash
  cd host-server && npx eslint hookLastPrompt.test.ts
  ```
- **Expected Result**: the `tsc | grep` prints nothing (no type error attributed to `hookLastPrompt.test.ts`; errors in other files are out of scope and are recorded, not failed), and `eslint` exits 0 with no output.
- **Repeatable Unit Test**: Not applicable: this case IS the static gate for the unit test file
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-MAN-001: Built-in slash commands do not update last_prompt (documented from TASK-0219)
- **Scenario**: built-ins such as `/clear` and `/context` fire neither `UserPromptExpansion` nor `UserPromptSubmit` (observed in TASK-0219, Claude Code 2.1.278), so by construction they never reach `writeState` and `last_prompt` is intentionally unchanged. This is documented behavior of Claude Code, not something the repo's code can assert; it is judged from the recorded findings and the docs, not live.
- **Steps**:
  1. Confirm TASK-0221's Notes (Implementation notes, "Slash commands") and `hooks/README.md` both state that built-ins fire no prompt hook and never update `last_prompt`:
     ```bash
     grep -n 'Built-ins' wiki/work/tasks/TASK-0221-hook-persist-last-prompt.md hooks/README.md
     ```
  2. Confirm the TASK-0219 findings the claim rests on are recorded (payload dump, `/clear` and `/context` firing neither event) in `wiki/work/tasks/TASK-0219-*.md` or its research note.
- **Expected Result**: both documents state the built-in behavior consistently with the TASK-0219 findings, and the code has no special handling (no `UserPromptExpansion` registration, per `UAT-DOC-002`). No prompt-hook fire is expected for `/clear`/`/context`.
- **Repeatable Unit Test**: Not applicable: describes Claude Code's own behavior for commands that never invoke the hook; there is no code path in this repo to unit-test
- [FAIL: auto-judge: manual test requires human verification (documented-behavior check, no machine oracle)] <!-- 2026-09-20 -->

---

### UAT-MAN-002: Only the sidecar-merge block changed in write-state.js; signature, logging and exit behavior are intact
- **Scenario**: TASK-0221 Approach: "Edit only the sidecar-merge block". Guard against scope creep in a load-bearing shared helper.
- **Steps**:
  1. Read `hooks/lib/write-state.js`. Confirm `writeState(value, event)` is unchanged in signature, agent-name resolution, stdin draining, state-file write, `hooks.jsonl` record fields (`ts`, `agent`, `event`, `prev_state`, `new_state` only) and the final `process.exit(0)`.
  2. Confirm the additions are limited to `LAST_PROMPT_MAX_CHARS`, `PASTE_OPEN_TAG`, `PASTE_CLOSE_TAG`, `normalizePrompt`, `capPrompt`, the shared `const now = new Date().toISOString()` and the `last_prompt` block inside the existing sidecar `try`.
  3. Confirm `git diff -- hooks/lib/write-state.js` shows no other behavior change.
- **Expected Result**: the diff is confined to the items listed in step 2; the sidecar write is still inside the best-effort `try/catch`, synchronous and tiny (no network, no child process, no async).
- **Repeatable Unit Test**: Not applicable: code-review/scope check; the behavior it protects is covered by UAT-EDGE-011 to UAT-EDGE-013
- [FAIL: auto-judge: manual test requires human verification (code-review/scope check, no machine oracle)] <!-- 2026-09-20 -->

---

### UAT-MAN-003: [DEFERRED-TO-UAT manual] Live round trip on a real agent
- **Scenario**: **DEFERRED-TO-UAT manual. A human performs this; an autonomous agent must NOT run it (it re-installs the real hooks and restarts live agents, which the task guardrails forbid).** It belongs to ROADMAP-0027 Phase 4 and is recorded here so the installed copy is proven to pick up the change.
- **Steps**:
  1. Human re-runs `./install-hooks.sh` so `~/.claude/hooks/tmux-conductor/lib/write-state.js` is refreshed (the installed copy does not update on its own).
  2. Human restarts the agent(s) they want to check (hooks are loaded at session start).
  3. In a live agent's Claude Code session, type a distinctive message (for example `uat-0221 round trip`), then a second one that includes a newline and an emoji.
  4. Inspect the agent's real sidecar: `jq .last_prompt logs/state/<agent>.meta.json`.
  5. In the same session run a built-in such as `/context` and confirm `last_prompt` is unchanged.
  6. Check `logs/hooks.jsonl` has the new transition record but not the message text: `grep -c 'uat-0221 round trip' logs/hooks.jsonl` should print `0`.
- **Expected Result**: `last_prompt` is `{ "text": "<the last message typed>", "ts": "<ISO>" }` (plus `prompt_id` when Claude Code sends one), replacing the earlier message; the built-in command leaves it unchanged; the typed text does not appear in `hooks.jsonl`.
- **Repeatable Unit Test**: Not applicable: requires the real installed hooks, a live Claude Code session and a human at the terminal (all behavior of the script itself is covered by UAT-EDGE-001 to UAT-EDGE-015)
- [FAIL: auto-judge: DEFERRED-TO-UAT manual, live round trip requires a human, re-installed real hooks and a live Claude Code session] <!-- 2026-09-20 -->

