---
id: TASK-046
title: "Show project-scoped task queue on the project detail page"
status: done
created: 2026-06-13
updated: 2026-06-14
depends_on: [TASK-045]
blocks: []
parallel_safe_with: []
uat: "../uat/UAT-046-project-detail-task-queue.md"
roadmap: ROADMAP-013
tags: [frontend, projects, tasks, react]
---

# TASK-046 — Show project-scoped task queue on the project detail page

## Objective

Add a task queue section to `ProjectDetailPage` that lists pending tasks scoped to this project (tasks where `projectId` matches the current project). Include an "Add task" inline form that posts to `POST /tasks` with `projectId` set. Reuse the existing `TaskList` component if it can be scoped, or render a minimal task list inline.

## Approach

Inspect `TaskList.tsx` to see if it accepts a `projectId` prop for scoping. If not, either add the prop or render a minimal task list inline (fetch all tasks, filter by `projectId`). For adding tasks, use `addTask` from `api.ts` with `{ command, projectId }`.

The host-server `/tasks` endpoint accepts `projectId` as an optional body field and scopes the task to that project. `GET /queue/:agent` returns per-agent queue items — but there's no direct `GET /tasks?projectId=X` endpoint. Use the SSE `task-update` events or poll `GET /status` to get the current queue for project-scoped agents.

Check what task-fetching helpers already exist in `api.ts` before writing new ones.

## Steps

### 1. Read existing task components and API

- [ ] Use Serena `find_symbol` (include_body=true) on `TaskList` in `app/frontend/src/components/TaskList.tsx`
- [ ] Use Serena `find_symbol` (include_body=true) on `addTask` in `app/frontend/src/lib/api.ts`
- [ ] Use Serena `get_symbols_overview` on `app/frontend/src/components/AddTaskForm.tsx`

### 2. Determine scoping approach

- [ ] If `TaskList` accepts a `projectId` prop for filtering: use it directly
- [ ] If not: render a minimal inline task list in `ProjectDetailPage` that fetches tasks from the project's agents and filters by `projectId`

### 3. Add task queue section

- [ ] Add a task queue card below the agents section in `ProjectDetailPage`
- [ ] Show pending tasks for the project with command text (truncated, mono) and status
- [ ] Add a minimal "Add task" form: a text input for the command + submit button
  - On submit: call `addTask({ command, projectId: project.id })`
  - Show busy/error state inline

### 4. Verify

- [ ] Run `make typecheck` — zero errors
- [ ] Navigate to a project detail page — task queue section renders (empty if no tasks)
- [ ] Add a task via the inline form — task appears in the queue
