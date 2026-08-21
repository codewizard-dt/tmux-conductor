---
topic: Compact token/cost badge in agent card header for the tmux-conductor dashboard (frontend/, Vite React) — how per-agent usage totals will arrive via the agents API (TASK-072 agent_usage table, TASK-073 host-server/usage.ts extraction, plus an accumulation task exposing totals on the agents payload), which frontend component renders the agent card header, and precedent from TASK-062 branch badge UI
slug: token-cost-badge
researched: 2026-07-06
sources: [./sources.md]
---

# Research: Compact token/cost badge in the agent card header

> The agent card is the `AgentItem` function component inside `frontend/src/components/AgentList.tsx` (single file holds the card, its badges, the `Agent` interface, and `AgentDetailModal`). Its header is "Row 1" (`ProjectBadge` → name → `AgentTypeBadge` → `StatusBadge`). The dashboard already has every pattern the badge needs: a `formatTokens` k-formatter, pill-chip Tailwind styling (`ContextMeter`'s model chip), and camelCase usage fields flowing from host-server serialization sites into the local `Agent` interface via `GET /status` + SSE `agent-update`. The recommendation is a small `UsageBadge` component rendered in Row 1 (between `AgentTypeBadge` and `StatusBadge` or just before `AgentTypeBadge`), showing `$X.XX · NNk` (cost first, ccusage-statusline precedent), hidden entirely when no usage data exists, with a tooltip carrying the full token breakdown. Frontend-only; depends on the accumulation sibling exposing totals on the agents payload.

## Research Questions

1. Which component renders the agent card header, and where exactly does a badge slot in?
2. How will per-agent usage totals arrive in the frontend (field names, transport)?
3. What existing badge/formatting patterns should the new badge reuse?
4. What is a good compact display format for tokens + cost?
5. What are the concurrency hazards (hot files) an implementer must respect?

## Current State (Codebase)

- **Agent card**: `frontend/src/components/AgentList.tsx::AgentItem` (body lines ~651–711, 0-based). Header row ("Row 1 — project + name (left) / type + status (right)") renders `<ProjectBadge name={project} />`, the agent name span, `<AgentTypeBadge agent={agent} />`, `<StatusBadge status={status} />`. Row 2 holds the label chip and `<ContextMeter agent={agent} />`. [S1]
- **`Agent` interface** is defined locally in `AgentList.tsx` (not in `lib/api.ts`) with camelCase runtime fields: `contextTokens`, `contextPct`, `contextLimit`, `model`, `modelId`, `activeTask`, etc. `frontend/src/lib/api.ts::ApiAgent` is only the persistence-shape row (id/name/workdir/launchCmd/projectId/createdAt) — runtime status payloads are typed in `AgentList.tsx`. [S1][S2]
- **Data flow**: `AgentList` seeds from `fetch(`${apiUrl}/status`)` and stays live via `useSSEEvent('agent-update')` / `'session-update'` handlers; both payloads are built in `host-server/index.ts` at two serialization sites (~lines 1952 and 2133) that already spread `contextTokens/contextPct/contextLimit`. The accumulation sibling will add usage totals at these same sites. [S1][S3]
- **Formatting helpers already present**: `formatTokens(n)` (≥1000 → `"${Math.round(n/1000)}k"`) at `AgentList.tsx` lines ~191–194; `ContextMeter`'s model chip shows the house pill style: `rounded-pill bg-[#f1f2f4] px-1.5 py-0.5 text-[10px] font-semibold text-[#4f5a78]`. [S1]
- **DB layer contract (TASK-072)**: `AgentUsageTotals { agentId, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, costUsd, sessions }` with `getAgentUsageTotals` / `getAllAgentUsageTotals` helpers designed explicitly "for the agent-card badge sibling task". [S4]
- **Extraction layer (TASK-073)**: `host-server/usage.ts` emits `UsageDelta` records; `costUSD` may be null (cost math may land in the accumulator). So the badge must tolerate `costUsd === 0`/absent while tokens are present. [S5]
- **Precedent task**: TASK-062 (branch badge) — same shape: expose field in API response, extend frontend type, conditionally render a subtle chip on the card, typecheck + build. [S6]

## Constraints

- **Hot files**: `frontend/src/components/AgentList.tsx` and `frontend/src/lib/api.ts` are being edited concurrently by other orchestrators; edits must be symbol-level/targeted with a re-read immediately before each edit.
- **Field names not final**: the accumulation task (no TASK file at research time) owns the payload field name. Reasonable expectation: a nested `usage` object or flat `usageTokens`/`usageCostUsd` added at the two `host-server/index.ts` serialization sites. The badge task must instruct implementers to read the accumulation task's actual field names first and align.
- **Null-safety**: agents with no usage rows (Codex/Aider, fresh Claude sessions, pre-migration DBs) must render no badge — mirroring `ContextMeter`'s `pct == null` early-return and TASK-062's "branch = NULL shows nothing".
- **Visual restraint**: Row 1 is already dense (4 elements); the badge must be a tiny muted chip that does not compete with `StatusBadge`.

## Key Findings

1. **The badge belongs in `AgentItem` Row 1** — that is the card header per the component's own comment. Row 2 (label + ContextMeter) is the fallback slot if Row 1 overflows on narrow columns. [S1]
2. **Cost-first compact format has ecosystem precedent**: ccusage's statusline renders `💰 $0.23 session … 🧠 25,000 (12%)` — dollars to two decimals, tokens humanized. A `$0.42 · 128k` chip matches this and the repo's own `formatTokens`. [S7][S8]
3. **Total tokens for the badge should be input + output only by default is wrong for Claude Code** — cache reads dominate real usage; TASK-072 deliberately stores cache columns "required for honest cost math". The compact figure should sum all four token columns (or show cost + non-cache tokens with the full breakdown in the tooltip); the task should pick: badge shows `costUsd` + total tokens (all four), tooltip itemizes. [S4]
4. **`formatTokens` needs an M tier**: cumulative cache-read totals routinely exceed 1M; extend or wrap it (`1.2M`) rather than showing `1234k`. (inference — no primary source; arithmetic on `formatTokens`'s body [S1])

## Recommendation

Add a small `UsageBadge` function component in `AgentList.tsx` (near `ContextMeter`/`AgentTypeBadge`):

1. Extend the local `Agent` interface with the usage fields the accumulation task exposes (verify its actual names first; fallback spec: `usage?: { inputTokens; outputTokens; cacheCreationInputTokens; cacheReadInputTokens; costUsd; sessions } | null`).
2. `UsageBadge({ agent })` returns `null` when usage is absent or all-zero; otherwise renders a muted pill (`ContextMeter` model-chip classes) with `{formatCost(costUsd)} · {formatTokensCompact(totalTokens)}`; `title` attribute carries the full breakdown (input / output / cache-write / cache-read / sessions).
3. Render it in `AgentItem` Row 1, immediately before `<AgentTypeBadge …/>`.
4. Reuse/extend `formatTokens` with an `M` tier; add a `formatCost` (`< $0.01` → `<$0.01`; otherwise `$X.XX`).
5. Optionally mirror in `AgentDetailModal` header — **out of scope**; the per-session breakdown view is a separate roadmap item.

Risks: field-name drift vs the accumulation task (mitigate: read its task file/implementation before typing the interface); Row 1 crowding (mitigate: hide badge under `null`, keep 10px font); concurrent edits to `AgentList.tsx` (mitigate: Serena symbol-level inserts, re-read before edit).

## Next Steps

- `/task-add` the frontend badge task (this research's consumer), `depends_on` the accumulation task if its TASK-NNN exists by write time, else `[TASK-072, TASK-073]` + prose note.
- The `AgentDetailModal` per-session breakdown is a separate roadmap item; do not fold it in.
