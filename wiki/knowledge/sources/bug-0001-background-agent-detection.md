---
id: bug-0001-background-agent-detection
title: "BUG-0001 Background-Agent Detection: Payload Shape and Implementation Options"
updated: 2026-09-04
sources:
  - ../../raw/research/bug-0001-background-agent-detection/index.md
confidence: extracted
tags: [claude-code, hooks, subagents, dispatch, bug-0001]
---

# BUG-0001 Background-Agent Detection: Payload Shape and Implementation Options

Follow-up to `relates_to::[[stop-hook-subagent-detection]]` (2026-08-15), which left two questions as unconfirmed inference before `derived_from::[[BUG-0001]]`'s sentinel fix shipped. This research resolves one of them directly from current documentation, and surfaces a signal neither the original research nor the fix considered.

**Resolved: `agent_needs_input` fires only when a background agent genuinely needs a decision — never as a general "still running" heartbeat.** This means BUG-0001's shipped fix (a sentinel written on `agent_needs_input`, cleared on `agent_completed`) **does not protect the scenario that motivated the bug report**: an autonomous background sub-agent that runs to completion without ever needing input never triggers the event that would create its sentinel. `agent_completed` does reliably fire on both success and failure, so the *clearing* side of the existing design is sound — the gap is entirely on the *seeding* side.

**Still unresolved: no documented per-agent correlator for the `Notification` payload.** The `agent_id`/`agent_type` common hook fields exist but describe whether the *current hook-firing process* is itself a subagent — not which background job a notification is about. Background sessions do have their own short IDs (directory names under `~/.claude/jobs/<id>`) and a `sessionId`, but no source confirms these surface on the Notification payload specifically.

**New finding: the interactive prompt footer is a documented, more precisely-scoped alternative signal.** `← N agents` (N need input), `← for agents` (agents active, none need input — the exact missing case), `← N done` (transient). This is pane-observable, the same class of signal `uses::[[tmux-conductor]]`'s existing `AWAITING_PATTERN` mechanism already relies on for a structurally identical problem (Claude Code exposes no hook for "waiting on a human" either). The one gap: whether `← for agents` appears with zero background agents ever dispatched is not confirmed by documentation, and would need one live look (no global config required) before a pattern is safe to ship — a wrong assumption here would permanently block dispatch, worse than the original bug.

Recommendation: build a pane-text heuristic off the footer hint as the primary mechanism (mirroring `AWAITING_PATTERN`'s existing design), keep the hook-based sentinel as a secondary signal for the narrower "needs input" case it already covers correctly, and defer live Notification-payload capture (which requires installing hooks into `~/.claude/settings.json`, a machine-wide change outside this repo) since it wouldn't resolve the actual gap even if it succeeded.

relates_to::[[stop-hook-subagent-detection]]
relates_to::[[idle-detection-vs-async-background-work]]
relates_to::[[Claude Code Hooks]]
relates_to::[[Claude Code CLI]]
