---
id: TASK-073
aliases: [TASK-073]
title: "Per-agent usage extraction — parse Claude Code transcript JSONL each poll (supersedes pane-tail regex)"
status: done
created: 2026-07-06
updated: 2026-07-06
depends_on: []
blocks: []
parallel_safe_with: [TASK-061, TASK-062, TASK-063, TASK-064, TASK-065, TASK-066, TASK-067, TASK-068, TASK-069, TASK-070, TASK-071, TASK-072]
uat: "[[UAT-073]]"
tags: [observability, tokens, usage, host-server, roadmap-010]
---

# TASK-073 — Per-agent usage extraction — parse Claude Code transcript JSONL each poll (supersedes pane-tail regex)

## Objective

On each host-server poll cycle, extract authoritative per-agent token usage (input / output / cache-creation / cache-read tokens, model, optional `costUSD`) for Claude Code agents by incrementally parsing the agent's transcript JSONL, and emit normalized per-model `UsageDelta` records for downstream persistence. **Scope: extraction only** — the `agent_usage` SQLite table ([TASK-072](TASK-072-agent-usage-table.md)) and accumulation of deltas into it (ROADMAP-010 Phase 1 item 3) are separate tasks that consume this module's output.

## Approach

**Design decision — transcript-JSONL parsing, not pane-tail regex.** ROADMAP-010 originally worded this item as "Parse Claude Code usage summary from pane tail via regex". Research (see `raw/research/agent-usage-extraction/index.md`) found the pane exposes **no token or cost text to scrape**: the repo's own `parsePaneTail` in `host-server/context.ts` can only extract a model name and context-size header, and the statusline receives its token data as a stdin JSON payload (never printed pane text) and hides during UI interactions. Meanwhile every assistant turn in the transcript JSONL carries an exact `message.usage` block — the same source ccusage, ccost, claude-devtools, and Claude Code's own `/cost` consume. This task therefore mandates the ccusage-style approach; the roadmap line is updated to reflect it.

Key mechanics (all justified in the research report):

