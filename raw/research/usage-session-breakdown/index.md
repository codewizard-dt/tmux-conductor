---
topic: Per-session usage breakdown view inside AgentDetailModal for ROADMAP-010 Phase 1 — one row per session (start time, input/output/cache tokens, cost) from the agent_usage table via listAgentUsage; determine whether a new backend endpoint (e.g. GET /api/agents/:agent/usage) is needed given the snapshot only exposes totals, and how the modal currently fetches data
slug: usage-session-breakdown
researched: 2026-07-06
sources: [./sources.md]
---

# Research: Per-session usage breakdown view inside `AgentDetailModal`

> `AgentDetailModal` is a function component inside `frontend/src/components/AgentList.tsx` (NOT a standalone `AgentDetailModal.tsx` file — no such file exists). It already lazy-fetches per-agent data on mount by **numeric agent id** (`GET ${API_BASE}/queue/:id` and `GET ${API_BASE}/agents/:id/skills`) and renders optional collapsible `<details>` sections (the Skills section is the direct template). Per-session rows are **not** available from any existing payload: the snapshot (`/status` + SSE) will only carry `AgentUsageTotals` aggregates once TASK-075 lands, and TASK-075 explicitly declares the per-session endpoint out of its scope. **A new backend endpoint is therefore required** — `GET /agents/:id/usage` in `host-server/index.ts`, a thin wrapper over the already-merged `listAgentUsage(db, agentId)` helper (TASK-072). Recommendation: one small Fastify route modeled on `/agents/:id/skills`, plus a collapsible "Usage" section in the modal with one row per session (start time, input / output / cache-write / cache-read tokens, cost) — column set matching ccusage's session report precedent.

## Research Questions

1. Where does `AgentDetailModal` live and how does it currently fetch per-agent data?
2. Is per-session usage data reachable from existing payloads (snapshot, `/agents`), or is a new endpoint needed?
3. What backend route pattern should a new `GET /agents/:id/usage` endpoint follow, and what does it return?
4. What UI pattern should the breakdown section follow inside the modal, and which formatting helpers exist/are planned?
5. What ordering/display caveats exist for `session_start`, and what are the hot-file hazards?

## Current State (Codebase)

- **`AgentDetailModal`** — `frontend/src/components/AgentList.tsx::AgentDetailModal` (body lines ~311–647, 0-based; moving target — other orchestrators edit this file). On mount it fetches `${API_BASE}/queue/${agent.id}` and `${API_BASE}/agents/${agent.id}/skills` inside one `useEffect` keyed on `agent.id`, with a `cancelled` flag and `.catch(() => {})` swallow. Body layout: header row (badges + actions) → grid (Details `<dl>` | Queued tasks) → `LogTail` → collapsible `<details>` **Skills** section rendered only when data is present and `!logExpanded`. [S1]
- **DB layer (TASK-072, merged)** — `host-server/db.ts::listAgentUsage(db, agentId): AgentUsage[]` runs `SELECT * FROM agent_usage WHERE agent_id = ? ORDER BY session_start DESC` and maps to camelCase `AgentUsage { id, agentId, sessionStart, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, costUsd, updatedAt }`. Currently referenced **only by tests** — no route consumes it. [S2][S3]
- **Backend route pattern** — `host-server/index.ts` line ~1511: `api.get<{ Params: { id: string } }>('/agents/:id/skills', …)` → `parseInt`, `isNaN` → 400, `getAgentById(db, agentId)` → 404 when missing, then `reply.send({...})`. All per-agent routes the modal calls use the numeric id, not the name. [S4]
- **No existing per-session data path** — `search_for_pattern` for `listAgentUsage|/usage` across `host-server/` hits only `db.ts` and `db.migration.test.ts`; `host-server/usage.ts` / `usage-store.ts` do not exist yet (TASK-073/TASK-075 unimplemented at research time). TASK-075 exposes only `usage: AgentUsageTotals | null` (lifetime aggregates) on the snapshot and states: "per-session breakdown in `AgentDetailModal` — consumes `listAgentUsage`; needs its own endpoint; out of scope here." [S3][S5]
- **Formatting helpers** — `formatTokens(n)` exists in `AgentList.tsx` (≥1000 → `Nk`); TASK-074 (sibling, separate task) plans to extend it with an `M` tier and add `formatCost(usd)`. The house pill/label styles and the `<details>`/`<summary>` uppercase-label pattern are established in the same file. [S1][S6]

## Key Findings

