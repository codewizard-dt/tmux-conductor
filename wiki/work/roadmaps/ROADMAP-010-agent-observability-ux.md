---
id: ROADMAP-010
aliases: [ROADMAP-010]
title: Agent observability & UX — token tracking, session recording, role templates
status: active
created: 2026-06-13
updated: 2026-08-15
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [observability, tokens, recording, roles]
---

# Roadmap 010: Agent observability & UX — token tracking, session recording, role templates

## Goal

Surface per-agent token cost, full session history, and role-based system prompts in the dashboard so operators have complete visibility into what each agent is spending and doing, and can launch specialists rather than generalists.

## Phase 1: Token & Cost Tracking

- [x] [[TASK-072: agent_usage table — SQLite schema migration + DB helpers (agent_id, session_start, tokens, cost_usd)]]
- [x] [[TASK-073: Per-agent usage extraction — parse Claude Code transcript JSONL each poll (supersedes pane-tail regex)]]
- [x] [[TASK-075: Accumulate rolling token totals per agent in agent_usage — usage-store + pricing table + snapshot exposure]]
- [ ] [[TASK-074: Token/cost badge — compact usage badge on agent card header in dashboard]]
- [x] [[TASK-076: Per-session usage breakdown — GET /agents/:id/usage endpoint + session table in AgentDetailModal]]

## Phase 2: Session Recording

- [x] [[TASK-106: agent_terminal_log table — SQLite schema migration + DB helpers (agent_id, ts, chunk, capped per agent)]]
- [x] [[TASK-107: Append terminal output to agent_terminal_log during SSE pane polling]]
- [x] [[TASK-108: GET /api/agents/:id/log endpoint — retrieve full persisted terminal-log history]]
- [x] [[TASK-109: History toggle — switch LogTail between live SSE and persisted terminal log]]
- [x] [[TASK-110: Session boundary markers — per-chunk timestamp dividers in LogTail history view]]

## Phase 3: Role Templates

- [x] [[TASK-111: Role column — add `role` enum to the agents SQLite table (schema v7)]]
- [x] [[TASK-112: Role presets — presets.json config with a per-role CLAUDE.md fragment]]
- [x] [[TASK-113: Write role fragment into the agent's worktree CLAUDE.md on spawn]]
- [ ] [[TASK-114: Role badge — colour-coded role badge on the agent card in the dashboard]]
- [ ] [[TASK-115: Role selector — dropdown in AddAgentForm and the project-spawn UI in ProjectList]]

## Notes
