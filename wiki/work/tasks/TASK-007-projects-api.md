---
id: TASK-007
title: "Add /api/projects CRUD and POST /api/projects/:id/agents with auto-naming"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-003, TASK-004]
blocks: [TASK-012, TASK-013]
parallel_safe_with: [TASK-001, TASK-005, TASK-006]
uat: ""
tags: [backend, sqlite, routes, projects]
---

# TASK-007 — Add /api/projects CRUD and POST /api/projects/:id/agents with auto-naming

## Objective

Implement the full `/api/projects` resource: `GET`, `POST`, `PUT /api/projects/:id`, `DELETE /api/projects/:id` (with a 409 guard if agents exist, unless `?force=1`). Add `POST /api/projects/:id/agents` which auto-names the new agent (`<project>-1`, `<project>-2`, …), pre-fills workdir and launchCmd from the project row, and spawns its tmux window — all in one request.

## Approach

Projects are a top-level entity in the SQLite schema. The CRUD routes are straightforward wrappers around `db.ts` helpers. The `POST /api/projects/:id/agents` endpoint is the key UX improvement: the operator picks a project from a dropdown and an agent appears in the session without having to type workdir/launchCmd.

## Steps

### 1. Add GET /api/projects  <!-- agent: general-purpose -->

- [ ] Use Serena to locate the route registration section in `backend/index.ts`
- [ ] Add `GET /api/projects`: `return listProjects(db)`
- [ ] Ensure `GET /api/status` also returns `projects[]` in the snapshot (update `buildSnapshot()`)

### 2. Add POST /api/projects  <!-- agent: general-purpose -->

- [ ] Add `POST /api/projects`:
  - Body: `{name: string, workdir: string, defaultLaunchCmd?: string}`
  - Validate: `name` matches `^[A-Za-z0-9_-]+$`; `workdir` non-empty
  - `createProject(db, data)`
  - Return `201` with the new project row

### 3. Add PUT /api/projects/:id  <!-- agent: general-purpose -->

- [ ] Add `PUT /api/projects/:id`:
  - Body: `Partial<{name, workdir, defaultLaunchCmd}>`
  - `updateProject(db, id, data)`
  - Return `200` with updated row; 404 if not found

### 4. Add DELETE /api/projects/:id  <!-- agent: general-purpose -->

- [ ] Add `DELETE /api/projects/:id`:
  - Check if any agents have `project_id = id` → if yes and no `?force=1` query param, return `409 {error: "Project has agents — pass ?force=1 to delete anyway"}`
  - `deleteProject(db, id, force)` — FK ON DELETE SET NULL nulls agent.project_id when force=true
  - Return `204`

### 5. Add POST /api/projects/:id/agents  <!-- agent: general-purpose -->

- [ ] Add `POST /api/projects/:id/agents`:
  - Body: `{name?: string}` — optional override; if omitted, call `nextAgentName(db, id)`
  - Fetch the project row; 404 if not found
  - `name` = `body.name ?? nextAgentName(db, id)`
  - `workdir` = project.workdir
  - `launchCmd` = project.defaultLaunchCmd
  - `createAgent(db, {name, workdir, launchCmd, projectId: id})`
  - `spawnAgentWindow(newAgent, conf)` (reuse helper from TASK-005)
  - Return `201` with the agent row

### 6. Static verification  <!-- agent: general-purpose -->

- [ ] Run `cd backend && npx tsc --noEmit` — no type errors
