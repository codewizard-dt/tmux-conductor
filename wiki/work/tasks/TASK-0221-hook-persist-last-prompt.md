---
id: TASK-0221
aliases: [TASK-0221]
title: "Persist the submitted prompt as last_prompt in the hook sidecar merge, with a hook test"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0219, TASK-0220]
blocks: []
parallel_safe_with: []
uat: "[[UAT-0221]]"
tags: [hooks, claude-code, sidecar, last-prompt, roadmap-0027]
---

# TASK-0221 — Persist the submitted prompt as last_prompt in the hook sidecar merge, with a hook test

relates_to::[[hook-authoritative-last-prompt]]
relates_to::[[last-user-message-capture]]
depends_on::[[TASK-0219]]
depends_on::[[TASK-0220]]

> **Roadmap**: ROADMAP-0027 Phase 2, item 1 (`wiki/work/roadmaps/ROADMAP-0027-last-user-payload-per-agent.md`). Research: `raw/research/last-user-message-capture/index.md`, `raw/research/terminal-typed-command-persistence/index.md`.
> **Collision note**: touches only `hooks/lib/write-state.js`, one new test file, `hooks/README.md` and one wiki page. No overlap with the `AgentList.tsx` / `host-server/index.ts` tasks in the same roadmap; the server-side read of `last_prompt` is a separate later item.

## Objective

Make the `UserPromptSubmit` hook remember what the user actually sent. `UserPromptSubmit`'s stdin payload carries the exact submitted text in a `prompt` field; `hooks/lib/write-state.js::writeState` already `JSON.parse`s the payload but its sidecar merge (the `if (payload) { ... }` block, ~line 91) keeps only `transcript_path`, `session_id`, `model` and `ts`. This task adds `last_prompt: { text, ts }` to that merge in `<stateDir>/<agent>.meta.json`, so the host-server (a later ROADMAP-0027 item) can read it and surface it as `lastPrompt` on the agent snapshot.

## Approach

- **Edit only the sidecar-merge block** of `writeState`. Function signature, agent-name resolution, stdin draining, state-file write, `hooks.jsonl` logging and the final `process.exit(0)` are untouched. The write stays inside the existing best-effort `try/catch` (never breaks the agent) and stays synchronous and tiny, because `UserPromptSubmit` blocks model start until the hook returns (30 s default timeout).
- **Rule**: `if (typeof payload.prompt === 'string' && payload.prompt.trim() !== '') meta.last_prompt = { text: capped(payload.prompt), ts: <same ISO string as meta.ts> }`. Only `UserPromptSubmit` carries `prompt`, so every other event (SessionStart, Stop, StopFailure, Notification) leaves an existing `last_prompt` untouched by construction (the merge starts from the previously read `meta`). Empty, whitespace-only, missing or non-string prompts never overwrite.
- **Cap**: use the length cap and secret-handling rules recorded by TASK-0220 (its findings note is authoritative). Default if TASK-0220 records none: cap `text` at 2000 characters, no redaction. Truncate without splitting a surrogate pair. Define the cap as a named constant at the top of `write-state.js`.
- **Slash commands (settled by TASK-0219, Claude Code 2.1.278)**: custom slash commands fire BOTH `UserPromptExpansion` and `UserPromptSubmit`; `prompt` is the raw typed `/name args` in both, so `UserPromptSubmit` alone is enough and NO `UserPromptExpansion` registration is needed. Built-in commands (`/clear`, `/context`) fire neither, so `last_prompt` is intentionally not updated by them. Record this in the task's Notes; do not add a registration.
- **Paste wrapper (TASK-0219 finding — required)**: a real bracketed paste reaches the hook wrapped as `"\n\n<pasted_content id=\"N\">\n…\n</pasted_content id=\"N\">\n"`, not as the pasted text. Before capping and storing, unwrap it: remove the opening `<pasted_content id="…">` and closing `</pasted_content id="…">` tag lines (keep the inner text verbatim; keep any typed text around the wrapper), then strip leading/trailing blank lines. Do this in one small pure helper in `write-state.js` (`normalizePrompt`), applied BEFORE the empty-check and the cap, so the first-line display is never blank or a bare tag. Other findings to respect: typed text, whitespace, emoji and non-ASCII round-trip verbatim; there is no upstream truncation (the cap is ours to apply); an embedded newline typed via `send-keys -l` arrives as a real `\n`; the payload also carries a new `prompt_id` field (may be stored as `last_prompt.prompt_id` if cheap, not required).
- **Test placement**: no hook has a test today (`hooks/` has no test file; the repo's only Node test runner is `host-server`'s `node --import tsx/esm --test`). Put the test in `host-server/hookLastPrompt.test.ts` so the existing runner picks it up; it spawns the real scripts (`node hooks/on-prompt-submit.js`, `node hooks/on-stop.js`) with a temp `CONDUCTOR_STATE_DIR` / `CONDUCTOR_LOG_DIR` under `./tmp/` and feeds JSON on stdin, so it exercises the actual `writeState` path, not a copy.

