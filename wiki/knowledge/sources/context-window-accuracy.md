---
id: context-window-accuracy
title: Ensuring the Dashboard's Context-Window Percentage Is Always Correct
updated: 2026-08-15
sources:
  - ../../raw/research/context-window-accuracy/index.md
confidence: extracted
tags: [claude-code, context-window, dashboard, host-server]
---

# Ensuring the Dashboard's Context-Window Percentage Is Always Correct

The dashboard's agent badge showed "Sonnet 5 100% 333k/200k" — a false overflow. **Claude Sonnet 5 has a 1,000,000-token context window on the API, Claude.ai paid plans, and Claude Code, with no smaller variant and no `[1m]` opt-in required**; 200k is stale data left over from earlier Sonnet generations. The 333k numerator was a correct reading of current context occupancy; only the 200k denominator was wrong.

**Root cause** is `uses::[[Host Server]]`'s `modelContextLimit()` (`host-server/context.ts:346-351`), which special-cases only `"opus"` → 1M by lowercased family-substring match and asserts in a comment that Sonnet/Haiku/Fable all fit in 200k — true for Sonnet 4.5, false for Sonnet 4.6 and Sonnet 5. This is compounded by three independent hardcoded `200000` fallbacks across `conductor.conf`, `host-server/config.ts`, and `frontend/src/components/AgentList.tsx`, and by a `Math.min(100, ...)` clamp (`context.ts:495-498`) that silently absorbs any over-limit reading into a maxed red bar instead of surfacing that the assumed limit is wrong.

**There is no live API to query for this.** `GET /v1/models` returns only `id`, `display_name`, `type`, `created_at` — no `context_window` field — so a runtime lookup against Anthropic isn't possible. Anthropic's own tooling has independently shipped this exact class of bug (Claude Code v2.1.222 briefly capped Sonnet 5 at 200k via a stale "legacy Sonnet extended-context entitlement path," per `anthropics/claude-code#84310`), confirming it's a real, recurring trap tied to how fast the model lineup changes, not something specific to this codebase.

**The durable fix has two parts**, since a hand-maintained table alone will go stale again on the next model release: (1) replace the family-substring hack with an exact-model-ID table sourced from Anthropic's context-window-sizes-by-model doc, and (2) make the failure mode self-flagging — when measured tokens exceed the assumed limit for an unrecognized model ID, surface an explicit "limit unconfirmed" UI state instead of clamping to a falsely-precise 100%. Part 2 is what actually makes future staleness *visible* rather than a repeat of this exact silent-wrong-badge bug.

A related but distinct dead end: Anthropic's context-aware models do receive their real token budget via an API-injected `<budget:token_budget>` tag, but this is injected into the outgoing request, not persisted into Claude Code's transcript JSONL — tested directly against a live transcript with no genuine hit, only a false positive from a quoted documentation example. So the transcript is not a viable source for the real injected value either.

relates_to::[[Claude Code CLI]]
relates_to::[[Host Server]]
relates_to::[[claude-subscription-usage-signal-gap]]
relates_to::[[claude-model-context-window-sizing]]
