---
id: task-lifecycle-and-completion-semantics
title: Task Lifecycle and Completion Semantics for an Agent Queue
aliases: [Task Completion Semantics, Dispatched vs Completed]
updated: 2026-09-19
sources:
  - ../../../raw/research/multi-agent-infrastructure-requirements/index.md
confidence: inferred
tags: [task-queue, orchestration, sqlite, reliability, observability]
---

# Task Lifecycle and Completion Semantics for an Agent Queue

A queue that only knows "queued" and "popped" cannot support an orchestrator, because an orchestrator's whole job — verify, retry, reroute, escalate — depends on knowing what happened to a task *after* it was handed out. **tmux-conductor's queue today records dispatch, not completion.** `host-server/db.ts::popTask` sets `status='done'` and `completed_at` in the same atomic `UPDATE … RETURNING` that claims the row, so "done" means "sent to a pane". `dispatchTaskToAgent` takes command text only, so the `dispatch.jsonl` record has no task id, matched tier, or routing reason, and the chain enqueue → route → dispatch → transition → outcome cannot be reconstructed after the fact. `tasks` has no attempt, lease, result, failure, role, or dependency column.

**Reference designs all model the missing states.** SQLite job queues that survive crashes use claim → lease (visibility timeout) → acknowledge, with an attempt counter and a dead-letter state after N deliveries, accepting at-least-once delivery. Claude Code's own Agent Teams task list has file-locked claiming, `pending → in_progress → completed`, and dependencies that block claiming. The documented pitfall is a lease shorter than the work: a timeout of 0 re-enqueues live handlers and burns attempts. Because agent tasks run minutes to hours, a lease here should be renewed by a liveness signal (state-file mtime) rather than a fixed short timeout.

**Completion cannot be inferred from the idle signal alone.** The available signal is a turn end (`Stop` hook → `idle`). [[Pane-Idle Detection Cannot See Async Background Agent Work]] shows that signal is already unreliable when background sub-agents are in flight, and a multi-turn task that ends at an `awaiting` dialog is not complete either. A sibling repo (`tmux-agent-status`) makes the same design call, excluding `SubagentStop` because "subagents finishing doesn't mean the main agent is done." A completion contract therefore needs a second signal — the task id carried into the dispatch and acknowledged, or explicit human/UAT confirmation — plus an independent verification step (MAST's "verification gap").

**Minimum viable shape (recommendation, not shipped):** thread `task.id` through `popTask` → `dispatchTaskToAgent` → `dispatch.jsonl` and a `routing.jsonl`; separate `dispatched_at` from `completed_at`; add `attempts`, a failure reason, and a reroute counter that caps routing loops; renew leases from liveness. Every orchestrator shape, including the deterministic role router already accepted in DEC-0006, needs at least the first item. The `transitions.jsonl` precedent (record *why*, not just *that*) is the model.

> **Caveat:** this page is synthesis (`confidence: inferred`) — the codebase facts (`popTask` semantics, missing task id, missing columns) are verified against `host-server/db.ts` and `host-server/index.ts`; the recommended lifecycle is the report's proposal, not an implemented or decided design.

derived_from::[[Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)]]
relates_to::[[Pane-Idle Detection Cannot See Async Background Agent Work]]
relates_to::[[Dispatch-Path Parity (Two Dispatchers, One Gate)]]
relates_to::[[Observability for Agent Status Transitions]]
relates_to::[[Multi-Agent Orchestration Patterns (Orchestrator-Worker, Supervisor, Handoff)]]
relates_to::[[Claude Code Agent Teams]]
relates_to::[[Host Server]]
