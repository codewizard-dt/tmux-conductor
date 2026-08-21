---
id: BUG-0001
aliases: [BUG-0001]
title: "Main agent falsely marked idle while waiting on a background sub-agent (Task tool), causing premature task dequeue"
status: in-progress
severity: critical
priority: P1
created: 2026-08-15
updated: 2026-08-15
reporter: David Taylor
assignee: "—"
tags: host-server, dispatch, hooks, subagents
impact: "Affects any agent running a skill that spawns background Task-tool sub-agents (observed with /power-mode) while it has additional queued tasks behind the current one. Risk: task-queue ordering guarantee (one task at a time per agent) is violated — a queued task can dispatch into an agent that is still mid-turn, waiting on its own sub-agent work."
workaround: "Avoid queuing follow-on tasks during sub-agent-heavy skills — manually hold off queuing the next /power-mode (or similar) task until the current one, including its sub-agents, has actually finished. Process workaround only, not a fix."
linked_task: "[[TASK-120]], [[TASK-121]]"
---

# BUG-0001 — Main agent falsely marked idle while waiting on a background sub-agent (Task tool), causing premature task dequeue

## Environment

- OS: macOS (Darwin 25.3.0)
- App: tmux-conductor @ `e8b9c65` (main branch, working tree had uncommitted changes at time of report)
- Runtime: host-server (Fastify) + `monitor.sh`
- Config: default `conductor.conf`, no overrides mentioned

## Steps to Reproduce

1. Start an agent running a skill that spawns background sub-agents via the Task/Agent tool (observed with `/power-mode`) while the agent also has additional tasks queued behind the current one.
2. Let the sub-agent run in the background while the main agent's turn is still open (main agent shows "Cogitating…" / thinking, not yet returned to a prompt).
3. Observe the dashboard/monitor treat the agent as idle during this wait.
4. Observe the next queued task (e.g. next `/power-mode` roadmap item) gets dispatched before the current one's work (including its sub-agent) has actually finished.

## Expected Behavior

The agent should remain marked busy for the duration of the entire turn, including any time spent waiting on background sub-agents (e.g. Task-tool agents dispatched via `/power-mode` or the Workflow tool) it spawned as part of that turn. No queued task should be dispatched to that agent until its current turn — and all sub-agent work it is waiting on — has genuinely completed.

## Actual Behavior

While `cryptwiz-1` was mid-turn — actively "Cogitating…" and waiting on a background `Agent(UAT auto TASK-109)` sub-agent it had spawned via `/power-mode`, with 3 more `/power-mode` roadmap tasks still queued behind the current one — the agent's status was (at least transiently) read as idle, and the next queued task was dequeued/dispatched prematurely, before the current task's sub-agent work had finished.

Screenshot captured mid-incident: `tmp/dashboard-drops/1786838260573-Screenshot-2026-08-15-at-6.54.17-PM.png`.

Note: the `TASK-109`/`UAT-109` visible in the screenshot belongs to the **cryptwiz** project's own task tracking (a separate project this conductor instance was orchestrating), not this repo's `TASK-109` — numbering coincidence only.

## Reproducibility

- **Frequency**: always (per reporter: "always, as long as there are subagents running and the main agent is waiting")
- **First seen**: 2026-08-15
- **Last seen**: 2026-08-15

## Root Cause Analysis

> _(filled at `/bug-close`)_

## Resolution

> _(filled at `/bug-close`)_

## Related

`relates_to::[[TASK-120]]`, `relates_to::[[TASK-121]]` — flagged as possibly the same idle-detection/dispatch-triggering code path (both still `todo` as of filing), not confirmed. See `wiki/work/tasks/TASK-120-collapse-dispatch-into-status-poll.md` and `wiki/work/tasks/TASK-121-remove-redundant-monitor-dispatch.md`.
