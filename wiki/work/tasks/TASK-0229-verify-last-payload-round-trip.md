---
id: TASK-0229
aliases: [TASK-0229]
title: "Verify the last-payload round trip: hermetic hook and suite script, plus a human live recipe (install-hooks, restart, type, Enter, reload)"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0221, TASK-0222, TASK-0223, TASK-0226, TASK-0227, TASK-0228]
blocks: []
parallel_safe_with: []
uat: ""
tags: [hooks, verification, last-prompt, dashboard, roadmap-0027]
---

# TASK-0229 — Verify the last-payload round trip: hermetic hook and suite script, plus a human live recipe (install-hooks, restart, type, Enter, reload)

relates_to::[[hook-authoritative-last-prompt]]
relates_to::[[last-user-message-capture]]
depends_on::[[TASK-0221]]
depends_on::[[TASK-0222]]
depends_on::[[TASK-0223]]
depends_on::[[TASK-0226]]
depends_on::[[TASK-0227]]
depends_on::[[TASK-0228]]

> **Roadmap**: ROADMAP-0027 Phase 4, item 1 ("Re-run `install-hooks.sh`, restart agents, and verify the round trip: type -> Enter -> reload -> shown in the strip and the card"). Research: `raw/research/last-user-message-capture/index.md`, `raw/research/terminal-typed-command-persistence/index.md`.
> **Collision note**: touches only one new script and three docs (`hooks/README.md`, `CLAUDE.md`, `scripts/README.md`). `CLAUDE.md` and `scripts/README.md` are also edited by unrelated doc-touching tasks, so keep the edits to single rows/lines and re-read each file immediately before editing. No overlap with the `AgentList.tsx` / `host-server/index.ts` tasks in this roadmap.

## Objective

Prove the last-payload feature works end to end, split along the line that an autonomous agent can and cannot cross:

1. **Automated, hermetic (this task implements it).** A new `scripts/verify-last-payload.sh` pipes sample `UserPromptSubmit` payloads into the real `hooks/on-prompt-submit.js` against a throwaway state dir under `./tmp/`, asserts the resulting `<agent>.meta.json` `last_prompt` behavior (persisted, replaced, retained across non-prompt events, never overwritten by an empty prompt), and then runs the host-server and frontend unit suites for every module the roadmap touched.
2. **Live, human-only (this task documents it).** The original roadmap wording (re-run `install-hooks.sh`, restart agents, type a message, Enter, reload) mutates the real `~/.claude` and restarts running agents, so it is written down as a recipe with a tickable checklist for the human UAT step, and mirrored into `hooks/README.md` under "Verifying last_prompt".

The design being verified (decided for ROADMAP-0027): `hooks/lib/write-state.js::writeState` adds `last_prompt: { text, ts }` to the sidecar merge when `payload.prompt` is a non-empty string (only `UserPromptSubmit` carries it); the host-server reads `<stateDir>/<agent>.meta.json` and exposes `lastPrompt: { text: string, ts: string } | null` on the agent snapshot, both SSE `agent-update` builders and the SSE change-diff predicate in `host-server/index.ts`; the frontend mirrors it into `frontend/src/lib/lastPayload.ts` (`localStorage` key `conductor:lastPayload:<agentId>`, value `{ text, ts, source: 'hook' | 'add-task' }`, newest `ts` wins, every access in try/catch, same-tab listener set + `useSyncExternalStore` hook `useLastPayload(agentId)`, helpers `loadLastPayload` / `saveLastPayload` / `clearLastPayload`); the payload replaces `activeTask` in the detail-pane strip and the sidebar agent card (full width, truncated, full text in `title`).

## Approach

