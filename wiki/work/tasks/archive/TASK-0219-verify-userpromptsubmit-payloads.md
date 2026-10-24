---
id: TASK-0219
aliases: [TASK-0219]
title: "Dump and record UserPromptSubmit payloads for typed, slash, multi-line, Up-recalled and dispatched prompts"
status: done
created: 2026-09-20
updated: 2026-09-20
depends_on: []
blocks: []
parallel_safe_with: []
uat: ""
tags: [hooks, claude-code, spike, verification, last-payload]
---

# TASK-0219 — Dump and record UserPromptSubmit payloads for typed, slash, multi-line, Up-recalled and dispatched prompts

relates_to::[[hook-authoritative-last-prompt]]
relates_to::[[last-user-message-capture]]

> **Roadmap**: ROADMAP-0027 Phase 1, item 1. Research: `raw/research/last-user-message-capture/index.md` (Findings 6 and 7 are the open questions this task closes), building on `raw/research/terminal-typed-command-persistence/index.md`.
> **Type**: verification spike. **No product-source changes** — the only files written are scratch files under `./tmp/` and this task file's own `## Findings` section.

## Objective

Settle, empirically and on the installed Claude Code (`claude --version` was 2.1.278 when this task was written), what the `UserPromptSubmit` hook actually receives for each way a prompt can reach an agent, so the rest of ROADMAP-0027 (persisting `last_prompt: { text, ts }` in `hooks/lib/write-state.js`, and the storage-rules decision) is built on observed payloads instead of docs and inference. Five scenarios are covered: a typed message, a typed `/slash` command, a multi-line paste, an `Up`-recalled prompt and a queue dispatch. The task also records whether slash commands fire `UserPromptSubmit` at all, whether they instead (or also) fire `UserPromptExpansion`, and whether a queue dispatch is byte-identical to the same text typed by a user.

## Approach

- **Isolated setup only.** Register a throwaway dump hook through a `--settings` file under `./tmp/payload-spike/`, run from a scratch working directory, and load only project/local setting sources (`--setting-sources project,local`) so the real `~/.claude/settings.json` and the installed tmux-conductor hooks are never loaded. Belt and braces: run every command through `env -u TMUX -u CONDUCTOR_AGENT_NAME` so that even if the real hooks did load, `writeState()` would resolve no agent name and exit without touching `logs/state/`. Do **not** use `--bare` (it skips hooks entirely).
- **Dump hook.** A ~10-line Node script appends `{ received_at, raw_len, payload }` (the parsed stdin JSON, or the raw string if it is not JSON) as one JSONL line to `./tmp/hook-payloads/<PAYLOAD_LABEL>.jsonl`. It registers under both `UserPromptSubmit` and `UserPromptExpansion`; the payload's own `hook_event_name` tells the two apart. It always exits 0 and prints nothing, so it can never alter a prompt.
- **Scriptable scenarios use `claude -p`** (print mode, `--model haiku`, `--no-session-persistence`, one turn) from `./tmp/payload-spike/workdir/`, which also holds a custom slash command `.claude/commands/spike-echo.md` (body: `Reply with exactly: spike-ok $ARGUMENTS`). Print mode passes the prompt as an argument, so it is a fair test for typed text, slash commands and multi-line strings, but **not** for TUI-only behaviour.
- **TUI-only scenarios are documented manual recipes.** History recall (`Up`), a real bracketed multi-line paste, and the queue-dispatch byte path (`tmux send-keys -l -- "$text"`, then a separate `Enter`, exactly as `host-server/state.ts::sendTextToPane` and `scripts/dispatch.sh` do it) need an interactive Claude Code TUI. They are written up as step-by-step recipes for a human. Any agent executing this task must NOT drive them against the running conductor tmux session or its windows; if a recipe is ever automated it may only use a private tmux server (`tmux -L payload-spike ...`) that never touches the conductor session.
- **Findings go in this file.** The closing step fills the `## Findings` table and answers the four named questions inline. No `raw/` or `wiki/knowledge/` writes are made by this task; ingesting the result is a follow-up for the orchestrator.

