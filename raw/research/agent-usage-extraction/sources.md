---
topic: Best approach for per-agent Claude Code token/cost usage extraction in tmux-conductor: pane-tail regex scraping vs transcript-JSONL parsing (ccusage-style). Evaluate what usage data Claude Code exposes in its transcript JSONL (per-message usage blocks: input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, model, costUSD), whether the pane/statusline reliably shows token counts to scrape, how ccusage computes cost (pricing lookup vs costUSD field), dedup by message id + requestId, and how this repo's per-agent sidecar (logs/state/<agent>.meta.json written by hooks, read by host-server/context.ts) pins the authoritative transcript path. Recommend which extraction approach the new task should mandate.
slug: agent-usage-extraction
researched: 2026-07-06
---

# Primary Sources — Per-agent usage extraction

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/context.ts::resolveTranscriptPath` / `::getAgentContext` | 2026-07-06 | Sidecar (`<agent>.meta.json`) is the authoritative transcript pointer; derived newest-by-mtime paths are untrusted for token counts (foreign-session poisoning) |
| S2 | codebase | `host-server/context.ts::readTranscriptInfo` | 2026-07-06 | Existing JSONL usage parser: assistant records, `isSidechain`/`<synthetic>` filters, mtime+size cache — the pattern to extend |
| S3 | codebase | `host-server/context.ts::parsePaneTail` | 2026-07-06 | Pane tail yields only model name + `(NNNk context)` header; no token or cost figures exist in the pane |
| S4 | codebase | `hooks/lib/write-state.js` (lines 87–104) | 2026-07-06 | Hooks persist `transcript_path`, `session_id`, `model` into `STATE_DIR/<agent>.meta.json`, merged with prior sidecar |
| S5 | web | https://ccusage.com/guide/cost-modes | 2026-07-06 | ccusage cost modes: display (costUSD only), calculate (token pricing), auto (costUSD when present, else pricing); cache-creation fallback rate |
| S6 | web | https://npmx.dev/package/claude-code-cost | 2026-07-06 | Dedup by `messageId + requestId` hash; auto mode uses pre-calculated costUSD else computes; live LiteLLM pricing dataset; tiered 200K pricing |
| S7 | web | https://github.com/matt1398/claude-devtools/issues/74 | 2026-07-06 | Streaming writes multiple JSONL entries sharing one `requestId` with incrementally increasing `output_tokens`; naive sums ~2x `/cost`; fix = last-entry-wins per requestId (same as ccusage#835) |
| S8 | web | https://code.claude.com/docs/en/agent-sdk/cost-tracking | 2026-07-06 | Official: usage fields per assistant message; parallel tool calls share message id — dedup by ID; `costUSD`/`total_cost_usd` are client-side estimates, not billing data |
| S9 | web | https://github.com/anthropics/claude-code/issues/28197 | 2026-07-06 | `usage.input_tokens` often a streaming placeholder (0/1); output may exclude thinking tokens; cache token fields accurate |
| S10 | web | https://code.claude.com/docs/en/statusline | 2026-07-06 | Statusline gets token data via stdin JSON (not pane text) and "temporarily hides during certain UI interactions" — not a scrapeable pane surface |

## Excerpts

### S5 — ccusage cost modes
https://ccusage.com/guide/cost-modes
> Claude Code stores usage data in JSONL files with both token counts and pre-calculated cost information. ccusage can handle this data in different ways depending on your needs … When Claude Code records do not include the cache_creation duration breakdown, ccusage falls back to pricing cache_creation_input_tokens at the standard cache creation rate. … The display mode only shows pre-calculated costs from Claude Code

### S6 — claude-code-cost (npmx)
https://npmx.dev/package/claude-code-cost
> Auto mode — Uses pre-calculated costUSD from JSONL when available, otherwise calculates from tokens · Tiered pricing — Tokens above 200K threshold charged at higher rate … Deduplication — Skips duplicate messages by messageId + requestId hash … Dynamic pricing — Fetches live model prices from LiteLLM

### S7 — claude-devtools issue #74
https://github.com/matt1398/claude-devtools/issues/74
> Claude Code streams API responses and writes intermediate JSONL entries that share the same requestId but have incrementally increasing output_tokens. … Fix: Keep only the last entry per requestId (the final, complete usage). … This is the same approach as ryoppippi/ccusage#835, which fixed the same class of bug in ccusage.

### S8 — Claude Code docs: Track cost and usage
https://code.claude.com/docs/en/agent-sdk/cost-tracking
> The total_cost_usd and costUSD fields are client-side estimates, not authoritative billing data. … When Claude uses multiple tools in one turn, all messages in that turn share the same ID, so deduplicate by ID to avoid double-counting.

### S9 — anthropics/claude-code issue #28197
https://github.com/anthropics/claude-code/issues/28197
> Claude Code's JSONL conversation logs record usage.input_tokens as a streaming placeholder (typically 1) rather than the final value. … Cache metrics matching at ~1x across both data sources confirms they're tracking the same API calls

### S10 — Claude Code docs: Customize your status line
https://code.claude.com/docs/en/statusline
> The status line runs locally and does not consume API tokens. It temporarily hides during certain UI interactions, including autocomplete suggestions, the help menu, and permission prompts. Claude Code sends the following JSON fields to your script via stdin: … "transcript_path": "/path/to/transcript.jsonl"
