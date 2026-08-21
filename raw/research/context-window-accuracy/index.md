---
topic: a way to ensure context window is always correct. Sonnet 5 context window is inaccurate
slug: context-window-accuracy
researched: 2026-08-15
sources: [./sources.md]
---

# Research: Ensuring the dashboard's context-window percentage is always correct

> The dashboard badge showed "Sonnet 5 100% 333k/200k" because Claude Sonnet 5 actually has a **1,000,000-token** context window, not 200k — the 200k figure is a stale hardcoded assumption in `host-server/context.ts`, not a token-counting bug. The 333k numerator is a legitimate, correctly-computed reading of current context occupancy. There is no live API that reports a model's context-window size, so "always correct" isn't achievable by querying an endpoint; it requires (1) fixing the current per-model table with an exact-ID lookup instead of family-substring guessing, and (2) making the failure mode self-flagging (detect and surface overflow/unknown-limit) instead of silently clamping to a wrong 100%, so the next model release degrades visibly instead of silently.

## Research Questions
- What is Claude Sonnet 5's actual context window size, and does it differ between the API, Claude.ai, and Claude Code?
- Where in tmux-conductor is the 200k figure and the "333k used" figure computed, and which one is wrong?
- Is there an authoritative, queryable source (an API) tmux-conductor could call at runtime to always get the right number, instead of hardcoding it?
- Why did this go stale now, and what structural fix prevents it from silently going stale again on the next model release?

## Current State (Codebase)

Confirmed via a Serena-based codebase scan (`host-server/context.ts`, `host-server/config.ts`, `frontend/src/components/AgentList.tsx`, `conductor.conf`):

- **The denominator is wrong, not the numerator.** `readTranscriptInfo()` (`host-server/context.ts:136-172`) reads the *most recent assistant turn's* `usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens` from the Claude Code transcript — this is the same "last request's total input" methodology Claude Code's own `/context` meter uses, and it is not a session-cumulative sum. A reading of 333k is a plausible, correct measurement of current context occupancy for a long session on a 1M-token model.
- **Three independent hardcoded `200000` fallbacks exist**, none model-aware:
  - `conductor.conf:139` — `CONTEXT_WINDOW=200000`, with a comment telling the user to bump it to `1000000` manually if "your agents run with 1M context" (`conductor.conf:135-138`).
  - `host-server/config.ts:173` — `parseInt(...) || 200000` re-derives the same fallback.
  - `frontend/src/components/AgentList.tsx:317` — `agent.contextLimit ?? 200000`, a third independent fallback in the UI layer (dead code path today since the server always resolves a limit, but a landmine if that ever changes).
- **The one model-aware branch is the actual bug.** `modelContextLimit()` (`host-server/context.ts:346-351`):
  ```ts
  function modelContextLimit(modelIdOrDisplay: string | null): number | null {
    if (!modelIdOrDisplay) return null;
    const id = modelIdOrDisplay.toLowerCase();
    if (id.includes('opus')) return 1_000_000;
    return null; // sonnet/haiku/fable all fit within the conf default (200k)
  }
  ```
  This special-cased only "opus" as 1M and asserted, in a comment, that Sonnet fits in 200k — true for Sonnet 4.5, false for Sonnet 4.6 and Sonnet 5. It matches by family substring, never by a specific model ID, so it can't distinguish Sonnet 4.5 (200k) from Sonnet 5 (1M, always).
