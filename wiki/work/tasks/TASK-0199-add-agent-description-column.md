---
id: TASK-0199
aliases: [TASK-0199]
title: "Add a description column to the agents table (specialized-agent catalog)"
status: todo
created: 2026-09-19
updated: 2026-09-19
depends_on: []
blocks: []
parallel_safe_with: [TASK-0185, TASK-0187, TASK-0188, TASK-0189, TASK-0190, TASK-0191, TASK-0192, TASK-0193, TASK-0194, TASK-0195, TASK-0196, TASK-0197, TASK-0198]
uat: ""
tags: [host-server, db, frontend, agents]
---

# TASK-0199 — Add a description column to the agents table (specialized-agent catalog)

relates_to::[[specialized-agent-registry-pattern]]

## Objective

Add a nullable free-text `description` column to the `agents` table so each agent can carry a short human-written summary of its purpose/specialization (e.g. "handles frontend styling for the dashboard"), plumbed through the create/update API and a simple textarea in the two agent-editing UIs. This closes the one genuine gap identified by `raw/research/orchestrator-agent-routing/index-3.md`'s specialized-agent-catalog investigation — the `role` column (schema v7, `ROLE_VALUES` enum, TASK-115, TASK-167) is already a mature, fully-wired feature and is explicitly **out of scope** for this task; do not touch `role`, `ROLE_VALUES`, `rolePresets.ts`, or the role badges/dropdowns.

## Approach

- **No `CHECK` constraint needed** — `description` is free text, so a straightforward `ALTER TABLE agents ADD COLUMN description TEXT` migration block suffices. No table-rebuild pattern is required (unlike `role`'s enum-constrained v7 migration or the v2/v8 rebuilds).
- **Verify the exact next schema version at implementation time, not now.** At the time this task was written, `host-server/db.ts`'s `runMigrations` topped out at version 10, but `TASK-0196` (bg_processes uniqueness, schema v10 rebuild) and `TASK-0198` (drop `bg_processes.linked_agent_id`, folded into the same rebuild) are both still `todo` and may land first. Since all migrations share one `schema_version` counter in the `meta` table regardless of which table they touch, re-read the current highest `if (version < N)` block in `db.ts` immediately before adding this migration and use `N+1` — do not hard-code "v11" in the implementation.
- Mirror the existing `role` plumbing pattern (route validation, `Agent` interface, `mapAgent()`, frontend UI) but simpler: no enum validation, just an optional string, and no worktree-fragment/preset system equivalent.

## Steps

### 1. Backend schema + data layer  <!-- agent: general-purpose -->

- [ ] In `host-server/db.ts`, re-read `runMigrations` to find the current highest `if (version < N)` block, then add a new migration block: `if (version < N+1) { db.exec("ALTER TABLE agents ADD COLUMN description TEXT"); db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(N+1)); }` (match the exact `meta` insert pattern already used by neighboring blocks — verify column names before writing).
  - Sub-detail: do not add a `CHECK` constraint or `NOT NULL` — the column must default to `NULL`.
- [ ] Update the `Agent` interface, `AgentRow`, and `AgentWithProjectRow` in `host-server/db.ts` to add `description: string | null`.
- [ ] Update `mapAgent()` in `host-server/db.ts` to map the new `description` column from snake_case to the `description` field on the returned `Agent` object.
- [ ] Update `createAgent(db, data: { name, workdir, launchCmd, projectId?, role?, useWorktree? })` in `host-server/db.ts` to accept an optional `description?: string` in `data`, and include it in the `INSERT INTO agents (...)` statement (defaulting to `null` when omitted).
- [ ] Add an `updateAgentDescription(db, id, description)` function in `host-server/db.ts` mirroring the existing `updateAgentRole(db, id, role)` — a plain `UPDATE agents SET description=? WHERE id=?`.

### 2. Backend route wiring  <!-- agent: general-purpose -->

- [ ] In `host-server/index.ts`, update `POST /agents` (~line 1073-1080) to accept an optional `description?: string` in the request body and pass it through to `createAgent`.
- [ ] Update `PATCH /agents/:id` (~line 1470-1474) — extend the `Body` type from `{ name?: string; role?: string }` to also include `description?: string`, and when present call the new `updateAgentDescription`. No validation needed beyond typeof-string (free text, any length).
- [ ] Update `POST /projects/:id/agents` (~line 2285-2293) to accept and pass through an optional `description?: string` the same way it currently passes through `role`/`effectiveRole`.

### 3. Frontend API client  <!-- agent: general-purpose -->

- [ ] In `frontend/src/lib/api.ts`, add a `description?: string | null` field wherever the agent create/update payload types are defined, and add an `updateAgentDescription(agentId, description)` function mirroring the existing `updateAgentRole(agentId, role)` (PATCH `/agents/:id` with `{ description }` body).
- [ ] Extend `spawnAgentInProject(...)`'s signature/body to optionally pass `description` alongside the existing `role`/`useWorktree` params.

### 4. Frontend UI  <!-- agent: general-purpose -->

- [ ] In `frontend/src/components/AddAgentForm.tsx`, add a `description` `useState` alongside the existing `role` state (~line 39), a `<textarea>` input near the existing role `<select>` (~lines 383-400), and include it in both `spawnAgentInProject` calls and the raw fetch body (~lines 100, 124).
- [ ] In `frontend/src/components/AgentList.tsx`'s `AgentDetailModal`, add a `description` textarea to the modal — mirror the existing role-switcher pattern (`roleInput`/`showRoleInput`/`roleError` state around lines 602-828, 1066-1076: add matching `descriptionInput`/`showDescriptionInput` state, an "Edit description" menu item alongside "Change role", and call `updateAgentDescription(agent.id, descriptionInput)` on save with an optimistic local update via a new `onDescriptionChanged` callback).
  - Sub-detail: `description` is free text with no badge/color rendering needed — do not add anything resembling `ROLE_CONFIG`/`RoleBadge` for it; a plain textarea + save/cancel is sufficient.

## Notes

- Explicitly out of scope: widening `role` from its fixed 7-value enum to freeform text (considered and declined by the user in favor of a minimal, description-only change — the existing enum, `rolePresets.ts`, worktree fragments, and drift-pinning tests in `rolePresets.test.ts` are untouched).
- No per-project default description is needed in `frontend/src/components/ProjectList.tsx` — only `role` has a per-project default there.
