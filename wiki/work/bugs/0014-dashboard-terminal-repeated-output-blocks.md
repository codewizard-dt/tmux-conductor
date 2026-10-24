---
id: BUG-0014
aliases: [BUG-0014]
title: "Dashboard Interact terminal shows repeated blocks of agent output"
status: open
severity: medium
priority: —
created: 2026-10-17
updated: 2026-10-17
reporter: David Taylor
assignee: unassigned
tags: —
impact: "—"
workaround: "—"
linked_task: "—"
---

# BUG-0014 — Dashboard Interact terminal shows repeated blocks of agent output

## Environment

- OS: macOS (Darwin 25.3.0)
- App: tmux-conductor @ `f351966` (main branch, working tree had uncommitted changes at time of report)
- Runtime: host-server (Fastify) + React dashboard, Interact mode ("DIRECT INPUT — KEYS GO TO TASK-233") on a running Claude Code agent
- Config: default `conductor.conf`, no overrides mentioned

## Steps to Reproduce

The trigger is not pinned down; the reporter recalls it usually happens after leaving the agent and coming back.

1. Open the dashboard and view a running Claude Code agent in Interact mode.
2. Navigate away from that agent (another agent or page).
3. Return to the agent.

## Expected Behavior

The terminal view shows the pane content once, in order, matching the agent's tmux pane.

## Actual Behavior

The same blocks of agent output appear repeated many times, interleaved with partial fragments. In the screenshot, the "1. Remove the leaked vars from the running tmux server's global environment (run each one):" list and the `tmux set-environment -g -u DATABASE_URL / HOST_SERVER_URL / PUBLIC_API_URL / PUBLIC_BASE_URL` lines each repeat roughly eight times, and the "2. Delete the stale lines ..." / "3. Windows that are already running ..." / "4. Rotate the DigitalOcean ..." blocks appear twice. Lines from different blocks are cut off mid-line (for example "rough `state.test.ts` and `verify-awaiting-detection.sh`, extend the bash expected-state mapping"). The agent's actual response, shown once at the bottom of the same view, is not duplicated.

Screenshot: `tmp/dashboard-drops/1792234638189-Screenshot-2026-10-17-at-5.57.15-AM.png`

## Reproducibility

- **Frequency**: sometimes
- **First seen**: 2026-10-17 (this occurrence)
- **Last seen**: 2026-10-17
- **Notes**: reporter thinks it follows leaving the agent and returning. Next occurrence: note whether the underlying tmux pane (`tmux capture-pane`) is also duplicated, which separates a dashboard rendering/replay problem from a pane problem.

## Root Cause Analysis

> Filled in during triage / on close — see `/bug-triage` and `/bug-close`.

## Resolution

> Filled in on close — see `/bug-close`.

## Related

- Evidence: `tmp/dashboard-drops/1792234638189-Screenshot-2026-10-17-at-5.57.15-AM.png`
