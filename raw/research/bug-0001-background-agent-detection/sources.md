---
topic: "What does the Claude Code Notification hook payload actually carry for agent_needs_input/agent_completed, and how would each of two implementation options for BUG-0001 (pane-text heuristic vs. live hook-payload capture) actually be built — is the best answer both?"
slug: bug-0001-background-agent-detection
researched: 2026-09-04
---

# Primary Sources — BUG-0001 background-agent detection

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | web | https://code.claude.com/docs/en/agent-view | 2026-09-04 | Confirmed `agent_needs_input` fires only when a background session starts needing input; `agent_completed` fires on finish *or* fail; documented the prompt-footer hint's three states |
| S2 | web | https://code.claude.com/docs/en/hooks | 2026-09-04 | Full "Common input fields" table for all hook events; confirmed `agent_id`/`agent_type` are scoped to "the hook fires inside a subagent," not a correlator for background-job notifications; confirmed full current `Notification` matcher-type list; confirmed no `subagent_id`/`task_id`/`job_id` field found on the page |
| S3 | web | https://code.claude.com/docs/en/agent-view | 2026-09-04 | Verbatim full paragraph on the prompt-footer `←` hint (`← 2 agents` / `← for agents` / `← 2 done`); background sessions' short IDs under `~/.claude/jobs/<id>` and `sessionId` |
| S4 | web | https://github.com/anthropics/claude-code/issues/45781 | 2026-09-04 | Corroborates the same structural gap (no clean signal for "background agents active, none need input") as a known, real-world pain point independent of this repo; closed as not-planned, no payload details |
| S5 | codebase | `hooks/on-notification.js` | 2026-09-04 | Current sentinel implementation: writes on `agent_needs_input`, FIFO-clears on `agent_completed`, no correlator assumed |
| S6 | codebase | `host-server/pendingAgents.ts::hasPendingBackgroundAgents` | 2026-09-04 | Staleness-fallback gate logic, the two call sites it's used from |
| S7 | codebase | `host-server/index.ts` (~line 925, ~line 2425) | 2026-09-04 | The two exact dispatch-gate integration points any new signal needs to plug into |
| S8 | codebase | `conductor.conf::AWAITING_PATTERN`, `scripts/monitor.sh::is_idle()`, `host-server/state.ts::matchesAwaiting()` | 2026-09-04 | The existing precedent this repo already uses for "Claude Code exposes no hook, so match pane text instead," including its false-positive-avoidance design and staleness philosophy |
| S9 | codebase | `raw/research/stop-hook-subagent-detection/index.md` | 2026-09-04 | Prior (2026-08-15) research this fix was built from — the two questions it left as unconfirmed inference are what this report resolves/refines |

## Excerpts

### S1 — Manage multiple agents with agent view
https://code.claude.com/docs/en/agent-view
> While agent view is open, Claude Code also sends a notification through your configured terminal notification channel when a local background session starts needing your input, finishes, or fails... Notifications use the same `preferredNotifChannel` setting as the rest of Claude Code and fire the `Notification` hook with the `agent_needs_input` or `agent_completed` type.

### S2 — Hooks reference
https://code.claude.com/docs/en/hooks
> `agent_id` — Unique identifier for the subagent. Present only when the hook fires inside a subagent call. Use this to distinguish subagent hook calls from main-thread calls.
>
> `agent_type` — Agent name (for example, "Explore" or "security-reviewer"). Present when the session uses `--agent` or the hook fires inside a subagent.
>
> Notification matcher values: `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `elicitation_url_dialog`, `elicitation_complete`, `elicitation_response`, `agent_needs_input`, `agent_completed`, `quota_auto_resume_fired`, `quota_auto_resume_stale`, `quota_auto_resume_disabled`

### S3 — Manage multiple agents with agent view (footer hint paragraph, full verbatim)
https://code.claude.com/docs/en/agent-view
> Inside a regular `claude` session, the prompt footer's `←` hint counts the background agents that are waiting on you, such as `← 2 agents`, and returns to `← for agents` when none need input. Counts above 99 show as `99+`. The count refreshes about every ten seconds while the terminal is focused and immediately when focus returns. It briefly changes color when it moves and when an agent completes, and when a background session finishes while none need your input it briefly shows the number completed, such as `← 2 done`. Both flashes are off when the `prefersReducedMotion` setting is on, and the hint is hidden in screen reader mode.
>
> Every background session has a short ID you can use from the shell. The ID is printed when you start a session with `claude --bg`, and each session's ID is its directory name under `~/.claude/jobs/`.

### S4 — GitHub issue: Add BackgroundTasksIdle notification event
https://github.com/anthropics/claude-code/issues/45781
> As a user, I get pinged repeatedly for intermediate status messages while agents are still running in the background. The only notification I care about is when all work is truly done and Claude needs my input.
