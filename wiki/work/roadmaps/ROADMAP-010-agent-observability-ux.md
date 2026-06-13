---
id: ROADMAP-010
title: Agent observability & UX — token tracking, session recording, role templates
status: active
created: 2026-06-13
updated: 2026-06-13
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [observability, tokens, recording, roles]
---

# Roadmap 010: Agent observability & UX — token tracking, session recording, role templates

## Goal

Surface per-agent token cost, full session history, and role-based system prompts in the dashboard so operators have complete visibility into what each agent is spending and doing, and can launch specialists rather than generalists.

## Phase 1: Token & Cost Tracking

- [ ] Add `agent_usage` table to SQLite (`agent_id`, `session_start`, `input_tokens`, `output_tokens`, `cost_usd`)
- [ ] Parse Claude Code usage summary from pane tail via regex on each poll cycle
- [ ] Accumulate rolling token totals per agent in the `agent_usage` table
- [ ] Add compact token/cost badge to agent card header in the dashboard
- [ ] Add per-session usage breakdown view inside `AgentDetailModal`

## Phase 2: Session Recording

- [ ] Add `agent_terminal_log` table to SQLite (`agent_id`, `ts`, `chunk` text, capped to configurable max per agent)
- [ ] Append terminal output to the log table during SSE pane polling
- [ ] Add `GET /api/agents/:agent/log` endpoint to retrieve the full persisted log history
- [ ] Add "History" toggle to the LogTail component to switch between live SSE and persisted log
- [ ] Display session boundary markers (timestamps) when rendering the historical log

## Phase 3: Role Templates

- [ ] Add `role` enum column to the `agents` SQLite table (values: generic, frontend, backend, qa, devops, security, architect)
- [ ] Ship `presets.json` config file with a per-role CLAUDE.md fragment for each role value
- [ ] On agent spawn, write the matching role fragment into the worktree's `CLAUDE.md`
- [ ] Show colour-coded role badge on agent card in the dashboard
- [ ] Add role selector dropdown to `AddAgentForm` and the project-spawn UI in `ProjectList`

## Notes