- **Model the script on the existing `scripts/verify-*.sh` family** (`verify-transitions-jsonl-emit.sh`, `verify-dev-commands.sh`): `set -euo pipefail`, `SCRIPT_DIR`/`REPO` resolved from `BASH_SOURCE`, scratch dir `"$REPO/tmp/verify-last-payload"` recreated on start and removed by an `EXIT` trap, a `check <name> pass|fail` helper accumulating `PASS`/`FAIL` arrays, final summary and non-zero exit if any check failed. Use `./tmp/` only (repo rule); never `/tmp`, `mktemp` or `$TMPDIR`.
- **Exercise the real hook, not a copy.** For each case run `env -u TMUX CONDUCTOR_AGENT_NAME=verify-agent CONDUCTOR_STATE_DIR="$SCRATCH/state" CONDUCTOR_LOG_DIR="$SCRATCH/logs" node "$REPO/hooks/<script>.js"` with the JSON payload on stdin (`printf '%s'`). `HOME` is never touched, `~/.claude` is never read or written, and the script refuses to run if the resolved state dir is not under `$REPO/tmp/`.
- **JSON assertions with `node -e`** (Node >= 18 is already a hard prerequisite; `jq` is optional in this repo, so do not depend on it). A small `meta_field <path-expr>` helper prints a field from `$SCRATCH/state/verify-agent.meta.json`.
- **Cases** (each is one `check`): (a) `on-prompt-submit.js` with `{ "prompt": "hello world", "session_id": "s1", "transcript_path": "/x.jsonl" }` yields `last_prompt.text == "hello world"`, an ISO-8601 `last_prompt.ts`, `session_id`/`transcript_path` preserved, and the `.state` file reads `busy`; (b) a multi-line prompt (`"line one\nline two"`) is stored verbatim; (c) a second prompt replaces the first; (d) `on-stop.js` with a payload lacking `prompt` leaves `last_prompt` deep-equal to its previous value and writes `idle`; `on-session-start.js` likewise; (e) empty-string, whitespace-only, missing and non-string (`123`) `prompt` values do not overwrite the existing `last_prompt`, and on a fresh state dir do not create one; (f) `hooks.jsonl` records the transition but does not contain the prompt text (the prompt must not be copied into the audit log); (g) every hook invocation exits 0, including non-JSON stdin and a corrupt pre-existing `meta.json`.
- **Suites run by the script** (skippable with `--skip-suites` so the hook checks stay a fast standalone run): `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts lastPrompt.test.ts sseRolePayloadParity.test.ts agentDiff.test.ts` and `cd frontend && npx vitest run src/lib/lastPayload.test.ts src/components/AddTaskForm.test.tsx src/components/AgentList.test.tsx src/components/AgentActionsMenu.test.tsx`. Confirm each named file exists at implementation time (TASK-0221, 0222, 0223, 0224, 0225 create them; if a sibling is named differently, e.g. `sseLastPromptParity.test.ts`, use the real name) and have the script fail loudly if a listed file is missing rather than silently skipping. Suite output is captured to `$SCRATCH` and only the tail is echoed on failure.
- **No network, no tmux, no DB, no live `logs/state/`.** The script must be safe to run while the fleet is up.

## Steps

### 1. Hermetic hook check script  <!-- agent: general-purpose -->

