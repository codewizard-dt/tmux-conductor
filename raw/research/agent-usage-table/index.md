---
topic: Schema design for a new `agent_usage` SQLite table in host-server/db.ts (better-sqlite3) — per-agent per-session token/cost tracking (agent_id, session_start, input_tokens, output_tokens, cost_usd); schema + DB helpers only (ROADMAP-010 Phase 1, item 1)
slug: agent-usage-table
researched: 2026-07-06
sources: [./sources.md]
---

# Research: `agent_usage` SQLite table schema

> Add the table as a new versioned migration block (`if (version < 4)`) in `runMigrations` in `host-server/db.ts`, following the exact conventions of the existing v1 tables: `INTEGER PRIMARY KEY`, `INTEGER ... REFERENCES agents(id) ON DELETE CASCADE`, TEXT ISO-8601 timestamps via `strftime`. Key design decision: one row per (agent, session) with a `UNIQUE(agent_id, session_start)` constraint so the downstream poll-cycle writer can UPSERT rolling totals idempotently — not one row per message, because Claude Code's per-message usage numbers are streaming snapshots and unreliable in isolation. Include the two cache-token columns beyond the roadmap's five, since cache tokens dominate real Claude Code usage and are needed for any honest cost figure.

## Research Questions

1. What migration/table-declaration pattern does `host-server/db.ts` use, and where does a new table slot in?
2. What column types/conventions do existing tables use (ids, FKs, timestamps)?
3. What does Claude Code usage data actually look like (transcript JSONL, statusline, pane summary), and what does that imply for the schema?
4. Should rows be per-message events or per-session rolling totals, given a poll-cycle writer that upserts?
5. What DB helper functions should this task export for the downstream writer (poll cycle) and reader (dashboard)?

## Current State (Codebase)

- `host-server/db.ts::runMigrations` [S1] uses a `meta` table with a `schema_version` key; migrations are guarded `if (version < N)` blocks that end with `INSERT OR REPLACE INTO meta VALUES ('schema_version', 'N')`. Current version is **3** (v1 = base tables, v2 = agents rebuild for per-project name uniqueness, v3 = `worktree_path`/`branch` columns). A new table therefore goes in a `version < 4` block.
- Conventions from the v1 tables [S1]: `id INTEGER PRIMARY KEY` (no AUTOINCREMENT), FKs as `INTEGER REFERENCES agents(id) ON DELETE CASCADE`, timestamps as `TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))`, `CHECK` constraints inline, indexes via `CREATE INDEX IF NOT EXISTS`.
- Helper-function pattern from `db.ts::addTask` [S2]: exported functions take `db: Database.Database` as the first parameter, use prepared statements with `RETURNING *`, cast to a `XxxRow` interface, and return a camelCase-mapped domain object via a `mapXxx` function. Both a `Row` interface (snake_case, as stored) and a domain interface (camelCase) exist per table.
- Direct precedent: `wiki/work/tasks/TASK-067-agent-checkpoints-table.md` [S3] — a still-todo task adding an `agent_checkpoints` table with the same shape of work (CREATE TABLE + interface + insert/list/get helpers + tsc + sqlite3 smoke test). Note TASK-067 predates a look at the real schema and specifies `agent_id TEXT`; the actual `agents.id` is INTEGER — `agent_usage` must use INTEGER.
- `agents` rows can be deleted via `deleteAgent`; usage history should not block that → `ON DELETE CASCADE` (matches `tasks`/`schedules`).

## Key Findings

1. **Claude Code transcript JSONL carries per-message usage**: assistant entries have `message.usage` with `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` [S4][S7], and Claude Code also writes pre-calculated `costUSD` values into the JSONL, which tools like ccusage read directly [S5].
2. **Per-message JSONL usage values are unreliable as raw events**: `usage.input_tokens` is frequently a streaming placeholder (0 or 1, ~75% of entries) [S6], and `output_tokens` is a mid-stream snapshot that undercounts finals [S4]. Cache-token fields are accurate. Implication: the durable schema should store **rolling per-session totals written by a reconciling poller (UPSERT)**, not an append-only per-message event log.
3. **Cache tokens dominate real usage**: real sessions show millions of cache-read tokens vs tiny fresh-input counts [S4][S6], and the statusline's `total_input_tokens` = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` [S7]. A schema with only `input_tokens`/`output_tokens` cannot reproduce a correct cost or a meaningful "tokens used" badge — add `cache_creation_input_tokens` and `cache_read_input_tokens` columns (the roadmap's five columns are a minimum, not a ceiling).
4. **Session identity**: the natural key for a rolling-total row is (agent, session). `session_start` (per the roadmap) works as the session discriminator since the writer observes one live session per agent pane at a time; `UNIQUE(agent_id, session_start)` enables `INSERT ... ON CONFLICT DO UPDATE` and also serves as the lookup index (leftmost-prefix on `agent_id`), so no separate index is needed.
5. **cost_usd type**: REAL is fine at this scale (single-user, advisory display value, matches JSONL's float `costUSD` [S5]); no currency-integer gymnastics warranted.

## Constraints

- Must not renumber or edit existing migration blocks — append `if (version < 4)` and bump `schema_version` to `'4'`.
- Must follow db.ts conventions exactly (INTEGER pk, TEXT ISO timestamps, `db` as first helper param, Row/domain interface pair, `mapXxx`).
- Scope is schema + helpers only: no poller, no pane-regex parsing, no HTTP endpoint, no frontend (those are sibling ROADMAP-010 Phase 1 items).
- Helpers must anticipate two consumers: a poll-cycle writer that repeatedly writes the latest session totals (idempotent UPSERT with absolute values, not increments), and a dashboard reader needing both per-session breakdown and per-agent lifetime totals.

## Recommendation

Migration block (`version < 4`):

```sql
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
```

Helpers (all taking `db` first, mirroring `addTask` [S2]):
- `upsertAgentUsage(db, { agentId, sessionStart, inputTokens, outputTokens, cacheCreationInputTokens?, cacheReadInputTokens?, costUsd })` — `INSERT ... ON CONFLICT(agent_id, session_start) DO UPDATE SET` absolute values + refresh `updated_at`; returns mapped `AgentUsage`.
- `listAgentUsage(db, agentId)` — per-session rows, newest first (AgentDetailModal breakdown).
- `getAgentUsageTotals(db, agentId)` — single SUM row (badge).
- `getAllAgentUsageTotals(db)` — GROUP BY agent_id (dashboard fetches all agents in one query).

Risks/mitigations: pane-regex writer may only see input/output/cost (not cache splits) → cache columns are `DEFAULT 0` and optional in the upsert payload; a later transcript-based writer can fill them. Schema-version collision with concurrent work (TASK-067 also wants a v4-style block) → whichever lands second renumbers to `version < 5`; note this in the task.

## Next Steps

- `/task-add` this as the Phase 1, item 1 task for ROADMAP-010 (done in the same session as this research).
- Downstream siblings (separate tasks): pane-tail usage parser + poll-cycle upsert writer; dashboard badge + AgentDetailModal breakdown consuming the totals helpers.
- Optional: `/wiki-ingest raw/research/agent-usage-table/index.md`.
