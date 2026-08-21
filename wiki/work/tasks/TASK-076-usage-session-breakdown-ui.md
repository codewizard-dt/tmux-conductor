---
id: TASK-076
aliases: [TASK-076]
title: "Per-session usage breakdown — GET /agents/:id/usage endpoint + session table in AgentDetailModal"
status: pending-uat
created: 2026-07-06
updated: 2026-07-06
depends_on: [TASK-072, TASK-075]
blocks: []
parallel_safe_with: [TASK-001, TASK-011, TASK-012, TASK-050, TASK-061, TASK-062, TASK-063, TASK-065, TASK-066, TASK-067, TASK-068, TASK-069, TASK-070, TASK-071, TASK-073, TASK-074]
uat: "[[UAT-076]]"
tags: [frontend, host-server, ui, tokens, cost, observability, roadmap-010]
---

# TASK-076 — Per-session usage breakdown — GET /agents/:id/usage endpoint + session table in `AgentDetailModal`

## Objective

Show a per-session usage breakdown inside the agent detail modal: one row per Claude Code session — start time, input / output / cache-creation / cache-read tokens, and cost — read from the `agent_usage` table ([TASK-072](TASK-072-agent-usage-table.md)) that the accumulator ([TASK-075](TASK-075-usage-accumulation.md)) populates. Per-session rows are reachable from **no existing payload** (the snapshot carries only `AgentUsageTotals` aggregates, and TASK-075 declared the breakdown out of scope), so this task adds one thin backend endpoint — `GET /agents/:id/usage` over the already-merged `listAgentUsage(db, agentId)` helper — plus a collapsible "Usage" section in the modal. **Scope boundary:** the compact agent-card badge is [TASK-074](TASK-074-usage-badge-ui.md) — do not touch `AgentItem` or add any card-level UI here; do not add pricing math (render `costUsd` as stored).

## Approach

Research: `raw/research/usage-session-breakdown/index.md` (builds on `raw/research/token-cost-badge/index.md` and the TASK-072/075 research). Decisions recorded there, binding here:

- **`AgentDetailModal` is NOT a standalone file.** It is a function component inside `frontend/src/components/AgentList.tsx` (body ~lines 311–647, 0-based, at task-creation time — a moving target). The roadmap line's `AgentDetailModal.tsx` wording refers to this component; there is no such file to create.
- **New endpoint confirmed necessary.** `listAgentUsage` is currently consumed only by tests; the snapshot exposes totals only. Endpoint: `GET /agents/:id/usage` in `host-server/index.ts`, modeled verbatim on the adjacent `/agents/:id/skills` route (numeric-id param, `parseInt` → 400, `getAgentById` → 404). Response: `{ agent: string, sessions: AgentUsage[] }` — the camelCase rows from `listAgentUsage` untransformed. Lazy-fetch on modal open (the established queue/skills pattern) keeps unbounded session arrays off the ~2s snapshot tick.
- **Fetch encapsulated in a new self-contained component.** The modal already runs ~336 lines; add a `UsageBreakdown({ agentId }: { agentId: number })` function component that fetches its own data on mount (mirroring the modal's `cancelled`-flag + `.catch(() => {})` fetch style) and renders a `<details>` section styled like the existing Skills section. The modal wiring is then a single JSX line — minimal collision surface in a hot file.
- **Columns follow the ccusage session-report precedent** (`inputTokens / outputTokens / cacheCreationTokens / cacheReadTokens / totalTokens / totalCost` + activity timestamp): **Session · In · Out · Cache W · Cache R · Total · Cost**, plus a totals footer row. Total = sum of all four token columns (cache reads dominate real usage).
- **`session_start` display/ordering caveat (from TASK-075):** rows are keyed by the first assistant record's ISO timestamp, **falling back to the `sessionId` UUID** when unavailable. UUIDs neither parse as dates nor sort chronologically, so: sort rows by `updatedAt` DESC client-side (don't trust `session_start DESC` from SQL), and render non-parseable `sessionStart` values as a truncated monospace id (first 8 chars + `…`) — never `Invalid Date`.
- **Empty states are the norm initially** (Codex/Aider agents, fresh sessions, DBs from before TASK-073/075 land): zero rows → the component returns `null` (no empty table, no placeholder). Fetch errors → `null` likewise. For an existing agent the endpoint returns `sessions: []`, never an error.
- **Formatting helpers — coordinate with TASK-074, don't duplicate.** `formatTokens` exists in `AgentList.tsx` (≥1000 → `Nk`); TASK-074 plans an `M` tier and a `formatCost` helper. At implementation time check whether they landed: reuse if present, define if absent (same specs: `M` tier strips trailing `.0`; `formatCost`: `>= 0.01` → `$X.XX`, `0 < x < 0.01` → `<$0.01`, `<= 0` → `''`). Full-precision numbers go in cell `title` attributes.
- **Hot-file discipline (CRITICAL):** `frontend/src/components/AgentList.tsx` (TASK-001/062/066/071/074 all touch it) and `host-server/index.ts` are concurrently edited by other orchestrators. Implementers MUST use Serena symbol-level operations only (`get_symbols_overview`, `find_symbol`, `insert_after_symbol`, `replace_content`) — never whole-file rewrites — and **re-read the target symbol immediately before every edit**; if an edit fails because content changed, re-read and retry. `host-server/db.ts` needs zero edits. `frontend/src/lib/api.ts` stays untouched (runtime types live in `AgentList.tsx`).