- [x] Verify the facts this script relies on with Serena before writing it: `find_symbol` `writeState` in `hooks/lib/write-state.js` (`include_body=true`) shows `last_prompt` being merged in the sidecar block (TASK-0221's output), and `hooks/on-prompt-submit.js` still delegates via `writeState('busy', 'prompt-submit')`. Line numbers drift because other agents edit this repo concurrently; re-verify, do not trust numbers from this task.
- [x] Create `scripts/verify-last-payload.sh` (executable, `#!/usr/bin/env bash`, header comment stating purpose, hermeticity and usage `bash scripts/verify-last-payload.sh [--skip-suites]`) implementing the cases in Approach. Style-match `scripts/verify-transitions-jsonl-emit.sh`.
- [x] `bash -n scripts/verify-last-payload.sh` clean; run it: `bash scripts/verify-last-payload.sh --skip-suites` passes; confirm non-tautology by temporarily breaking one assertion (e.g. expect a wrong text) and seeing the script exit non-zero, then restore.
- [x] Confirm `git status` shows no changes under `~/.claude` scope (there are none by construction) and that `./tmp/verify-last-payload` is removed on exit.

### 2. Suite runner section  <!-- agent: general-purpose -->

- [x] Add the suite section to the script (host-server `node --test` files and frontend `vitest run` files listed in Approach, existence-checked). Run the full script once: `bash scripts/verify-last-payload.sh`. Record the pass/fail counts in the task's `<!-- Updated: ... -->` note.
- [x] Do not fix failures in modules owned by other tasks from here; if a suite fails, report which task's output is at fault and leave this step unchecked.

### 3. Docs: recipe, hook table row, script line  <!-- agent: general-purpose -->

- [x] `hooks/README.md`: append a short `### Verifying last_prompt` section after the `lib/write-state.js` section (or under "Installation") containing: the hermetic command (`bash scripts/verify-last-payload.sh`); then the human live recipe (numbered, same steps as the UAT checklist below): re-run `./install-hooks.sh` from the repo root, restart the agents, type a message in the dashboard Direct Input and press Enter, confirm `logs/state/<agent>.meta.json` has `last_prompt`, reload the page, confirm the detail-pane strip and sidebar card. State plainly that the installed copy under `~/.claude/hooks/tmux-conductor/` only picks up `last_prompt` after the installer is re-run and the agents are restarted, and that this is a manual step. Also list `last_prompt: { text, ts }` in the `lib/write-state.js` responsibilities if TASK-0221 has not already (re-read the file first; do not duplicate).
- [x] `CLAUDE.md`: (1) in the Core Scripts table update the `hooks/on-prompt-submit.js` row to say it also persists the submitted prompt as `last_prompt: { text, ts }` in the agent's `<agent>.meta.json` sidecar; (2) where the host-server / dashboard agent payload is described (the `host-server/index.ts` row and/or the design-decision bullet about the agent snapshot), add that the agent snapshot carries `lastPrompt: { text, ts } | null`, which the dashboard mirrors into per-agent `localStorage` and shows in place of `activeTask` in the strip and sidebar card (`activeTask` stays in the API contract). One row/sentence each; do not restructure the file.
- [x] `scripts/README.md`: add one line for the new script. The file has no verify-script table today (only a passing mention of `scripts/verify-bg-liveness.sh` in the monitor section), so add a single bullet or sentence in the most fitting section (e.g. next to the relevant hook/host-server notes, or a one-line "Verification scripts" bullet) that reads: `scripts/verify-last-payload.sh` — hermetic check of the `last_prompt` sidecar behavior (real hook scripts, temp state dir under `./tmp/`) plus the related host-server/frontend unit suites; safe to run while agents are live.
- [x] Do not edit `wiki/work/tasks/index.md`, `wiki/log.md`, `wiki/hot.md` or the roadmap file; the orchestrator owns those shared files.

### 4. Static gates  <!-- agent: general-purpose -->

- [x] `bash -n scripts/verify-last-payload.sh`; `bash scripts/verify-last-payload.sh` exits 0 (all dependency tasks done).
- [x] [DEFERRED-TO-UAT] The live recipe below is executed by a human during UAT, not by this task's implementer.

<!-- Updated: 2026-09-20 -->

## Implementation record (2026-09-20)

Reconciliations of names in this task text against what landed:

- Host suites: `sseRolePayloadParity.test.ts` does not exist; the real names are `sseLastPromptParity.test.ts` and `lastPromptContract.test.ts` (plus `sseLastPromptParityMutation.test.ts`, deliberately not run by the script). Script runs `hookLastPrompt.test.ts lastPrompt.test.ts sseLastPromptParity.test.ts lastPromptContract.test.ts agentDiff.test.ts`.
- Frontend: `AgentActionsMenu.test.tsx` is not last-payload related and is not run. `AgentList.test.tsx` runs separately with `-t 'last[- ]payload|lastPrompt|TASK-022[5-8]'` because vitest `-t` applies to every file in one invocation and would otherwise filter out the whole-file suites (`lastPayload.test.ts`, `AddTaskForm.test.tsx`).
- Hook facts re-verified with Serena/Read: `writeState` merges `last_prompt: { text, ts[, prompt_id] }` in the sidecar block, with `normalizePrompt` paste-unwrap and `capPrompt` (cap 2000 = 1999 + `…`); `on-prompt-submit.js` still delegates via `writeState('busy', 'prompt-submit')`.
- Extra cases beyond the task list: paste-wrapped prompt, cap, `prompt_id`, `on-stop-failure.js`, `null`/array prompt values, hooks.jsonl 5-field shape, corrupt-meta recovery.
- Transient-red tolerance: only last-payload suite files are executed (so an unrelated file's red cannot be misattributed); a red suite is retried once and a retry-pass is labelled explicitly; a red on both attempts fails the script.

Actual run, `bash scripts/verify-last-payload.sh` (25 passed, 0 failed, exit 0): 21 hook checks PASS (normal/ts/session-transcript/busy, multi-line, paste-wrapped, replace/ts/prompt_id, on-stop/on-session-start/on-stop-failure retention, on-stop idle, empty/whitespace/missing/non-string no-overwrite, fresh dir no creation, cap, marker precondition, hooks.jsonl free of prompt text, hooks.jsonl shape, exit-0 robustness, corrupt-meta recovery); suite files exist PASS; host-server 62/62 tests pass (5 files); frontend `lastPayload` + `AddTaskForm` 2 files, 65/65 tests pass; frontend `AgentList` scoped `-t` 1 file, 44 tests pass (212 skipped by the filter). `--skip-suites` alone: 21 passed. Non-tautology: changing one expected text to `WRONG TEXT` produced `FAIL` and `Passed: 20 Failed: 1` (non-zero exit), then restored. `bash -n` clean; `./tmp/verify-last-payload` removed on exit; nothing under `~/.claude` or the live `logs/state/` touched.

The Human live recipe below is documented only (also mirrored into `hooks/README.md` "Verifying `last_prompt`") and was not executed.

## Human live recipe (UAT checklist)

Run by a human, with the fleet's owner present, after all six dependency tasks are done. Substitute a real agent for `<agent>` and its numeric id for `<id>`.

- [ ] **Install.** From the repo root run `./install-hooks.sh` (writes to the real `~/.claude`). Confirm the installed helper carries the new field, e.g. `grep -rl last_prompt ~/.claude/hooks/tmux-conductor/` lists `write-state.js`.
- [ ] **Restart.** Restart every Claude Code agent you want to test (hook config and scripts are read when a session starts), then confirm each shows `idle` in the dashboard.
- [ ] **Type -> Enter (Direct Input).** In Interact / Direct Input for `<agent>`, type a distinctive message (e.g. `roundtrip 1 ` plus a timestamp) and press Enter. Within a couple of seconds `logs/state/<agent>.meta.json` contains `"last_prompt":{"text":"roundtrip 1 ...","ts":"..."}`, and the detail-pane strip and that agent's sidebar card both show the message (truncated, full width) instead of the active task.
- [ ] **Hover.** Hovering the strip and the card shows the full text in the native `title` tooltip.
- [ ] **Reload.** Hard-reload the dashboard. The strip and card still show the message (the `conductor:lastPayload:<id>` key in DevTools -> Application -> Local Storage holds `{ text, ts, source: 'hook' }`).
- [ ] **Store wiped, server replays.** Delete that `localStorage` key and reload: the message reappears once the SSE connect replay delivers `lastPrompt` (proves the server side, not just the browser cache).
- [ ] **Add Task box.** Submit a distinctive task through the Add Task box: the strip and card show it immediately (`source: 'add-task'`). When the queue dispatches it to the agent, the hook fires and the same text (newer `ts`) shows with `source: 'hook'`.
- [ ] **Queue dispatch.** Queue a task for an idle agent and let the monitor dispatch it: the strip and card show the dispatched command after it is sent.
- [ ] **Multi-line / recall.** Paste a multi-line message, then press Up to recall an earlier prompt and Enter: the strip and card reflect what was actually submitted each time.
- [ ] **No-payload empty state.** An agent that has never received a prompt (or a hook-less agent such as Aider) shows the designed empty state in the strip and card, not a stale value or the old `activeTask`.
- [ ] **Isolation and cleanup.** A cloned agent keeps its own payload (it does not inherit the source's), and deleting an agent removes its `conductor:lastPayload:<id>` key (TASK-0228). Skip clone checks unless the source has an isolated worktree (a clone shares its workdir otherwise).
- [ ] **Record result.** Note the agents tested, Claude Code version, and any slash-command (`/foo`) observation from ROADMAP-0027 Phase 1 (if a typed `/command` did not fire the hook, that is the documented follow-up, not a failure of this task).

## Files expected to be touched

- `scripts/verify-last-payload.sh` (new)
- `hooks/README.md`
- `CLAUDE.md`
- `scripts/README.md`

## Dependencies

- TASK-0221
- TASK-0222
- TASK-0223
- TASK-0226
- TASK-0227
- TASK-0228

TASK-0221 (hook writes `last_prompt`), TASK-0222 (server `lastPrompt` on snapshot, both SSE builders, diff predicate), TASK-0223 (Add Task submit records a payload), TASK-0226 (detail-pane strip), TASK-0227 (sidebar card) and TASK-0228 (clear on delete, clone isolation) are what the script and recipe verify. TASK-0224 (store) and TASK-0225 (SSE mirror) are reached transitively through 0226/0227. The suite file names listed in Approach come from these tasks and must be re-confirmed when implementing.

## Notes

Guardrails for whoever implements this:

- **Never run `install-hooks.sh` against the real `~/.claude`, and never edit `~/.claude/settings.json`.** The installer step in the recipe is for a human. This task only writes the recipe down. (If the installer must be exercised in a test, use its sandbox flags `--hook-dir`, `--settings-file` and `--install-dir` pointed under `./tmp/`; the new script does not need to.)
- **Never kill or restart tmux windows or sessions, and never stop or restart the running host-server or dev servers.** The script must use a throwaway state dir under `./tmp/` and spawn the hook scripts directly; it must not read or write the live `logs/state/`.
- **Live-fleet verification is a documented UAT step for a human, not something an autonomous agent performs.** Do not tick the Human live recipe checkboxes from an autonomous run.
- Stored prompts may contain secrets; the script's sample prompts are synthetic. Follow the storage rules TASK-0220 recorded (cap, secret handling) if a case depends on the cap.
- If the suite file list drifts (a task named its test differently), update the list in the script rather than dropping a suite.
