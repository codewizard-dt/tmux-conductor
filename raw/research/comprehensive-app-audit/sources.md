---
topic: Run a comprehensive audit of this application. Identify other similar applications that are popular. Assess them, identify gaps between them and this app, consider what it would take to fill those gaps and the benefits it would provide. Areas to consider — latency, observability, UI/UX, task management, agent management, project management.
slug: comprehensive-app-audit
researched: 2026-07-06
---

# Primary Sources — Comprehensive Audit of tmux-conductor

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase (via Explore subagent) | `host-server/index.ts` (status/tail/focused-tail poll loops, `/api/perf/live-updates`, `observability.jsonl` events), `host-server/state.ts::detectAgentStatus`, `host-server/context.ts`, `scripts/monitor.sh`, `conductor.conf` (`POLL_INTERVAL`), `host-server/perfBudgets.ts`, commits `3ea7ea9`/`7d1d895`/`53152c4` | 2026-07-06 | Latency/observability internals: dual poll-loop cadence mismatch (2s dashboard vs 15s dispatch), in-memory-only perf metrics, zero token/cost telemetry, sync tmux calls |
| S2 | codebase (via Explore subagent) | `frontend/src/App.tsx`, `frontend/src/components/AgentList.tsx`, `frontend/src/components/LogTail.tsx`, `frontend/tailwind.config.js`, `frontend/src/styles/global.css` | 2026-07-06 | UI/UX structure: 3-column Kanban, audio cues, hybrid WS/SSE/REST terminal transport, no dark mode, shipped debug panel |
| S3 | codebase (via Explore subagent) | `host-server/db.ts` (`tasks`, `agents`, `projects`, `schedules` tables/queries), `scripts/add-task.sh`, `host-server/index.ts` (task/agent/project REST endpoints) | 2026-07-06 | Task/agent/project management schema and API: flat task queue with hard-delete, agent state machine, first-class projects table with no per-project settings beyond workdir/launch cmd |
| S4 | web | https://code.claude.com/docs/en/agent-teams | 2026-07-06 | Claude Code's native Agent Teams: shared task list with dependency blocking, direct teammate messaging, `TeammateIdle`/`TaskCreated`/`TaskCompleted` hooks, plan-approval workflow, experimental/session-scoped limitations |
| S5 | web | https://www.augmentcode.com/tools/open-source-agent-orchestrators | 2026-07-06 | Comparison table of 9+ orchestrators (Composio, Emdash, Baton, Code Conductor, Microsoft Conductor, Bernstein, Claude Squad, Nimbalyst, Vibe Kanban, Agent Kanban) with UI/task/observability breakdown per tool |
| S6 | web | https://madewithlove.com/blog/conductor-running-multiple-ai-coding-agents-in-parallel/ | 2026-07-06 | Conductor (Melty Labs) detail: git-worktree workspaces, checkpoints/rollback, multi-model mode, PR flow, criticisms (token cost multiplication, context amnesia) |
| S7 | web | https://github.com/stravu/crystal (via search result) and https://nimbalyst.com/blog/crystal-supercharge-your-development-with-multi-session-claude-code-management/ | 2026-07-06 | Crystal → Nimbalyst: git worktree isolation, diff visualization with commit stats, rebase/squash workflow, kanban + multi-editor; Crystal deprecated Feb 2026 |
| S8 | web | https://vibe-kb.com/ | 2026-07-06 | Vibe Kanban: kanban board (To Do/In Progress/Review/Done), MCP-driven task decomposition, virtualized diff review for 300+ file PRs, desktop notifications, community-maintained status post-Bloop-shutdown |
| S9 | web | https://agentsroom.dev/multi-agent-dashboard | 2026-07-06 | AgentsRoom: grid dashboard, role-based color coding, <1s status refresh claim, project-switch sidebar, native Electron PTY rendering |
| S10 | web | https://vibecoding.app/blog/ntm-review | 2026-07-06 | NTM (Named Tmux Manager): token-velocity badges, file-level conflict/reservation locks, context-compaction detection |
| S11 | web | https://code.claude.com/docs/en/agent-sdk/observability | 2026-07-06 | Claude Code's native OpenTelemetry export: `CLAUDE_CODE_ENABLE_TELEMETRY`, `claude_code.token.usage`/`claude_code.cost.usage` metrics, export intervals |
| S12 | web | https://ccusage.com/ | 2026-07-06 | ccusage: local-only JSONL transcript parsing for token/cost reports, no network calls, per-session/daily/monthly breakdowns |
| S13 | web | https://websocket.org/guides/websockets-and-ai/ and https://www.infoq.com/news/2026/05/openai-websocket-responses-api/ | 2026-07-06 | Industry trend: WebSocket adoption over SSE for bidirectional AI agent dashboards, ~30-40% latency reduction reported by Vercel/Cline/Cursor/OpenAI |

## Excerpts

### S5 — 9 Open-Source Agent Orchestrators for AI Coding (2026)
https://www.augmentcode.com/tools/open-source-agent-orchestrators
> **Claude Squad**: TUI with vim-style navigation... Fast parallel launch (~5 seconds for six sessions); low learning curve. Weaknesses: AGPL-3.0 licensing; no Windows support (tmux dependency); HITL for all changes

### S8 — Vibe Kanban
https://vibe-kb.com/
> Vibe Kanban is a free, open-source orchestration tool that enables developers to run multiple AI coding agents simultaneously with isolated workspaces and unified review capabilities... Virtualized diff streams optimized for large pull reviews (300+ files)

### S9 — AgentsRoom Multi-Agent Dashboard
https://agentsroom.dev/multi-agent-dashboard
> The system achieves sub-second refresh rates with "<1s status refresh" capability... The dashboard uses native Electron rendering with real PTY processes for each agent, avoiding browser-based latency.

### S10 — NTM Review 2026
https://vibecoding.app/blog/ntm-review
> Token velocity badges show how fast each agent is burning through tokens, which helps you spot an agent that has gone into a loop versus one that is making steady progress... NTM implements file-level conflict prevention through "file reservations so agents can claim files before editing."

### S11 — Observability with OpenTelemetry (Claude Code Docs)
https://code.claude.com/docs/en/agent-sdk/observability
> Claude Code can export observability data as OpenTelemetry traces, metrics, and log events to any backend that accepts the OpenTelemetry Protocol (OTLP)... Metrics (like claude_code.token.usage and claude_code.cost.usage) are numeric time-series data, ideal for dashboards, aggregations, and alerts.

### S12 — ccusage
https://ccusage.com/
> Running npx ccusage@latest parses the local JSONL session logs entirely on your machine, with no API key and no network call, then prints daily, monthly, per-session, and 5-hour-block cost reports with per-model and cache-token breakdowns.

### S13 — WebSockets and AI (websocket.org)
https://websocket.org/guides/websockets-and-ai/
> Adoption of WebSocket mode has been immediate among developer tooling platforms—Vercel integrated it into its AI SDK and reported up to 40% latency reduction, Cline observed a 39% improvement in multi-file workflows, while Cursor reported gains of up to 30%.