## Steps

### 1. Build the isolated harness under ./tmp  <!-- agent: general-purpose -->

- [x] Create `./tmp/payload-spike/dump-hook.js` with the `Write` tool (scratch dir, gitignored per CLAUDE.md; never `/tmp`): read all of fd 0, `JSON.parse` it in a try/catch, and append one JSON line `{ received_at, raw_len, payload }` (plus `raw` when the parse failed) to `<dir>/<PAYLOAD_LABEL>.jsonl`, where `<dir>` is `process.env.PAYLOAD_DUMP_DIR` defaulting to the absolute path of `./tmp/hook-payloads/` and the label defaults to `unlabelled`. `fs.mkdirSync(dir, { recursive: true })` first. Wrap everything in try/catch and `process.exit(0)`.
- [x] Create `./tmp/payload-spike/settings.json` registering `node <absolute path>/tmp/payload-spike/dump-hook.js` as a `command` hook under `UserPromptSubmit` and under `UserPromptExpansion` (no matcher). Use the absolute repo path; hooks run with the scratch directory as cwd.
- [x] Create `./tmp/payload-spike/workdir/.claude/commands/spike-echo.md` (frontmatter `description: spike command`, body `Reply with exactly: spike-ok $ARGUMENTS`) and `./tmp/payload-spike/README.txt` recording the exact run prefix used below.
- [x] Record the isolation baseline before any run: the `mtime` and size of `~/.claude/settings.json` and the line count of `logs/hooks.jsonl` (stat/read-only). Re-check both after Step 3 and Step 4; they must be unchanged. If `claude` rejects the `UserPromptExpansion` key in `settings.json` (the event may not exist on this version), record that verbatim as a finding and re-run with only `UserPromptSubmit` registered.
- [x] Define the run prefix used by every scripted scenario and record it in the README: `cd ./tmp/payload-spike/workdir && env -u TMUX -u CONDUCTOR_AGENT_NAME PAYLOAD_LABEL=<label> claude -p --model haiku --no-session-persistence --setting-sources project,local --settings ../settings.json "<prompt>"`.

### 2. Sanity-check the harness with a plain typed-message run  <!-- agent: general-purpose -->

- [x] Run scenario **S1** (label `s1-typed`): prompt `spike typed message alpha`. Confirm `./tmp/hook-payloads/s1-typed.jsonl` has exactly one `UserPromptSubmit` line, and list the full set of top-level keys in the payload (expected from docs: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `prompt`; note any extras such as `session_title`). If nothing is written, stop and diagnose the harness (settings path, absolute hook path, flags) before running the rest; do not fall back to the real `~/.claude`.
- [x] Byte-check the `prompt` value against the input string: exact match, or any trimming/normalization (leading/trailing whitespace, trailing newline).

### 3. Run the scriptable scenarios (print mode)  <!-- agent: general-purpose -->

