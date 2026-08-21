---
id: TASK-072
aliases: [TASK-072]
title: "agent_usage table — SQLite schema migration + DB helpers (agent_id, session_start, tokens, cost_usd)"
status: done
created: 2026-07-06
updated: 2026-07-06
depends_on: []
blocks: []
parallel_safe_with: [TASK-001, TASK-011, TASK-012, TASK-050, TASK-061, TASK-062, TASK-063, TASK-064, TASK-065, TASK-066, TASK-067, TASK-068, TASK-069, TASK-070, TASK-071]
uat: "[[UAT-072]]"
tags: [sqlite, schema, tokens, cost, observability, roadmap-010]
---

# TASK-072 — agent_usage table — SQLite schema migration + DB helpers

## Objective

Add an `agent_usage` table to the SQLite database (`host-server/db.ts`, better-sqlite3) holding per-agent, per-session token and cost totals — `agent_id`, `session_start`, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `cost_usd` — plus the exported TypeScript types and helper functions the downstream writer and reader tasks will consume. This is the foundational data layer for ROADMAP-010 Phase 1 (Token & Cost Tracking). Scope is strictly schema + DB helpers: no pane-tail parsing, no poll-cycle writer, no HTTP endpoint, no frontend (those are sibling Phase 1 tasks).

## Approach

Research: `raw/research/agent-usage-table/index.md`.

- **Versioned migration:** `runMigrations` in `host-server/db.ts` gates DDL behind `meta.schema_version` (currently `3`). Add a new `if (version < 4)` block that creates the table, then bumps `schema_version` to `'4'`. Never edit existing version blocks. If a concurrent task (e.g. TASK-067 `agent_checkpoints`) lands a `version < 4` block first, renumber this block to the next free version instead.
- **One row per (agent, session), not per message:** Claude Code's per-message JSONL usage values are streaming snapshots (`input_tokens` often a placeholder 0/1; `output_tokens` a mid-stream undercount), so the durable store holds rolling per-session totals that a poll-cycle writer overwrites idempotently. `UNIQUE(agent_id, session_start)` is the upsert key and doubles as the `agent_id` lookup index (leftmost prefix) — no separate index needed.
- **Cache token columns beyond the roadmap's five:** cache reads dominate real Claude Code usage and are required for honest cost math, so include `cache_creation_input_tokens` and `cache_read_input_tokens` with `DEFAULT 0` (a pane-regex writer that can't see the cache split simply omits them).
- **House conventions** (match existing tables/helpers exactly): `id INTEGER PRIMARY KEY`; FK `INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE` (`agents.id` is INTEGER — do not copy TASK-067's TEXT); timestamps `TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))`; `cost_usd REAL NOT NULL DEFAULT 0`; helpers take `db: Database.Database` as the first parameter, use `RETURNING *` cast to an `AgentUsageRow`, and return a camelCase `AgentUsage` via `mapAgentUsage` (mirror `addTask`/`mapTask`).
- **Upsert semantics:** the writer passes absolute session totals; `upsertAgentUsage` does `INSERT ... ON CONFLICT(agent_id, session_start) DO UPDATE SET` all metric columns and refreshes `updated_at`. Readers get per-session rows (detail modal) and SUM aggregates (badge / dashboard).

## Steps

### 1. Add the migration block  <!-- agent: general-purpose -->

- [x] In `host-server/db.ts`, use `mcp__serena__find_symbol` on `runMigrations` and confirm the current max schema version (expected `3`; if a concurrent change already claimed `4`, use the next free number throughout). *(Confirmed max was `3` — v4 was free.)*
- [x] Append a new guarded block after the `version < 3` block:

```ts
if (version < 4) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_usage (
      id INTEGER PRIMARY KEY,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      session_start TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE (agent_id, session_start)
    );
  `);
  db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '4')`).run();
}
```

### 2. Add TypeScript interfaces  <!-- agent: general-purpose -->

- [x] Next to the existing `TaskRow`/`Task` pairs in `host-server/db.ts`, add:
  - `interface AgentUsageRow { id: number; agent_id: number; session_start: string; input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; cost_usd: number; updated_at: string }`
  - `export interface AgentUsage { id: number; agentId: number; sessionStart: string; inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number; costUsd: number; updatedAt: string }`
  - `export interface AgentUsageTotals { agentId: number; inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number; costUsd: number; sessions: number }`
