---
topic: Run a comprehensive audit of this application. Identify other similar applications that are popular. Assess them, identify gaps between them and this app, consider what it would take to fill those gaps and the benefits it would provide. Areas to consider — latency, observability, UI/UX, task management, agent management, project management.
slug: comprehensive-app-audit
researched: 2026-07-06
sources: [./sources.md]
---

# Research: Comprehensive Audit of tmux-conductor vs. Popular Multi-Agent Coding Orchestrators

> tmux-conductor's core orchestration (agent state machine, SQL task queue, project scoping, hybrid WS/SSE terminal transport) is solid and in some respects ahead of the field, but it has one glaring, low-effort gap versus every comparable tool — zero token/cost telemetry — plus a real but fixable latency mismatch between its 2s dashboard refresh and its 15s dispatch loop, and a handful of UI/UX rough edges (no dark mode, leftover debug UI, no history/audit trail on tasks).

## Research Questions
- What does tmux-conductor currently do well and poorly across latency, observability, UI/UX, task management, agent management, and project management?
- Which popular multi-agent coding orchestrator tools compete in this space, and what do they do that tmux-conductor doesn't?
- What are the concrete, prioritized gaps, what would it take to close each, and what benefit would result?

## Current State (Codebase)

**Latency**
- Dashboard status refresh: `host-server/index.ts` self-throttling loops — status poll 2s (diff-broadcast via SSE only on change), background terminal tail 2s, **focused** terminal tail 250ms with a dedicated per-agent WebSocket (`/agents/:id/terminal/ws`) and SSE fallback [S1].
- Real dispatch loop (`scripts/monitor.sh`) polls at a separate, coarser 15s default (`POLL_INTERVAL`, `conductor.conf`) — a task can sit ready-to-run for up to 15s even though the dashboard shows the agent "idle" within 2s, because status-detection (host-server) and task-dispatch (monitor.sh) are two independent, differently-paced loops [S1].
- Recent commits (`3ea7ea9`, `7d1d895`, `53152c4`) added real instrumentation (Node event-loop delay, per-loop timing/backoff, a dedicated terminal WebSocket transport) and fixed xterm init/race bugs, but `perfBudgets.ts` thresholds are explicitly unvalidated placeholders, and all tmux calls are synchronous (`spawnSync`/`execSync`, 100ms timeout) — a known event-loop-blocking risk the new instrumentation exists to catch, not yet prevent [S1].