## Steps

### 1. Sidecar merge: persist last_prompt  <!-- agent: general-purpose -->

- [x] Read TASK-0220's recorded storage rules (length cap, secret handling) and TASK-0219's findings (payload shape, slash-command behavior). Verify with Serena `find_symbol` (`writeState`, `hooks/lib/write-state.js`, `include_body=true`) that the sidecar merge block is still the `if (payload) { ... }` section; line numbers drift because other agents edit this repo.
- [x] `hooks/lib/write-state.js`: add a `LAST_PROMPT_MAX_CHARS` constant (value from TASK-0220, default 2000) and, inside the existing sidecar `try` after the `payload.model` line and before `meta.ts = ...`, set `meta.last_prompt = { text, ts }` per the rule above. Compute `ts` once (`const now = new Date().toISOString()`) and reuse it for `meta.ts` so both agree. Do not change the `writeState(value, event)` signature; do not touch the other hook scripts.
- [x] Confirm exit-0 behaviour is preserved: a corrupt existing `meta.json`, a non-JSON stdin, or an unwritable state dir must still end in `process.exit(0)`.

### 2. Hook test  <!-- agent: general-purpose -->

- [x] Create `host-server/hookLastPrompt.test.ts` (`node:test` + `node:assert/strict`, style of `host-server/context.test.ts`). Helper `runHook(script, payload | rawStdin, env)` uses `child_process.spawnSync(process.execPath, [<repo>/hooks/<script>], { input, env: { ...process.env, CONDUCTOR_AGENT_NAME: 'test-agent', CONDUCTOR_STATE_DIR, CONDUCTOR_LOG_DIR }, encoding: 'utf8' })` with `TMUX` deleted from the env, and a per-test temp dir created under `./tmp/` (repo-local, never `/tmp` or `mktemp`) and removed in `after`.
- [x] Cases: (a) `on-prompt-submit.js` with `{ prompt: 'hello', session_id, transcript_path }` writes `meta.last_prompt.text === 'hello'`, an ISO `ts`, keeps `session_id`/`transcript_path`, and the state file reads `busy`; (b) a multi-line prompt is stored verbatim; (c) a later prompt replaces an earlier one; (d) `on-stop.js` with a payload lacking `prompt` leaves an existing `last_prompt` byte-for-byte unchanged while still refreshing `meta.ts`; (e) empty string, whitespace-only, missing and non-string (`123`) prompts do not overwrite an existing `last_prompt` and do not create one; (f) a prompt longer than the cap is truncated to exactly the cap; (g) exit status is 0 for a corrupt pre-existing `meta.json` and for non-JSON stdin; (h) a paste-wrapped prompt (`"\n\n<pasted_content id=\"1\">\nline one\nline two\n</pasted_content id=\"1\">\n"`) is stored as `"line one\nline two"`, typed text before/after the wrapper is preserved, and a prompt that is only an empty wrapper does not overwrite; (i) emoji/non-ASCII text round-trips verbatim and a cut at the cap never splits a surrogate pair.
- [x] Run `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts`, then `npm run typecheck && npm run lint && npm test`. Own file: 19/19 pass, `tsc` reports 0 errors in `hookLastPrompt.test.ts`, eslint clean on it. Caveat: full `npm run typecheck` fails only in `agentDiff.test.ts` (2 errors, TASK-0222 in flight) and full `npm test` has 1 failure (`cache: unchanged file ...` in TASK-0222's `lastPrompt.test.ts`), both files this task did not touch. Not fixed here.

### 3. Docs  <!-- agent: general-purpose -->

- [x] `hooks/README.md`: in the `lib/write-state.js` responsibilities list (currently 4 items, ~line 48) add a 5th: persists `transcript_path` / `session_id` / `model` and, for `UserPromptSubmit`, `last_prompt: { text, ts }` into `<agent>.meta.json`; note the cap and that only non-empty string prompts overwrite. Add the note that the installed copy under `~/.claude/hooks/tmux-conductor/` only picks this up after a human re-runs `install-hooks.sh` and restarts the agents.
- [x] `wiki/knowledge/entities/components/claude-code-hooks.md`: rewrite the section `## The submitted prompt is parsed, then discarded (researched 2026-09-20)` (and its intro sentence about the sidecar keeping only `transcript_path`/`session_id`/`model`/`ts`, ~lines 16 and 33-35) so it says the prompt is now persisted as `last_prompt: { text, ts }`, keeping the `UserPromptSubmit` blocking/30 s caveat and the slash-command note. Retitle the heading accordingly. Preserve existing typed links; keep `relates_to::[[hook-authoritative-last-prompt]]`.
- [x] Do not edit `wiki/work/tasks/index.md`, `wiki/log.md`, `wiki/hot.md` or the roadmap file; the orchestrator owns those shared files.

## Files expected to be touched

- `hooks/lib/write-state.js`
- `host-server/hookLastPrompt.test.ts` (new)
- `hooks/README.md`
- `wiki/knowledge/entities/components/claude-code-hooks.md`

## Dependencies

- TASK-0219
- TASK-0220

TASK-0219 supplies the real `UserPromptSubmit` payload shapes (and whether slash commands fire the hook); TASK-0220 fixes the length cap and secret-handling rules. The server read of the sidecar (`lastPrompt` on the snapshot) is a later ROADMAP-0027 item that consumes this task's output.

## Notes

Guardrails for whoever implements this:

- **Never run `install-hooks.sh` against the real `~/.claude`, and never edit `~/.claude/settings.json`.** The installed copy under `~/.claude/hooks/tmux-conductor/` only updates when a human re-runs `install-hooks.sh` and restarts the agents; do not do that from an autonomous run. The repo copy in `hooks/` is the only thing this task edits.
- **Never kill or restart tmux windows or sessions, and never stop or restart the running host-server or dev servers.** The test must use a temp state dir under `./tmp/` and spawn the scripts directly with `spawnSync`; it must not touch the live fleet's `logs/state/`.
- **Live-fleet verification is a documented UAT step for a human, not something an autonomous agent performs.** The round trip (re-run installer, restart agents, type a prompt, see `last_prompt` in a real `<agent>.meta.json`) belongs to ROADMAP-0027 Phase 4.
- Stored prompts may contain secrets; follow the TASK-0220 rules and keep the sidecar readable only where it already is (no new locations, no extra logging of the prompt text into `hooks.jsonl`).
- TASK-0219 (done) showed custom slash commands DO fire `UserPromptSubmit` with the raw `/name args`, so no `UserPromptExpansion` registration is needed; built-ins like `/clear` fire neither event. Do not add a registration.

### Implementation notes (2026-09-20)

<!-- Updated: 2026-09-20 -->

- Decisions recorded autonomously: (1) `normalizePrompt` only touches prompts that contain `<pasted_content`; all other text is stored verbatim (TASK-0220 rule f: "otherwise not trimmed or normalised"), including trailing newlines/whitespace. The empty-check uses `.trim()` on the normalized text. (2) The unwrap regexes also accept a `<pasted_content>` tag without an `id` attribute. (3) `prompt_id` is stored as `last_prompt.prompt_id` when the payload has a non-empty string one (cheap; the server reader `host-server/lastPrompt.ts` ignores unknown keys). (4) `last_prompt.ts` and `meta.ts` share one `now` value. (5) Cap: `LAST_PROMPT_MAX_CHARS = 2000` (1999 + one `…`; a dangling high surrogate at the cut is dropped, giving 1998 + `…`).
- Slash commands (TASK-0219, Claude Code 2.1.278): custom slash commands fire both `UserPromptExpansion` and `UserPromptSubmit` with the raw `/name args` as `prompt`, so `UserPromptSubmit` alone suffices; no `UserPromptExpansion` registration added. Built-ins (`/clear`, `/context`) fire neither, so `last_prompt` is intentionally unchanged by them.
- Static gates: `host-server/hookLastPrompt.test.ts` 19/19 pass; `tsc` and eslint clean for it. Full `npm run typecheck` currently fails only in `agentDiff.test.ts` and full `npm test` has one failure in `lastPrompt.test.ts` (both TASK-0222, in flight, not touched here). `hooks/` is outside the host-server eslint base path, so `write-state.js` is covered by the test only (no lint).
- Deferred to human UAT / ROADMAP-0027 Phase 4: re-running `install-hooks.sh` and restarting agents so the installed copy picks up the change; typing a prompt in a live agent and seeing `last_prompt` in a real `<agent>.meta.json`.