## Steps

### 1. Confirm integration state  <!-- agent: Explore -->

- [x] `mcp__serena__find_symbol` on `listAgentUsage` and `AgentUsage` in `host-server/db.ts` — confirm the merged signatures (at task-creation time: `listAgentUsage(db, agentId): AgentUsage[]`, row shape `{ id, agentId, sessionStart, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, costUsd, updatedAt }`).
- [x] `mcp__serena__search_for_pattern` for `agents/:id/skills` in `host-server/index.ts` — locate the skills route (at task-creation time ~line 1511, 0-based) as the insertion anchor and confirm the `getAgentById` import is in scope. Also confirm no `/agents/:id/usage` route already exists.
- [x] `mcp__serena__find_symbol` on `formatTokens` in `frontend/src/components/AgentList.tsx` (`include_body=true`) — check whether TASK-074's `M` tier and `formatCost` landed; note which helpers this task must add itself.
- [x] `mcp__serena__find_symbol` on `AgentDetailModal` (`include_body=true`) — re-locate the mount `useEffect` (queue + skills fetches) and the Skills `<details>` section (the placement anchor and style template). Note the `logExpanded` gating.
- [x] Check TASK-075's landed `session_start` semantics in `host-server/usage-store.ts` (if merged): ISO-timestamp key with `sessionId`-UUID fallback — confirms the defensive-rendering requirement below.

### 2. Backend — `GET /agents/:id/usage`  <!-- agent: general-purpose -->

- [x] **Hot file — Serena symbol ops only; re-read the anchor route immediately before editing.** In `host-server/index.ts`, insert after the `/agents/:id/skills` route (via `mcp__serena__replace_content` or `insert_after_symbol` on the enclosing registration function), following its shape exactly:

```ts
// Per-session usage breakdown (agent_usage rows) for the dashboard detail modal.
api.get<{ Params: { id: string } }>('/agents/:id/usage', (req, reply) => {
  const agentId = parseInt(req.params.id, 10);
  if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
  const entry = getAgentById(db, agentId);
  if (!entry) {
    return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
  }
  return reply.send({ agent: entry.name, sessions: listAgentUsage(db, agentId) });
});
```

- [x] Add `listAgentUsage` to the existing `./db` import specifier list (targeted `replace_content` on the import line — not a file rewrite).
- [x] Keep the total `index.ts` diff to the route block + one import token. No SSE events, no snapshot changes (TASK-075 owns those).

### 3. Frontend — types + `UsageBreakdown` component  <!-- agent: general-purpose -->

