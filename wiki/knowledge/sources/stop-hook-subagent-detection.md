---
id: stop-hook-subagent-detection
title: Stop Hook Payload, Sub-Agent Detection, and a Sentinel-File Design for BUG-0001
updated: 2026-08-15
sources:
  - ../../raw/research/stop-hook-subagent-detection/index.md
confidence: extracted
tags: [claude-code, hooks, subagents, dispatch, bug-0001]
---

# Stop Hook Payload, Sub-Agent Detection, and a Sentinel-File Design for BUG-0001

Researched to root-cause `derived_from::[[BUG-0001]]` — a `uses::[[tmux-conductor]]` agent got dequeued into a false idle state while genuinely waiting on a background sub-agent. **The `Stop` hook's own JSON payload (`session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `effort.level`, `hook_event_name`, `last_assistant_message`, plus `agent_id`/`agent_type` only when fired inside a subagent) has no field revealing outstanding background work**, and per Anthropic's docs, `Stop` is documented to fire only after all *synchronous* Task-tool sub-agent work has resolved (`SubagentStart`/`SubagentStop` bracket it, nested inside the outer turn).

BUG-0001's incident doesn't fit that synchronous model — the reporter observed the pane come to a genuine, full stop (not a spinner) while explicitly waiting on a background sub-agent. **This matches Claude Code's background/async agent feature, shipped in v2.1.198 (~July 1, 2026)**: the outer turn legitimately ends (a real, correct `Stop`) while a background agent keeps running, and the session resumes later via Claude Code's own async task-notification machinery — a `Notification` hook event with `notification_type: agent_needs_input` or `agent_completed`, both new subtypes not present before v2.1.198.

**This project used to have a `Notification` hook** (`hooks/on-notification.sh`, added 2026-04-16, removed one day later in commit `a17ef24` — see `uses::[[Claude Code Hooks]]`) as part of a deliberate 4-state→2-state (`idle`/`busy`) simplification (TASK "009"). The removal predates background-agent notification support by ~2.5 months and its rationale (vocabulary simplification) says nothing about rejecting Notification as a signal source — so resurrecting a *narrow*, purpose-built Notification hook (only these two new subtypes feed a sentinel; everything else stays a no-op) doesn't conflict with that earlier decision.

**Recommended fix shape**: an event-driven sentinel (one file per outstanding background agent, not a shared counter, to avoid read-modify-write races), populated/cleared by a re-added `Notification` hook once its exact payload semantics are confirmed via a live capture, gating `scripts/monitor.sh`'s dispatch call site (and the future `host-server` `pollAndDiff` path once `relates_to::[[TASK-120]]`/`relates_to::[[TASK-121]]` land) in addition to `is_idle()`. A fixed N-poll-cycle grace period was explicitly rejected by the reporter as insufficient for long-running sub-agent waits — the sentinel must be arbitrarily long-lived with a generous staleness fallback (mirroring the existing `stalled` derived-status pattern) rather than time-boxed.

Two concrete unknowns remain and need a live payload capture before implementation: (1) exact semantics/fields of `agent_needs_input` vs `agent_completed` (does the payload carry a correlator like `agent_id`?), and (2) whether a background/async agent dispatch is syntactically distinguishable from a synchronous one at `PreToolUse` time, which would be needed for a self-contained "started" signal.

relates_to::[[Claude Code CLI]]
relates_to::[[Claude Code Hooks]]
