---
topic: Best approach for per-agent Claude Code token/cost usage extraction in tmux-conductor: pane-tail regex scraping vs transcript-JSONL parsing (ccusage-style). Evaluate what usage data Claude Code exposes in its transcript JSONL (per-message usage blocks: input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, model, costUSD), whether the pane/statusline reliably shows token counts to scrape, how ccusage computes cost (pricing lookup vs costUSD field), dedup by message id + requestId, and how this repo's per-agent sidecar (logs/state/<agent>.meta.json written by hooks, read by host-server/context.ts) pins the authoritative transcript path. Recommend which extraction approach the new task should mandate.
slug: agent-usage-extraction
researched: 2026-07-06
sources: [./sources.md]
---

# Research: Per-agent usage extraction — pane-tail regex vs transcript-JSONL parsing

> **Recommendation: transcript-JSONL parsing (ccusage-style), not pane-tail regex.** The Claude Code pane exposes no token/cost figures to scrape — the repo's own `parsePaneTail` only extracts a model name and context-size header, and the statusline data arrives via a stdin JSON payload, not printed pane text. Meanwhile every assistant turn in the transcript JSONL carries an exact `message.usage` block (input, output, cache-creation, cache-read tokens) plus `message.model`, `message.id`, and a top-level `requestId` for dedup, and the repo already has (a) a hook-written sidecar pinning each agent's authoritative main-session transcript path and (b) a working JSONL usage parser (`readTranscriptInfo`) with an mtime/size cache to extend. Extraction should be incremental (byte-offset tail-read of appended lines), dedup last-entry-wins by `requestId` (fallback `message.id`), and emit per-model token deltas; cost math belongs downstream (accumulation task) via a static pricing table, honoring `costUSD` when present.

## Research Questions

1. What usage data does the Claude Code transcript JSONL expose per message, and how trustworthy is each field?
2. Does the Claude Code TUI pane/statusline reliably show token counts that a `capture-pane` regex could scrape each poll cycle?
3. How do ccusage and its peers compute cost (pre-calculated `costUSD` vs pricing lookup) and deduplicate streaming entries?
4. How does this repo's per-agent sidecar pin the authoritative transcript path, and what existing parsing infrastructure can the new extraction reuse?
5. Which extraction approach should the new task mandate?

## Current State (Codebase)

- **Sidecar is authoritative for transcript location.** `hooks/lib/write-state.js` (lines 87–104) persists `transcript_path`, `session_id`, and `model` from every hook payload into `logs/state/<agent>.meta.json`, merging with the prior sidecar. `host-server/context.ts::resolveTranscriptPath` reads that sidecar first ("authoritative: it always names the MAIN session's transcript, never a sub-agent's") and only falls back to newest-by-mtime derivation in the workdir-keyed `~/.claude/projects/` dir — a fallback explicitly documented as untrustworthy because multiple agents can share a workdir [S1][S4].
- **JSONL usage parsing already exists.** `host-server/context.ts::readTranscriptInfo` reads the transcript, walks lines backwards for `"usage"`, parses assistant records, skips `isSidechain` and `<synthetic>` models, and sums `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` for the context meter — cached per path by `mtimeMs + size` [S2].
- **Trust model already encodes the key safety rule.** `getAgentContext` only reads token counts from a *sidecar-pinned* transcript (`memo.trusted`); derived paths are display-only, because a foreign session's transcript would report bogus numbers [S1].
- **Pane parsing yields no token data.** `parsePaneTail` extracts only a model display name and a `(200k context)` header from the pane tail; there is no token/cost figure in the pane to scrape [S3].
- **Codex agents are separate.** `context.ts` has a parallel Codex path (`readCodexInfo`, `collectCodexSessions`) — Codex session JSONLs use cumulative `token_count` events, a different format; usage extraction for Codex is a distinct follow-on.
- Roadmap siblings: ROADMAP-010 Phase 1 items 1 (`agent_usage` table) and 3 (accumulation into that table) own the schema and the rollup; this task owns extraction only.

## Key Findings

