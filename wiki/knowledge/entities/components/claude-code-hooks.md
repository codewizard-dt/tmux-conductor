---
id: claude-code-hooks
title: Claude Code Hooks
aliases: [hooks/, tmux-conductor hooks]
updated: 2026-09-20
sources:
  - ../../../raw/research/stop-hook-subagent-detection/index.md
  - ../../../raw/research/bug-0001-background-agent-detection/index.md
  - ../../../raw/research/detect-active-claude-code-sessions-kanban/index.md
  - ../../../raw/research/last-user-message-capture/index.md
  - ../../../raw/research/differentiate-actual-user-input/index.md
confidence: extracted
tags: [hooks, claude-code, state-tracking]
---

# Claude Code Hooks

`hooks/` — the per-event Node.js scripts (`on-session-start.js`, `on-prompt-submit.js`, `on-stop.js`, `on-stop-failure.js`, and — since the `derived_from::[[BUG-0001]]` fix, see below — `on-notification.js`) that `uses::[[tmux-conductor]]` registers globally into `~/.claude/settings.json` via the repo-root `install-hooks.sh` + `hooks/register-hooks.jq`. The first four delegate to the shared `hooks/lib/write-state.js`, which resolves the agent name (`CONDUCTOR_AGENT_NAME` env var, falling back to the tmux window name), drains stdin, and writes `idle`/`busy` to `$STATE_DIR/<agent>.state` — unconditionally, based only on which script ran. It also persists `transcript_path`/`session_id`/`model` into a `.meta.json` sidecar for the dashboard's context meter, and (for `UserPromptSubmit`) the submitted prompt as `last_prompt: { text, ts }` — see below.

`write-state.js` never inspects the hook JSON payload's `agent_id`/`agent_type` fields, and `on-stop.js` is registered under the `Stop` event only — never `SubagentStop`.

## History: the removed, then re-added, Notification hook

A `Notification` hook (`on-notification.sh`) existed briefly (added 2026-04-16, commit `1f55cfe`) and routed `notification_type` (`idle_prompt→done`, `permission_prompt|elicitation_dialog→wait`, `auth_success→nop`, unknown→log-only) into the state file. It was deleted one day later (commit `a17ef24`) as part of a deliberate simplification collapsing the state vocabulary from four values (`done`/`working`/`wait`/`dispatching`) to two (`idle`/`busy`). The task doc driving that change gives vocabulary simplification as the sole rationale — it does not mention background-agent tracking, and predates Claude Code's background/async-agent `Notification` subtypes (`agent_needs_input`, `agent_completed`, shipped v2.1.198, ~July 2026) by about 2.5 months.

**`hooks/on-notification.js` (Node.js, not the earlier `.sh`) was re-added** as part of the `derived_from::[[BUG-0001]]` fix, scoped narrowly to just `agent_needs_input` (writes a sentinel file under `$STATE_DIR/<agent>.pending-agents/`) and `agent_completed` (FIFO-removes the oldest sentinel) — every other `notification_type` stays a no-op, so the full `done`/`working`/`wait`/`dispatching` vocabulary TASK-009 removed stays collapsed. `host-server/pendingAgents.ts::hasPendingBackgroundAgents()` gates two dispatch call sites in `host-server/index.ts` on this sentinel directory being empty/stale.

**As of 2026-09-04, this fix is confirmed incomplete for its primary case**: current Claude Code docs establish `agent_needs_input` fires *only* when a background agent needs a decision, never as a general "still running" signal — so an autonomous background agent that never needs input never gets a sentinel written for it. See `relates_to::[[bug-0001-background-agent-detection]]` for the full finding and a proposed pane-text-based complementary fix (mirroring `AWAITING_PATTERN`).

## Global install doesn't mean global coverage (confirmed 2026-09-13)

