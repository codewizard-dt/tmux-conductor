---
id: TASK-045
title: "Show agents scoped to this project with a Spawn Agent button on the detail page"
status: done
created: 2026-06-13
updated: 2026-06-14
depends_on: [TASK-044]
blocks: [TASK-046]
parallel_safe_with: []
uat: "../uat/UAT-045-project-detail-agents.md"
roadmap: ROADMAP-013
tags: [frontend, projects, agents, react]
---

# TASK-045 — Show agents scoped to this project with a Spawn Agent button on the detail page

## Objective

Add a scoped agents section to the `ProjectDetailPage`. The section shows agents whose `projectId` matches the current project, fetched via `GET /agents`. Include a "Spawn agent" button that calls `POST /projects/:id/agents` (auto-names the agent). New agents appear without a full page reload (refetch after spawn).

## Approach

`GET /api/agents` returns all agents including `projectId`. Filter client-side by matching `projectId`. The `spawnAgentInProject` helper already exists in `api.ts`. Reuse the visual row style from `ProjectList.tsx` (card border, mono text). SSE events (`agent-update`) already update the live agent list in `AgentList`, but this scoped view should independently refetch after spawn since it's a separate component.

## Steps

### 1. Read existing API helpers

- [ ] Use Serena `find_symbol` (include_body=true) on `fetchAgents` in `app/frontend/src/lib/api.ts`
- [ ] Use Serena `find_symbol` (include_body=true) on `spawnAgentInProject` in `app/frontend/src/lib/api.ts`

### 2. Read the ApiAgent interface

- [ ] Use Serena `find_symbol` (include_body=true) on `ApiAgent` in `app/frontend/src/lib/api.ts`

### 3. Add scoped agents section to ProjectDetailPage

- [ ] Import `fetchAgents`, `ApiAgent`, `spawnAgentInProject` from `../lib/api`
- [ ] Add state: `agents: ApiAgent[]`, `agentsLoading: boolean`, `spawnBusy: boolean`, `spawnError: string | null`
- [ ] Add `fetchScopedAgents` function: calls `fetchAgents()`, filters by `a.projectId === project.id`
- [ ] Call `fetchScopedAgents()` on mount (after project is loaded) and after each spawn
- [ ] Render a card below the header:
  - Section label "Agents" (same `text-[10px] font-semibold uppercase tracking-[0.08em] text-muted` style)
  - If no agents: muted "No agents yet"
  - Each agent: name (mono, semibold), status badge (idle/busy), workdir (muted)
  - "Spawn agent" button: calls `spawnAgentInProject(project.id)`, shows "Spawning…" while busy
  - On error: red error message below the button
- [ ] Match the card styling from `ProjectList.tsx`: `rounded-card border border-line bg-white px-5 py-4 shadow-card`

### 4. Verify

- [ ] Run `make typecheck` — zero errors
- [ ] Navigate to a project detail page — scoped agents list renders (empty if no agents)
- [ ] Click "Spawn agent" — a new agent appears in the list
