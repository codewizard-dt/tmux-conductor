---
topic: "What context is passed into the Stop hook, can we tell if sub-agents are still acting, and how could a sentinel-file design work for BUG-0001 (false idle during a sub-agent wait) across all idle-detection paths?"
slug: stop-hook-subagent-detection
researched: 2026-08-15
---

# Primary Sources — Stop hook payload, sub-agent-in-flight detection, and sentinel-file design

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | web | https://code.claude.com/docs/en/hooks | 2026-08-15 | `Stop`/`SubagentStop` JSON input schema; "Stop fires only after all subagent work has completely resolved" |
| S2 | serena memory | `claude-code/hooks-reference` (this project's Serena memory, synthesized ~Apr 2026 from `code.claude.com/docs/en/hooks`) | 2026-08-15 | Corroborating Stop/SubagentStop payload fields; full lifecycle-event table; original `Notification` subtype table (4 values, pre-v2.1.198) |
| S3 | web | WebSearch result citing Claude Code v2.1.198 release notes (title/snippet only, not deep-read) | 2026-08-15 | "As of v2.1.198 (July 1), background agents run by default, and the Notification hook fires `agent_needs_input` and `agent_completed` events for background sessions" |
| S4 | web | https://code.claude.com/docs/en/hooks (second, more careful fetch requesting verbatim quotes) | 2026-08-15 | Verbatim matcher-table listing for `Notification`: `permission_prompt, idle_prompt, auth_success, elicitation_dialog, elicitation_url_dialog, elicitation_complete, elicitation_response, agent_needs_input, agent_completed` |
| S5 | web | WebSearch cross-check for `"agent_completed" OR "agent_needs_input"` | 2026-08-15 | Independent corroboration that both values are real, documented notification types (not a summarization artifact of a single fetch) |
| S6 | codebase (git history) | `git show 1f55cfe:hooks/on-notification.sh` (commit 1f55cfe, "Complete tasks 007+008... per-event hooks with Notification routing", 2026-04-16) | 2026-08-15 | The original `on-notification.sh` implementation and its `idle_prompt/permission_prompt/elicitation_dialog/auth_success` routing table |
| S7 | codebase | `hooks/lib/write-state.js` (lines 19-112) | 2026-08-15 | Confirms `writeState()` never inspects `agent_id`/`agent_type` in the hook payload — writes state unconditionally based only on which script invoked it |
| S8 | codebase | `hooks/register-hooks.jq` (lines 63-69) | 2026-08-15 | Confirms `on-stop.js` is registered under `Stop` only, never `SubagentStop` or `Notification` |
| S9 | codebase (git history) | `git show a17ef24` (commit a17ef24, "Complete tasks 009+010: collapse hook state to idle/busy...", 2026-04-17) + `git show a17ef24:.docs/tasks/completed/009-hook-model-alignment.md` | 2026-08-15 | The commit that deleted `on-notification.sh`, one day after it was introduced; the task doc's stated objective ("collapse the agent-state vocabulary to two values") with no mention of background-agent tracking as a rejected use case |

## Excerpts

### S1 — Hooks reference (code.claude.com)
https://code.claude.com/docs/en/hooks
> "Stop fires only after all subagent work has completely resolved" — [paraphrased synthesis from the fetch tool's summary of the lifecycle diagram and the statement that Stop represents "the completion of the entire turn including all subagent completions"]. Stop input schema fields identified: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `effort.level`, `hook_event_name`, `last_assistant_message`, plus `agent_id`/`agent_type` "only in subagents."

### S4 — Hooks reference, verbatim matcher table (code.claude.com)
https://code.claude.com/docs/en/hooks
> "notification type" with example matcher values: `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `elicitation_url_dialog`, `elicitation_complete`, `elicitation_response`, `agent_needs_input`, `agent_completed`

### S3/S5 — Web search corroboration
> "The `agent_needs_input` notification type indicates a background agent needs input, while `agent_completed` indicates a background agent has finished (both introduced in v2.1.198). As of v2.1.198 (July 1), background agents run by default, and the Notification hook fires `agent_needs_input` and `agent_completed` events for background sessions."

### S6 — Original on-notification.sh (git history, commit 1f55cfe)
> ```
> #   idle_prompt        → done   Agent returned to idle; avoids overwriting Stop's "done"
> #                                with "wait" when a Notification fires after Stop.
> #   permission_prompt  → wait   Agent paused awaiting user approval; monitor treats as busy.
> #   elicitation_dialog → wait   Agent paused for MCP user input; monitor treats as busy.
> #   auth_success       → (nop)  Informational only; agent state is unchanged.
> #   <unknown>          → (nop)  Logs full payload to $STATE_DIR/hook.log for investigation.
> ```

### S9 — Task doc that removed the Notification hook (git history, commit a17ef24)
> "## Objective
> Collapse the agent-state vocabulary to two values (`idle`, `busy`) and align Claude Code hooks so only idle-transition events (`SessionStart`, `Stop`, `StopFailure`) write `idle` and only the busy-transition event (`UserPromptSubmit`) writes `busy`.
> ## Approach
> Drop the `Notification` hook entirely and add a `SessionStart` hook..."
