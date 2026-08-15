---
title: Tasks Index
updated: 2026-07-06
---

# Tasks — Active Items

Lists **only active** tasks (`todo`, `in-progress`). When a task leaves the active set (`done`, `trashed`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [TASK-NNN — Title](TASK-NNN-slug.md) — one-line summary · status`

- [TASK-001 — Skill detection — backend scanner + dashboard surfacing](TASK-001-skill-detection.md) — scan ~/.claude/skills + per-agent project skills, expose GET /skills and GET /agents/:agent/skills, render in AgentDetailModal · in-progress
- [TASK-011 — Immediate dispatch for tasks enqueued to an idle agent with an empty queue](TASK-011-immediate-dispatch.md) — backend fast-path on the task-add routes: idle + no pending tasks → send-keys now instead of waiting for the monitor poll · in-progress
- [TASK-012 — Replace tail polling with SSE push for terminal output](TASK-012-sse-tail-stream.md) — replace LogTail.tsx interval polling with backend tailPollLoop broadcasting terminal-output events over existing GET /events SSE stream · in-progress
- [TASK-050 — App Platform live deploy runbook](TASK-050-app-platform-live-deploy-runbook.md) — manual cloud steps: OWNER in deploy/app.yaml, secrets, Google OAuth client, migrations, /healthz verify, gated first signup · todo
- [TASK-062 — Branch badge — display branch name on agent card in dashboard](TASK-062-branch-badge-ui.md) — expose branch in API response; render branch chip on agent cards · pending-uat
- [TASK-063 — Worktree teardown — git worktree remove --force on agent delete](TASK-063-worktree-teardown.md) — clean up worktree directory (and optionally branch) before DB delete · pending-uat
- [TASK-066 — Diff panel UI — unified diff in AgentDetailModal](TASK-066-diff-panel-ui.md) — DiffPanel component with colour-coded additions/deletions; wired into agent detail · pending-uat
- [TASK-068 — Pre-dispatch checkpoint — git stash push before each task dispatch](TASK-068-pre-dispatch-checkpoint.md) — stash snapshot in monitor.sh and host-server fast-path; record in agent_checkpoints · pending-uat
- [TASK-070 — Rollback endpoint — POST /api/agents/:agent/rollback](TASK-070-rollback-endpoint.md) — git stash apply <stash_ref> in worktree for the selected checkpoint · pending-uat
- [TASK-071 — Checkpoint UI — AgentDetailModal checkpoint list + rollback button](TASK-071-checkpoint-ui.md) — CheckpointList component with timestamps + per-checkpoint rollback button · todo
- [TASK-074 — Token/cost badge — compact usage badge on agent card header in dashboard](TASK-074-usage-badge-ui.md) — UsageBadge chip ($X.XX · NNk) in AgentItem Row 1 reading usage totals from the agents payload; hidden when no data · in-progress
- [TASK-075 — Accumulate rolling token totals per agent in agent_usage](TASK-075-usage-accumulation.md) — new usage-store.ts + pricing.ts: fold UsageDeltas into absolute per-session totals, ccusage-auto cost math, idempotent upserts, expose usage totals on snapshot agents payload · pending-uat
- [TASK-076 — Per-session usage breakdown — GET /agents/:id/usage endpoint + session table in AgentDetailModal](TASK-076-usage-session-breakdown-ui.md) — thin route over listAgentUsage + collapsible Usage section in the detail modal: one row per session (start, in/out/cache tokens, cost) with totals footer · in-progress
- [TASK-109 — History toggle — switch LogTail between live SSE and persisted terminal log](TASK-109-logtail-history-toggle.md) — Live/History segmented toggle in LogTail.tsx header; History mode fetches GET /agents/:id/log and renders chunks oldest-first as plain monospace blocks, xterm terminal hidden not disposed · todo
- [TASK-110 — Session boundary markers — per-chunk timestamp dividers in LogTail history view](TASK-110-logtail-history-timestamp-markers.md) — render a formatted entry.ts divider above each chunk in LogTail's History view; depends on TASK-109 (unmerged as of creation — hard blocker) · todo