- [x] **S2a — custom slash command with args** (label `s2a-slash-custom`): prompt `/spike-echo beta`. Record every line written: does `UserPromptSubmit` fire, does `UserPromptExpansion` fire, in which order, and the exact `prompt` / `expansion_type` / `command_name` / `command_args` values in each.
- [x] **S2b — built-in local slash command** (label `s2b-slash-builtin`): prompt `/context` (a built-in that does not need a model turn; if print mode rejects it, try `/help` and record which one was used). Same questions as S2a, and additionally whether *any* hook fires when the command produces no model turn.
- [x] **S2c — slash command with no args** (label `s2c-slash-noargs`): prompt `/spike-echo`. Record whether `prompt` is the raw `/spike-echo` string or the expanded body.
- [x] **S3 — multi-line string** (label `s3-multiline`): prompt `$'line one\nline two\n\n    indented line four\ttab'` (blank line, leading spaces and a tab included). Record whether newlines, blank lines and whitespace survive verbatim in `prompt`. Caveat to record: this is an argument string, not a TUI bracketed paste (see manual recipe M2).
- [x] **S3b — large prompt** (label `s3b-large`): a single-line prompt of about 5 000 characters (repeat a token). Record `raw_len`, the `prompt` length and whether Claude Code truncates it before the hook, to inform the length-cap decision (research suggests capping stored text at roughly 2 000 characters).
- [x] **S3c — special characters** (label `s3c-special`): prompt containing `"quoted"`, `'single'`, backticks, `$VAR`, a backslash, an emoji and a non-ASCII word. Record round-trip fidelity in the JSON (`prompt` must equal the input).
- [x] After all runs, re-check the isolation baseline from Step 1 (unchanged `~/.claude/settings.json` mtime and size, unchanged `logs/hooks.jsonl` line count, no new files in `logs/state/`).

### 4. Write the TUI-only scenarios as manual recipes  <!-- agent: general-purpose -->

Add a `### Manual recipes (human only)` block to the Findings section of this file, each recipe with exact commands and the exact things to record. These are executed by a human, in a private tmux server, never in the conductor session:

