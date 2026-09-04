---
id: idle-detection-vs-async-background-work
title: Pane-Idle Detection Cannot See Async Background Agent Work
updated: 2026-09-04
sources:
  - ../../raw/research/stop-hook-subagent-detection/index.md
  - ../../raw/research/bug-0001-background-agent-detection/index.md
confidence: ambiguous
tags: [dispatch, subagents, orchestration, claude-code]
---

# Pane-Idle Detection Cannot See Async Background Agent Work

Any orchestrator that dispatches the "next" unit of work based on "the agent's pane/session looks idle" carries a hidden assumption: that turn-completion and work-completion are the same event. **Claude Code's background/async agent feature (shipped v2.1.198) breaks that assumption on purpose** — an agent can dispatch detached background work and correctly end its own turn (a genuine, correct `Stop`/idle transition) while the work it cares about is still running, resuming later via an out-of-band notification.

This means a hook-driven or pane-text-driven idle signal is a **necessary but not sufficient** condition for "safe to dispatch the next queued unit of work" whenever the orchestrated agent is allowed to spawn this kind of detached work. The `Stop` hook's payload carries no field for "I have outstanding background work" at all.

> **Contradiction / refinement (2026-09-04):** the original claim above — that this information "only exists in Claude Code's own internal task-notification system" — turns out to be incomplete. **The `Notification` event subtypes are themselves also incomplete**: current docs confirm `agent_needs_input` fires only when a background agent needs a decision, never as a general "still running" ping, so an agent working autonomously without ever needing input produces *no* notification-system signal either, until it fires `agent_completed` at the end. The one place "background work still outstanding, nothing needed" *is* observable turns out to be **pane text** after all — the interactive prompt footer's `←` hint (`← for agents` when agents are active but none need input, distinct from `← N agents` when N do). See `relates_to::[[bug-0001-background-agent-detection]]` for the full finding; this means the event-driven sentinel described below is necessary but not sufficient on its own, and needs a pane-text-based complementary signal (the same class of mechanism this codebase already uses for `AWAITING_PATTERN`) to actually close the false-idle window for the common no-input-needed case.

**The fix shape that survives arbitrarily long background work is event-driven, not time-boxed** — this part still holds, just not sufficient alone (see above). A fixed grace period ("wait N poll cycles before trusting idle") only shrinks the false-positive window; it doesn't close it, and it actively fails for long-running background agents (the exact case that matters most). The robust pattern is a **sentinel** — some durable signal, external to the raw busy/idle state, that's set when background work is dispatched and cleared when Claude Code reports it resolved (via the notification subtype above, or a pane-text match), with dispatch gated on the sentinel being clear **in addition to** idle. A staleness/TTL fallback is still required (mirroring `uses::[[tmux-conductor]]`'s existing `stalled`-after-2×POLL_INTERVAL pattern) so a missed or misunderstood notification can't wedge the queue forever — but the fallback should be generous (tolerating real long-running work), not the primary mechanism.

First identified via `derived_from::[[BUG-0001]]` in `uses::[[tmux-conductor]]` — see `relates_to::[[stop-hook-subagent-detection]]` for the concrete hook-payload research, `relates_to::[[bug-0001-background-agent-detection]]` for the 2026-09-04 refinement above, and `relates_to::[[Claude Code Hooks]]` for this project's own hook history (a `Notification` hook existed once, removed for an unrelated reason, before this async-agent feature even existed, then re-added for this bug's fix).
