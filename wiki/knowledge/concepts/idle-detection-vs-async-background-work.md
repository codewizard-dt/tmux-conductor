---
id: idle-detection-vs-async-background-work
title: Pane-Idle Detection Cannot See Async Background Agent Work
updated: 2026-08-15
sources:
  - ../../raw/research/stop-hook-subagent-detection/index.md
confidence: extracted
tags: [dispatch, subagents, orchestration, claude-code]
---

# Pane-Idle Detection Cannot See Async Background Agent Work

Any orchestrator that dispatches the "next" unit of work based on "the agent's pane/session looks idle" carries a hidden assumption: that turn-completion and work-completion are the same event. **Claude Code's background/async agent feature (shipped v2.1.198) breaks that assumption on purpose** — an agent can dispatch detached background work and correctly end its own turn (a genuine, correct `Stop`/idle transition) while the work it cares about is still running, resuming later via an out-of-band notification.

This means a hook-driven or pane-text-driven idle signal is a **necessary but not sufficient** condition for "safe to dispatch the next queued unit of work" whenever the orchestrated agent is allowed to spawn this kind of detached work. Neither the `Stop` hook's payload nor pane text carries any field for "I have outstanding background work" — that information only exists in Claude Code's own internal task-notification system, surfaced (as of v2.1.198) through two new `Notification` event subtypes: `agent_needs_input` and `agent_completed`.

**The fix shape that survives arbitrarily long background work is event-driven, not time-boxed.** A fixed grace period ("wait N poll cycles before trusting idle") only shrinks the false-positive window; it doesn't close it, and it actively fails for long-running background agents (the exact case that matters most). The robust pattern is a **sentinel** — some durable signal, external to the raw busy/idle state, that's set when background work is dispatched and cleared when Claude Code reports it resolved (via the notification subtype above), with dispatch gated on the sentinel being clear **in addition to** idle. A staleness/TTL fallback is still required (mirroring `uses::[[tmux-conductor]]`'s existing `stalled`-after-2×POLL_INTERVAL pattern) so a missed or misunderstood notification can't wedge the queue forever — but the fallback should be generous (tolerating real long-running work), not the primary mechanism.

First identified via `derived_from::[[BUG-0001]]` in `uses::[[tmux-conductor]]` — see `relates_to::[[stop-hook-subagent-detection]]` for the concrete hook-payload research and `relates_to::[[Claude Code Hooks]]` for this project's own hook history (a `Notification` hook existed once, removed for an unrelated reason, before this async-agent feature even existed).
