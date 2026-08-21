---
id: claude-model-context-window-sizing
title: Claude Model Context-Window Sizing Is Unqueryable and Drifts Fast
updated: 2026-08-15
sources:
  - ../../raw/research/context-window-accuracy/index.md
confidence: extracted
tags: [claude-code, context-window, api]
---

# Claude Model Context-Window Sizing Is Unqueryable and Drifts Fast

A model's context-window size (200k vs 1M tokens, etc.) is **not exposed by any live Anthropic API**. `GET /v1/models` returns only `id`, `display_name`, `type`, `created_at` — no `context_window` field — so any tool that needs this number (a dashboard percentage, a compaction heuristic, a budget check) must either hardcode a table or scrape it from product surfaces that print it (a Claude Code pane banner's `"(N context)"` annotation, when present).

This is a genuinely moving target, not a one-time constant to memorize: within the current model lineup, Sonnet 4.5 is 200k, Sonnet 4.6 is 1M but plan-gated outside the raw API, and Sonnet 5 is 1M **unconditionally** with no smaller variant — three different rules across three consecutive point releases of the same model family. Opus and Fable/Mythos models have their own, different plan-gating history. **Anthropic's own Claude Code has independently shipped the "assumed a newer Sonnet was still 200k" bug at least twice** (`anthropics/claude-code#84310`, `#76155`), confirming this drifts fast enough to catch even the team that owns the models.

**A hand-maintained table (keyed by exact model ID, not family-substring) is the only viable data source today**, and it will go stale again on the next model release — that is not avoidable with what's currently exposed. What *is* avoidable is the failure mode: a stale table should be visibly wrong (an "unrecognized model, limit unconfirmed" UI state, or auto-widening on detected overflow) rather than silently wrong (clamping an over-limit reading to a maxed percentage, as `uses::[[Host Server]]`'s `context.ts` did for Sonnet 5 — see `derived_from::[[context-window-accuracy]]`).

A related dead end worth recording: Anthropic's context-aware models do receive their real token budget via an API-injected `<budget:token_budget>N</budget:token_budget>` system-prompt tag and `<system_warning>Token usage: X/Y remaining</system_warning>` messages, per Anthropic's docs — but this is injected into the *outgoing* request at request time, not persisted into what Claude Code writes to its transcript JSONL. A direct grep against a live session transcript for this tag found no genuine hit, only a false positive from an earlier tool result that had quoted the documentation's own literal example value. So the transcript is not a source for this either, despite the tag technically existing somewhere in the request lifecycle.

**Practical rule for any tool in this repo that needs a model's context window**: prefer a scraped, explicit annotation from the product itself when one is visible (ground truth, but not always printed); otherwise use an exact-model-ID table cited to Anthropic's [context-window-sizes-by-model doc](https://platform.claude.com/docs/en/build-with-claude/context-windows#context-window-sizes-by-model); and always treat "measured usage exceeds the assumed limit" as a signal that the table entry is wrong, not as a state to silently clamp away.
