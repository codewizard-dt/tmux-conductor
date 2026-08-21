---
id: UAT-072
aliases: [UAT-072]
title: "UAT: agent_usage table — SQLite schema migration + DB helpers"
status: passed
task: TASK-072
created: 2026-07-06
updated: 2026-07-06
---

# UAT-072 — UAT: agent_usage table — SQLite schema migration + DB helpers

implements::[[TASK-072]]

> **Source task**: [`wiki/work/tasks/TASK-072-agent-usage-table.md`](../tasks/TASK-072-agent-usage-table.md)
> **Generated**: 2026-07-06

---

## Scope note

TASK-072 is a schema-and-DB-helpers-only task — no pane-tail parsing, no poll-cycle writer,
no HTTP endpoint, no frontend. There is no API route or UI surface to exercise, so this UAT
verifies the feature at its actual boundary: the real (file-backed) SQLite migration path and
the exported `host-server/db.ts` helper functions, run against a live/real DB rather than
mocks.

`meta.schema_version` is a shared, monotonically increasing counter that every roadmap-010
sibling task bumps with its own `if (version < N)` block (see `runMigrations` in
`host-server/db.ts`). Concurrent sibling tasks (e.g. TASK-067 `agent_checkpoints`,
`agent_terminal_log`) land migration blocks after this one, so the live schema_version keeps
climbing during this session — at generation time it was already `6` (TASK-072's own block
landed at `4`, superseded to `5` by TASK-067, and to `6` by a later block). All version checks
below assert "at least the version agent_usage landed at," never an exact number.

---

## Prerequisites

- [ ] `host-server/` has working `node_modules/` (`npm install` run)
- [ ] `sqlite3` CLI is available on PATH
- [ ] The host-server has been started at least once so `./data/conductor.db` exists and `runMigrations` has run (`cd host-server && npm run dev`, then stop it — or run any test that calls `openDb`)
- [ ] Commands below are run from the repo root

---

## Test Cases

### UAT-EDGE-001: agent_usage table exists on the real DB with all columns, the UNIQUE constraint, and a schema_version bump

- **Scenario**: After the host-server has run once, the live `./data/conductor.db` must contain the `agent_usage` table exactly as specified, and `meta.schema_version` must be at or beyond the version this migration landed at.
- **Steps**:
  1. Confirm the table schema:
     ```bash
     sqlite3 ./data/conductor.db ".schema agent_usage"
     ```
  2. Confirm the schema version has been bumped past this migration's landing version (`4`):
     ```bash
     sqlite3 ./data/conductor.db "SELECT CASE WHEN CAST(value AS INTEGER) >= 4 THEN 'ok' ELSE 'stale' END FROM meta WHERE key='schema_version';"
     ```
- **Expected Result**:
  - Step 1 prints a `CREATE TABLE agent_usage (...)` statement containing exactly these columns: `id INTEGER PRIMARY KEY`, `agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE`, `session_start TEXT NOT NULL`, `input_tokens INTEGER NOT NULL DEFAULT 0`, `output_tokens INTEGER NOT NULL DEFAULT 0`, `cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0`, `cache_read_input_tokens INTEGER NOT NULL DEFAULT 0`, `cost_usd REAL NOT NULL DEFAULT 0`, `updated_at TEXT NOT NULL DEFAULT (strftime(...))`, plus a trailing `UNIQUE (agent_id, session_start)` clause.
  - Step 2 prints `ok`.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` — `agent_usage table and schema_version persist across a real file-backed migration` (opens a throwaway on-disk DB via `openDb`, asserts all 9 columns exist and `schema_version >= 4`).
- [x] Pass <!-- 2026-07-06 -->

---

### UAT-EDGE-002: `npm test` in host-server/ passes, including agent_usage upsert idempotency, cascade delete, and per-agent totals isolation

- **Scenario**: The full `host-server` unit-test suite — including every `agent_usage`-specific case — must pass. This is the primary runtime verification for the upsert/read helpers (`upsertAgentUsage`, `listAgentUsage`, `getAgentUsageTotals`, `getAllAgentUsageTotals`), since the task has no HTTP/UI surface to drive them from.
- **Steps**:
  1. Run the suite:
     ```bash
     npm --prefix host-server test
     ```
- **Expected Result**: Process exits 0. Output includes (among other passing tests, `✔` prefix) all of:
  - `fresh DB has agent_usage table with expected columns`
  - `upsertAgentUsage is idempotent on (agent_id, session_start)`
  - `usage totals aggregate across sessions and cascade on agent delete`
  - `agent_usage table and schema_version persist across a real file-backed migration`
  - `agent_usage schema enforces UNIQUE(agent_id, session_start) independent of the upsert wrapper`
  - `getAgentUsageTotals and getAllAgentUsageTotals isolate totals per agent`

  The final summary line reports `ℹ fail 0`.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` — this test case *is* the direct execution of the repeatable unit tests; no additional harness needed.
- [x] Pass <!-- 2026-07-06 -->

---

### UAT-EDGE-003: `npx tsc --noEmit` passes in host-server/ (AgentUsage/AgentUsageTotals types and helper exports type-check)

- **Scenario**: `AgentUsage`, `AgentUsageTotals`, and the four helper functions must be correctly typed and exported from `host-server/db.ts`, and `host-server/db.migration.test.ts`'s imports of them must type-check cleanly.
- **Steps**:
  1. Run:
     ```bash
     npm --prefix host-server run typecheck
     ```
- **Expected Result**: Process exits 0 with no `error TS...` lines printed.
- **Repeatable Unit Test**: Not applicable — this is a static compiler gate (already run by `/tackle`'s Step 4), not a runtime behavior; re-run here only to formally close TASK-072's acceptance criterion.
- [x] Pass <!-- 2026-07-06 -->

---

## Gaps

None. All planned test cases had their exact contract confirmed by reading `host-server/db.ts` (migration block, `upsertAgentUsage`, `listAgentUsage`, `getAgentUsageTotals`, `getAllAgentUsageTotals`, `mapAgentUsage`) and `host-server/db.migration.test.ts` directly before writing assertions.

No API or UI test cases apply — the task explicitly scopes out the HTTP endpoint and frontend (sibling Phase 1 tasks).
