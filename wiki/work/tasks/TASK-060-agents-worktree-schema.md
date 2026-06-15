---
id: TASK-060
title: "agents table schema — add worktree_path and branch columns"
status: todo
created: 2026-06-14
updated: 2026-06-14
depends_on: []
blocks: [TASK-061, TASK-063]
parallel_safe_with: [TASK-064, TASK-065, TASK-067]
uat: ""
tags: [git, sqlite, schema, roadmap-007]
---

# TASK-060 — agents table schema — add worktree_path and branch columns

## Objective

Add `worktree_path TEXT` and `branch TEXT` columns to the `agents` SQLite table so the worktree spawn logic (TASK-061) has a place to persist per-agent git state.

## Approach

Add an `ALTER TABLE agents ADD COLUMN` migration in `host-server/db.ts`. Both columns are nullable — existing rows and non-git agents will have `NULL` in both fields. No seed data required. Ensure the Fastify type definitions for agent rows are updated to include the new optional fields.

## Steps

### 1. Read the current schema  <!-- agent: general-purpose -->

- [ ] Use `mcp__serena__get_symbols_overview` on `host-server/db.ts` to find the `agents` table DDL and the TypeScript type/interface for agent rows.
- [ ] Note the current column list and how schema migrations are applied (auto-run at startup vs explicit migration files).

### 2. Add the columns  <!-- agent: general-purpose -->

- [ ] In `host-server/db.ts`, add `ALTER TABLE agents ADD COLUMN worktree_path TEXT` and `ALTER TABLE agents ADD COLUMN branch TEXT` inside the existing migration/init logic.
- [ ] Use `IF NOT EXISTS` guards or `try/catch` around the ALTER statements so the server starts cleanly on an already-migrated database.

### 3. Update TypeScript types  <!-- agent: general-purpose -->

- [ ] Add `worktree_path?: string | null` and `branch?: string | null` to the agent row TypeScript type/interface in `host-server/db.ts` (and any shared types that mirror it).
- [ ] Run `npx tsc --noEmit` in `host-server/` — zero type errors.

### 4. Smoke test  <!-- agent: general-purpose -->

- [ ] Start the host-server (`npm run dev` in `host-server/`); confirm startup logs show no migration errors.
- [ ] Run `sqlite3 ./data/conductor.db ".schema agents"` and verify `worktree_path` and `branch` columns are present.

## Acceptance Criteria

- [ ] `agents` table has `worktree_path TEXT` and `branch TEXT` columns after server start.
- [ ] Server starts without errors on both a fresh DB and an existing DB that already has the `agents` table.
- [ ] TypeScript agent row type includes `worktree_path` and `branch` as optional/nullable fields.
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

None — this is the foundational schema task for Phase 1.

### Roadmap

Implements ROADMAP-007 Phase 1, item "Add worktree_path and branch columns to the agents SQLite table" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