- **A more-accurate signal already exists but doesn't fire for Sonnet 5.** `parsePaneTail()` (`host-server/context.ts:353-378`) scrapes an explicit `"Opus 4.8 (1M context)"` / `"Sonnet 4.6 (200k context)"` annotation straight out of the terminal pane header when Claude Code prints one — this is ground truth when present. But per Anthropic's own docs (see Key Findings), Sonnet 5 has no smaller variant and no `[1m]` selector, so Claude Code has no reason to print a distinguishing `(1M context)` annotation on its banner; the banner instead matches the plain `"Sonnet 5 with high effort"` pattern (`context.ts:374`), which sets `contextLimit` to `null` and falls through to the broken `modelContextLimit()` → `conductor.conf` chain.
- **Percentage is clamped, not surfaced as an error.** `host-server/context.ts:495-498` computes `Math.min(100, Math.round(contextTokens/resolvedLimit*100))` — when the assumed limit is too small, the overflow is silently absorbed into a maxed-out red bar rather than exposed as "the limit assumption is wrong."
- **Scope note:** the sibling project `tmux-agent-status` (a separate tmux status-line plugin, checked via plain grep since it's outside Serena's project root) has no context-window tracking at all — this bug is confined to tmux-conductor's dashboard.

## Key Findings

- **Claude Sonnet 5 has a 1,000,000-token context window on the Anthropic API, and it is the *only* option — there is no 200k variant and no `[1m]` beta flag to opt into.** [S1] "Claude Sonnet 5 supports the 1M token context window by default (1M tokens is both the default and the maximum; there is no smaller context variant)."
- **This also holds on Claude.ai paid plans and in Claude Code**, not just the raw API. [S2] "On the Anthropic API, Sonnet 5 always runs with the 1M context window. There is no 200K variant, no `[1m]` suffix to select, and no usage credits required on any plan." Two configurations still cap it at 200k regardless: an LLM gateway that can't verify 1M support (unless you explicitly pick `sonnet[1m]` in `/model`), and the `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` env var. [S2]
- **Anthropic's own tooling has shipped this exact bug independently**, twice, confirming it's a real trap and not specific to this codebase: Claude Code v2.1.222 briefly evaluated Sonnet 5 on "the legacy Sonnet extended-context entitlement path" and enforced a 200k cap with hard failures, not just a wrong display [S3]; and the Desktop app and CLI have been observed to disagree on the same account/model (200k vs 1M) [S4, discovered but not deep-read — title alone is corroborating].
- **There is no live API endpoint that reports a model's context-window size.** `GET /v1/models` returns only `id`, `display_name`, `type`, `created_at` — no `context_window` field. [S5] So "always correct" cannot be achieved by querying Anthropic at runtime; the size has to come from a maintained table, a doc citation, or something Claude Code itself prints/emits.
- **Context-aware models do receive their token budget as a matter of protocol, but it is injected into the outgoing API request, not into what Claude Code persists to the transcript JSONL.** Anthropic's docs describe `<budget:token_budget>N</budget:token_budget>` in the system prompt and `<system_warning>Token usage: X/Y remaining</system_warning>` after tool calls as *API-injected*, request-time content [S6]. This was tested directly against this session's own transcript (`grep -o "token_budget>[0-9]*" ~/.claude/projects/.../*.jsonl`): the only hits were verbatim quotes of the documentation's example value (`200000`) pulled in by an earlier WebFetch tool result, not a genuine injected tag from a real API request. *(inference — no primary source confirms whether Claude Code ever persists the real injected tag anywhere accessible; this negative test is the only evidence, and it argues the transcript is not a reliable source for this value.)*
- **The context window is priced flat** — no premium for tokens past 200k on 1M-window models [S2] — so there's no cost-based signal to cross-check against either.
- **Auto-compaction thresholds are a related but separate number.** Sonnet 5 auto-compacts around 967k tokens by default and that threshold is independently configurable via `CLAUDE_CODE_AUTO_COMPACT_WINDOW` [S1, S2] — useful context if tmux-conductor ever wants a "will compact soon" warning distinct from "% of window used."

## Constraints

- Any fix must key off something already available to `host-server/context.ts` today: the transcript JSONL (model ID, usage numbers) and the pane tail capture (banner text). No new Anthropic API call is available to resolve this at runtime.
- The model landscape changes faster than this file does — in the course of this research alone, the current docs reference Sonnet 4.5, Sonnet 4.6, Sonnet 5, Opus 4.6 through 4.8, Opus 5, Fable 5, and Mythos 5/Preview, each with different context-window defaults and some with plan-gated exceptions. A model-family substring match (`includes('opus')`) cannot express this; only an exact/prefix model-ID table can.
- `conductor.conf`'s single global `CONTEXT_WINDOW` value cannot be correct for a session running mixed models (e.g., one Opus agent and one Sonnet agent side by side) — it's a single number for the whole conductor, not per-agent.

