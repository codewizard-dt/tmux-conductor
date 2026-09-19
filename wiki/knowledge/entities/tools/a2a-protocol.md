---
id: a2a-protocol
title: A2A Protocol
aliases: [Agent2Agent Protocol, Agent-to-Agent Protocol]
updated: 2026-09-13
sources:
  - ../../../raw/research/orchestrator-agent-routing/index-2.md
confidence: extracted
tags: [protocol, multi-agent, interoperability, standard]
---

# A2A Protocol

Agent2Agent (A2A) is an open protocol, originated by Google (announced April 2025) and now governed by the Linux Foundation, standardizing how one AI agent discovers and delegates a task to another agent **regardless of vendor or underlying framework**. It is complementary to (not competing with) MCP: MCP standardizes agent-to-*tool* access, while A2A standardizes agent-to-*agent* delegation. AutoGen and CrewAI are both adding A2A compatibility for cross-framework interop.

Two mechanisms make it directly relevant to a task-routing orchestrator: an **Agent Card** (published at a well-known URI, `/.well-known/agent-card.json`) is a standardized capability-advertisement document a delegating agent reads before routing work — functionally the same "capability taxonomy" a bespoke tags-column router would need to invent, but as an existing cross-vendor format — and a formal **task lifecycle** (`TaskState` enum: `submitted`, `working`, `input-required`, `completed`, `canceled`, `failed`, `rejected`, `auth-required`, `unknown`) transported over HTTP/JSON-RPC/Server-Sent Events. Its own guidance is explicit about when this shape is warranted over a plain stateless tool call: an agent that "had its own goals, could ask clarifying questions, needed to run multiple steps... and maintained task state between turns" should be addressed as an A2A peer, not wrapped in an MCP tool interface — a description that fits a Claude Code/Codex/Aider coding session closely.

**Relevance to `uses::[[tmux-conductor]]`**: A2A's `input-required` task state maps conceptually onto tmux-conductor's own already-implemented `awaiting` agent status, and its vendor-agnostic delegation goal matches tmux-conductor's own stated design ("vendor-agnostic system for orchestrating multiple AI coding agent instances"). However, none of Claude Code, Codex, or Aider natively speak A2A — adopting it would require tmux-conductor to build and maintain a protocol shim per agent vendor, a materially larger lift than a bespoke capability column, and likely premature for a single-user local tool (A2A is designed for cross-organization, multi-vendor enterprise delegation). See `relates_to::[[An Orchestrator Agent That Routes Commands/Tasks to Other Agents]]` for the full comparison against simpler alternatives.

derived_from::[[Ephemeral Worker-Per-Task Coding Agent Orchestration]]
relates_to::[[An Orchestrator Agent That Routes Commands/Tasks to Other Agents]]
relates_to::[[Host Server]]
