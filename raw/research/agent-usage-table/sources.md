---
topic: Schema design for a new `agent_usage` SQLite table in host-server/db.ts (better-sqlite3) — per-agent per-session token/cost tracking; schema + DB helpers only (ROADMAP-010 Phase 1, item 1)
slug: agent-usage-table
researched: 2026-07-06
---

# Primary Sources — `agent_usage` table schema

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/db.ts::runMigrations` | 2026-07-06 | Versioned migration pattern (`meta.schema_version`, guarded `if (version < N)` blocks, currently 3); table conventions: `INTEGER PRIMARY KEY`, `INTEGER REFERENCES agents(id) ON DELETE CASCADE`, `TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))` timestamps, `CREATE INDEX IF NOT EXISTS` |
| S2 | codebase | `host-server/db.ts::addTask` | 2026-07-06 | Helper-function pattern: exported functions take `db: Database.Database` first, prepared statements with `RETURNING *` cast to a `XxxRow`, mapped to camelCase domain object via `mapXxx` |
| S3 | codebase | `wiki/work/tasks/TASK-067-agent-checkpoints-table.md` | 2026-07-06 | Precedent task shape for "add a table to SQLite" (CREATE TABLE + interface + insert/list/get helpers + tsc + sqlite3 smoke-test acceptance criteria); also its `agent_id TEXT` mismatch vs the real INTEGER `agents.id` |
| S4 | web | https://github.com/anthropics/claude-code/issues/27361 | 2026-07-06 | Transcript JSONL `message.usage` field shape (`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`); `output_tokens` is a mid-stream snapshot, undercounts finals; cache/input counts set at request start; real session showed ~11.3M input tokens mostly cached |
| S5 | web | https://ccusage.com/guide/cost-modes | 2026-07-06 | Claude Code writes pre-calculated `costUSD` values into its JSONL files; usage data includes cache-creation and cache-read token categories |
| S6 | web | https://gille.ai/en/blog/claude-code-jsonl-logs-undercount-tokens/ | 2026-07-06 | `usage.input_tokens` in JSONL is a streaming placeholder (75% of entries are 0 or 1); cache metrics are accurate; statusline `total_output_tokens` includes thinking |
| S7 | web | https://code.claude.com/docs/en/statusline | 2026-07-06 | Statusline JSON exposes `total_input_tokens` = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, per-component `current_usage`, `transcript_path`, `session_id` |

## Excerpts

### S4 — anthropics/claude-code issue #27361
https://github.com/anthropics/claude-code/issues/27361
> "usage": { "input_tokens": 1, "cache_creation_input_tokens": 510, "cache_read_input_tokens": 40716, "output_tokens": 310 }
> Session JSONL files (~/.claude/projects/<project>/<session-id>.jsonl) log every content block during streaming but never log the final message_stop event. output_tokens in the usage field is a mid-stream snapshot, not the final count … Input/cache token counts are accurate (set at request start)

### S5 — ccusage — Cost Modes
https://ccusage.com/guide/cost-modes
> Claude Code stores usage data in JSONL files with both token counts and pre-calculated cost information. … Claude Code provides costUSD values in JSONL files

### S6 — Claude Code's JSONL Logs Undercount Tokens by 100x
https://gille.ai/en/blog/claude-code-jsonl-logs-undercount-tokens/
> The usage.input_tokens field is a streaming placeholder — 75% of entries are 0 or 1, never updated to the real value. … But cache metrics are fine.

### S7 — Customize your status line — Claude Code Docs
https://code.claude.com/docs/en/statusline
> Combined totals (total_input_tokens, total_output_tokens): tokens currently in the context window. total_input_tokens is the sum of input_tokens, cache_creation_input_tokens, and cache_read_input_tokens
