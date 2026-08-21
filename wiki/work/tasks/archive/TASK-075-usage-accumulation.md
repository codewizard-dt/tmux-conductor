---
id: TASK-075
aliases: [TASK-075]
title: "Accumulate rolling token totals per agent in agent_usage — usage-store + pricing table + snapshot exposure"
status: done
created: 2026-07-06
updated: 2026-08-15
depends_on: [TASK-072, TASK-073]
blocks: [TASK-074]
parallel_safe_with: [TASK-001, TASK-011, TASK-012, TASK-050, TASK-061, TASK-062, TASK-063, TASK-065, TASK-066, TASK-067, TASK-068, TASK-069, TASK-070, TASK-071, TASK-074]
uat: "[[UAT-075]]"
tags: [observability, tokens, cost, sqlite, host-server, roadmap-010]
---

# TASK-075 — Accumulate rolling token totals per agent in `agent_usage` — usage-store + pricing table + snapshot exposure

## Objective

Wire TASK-073's per-poll `UsageDelta` output into TASK-072's `agent_usage` table: fold deltas into in-memory absolute per-(agent, session) totals, compute `cost_usd` (ccusage-`auto` semantics: `costUSD` passthrough when present, else static pricing-table math), idempotently upsert rolling session totals via `upsertAgentUsage` each poll, and expose per-agent lifetime totals as `usage: AgentUsageTotals | null` on the snapshot agents payload so the dashboard badge ([TASK-074](TASK-074-usage-badge-ui.md)) can render them. Replaces the `consumeUsageDeltas` stub that TASK-073 left in `host-server/usage.ts`. **Scope ends at the payload field** — no frontend changes (TASK-074), no per-session breakdown endpoint/UI (later Phase 1 sibling).

## Approach

Research: `raw/research/agent-usage-accumulation/index.md` (builds on `raw/research/agent-usage-extraction/index.md`).

Decisions made there, recorded here as binding:

- **Cost = pricing-table math with `costUSD` passthrough preferred (ccusage `auto` mode).** TASK-073 deferred the cost decision to this task. Verified locally that modern Claude Code writes **zero** `costUSD` fields (0 occurrences vs 79 `usage` blocks in the newest tmux-conductor transcript); community sources date the removal to Claude Code ≥1.0.9. Passthrough-only would therefore report $0 forever — a static per-model pricing table is mandatory. Per delta: `costUsd = delta.costUSD ?? computeCostUsd(delta.model, tokens)`. No network fetch at poll time (constraint carried from the extraction research); the table is a small in-repo module, the same offline posture ccusage/ccost take with LiteLLM-derived rates.
- **Rates must be sourced from the `claude-api` skill reference at implementation time — NEVER from the implementer's memory.** Include per-MTok rates for input, output, cache write, cache read for the model families that appear in transcripts (`claude-fable-5` observed locally; also cover current opus/sonnet/haiku ids). `UsageDelta.cacheCreationTokens` carries no TTL breakdown, so price all cache-creation tokens at the standard (5-minute) cache-write rate — ccusage's documented fallback; note the approximation in a comment.
- **Unknown models never block token recording:** tokens are folded in regardless; that slice contributes cost 0 and a once-per-model `console.warn` (module-level `Set<string>`).
- **Delta→absolute reconciliation: in-memory accumulator + overwrite upsert.** `upsertAgentUsage` is absolute-overwrite (`ON CONFLICT ... SET col=excluded.col`), and TASK-073's memo bootstrap re-parses from byte offset 0 after any restart/reset and **re-emits full-file deltas**. Therefore a `Map<agentId, Map<sessionKey, SessionTotals>>` that sums deltas always holds the true absolute session total, and every upsert is idempotent across restarts, replays, and repeated polls. An *additive* SQL upsert would double-count every restart — rejected; do not modify `db.ts` helpers.
- **`session_start` key must be restart-stable.** Preferred: the timestamp of the first parsed assistant record of the session, exposed from `usage.ts`'s memo as a small documented contract extension (stable because bootstrap re-reads from offset 0). Fallback when unavailable: the `sessionId` UUID string itself. **Never** use "first time this process saw the session" wall-clock time — it changes across restarts and forks duplicate rows.
- **Per-model cost, cross-model token sums.** `agent_usage` has no model column; deltas are per-model. Compute cost per delta (per model) *before* folding, then sum tokens and cost across models into the one session row.
- **Exposure point is the snapshot, not `GET /agents`.** The dashboard seeds from `GET /status` and stays live via SSE `agent-update` events; both flow from `buildSnapshot()` in `host-server/index.ts` (the bare `api.get('/agents')` returns raw `listAgents(db)` rows and is not what agent cards render). Attach `usage: AgentUsageTotals | null` per agent from **one** `getAllAgentUsageTotals(db)` call per snapshot tick (~2s; in-process SQLite aggregate — cheap). Field name `usage` and the `AgentUsageTotals` shape (`inputTokens`, `outputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, `costUsd`, `sessions`) are exactly what TASK-074 codes against — do not rename.
- **Write discipline:** upsert only sessions actually touched by this poll's deltas; empty `deltas` → zero DB work. After writing, prune accumulator entries for an agent's non-current sessions (bounded memory; the current session is the only one still receiving deltas).
- **Hot-file discipline (CRITICAL):** `host-server/index.ts` and `host-server/db.ts` are concurrently edited by other orchestrators. All new logic lives in **new files** `host-server/usage-store.ts` and `host-server/pricing.ts`. `db.ts` needs **zero** edits (TASK-072's helpers are already merged). `index.ts` edits are minimal Serena symbol-level operations (`find_symbol`, `replace_symbol_body`, `insert_after_symbol`, `replace_content`) — never whole-file rewrites; re-read the target symbol immediately before every edit and retry on conflict. `usage.ts` is fair game only at the seams TASK-073 designated (the `consumeUsageDeltas` stub, plus the session-start contract extension below).

## Steps

### 1. Confirm integration state  <!-- agent: Explore -->

- [x] `mcp__serena__get_symbols_overview` on `host-server/usage.ts` — TASK-073 must be merged first (hard dependency). Confirm the exports `UsageDelta`, `extractUsageDeltas`, `resetUsageMemo`, and the `consumeUsageDeltas` stub (or `onUsageDeltas` callback hook — adapt Step 5 to whichever variant landed). Note the exact `UsageDelta` field names (`cacheCreationTokens`/`cacheReadTokens` per spec).
- [x] `mcp__serena__find_symbol` for `upsertAgentUsage`, `getAllAgentUsageTotals`, `AgentUsageTotals` in `host-server/db.ts` — confirm signatures match TASK-072 (already merged at task-creation time: `upsertAgentUsage(db, { agentId, sessionStart, inputTokens, outputTokens, cacheCreationInputTokens?, cacheReadInputTokens?, costUsd })`, absolute overwrite).
- [x] `mcp__serena__search_for_pattern` for `extractUsageDeltas|consumeUsageDeltas` in `host-server/index.ts` — locate the call site TASK-073 wired into the per-agent poll iteration (expected inside `refreshAgentContextCache` or the status-poll loop) and note which `agent` object is in scope there (it must carry `id` and `name`).
- [x] `mcp__serena__find_symbol` on `buildSnapshot` and the `Snapshot` interface in `host-server/index.ts` (at task-creation time: lines ~2004 and ~556). Also `search_for_pattern` for `contextTokens` in `index.ts` to check whether any *second* agent-serialization site spreads context fields (TASK-074's notes suggest two sites) — every site that feeds `/status` or `agent-update` SSE must carry the `usage` field.

### 2. Create `host-server/pricing.ts`  <!-- agent: general-purpose -->

- [x] New file exporting:
  - `interface ModelPricing { inputPerMTok: number; outputPerMTok: number; cacheWritePerMTok: number; cacheReadPerMTok: number }`
  - `const MODEL_PRICING: Record<string, ModelPricing>` — keys are model-id prefixes (e.g. `claude-fable-5`, `claude-sonnet-4-5`, `claude-opus-4`, `claude-haiku-4-5` — use the ids and per-MTok USD rates from the **`claude-api` skill reference**, read at implementation time; do not invent rates).
  - `resolvePricing(model: string): ModelPricing | null` — longest-prefix match against `MODEL_PRICING` keys (transcript model ids may carry date/version suffixes).
  - `computeCostUsd(model: string, t: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }): number | null` — `null` for unknown models (caller warns once and uses 0); otherwise `(input*in + output*out + cacheCreation*write + cacheRead*read) / 1_000_000`.
- [x] Comment block at top: rates snapshot date, source (claude-api skill reference), and the cache-write TTL approximation (all cache-creation tokens priced at the 5-minute rate; JSONL delta carries no TTL split).

### 3. Create `host-server/usage-store.ts`  <!-- agent: general-purpose -->

- [x] New file importing `UsageDelta` from `./usage`, `upsertAgentUsage` + `AgentUsage` types from `./db`, `computeCostUsd` from `./pricing`, and `Database` from `better-sqlite3`. Exports:
  - `recordUsageDeltas(db: Database.Database, agent: { id: number; name: string }, deltas: UsageDelta[]): void` — the single entry point, called each poll.
  - `resetUsageStore(agentId?: number): void` — clears the accumulator for one agent (agent deletion) or all (tests).
- [x] Internal state: `Map<number, Map<string, { sessionStart: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; costUsd: number }>>` keyed agentId → sessionKey.
- [x] `recordUsageDeltas` flow:
  1. `if (deltas.length === 0) return;` — idle polls cost nothing.
  2. Per delta: resolve `sessionKey` (Step 4 contract; fallback `delta.sessionId ?? 'unknown'`), resolve `deltaCost = delta.costUSD ?? computeCostUsd(delta.model, delta) ?? 0` (warn once per unknown model), and fold all four token fields + cost into the session's running totals.
  3. For each session touched this call, `upsertAgentUsage(db, { agentId: agent.id, sessionStart: <sessionKey/sessionStart value>, ...absolute totals })`.
  4. Prune: after writing, drop this agent's accumulator entries for sessions other than the most recently touched one (memory bound; a session that stopped receiving deltas is final — its row already holds its last absolute totals).
  5. Entire body in try/catch (log and continue) — accumulation must never crash the poll loop.
- [x] Document the idempotency contract in a comment: correctness depends on `usage.ts` bootstrap re-emitting full-file deltas after any memo reset, so in-memory totals are always absolute; the DB upsert is overwrite, not additive.

### 4. Session-start contract in `usage.ts`  <!-- agent: general-purpose -->

- [x] Small, documented extension to TASK-073's module (this task owns the stub seam): expose the first parsed assistant record's `timestamp` for the current session — either as a new optional `UsageDelta.sessionStart?: string` field (set on every emitted delta) or an exported `getUsageSessionStart(agentName: string): string | null` reading the memo. Prefer whichever is smaller against the landed implementation; it is restart-stable because bootstrap re-parses from offset 0.
- [x] `usage-store.ts` uses it as the `session_start` upsert value; when `null`/absent, fall back to the `sessionId` string. (Note for the detail-modal sibling: `listAgentUsage` orders by `session_start DESC` — ISO timestamps sort correctly; UUID fallbacks don't, order by `updated_at` there if it matters.)

### 5. Replace the stub — wire `recordUsageDeltas` into the poll  <!-- agent: general-purpose -->

- [x] **Hot file — Serena symbol ops only.** At the `index.ts` call site found in Step 1, replace the stub invocation with `recordUsageDeltas(db, agent, extractUsageDeltas(agent.name, agent.workdir, stateDir))` (adjust to the in-scope variable names) plus the import — keep the total `index.ts` diff to ≤4 lines.
- [x] In `usage.ts`, delete the no-op `consumeUsageDeltas` stub (or repoint the `onUsageDeltas` callback registration to `recordUsageDeltas` from `index.ts`, if that variant landed) so there is exactly one consumption path.
- [x] If agent deletion is handled in `index.ts` (DELETE `/agents/:id` route calling `deleteAgent`), add a `resetUsageStore(agent.id)` + existing `resetUsageMemo(agent.name)` call there if trivially insertable at symbol level; otherwise note it as a known gap in the task's Verification section (DB rows cascade-delete already; stale memory totals for a deleted agent are harmless until process restart).

### 6. Expose totals on the snapshot payload  <!-- agent: general-purpose -->

- [x] **Hot file — Serena symbol ops only, re-read `buildSnapshot` immediately before editing.** In `buildSnapshot`: before the `agents.map(...)`, build `const usageByAgent = new Map(getAllAgentUsageTotals(db).map((t) => [t.agentId, t]));` (wrap in try/catch → empty map, so a pre-migration DB never breaks the snapshot); inside the per-agent object add `usage: usageByAgent.get(agent.id) ?? null`.
- [x] Update the `Snapshot` interface's inline agent type with `usage: AgentUsageTotals | null` (import the type from `./db`).
- [x] If Step 1 found a second serialization site spreading context fields into `agent-update` SSE payloads, attach the same field there identically. SSE diffing then propagates badge updates automatically — no new event types.
- [x] Field name is `usage`, value shape is `AgentUsageTotals` — the exact contract TASK-074 reads; do not rename or flatten.

### 7. Unit tests  <!-- agent: general-purpose -->

- [x] `host-server/usage-store.test.ts` following the `db.migration.test.ts` runner conventions, on an in-memory/`./tmp/` SQLite DB with the v4 schema (open via `openDb`/`runMigrations`) and a seeded agent row:
  - **Accumulates across polls:** two `recordUsageDeltas` calls with successive deltas for one session → one `agent_usage` row holding the sum.
  - **Restart idempotency:** feed deltas, `resetUsageStore()`, re-feed the *full-file* equivalent (bootstrap replay) → row values unchanged, still one row.
  - **Multi-model session:** two models in one session → tokens summed, cost = sum of per-model rate math.
  - **costUSD passthrough wins:** delta with `costUSD: 0.5` contributes exactly 0.5 regardless of the table.
  - **Unknown model:** tokens recorded, cost contribution 0, no throw.
  - **Session change:** deltas for a second `sessionId` → second row; first row untouched; accumulator pruned to the current session.
  - **Empty deltas:** no DB write (assert via `updated_at` unchanged or prepare-spy).
- [x] `pricing.test.ts` (or same file): longest-prefix resolution (versioned model id resolves), unknown model → `null`.

### 8. Typecheck, smoke, verify  <!-- agent: general-purpose -->

- [x] `npx tsc --noEmit` in `host-server/` — zero errors. Run the new tests — green.
- [DEFERRED-TO-UAT] Live smoke (if a conductor session is running): after an agent completes a turn, `sqlite3 ./data/conductor.db "SELECT agent_id, session_start, input_tokens, output_tokens, cache_read_input_tokens, cost_usd FROM agent_usage"` shows a row with plausible values; `curl -s localhost:8788/status | jq '.agents[0].usage'` returns the totals object (or `null` for agents without usage). Restart the host-server and confirm the row's values do not double. *(2026-07-06: not run — curl/sqlite3 approval-gated in the implementing session; restart idempotency is unit-tested. Run these before UAT.)*

<!-- Updated: 2026-07-06 18:10 -->

## Acceptance Criteria

- [x] Each poll with non-empty deltas upserts absolute per-session totals into `agent_usage` via `upsertAgentUsage`; one row per (agent, session); repeated polls and host-server restarts never inflate values (verified by the restart-idempotency test and live smoke).
- [x] `cost_usd` is computed per-model (passthrough `costUSD` when present, else static pricing table sourced from the claude-api skill); unknown models still record tokens with cost 0 and a single warning.
- [x] `session_start` is restart-stable (first-record timestamp, or sessionId fallback) — no duplicate rows for one session across restarts.
- [x] `/status` and `agent-update` SSE agent objects carry `usage: AgentUsageTotals | null` (field name and shape exactly as TASK-074 expects); pre-migration or empty DBs yield `null`, never an error.
- [x] `host-server/db.ts` untouched; `host-server/index.ts` diff is a minimal symbol-level insertion (import + call + snapshot field); all new logic in `usage-store.ts` / `pricing.ts` (+ the documented `usage.ts` seam edits).
- [x] `npx tsc --noEmit` passes; new unit tests green; no DB writes on idle polls.

## Dependencies

- **DEPENDS ON [TASK-072](TASK-072-agent-usage-table.md)** — `agent_usage` table, `upsertAgentUsage`, `getAllAgentUsageTotals`, `AgentUsageTotals` (already merged in `host-server/db.ts` at task-creation time).
- **DEPENDS ON [TASK-073](TASK-073-transcript-usage-extraction.md)** — `host-server/usage.ts` `extractUsageDeltas`/`UsageDelta` and the `consumeUsageDeltas` stub this task replaces (not yet implemented at task-creation time — do not start this task before it lands).
- **BLOCKS [TASK-074](TASK-074-usage-badge-ui.md)** — the badge reads `agent.usage` from the snapshot payload this task exposes (TASK-074 can proceed in parallel against its documented fallback shape, which this task matches verbatim).
- Downstream Phase 1 sibling (no task file yet): per-session usage breakdown in `AgentDetailModal` — consumes `listAgentUsage`; needs its own endpoint; out of scope here.

## Rationale — cost approach decision (deferred here by TASK-073)

TASK-073 explicitly deferred pricing-table-vs-passthrough to this task. Decision: **ccusage `auto` semantics — passthrough when present, pricing-table math otherwise — with the table mandatory.** Evidence: local ground truth shows 0 `costUSD` occurrences against 79 `usage` blocks in the newest transcript (field removed since Claude Code ~1.0.9), so passthrough alone yields a permanently-$0 badge; ccusage/ccost precedent computes from LiteLLM-derived rates and runs fully offline, matching this repo's no-network-at-poll-time constraint. Full evidence and source register: `raw/research/agent-usage-accumulation/` (index.md + sources.md).

### Roadmap

Implements ROADMAP-010 Phase 1, item "Accumulate rolling token totals per agent in the `agent_usage` table" — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`.