- [x] **Hot file — re-read anchors immediately before each edit.** In `frontend/src/components/AgentList.tsx`, next to the existing `SkillsResponse` interface, add (via `insert_after_symbol`):
  - `interface AgentUsageSession { id: number; agentId: number; sessionStart: string; inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number; costUsd: number; updatedAt: string }`
  - `interface AgentUsageResponse { agent: string; sessions: AgentUsageSession[] }`
- [x] If Step 1 found them missing, add `formatCost` (and the `formatTokens` `M` tier) per the specs in Approach — placed next to `formatTokens`; do not redefine anything TASK-074 already landed.
- [x] Add a module-level date helper `formatSessionStart(s: string): string` — `const d = new Date(s)`; if `!Number.isNaN(d.getTime())` return a compact local string (e.g. `d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })`); else return `` `${s.slice(0, 8)}…` `` (UUID fallback key), rendered in `font-mono`.
- [x] Add `function UsageBreakdown({ agentId }: { agentId: number })` (insert via `mcp__serena__insert_after_symbol`, anchor: the `SkillRow` or `ContextMeter` component — whichever Step 1 confirms present):
  - State: `const [sessions, setSessions] = useState<AgentUsageSession[] | null>(null)`.
  - Mount `useEffect` keyed on `agentId`, mirroring the modal's existing fetch style: `fetch(\`${API_BASE}/agents/${agentId.toString()}/usage\`)` → `AgentUsageResponse` → `setSessions(data.sessions)`, with `cancelled` flag and `.catch(() => {})`.
  - `if (!sessions || sessions.length === 0) return null` — no section for empty/unfetched/error states.
  - Sort a copy by `updatedAt` DESC (NOT `sessionStart` — UUID fallback keys don't sort chronologically).
  - Render a `<details>` block matching the Skills section's style: `<summary>` `Usage ({sessions.length} session{s})` in the `cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-muted select-none` style, then a `<div className="mt-2 overflow-x-auto">` wrapping a compact table (`text-[11px]`, `tabular-nums`, right-aligned numeric cells): header **Session · In · Out · Cache W · Cache R · Total · Cost**; per row: `formatSessionStart(sessionStart)`, `formatTokens` for each token column, total = sum of the four token fields, `formatCost(costUsd)` (empty cost cell when it returns `''`); cell `title` attributes carry full unformatted numbers.
  - Footer row (`<tfoot>`, `font-semibold`, top border): "Total" + per-column sums across sessions, cost summed via `formatCost`.

### 4. Wire into `AgentDetailModal`  <!-- agent: general-purpose -->

- [x] **Re-read `AgentDetailModal` immediately before this edit** (`find_symbol include_body=true`) — TASK-001/066/071 edits may have landed around the Skills section.
- [x] Insert `{!logExpanded && <UsageBreakdown agentId={agent.id} />}` immediately after the Skills `<details>` section's closing brace (inside the same scrollable body `<div>`), via a targeted `mcp__serena__replace_content` on the surrounding JSX — not a whole-symbol rewrite.
- [x] Do NOT touch `AgentItem`, `ContextMeter`, or any card-level markup (TASK-074's territory).

### 5. Typecheck, build, smoke  <!-- agent: general-purpose -->

- [x] `npx tsc --noEmit` in `host-server/` and in `frontend/` — zero errors; `npm run build` in `frontend/` — clean.
- [x] Endpoint smoke: with the host-server running, `curl -s localhost:8788/api/agents/<id>/usage` → `{ agent, sessions: [...] }` for a valid id; `.../agents/999999/usage` → 404 JSON error; `.../agents/abc/usage` → 400. *(2026-08-15: verified live — agent 10 and 11 both returned `{agent, sessions:[...]}` with real accumulated data; 999999 → `404 {"error":"agent 999999 not found"}`; `abc` → `400 {"error":"invalid agent id"}`.)*
- [ ] UI smoke (`make dev`): open an agent's detail modal — with usage rows present, the collapsible "Usage" section lists one row per session with formatted start time, four token columns, total, cost, and a totals footer; with zero rows, no Usage section renders at all; expanding the log (`logExpanded`) hides the section; no console errors. *(2026-08-15: verified via Playwright — "general" agent's modal shows "Usage (1 session)" collapsible, expands to a table with Session/In/Out/Cache W/Cache R/Total/Cost columns and a Total footer row (162 / 52k / 308k / 9.8M / 10.1M, cost blank since costUsd is 0); no console errors. Did not verify the zero-rows case or `logExpanded` interaction — no agent with zero usage rows and an active log was available to test both together.)*

## Acceptance Criteria

- [x] `GET /agents/:id/usage` returns `{ agent, sessions: AgentUsage[] }` (camelCase rows) for a valid agent; `[]` sessions for an agent with no usage; 400 on non-numeric id; 404 on unknown agent.
- [x] `AgentDetailModal` shows a collapsible "Usage" section with one row per session: start time, input, output, cache-creation, cache-read tokens, derived total, and cost, newest first (ordered by `updatedAt`), plus a totals footer row.
- [x] Non-date `sessionStart` values (UUID fallback keys) render as a truncated monospace id — never `Invalid Date`; ordering remains correct.
- [x] Agents with zero usage rows show no Usage section (no empty table, no `$0.00` placeholder); fetch failures degrade to no section, never a crash.
- [x] Card-level UI untouched (`AgentItem` diff empty — TASK-074 owns the badge); no snapshot/SSE payload changes; `host-server/db.ts` and `frontend/src/lib/api.ts` untouched; `index.ts` diff limited to the route + import token.
- [x] Formatting helpers shared with TASK-074 (reused if landed, defined once if not) — no duplicate `formatCost`/`formatTokens` definitions.
- [x] `npx tsc --noEmit` passes in both `host-server/` and `frontend/`; `npm run build` clean in `frontend/`.

## Dependencies

- **DEPENDS ON [TASK-072](TASK-072-agent-usage-table.md)** — `agent_usage` table + `listAgentUsage`/`AgentUsage` (merged in `host-server/db.ts` at task-creation time).
- **DEPENDS ON [TASK-075](TASK-075-usage-accumulation.md)** — populates the rows this view displays and defines the `session_start` key semantics (ISO timestamp with UUID fallback). The endpoint + UI are buildable and testable before it lands (via a seeded row, Step 5), but the feature is only meaningful once accumulation writes real data.
- **Coordinate with [TASK-074](TASK-074-usage-badge-ui.md)** — parallel-safe, but shares `AgentList.tsx` and the `formatTokens`/`formatCost` helpers; whichever lands second reuses the first's helpers. This task must not render card-level usage UI.
- **Coordinate with [TASK-001](TASK-001-skill-detection.md) / [TASK-066](TASK-066-diff-panel-ui.md) / [TASK-071](TASK-071-checkpoint-ui.md)** — all add sections to `AgentDetailModal`; re-read before every edit there.

### Roadmap

Implements ROADMAP-010 Phase 1, item "Add per-session usage breakdown view inside `AgentDetailModal`" — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`. Final Phase 1 item; upstream siblings: TASK-072 (schema), TASK-073 (extraction), TASK-075 (accumulation), TASK-074 (card badge).

## Implementation notes (2026-07-06)

- Implemented in the same session as TASK-073/074/075, so the shared helpers (`formatTokens` M tier, `formatCost`) were already landed and reused — `formatSessionStart` was the only new helper (UUID fallback renders as truncated `font-mono` id, never `Invalid Date`).
- Backend: `GET /agents/:id/usage` inserted directly after the `/agents/:id/skills` route, same 400/404 shape; `listAgentUsage` added to the existing `./db.ts` import specifier.
- Frontend: `AgentUsageSession`/`AgentUsageResponse` interfaces after `SkillsResponse`; `UsageBreakdown` inserted after `UsageBadge`; wired as `{!logExpanded && <UsageBreakdown agentId={agent.id} />}` immediately after the Skills `<details>` block. Rows sorted by `updatedAt` DESC; empty/error states return `null`. `AgentItem` untouched by this task.
- `npx tsc --noEmit` clean in both packages; `npm run build` clean in `frontend/`.
