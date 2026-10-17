---
id: agent-role-capability-grant
title: Agent Role as Capability Grant, Not Permission Wall (No-Auth Trust Model)
aliases: [Orchestrator Guardrails, Role Grant vs Permission Wall]
updated: 2026-09-20
sources:
  - ../../../raw/research/orchestrator-role-fleet-control/index.md
confidence: inferred
tags: [orchestration, security, roles, authorization, least-agency, host-server]
---

# Agent Role as Capability Grant, Not Permission Wall (No-Auth Trust Model)

When a system has **no authentication**, a role cannot *deny* anything to callers who don't present it. In tmux-conductor a request without the caller header is treated as a human/dashboard call (TASK-0194's rule), every agent is launched with `--dangerously-skip-permissions`, and an agent living in a tmux pane can call `tmux` directly. So a rule of the form "only `orchestrator` agents may spawn or close windows" is **unenforceable**: an ordinary agent simply omits the header.

What a server-side role check *can* do is three things, and the design should claim only these:

1. **Grant** — define which routes an orchestrator caller is expected to use (list/tail, spawn, window open/close/reopen, enqueue, bg open/close/restart/tail) and *exclude* the rest (`/keys`, `/mode`, agent delete).
2. **Constrain recognised callers** — once a caller resolves to an orchestrator, apply extra guardrails the human path doesn't have: refuse **self-target** (closing or deleting its own window), refuse an orchestrator creating another `role=orchestrator` (depth cap 1), enforce a **max-active-agents** cap, require **human confirmation** for destructive verbs, and apply cooldowns to close/reopen loops.
3. **Attribute** — write one audit record per action with caller id, verb, target and outcome.

This is the "complete mediation" and "least agency" advice from agent-security guidance applied honestly: validate requests server-side against policy rather than trusting the model, gate high-impact actions behind approval, and recognise that an agent can stay within its permissions and still act inappropriately. The guardrails address **mistakes and runaway loops**, not an adversary; state that caveat wherever the guard is documented, as TASK-0194 does for its bg-restart guard.

**Identity should be the numeric agent id.** The window-name header is ambiguous for some project/agent name pairs (the `a-b`+`c` vs `a`+`b-c` case), and a guard that fails closed on ambiguity would lock an orchestrator out. Export `CONDUCTOR_AGENT_ID` (and `CONDUCTOR_ROLE`) at spawn beside the existing `CONDUCTOR_AGENT_NAME`. tmux's own `TMUX_PANE` (set once at pane creation, inherited by descendants, never revised) is an available cross-check, not a v1 requirement.

**Give the role an effect that doesn't need a worktree.** The existing role→prompt path writes into a worktree's `CLAUDE.md` only. Options for a non-worktree agent: an env var plus a skill that reads it; or `--append-system-prompt-file` (documented as appending for the current invocation only), which is Claude-specific and must be gated by `detectAgentType(launchCmd)` so it never corrupts a Codex/custom launch command — the same gate flagged in [[Host Server]] for any flag injection.

**If auth ever arrives** (agents outside the host, a multi-user dashboard), the same design upgrades cleanly: replace the header with a signed per-agent token and the guardrails become a real boundary.

derived_from::[[An `orchestrator` Agent Role That Manages tmux-Window Agents and Background Processes]]
relates_to::[[Agent as Tool vs. Subagent (Conversational Authority)]]
relates_to::[[Remote Access Security Model: Network Admission, Not Application Auth]]
relates_to::[[Background Process Registry (bg_processes) — Mechanism and Gaps]]
relates_to::[[Claude Code Instruction Placement (CLAUDE.md vs. Rules vs. Launch Flags)]]
relates_to::[[Host Server]]