- [x] Add `function mapAgentUsage(row: AgentUsageRow): AgentUsage` following `mapTask`.

### 3. Add DB helper functions  <!-- agent: general-purpose -->

- [x] `export function upsertAgentUsage(db, data: { agentId: number; sessionStart: string; inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number; costUsd: number }): AgentUsage` — `INSERT INTO agent_usage (...) VALUES (...) ON CONFLICT(agent_id, session_start) DO UPDATE SET input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens, cache_creation_input_tokens=excluded.cache_creation_input_tokens, cache_read_input_tokens=excluded.cache_read_input_tokens, cost_usd=excluded.cost_usd, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') RETURNING *`; default omitted cache fields to 0.
- [x] `export function listAgentUsage(db, agentId: number): AgentUsage[]` — `SELECT * FROM agent_usage WHERE agent_id = ? ORDER BY session_start DESC` (per-session breakdown for `AgentDetailModal`, TASK sibling).
- [x] `export function getAgentUsageTotals(db, agentId: number): AgentUsageTotals` — single-row `SELECT COALESCE(SUM(...),0) ..., COUNT(*) as sessions` for the agent-card badge sibling task.
- [x] `export function getAllAgentUsageTotals(db): AgentUsageTotals[]` — same aggregate `GROUP BY agent_id`, so the dashboard fetches every agent's totals in one query.

### 4. Typecheck  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` in `host-server/` — zero errors. *(2026-07-06: ran via `bash -c` — passed with zero errors.)*

### 5. Smoke test  <!-- agent: general-purpose -->

- [x] Start the host-server (or open the DB once via a small `tsx` snippet in `./tmp/`) so `runMigrations` runs, then `sqlite3 ./data/conductor.db ".schema agent_usage"` — table exists with all columns and the `UNIQUE(agent_id, session_start)` constraint; `SELECT value FROM meta WHERE key='schema_version'` returns `4` (or the renumbered version). *(2026-07-06: verified against the live DB — table present with all columns + UNIQUE constraint; `schema_version` is `5` because TASK-067's `agent_checkpoints` migration landed after this task's `version < 4` block.)*
- [x] Verify upsert idempotency: call `upsertAgentUsage` twice with the same `(agentId, sessionStart)` and different totals — one row remains, holding the second call's values. *(Covered by `node:test` cases in `host-server/db.migration.test.ts` — upsert idempotency, totals aggregation, ON DELETE CASCADE. 2026-07-06: `npm test` run — 6/6 pass. Schema-version assertions bumped `'4'` → `'5'` after TASK-067's concurrent migration.)*

## Acceptance Criteria

- [x] `agent_usage` table exists after server start with columns `id`, `agent_id`, `session_start`, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `cost_usd`, `updated_at`.
- [x] `UNIQUE(agent_id, session_start)` constraint present; second upsert for the same pair updates in place (no duplicate row).
- [x] `ON DELETE CASCADE`: deleting the parent agent removes its usage rows.
- [x] `meta.schema_version` bumped (landed as `'4'`; live DB now reports `'5'` after TASK-067's subsequent block); existing migration blocks untouched.
- [x] `AgentUsage`/`AgentUsageTotals` types and `upsertAgentUsage`/`listAgentUsage`/`getAgentUsageTotals`/`getAllAgentUsageTotals` exported from `host-server/db.ts`.
- [x] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

None — foundational schema task. Parallel-safe with all active tasks; coordinate only on the `schema_version` number with TASK-067 (`agent_checkpoints`), which also appends a migration block to `runMigrations` — whichever lands second takes the next version number.

### Roadmap

Implements ROADMAP-010 Phase 1, item "Add `agent_usage` table to SQLite (`agent_id`, `session_start`, `input_tokens`, `output_tokens`, `cost_usd`)" — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`. Downstream siblings: pane-tail usage parser + poll-cycle accumulator (writer), dashboard badge + `AgentDetailModal` breakdown (readers).