`install-hooks.sh` merges these hooks into `~/.claude/settings.json` at **user scope**, so they technically fire for every Claude Code session on the machine — not just ones `conductor.sh`/`spawn.sh` spawn. But `write-state.js` resolves `AGENT_NAME` from `CONDUCTOR_AGENT_NAME` (only set by tmux-conductor's own spawn scripts) or, failing that, `tmux display-message -p '#W'` (only works inside *some* tmux pane) — and if neither resolves, it calls `process.exit(0)` before writing anything. Even when a tmux window name is found, it writes to the hardcoded default `STATE_DIR` (`/conductor-state`), not a real writable path outside a container context. **Net effect: the globally-installed hooks are silent no-ops for the majority of ad-hoc, non-conductor-spawned sessions** (a plain terminal tab, an IDE integrated terminal, or a tmux pane in an unrelated session) — so "the hooks already fire everywhere" is not the same as "tmux-conductor already sees every session." See `relates_to::[[claude-code-session-discovery]]` for the actual solution (`claude agents --json`, which needs none of this).

## The submitted prompt is persisted as `last_prompt` (TASK-0221, 2026-09-20)

`on-prompt-submit.js` is still `writeState('busy', 'prompt-submit')` and nothing else, but `UserPromptSubmit`'s stdin payload includes the exact submitted text in a `prompt` field, and `writeState()`'s sidecar merge now stores it as `last_prompt: { text, ts }` (plus `prompt_id` when present) in `<agent>.meta.json`, next to `transcript_path`/`session_id`/`model`/`ts`. The same script is registered under Codex's `UserPromptSubmit`, so it works there too. Storage rules come from `derived_from::[[TASK-0220]]`: only a non-empty string prompt overwrites (every other event, and empty/whitespace/non-string prompts, leave the previous value), text is capped at 2000 UTF-16 code units (1999 plus one `…`, never splitting a surrogate pair), and there is no redaction. A bracketed paste reaches the hook wrapped in `<pasted_content id="N">…</pasted_content id="N">` (observed in TASK-0219), so `normalizePrompt` unwraps it before the empty-check and cap. Slash commands: custom ones fire both `UserPromptExpansion` and `UserPromptSubmit` with the raw `/name args` as `prompt`, so `UserPromptSubmit` alone suffices and no `UserPromptExpansion` registration exists; built-ins such as `/clear` and `/context` fire neither, so they never update `last_prompt`. `UserPromptSubmit` blocks model start until it returns (30 s default timeout), so the write stays synchronous, tiny and exit-0. The installed copy under `~/.claude/hooks/tmux-conductor/` only picks this up after a human re-runs `install-hooks.sh` and restarts the agents. See `derived_from::[[last-user-message-capture]]` and `relates_to::[[hook-authoritative-last-prompt]]`.

## `UserPromptSubmit` also fires for machine-injected text (researched 2026-09-20)

The hook is **not** a human-only signal. Reported on Claude Code 2.1.273, a finished background agent's synthetic `<task-notification>` block is delivered to `UserPromptSubmit` as `prompt`, exactly like a typed one; TASK-0219 did not test this, so `last_prompt` (TASK-0221) currently has no filter for it. Whether peer/teammate messages and queued-while-busy prompts also reach the hook is unverified. Claude Code's own provenance lives on the transcript record (`origin.kind`, `promptSource`, joinable via the payload's `prompt_id` → `promptId`, join unverified); the conductor's own injections are recorded in `dispatch.jsonl`. See `derived_from::[[differentiate-actual-user-input]]` and `relates_to::[[user-input-provenance-classification]]`.

## Debugging

Per the project's `claude-code/hooks-reference` Serena memory: confirm a hook fired at all by logging to `$STATE_DIR/hook.log`; check exit codes (2 = blocking, only for blockable events); capture full stdin payloads before writing logic against unconfirmed field names — exactly the step this project's own Notification-hook research recommends before wiring `agent_needs_input`/`agent_completed` into real dispatch logic.