1. **A new endpoint is required — confirmed.** Totals-only snapshot data (TASK-075) cannot render per-session rows; nothing else serves `agent_usage` rows. The endpoint is a ~10-line Fastify route: `GET /agents/:id/usage` → `listAgentUsage(db, agentId)`. Lazy-fetch on modal open matches the existing skills/queue pattern and avoids putting an unbounded per-session array on every 2s snapshot tick. [S3][S4][S5]
2. **Fetch by id, render as a `<details>` section.** The modal's established conventions: fetch in the mount `useEffect` (or a parallel one) keyed on `agent.id`; render the section only when rows exist and `!logExpanded`; `<summary>` in the uppercase-tracking muted label style. [S1]
3. **Column precedent (ccusage session report):** per-session rows carry `inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, totalTokens, totalCost` plus activity timestamps — exactly the stored columns plus a derived total. A table with Session (start time) · In · Out · Cache W · Cache R · Total · Cost, newest first, matches both the DB shape and ecosystem precedent. [S2][S7]
4. **`session_start` display/ordering caveat.** TASK-075 keys rows by the first assistant record's ISO timestamp but falls back to the `sessionId` UUID when unavailable, and notes: "UUID fallbacks don't [sort correctly], order by `updated_at` there if it matters." The UI must render non-date `sessionStart` values gracefully (show a truncated id instead of `Invalid Date`) and should sort by `updatedAt DESC` client-side (or the endpoint can order that way) for stable ordering across both key kinds. [S5]
5. **Empty states are the norm initially:** Codex/Aider agents, fresh Claude sessions, and pre-TASK-073/075 databases have zero rows — the section should render nothing (or a muted "no usage data") rather than an empty table; the endpoint returns `[]`, never an error, for an existing agent with no rows (plain SELECT — no migration hazard beyond the DB already being at schema v4+). [S2][S5]
6. **Hot files:** `frontend/src/components/AgentList.tsx` (TASK-001/062/066/071/074 all touch it) and `host-server/index.ts` are concurrently edited. All edits must be Serena symbol-level operations with a re-read immediately before each edit. A tiny standalone `UsageSection` component inserted via `insert_after_symbol` minimizes the collision surface; the modal wiring is then a 1-line JSX insertion. [S6][S8]

## Constraints

- `AgentDetailModal` totals ~336 lines already — add the breakdown as a **separate function component** (`UsageBreakdown`/`UsageSection`) rather than inlining more JSX into the modal body.
- Do not overlap TASK-074 (card badge): shared helpers (`formatTokens` M-tier, `formatCost`) may land there first — re-check and reuse, defining them only if absent.
- Depends on TASK-072 (merged: `listAgentUsage`) and TASK-075 (writer — without it the table is always empty; the UI/endpoint work is testable earlier by seeding rows manually).
- The runtime `Agent` interface lives in `AgentList.tsx`; `frontend/src/lib/api.ts` holds only persistence-shape types — the new response type can live next to `SkillsResponse` in `AgentList.tsx`.

## Solution Comparison

| Criteria | A: New `GET /agents/:id/usage` + lazy fetch in modal | B: Attach per-session array to snapshot | C: Frontend-only from totals |
|----------|------------------------------------------------------|------------------------------------------|------------------------------|
| **Approach** | Thin route over `listAgentUsage`; modal fetches on open | Extend TASK-075's snapshot with `sessions[]` per agent | Render only `agent.usage` totals |
| **Pros** | Matches existing modal fetch pattern; data fetched only when viewed; zero snapshot bloat | No new endpoint | No backend work |
| **Cons** | One more route | Unbounded array serialized every ~2s for every agent/SSE client; conflicts with TASK-075's declared scope | Cannot show per-session rows — fails the roadmap item |
| **Complexity** | Low | Medium | Low |
| **Codebase fit** | High (mirrors `/agents/:id/skills`) | Poor | N/A |

## Recommendation

**Option A.** Implementation outline:

1. `host-server/index.ts`: add `api.get<{ Params: { id: string } }>('/agents/:id/usage', …)` adjacent to the `/agents/:id/skills` route — parseInt/400, `getAgentById`/404, `reply.send({ agent: entry.name, sessions: listAgentUsage(db, agentId) })` (import `listAgentUsage` from `./db`). Symbol-level insertion only.
2. `frontend/src/components/AgentList.tsx`: add `AgentUsageSession` type + `UsageBreakdown({ agentId })` component (self-fetching, like the skills pattern but encapsulated to keep the modal diff tiny); render `<UsageBreakdown agentId={agent.id} />` as a `<details>` section next to the Skills section.
3. Rows: start time (formatted; fallback to truncated raw key when not a parseable date) · input · output · cache-write · cache-read · total tokens · cost; footer totals row optional; sort `updatedAt DESC`.
4. Reuse `formatTokens`/`formatCost` (coordinate with TASK-074), `tabular-nums`, and an `overflow-x-auto` wrapper for narrow widths.

Risks & mitigations: hot-file collisions (Serena symbol ops, re-read before edit, standalone component); helper drift with TASK-074 (check for `formatCost` before defining); UUID `sessionStart` values (defensive date parsing); empty DBs (early-return null section).

## Next Steps

- `/task-add` the AgentDetailModal per-session breakdown task with `depends_on: [TASK-072, TASK-075]`, scope = endpoint + modal section, explicitly excluding the card badge (TASK-074).
- After implementation, `/wiki-ingest raw/research/usage-session-breakdown/index.md`.