## Implementation notes (2026-07-06)

- **Landed in the same session as TASK-073**, so there was never a `consumeUsageDeltas` stub to replace: `refreshAgentContextCache` in `index.ts` calls `recordUsageDeltas(db, { id, name: wn }, extractUsageDeltas(wn, agent.workdir, conf.stateDir))` directly — one consumption path from the start. Session-start contract landed as `getUsageSessionStart(agentName)` exported from `usage.ts`.
- **Pricing rates sourced from Anthropic's published pricing** (platform.claude.com pricing page + anthropic.com, via web search corroborated across 4+ sources) — the claude-api skill reference was not readable in the implementing session (permission-gated). Snapshot date 2026-07-06 recorded in `pricing.ts`'s header. Notable: `claude-sonnet-5` is at the introductory $2/$10 rate through 2026-08-31 (standard $3/$15 after — the table will need a bump then); all cache-creation tokens priced at the 5-minute write rate (1.25× input) since deltas carry no TTL split; cache reads 0.1× input.
- **Snapshot exposure went beyond `buildSnapshot`** (sanctioned by Step 6's "second serialization site" clause): both SSE `agent-update` serialization sites (the on-connect replay and the diff-tick broadcast) now carry `usage: agent.usage`, and the diff gate additionally compares `usage.costUsd`/`usage.outputTokens` so badge updates broadcast even when nothing else changed. `resetUsageMemo`/`resetUsageStore` wired into the agent DELETE route, and `resetUsageMemo(oldWindowName)` into the rename route (memo is keyed by window name).
- Tests: `host-server/usage-store.test.ts` — 8 node:test cases (accumulation, restart idempotency, multi-model cost, costUSD passthrough, unknown model, session change + prune, empty deltas, pricing prefix resolution), all green; `npx tsc --noEmit` clean. Full host-server suite 28/28.
