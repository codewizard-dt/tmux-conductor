---
id: BUG-0002
aliases: [BUG-0002]
title: "Agent status badge shows 'no tasks' instead of 'waiting' while blocked on a UAT verdict prompt"
status: triaged
severity: high
priority: P2
created: 2026-08-17
updated: 2026-08-17
reporter: David Taylor
assignee: "—"
tags: frontend, dashboard, status-detection
linked_task: "—"
impact: "Affects any agent blocked on a prompt whose last line doesn't match AWAITING_PATTERN's trailing-?/[Y/n]/> shapes (observed with /uat-walk's 'Verdict? P/F/Fix/Skip'), while its queue is empty. Risk: the dashboard's primary needs-attention signal is wrong, so an operator scanning the agent list could miss an agent that is actually blocked waiting on them."
workaround: "None known — operator must open the agent's terminal/log directly to notice it's actually waiting on input, since the badge doesn't reflect it."
---

# BUG-0002 — Agent status badge shows 'no tasks' instead of 'waiting' while blocked on a UAT verdict prompt

## Environment

- OS: macOS (Darwin 25.3.0)
- Browser: Chrome
- App: tmux-conductor dashboard
- Runtime: host-server (Fastify) + `monitor.sh`
- Config: default `conductor.conf`, no overrides mentioned

## Steps to Reproduce

1. Start an agent running `/uat-walk` (a UAT test-case walkthrough) with no other tasks queued for that agent.
2. Let the skill present a test case and prompt for a verdict, ending with the line `Verdict? P/F/Fix/Skip` as the last non-blank line in the pane — the agent is now blocked waiting for the operator to type P/F/Fix/Skip.
3. Observe the agent's status badge on the dashboard while this prompt is showing.

## Expected Behavior

While the agent is blocked on the `Verdict? P/F/Fix/Skip` prompt (waiting on a human decision), the dashboard status badge should read "WAITING", the same as it does for other recognized prompts.

## Actual Behavior

The status badge read "NO TASKS" (the `empty` status, orange) instead of "WAITING", while the terminal/log was actively displaying the `Verdict? P/F/Fix/Skip` prompt and the Queued Tasks panel showed `(0)`. A transient elapsed-time footer readout ("Sautéed for 18s") was also visible at the same time but is not itself the relevant signal — the reporter confirmed the actual indicator that the agent was blocked-on-input is the `Verdict? P/F/Fix/Skip` prompt line, not the elapsed-time text.

Screenshot: `/Users/davidtaylor/Desktop/Screenshot 2026-08-15 at 9.07.34 PM.png`.

## Reproducibility

- **Frequency**: sometimes (reporter believes this likely happens every time this prompt pattern appears, but has not yet systematically verified across multiple occurrences)
- **First seen**: 2026-08-15
- **Last seen**: 2026-08-15

## Root Cause Analysis

> _(filled at `/bug-close`)_

## Resolution

> _(filled at `/bug-close`)_

## Related

> _(none yet)_
