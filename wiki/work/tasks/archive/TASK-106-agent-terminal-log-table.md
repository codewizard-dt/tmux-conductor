---
id: TASK-106
aliases: [TASK-106]
title: "agent_terminal_log table — SQLite schema migration + DB helpers (agent_id, ts, chunk, capped per agent)"
status: done
created: 2026-07-06
updated: 2026-07-06
depends_on: []
blocks: []
parallel_safe_with: [TASK-001, TASK-011, TASK-012, TASK-050, TASK-061, TASK-062, TASK-063, TASK-065, TASK-066, TASK-067, TASK-068, TASK-069, TASK-070, TASK-071, TASK-072, TASK-073, TASK-074, TASK-075, TASK-076]
uat: "[[UAT-106]]"
tags: [sqlite, schema, terminal, logging, session-recording, observability, roadmap-010]
---

# TASK-106 — agent_terminal_log table — SQLite schema migration + DB helpers

## Objective

Add an `agent_terminal_log` table to the SQLite database (`host-server/db.ts`, better-sqlite3) holding persisted terminal-output chunks per agent — `agent_id`, `ts`, `chunk` — capped to a configurable maximum row count per agent, plus the exported TypeScript types and helper functions the downstream poll-cycle writer and history-read endpoint will consume. This is the foundational data layer for ROADMAP-010 Phase 2 (Session Recording). Scope is strictly schema + DB helpers: no SSE poll-cycle writer, no HTTP endpoint, no frontend history toggle, no session-boundary rendering (those are sibling Phase 2 tasks, not yet created).

## Approach

- **Versioned migration:** `runMigrations` in `host-server/db.ts` gates DDL behind `meta.schema_version` (currently `5`, after TASK-072's `agent_usage` at v4 and TASK-067's `agent_checkpoints` at v5 — both in-progress concurrently with this task). Add a new `if (version < N) { ... }` block **after the last existing block**, using whatever `N` is the next free integer at implementation time — do not hardcode `6`; re-read `runMigrations` immediately before editing, since TASK-067 and/or TASK-072 may have already advanced the version further, or a still-later task may land first. Never edit existing version blocks; if another concurrent task claims your intended number first, bump to the next free one and note it in this file the same way TASK-072 and TASK-067 documented their renumbering.
- **House conventions** (match `agent_usage` / `agent_checkpoints` exactly, per TASK-072's precedent-setting bullet — this is the authoritative convention for all tables added after schema v3): `id INTEGER PRIMARY KEY`; FK `agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE` (`agents.id` is `INTEGER` — do not copy TASK-067's original TEXT draft); timestamp `ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))`, matching the ISO-string convention used elsewhere rather than TASK-067's Unix-ms integer.
- **`chunk TEXT NOT NULL`** — one row per appended terminal-output chunk (raw pane text captured during SSE polling by the Phase 2 item-2 writer). Not deduplicated, not diffed — the writer decides chunk boundaries; this table just persists whatever it's given, in append order.
- **Index for lookup + pruning:** `CREATE INDEX IF NOT EXISTS idx_agent_terminal_log_agent_ts ON agent_terminal_log(agent_id, ts)` — serves both `listTerminalLog`'s per-agent chronological read (Phase 2 item-3's `GET /api/agents/:agent/log`) and the cap-enforcement prune query below.
- **Cap is enforced in the helper, not in config/db coupling:** "configurable max per agent" means the *caller* (the Phase 2 item-2 poll-cycle writer, not this task) reads the limit from `conductor.conf` via `host-server/config.ts` and passes it into the append helper as a plain number — mirroring how `db.ts` takes `db: Database.Database` as a parameter everywhere and never imports `config.ts` itself. This task only implements the cap-enforcement mechanics (delete-oldest-beyond-N), not the config key or its default value.
- **Cap-enforcement mechanics:** on every append, after inserting the new row, delete any rows for that `agent_id` beyond the newest `maxRowsPerAgent`, keeping the append+prune atomic via `db.transaction(...)`:
  ```sql
  DELETE FROM agent_terminal_log
  WHERE agent_id = ? AND id NOT IN (
    SELECT id FROM agent_terminal_log
    WHERE agent_id = ?
    ORDER BY ts DESC, id DESC
    LIMIT ?
  )
  ```
- **Helpers take `db: Database.Database` as the first parameter**, use `RETURNING *` cast to an `AgentTerminalLogRow`, and return a camelCase `AgentTerminalLog` via `mapAgentTerminalLog` (mirror `mapTask`/`mapAgentUsage`).

## Steps

<!-- Updated: 2026-07-06 12:00 -->

### 1. Add the migration block  <!-- agent: general-purpose -->