**Observability**
- Three append-only JSONL logs (`dispatch.jsonl`, `hooks.jsonl`, `observability.jsonl`) with no viewer/aggregation UI — raw `tail -f` or `scripts/collect-diagnostics.sh` is the only way to read them; no rotation/retention policy [S1].
- `/api/perf/live-updates` exposes rich in-memory metrics (SSE timing, tmux op timing, event-loop percentiles) but it's a debug endpoint only — resets on restart, never persisted, not surfaced anywhere in the dashboard UI [S1].
- **Zero token/cost telemetry.** `host-server/context.ts` parses transcript JSONL only for context-window fill %; there is no spend/usage tracking despite `USAGE_CHECK_CMD` hinting the concern already exists [S1].
- A latency-debug panel (`LogTail.tsx`'s ack/echo timings) and a `window.__focusedTerminalLatencyBaseline` benchmarking hook are shipped to end users in production UI — leftover dev instrumentation [S2].

**UI/UX**
- Hand-rolled Tailwind design system (no component library), React 19 + react-router + `@dnd-kit` + `@xterm/xterm`. Three routes: dashboard, projects list, project detail [S2].
- Main dashboard is a 3-column Kanban (Waiting/Stalled, Busy, Ready) grouped by project, with color-coded status badges and audio cues (doorbell/chime) on attention-needed and completion transitions — a genuine differentiator [S2].
- Interact mode: xterm.js pane mirror + hybrid WebSocket/SSE/REST input transport, direct-keystroke send, image drag/drop/paste [S2].
- Gaps: no dark mode, no mobile/responsive polish, native `window.confirm()` for destructive actions (inconsistent with the custom design), no search/filter as agent count grows, no toast system, and the debug latency panel mentioned above is visible in the shipped UI [S2].

**Task Management**
- SQL-backed queue (`tasks` table), agent-scoped / project-scoped / global, float `position` for O(1) reordering, drag-reorder + jump-to-head in the UI [S3].
- No priority, tags, due dates, or dependencies — tasks are flat ordered command strings. Tasks are **hard-deleted** on pop, so there is no completed-task history or audit trail beyond raw `dispatch.jsonl`. No cross-project/global task board [S3].

**Agent Management**
- Solid state machine (`no-window/exited/idle/busy/awaiting/stalled/starting/unknown`) derived from a layered evidence chain (window presence → pane shell fallback → hook state file → pane regex) [S3].
- Interact mode (direct keys, image upload) is a strong, working feature. No agent roles/grouping beyond a flat list plus optional project membership; no capacity/queue-depth alerting beyond the single `needsAttention` badge [S3].

**Project Management**
- First-class `projects` table; agents optionally belong to one, auto-numbered (`myproj-1`, `myproj-2`); tasks/schedules can be project-scoped. A working cron-like scheduler (`schedules` table) injects recurring tasks [S3].
- No per-project settings beyond workdir + launch command (no env vars/secrets), no project-level dashboards/metrics, no archiving [S3].

## Key Findings — Competitive Landscape

| Tool | Model | Standout capability relevant to our gaps |
|---|---|---|
| **Claude Code native Agent Teams** | Built-in, free | Shared task list **with dependency blocking**, direct teammate messaging, quality-gate hooks (`TeammateIdle`/`TaskCreated`/`TaskCompleted`), plan-approval workflow. Experimental, single-session only, no cross-session/project dashboard [S4]. |
| **Claude Squad** (smtg-ai, AGPL) | TUI + git worktrees | Very fast parallel session launch (~5s for 6 sessions), review-before-apply gate. No cross-agent messaging, no Windows support [S5]. |
| **Conductor** (Melty Labs) | Mac desktop app | Checkpoints/rollback, multi-model side-by-side (same prompt to Claude + Codex), diff viewer + PR flow. Token cost multiplies with agent count; agents have no persistent memory across sessions [S6]. |
| **Crystal → Nimbalyst** (Stravu) | Electron desktop | Git worktree isolation with built-in rebase/squash workflow, commit-level diff stats, kanban + multi-editor (mockups/diagrams). Crystal deprecated Feb 2026, replaced by Nimbalyst [S7]. |
| **Vibe Kanban** | Free, web dashboard | True kanban board (To Do/In Progress/Review/Done), MCP-driven task decomposition, virtualized diff review for 300+ file PRs, desktop notifications. Community-maintained post-Bloop-shutdown; disk bloat from worktrees [S8]. |
| **AgentsRoom** | Electron desktop | Grid dashboard, **role-based color coding** (Frontend/Backend/QA/DevOps/Security), sub-second (**<1s**) status refresh, project-switch sidebar, native PTY avoids browser latency [S9]. |
| **NTM** (Named Tmux Manager) | Free OSS TUI | **Token-velocity badges** per agent (burn-rate anomaly detection — spots a looping agent vs. one making progress), file-level conflict/reservation locks, **context-compaction detection** (flags silent context loss) [S10]. |
| **OTel ecosystem** (ccusage, SigNoz, Claude Code Usage Monitor) | Native Claude Code feature + 3rd-party | Claude Code natively exports OTel metrics/traces/logs (`claude_code.token.usage`, `claude_code.cost.usage`) when `CLAUDE_CODE_ENABLE_TELEMETRY=1` is set [S11]; `ccusage` parses local transcript JSONL with zero network calls for cost/session reports [S12]. **tmux-conductor taps none of this**, despite already parsing the same transcripts for context %. |
| Composio / Emdash / Baton / Bernstein / Agent Kanban | Mixed CLI/web | Mostly GitHub-issue-driven queues; Bernstein's "Janitor" pre-merge quality gate and deterministic task-graph scheduling are the most novel task-management idea in the set [S5]. |

Industry trend: WebSocket adoption for agent dashboards is accelerating — Vercel, Cline, and Cursor each report ~30–40% latency reduction moving off pure request/response SSE for bidirectional control [S13]. tmux-conductor's existing hybrid WS(focused)/SSE(background)/REST(fallback) terminal transport is already aligned with this trend — the gap is on the *dispatch* side, not the terminal-mirroring side.

## Constraints

- Local-first, single-user tool with no auth model — any recommendation involving remote telemetry export (e.g. full OTel-to-cloud pipelines) should stay opt-in and local-first by default, consistent with the existing `USAGE_CHECK_CMD` and transcript-parsing patterns.
- `host-server/context.ts` already parses Claude Code transcript JSONL for context %, so token/cost telemetry should extend that existing parser rather than introduce a second transcript reader.
- `monitor.sh` (bash) and `host-server` (Node/TypeScript) are two independent processes today; any latency fix that "collapses" the dispatch loop into host-server changes which process owns dispatch — an architecturally significant decision, not a pure bug fix.
- Vendor-agnostic design (Claude Code, Codex, Aider, etc.) constrains how deep a Claude-specific integration (like native OTel export) can go without a fallback path for non-Claude agents.

## Solution Comparison

Not applicable in the traditional sense — this research produced a prioritized gap list rather than a single design decision with mutually exclusive options. See Recommendation below for priority ordering and effort/benefit per gap.

## Recommendation

Priority-ordered, effort vs. benefit:

**1. Observability — zero token/cost telemetry (highest value, lowest effort)**
Every comparable ecosystem tool (ccusage, Claude Code's native OTel export, SigNoz, NTM's token-velocity badges) centers on this capability; tmux-conductor already has the closest infrastructure (`context.ts` transcript parsing, `USAGE_CHECK_CMD`) but computes none of it. Extend `context.ts`'s transcript parsing to also sum token/cost per agent per session (ccusage-style, no network calls needed), surfaced as a lightweight per-agent badge (à la NTM's burn-rate) plus an aggregate view. A fuller version would enable `CLAUDE_CODE_ENABLE_TELEMETRY` and sink OTLP into a local store. **Benefit:** closes the single most consistent gap vs. the entire competitive set; also yields a "runaway/looping agent" signal that today only exists as a manual pane-glance.

