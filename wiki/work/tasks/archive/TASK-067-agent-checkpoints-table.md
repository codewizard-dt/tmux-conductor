---
id: TASK-067
aliases: [TASK-067]
title: "agent_checkpoints table — SQLite schema migration (agent_id, ts, stash_ref)"
status: done
created: 2026-06-14
updated: 2026-07-06
depends_on: []
blocks: [TASK-068, TASK-069, TASK-070]
parallel_safe_with: [TASK-060, TASK-061, TASK-062, TASK-063, TASK-064, TASK-065, TASK-066]
uat: "[[UAT-067]]"
tags: [git, sqlite, schema, checkpoint, roadmap-007]
---

# TASK-067 — agent_checkpoints table — SQLite schema migration (agent_id, ts, stash_ref)

## Objective

Add an `agent_checkpoints` table to the SQLite database with columns `id`, `agent_id`, `ts`, and `stash_ref`. This is the foundational data layer for the checkpoint/rollback feature (Phase 3).

## Approach

Add a `CREATE TABLE IF NOT EXISTS agent_checkpoints` statement to the migration/init block in `host-server/db.ts`. Columns:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE`
- `ts INTEGER NOT NULL` (Unix timestamp in milliseconds)
- `stash_ref TEXT NOT NULL` (the stash ref string, e.g., `stash@{0}`)
- `created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)`

Add a TypeScript interface `AgentCheckpoint` with these fields. Export any DB helper functions needed by TASK-068/069/070 (e.g., `insertCheckpoint`, `listCheckpoints`, `getCheckpoint`).

## Steps

### 1. Read the current DB init block  <!-- agent: general-purpose -->

- [x] Use `mcp__serena__get_symbols_overview` on `host-server/db.ts` to find the existing `CREATE TABLE` statements and TypeScript types.

> **Findings (2026-07-06):** `runMigrations` is version-gated and already at **schema_version 4** (`agent_usage`, landed via TASK-072) — this task's block is **version 5**. `agents.id` is `INTEGER PRIMARY KEY`, so `agent_id` here must be `INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE` (not TEXT as originally drafted; matches the `agent_usage` precedent). Helper style: named exports taking `db: Database.Database` first, `RETURNING *` + `.get()` for inserts, snake_case `*Row` interface + `map*` converter per table.

### 2. Add the table  <!-- agent: general-purpose -->

- [x] Add `CREATE TABLE IF NOT EXISTS agent_checkpoints (...)` with the columns above and an `ON DELETE CASCADE` FK to `agents(id)`. (Landed as the `if (version < 5)` block in `runMigrations`; `agent_id` is INTEGER per Step 1 findings.)
- [x] Add an index: `CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_agent_id ON agent_checkpoints(agent_id)`.

<!-- Updated: 2026-07-06 22:00 -->

### 3. Add TypeScript types and helpers  <!-- agent: general-purpose -->

- [ ] Add `interface AgentCheckpoint { id: number; agent_id: string; ts: number; stash_ref: string; created_at: number }`.
- [ ] Add `insertCheckpoint(agentId: string, ts: number, stashRef: string): AgentCheckpoint`.
- [ ] Add `listCheckpoints(agentId: string): AgentCheckpoint[]`.
- [ ] Add `getCheckpoint(id: number): AgentCheckpoint | undefined`.

### 4. Typecheck  <!-- agent: general-purpose -->

- [ ] Run `npx tsc --noEmit` in `host-server/` — zero errors.

### 5. Smoke test  <!-- agent: general-purpose -->

- [ ] Start the host-server; run `sqlite3 ./data/conductor.db ".schema agent_checkpoints"` — table appears with the correct columns.

## Acceptance Criteria

- [ ] `agent_checkpoints` table exists with `id`, `agent_id`, `ts`, `stash_ref`, `created_at` columns after server start.
- [ ] `ON DELETE CASCADE` on `agent_id` → rows are removed when the parent agent is deleted.
- [ ] Index on `agent_id` is present.
- [ ] `AgentCheckpoint` TypeScript type and `insertCheckpoint`/`listCheckpoints`/`getCheckpoint` helpers are exported from `host-server/db.ts`.
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

None — foundational schema task for Phase 3.

### Roadmap

Implements ROADMAP-007 Phase 3, item "Add agent_checkpoints table to SQLite (agent_id, ts, stash_ref)" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
