---
id: claude-code-hooks
title: Claude Code Hooks
aliases: [hooks/, tmux-conductor hooks]
updated: 2026-08-15
sources:
  - ../../../raw/research/stop-hook-subagent-detection/index.md
confidence: extracted
tags: [hooks, claude-code, state-tracking]
---

# Claude Code Hooks

`hooks/` — the per-event Node.js scripts (`on-session-start.js`, `on-prompt-submit.js`, `on-stop.js`, `on-stop-failure.js`) that `uses::[[tmux-conductor]]` registers globally into `~/.claude/settings.json` via the repo-root `install-hooks.sh` + `hooks/register-hooks.jq`. All four delegate to the shared `hooks/lib/write-state.js`, which resolves the agent name (`CONDUCTOR_AGENT_NAME` env var, falling back to the tmux window name), drains stdin, and writes `idle`/`busy` to `$STATE_DIR/<agent>.state` — unconditionally, based only on which script ran. It also persists `transcript_path`/`session_id`/`model` into a `.meta.json` sidecar for the dashboard's context meter.

`write-state.js` never inspects the hook JSON payload's `agent_id`/`agent_type` fields, and `on-stop.js` is registered under the `Stop` event only — never `SubagentStop` or `Notification`.

## History: the removed Notification hook

A `Notification` hook (`on-notification.sh`) existed briefly (added 2026-04-16, commit `1f55cfe`) and routed `notification_type` (`idle_prompt→done`, `permission_prompt|elicitation_dialog→wait`, `auth_success→nop`, unknown→log-only) into the state file. It was deleted one day later (commit `a17ef24`) as part of a deliberate simplification collapsing the state vocabulary from four values (`done`/`working`/`wait`/`dispatching`) to two (`idle`/`busy`). The task doc driving that change gives vocabulary simplification as the sole rationale — it does not mention background-agent tracking, and predates Claude Code's background/async-agent `Notification` subtypes (`agent_needs_input`, `agent_completed`, shipped v2.1.198, ~July 2026) by about 2.5 months. See `relates_to::[[stop-hook-subagent-detection]]` — that research recommends resurrecting a narrow, purpose-built `Notification` hook scoped only to these two subtypes to fix `relates_to::[[BUG-0001]]`, without reopening the full vocabulary TASK-009 deliberately removed.

## Debugging

Per the project's `claude-code/hooks-reference` Serena memory: confirm a hook fired at all by logging to `$STATE_DIR/hook.log`; check exit codes (2 = blocking, only for blockable events); capture full stdin payloads before writing logic against unconfirmed field names — exactly the step this project's own Notification-hook research recommends before wiring `agent_needs_input`/`agent_completed` into real dispatch logic.
