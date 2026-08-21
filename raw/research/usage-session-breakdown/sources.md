---
topic: Per-session usage breakdown view inside AgentDetailModal for ROADMAP-010 Phase 1 — one row per session (start time, input/output/cache tokens, cost) from the agent_usage table via listAgentUsage; determine whether a new backend endpoint (e.g. GET /api/agents/:agent/usage) is needed given the snapshot only exposes totals, and how the modal currently fetches data
slug: usage-session-breakdown
researched: 2026-07-06
---

# Primary Sources — Per-session usage breakdown in `AgentDetailModal`

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `frontend/src/components/AgentList.tsx::AgentDetailModal` (lines ~311–647, 0-based) | 2026-07-06 | Modal lives in AgentList.tsx (no AgentDetailModal.tsx file exists); lazy-fetches `/queue/:id` and `/agents/:id/skills` by numeric `agent.id` in a mount `useEffect` with `cancelled` flag; renders collapsible `<details>` Skills section gated on data presence and `!logExpanded` |
| S2 | codebase | `host-server/db.ts::listAgentUsage` (line 751, 0-based) | 2026-07-06 | `SELECT * FROM agent_usage WHERE agent_id = ? ORDER BY session_start DESC` returning camelCase `AgentUsage[]` |
| S3 | codebase | `search_for_pattern 'listAgentUsage|/usage'` over `host-server/` + `list_dir host-server/` | 2026-07-06 | `listAgentUsage` referenced only by `db.migration.test.ts`; no `/usage` route exists; `usage.ts`/`usage-store.ts` not yet created (TASK-073/075 unimplemented) |
| S4 | codebase | `host-server/index.ts` line ~1511 (`/agents/:id/skills` route) | 2026-07-06 | Route template: `api.get<{ Params: { id: string } }>` → parseInt/400 → `getAgentById`/404 → `reply.send` |
| S5 | codebase | `wiki/work/tasks/TASK-075-usage-accumulation.md` | 2026-07-06 | Snapshot exposes only `usage: AgentUsageTotals \| null`; "per-session breakdown in `AgentDetailModal` — consumes `listAgentUsage`; needs its own endpoint; out of scope here"; `session_start` UUID-fallback ordering caveat ("order by `updated_at` there if it matters") |
| S6 | codebase | `frontend/src/components/AgentList.tsx::formatTokens` (lines 191–194) + `wiki/work/tasks/TASK-074-usage-badge-ui.md` | 2026-07-06 | Existing k-formatter; TASK-074 plans `M` tier + `formatCost`; hot-file discipline for AgentList.tsx; `Agent` runtime interface lives in AgentList.tsx not api.ts |
| S7 | web | https://ccusage.com/guide/session-reports | 2026-07-06 | Per-session report column precedent: inputTokens/outputTokens/cacheCreationTokens/cacheReadTokens/totalTokens/totalCost + activity timestamps |
| S8 | codebase | `raw/research/token-cost-badge/index.md` (prior run, immutable) | 2026-07-06 | Two host-server serialization sites feed `/status` + SSE; badge (Row 1 chip) scope explicitly separate from the modal breakdown |

## Excerpts

### S7 — ccusage | Session Reports
https://ccusage.com/guide/session-reports
> `{ "sessions": [ { "sessionId": "abc123-def", "inputTokens": 4512, "outputTokens": 350846, "cacheCreationTokens": 512, "cacheReadTokens": 1024, "totalTokens": 356894, "totalCost": 156.4, "firstActivity": "2026-05-15T09:30:00.000Z", "lastActivity": "2026-05-16T17:45:30.000Z", "modelsUsed": ["opus-4-1", "sonnet-4-5"], ... } ], "totals": { "inputTokens": 9174, "outputTokens": 720546, "totalCost": 336.58 } }`

### S5 — TASK-075 (usage accumulation)
`wiki/work/tasks/TASK-075-usage-accumulation.md`
> Downstream Phase 1 sibling (no task file yet): per-session usage breakdown in `AgentDetailModal` — consumes `listAgentUsage`; needs its own endpoint; out of scope here.
> (Note for the detail-modal sibling: `listAgentUsage` orders by `session_start DESC` — ISO timestamps sort correctly; UUID fallbacks don't, order by `updated_at` there if it matters.)

### S4 — host-server/index.ts `/agents/:id/skills` route
`host-server/index.ts` (~line 1511)
> `api.get<{ Params: { id: string } }>('/agents/:id/skills', async (req, reply) => { const agentId = parseInt(req.params.id, 10); if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' }); const entry = getAgentById(db, agentId); if (!entry) { return reply.status(404).send({ error: \`agent ${String(agentId)} not found\` }); } ... });`