1. **Transcript JSONL is the authoritative local usage source.** Each `type: "assistant"` record carries `message.usage` with `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, plus `message.model` and `message.id`, and a top-level `requestId` [S6][S8]. This is the exact data source ccusage, ccost, claude-devtools, and Claude Code's own `/cost` consume [S5][S7].
2. **The pane cannot be scraped for usage.** The TUI prints no running token/cost total; the statusline is user-scripted, receives its token data as a stdin JSON payload (not pane text), and "temporarily hides during certain UI interactions" [S10]. A pane-tail regex would have nothing stable to match — the roadmap line's premise does not survive contact with the actual TUI.
3. **Streaming writes duplicate entries — dedup is mandatory.** Claude Code writes multiple JSONL entries per API response during streaming, sharing one `requestId` with incrementally increasing `output_tokens`; naive summation double-counts (~2x vs `/cost`). The fix used by ccusage (#835) and claude-devtools is **last-entry-wins per `requestId`**, with `message.id` as fallback key [S7]. claude-code-cost's equivalent is a `messageId + requestId` hash [S6].
4. **Cost: `costUSD` when present, else pricing lookup.** ccusage's cost modes: `display` (only pre-calculated `costUSD` from the JSONL), `calculate` (always token-price math), `auto` (costUSD when present, else calculate from LiteLLM's pricing dataset, including separate cache-creation/cache-read rates) [S5][S6]. Anthropic documents `costUSD`/`total_cost_usd` as "client-side estimates, not authoritative billing data" [S8]. Newer Claude Code versions frequently omit `costUSD`, so calculation capability is required.
5. **Known field-accuracy caveats.** `usage.input_tokens` is sometimes a streaming placeholder (0/1) and `output_tokens` can be a mid-stream snapshot; cache token fields are accurate [S9]. Last-entry-wins dedup mitigates the output snapshot issue; the numbers then match what `/cost` itself reports, which is the right consistency bar for a dashboard.
6. **Incremental reads are cheap.** JSONL is append-only per session; tracking a byte offset per transcript path and parsing only appended lines makes per-poll extraction O(new lines), the same pattern `readTranscriptInfo`'s mtime/size cache already gestures at [S2].

## Constraints

- Extraction must key off the sidecar-pinned transcript (`resolveTranscriptPath`, `source === 'sidecar'`); never trust derived newest-by-mtime paths for counting (foreign-session poisoning) [S1].
- `host-server/index.ts` and `host-server/db.ts` are hot files under concurrent edit — new logic belongs in a new module (e.g. `host-server/usage.ts`) with minimal symbol-level wiring.
- No network dependency at poll time — pricing must be a static in-repo table (LiteLLM-derived), not a live fetch.
- Scope split: this task = extraction (per poll/event deltas); sibling tasks own the `agent_usage` schema and accumulation.
- Codex/Aider agents have no Claude transcript — extraction must degrade to null, not error.

## Solution Comparison

| Criteria | A: Pane-tail regex (roadmap wording) | B: Transcript-JSONL parsing (ccusage-style) |
|----------|--------------------------------------|---------------------------------------------|
| **Approach** | Regex `capture-pane` tail for usage figures each poll | Incrementally parse the sidecar-pinned transcript JSONL for `message.usage` per assistant turn |
| **Pros** | No file I/O beyond existing capture | Exact per-turn tokens/model; cache-token breakdown; works while pane shows anything; dedup-able; same source as `/cost`/ccusage |
| **Cons** | **No token/cost text exists in the pane to match** [S3][S10]; scroll/refresh races; vendor-fragile | input_tokens placeholder caveat [S9]; needs dedup + offset bookkeeping; Claude-only (Codex separate) |
| **Complexity** | Low (but non-functional) | Medium |
| **Dependencies** | none | none (stdlib fs + static pricing table) |
| **Codebase fit** | `parsePaneTail` precedent, but that function proves the data isn't there | Direct extension of `resolveTranscriptPath` + `readTranscriptInfo` patterns [S1][S2] |
| **Maintenance** | Breaks on any TUI redesign | Stable: format consumed by a large tool ecosystem |

## Recommendation

**Mandate transcript-JSONL parsing (Option B); explicitly supersede the roadmap's pane-regex wording.**

Implementation outline:
1. New module `host-server/usage.ts` — `extractUsage(agentName, workdir, stateDir)` resolving the transcript via `resolveTranscriptPath`, counting **only** when `source === 'sidecar'`.
2. Incremental read: per-transcript memo `{ path, sessionId, byteOffset, perRequest: Map<requestId, UsageRecord> }`; on each poll, read from `byteOffset`, parse appended lines, last-entry-wins per `requestId` (fallback `message.id`); reset memo on path/session change or file truncation (offset > size).
3. Filter exactly as `readTranscriptInfo` does: `type === 'assistant'`, not `isSidechain`, model not `<synthetic>`.
4. Emit a normalized `UsageDelta` (per model: input/output/cache-creation/cache-read token deltas, optional summed `costUSD`, sessionId, ts) for the accumulation sibling to persist into `agent_usage`.
5. Cost estimation via a static pricing table module; prefer record `costUSD` when present (ccusage `auto` mode semantics).

Risks & mitigations: input_tokens placeholders → report what the transcript says (consistent with `/cost`; document the caveat); huge transcripts → offset bookkeeping bounds each poll's work; sub-agent transcripts → sidechain filter + sidecar pinning already exclude them.

Alternative if constraints change: if Claude Code ships an OTel/usage-event hook payload carrying per-turn usage, hook-driven push would beat poll-time file parsing; revisit then.

## Next Steps

- `/task-add` for ROADMAP-010 Phase 1 item 2, scoped to extraction only, with the JSONL approach mandated (this research is the rationale).
- Sibling tasks: `agent_usage` table (schema) and accumulation (rollup) — extraction task should name them as its consumers.
- Later: `/wiki-ingest raw/research/agent-usage-extraction/index.md`.
