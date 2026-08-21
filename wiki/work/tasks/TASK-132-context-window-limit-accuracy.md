---
id: TASK-132
aliases: [TASK-132]
title: "Fix context-window limit lookup in host-server/context.ts"
status: todo
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: []
parallel_safe_with: []
uat: ""
tags: [host-server, context-window, dashboard]
---

# TASK-132 — Fix context-window limit lookup in host-server/context.ts

## Objective

The dashboard's context-% badge showed "Sonnet 5 100% 333k/200k" — a false overflow. Claude Sonnet 5 has a 1,000,000-token context window unconditionally (no smaller variant), not 200k; the 333k usage reading was already correct. Root cause is `host-server/context.ts`'s `modelContextLimit()` (lines 345-350), which only special-cases `"opus"` → 1M by lowercased family-substring match and lets everything else — including Sonnet 5 — fall through to `conductor.conf`'s generic `CONTEXT_WINDOW=200000` default. The resulting over-limit reading is then silently clamped to a maxed-out 100% by `Math.min(100, ...)` in `getAgentContext()` instead of being surfaced as a wrong assumption.

Fix the immediate bug (expand the table to cover the current model lineup) and make the failure mode self-flagging so the *next* new model degrades visibly instead of silently: thread a `contextLimitConfident` boolean through the API payload so the frontend can render "limit unconfirmed" instead of a possibly-wrong colored percentage when the model isn't in the table and no pane-header annotation is present.

Full research, root cause, and source citations: `raw/research/context-window-accuracy/index.md` and `wiki/knowledge/concepts/claude-model-context-window-sizing.md`.

## Approach

