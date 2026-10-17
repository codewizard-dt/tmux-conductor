---
id: llm-orchestrator-runtime-options
title: LLM Orchestrator Runtime Options (tmux Agent vs. claude -p vs. Agent SDK)
aliases: [Orchestrator Runtime, Orchestrator Brain Runtime]
updated: 2026-09-19
sources:
  - ../../../raw/research/multi-agent-infrastructure-requirements/index.md
confidence: ambiguous
tags: [orchestration, claude-code, agent-sdk, quota, cost-control]
---

# LLM Orchestrator Runtime Options (tmux Agent vs. claude -p vs. Agent SDK)

If tmux-conductor ever adds an LLM triage step for tasks a deterministic rule cannot place, that step needs somewhere to run. **`host-server` has no Claude runtime today** — its dependencies are Fastify, better-sqlite3, and dotenv — so round 1's assumption of "existing Claude API/Agent SDK access from host-server" was wrong. Three realistic options:

| Option | Shape | Notable properties |
|---|---|---|
| **W. tmux agent** | A long-lived agent row prompted to triage the queue | No new code; inherits BUG-0001 idle unreliability; full pane authority (the widest blast radius); costs a whole agent slot |
| **Y. `claude -p` subprocess** | A managed loop (like the `schedule poll`) spawns `claude -p --output-format json --max-turns N`, parses JSON, enqueues via `POST /queue/:agent` | No new dependency (host-server already shells out to tmux/git); JSON carries `session_id` and `total_cost_usd`; `--resume` supported; `--max-turns` caps runaway; `--bare` skips hook/skill/MCP discovery |
| **Z. Claude Agent SDK** | Import the SDK and call `query()` | Typed `maxTurns`, `maxBudgetUsd`, subagent depth/concurrency env caps, `resume`; adds the first Anthropic dependency and an auth/billing question |

The report recommends **Y as the first LLM step, and only after measurements justify one** — enqueue-only (never `/agents/:agent/keys`, per [[Agent as Tool vs. Subagent (Conversational Authority)]]), gated behind "no deterministic match", every decision logged to a `routing.jsonl`. Z becomes preferable if Anthropic clarifies subscription treatment of programmatic use or the project moves to API-key billing.

> **Unresolved (assumption A8):** how programmatic (`claude -p`/SDK) usage is billed relative to the interactive subscription is reportedly in flux (a planned separation of Agent SDK credit was "paused on the effective date", second-hand). Verify against current Anthropic billing documentation before choosing Y or Z. All runtime options draw on the same shared 5-hour/weekly quota pool the system cannot observe (see [[Claude Subscription Usage-Signal Gap]]), so any automated step needs a local concurrency cap and budget guard first.

> **Contradiction (2026-09-20):** this page (and its source) deferred option W, the orchestrator as a tmux agent, as the widest-blast-radius shape. The user has since asked for exactly that — an `orchestrator` *role* on an ordinary agent that manages tmux-window agents and bg processes. [[An `orchestrator` Agent Role That Manages tmux-Window Agents and Background Processes]] reconciles them by scoping W to **lifecycle management only** (no routing, no completion tracking), acting through existing routes with server-side guardrails and audit ([[Agent Role as Capability Grant, Not Permission Wall (No-Auth Trust Model)]]). That narrows what the orchestrator *does* but not what it *can* do: it still runs with `--dangerously-skip-permissions`, so the blast-radius concern stands as accepted residual risk.

derived_from::[[Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)]]
relates_to::[[An `orchestrator` Agent Role That Manages tmux-Window Agents and Background Processes]]
relates_to::[[Multi-Agent Orchestration Patterns (Orchestrator-Worker, Supervisor, Handoff)]]
relates_to::[[Claude Subscription Usage-Signal Gap]]
relates_to::[[Agent as Tool vs. Subagent (Conversational Authority)]]
relates_to::[[Claude Code CLI]]
relates_to::[[Host Server]]
