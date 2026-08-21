---
id: UAT-067
aliases: [UAT-067]
title: "UAT: agent_checkpoints table — SQLite schema migration (agent_id, ts, stash_ref)"
status: passed
task: TASK-067
created: 2026-07-06
updated: 2026-07-06
---

# UAT-067 — UAT: agent_checkpoints table — SQLite schema migration (agent_id, ts, stash_ref)

implements::[[TASK-067]]

> **Source task**: [[TASK-067]]
> **Generated**: 2026-07-06
> **Note**: This task adds no HTTP route — it is a pure schema migration plus `host-server/db.ts` helper functions consumed by later tasks (TASK-068/069/070). Test commands below are direct `sqlite3`/`node --test`/`tsc` invocations rather than `curl`, matching the feature's shape.

---

## Prerequisites

- [ ] `host-server/` has working `node_modules/` (`npm install` run)
- [ ] `sqlite3` CLI installed (for the live schema-inspection test)
- [ ] The host-server has been started at least once so `data/conductor.db` exists and has run migrations through `schema_version` 5 (`cd host-server && npm run dev`, then stop it — or any prior dev session already did this)

---

## Test Cases

### UAT-DB-001: agent_checkpoints table + index exist with the correct schema
- **Description**: After migrations run, the real on-disk `data/conductor.db` has an `agent_checkpoints` table with columns `id`, `agent_id`, `ts`, `stash_ref`, `created_at`, an `ON DELETE CASCADE` FK to `agents(id)`, and an index on `agent_id`. This is the task's own Step 5 smoke test, run against the live file-backed DB.
- **Steps**:
  1. Confirm `data/conductor.db` exists (see Prerequisites)
  2. Run the command below as-is
- **Command**:
  ```bash
  sqlite3 /Users/davidtaylor/Repositories/tmux-conductor/data/conductor.db ".schema agent_checkpoints"
  ```
- **Expected Result**: Output includes `CREATE TABLE agent_checkpoints` with `id INTEGER PRIMARY KEY AUTOINCREMENT`, `agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE`, `ts INTEGER NOT NULL`, `stash_ref TEXT NOT NULL`, `created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)`, plus a separate `CREATE INDEX idx_agent_checkpoints_agent_id ON agent_checkpoints(agent_id)` statement. Verified passing at generation time against the real `data/conductor.db` (already at `schema_version` 5).
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`'fresh DB has agent_checkpoints table with expected columns and index'` — asserts the same columns + index name against an in-memory DB via `pragma_table_info` and `sqlite_master`, plus `schema_version` = `'5'`)
- [x] Pass <!-- 2026-07-06 -->

### UAT-DB-002: ON DELETE CASCADE removes checkpoints when the parent agent is deleted
- **Scenario**: A row in `agent_checkpoints` referencing a given `agent_id` must be removed automatically when that `agents` row is deleted (FK `ON DELETE CASCADE`), matching the `agent_usage` precedent (TASK-072) this task's Step 1 findings cite.
- **Steps**:
  1. Run the unit suite below (uses an in-memory DB; does not touch the real `data/conductor.db` or delete real agents)
     ```bash
     cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && node --import tsx/esm --test db.migration.test.ts
     ```
  2. Locate the `'agent_checkpoints cascade-deletes when parent agent is deleted'` result in the output
- **Expected Result**: Test passes — a checkpoint inserted for a fresh agent is present via `listCheckpoints`, then disappears after `deleteAgent` is called for that agent's id.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`'agent_checkpoints cascade-deletes when parent agent is deleted'`)
- [x] Pass <!-- 2026-07-06 -->

### UAT-DB-003: insertCheckpoint / listCheckpoints / getCheckpoint round-trip and ordering
- **Scenario**: The three exported helpers behave per the task's Step 3 spec: `insertCheckpoint` returns the inserted row (camelCase `AgentCheckpoint`), `listCheckpoints` returns all checkpoints for an agent ordered newest-first (`ts` DESC), `getCheckpoint` returns the exact row by id or `undefined` when no row matches.
- **Steps**:
  1. Run the unit suite below
     ```bash
     cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && node --import tsx/esm --test db.migration.test.ts
     ```
  2. Locate the `'insertCheckpoint/listCheckpoints/getCheckpoint round-trip and ordering'` result in the output
- **Expected Result**: Test passes — two checkpoints inserted at `ts` 1000 and 2000 come back from `listCheckpoints` in order `[2000, 1000]` (DESC); `getCheckpoint` on the first insert's id returns a row with matching `agentId`/`ts`/`stashRef`; `getCheckpoint(999999)` returns `undefined`.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`'insertCheckpoint/listCheckpoints/getCheckpoint round-trip and ordering'`)
- [x] Pass <!-- 2026-07-06 -->

### UAT-STATIC-001: `npx tsc --noEmit` passes with zero errors
- **Scenario**: The task's Acceptance Criteria require a clean typecheck in `host-server/` after adding the `AgentCheckpoint`/`AgentCheckpointRow` interfaces and the three helper exports.
- **Steps**:
  1. Run the command below as-is
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && npx tsc --noEmit
  ```
- **Expected Result**: Exits with no output and status 0 (zero type errors). Verified passing at generation time.
- **Repeatable Unit Test**: Not applicable: this command *is* the static gate itself, re-run verbatim; wrapping it in a unit test would just re-invoke the same compiler check
- [x] Pass <!-- 2026-07-06 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| `agent_checkpoints` table exists with `id`, `agent_id`, `ts`, `stash_ref`, `created_at` columns after server start | UAT-DB-001 |
| `ON DELETE CASCADE` on `agent_id` → rows removed when parent agent is deleted | UAT-DB-002 |
| Index on `agent_id` is present | UAT-DB-001 |
| `AgentCheckpoint` TypeScript type and `insertCheckpoint`/`listCheckpoints`/`getCheckpoint` helpers exported from `host-server/db.ts` | UAT-DB-003 (exercises all three helpers directly; the type itself is enforced structurally by UAT-STATIC-001) |
| `npx tsc --noEmit` passes in `host-server/` | UAT-STATIC-001 |
