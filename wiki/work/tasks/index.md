---
title: Tasks Index
updated: 2026-06-14
---

# Tasks — Active Items

Lists **only active** tasks (`todo`, `in-progress`). When a task leaves the active set (`done`, `trashed`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [TASK-NNN — Title](TASK-NNN-slug.md) — one-line summary · status`

- [TASK-001 — Skill detection — backend scanner + dashboard surfacing](TASK-001-skill-detection.md) — scan ~/.claude/skills + per-agent project skills, expose GET /skills and GET /agents/:agent/skills, render in AgentDetailModal · in-progress
- [TASK-011 — Immediate dispatch for tasks enqueued to an idle agent with an empty queue](TASK-011-immediate-dispatch.md) — backend fast-path on the task-add routes: idle + no pending tasks → send-keys now instead of waiting for the monitor poll · in-progress
- [TASK-012 — Replace tail polling with SSE push for terminal output](TASK-012-sse-tail-stream.md) — replace LogTail.tsx interval polling with backend tailPollLoop broadcasting terminal-output events over existing GET /events SSE stream · in-progress
- [TASK-050 — App Platform live deploy runbook](TASK-050-app-platform-live-deploy-runbook.md) — manual cloud steps: OWNER in deploy/app.yaml, secrets, Google OAuth client, migrations, /healthz verify, gated first signup · todo
- [TASK-060 — agents table schema — add worktree_path and branch columns](TASK-060-agents-worktree-schema.md) — ALTER TABLE agents to add worktree_path TEXT and branch TEXT; update TS types · todo
- [TASK-061 — Worktree spawn — detect git repo on agent spawn, create worktree + branch, store in DB](TASK-061-worktree-spawn.md) — git worktree add on spawn; UPDATE agents row; skip non-git workdirs silently · todo
- [TASK-062 — Branch badge — display branch name on agent card in dashboard](TASK-062-branch-badge-ui.md) — expose branch in API response; render branch chip on agent cards · todo
- [TASK-063 — Worktree teardown — git worktree remove --force on agent delete](TASK-063-worktree-teardown.md) — clean up worktree directory (and optionally branch) before DB delete · todo
- [TASK-064 — Diff endpoint — GET /api/agents/:agent/diff](TASK-064-diff-endpoint.md) — runs git diff base-branch..HEAD in the worktree; returns unified diff JSON · todo
- [TASK-065 — Base-branch endpoint — GET /api/agents/:agent/base-branch](TASK-065-base-branch-endpoint.md) — auto-detect default branch via origin/HEAD then common names; shared helper · todo
- [TASK-066 — Diff panel UI — unified diff in AgentDetailModal](TASK-066-diff-panel-ui.md) — DiffPanel component with colour-coded additions/deletions; wired into agent detail · todo
- [TASK-067 — agent_checkpoints table — SQLite schema migration](TASK-067-agent-checkpoints-table.md) — CREATE TABLE agent_checkpoints (agent_id, ts, stash_ref) + DB helpers · todo
- [TASK-068 — Pre-dispatch checkpoint — git stash push before each task dispatch](TASK-068-pre-dispatch-checkpoint.md) — stash snapshot in monitor.sh and host-server fast-path; record in agent_checkpoints · todo
- [TASK-069 — Checkpoints list endpoint — GET /api/agents/:agent/checkpoints](TASK-069-checkpoints-list-endpoint.md) — list checkpoint rows by agent ordered DESC; also POST to create from shell side · todo
- [TASK-070 — Rollback endpoint — POST /api/agents/:agent/rollback](TASK-070-rollback-endpoint.md) — git stash apply <stash_ref> in worktree for the selected checkpoint · todo
- [TASK-071 — Checkpoint UI — AgentDetailModal checkpoint list + rollback button](TASK-071-checkpoint-ui.md) — CheckpointList component with timestamps + per-checkpoint rollback button · todo