- [x] In `host-server/db.ts`, inspect `runMigrations` and confirm the current max `schema_version` at the moment you implement this (expected `5+`; use the next free integer — if TASK-067 and/or TASK-072 have already landed, this block comes after both). **Claimed N=6** — at implementation time the last existing block was `if (version < 5)` (TASK-067's `agent_checkpoints`); re-verified immediately before editing with no drift.
- [x] Append a new guarded block after the last existing `if (version < N)` block:

```ts
if (version < N) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_terminal_log (
      id INTEGER PRIMARY KEY,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      chunk TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_terminal_log_agent_ts ON agent_terminal_log(agent_id, ts);
  `);
  db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '${N}')`).run();
}
```

  (Replace `N` with the literal next-free integer in the committed code — do not leave a template variable in the actual migration.) **Done: `if (version < 6)` block landed with literal `6` in both the condition and the `meta` upsert.**

### 2. Add TypeScript interfaces  <!-- agent: general-purpose -->

- [x] Next to the existing `AgentUsageRow`/`AgentUsage` pair in `host-server/db.ts`, add:
  - `interface AgentTerminalLogRow { id: number; agent_id: number; ts: string; chunk: string }`
  - `export interface AgentTerminalLog { id: number; agentId: number; ts: string; chunk: string }`
- [x] Add `function mapAgentTerminalLog(row: AgentTerminalLogRow): AgentTerminalLog` following `mapAgentUsage`/`mapTask`. Placed alongside `AgentCheckpoint`/`mapAgentCheckpoint` (the nearest precedent at implementation time).

### 3. Add DB helper functions  <!-- agent: general-purpose -->

- [x] `export function appendTerminalLogChunk(db: Database.Database, agentId: number, chunk: string, maxRowsPerAgent: number): AgentTerminalLog` — wrapped in `db.transaction(...)`: `INSERT INTO agent_terminal_log (agent_id, chunk) VALUES (?, ?) RETURNING *`, then run the delete-oldest-beyond-cap query from the Approach section scoped to that `agent_id`; return the mapped inserted row.
- [x] `export function listTerminalLog(db: Database.Database, agentId: number): AgentTerminalLog[]` — `SELECT * FROM agent_terminal_log WHERE agent_id = ? ORDER BY ts ASC, id ASC` (full chronological history for the Phase 2 item-3 `GET /api/agents/:agent/log` endpoint and item-5's session-boundary rendering).

### 4. Typecheck  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` in `host-server/` — zero errors. **Confirmed clean** (a transient duplicate-key `TS1117` error in `index.ts` from a concurrent unrelated orchestrator's edit resolved itself between checks and was verified unrelated to `db.ts`).

### 5. Smoke test  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Start the host-server (or open the DB once via a small `tsx` snippet in `./tmp/`) so `runMigrations` runs, then `sqlite3 ./data/conductor.db ".schema agent_terminal_log"` — table exists with all columns and the `idx_agent_terminal_log_agent_ts` index; `SELECT value FROM meta WHERE key='schema_version'` returns the version this task claimed.
- [DEFERRED-TO-UAT] Verify cap enforcement: call `appendTerminalLogChunk` more than `maxRowsPerAgent` times for the same `agentId` — row count for that agent never exceeds `maxRowsPerAgent`, and the oldest rows (by `ts`/`id`) are the ones removed.
- [DEFERRED-TO-UAT] Verify `ON DELETE CASCADE`: deleting the parent agent removes its terminal-log rows.

*(Runtime/E2E verification is out of scope for /tackle per its execution protocol — deferred to the UAT phase, which will exercise these against the live DB.)*

## Acceptance Criteria

- [ ] `agent_terminal_log` table exists after server start with columns `id`, `agent_id`, `ts`, `chunk`.
- [ ] `idx_agent_terminal_log_agent_ts` index present on `(agent_id, ts)`.
- [ ] `ON DELETE CASCADE`: deleting the parent agent removes its terminal-log rows.
- [ ] `appendTerminalLogChunk` enforces the passed-in `maxRowsPerAgent` cap atomically (insert + prune in one transaction) — row count per agent never exceeds the cap.
- [ ] `meta.schema_version` bumped to the next free integer at implementation time; existing migration blocks untouched.
- [ ] `AgentTerminalLog` type and `appendTerminalLogChunk`/`listTerminalLog` exported from `host-server/db.ts`.
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

None — foundational schema task. Parallel-safe with all active tasks; coordinate only on the `schema_version` number with TASK-067 (`agent_checkpoints`) and TASK-072 (`agent_usage`), which also append migration blocks to `runMigrations` — whichever lands last takes the next free version number.

**Downstream dependents (ROADMAP-010 Phase 2, not yet created as task files — their eventual `depends_on` will include TASK-106):**

1. Append terminal output to `agent_terminal_log` during SSE pane polling (the poll-cycle writer; owns reading the configurable cap from `conductor.conf`/`config.ts` and calling `appendTerminalLogChunk`).
2. `GET /api/agents/:agent/log` endpoint over `listTerminalLog` to retrieve full persisted log history.
3. "History" toggle in the `LogTail` component to switch between live SSE and the persisted log (consumes item 2's endpoint).
4. Display session boundary markers (timestamps) when rendering the historical log (consumes `ts` values from `listTerminalLog`/item 2's endpoint).

### Roadmap

Implements ROADMAP-010 Phase 2, item "Add `agent_terminal_log` table to SQLite (`agent_id`, `ts`, `chunk` text, capped to configurable max per agent)" — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`.
