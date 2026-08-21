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
- [UAT-076 — UAT: Per-session usage breakdown — GET /agents/:id/usage endpoint + session table in AgentDetailModal](UAT-076-usage-session-breakdown-ui.md) — verifies TASK-076 · pending
- [UAT-109 — UAT: History toggle — switch LogTail between live SSE and persisted terminal log](UAT-109-logtail-history-toggle.md) — verifies TASK-109 · pending
- [UAT-110 — UAT: Session boundary markers — per-chunk timestamp dividers in LogTail history view](UAT-110-logtail-history-timestamp-markers.md) — verifies TASK-110 · pending
- [UAT-114 — UAT: Role badge — colour-coded role badge on the agent card in the dashboard](UAT-114-role-badge-ui.md) — verifies TASK-114 · pending
- [UAT-115 — UAT: Role selector — dropdown in AddAgentForm and the project-spawn UI in ProjectList](UAT-115-role-selector-ui.md) — verifies TASK-115 · pending
- [UAT-119 — UAT: Persist periodic liveUpdateMetrics snapshots to observability.jsonl so metrics survive a host-server restart](UAT-119-persist-metrics-snapshots.md) — verifies TASK-119 · pending
- [UAT-123 — UAT: Replace window.confirm() destructive-action dialogs with the app's custom modal styling](UAT-123-replace-confirm-dialogs.md) — verifies TASK-123 · pending
- [UAT-124 — UAT: AgentList text filter — scale the dashboard past small agent counts](UAT-124-agentlist-text-filter.md) — verifies TASK-124 · pending
- [UAT-130 — UAT: Dynamic tmux pane sizing from the browser terminal's full-width probe](UAT-130-dynamic-terminal-pane-sizing.md) — verifies TASK-130 · pending