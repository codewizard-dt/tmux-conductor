---
id: TASK-074
aliases: [TASK-074]
title: "Token/cost badge — compact usage badge on agent card header in dashboard"
status: pending-uat
created: 2026-07-06
updated: 2026-08-21
depends_on: [TASK-072, TASK-073, TASK-075]
blocks: []
parallel_safe_with: [TASK-001, TASK-011, TASK-012, TASK-050, TASK-061, TASK-062, TASK-063, TASK-065, TASK-066, TASK-067, TASK-068, TASK-069, TASK-070, TASK-071]
uat: "[[UAT-074]]"
tags: [frontend, ui, tokens, cost, observability, roadmap-010]
---

# TASK-074 — Token/cost badge — compact usage badge on agent card header in dashboard

## Objective

Render a compact token/cost badge in the header row of each agent card in the Vite React dashboard, showing cumulative session cost and total tokens (e.g. `$0.42 · 128k`) read from the per-agent usage totals on the agents API payload. Agents with no usage data (Codex/Aider, fresh sessions, pre-migration DBs) show no badge. **Scope: frontend-only** — no host-server, DB, or hook changes; the data is produced by TASK-072 (schema), TASK-073 (extraction), and the accumulation sibling (payload exposure).

## Approach

Research: `raw/research/token-cost-badge/index.md`.

- **Where:** the agent card is the `AgentItem` function component in `frontend/src/components/AgentList.tsx` (body ~lines 651–711, 0-based). Its header is "Row 1 — project + name (left) / type + status (right)": `ProjectBadge` → name span → `AgentTypeBadge` → `StatusBadge`. The badge renders in Row 1, immediately before `<AgentTypeBadge agent={agent} />`.
- **Data source:** `AgentList` seeds from `GET /status` and stays live via `useSSEEvent('agent-update')`; both payloads are built at two serialization sites in `host-server/index.ts` (~lines 1952 and 2133) that already spread `contextTokens/contextPct/contextLimit`. The accumulation task attaches usage totals there — **this task does not touch those sites**; it only reads whatever field the accumulation task exposes.
- **Contract-first:** the accumulation task (ROADMAP-010 Phase 1 item 3 — "Accumulate rolling token totals per agent in the `agent_usage` table"; no task file existed when this task was written) owns the payload field names. Step 1 verifies the actual shape before typing anything. Fallback expectation from TASK-072's `AgentUsageTotals`: `{ inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, costUsd, sessions }`, likely nested as `agent.usage`.
- **Format:** cost-first compact chip, ccusage-statusline precedent (`💰 $0.23 session … 🧠 25,000`): `$X.XX · NNk` (or `N.NM` above a million — cumulative cache-read totals routinely exceed 1M). Total tokens = sum of all four token columns; the `title` tooltip itemizes input / output / cache-write / cache-read / sessions. `costUsd` of 0 with nonzero tokens (TASK-073 may pass `costUSD: null` through) renders tokens only.
- **Styling:** reuse the house pill-chip classes from `ContextMeter`'s model chip (`rounded-pill bg-[#f1f2f4] px-1.5 py-0.5 text-[10px] font-semibold text-[#4f5a78]`); muted so it never competes with `StatusBadge`. Null/absent usage → component returns `null`, mirroring `ContextMeter`'s `pct == null` early-return and TASK-062's branch-badge convention.
- **Hot-file discipline (CRITICAL):** `frontend/src/components/AgentList.tsx` and `frontend/src/lib/api.ts` are concurrently edited by other orchestrators (TASK-062 branch badge touches the same `AgentItem` rows; TASK-001/066/071 touch `AgentDetailModal` in the same file). **Re-read the target symbol immediately before every edit**; use Serena symbol-level operations (`find_symbol`, `insert_after_symbol`, `replace_symbol_body`, `replace_content`) — never whole-file rewrites; if an edit fails because content changed, re-read and retry. `api.ts` should normally be untouched (the runtime `Agent` interface lives in `AgentList.tsx`, not `api.ts` — `ApiAgent` there is the persistence row only); only touch it if the accumulation task typed the payload there.
- **Out of scope:** the per-session usage breakdown inside `AgentDetailModal` is the next roadmap item — do not implement it here. Do not add pricing math; render `costUsd` as delivered.

