---
title: Tasks Index
updated: 2026-06-11
---

# Tasks — Active Items

Lists **only active** tasks (`todo`, `in-progress`). When a task leaves the active set (`done`, `trashed`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [TASK-NNN — Title](TASK-NNN-slug.md) — one-line summary · status`

- [TASK-001 — Skill detection — backend scanner + dashboard surfacing](TASK-001-skill-detection.md) — scan ~/.claude/skills + per-agent project skills, expose GET /skills and GET /agents/:agent/skills, render in AgentDetailModal · todo
- [TASK-009 — Create scripts/lib/db.sh — sql wrapper, load_agents, load_bg, pop_task_sql](TASK-009-scripts-lib-db-sh.md) — shared SQLite helper library for shell scripts · todo
- [TASK-010 — Rewrite monitor.sh pop_task as atomic SQL pop and move_to_backlog as status flip](TASK-010-monitor-sh-db.md) — migrate monitor queue ops to SQLite, load_agents inside poll loop · todo
- [TASK-011 — Immediate dispatch for tasks enqueued to an idle agent with an empty queue](TASK-011-immediate-dispatch.md) — backend fast-path on the task-add routes: idle + no pending tasks → send-keys now instead of waiting for the monitor poll · todo