## Recommendation

**Two-part fix, not either/or:**

1. **Replace `modelContextLimit()`'s family-substring hack with an exact-model-ID table**, sourced from and citing Anthropic's [context-window-sizes-by-model](https://platform.claude.com/docs/en/build-with-claude/context-windows#context-window-sizes-by-model) table, matching on the model ID already present in the transcript (`info.modelId`, e.g. `claude-sonnet-5`) rather than a lowercased display-name substring. This immediately fixes Sonnet 5 (and Sonnet 4.6, which has the same 1M default) and is a small, contained change to one function in `host-server/context.ts`.
2. **Make the failure mode self-flagging instead of silent**, so the *next* new model doesn't reproduce this exact bug invisibly for months:
   - When `contextTokens` measured from the transcript exceeds the `resolvedLimit` the table assumed, that overflow is itself proof the assumed limit is wrong for an unrecognized or misclassified model — don't just `Math.min(100, ...)` and paint a red 100% bar as if the assumption were correct. Either widen to the next known tier and recompute, or surface a distinct UI state (e.g. "≥200k, limit unconfirmed") instead of a falsely-precise percentage.
   - Treat an unrecognized model ID (not present in the table) as this same "unknown limit" state rather than silently defaulting to 200k.

This is the most durable answer available: since there's no live API to query (Key Findings, S5), "always correct" is not achievable as a fire-and-forget fact — it's achievable as *fails visibly instead of silently* plus a table that's cheap to update because the wrong-guess case now surfaces itself in the UI rather than requiring someone to notice a red overflowing bar and go spelunking.

**Implementation outline:**
- In `host-server/context.ts`, replace the two-line `modelContextLimit()` with a small `Record<string, number>` (or ordered prefix-match list, since dated model IDs like `claude-sonnet-4-5-20250929` exist) covering current models, plus a code comment linking to Anthropic's context-windows doc as the source of truth to re-check on future model bumps.
- Change the `resolvedLimit`/`contextPct` computation (`context.ts:495-498`) so that `contextTokens > resolvedLimit` from an *unrecognized* model ID produces a distinguishable value (e.g. `contextPct: null` with a `limitUncertain: true` flag) rather than a clamped 100, and have `AgentList.tsx`'s `ContextMeter` render that state distinctly (e.g. grey/outlined bar with "≥Nk, limit unconfirmed" instead of a solid red 100%).
- Leave the existing pane-header-scrape path (`parsePaneTail`) as the highest-priority source when Claude Code does print an explicit `(N context)` annotation — it's ground truth when present and needs no changes.

**Risks and mitigations:**
- *Risk:* the new table still goes stale on the model after next. *Mitigation:* that's what part 2 (self-flagging overflow) is for — staleness becomes a visible dashboard state instead of a silently wrong percentage.
- *Risk:* widening the limit automatically on overflow could mask a genuinely misbehaving agent that's actually near a real 200k limit. *Mitigation:* only auto-widen when the model ID is unrecognized; for a recognized model ID that's genuinely overflowing its true window, that's a real compaction-imminent signal worth keeping visible, not hiding.

**Alternative if constraints change:** if Anthropic ever adds a `context_window` field to `GET /v1/models` (not present today, S5) or Claude Code starts reliably persisting the injected `<budget:token_budget>` tag into transcript JSONL, either becomes strictly better than a hand-maintained table and should replace it — but neither exists today.

## Next Steps
- `/task-add` a fix along the lines of the implementation outline above (exact-model-ID table + self-flagging overflow state) targeting `host-server/context.ts:346-351` and `context.ts:495-498`, with a paired UI change in `frontend/src/components/AgentList.tsx`'s `ContextMeter`.
- No further research needed — the numbers, root cause, and file/line locations are all confirmed above.
