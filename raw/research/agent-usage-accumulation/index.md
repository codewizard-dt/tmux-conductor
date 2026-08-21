---
topic: Accumulating rolling per-agent token totals into the agent_usage SQLite table (ROADMAP-010 Phase 1 item 3) — cost computation approach (costUSD passthrough vs pricing-table math), delta-vs-absolute upsert reconciliation, and where to expose totals in the agents API
slug: agent-usage-accumulation
researched: 2026-07-06
sources: [./sources.md]
---

# Research: Accumulating rolling per-agent token totals into `agent_usage`

> **Recommendations:** (1) **Cost must be computed from a static in-repo pricing table** — verified locally that modern Claude Code writes **zero** `costUSD` fields (0 occurrences vs 79 `usage` blocks in the newest tmux-conductor transcript); pure passthrough would permanently report $0. Use ccusage `auto` semantics: honor `delta.costUSD` when non-null, else per-model rate math (input/output/cache-write/cache-read), rates sourced at implementation time from the claude-api skill reference — never from model memory, never via network fetch at poll time. (2) **Reconcile deltas→absolute-overwrite with an in-memory per-(agent, session) accumulator**: because TASK-073's bootstrap re-parses from byte offset 0 after a restart and re-emits full-file deltas, the accumulator's running sum per session *is* the absolute session total at all times, and `upsertAgentUsage`'s overwrite semantics make every write idempotent — no additive SQL, no read-modify-write, no restart double-counting. (3) **Expose totals on each agent object in `buildSnapshot`** (the shape the dashboard actually consumes via `/status` + SSE), populated from one `getAllAgentUsageTotals(db)` call per snapshot; the bare `GET /agents` route returns raw `listAgents(db)` rows and is not what the badge reads.

> Builds on [../agent-usage-extraction/index.md](../agent-usage-extraction/index.md) (extraction approach, dedup, sidecar trust model) and TASK-072's research; this report covers only the accumulation-layer decisions.

## Research Questions

1. Does modern Claude Code still emit `costUSD` in transcript JSONL, and therefore should cost be passthrough or pricing-table math?
2. How to reconcile TASK-073's per-poll `UsageDelta` increments with TASK-072's absolute-overwrite `upsertAgentUsage` (UNIQUE(agent_id, session_start)), including idempotency across host-server restarts?
3. What value should the `session_start` upsert key hold, given `UsageDelta` carries `sessionId` (a UUID), not a start time?
4. Where in the agents API should per-agent totals surface so the frontend badge sibling can read them?

## Current State (Codebase)

- **TASK-072 is already implemented.** `host-server/db.ts` exports `upsertAgentUsage`, `listAgentUsage`, `getAgentUsageTotals`, `getAllAgentUsageTotals`, `mapAgentUsage`, plus `AgentUsage`/`AgentUsageRow`/`AgentUsageTotals` interfaces [S1]. `upsertAgentUsage(db, { agentId, sessionStart, inputTokens, outputTokens, cacheCreationInputTokens?, cacheReadInputTokens?, costUsd })` does `INSERT ... ON CONFLICT(agent_id, session_start) DO UPDATE SET <all metric columns>=excluded.*` — **absolute overwrite, not additive** [S1].
- **The `agent_usage` table has no `model` column** — deltas are per-model, so cost must be computed per-delta (per model) *before* summing into the session row [S1].
- **TASK-073 (`host-server/usage.ts`) is not yet implemented** — no `usage.ts` exists in `host-server/` yet; this task consumes its spec'd contract (`UsageDelta { agentName, sessionId, model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, costUSD, ts }`, `consumeUsageDeltas` stub) [S2].
- **Dashboard data path:** `buildSnapshot()` (host-server/index.ts:2004) assembles the per-agent status objects served to the frontend (`/status` + SSE diffing via `pollAndDiff`); each agent object spreads `agentContextCache` [S3]. The bare `api.get('/agents')` (line 1531) returns `listAgents(db)` — plain DB rows, not the status shape the dashboard cards render [S4]. The `Snapshot` interface (line 556) inline-types the agent array — adding a `usage` field means touching `Snapshot` + `buildSnapshot` only.
- **Poll loops:** `refreshAgentContextCache(conf)` runs on the `CONTEXT_REFRESH_MS` managed loop and iterates every agent with `agent.workdir` in hand — the natural host for the per-agent `extractUsageDeltas` call TASK-073 wires in [S5]. `buildSnapshot` runs on the ~2s status-poll loop.
- **Local transcript ground truth:** newest transcript in `~/.claude/projects/-Users-davidtaylor-Repositories-tmux-conductor/` contains `"costUSD"` **0 times** and `"usage"` 79 times; assistant records carry top-level `sessionId`, `timestamp`, `requestId`, `uuid`, `isSidechain`, and `message.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` (plus newer sub-objects like `cache_creation.ephemeral_1h_input_tokens`) [S6].