## Steps

### 1. Confirm the usage payload contract  <!-- agent: Explore -->

- [x] Re-read `wiki/work/tasks/index.md` and locate the accumulation task ("Accumulate rolling token totals per agent") if it now exists; read its task file for the exact agents-payload field names. If it declares a field name (e.g. `usage`, `usageTotals`, or flat `usageTokens`/`usageCostUsd`), adopt it verbatim.
- [x] Cross-check the implementation if landed: `mcp__serena__search_for_pattern` for `usage` in `host-server/index.ts` around the two agent serialization sites (~lines 1952 and 2133) and for `getAllAgentUsageTotals` imports from `host-server/db.ts`.
- [x] If neither exists yet, code against the fallback shape `usage?: { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number; costUsd: number; sessions: number } | null` and record the assumption in the PR/commit message so the accumulation task aligns.

### 2. Extend the frontend `Agent` interface  <!-- agent: general-purpose -->

- [x] **Hot file — re-read before editing.** `mcp__serena__find_symbol` on `Agent` in `frontend/src/components/AgentList.tsx` (`include_body=true`) to get its current body.
- [x] Add the optional usage field from Step 1 (fallback: `usage?: { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number; costUsd: number; sessions: number } | null`). Optional so payloads from an older host-server never break rendering.
- [x] Do not modify `frontend/src/lib/api.ts` unless Step 1 showed the accumulation task typed the payload there.

### 3. Add formatting helpers  <!-- agent: general-purpose -->

- [x] `mcp__serena__find_symbol` on `formatTokens` in `frontend/src/components/AgentList.tsx`; extend it with an `M` tier (`n >= 1_000_000` → `` `${(n / 1_000_000).toFixed(1)}M` `` with trailing-`.0` stripped) while keeping the existing `k` behaviour intact — `ContextMeter` also calls it, and context tokens stay in the k range, so the change is backward-compatible.
- [x] Add `formatCost(usd: number): string` next to `formatTokens`: `>= 0.01` → `` `$${usd.toFixed(2)}` ``; `0 < usd < 0.01` → `'<$0.01'`; `<= 0` → `''` (caller drops the cost segment).

### 4. Add the `UsageBadge` component  <!-- agent: general-purpose -->

- [x] **Hot file — re-read the anchor symbol before inserting.** Use `mcp__serena__insert_after_symbol` (anchor: `ContextMeter`) in `frontend/src/components/AgentList.tsx` to add:
  - `function UsageBadge({ agent }: { agent: Agent })`:
    - `const u = agent.usage`; return `null` when `u` is null/undefined or all token fields and `costUsd` are 0.
    - `const totalTokens = u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens`.
    - Label: cost segment from `formatCost(u.costUsd)` and token segment `formatTokens(totalTokens)`, joined with ` · ` when both present; tokens-only when cost is empty.
    - `title` (and `aria-label`): full breakdown, e.g. `` `Session usage: ${formatCost(u.costUsd) || 'cost n/a'} · in ${u.inputTokens} / out ${u.outputTokens} / cache-w ${u.cacheCreationInputTokens} / cache-r ${u.cacheReadInputTokens} · ${u.sessions} session(s)` ``.
    - Markup: `<span className="flex-shrink-0 rounded-pill bg-[#f1f2f4] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[#4f5a78]" title={...}>{label}</span>`.

### 5. Render the badge in the card header  <!-- agent: general-purpose -->

