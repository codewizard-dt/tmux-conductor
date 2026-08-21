---
id: UAT-106
aliases: [UAT-106]
title: "UAT: agent_terminal_log table — SQLite schema migration + DB helpers"
status: passed
task: TASK-106
created: 2026-07-06
updated: 2026-07-06
---

# UAT-106 — UAT: agent_terminal_log table — SQLite schema migration + DB helpers

implements::[[TASK-106]]

> **Source task**: [`wiki/work/tasks/TASK-106-agent-terminal-log-table.md`](../tasks/TASK-106-agent-terminal-log-table.md)
> **Generated**: 2026-07-06

---

## Scope note

TASK-106 is a schema-and-DB-helpers-only task — no SSE poll-cycle writer, no HTTP endpoint,
no frontend history toggle, no session-boundary rendering (all sibling Phase 2 tasks,
TASK-107/108/109/110, not yet implemented). There is no API route or UI surface to exercise,
so this UAT verifies the feature at its actual boundary: the real (file-backed) SQLite
migration path and the exported `host-server/db.ts` helper functions (`appendTerminalLogChunk`,
`listTerminalLog`), run against a live/real DB rather than mocks.

`meta.schema_version` is a shared, monotonically increasing counter that every roadmap-010
sibling task bumps with its own `if (version < N)` block (see `runMigrations` in
`host-server/db.ts`). This task's block landed at `6` (after TASK-072's `agent_usage` at `4`
and TASK-067's `agent_checkpoints` at `5`, re-verified live at implementation time with no
drift). Other concurrent sibling tasks may land further blocks after this one, so the live
schema_version may keep climbing. All version checks below assert "at least `6`," never an
exact number.

---

## Prerequisites

- [ ] `host-server/` has working `node_modules/` (`npm install` run)
- [ ] `sqlite3` CLI is available on PATH
- [ ] The host-server has been started at least once so `./data/conductor.db` exists and `runMigrations` has run (`cd host-server && npm run dev`, then stop it — or run any test that calls `openDb`)
- [ ] Commands below are run from the repo root

---

## Test Cases

### UAT-EDGE-001: agent_terminal_log table exists on the real DB with all columns, the FK/index, and a schema_version bump

- **Scenario**: After the host-server has run once, the live `./data/conductor.db` must contain the `agent_terminal_log` table exactly as specified, plus its lookup/pruning index, and `meta.schema_version` must be at or beyond the version this migration landed at.
- **Steps**:
  1. Confirm the table schema:
     ```bash
     sqlite3 ./data/conductor.db ".schema agent_terminal_log"
     ```
  2. Confirm the index exists:
     ```bash
     sqlite3 ./data/conductor.db ".indexes agent_terminal_log"
     ```
  3. Confirm the schema version has been bumped past this migration's landing version (`6`):
     ```bash
     sqlite3 ./data/conductor.db "SELECT CASE WHEN CAST(value AS INTEGER) >= 6 THEN 'ok' ELSE 'stale' END FROM meta WHERE key='schema_version';"
     ```
- **Expected Result**:
  - Step 1 prints a `CREATE TABLE agent_terminal_log (...)` statement containing exactly these columns: `id INTEGER PRIMARY KEY`, `agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE`, `ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))`, `chunk TEXT NOT NULL`.
  - Step 2 lists `idx_agent_terminal_log_agent_ts`.
  - Step 3 prints `ok`.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` — `fresh DB has agent_terminal_log table with expected columns and index` (opens an in-memory DB via `openDb(':memory:')`, asserts all 4 columns plus the index exist and `schema_version >= 6`).
- [x] Pass <!-- 2026-07-06 -->

---

### UAT-EDGE-002: `npm test` in host-server/ passes, including agent_terminal_log cascade delete, chronological ordering/per-agent isolation, and cap enforcement

- **Scenario**: The full `host-server` unit-test suite — including every `agent_terminal_log`-specific case — must pass. This is the primary runtime verification for the helper functions (`appendTerminalLogChunk`, `listTerminalLog`), since the task has no HTTP/UI surface to drive them from.
- **Steps**:
  1. Run the suite:
     ```bash
     npm --prefix host-server test
     ```
- **Expected Result**: Process exits 0. Output includes (among other passing tests, `✔` prefix) all of:
  - `fresh DB has agent_terminal_log table with expected columns and index`
  - `agent_terminal_log cascade-deletes when parent agent is deleted`
  - `appendTerminalLogChunk/listTerminalLog round-trip in chronological order without cross-agent contamination`
  - `appendTerminalLogChunk prunes oldest rows beyond maxRowsPerAgent, keeping the newest`

  The final summary line reports `ℹ fail 0`.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` — this test case *is* the direct execution of the repeatable unit tests; no additional harness needed.
- [x] Pass <!-- 2026-07-06 -->

---

### UAT-EDGE-003: `npx tsc --noEmit` passes in host-server/ (AgentTerminalLog types and helper exports type-check)

- **Scenario**: `AgentTerminalLog`, `AgentTerminalLogRow`, `mapAgentTerminalLog`, and the two helper functions must be correctly typed and exported from `host-server/db.ts`, and `host-server/db.migration.test.ts`'s imports of them must type-check cleanly.
- **Steps**:
  1. Run:
     ```bash
     npm --prefix host-server run typecheck
     ```
- **Expected Result**: Process exits 0 with no `error TS...` lines printed.
- **Repeatable Unit Test**: Not applicable — this is a static compiler gate (already run by `/tackle`'s Step 4), not a runtime behavior; re-run here only to formally close TASK-106's acceptance criterion.
- [x] Pass <!-- 2026-07-06 -->

---

## Gaps

None. All planned test cases had their exact contract confirmed by reading `host-server/db.ts` (migration block, `appendTerminalLogChunk`, `listTerminalLog`, `mapAgentTerminalLog`) and `host-server/db.migration.test.ts` directly before writing assertions.

No API or UI test cases apply — the task explicitly scopes out the HTTP endpoint, poll-cycle writer, and frontend history toggle (sibling Phase 2 tasks TASK-107/108/109/110, not yet implemented).