## Key Findings

1. **`costUSD` is gone from modern transcripts.** Locally verified: 0 occurrences across the newest session transcript [S6]. Community sources date the removal to Claude Code ≥1.0.9 (at minimum on subscription plans) [S8]. Passthrough-only cost would therefore always be $0 — **pricing-table math is mandatory**, with `costUSD` passthrough kept only as a preference when a record does carry it (ccusage `auto` mode: "pre-calculated when available, else calculate") [S7].
2. **ccusage/ccost precedent:** both compute from LiteLLM's `model_prices_and_context_window.json` rates with separate cache-creation and cache-read pricing; ccusage "works entirely offline with cached pricing data" [S7][S9]. For tmux-conductor the equivalent is a small static in-repo table (no network at poll time — constraint carried over from the extraction research).
3. **Bootstrap re-emission makes absolute-overwrite the trivially correct semantics.** TASK-073 spec: after any memo reset (restart, session change, truncation) extraction re-parses from offset 0 and **deltas seen at bootstrap DO emit** [S2]. Therefore an in-memory accumulator that sums deltas per (agent, sessionId) always holds the absolute session total, and writing it through `upsertAgentUsage`'s overwrite is idempotent under restarts, replays, and repeated polls. An *additive* SQL upsert would instead double-count every restart — reject it. A DB read-modify-write is unnecessary (better-sqlite3 is synchronous single-process) and would still double-count bootstrap replays unless it also tracked replay state.
4. **Restart gap caveat (accept, document):** usage written to the transcript *while the host-server is down* for a session whose row already exists is not lost — bootstrap re-parses the whole file, so the next upsert includes it. The only true loss window is a session that started *and ended* entirely while the server was down and whose transcript rotates away before the next poll — acceptable for a dashboard.
5. **`session_start` key choice:** `UsageDelta.sessionId` is the only restart-stable identifier the contract guarantees. Two viable values for the `session_start` column: (a) the sessionId UUID itself — maximally simple, stable, but not chronologically sortable (`listAgentUsage` orders by `session_start DESC`); (b) the timestamp of the first parsed assistant record of the session, exposed from `usage.ts`'s memo — restart-stable because bootstrap re-reads from offset 0, chronologically meaningful, matches the column name. **(b) is preferred** as a small documented contract extension (this task already owns replacing `consumeUsageDeltas` inside `usage.ts`); fall back to the sessionId string when no timestamp is derivable. Either way the key must never be "first time this server process saw the session" wall-clock time — that changes across restarts and would fork duplicate rows.
6. **Exposure point:** the badge sibling renders agent cards from the snapshot agents array (SSE + `/status`), not from `GET /agents` [S3][S4]. One `getAllAgentUsageTotals(db)` aggregate query per snapshot tick (~2s, in-process SQLite) is cheap and keeps totals live; a `usage: AgentUsageTotals | null` field per agent slot is the minimal contract.

## Constraints

