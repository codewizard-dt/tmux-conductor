---
id: TASK-005
title: "Rewrite agent and bg-process routes to be DB-backed with spawnAgentWindow helper"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-003, TASK-004]
blocks: [TASK-009]
parallel_safe_with: [TASK-001]
uat: "../uat/UAT-005-backend-routes-db.md"
tags: [backend, sqlite, routes, agents]
---

# TASK-005 — Rewrite agent and bg-process routes to be DB-backed with spawnAgentWindow helper

## Objective

Replace the conf-based agent/bg-process CRUD routes in `backend/index.ts` with DB-backed equivalents. Extract a shared `spawnAgentWindow(agent)` helper from the duplicated tmux blocks in `POST /agents` and `POST /agents/:agent/window`. All agent data now comes from `listAgents()` / `createAgent()` / `deleteAgent()` in `db.ts`; `buildSnapshot()` iterates the DB-loaded agent list.

## Approach

The current `POST /agents` route splices conf arrays (`appendAgentToConf`). The new route inserts into SQLite and then spawns the tmux window. Both `POST /agents` and `POST /agents/:agent/window` have duplicated `tmux new-window` shell construction — extract this into `spawnAgentWindow(agent: Agent)`.

`buildSnapshot()` currently iterates `conf.agents`; it should now call `listAgents(db)`. The `detectAgentStatus()` function takes an agent row from db instead of digging through conf.

## Steps

### 1. Extract spawnAgentWindow helper  <!-- agent: general-purpose -->

- [ ] Use Serena `find_symbol` on `backend/index.ts` to locate `POST /agents` and `POST /agents/:agent/window` handlers
- [ ] Read both handlers (Serena `find_symbol` with `include_body=true`)
- [ ] Extract the common tmux window-spawning block into:
  ```ts
  function spawnAgentWindow(agent: Agent, conf: ConductorConf): void {
    // tmux new-window with CONDUCTOR_AGENT_NAME, CONDUCTOR_STATE_DIR, CONDUCTOR_LOG_DIR env
    // matches current behavior exactly
  }
  ```
- [ ] Replace the duplicated tmux blocks in both handlers with calls to `spawnAgentWindow`

### 2. Rewrite POST /agents  <!-- agent: general-purpose -->

- [ ] Replace `appendAgentToConf(conf, ...)` with `createAgent(db, {name, workdir, launchCmd, projectId?})`
- [ ] Call `spawnAgentWindow(newAgent, conf)` after DB insert
- [ ] Respond with the new `Agent` row (not the old conf-based response shape)

### 3. Rewrite DELETE /agents/:agent  <!-- agent: general-purpose -->

- [ ] Replace conf-splice + queue filtering with `deleteAgent(db, id)` (FK cascade handles queue rows)
- [ ] Find agent by name first: `listAgents(db).find(a => a.name === params.agent)`; 404 if not found
- [ ] Also send tmux `kill-window` or `C-c` + `kill-pane` to the agent's window if it exists (preserve existing tmux teardown behavior)

### 4. Rewrite GET /agents and GET /status  <!-- agent: general-purpose -->

- [ ] `GET /agents`: `return listAgents(db)` (add `projectId`, `projectName` join if project_id set)
- [ ] `buildSnapshot()` in `GET /status`: iterate `listAgents(db)` instead of `conf.agents`; resolve each agent's status with `detectAgentStatus(agentRow, conf)`
- [ ] Update `detectAgentStatus` signature to accept `Agent` row instead of conf agent entry (the fields are the same, just sourced from DB)

### 5. Rewrite bg-process routes  <!-- agent: general-purpose -->

- [ ] `GET /bg-processes` (or however they are currently exposed): `listBgProcesses(db)`
- [ ] `POST /bg-processes`: `createBgProcess(db, data)` + spawn bg window (similar pattern to agents but no CONDUCTOR_AGENT_NAME env)
- [ ] `DELETE /bg-processes/:name`: `deleteBgProcess(db, id)` + tmux kill

### 6. Static verification  <!-- agent: general-purpose -->

- [ ] Run `cd backend && npx tsc --noEmit` — no type errors
- [ ] Ensure the old conf-splice calls (`appendAgentToConf`, `removeAgentFromConf`, `appendBgProcessToConf`, `removeBgProcessFromConf`) are no longer called from index.ts (they may still exist in config.ts for now — deletion happens in Phase 5)
