---
id: specialized-agent-registry-pattern
title: Specialized-Agent Registry / Catalog Pattern
updated: 2026-09-19
sources:
  - ../../../raw/research/orchestrator-agent-routing/index-3.md
  - ../../../raw/research/multi-agent-infrastructure-requirements/index.md
confidence: ambiguous
tags: [orchestration, multi-agent, registry, specialization]
---

# Specialized-Agent Registry / Catalog Pattern

A **specialized-agent registry** (also called an "agent catalog") is a discoverable list of named, described agent roles — independent of any routing/orchestration mechanism that might later consult it. It answers "what specialized agents exist and what are they good for," a separate question from "who decides which one handles a given task."

**The reference shape is Claude Code's own subagent format.** A subagent is a Markdown file at `.claude/agents/<name>.md` with `name`, `description`, an optional `tools` allowlist, and an optional `model` override; the main agent picks a subagent by matching task context against its `description` text. Spring AI's own parallel implementation names this explicitly as an **"Agent Registry — a catalog of subagent names and descriptions populated at startup"** that the orchestrating LLM consults to decide who to delegate to. Microsoft's multi-agent orchestration guidance draws a similar-shaped distinction between **child agents** (managed within the same solution) and **connected agents** (external, standalone agents owned by other teams) — both are entries an orchestrator can select from, differing only in ownership boundary.

**The registry is a prerequisite layer, not a byproduct of building an orchestrator.** TrueFoundry names "a central agent and tool registry: a discoverable catalog with schema validation" as the layer beneath multi-agent orchestration, not something an orchestrator produces incidentally. Microsoft Learn frames specialist-agent adoption as reuse-driven ("when specialist agents are already available and optimized for reuse") rather than routing-driven. Levelop's narrower definition of the orchestrator role itself reinforces the separation: "the control layer that turns a collection of specialized agents into a coordinated workflow. It does not usually do the domain work itself" — implying the collection (the registry) must already exist for the orchestrator to have anything to coordinate.

**Practical implication for `uses::[[tmux-conductor]]`:** the project has zero files under `.claude/agents/` — this pattern has never been applied even at the one layer (this Claude Code session's own in-process subagents) where it would require no new project infrastructure at all. Separately, tmux-conductor's own cross-process fleet (the `agents` table in its SQLite DB) has no structured specialization metadata either, though it does have an **informal** one: live agent names already follow a human-chosen `<project>-<role>-<n>` convention (`tmux-conductor-fe-research`, `tmux-conductor-architect-2`), observed in `logs/dispatch.jsonl` — the cheapest possible on-ramp to a formal registry is capturing that existing naming signal as a structured `role`/`description` field, rather than inventing a taxonomy from nothing.

> **Contradiction (2026-09-19):** the paragraph above says tmux-conductor's `agents` table "has no structured specialization metadata" and that the cheapest on-ramp is adding a structured `role`/`description` field. That is only half true: **`agents.role` already exists** — a schema-v7 CHECK-constrained enum (`generic|frontend|backend|qa|devops|security|architect`) with per-role worktree `CLAUDE.md` fragments (`rolePresets.ts`) and full API/UI plumbing, and `ADR-0006#D1` already builds a role-match routing tier on it. The genuinely missing piece is a free-text `description` (filed as `TASK-0199`), plus a per-task `role` column. Note also that the closed 7-value enum is coarse: widening it is a schema migration, and whether 7 values can place real tasks is unmeasured (assumption A6 in [[Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)]]).

derived_from::[[An Orchestrator Agent That Routes Commands/Tasks to Other Agents]]
relates_to::[[Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)]]
relates_to::[[Multi-Agent Orchestration Patterns (Orchestrator-Worker, Supervisor, Handoff)]]
relates_to::[[Agent as Tool vs. Subagent (Conversational Authority)]]
relates_to::[[Claude Code CLI]]
relates_to::[[Host Server]]