- `host-server/index.ts` and `host-server/db.ts` are hot files — accumulation logic goes in a **new module**; index.ts/db.ts touches must be minimal Serena symbol-level edits (db.ts should need zero edits — helpers exist).
- No network at poll time; pricing is static in-repo data. Rates must be sourced from the claude-api skill reference at implementation time (never from the implementer's memory).
- Unknown model ids must not crash or block token recording — record tokens, cost 0 for that slice, warn once per model.
- `agent_usage` has no model column: per-model cost math happens pre-aggregation; token columns sum across models per session.
- Deltas carry `agentName`; `upsertAgentUsage` needs `agentId` — the caller in index.ts has `agent.id` in scope, so pass it through rather than re-querying by name.
- DB writes only when a poll produced non-empty deltas (idle agents cost one `stat` and zero writes).

## Solution Comparison

**Q1 — cost computation:**

| Criteria | A: costUSD passthrough only | B: pricing table only | C: auto (passthrough when present, else table) |
|----------|---------------------------|----------------------|------------------------------------------------|
| **Correctness today** | Always $0 (field absent) [S6][S8] | Correct | Correct |
| **Forward-compat** | Depends on Anthropic re-adding field | Ignores authoritative per-record costs if they return | Best of both; ccusage default [S7] |
| **Complexity** | Trivial | Low (static table + prefix match) | Low |
| **Verdict** | Reject | Acceptable | **Recommended** |

**Q2 — delta accumulation:**

| Criteria | A: in-memory session accumulator + absolute overwrite | B: additive SQL upsert | C: read-modify-write per poll |
|----------|------------------------------------------------------|------------------------|-------------------------------|
| **Restart idempotency** | Free — bootstrap re-emission rebuilds totals exactly | Double-counts every restart | Double-counts unless replay-aware |
| **Matches TASK-072 helper** | Yes, as-is | Requires new/changed helper (hot-file edit) | Extra query per poll |
| **Complexity** | Low (Map of Maps) | Low but wrong | Medium |
| **Verdict** | **Recommended** | Reject | Reject |

## Recommendation

New module `host-server/usage-store.ts` (keeps extraction/persistence separation; avoids growing usage.ts beyond TASK-073's contract):

1. `recordUsageDeltas(db, agent: { id: number; name: string }, deltas: UsageDelta[])` — per delta: resolve cost (`delta.costUSD ?? computeCost(model, tokens)`), fold into an in-memory `Map<agentId, Map<sessionKey, SessionTotals>>`, then `upsertAgentUsage` the affected session's absolute totals. Skip entirely when `deltas.length === 0`.
2. `host-server/pricing.ts` — static per-model `{ inputPerMTok, outputPerMTok, cacheWritePerMTok, cacheReadPerMTok }` with longest-prefix model matching and an unknown-model fallback (cost 0 + one-time warn). Rates copied from the claude-api skill reference during implementation.
3. Replace TASK-073's `consumeUsageDeltas` stub: the index.ts call site (inside `refreshAgentContextCache`'s per-agent loop, where TASK-073 wired extraction) becomes `recordUsageDeltas(db, agent, extractUsageDeltas(...))` — a 1–2 line Serena symbol edit.
4. `session_start` value: first-record timestamp exposed from usage.ts's memo (preferred; documented contract extension), else the sessionId string.
5. Exposure: add `usage: AgentUsageTotals | null` to the `Snapshot` agent shape; `buildSnapshot` builds a `Map` from one `getAllAgentUsageTotals(db)` call and attaches per agent. SSE diffing picks up changes automatically.

Risks & mitigations: pricing drift → single static table file, trivially updatable; unknown models → tokens still recorded, cost 0 warned once; memory growth → accumulator holds only sessions seen this process lifetime per agent (bounded, prune non-current sessions after final write); double servers → out of scope (single-user local system).

## Next Steps

- `/task-add` ROADMAP-010 Phase 1 item 3 with `depends_on: [TASK-072, TASK-073]`, scoped: `usage-store.ts` + `pricing.ts`, stub replacement, snapshot exposure. (This research is that task's rationale.)
- Badge sibling reads `agent.usage` from the snapshot; modal sibling uses `listAgentUsage` (needs its own endpoint — out of scope here).
- Later: `/wiki-ingest raw/research/agent-usage-accumulation/index.md`.