- [x] **Hot file — re-read `AgentItem` immediately before this edit** (`mcp__serena__find_symbol`, `include_body=true`) — TASK-062's branch badge may have landed in the same rows; place around whatever is there without disturbing it.
- [x] In `AgentItem`'s Row 1 (`{/* Row 1 — project + name (left) / type + status (right) */}`), insert `<UsageBadge agent={agent} />` immediately before `<AgentTypeBadge agent={agent} />`, via a targeted `mcp__serena__replace_content` on that JSX span — not a whole-symbol rewrite if avoidable.
- [x] Verify the name span keeps `min-w-0 flex-1 truncate` so the added chip squeezes the name, not the row.

### 6. Typecheck, build, visual smoke  <!-- agent: general-purpose -->

- [x] `npx tsc --noEmit` in `frontend/` — zero errors.
- [x] `npm run build` in `frontend/` — clean build.
- [x] If `make dev` is running: with no usage data in the DB, confirm cards render with **no** badge and no console errors. If the accumulation task has landed and an agent has usage rows, confirm the chip shows `$X.XX · NNk` and the tooltip itemizes the four token fields. *(2026-08-15: verified live via Playwright — `bootstrap-1` shows `$0.14 · 56k`, `general` shows `10.1M` (cost n/a, tokens-only), `uat068-fp-dirty`/`uat068-probe-nogit` (no usage rows) show no badge. No console errors.)*

## Acceptance Criteria

- [x] Agent cards for agents with usage totals show a compact badge in the header row (Row 1) with cost and humanized total tokens (`$0.42 · 128k`; `M` tier above 1M tokens).
- [x] Agents with no usage data (or all-zero totals) show no badge — no placeholder, no `$0.00`.
- [x] Zero/absent `costUsd` with nonzero tokens renders the token segment only.
- [x] Tooltip/`aria-label` itemizes input / output / cache-creation / cache-read tokens and session count.
- [x] The badge is visually subordinate to `StatusBadge` (muted chip, 10px) and never breaks Row 1's layout (name still truncates). *(2026-08-15: confirmed live — chip renders muted, name truncates correctly in both agent cards.)*
- [x] No changes to `host-server/`; `frontend/src/lib/api.ts` untouched unless the accumulation task typed the payload there.
- [x] `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/`.

## Dependencies

- **DEPENDS ON [TASK-072](TASK-072-agent-usage-table.md)** — `agent_usage` table + `AgentUsageTotals`/`getAllAgentUsageTotals` helpers (the totals' source of truth).
- **DEPENDS ON [TASK-073](TASK-073-transcript-usage-extraction.md)** — transcript-JSONL usage extraction feeding the accumulator.
- **DEPENDS ON (by description — no task file at creation time):** the ROADMAP-010 Phase 1 accumulation task ("Accumulate rolling token totals per agent in the `agent_usage` table"), which persists TASK-073's deltas via TASK-072's `upsertAgentUsage` and exposes per-agent totals on the agents API payload. When its TASK-NNN exists, add it to `depends_on` and take its payload field names as authoritative (Step 1).
- **Coordinate with [TASK-062](TASK-062-branch-badge-ui.md)** — parallel-safe, but it edits the same `AgentItem` card markup; re-read before every edit.

### Roadmap

Implements ROADMAP-010 Phase 1, item "Add compact token/cost badge to agent card header in the dashboard" — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`. Downstream sibling: per-session usage breakdown in `AgentDetailModal` (next Phase 1 item, separate task).

## Implementation notes (2026-07-06)

- Implemented in the same session as TASK-075, so the payload contract was taken from the landed implementation directly: `usage: AgentUsageTotals | null` on snapshot + SSE `agent-update` agents (exactly the documented fallback shape). `frontend/src/lib/api.ts` untouched.
- `formatTokens` gained the `M` tier (trailing `.0` stripped); `formatCost` added beside it; `UsageBadge` inserted after `ContextMeter`; rendered in `AgentItem` Row 1 between the name span and `AgentTypeBadge` (TASK-062's branch badge had not landed).
- `npx tsc --noEmit` and `npm run build` both clean in `frontend/`.
