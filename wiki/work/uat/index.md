---
title: UAT Index
updated: 2026-07-06
---

# UAT — Active Items

Lists **only active** UAT files (`pending`, `in-progress`, `failed`). When a UAT leaves the active set (`passed`, `skipped`, `trashed`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [UAT-NNN — Title](UAT-NNN-slug.md) — verifies TASK-NNN · status`

- [UAT-001 — UAT: Skill detection — backend scanner + dashboard surfacing](UAT-001-skill-detection.md) — verifies TASK-001 · pending
- [UAT-005 — UAT: DB-backed agent and bg-process routes with spawnAgentWindow helper](UAT-005-backend-routes-db.md) — verifies TASK-005 · pending
- [UAT-006 — UAT: ID-based /api/tasks routes and SSE events](UAT-006-task-queue-routes.md) — verifies TASK-006 · pending
- [UAT-011 — UAT: Immediate dispatch for tasks enqueued to an idle agent with an empty queue](UAT-011-immediate-dispatch.md) — verifies TASK-011 · pending
- [UAT-012 — UAT: Replace tail polling with SSE push for terminal output](UAT-012-sse-tail-stream.md) — verifies TASK-012 · pending
- [UAT-066 — UAT: Diff panel UI — unified diff in AgentDetailModal (colour-coded additions/deletions)](UAT-066-diff-panel-ui.md) — verifies TASK-066 · pending
- [UAT-071 — UAT: Checkpoint UI — AgentDetailModal checkpoint list with timestamps + per-checkpoint rollback button](UAT-071-checkpoint-ui.md) — verifies TASK-071 · pending
- [UAT-074 — UAT: Token/cost badge — compact usage badge on agent card header in dashboard](UAT-074-usage-badge-ui.md) — verifies TASK-074 · pending
- [UAT-114 — UAT: Role badge — colour-coded role badge on the agent card in the dashboard](UAT-114-role-badge-ui.md) — verifies TASK-114 · pending
- [UAT-119 — UAT: Persist periodic liveUpdateMetrics snapshots to observability.jsonl so metrics survive a host-server restart](UAT-119-persist-metrics-snapshots.md) — verifies TASK-119 · pending
- [UAT-120 — UAT: Collapse monitor.sh's 15s dispatch loop into the host-server's 2s status-poll loop](UAT-120-collapse-dispatch-into-status-poll.md) — verifies TASK-120 · pending
- [UAT-121 — UAT: Remove monitor.sh's now-redundant dispatch block, reusing mark_busy to prevent double-dispatch races](UAT-121-remove-redundant-monitor-dispatch.md) — verifies TASK-121 · pending
- [UAT-122 — UAT: Dashboard dark mode — theme toggle over the Tailwind color tokens](UAT-122-dashboard-dark-mode.md) — verifies TASK-122 · pending
- [UAT-124 — UAT: AgentList text filter — scale the dashboard past small agent counts](UAT-124-agentlist-text-filter.md) — verifies TASK-124 · pending
- [UAT-130 — UAT: Dynamic tmux pane sizing from the browser terminal's full-width probe](UAT-130-dynamic-terminal-pane-sizing.md) — verifies TASK-130 · pending
- [UAT-126 — UAT: Task history view — dashboard page reading completed tasks](UAT-126-task-history-view.md) — verifies TASK-126 · pending