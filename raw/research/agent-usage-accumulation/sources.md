---
topic: Accumulating rolling per-agent token totals into the agent_usage SQLite table (ROADMAP-010 Phase 1 item 3) — cost computation approach, delta-vs-absolute upsert reconciliation, and agents-API exposure point
slug: agent-usage-accumulation
researched: 2026-07-06
---

# Primary Sources — agent-usage accumulation

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/db.ts::upsertAgentUsage` (lines 706–736) + symbols overview | 2026-07-06 | TASK-072 helpers already implemented; upsert is absolute-overwrite `ON CONFLICT(agent_id, session_start) DO UPDATE SET ...=excluded.*`; table has no model column; `getAllAgentUsageTotals` exists |
| S2 | codebase | `wiki/work/tasks/TASK-073-transcript-usage-extraction.md` | 2026-07-06 | `UsageDelta` contract; `consumeUsageDeltas` stub to be replaced by this task; bootstrap from offset 0 re-emits full deltas; memo reset rules |
| S3 | codebase | `host-server/index.ts::buildSnapshot` (lines 2004–2059) + `Snapshot` interface (line 556) | 2026-07-06 | Per-agent status objects served to the dashboard; inline-typed agent array; spreads `agentContextCache`; natural place to attach `usage` totals |
| S4 | codebase | `host-server/index.ts` line 1531 `api.get('/agents')` | 2026-07-06 | Bare route returns `listAgents(db)` raw rows — not the shape the dashboard cards consume |
| S5 | codebase | `host-server/index.ts::refreshAgentContextCache` (lines 214–238) | 2026-07-06 | `CONTEXT_REFRESH_MS` loop iterating every agent with workdir in scope — the extraction wiring point named by TASK-073 step 1 |
| S6 | codebase | `~/.claude/projects/-Users-davidtaylor-Repositories-tmux-conductor/1f5cd951-2981-4023-92b5-cb8a3c8c2e5c.jsonl` | 2026-07-06 | Ground truth: `grep -c '"costUSD"'` → **0**; `grep -c '"usage"'` → 79; sample assistant record fields (sessionId, timestamp, requestId, usage block incl. cache_creation sub-object) |
| S7 | web | https://ccusage.com/guide/cost-modes | 2026-07-06 | ccusage cost modes: display (pre-calculated only), calculate (always token math), auto (costUSD when present else calculate); cache-creation fallback pricing |
| S8 | web | https://medium.com/@trysmr/how-to-calculate-claude-code-costs-on-the-claude-max-plan-20adf761d798 | 2026-07-06 | costUSD field no longer written since Claude Code ~1.0.9 |
| S9 | web | https://avinashsangle.com/blog/claude-code-cost-tracking | 2026-07-06 | ccusage works entirely offline with cached pricing data; ccost computes costs from LiteLLM pricing data |
| S10 | codebase | `raw/research/agent-usage-extraction/index.md` + `wiki/work/tasks/TASK-072-agent-usage-table.md` | 2026-07-06 | Prior-run findings reused, not re-derived: sidecar trust model, dedup, no-network-at-poll-time constraint, schema rationale |

## Excerpts

### S6 — local transcript verification (command output)
`~/.claude/projects/-Users-davidtaylor-Repositories-tmux-conductor/1f5cd951-....jsonl`
> `grep -c '"costUSD"'` → `0`; `grep -c '"usage"'` → `79`
> Sample assistant record top-level keys: `['cwd', 'entrypoint', 'gitBranch', 'isSidechain', 'message', 'parentUuid', 'requestId', 'sessionId', 'timestamp', 'type', 'userType', 'uuid', 'version']`
> `"usage": {"input_tokens": 8388, "cache_creation_input_tokens": 12070, "cache_read_input_tokens": 15291, "output_tokens": 619, ...}`

### S7 — ccusage cost modes
https://ccusage.com/guide/cost-modes
> "The display mode only shows pre-calculated costs from Claude Code" … "When Claude Code records do not include the cache_creation duration breakdown, ccusage falls back to pricing cache_creation_input_tokens at the standard cache creation rate."

### S8 — costUSD removal
https://medium.com/@trysmr/how-to-calculate-claude-code-costs-on-the-claude-max-plan-20adf761d798
> "Note: As of Claude Code version 1.0.9, it appears that the costUSD field is no longer included in $HOME/.claude/projects/*/*.jsonl files (possibly specific to the Max plan)."

### S9 — offline pricing precedent
https://avinashsangle.com/blog/claude-code-cost-tracking
> "It's a CLI that reads your local JSONL files and produces clean tables … and works entirely offline with cached pricing data." … "ccost analyzes per-request JSONL logs with detailed token counts and computes costs using LiteLLM pricing data."

### S1 — upsertAgentUsage (host-server/db.ts)
> `INSERT INTO agent_usage (...) VALUES (...) ON CONFLICT(agent_id, session_start) DO UPDATE SET input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens, cache_creation_input_tokens=excluded.cache_creation_input_tokens, cache_read_input_tokens=excluded.cache_read_input_tokens, cost_usd=excluded.cost_usd, updated_at=strftime(...)` — absolute overwrite semantics.