- **Transcript resolution via the hook sidecar only.** Use `resolveTranscriptPath(agentName, workdir, stateDir)` from `host-server/context.ts` and count usage **only when `source === 'sidecar'`** (`logs/state/<agent>.meta.json` pins the MAIN session transcript). Derived newest-by-mtime paths can point at a foreign session when agents share a workdir — never count from them. Non-Claude agents (Codex, Aider) and agents with no sidecar yield `null`, never an error.
- **Incremental reads.** Transcripts are append-only per session. Keep a per-agent memo `{ transcriptPath, sessionId, byteOffset, perRequest }`; each poll, `fs.read` from `byteOffset` to EOF, parse only appended complete lines (carry a partial-line remainder), and advance the offset. Reset the memo when the sidecar path or `session_id` changes, or when file size < offset (truncation/rotation).
- **Streaming dedup — last-entry-wins per `requestId`.** Claude Code writes multiple JSONL entries per API response during streaming, sharing one top-level `requestId` with incrementally increasing `output_tokens`; naive summation double-counts (~2x vs `/cost`). Keep only the latest usage per `requestId` (fallback key: `message.id`; final fallback: the record's `uuid`). This matches ccusage#835 / claude-devtools#74.
- **Record filter — same as `readTranscriptInfo`:** `type === 'assistant'`, not `isSidechain`, `message.usage` present, `message.model !== '<synthetic>'`.
- **Output shape, not persistence.** Emit `UsageDelta` records: `{ agentName, sessionId, model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, costUSD (null when absent from records), ts }`, aggregated per model per poll. Delta semantics: only requests newly seen (or whose last-entry usage changed) since the previous poll contribute. Cost math beyond passing through `costUSD` (i.e. pricing-table calculation) belongs to the accumulation sibling — do NOT add a pricing table or network fetch here.
- **Known caveat (document, don't fight):** `usage.input_tokens` is sometimes a streaming placeholder (0/1) and output may exclude thinking tokens; cache fields are accurate. Reporting what the transcript says matches `/cost`, which is the right consistency bar.
- **Hot-file discipline:** `host-server/index.ts`, `host-server/db.ts`, and `scripts/monitor.sh` are concurrently edited by other orchestrators. All new logic goes in a **new file** `host-server/usage.ts`; wiring into `index.ts` must be a minimal, symbol-level insertion performed with Serena tools (`get_symbols_overview`, `find_symbol`, `insert_after_symbol` / `replace_symbol_body`) — never whole-file rewrites. `db.ts` and `monitor.sh` are untouched by this task.

## Steps

### 1. Confirm integration points  <!-- agent: Explore -->

- [x] `mcp__serena__get_symbols_overview` on `host-server/context.ts` — confirm `resolveTranscriptPath` signature `(agentName, workdir, stateDir) => ResolvedTranscript | null` and the `ResolvedTranscript.source` field; confirm it is exported (export it if not, via `replace_symbol_body`).
- [x] `mcp__serena__get_symbols_overview` on `host-server/index.ts` — locate the recurring poll where per-agent status is computed (the ~2s `detectAgentStatus` loop and/or the SSE broadcast loop that already calls `getAgentContext`) and note the exact symbol to hook into. Read only the needed symbols with `find_symbol include_body=true`; do not read the whole file.
- [x] Inspect one real transcript line to validate field assumptions: `head` an assistant record from a `*.jsonl` under `~/.claude/projects/` (fields: top-level `requestId`, `uuid`, `isSidechain`, `type`, `message.id`, `message.model`, `message.usage.{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}`, optional `costUSD`).

### 2. Create `host-server/usage.ts`  <!-- agent: general-purpose -->

- [x] New file `host-server/usage.ts` exporting:
  - `interface UsageDelta { agentName: string; sessionId: string | null; model: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; costUSD: number | null; ts: string }`
  - `extractUsageDeltas(agentName: string, workdir: string, stateDir: string): UsageDelta[]` — the single per-poll entry point.
  - `resetUsageMemo(agentName: string): void` — for tests and agent deletion.
- [x] Internal per-agent memo `Map<string, { transcriptPath: string; sessionId: string | null; byteOffset: number; remainder: string; perRequest: Map<string, { usage; model; costUSD }> }>`.
- [x] `extractUsageDeltas` flow:
  1. `resolveTranscriptPath(...)`; return `[]` unless `resolved?.source === 'sidecar'`.
  2. Memo reset on `resolved.path !== memo.transcriptPath` or `resolved.sessionId !== memo.sessionId`; on first sighting of a transcript that already has content, initialize by parsing from offset 0 (bootstrap read) — records seen at bootstrap populate `perRequest` and DO emit deltas (the accumulator sibling owns idempotency across restarts via its own bookkeeping; note this contract in a comment).
  3. `fs.statSync`; if `size < byteOffset` → full memo reset (truncation). If `size === byteOffset` → return `[]` (fast path, no read).
  4. Open with `fs.openSync`/`fs.readSync` from `byteOffset`, decode UTF-8, prepend `remainder`, split on `\n`, keep the final partial segment as the new `remainder`, advance `byteOffset` to `size` minus the byte length of the remainder.
  5. Per complete line: cheap prefilter `line.indexOf('"usage"') !== -1` (mirrors `readTranscriptInfo`), then `JSON.parse` in try/catch (skip bad lines); apply the record filter (assistant, not sidechain, usage present, model not `<synthetic>`).
  6. Dedup key: `record.requestId ?? record.message?.id ?? record.uuid`; upsert into `perRequest`, tracking whether the entry is new or its usage changed (last-entry-wins).
  7. For each new/changed request, compute the per-field delta vs the previously stored usage for that key (new key → full values), aggregate per model, and return the aggregated `UsageDelta[]` (empty array when nothing changed).
- [x] All I/O wrapped in try/catch; any failure returns `[]` — extraction must never crash the poll loop.

### 3. Wire into the host-server poll cycle  <!-- agent: general-purpose -->

- [x] **Hot file — Serena symbol ops only.** In `host-server/index.ts`, inside the existing per-agent poll iteration identified in Step 1 (the same place `getAgentContext`/`detectAgentStatus` runs), call `extractUsageDeltas(agent.name, agent.workdir, stateDir)` for each agent.
- [x] Until the accumulation sibling lands, the consumer is a stub: export the deltas via a module-level callback hook in `usage.ts` (`onUsageDeltas?: (deltas: UsageDelta[]) => void`) or simply invoke a no-op `consumeUsageDeltas(deltas)` placeholder in `usage.ts` that the accumulation task will replace. Keep the `index.ts` touch to 1–3 lines (import + call) so concurrent edits don't conflict.
- [x] Do not add routes, DB writes, or SSE events in this task.

### 4. Unit tests  <!-- agent: general-purpose -->

- [x] `host-server/usage.test.ts` (follow the existing `db.migration.test.ts` runner conventions) using fixture JSONL files written to `./tmp/`:
  - Streaming dedup: 3 entries sharing one `requestId` with output_tokens 10/50/120 → one delta with 120, not 180.
  - Incremental: second call after appending one new assistant line returns only that line's delta; unchanged file returns `[]`.
  - Sidechain and `<synthetic>` records ignored; malformed JSON lines skipped without throwing.
  - Session change (different `session_id` in a rewritten sidecar) resets the memo.
  - No sidecar / derived-only resolution → `[]`.
  - Truncation (`size < offset`) → memo reset, no negative deltas.
- [x] Point the tests at a temp `stateDir` containing a synthetic `<agent>.meta.json` sidecar referencing the fixture transcript.

### 5. Typecheck and verify  <!-- agent: general-purpose -->

- [x] `npx tsc --noEmit` in `host-server/` — zero errors.
- [x] Run the new unit tests — green.
- [DEFERRED-TO-UAT] Live smoke (if a conductor session is running): confirm via a temporary `console.log` or the callback stub that deltas appear after an agent completes a turn, then remove the temporary logging. *(2026-07-06: not run — curl/sqlite3 were approval-gated in the implementing session; covered indirectly by 7 unit tests. Verify via `sqlite3 ./data/conductor.db "SELECT * FROM agent_usage"` after an agent turn.)*
<!-- Updated: 2026-07-06 (tackle verification pass) -->
<!-- /tackle re-verified on-disk state via Serena: usage.ts (UsageDelta, extractUsageDeltas, resetUsageMemo, getUsageSessionStart), usage.test.ts (7 node:test cases), index.ts wiring (1 import + 3 minimal call sites: core poll + agent-delete + agent-rename), db.ts/monitor.sh untouched, context.ts resolveTranscriptPath exported. Minor discrepancy noted (non-blocking): ResolvedTranscript interface in context.ts is not itself exported (only the function is) — tsc already passes clean so this doesn't block completion. Runtime live-smoke deferred to UAT per policy. -->

## Acceptance Criteria

- [x] `host-server/usage.ts` exists; `extractUsageDeltas` returns per-model `UsageDelta[]` with exact token fields from `message.usage` and `costUSD` passthrough (null when absent).
- [x] Usage is only ever counted from a sidecar-pinned transcript; derived paths and non-Claude agents yield `[]` without error.
- [x] Streaming duplicates are deduplicated last-entry-wins by `requestId` (fallback `message.id`, then `uuid`); totals match `/cost`-style accounting, not naive line sums.
- [x] Each poll reads only appended bytes (offset bookkeeping verified by the incremental test); unchanged transcripts cost one `stat` call.
- [x] `host-server/index.ts` diff is a minimal symbol-level insertion (import + per-agent call); `host-server/db.ts` and `scripts/monitor.sh` are untouched.
- [x] `npx tsc --noEmit` passes; unit tests green.

## Dependencies

- **Consumed by (do not implement here):** [TASK-072](TASK-072-agent-usage-table.md) — `agent_usage` SQLite table (schema; parallel-safe with this task), and ROADMAP-010 Phase 1 item 3 — accumulation of rolling totals into that table (no task file yet). The accumulation task should declare `depends_on: [TASK-072, TASK-073]` and replace the `consumeUsageDeltas` stub.
- **Builds on (already merged):** hook sidecar (`hooks/lib/write-state.js` → `logs/state/<agent>.meta.json`) and `host-server/context.ts` transcript resolution/trust model.

## Rationale — approach change from the roadmap wording

Recorded per the roadmap audit's design latitude: the pane-tail-regex approach was replaced with transcript-JSONL parsing because (1) no token/cost text exists in the pane to match — `parsePaneTail` proves the pane surface carries only model/context-header info; (2) the transcript JSONL carries exact per-turn `usage` blocks and is the source used by ccusage/`/cost`; (3) the repo already owns the two hard parts — authoritative transcript pinning (sidecar) and safe JSONL parsing with caching (`readTranscriptInfo`). Full evidence and source register: `raw/research/agent-usage-extraction/` (index.md + sources.md).

### Roadmap

Implements ROADMAP-010 Phase 1, item formerly "Parse Claude Code usage summary from pane tail via regex on each poll cycle" — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`.

## Implementation notes (2026-07-06)

Implemented in the same session as TASK-075, so two planned intermediates were skipped in favor of the final state:

- **No `consumeUsageDeltas` stub** (Step 3's placeholder): `index.ts` wires `extractUsageDeltas` directly into `recordUsageDeltas` (TASK-075's consumer) inside `refreshAgentContextCache` — the single consumption path the stub was meant to become.
- **The session-start contract extension TASK-075 wanted landed here**: `usage.ts` tracks the first parsed assistant record's `timestamp` in the memo and exports `getUsageSessionStart(agentName)` (restart-stable because bootstrap re-parses from offset 0).
- The per-agent memo key (and the `agentName` argument) is the **tmux window name** (`agentWindowName(agent)`), matching how the hooks name the sidecar — not the bare DB `agents.name`.
- The incremental-read remainder is kept as a `Buffer` (not a string) so a read boundary can never split a multi-byte UTF-8 character; `byteOffset` advances to file size with the remainder holding unconsumed tail bytes.
- Field assumptions were validated against a real transcript (`c11b4c40…jsonl`): top-level `requestId`/`uuid`/`isSidechain`/`timestamp`/`sessionId`, `message.{id,model,usage}`, and no `costUSD` (confirming TASK-075's research).
- Tests: `host-server/usage.test.ts` — 7 node:test cases (dedup, incremental, filters/malformed, session change, no sidecar, truncation, streaming per-field delta), all green; `npx tsc --noEmit` clean.