- [x] **M-setup**: `tmux -L payload-spike new-session -d -s spike -c <abs>/tmp/payload-spike/workdir`, then launch inside it `env -u CONDUCTOR_AGENT_NAME PAYLOAD_LABEL=<label> claude --model haiku --setting-sources project,local --settings <abs>/tmp/payload-spike/settings.json` and `tmux -L payload-spike attach -t spike`. Clean up afterwards with `tmux -L payload-spike kill-server` (the private server only; never a bare `tmux kill-server` or `kill-session` against the default socket).
- [x] **M1 — typed message in the TUI** (label `m1-typed-tui`): type `spike typed message alpha` and press Enter by hand. Baseline for the byte comparison in M4.
- [x] **M2 — real multi-line paste** (label `m2-paste`): paste a three-line block (bracketed paste) and press Enter; also try `Shift+Enter` / `\` + Enter line breaks typed by hand. Record what `prompt` contains (real newlines vs. joined, any `[Pasted text #1 ...]` placeholder text instead of the content, whitespace changes).
- [x] **M3 — Up-recalled prompt** (label `m3-up-recall`): submit `spike recall target`, then in a fresh prompt press `Up` once and Enter without typing anything else. Record whether the hook fires a second time and whether `prompt` equals the recalled text. Repeat after editing the recalled text before Enter.
- [x] **M4 — queue-dispatch byte path** (label `m4-dispatch`): from a second shell run exactly what conductor does, `tmux -L payload-spike send-keys -t spike:0 -l -- 'spike typed message alpha'`, wait 0.3 s, then `tmux -L payload-spike send-keys -t spike:0 Enter` (mirrors `sendTextToPane` in `host-server/state.ts` and `scripts/dispatch.sh`). Compare that `prompt` to M1's and to S1's byte for byte (`cmp` on the extracted strings). Also dispatch a multi-line command and a `/clear`-style slash command, since conductor sends `/clear` first for project-kind tasks (`sendDispatchToPane` with `clearFirst`), and record what `send-keys -l` does with an embedded newline.
- [x] **M5 — slash command in the TUI** (label `m5-slash-tui`): type `/spike-echo gamma` and press Enter, and separately accept a slash-command autocomplete suggestion with Tab then Enter; record which events fire and the `prompt` values.

### 5. Analyse the dumps  <!-- agent: general-purpose -->

- [x] For each label, pretty-print the relevant lines (`node -e` or `jq`; read-only) and extract, per event: `hook_event_name`, `prompt`, and for expansion events `expansion_type`, `command_name`, `command_args`. Compare each `prompt` to the input string byte for byte.
- [x] Decide, from the evidence, what the ROADMAP-0027 hook step must do: (a) is `UserPromptSubmit` alone sufficient for typed slash commands; (b) if not, what a `UserPromptExpansion` registration would have to store to reconstruct the text the user typed (`/` + `command_name` + `command_args`?), and whether it can be added to the same `write-state.js` merge without a signature change; (c) whether a length cap is needed at the hook or only at display time.

### 6. Write the Findings section (closing step)  <!-- agent: general-purpose -->

- [x] Fill in the `## Findings` section at the bottom of this file: the results table, a short answer to each of the four named questions, the Claude Code version, the date run, and any harness caveats (print mode vs. TUI). Mark each scenario `verified (scripted)`, `verified (manual)` or `NOT RUN — manual recipe pending`, so a reader can tell observed from pending.
- [x] Set the task `status: done` only when the scripted scenarios are all recorded; the manual recipes M1-M5 may remain `pending human` and are carried by the ROADMAP-0027 Phase 4 UAT. Update `updated:` in the frontmatter. (The orchestrator handles the index, log, hot cache and roadmap check-off.)

## Files

- `./tmp/payload-spike/dump-hook.js` (scratch, new)
- `./tmp/payload-spike/settings.json` (scratch, new)
- `./tmp/payload-spike/README.txt` (scratch, new)
- `./tmp/payload-spike/workdir/.claude/commands/spike-echo.md` (scratch, new)
- `./tmp/hook-payloads/*.jsonl` (scratch output, new)
- `wiki/work/tasks/TASK-0219-verify-userpromptsubmit-payloads.md` (this file: checkboxes, `## Findings`)

No product source, hook, host-server, frontend or config file is touched. Nothing under `raw/`, `~/.claude/`, `logs/state/` or the tmux-conductor SQLite DB is written.

## Dependencies

None.

## Notes

Guardrails for whoever implements this:

- **Never run `install-hooks.sh` against the real `~/.claude`, and never edit `~/.claude/settings.json`** (or any file under `~/.claude/`). All hook registration in this task goes through the scratch `--settings` file.
- **Never kill or restart tmux windows or sessions, or the running host-server or dev servers.** The only tmux the manual recipes may use is a private server on its own socket (`tmux -L payload-spike`); do not send keys to, attach to, or kill anything on the default socket or the conductor session.
- **Live-fleet verification is a documented UAT step for a human, not something an autonomous agent performs.** This task produces payload evidence and recipes; the fleet round trip (re-run `install-hooks.sh`, restart agents, type → Enter → reload) belongs to ROADMAP-0027 Phase 4.
- Scratch files live in `./tmp/` only, never `/tmp` (CLAUDE.md). Create them with `Write`, not shell redirection.
- Use `--model haiku` and one turn per run to keep API usage negligible; do not loop.
- The dump hook must never print to stdout or exit non-zero: a `UserPromptSubmit` hook's stdout can be injected into context and a non-zero/2 exit can block the prompt.
- Payloads may include whatever the operator typed; the dump files stay under gitignored `./tmp/`. Use only innocuous test strings, and delete `./tmp/hook-payloads/` if any real content ends up there.
- Code facts checked against the repo when this task was written (line numbers drift, so verify by symbol): `hooks/lib/write-state.js::writeState` parses stdin into `payload` and merges only `transcript_path`, `session_id`, `model` and `ts` into `<agent>.meta.json`; `hooks/on-prompt-submit.js` is registered under `UserPromptSubmit` by `hooks/register-hooks.jq` and `hooks/register-codex-hooks.jq`, and no `UserPromptExpansion` registration exists yet; queue dispatch types the text with `tmux send-keys -l --`, waits `DISPATCH_SUBMIT_DELAY_MS`, then sends a separate `Enter` (`host-server/state.ts::sendTextToPane`, called by `sendDispatchToPane`, called by `host-server/index.ts::dispatchTaskToAgent`, which passes `clearFirst` for project-kind tasks).

## Findings

**Environment:** Claude Code **2.1.278** (`claude --version` → `2.1.278 (Claude Code)`), model `haiku` (Haiku 4.5) · Date run: 2026-09-20 · Harness: `--settings ./tmp/payload-spike/settings.json`, `--setting-sources project,local`, scratch workdir `./tmp/payload-spike/workdir/`, every command under `env -u TMUX -u CONDUCTOR_AGENT_NAME`. Scripted runs used `claude -p --no-session-persistence`. The TUI scenarios were driven by the executing agent through a **private tmux server** (`tmux -L payload-spike`, session `spike`, killed afterwards with `tmux -L payload-spike kill-server`; the conductor session was never touched). `UserPromptExpansion` is a valid event key on this version (accepted in `settings.json`, and it fired).

Payload top-level keys (all `UserPromptSubmit` events): `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `hook_event_name`, `prompt`. `prompt_id` is an extra not in the docs the task started from; there is no `session_title`. `UserPromptExpansion` adds `expansion_type`, `command_name`, `command_args`, `command_source`.

| # | Scenario | Fires `UserPromptSubmit`? | Fires `UserPromptExpansion`? | Exact `prompt` value | Matches input byte for byte? | Status |
|---|----------|---------------------------|------------------------------|----------------------|------------------------------|--------|
| S1 | Typed message (print mode) | yes (exactly 1) | n/a | `spike typed message alpha` | yes | verified (scripted) |
| S2a | `/spike-echo beta` (custom slash + args) | yes | yes, fired first (07:16:29.649Z vs 29.702Z, same `prompt_id`) | Submit: `/spike-echo beta`; Expansion: `/spike-echo beta` with `expansion_type: "slash_command"`, `command_name: "spike-echo"`, `command_args: "beta"`, `command_source: "projectSettings"` | yes (raw text as typed, not the expanded body) | verified (scripted) |
| S2b | `/context` (built-in local slash) | **no** (no dump file written) | **no** | none: no hook fired at all | n/a | verified (scripted); `/help` was also tried and is unavailable in print mode (no hook either) |
| S2c | `/spike-echo` (custom slash, no args) | yes | yes | Submit: `/spike-echo`; Expansion: `command_args: ""`, `prompt: "/spike-echo"` | yes (raw, not expanded body) | verified (scripted) |
| S3 | Multi-line string with blank line, indent, tab | yes | n/a | `"line one\nline two\n\n    indented line four\ttab"` | yes (newlines, blank line, spaces, tab all verbatim) | verified (scripted); argument string, not a paste |
| S3b | ~5 000 character prompt | yes | n/a | length only: 5002 (`raw_len` 5437 incl. envelope) | yes, no truncation | verified (scripted) |
| S3c | Quotes, backticks, `$VAR`, backslash, emoji, non-ASCII | yes | n/a | `"quoted" 'single' `backtick` $VAR back\slash 😀 café naïve 日本語` | yes | verified (scripted) |
| M1 | Typed message in the TUI | yes | n/a | `spike typed message alpha` | yes, identical to S1 | verified (scripted via private tmux `send-keys`; see caveat) |
| M2 | Real multi-line paste (bracketed, `tmux paste-buffer -p`) | yes | n/a | `"\n\n<pasted_content id=\"8822\">\npaste line one\npaste line two\n\n    paste indented line four\n</pasted_content id=\"8822\">\n"` (TUI showed `[Pasted text #1 +3 lines]`) | **no**: wrapped in a `<pasted_content id="...">` envelope with extra newlines | verified (scripted via private tmux) |
| M2b | Line break typed as `\` + Enter | yes | n/a | `"bs line one\nbs line two"` (trailing `\` consumed, real `\n`) | n/a (no plain input to compare) | verified (scripted via private tmux) |
| M3 | `Up`-recalled prompt (unedited, edited) | not determined | n/a | not determined | not determined | **NOT RUN — manual recipe pending.** The attempt was inconclusive: after submitting `spike recall target`, `Up` (via `tmux send-keys Up`) left the input empty in this automated session, whose banner read "Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker", so history recall appears disabled here. Do not read this as "Up does not recall in a normal session". |
| M4 | Queue-dispatch path (`send-keys -l` + 0.3 s + separate `Enter`) | yes | n/a | single line: `spike typed message alpha` (byte-identical to S1/M1). Multi-line via `send-keys -l` with an embedded newline: newline inserts a line break and does **not** submit; a later `Enter` submitted `"dispatch multi one\ndispatch multi two"` (real `\n`). `/clear` via the same path: **no hook fired** | yes for single line | verified (scripted via private tmux) |
| M5 | Slash command typed in TUI, and Tab-autocompleted | yes | yes | typed `/spike-echo gamma`: Submit `/spike-echo gamma`, Expansion `command_name: "spike-echo"`, `command_args: "gamma"`. Typed `/spike-e` + Tab + Enter: autocomplete produced `/spike-echo` (no args), Submit `/spike-echo`, Expansion `command_args: ""` | yes | verified (scripted via private tmux) |

**Answers to the named questions:**

1. **Do slash commands fire `UserPromptSubmit`?** Yes for user-defined (custom command) slash commands, in print mode and in the TUI, with `prompt` equal to the raw typed string (`/spike-echo beta`), not the expanded body. No for the built-in commands tried: `/context` (print mode) and `/clear` (TUI) fired neither event, and `/help` is unavailable in print mode. Built-ins other than these three were not tested.
2. **Do they also, or instead, fire `UserPromptExpansion`?** Also, not instead. For a custom slash command `UserPromptExpansion` fires first (about 50 ms before `UserPromptSubmit`, same `prompt_id`) with `expansion_type: "slash_command"`, `command_name`, `command_args`, `command_source` and `prompt` (the same raw text as the Submit event). Built-in commands that need no model turn fired neither.
3. **Is a queue dispatch byte-identical to the same message typed by a user?** For a single-line message, yes: `send-keys -l` + separate `Enter` yielded `prompt` `spike typed message alpha`, identical to the print-mode string (S1) and to the TUI path. Caveat: at PTY level tmux `send-keys` and a human keyboard are both plain keystroke bytes, so M1 and M4 are effectively the same path here and a real human-keyboard run adds little. For multi-line text, a newline embedded in `send-keys -l` acts as a line break rather than a submit, and the resulting `prompt` contains real `\n`.
4. **Does an `Up`-recalled prompt fire the hook, and with what `prompt`?** Not determined (see M3). Reasoning only, not observed: any submission from the TUI fires the hook with whatever text is in the input box, so a recalled prompt should behave as a fresh submit with that text; this needs the manual recipe in a normal (persistence-enabled) session.

**Implications for ROADMAP-0027:**

- (a) `UserPromptSubmit` alone is sufficient for custom slash commands: `prompt` already holds the raw `/name args` text the user typed, so no `UserPromptExpansion` registration is needed and none should be added (it would only duplicate the same text). Built-in commands such as `/clear` and `/context` fire no prompt hook, so `last_prompt` will simply not update for them; the display should treat "unchanged" as correct (e.g. a dispatched `/clear` will not replace the shown last prompt).
- (b) No `write-state.js` signature change is required for this.
- (c) **Pasted content arrives wrapped.** A bracketed paste reaches the hook as `\n\n<pasted_content id="N">\n...\n</pasted_content id="N">\n`, not as the pasted text. The hook step must decide whether to store that verbatim or strip the envelope (recommendation for TASK-0220/0221: unwrap it, trim, then apply the cap and the first-line display, otherwise the sidebar first line will be blank or `<pasted_content ...>`). Multi-line typed or dispatched text arrives with real newlines and verbatim whitespace, so the first-line display rule works there.
- (d) No length truncation occurred at 5 002 chars, so the cap must be applied in the hook (or at read time), not assumed from Claude Code.
- (e) `prompt_id` is available and could serve as a dedupe key if ever needed.

**Harness caveats and anomalies (read these):**

- Print mode vs. TUI: S1-S3c are print mode (prompt as argument); M-rows were driven through a real TUI in a private tmux server by an agent, not by a human at a keyboard. The single `m1-typed-tui.jsonl` file holds all TUI rows in order (env label is fixed per process); rows M1, M3 attempt, M2, M2b, M4-multi, M5a, M5b, `/clear` map to its lines 1-9 and the `/clear` no-event result.
- Isolation baseline: `~/.claude/settings.json` was **not** intentionally touched and has no reference to `payload-spike`, but its mtime/size changed during the task (from mtime 1789316669 / 9030 bytes to 1789888667 / 9031 bytes, i.e. Sep 20 02:17:47 CDT), within one second of the moment the interactive TUI was launched (private tmux session created 02:17:46; scripted runs before it did not change it). The cause is unknown (an interactive Claude Code launch, or a concurrent fleet agent); no before-copy exists to diff, so the one-byte change could not be characterised. Flagged to the orchestrator.
- `logs/hooks.jsonl` grew (3514 to 3522 lines) but every new record belongs to live fleet agents (`tmux-conductor-tmux-conductor-2/3`, `tmux-conductor-frontend-2`); none has an empty agent name, so the env-stripped runs wrote nothing. The line count is not a usable isolation signal on a live fleet.
- The TUI session ran with "Transcript saving is off" (inherited `CLAUDE_CODE_CHILD_SESSION` marker); nothing was written under `~/.claude/projects/` for it as far as observed.
- In the first TUI run the model answered a plain message by calling `Skill(/spike-echo)`: the scratch workdir's custom command is visible to the model. Irrelevant to hook payloads.
- Dump files (`./tmp/hook-payloads/*.jsonl`) contain only the innocuous test strings above; gitignored under `./tmp/`.

### Manual recipes (human only)

Only M3 still needs a human; M1, M2, M4, M5 were executed as above and are kept here as reproducible recipes. Always run inside a private tmux server, never in the conductor session.

- **M-setup**: `tmux -L payload-spike new-session -d -s spike -c "$PWD/tmp/payload-spike/workdir" "env -u TMUX -u CONDUCTOR_AGENT_NAME PAYLOAD_LABEL=<label> claude --model haiku --setting-sources project,local --settings $PWD/tmp/payload-spike/settings.json"`, then `tmux -L payload-spike attach -t spike`. Cleanup: `tmux -L payload-spike kill-server` (private server only). Analyse with `node tmp/payload-spike/analyze.js`-style read-only dumps of `./tmp/hook-payloads/<label>.jsonl`.
- **M1 (typed)**: type `spike typed message alpha`, press Enter. Expect `prompt` = the typed text.
- **M2 (paste)**: paste a three-line block, press Enter; then type `line one\` Enter `line two` Enter. Expect the `<pasted_content id="N">` envelope for the paste and a real `\n` for the backslash form.
- **M3 (Up recall) — OUTSTANDING, human only**: in a **normal session with history enabled** (do not inherit `CLAUDE_CODE_CHILD_SESSION`), submit `spike recall target`; in a fresh prompt press `Up` once and Enter; record whether a second hook line appears and its `prompt`. Repeat after editing the recalled text before Enter. Carried by the ROADMAP-0027 Phase 4 UAT.
- **M4 (dispatch)**: from a second shell, `tmux -L payload-spike send-keys -t spike:0 -l -- 'spike typed message alpha'`, wait 0.3 s, `tmux -L payload-spike send-keys -t spike:0 Enter`; compare `prompt` to S1. Also send a multi-line string (embedded newline) and `/clear`.
- **M5 (slash)**: type `/spike-echo gamma` and Enter; separately type `/spike-e`, Tab, Enter. Expect both events for custom commands; `/clear` fires neither.