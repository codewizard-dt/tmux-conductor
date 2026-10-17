---
id: multi-agent-infrastructure-requirements
title: Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)
aliases: [Orchestrator Infrastructure Requirements, Multi-Agent Infrastructure Research]
updated: 2026-09-19
sources:
  - ../../../raw/research/multi-agent-infrastructure-requirements/index.md
  - ../../../raw/research/multi-agent-infrastructure-requirements/sources.md
confidence: ambiguous
tags: [orchestration, multi-agent, infrastructure, task-queue, host-server, quota, security]
---

# Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)

Research 2026-09-19 that asks what must exist **underneath** any orchestrator shape — a question the three rounds in [[An Orchestrator Agent That Routes Commands/Tasks to Other Agents]] never asked, because they compared shapes (deterministic router, LLM router, ephemeral worker, orchestrator pane) rather than prerequisites. **Headline: the queue is safe under concurrency but has no concept of a task finishing.** `popTask` claims atomically (one `UPDATE … RETURNING`) and both SQLite openers use WAL with a 5000 ms busy timeout, but it flips a task to `done` at *dispatch* time; `dispatchTaskToAgent` receives command text only, so `dispatch.jsonl` carries no task id, tier, or routing reason; and `tasks` has no attempt, lease, result, dependency, or role column. See [[Task Lifecycle and Completion Semantics for an Agent Queue]].

**Two dispatchers, one sentinel gate.** The host-server's `pollAndDiff` and the bash `monitor.sh` (which the host-server itself re-launches via `healMonitorWindow`) both pop tasks. The BUG-0001 pending-agents sentinel is checked at exactly two sites, both in `host-server/index.ts`; nothing under `scripts/` references it *(inferred from an absence-of-match search — needs a runtime test)*. See [[Dispatch-Path Parity (Two Dispatchers, One Gate)]].

**An LLM-calling orchestrator needs a runtime the host-server does not have, plus cost and blast-radius controls.** host-server has no Anthropic or Agent SDK dependency; quota control is `USAGE_CHECK_CMD='true'` against a single shared 5-hour/weekly pool; every agent launches with `--dangerously-skip-permissions`. Three runtime options are compared in [[LLM Orchestrator Runtime Options (tmux Agent vs. claude -p vs. Agent SDK)]]. Worktrees are necessary but not sufficient for parallel coding agents (they defer conflicts to merge time and leave ports/DBs shared), so DEC-0006's ephemeral fallback additionally needs a merge function, a serialized merge queue, an orphan reaper, and per-worktree environment isolation — see [[Ephemeral Worker-Per-Task Coding Agent Orchestration]].

**Recommendation:** tiered build order, infrastructure before brain — Tier 0 (correlation id, task lifecycle, dispatcher parity, then [[DEC-0006-task-routing-and-worker-provisioning|DEC-0006#D1]]'s role tier) → Tier 1 (local budget/concurrency guard, then an enqueue-only `claude -p` triage step, only if measurements justify) → Tier 2 (merge queue, human-confirmed teardown, orchestrator pane). The report ends with a 12-row **assumptions register** (A1-A12) that seeds the roadmap's Phase 0 audit. The sibling repos `tmux-agent-status` and `claude-code-lsp-enforcement-kit` were finally inspected (closing round 2/3's open gap) and contain no routing or queue logic — but they show the same hazards this repo has (lock-free shared state files, cwd-keyed hook state, permissions skipped, fail-open policy hooks).

> **Contradiction (vs. round 3, `index-3.md`):** round 3 recommended adding `role` and `description` columns to `agents`. `agents.role` already exists (schema v7, 7-value CHECK enum); only `description` remained, and it is already filed as `TASK-0199`. Round 3 was written the day after `DEC-0006` and did not cite it.

> **Contradiction (vs. round 1, `index.md`):** round 1's comparison table listed an LLM router's dependency as "Existing Claude API/Agent SDK access from host-server". `host-server/package.json` has no such dependency (Fastify, better-sqlite3, dotenv only).

> **Contradiction (vs. DEC-0006's gate):** DEC-0006 says to revisit the fallback's human-confirmation gate "when TASK-133 unblocks". `TASK-0184` has since shipped a different mitigation (job-state correlation for status display), but `TASK-133` is still `todo` and `BUG-0001` still `in-progress`, so the gate condition is unchanged.

> **Partial fill of a prior gap:** round 3 found no coding-specific token multiplier. This report finds one second-hand figure — Agent Teams ≈7x tokens in plan mode (attributed to Anthropic via Faros) — versus the 4x/15x chat/research figures earlier rounds imported. Still not first-party; treat as unresolved.

derived_from::[[An Orchestrator Agent That Routes Commands/Tasks to Other Agents]]
relates_to::[[Task Lifecycle and Completion Semantics for an Agent Queue]]
relates_to::[[Dispatch-Path Parity (Two Dispatchers, One Gate)]]
relates_to::[[LLM Orchestrator Runtime Options (tmux Agent vs. claude -p vs. Agent SDK)]]
relates_to::[[Multi-Agent Orchestration Patterns (Orchestrator-Worker, Supervisor, Handoff)]]
relates_to::[[Ephemeral Worker-Per-Task Coding Agent Orchestration]]
relates_to::[[Specialized-Agent Registry / Catalog Pattern]]
relates_to::[[Pane-Idle Detection Cannot See Async Background Agent Work]]
relates_to::[[Claude Subscription Usage-Signal Gap]]
relates_to::[[Host Server]]
relates_to::[[Claude Code CLI]]
