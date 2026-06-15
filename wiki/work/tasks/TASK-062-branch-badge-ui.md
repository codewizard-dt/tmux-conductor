---
id: TASK-062
title: "Branch badge — display branch name on agent card in dashboard"
status: todo
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-061]
blocks: []
parallel_safe_with: [TASK-063, TASK-064, TASK-065, TASK-066, TASK-067]
uat: ""
tags: [frontend, ui, git, branch, roadmap-007]
---

# TASK-062 — Branch badge — display branch name on agent card in dashboard

## Objective

Display a branch name badge on each agent card in the dashboard when the agent has a `branch` value (i.e., it was spawned with a git workdir). Agents without a branch (non-git workdirs) show nothing.

## Approach

The `GET /agents` and `GET /status` responses already return agent rows from SQLite; add `branch` (and `worktree_path`) to the serialised agent object in the host-server route handler. In `app/frontend`, update the `AgentList` card component to render a small branch badge (e.g., a monospace chip showing `⎇ conductor/<id>`) below or beside the agent name, conditionally on `agent.branch` being non-null.

## Steps

### 1. Expose branch in API responses  <!-- agent: general-purpose -->

- [ ] Use `mcp__serena__get_symbols_overview` on `host-server/index.ts` to find the `GET /agents` and `GET /status` serialisation paths.
- [ ] Ensure `branch` and `worktree_path` are included in the agent objects returned by both endpoints (add them if omitted by a `SELECT *` shortcut or an explicit column list).

### 2. Update frontend API types  <!-- agent: general-purpose -->

- [ ] In `app/frontend/src/lib/api.ts`, add `branch?: string | null` and `worktree_path?: string | null` to the `Agent` TypeScript interface.

### 3. Render the branch badge  <!-- agent: general-purpose -->

- [ ] In `app/frontend/src/components/AgentList.tsx`, locate the agent card markup.
- [ ] Add a conditional `{agent.branch && <span className="branch-badge">⎇ {agent.branch}</span>}` (or equivalent Tailwind chip) next to or below the agent name.
- [ ] Keep the badge visually subtle — small text, muted colour — so it does not compete with the agent status indicators.

### 4. Typecheck + build  <!-- agent: general-purpose -->

- [ ] Run `npx tsc --noEmit` in `app/frontend/` — zero errors.
- [ ] Run `npm run build` in `app/frontend/` — clean build.

## Acceptance Criteria

- [ ] Agent cards for agents with a `branch` value display a branch badge showing the branch name.
- [ ] Agent cards for agents with `branch = NULL` show no badge.
- [ ] `npx tsc --noEmit` and `npm run build` pass cleanly in `app/frontend/`.

## Dependencies

- **DEPENDS ON [TASK-061](TASK-061-worktree-spawn.md)** — `branch` must be populated in the `agents` row before the UI can display it.

### Roadmap

Implements ROADMAP-007 Phase 1, item "Display branch name badge on agent card in the dashboard" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
