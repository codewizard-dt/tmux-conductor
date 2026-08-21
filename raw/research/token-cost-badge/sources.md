---
topic: Compact token/cost badge in agent card header for the tmux-conductor dashboard (frontend/, Vite React) — how per-agent usage totals will arrive via the agents API (TASK-072 agent_usage table, TASK-073 host-server/usage.ts extraction, plus an accumulation task exposing totals on the agents payload), which frontend component renders the agent card header, and precedent from TASK-062 branch badge UI
slug: token-cost-badge
researched: 2026-07-06
---

# Primary Sources — Compact token/cost badge in the agent card header

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `frontend/src/components/AgentList.tsx::AgentItem`, `::Agent`, `::formatTokens`, `::ContextMeter` | 2026-07-06 | Card header structure (Row 1 comment), local `Agent` interface with camelCase runtime fields, existing k-formatter, house pill-chip Tailwind classes |
| S2 | codebase | `frontend/src/lib/api.ts::ApiAgent` | 2026-07-06 | `ApiAgent` is persistence-shape only (id/name/workdir/launchCmd/projectId/createdAt); runtime agent typing lives in `AgentList.tsx` |
| S3 | codebase | `host-server/index.ts` lines ~1952, ~2133 | 2026-07-06 | The two agent-payload serialization sites that already spread `contextTokens/contextPct/contextLimit`; where the accumulation sibling will attach usage totals |
| S4 | codebase | `wiki/work/tasks/TASK-072-agent-usage-table.md` | 2026-07-06 | `AgentUsageTotals` shape (`inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, costUsd, sessions`); `getAgentUsageTotals`/`getAllAgentUsageTotals` are "for the agent-card badge sibling task"; cache columns "required for honest cost math" |
| S5 | codebase | `wiki/work/tasks/TASK-073-transcript-usage-extraction.md` | 2026-07-06 | `UsageDelta` shape; `costUSD` may be null (pricing math deferred to accumulator); accumulation task has no file yet and should be depended on by description if still absent |
| S6 | codebase | `wiki/work/tasks/TASK-062-branch-badge-ui.md` | 2026-07-06 | Precedent structure for a card-badge task: expose field in API → extend frontend type → conditional subtle chip → typecheck/build; null → no badge |
| S7 | web | https://ccusage.com/guide/statusline | 2026-07-06 | Compact one-line usage format precedent: cost-first dollars, humanized tokens |
| S8 | web | https://github.com/ryoppippi/ccusage | 2026-07-06 | ccusage tracks cache creation/read tokens separately and shows USD costs per session — same four-token model as TASK-072 |

## Excerpts

### S7 — ccusage statusline guide
https://ccusage.com/guide/statusline
> The statusline displays a compact, single-line summary: ... 🤖 Opus 4.1 | 💰 $0.23 session / $1.23 today / $0.45 block (2h 45m left) | 🔥 $0.12/hr | 🧠 25,000 (12%)

### S8 — ccusage README (GitHub)
https://github.com/ryoppippi/ccusage
> 💰 Cost Tracking: Shows costs in USD for each day/month/session · 🔄 Cache Token Support: Tracks and displays cache creation and cache read tokens separately