1. **Exact/prefix model-ID table, not family-substring matching.** Replace `modelContextLimit()`'s two-branch hack with a small ordered table matching real model IDs (`claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-haiku-4-5`, `claude-fable-5`, `claude-mythos-5`) to their real context-window sizes per [Anthropic's context-window-sizes-by-model doc](https://platform.claude.com/docs/en/build-with-claude/context-windows#context-window-sizes-by-model). Match by prefix (not exact equality) because dated IDs exist (e.g. `claude-sonnet-4-5-20250929`). Return `null` for anything not matched — never assume 200k as a "safe" guess.
2. **Confidence flag, not just a bigger table.** A hand-maintained table will go stale again on the next model release — that's unavoidable given there's no live API for this (`GET /v1/models` has no `context_window` field). What's avoidable is silence: add `contextLimitConfident: boolean` to `AgentContext`, `true` only when the limit came from a real source (an explicit `(N context)` pane-header annotation, or a table hit), `false` when it fell back to the generic `conductor.conf`/`config.ts` default. This makes an unrecognized-model fallback a distinguishable UI state instead of a falsely-precise percentage.
3. **Frontend renders the low-confidence state distinctly.** `ContextMeter` (`AgentList.tsx`) shows a neutral/grey bar with a tooltip like "~Nk tokens used, context window size unconfirmed" instead of the normal green/amber/red `contextColor()` bar, when `contextLimitConfident === false`.
4. **New test file.** No `host-server/context.test.ts` exists today — add one covering the table and the confidence branching, since this exact class of bug (silently wrong assumption about a model's context window) has now shipped twice in this codebase's history and twice independently in Anthropic's own Claude Code (`anthropics/claude-code#84310`, `#76155`).

Note: TASK-122 (dashboard dark mode, `todo`) will later replace `AgentList.tsx`'s hardcoded hex colors — including `contextColor()`'s literals — with CSS-variable tokens. This task's frontend edit (step 3, section 3 below) touches the same function. Not a hard dependency, but whichever of TASK-122/TASK-132 lands second should re-check its diff against the other's changes to `ContextMeter`/`contextColor`.

## Steps

### 1. Backend — exact-model-ID context-window table + confidence signal <!-- agent: general-purpose -->

- [ ] In `host-server/context.ts`, replace `modelContextLimit()` (lines 345-350) with a `CLAUDE_MODEL_CONTEXT_WINDOWS` table (ordered array of `[idPrefix, tokens]` pairs, matched via `id.startsWith(prefix)` after lowercasing) covering: `claude-sonnet-5` → 1_000_000, `claude-sonnet-4-6` → 1_000_000, `claude-sonnet-4-5` → 200_000, `claude-opus-5` → 1_000_000, `claude-opus-4-8` → 1_000_000, `claude-opus-4-7` → 1_000_000, `claude-opus-4-6` → 1_000_000, `claude-haiku-4-5` → 200_000, `claude-fable-5` → 1_000_000, `claude-mythos-5` → 1_000_000. Keep the function signature `(modelIdOrDisplay: string | null): number | null`, returning `null` when no prefix matches. Add a comment citing the Anthropic docs URL above as the source to re-check on future model releases.
  - Note: `modelContextLimit()` is called with two different kinds of string today — a raw model ID (`info.modelId`, e.g. `claude-sonnet-5`) in `getAgentContext()`'s final resolution, and a display name (`pane.model`, e.g. `"Sonnet 5"`) earlier in the same function. Keep both call sites working: either normalize display names to a matchable form (strip spaces/dots, lowercase, e.g. `"Sonnet 5"` → `sonnet5`) or add display-name variants to the table. Verify against both existing call sites (search `modelContextLimit(` in `context.ts`) before finalizing the matching strategy.
- [ ] Add `contextLimitConfident: boolean` to the `AgentContext` interface (`context.ts` lines 22-28), placed after `contextLimit`.
- [ ] In `getAgentContext()` (lines 387-512), compute confidence wherever `resolvedLimit`/`effectiveLimit` is computed: `true` when `pane.contextLimit != null` (explicit pane-header annotation) or `modelContextLimit(...)` resolved non-null; `false` when the value came from the generic `contextLimit` parameter (the conductor.conf/config default) with no model-specific signal. Set `contextLimitConfident: false` in `emptyWithLimit` and every early-return branch that doesn't yet have a model-specific limit; set it correctly on the final `ctx` object built from `resolvedLimit`.
- [ ] In `conductor.conf`, update the `# --- Context window ---` comment block (lines 134-139) to note that `CONTEXT_WINDOW` is now a last-resort fallback only — per-model limits are looked up automatically via `modelContextLimit()`'s table first, and the dashboard flags the fallback case as "unconfirmed" rather than trusting this value silently. Remove the now-inaccurate instruction to manually bump this to `1000000` for 1M-context models.

### 2. Backend — propagate the confidence flag through API serialization <!-- agent: general-purpose -->

- [ ] In `host-server/index.ts`, update `emptyAgentContext()` (~lines 195-203) to include `contextLimitConfident: false` in its returned object, matching the updated `AgentContext` shape.
- [ ] The three `...ctx` spread sites (around lines 975, 1040, 2006) pick up the new field automatically — verify this by reading each call site, no edit needed there.
- [ ] The two sites that re-list `AgentContext` fields explicitly instead of spreading — around lines 2128-2133 and 2323-2329 (`contextTokens: agent.contextPct: agent.contextLimit: agent.usage: agent...` field lists) — add `contextLimitConfident: agent.contextLimitConfident` to both, or the field will be silently dropped from those two API payloads even though the rest of the codebase has it.

### 3. Frontend — Agent type + ContextMeter unconfident-state rendering <!-- agent: general-purpose -->

- [ ] In `frontend/src/components/AgentList.tsx`, add `contextLimitConfident?: boolean | null` to the `Agent` interface (after `contextLimit?: number | null` at line 44).
- [ ] In `ContextMeter()` (lines 298-342), when `agent.contextLimitConfident === false` (and `pct` is non-null), render a visually distinct low-confidence state: replace the `contextColor(pct)`-driven bar color with a neutral grey (e.g. `#9a9da5`, matching the existing muted-text color already used elsewhere in this component), and change the `title`/`aria-label` tooltip text to make the uncertainty explicit, e.g. `` `~${formatTokens(agent.contextTokens)} tokens used, context window size unconfirmed for this model` `` instead of the normal `"${pct}% of context window used"` phrasing. Keep the bar's fill width proportional to `pct` as today (still directionally useful) — only the color and copy change.
- [ ] Update the JSDoc comment above `ContextMeter` (line 297) to mention the new low-confidence rendering path.

### 4. Tests — new host-server/context.test.ts <!-- agent: general-purpose -->

- [ ] Create `host-server/context.test.ts` (no test file exists for `context.ts` today — check for an existing test-runner convention/config by reading a sibling test file such as `host-server/config.test.ts` or `host-server/db.migration.test.ts` before writing, to match the project's existing test style/imports).
- [ ] Cover `modelContextLimit()`: exercises at least `claude-sonnet-5` → `1_000_000`, `claude-sonnet-4-5` → `200_000`, `claude-opus-5` → `1_000_000`, a dated-suffix ID (e.g. `claude-sonnet-4-5-20250929`) → `200_000`, and an unrecognized ID → `null`.
- [ ] Cover `getAgentContext()`'s confidence branching: a fixture transcript/pane state where the model resolves via the table (`contextLimitConfident: true`) vs. one where the model is unrecognized and falls back to the generic `contextLimit` parameter (`contextLimitConfident: false`). Reuse whatever transcript-fixture/mocking pattern nearby tests already use for `readTranscriptInfo`/`resolveTranscriptPath` (search the codebase for existing context.ts-adjacent test fixtures if any exist under `host-server/`; if none, construct a minimal fixture transcript file in a temp dir per the pattern used in `db.migration.test.ts`).
- [ ] Run the full test suite and `tsc --noEmit` for both `host-server/` and `frontend/` to confirm nothing regressed.