**2. Latency — collapse the two dispatch loops**
`monitor.sh`'s 15s `POLL_INTERVAL` dispatch cadence is ~7x coarser than the host-server's 2s status detection. Move dispatch triggering into the host-server's existing 2s status-poll loop (event-driven on idle transition) instead of a second independent bash poll, reusing the existing `mark_busy` race-closing pattern; needs care to avoid double-dispatch. **Benefit:** cuts real dispatch latency from ~15s worst-case to ~2s, matching the sub-second responsiveness competitors like AgentsRoom advertise, without new infrastructure.

**3. Observability — validate perf budgets and surface them**
`perfBudgets.ts` thresholds are unvalidated placeholders; `/api/perf/live-updates` is in-memory-only and invisible in the UI. Periodically snapshot `liveUpdateMetrics` into the existing `observability.jsonl`, backfill real thresholds from a week of production data, add a minimal "Perf" panel reading recent entries. **Benefit:** turns already-built instrumentation into an actual regression-detection tool instead of a debug-only endpoint that resets on every restart.

**4. UI/UX cleanup**
Gate the LogTail ack/echo debug panel and `window.__focusedTerminalLatencyBaseline` hook behind a dev-only flag; replace `window.confirm()` with the app's existing modal styling; add dark mode (tokens are already centrally defined in `tailwind.config.js`); add a text filter to `AgentList` before agent count becomes a scaling problem. **Benefit:** removes visible rough edges/leftover dev artifacts; dark mode and search/filter are table stakes among desktop competitors (Conductor, Nimbalyst, AgentsRoom) for a tool used for hours at a stretch.

**5. Task management — soft-delete + history view**
Tasks are hard-deleted on pop, so there's no audit trail beyond raw `dispatch.jsonl`. Change pop to a soft status flip (`status='done'`, `completed_at`) instead of `DELETE`, add a simple history view — the low-effort end of what Agent Teams' dependency-aware task list and Vibe Kanban's board already give their users. **Benefit:** meaningful debugging value ("what did agent X actually run today") without building a full dependency graph.

**6/7. Agent roles & per-project settings — lower priority**
AgentsRoom-style role/color grouping and richer per-project settings (env vars, dashboards, archiving) are real gaps vs. some competitors, but they cut against tmux-conductor's stated local-first, single-user simplicity, and no codebase exploration surfaced user-facing pain tied to their absence today. Recommend leaving these as backlog candidates rather than near-term work.

### Risks and mitigations
- Collapsing the dispatch loop (#2) risks double-dispatch races; mitigate by reusing the existing `mark_busy` pre-dispatch marker pattern that already closes an analogous race.
- Token/cost telemetry (#1) risks becoming a second source of truth if it diverges from Claude Code's own accounting; mitigate by treating it as an estimate (as ccusage does) rather than a billing-grade figure.

### Alternative if constraints change
If the tool moves toward multi-user or team use, agent roles/grouping (#6) and per-project settings/archiving (#7) would move up in priority, since AgentsRoom's role-based coordination and Zenflow's per-project isolation both target team-scale usage that tmux-conductor's current single-user design doesn't need.

## Next Steps

- Run `/roadmap-create` using this gap list to produce a structured execution-plan roadmap (requested by the user in place of direct implementation).
- Run `/wiki-ingest raw/research/comprehensive-app-audit/index.md` to fold this into the knowledge base.
- Consider a `/decision-create` for gap #2 (dispatch-loop ownership) since it changes which process (`monitor.sh` vs. host-server) owns dispatch — an architecturally significant call.
