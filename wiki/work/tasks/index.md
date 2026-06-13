---
title: Tasks Index
updated: 2026-06-12
---

# Tasks — Active Items

Lists **only active** tasks (`todo`, `in-progress`). When a task leaves the active set (`done`, `trashed`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [TASK-NNN — Title](TASK-NNN-slug.md) — one-line summary · status`

- [TASK-001 — Skill detection — backend scanner + dashboard surfacing](TASK-001-skill-detection.md) — scan ~/.claude/skills + per-agent project skills, expose GET /skills and GET /agents/:agent/skills, render in AgentDetailModal · in-progress
- [TASK-011 — Immediate dispatch for tasks enqueued to an idle agent with an empty queue](TASK-011-immediate-dispatch.md) — backend fast-path on the task-add routes: idle + no pending tasks → send-keys now instead of waiting for the monitor poll · in-progress
- [TASK-012 — Replace tail polling with SSE push for terminal output](TASK-012-sse-tail-stream.md) — replace LogTail.tsx interval polling with backend tailPollLoop broadcasting terminal-output events over existing GET /events SSE stream · in-progress
- [TASK-023 — Delete dead conf-splice + legacy file-queue code from backend/config.ts and backend/state.ts](TASK-023-remove-legacy-conf-queue-code-backend.md) — ROADMAP-001 Phase 5 cutover: delete dead AGENTS conf-splice helpers, migrate countQueuedTasks callers to listTasksForAgent, drop superseded flat-file /queue routes, remove orphaned file-queue fns; gate on make typecheck · todo
- [TASK-029 — Postgres migration 001 — users, devices (hashed tokens), pairing_codes](TASK-029-portal-pg-migration-001.md) — author portal/migrations/001_init.sql (pgcrypto, users/devices/pairing_codes, partial active-device index) for the TASK-027 portal migrate.ts runner · todo
- [TASK-024 — Strip AGENTS/BG_PROCESSES/AGENT_BG_LINKS/TASK_QUEUE from conductor.conf and retire tasks.txt](TASK-024-strip-legacy-conf-keys-retire-tasks-txt.md) — ROADMAP-001 Phase 5 cutover: delete the four DB-migrated data blocks from conductor.conf (tuning-only), remove tasks.txt/tasks.backlog.txt + their spawn-script/docker/backend-seed plumbing, sync live docs; gated on TASK-023 · todo
- [TASK-026 — Run the end-to-end SQLite-migration verification suite](TASK-026-e2e-verification-suite.md) — ROADMAP-001 Phase 5 final cutover task: scripts/verify-sqlite-migration.sh covering seed, pop race, fake dispatch, schedule fire, backlog restore, each with explicit pass criteria · todo
- [TASK-030 — Portal Google OIDC sign-in, JWT session cookie, email allowlist, /api/me](TASK-030-portal-google-oidc-session-allowlist.md) — openid-client v6 OIDC flow + stateless HS256 tc_session cookie + ALLOWLIST_EMAILS snapshot to users.is_allowed + Origin/Sec-Fetch-Site guards + GET /api/me · todo
- [TASK-025 — Update docker-compose mounts, Dockerfile native-build step, and docs for the SQLite data layer](TASK-025-update-docker-dockerfile-docs.md) — ROADMAP-001 Phase 5 cutover: mount ./data + drop tasks.txt in docker-compose, add python3/make/g++ toolchain so better-sqlite3 compiles on node:22-alpine, rewrite README/CLAUDE/scripts docs off the tasks.txt + conf-array model · todo
- [TASK-027 — Scaffold portal/ (Fastify, env validation, pg Pool, boot-time migrations) with /healthz](TASK-027-scaffold-portal-foundation.md) — new top-level portal/ boot skeleton: Fastify 5 + tsx, tiered env validation, pg Pool (DO self-signed SSL), advisory-locked idempotent migration runner, GET /healthz · todo
- [TASK-028 — Dockerfile.portal + deploy/do-app.yaml (DO App Platform spec)](TASK-028-portal-dockerfile-do-app-deploy.md) — author the portal Docker image + DO App spec (single-instance, dev Postgres, /healthz, OAuth secrets) + deploy/README runbook; live deploy + Google OAuth client are deferred manual steps · todo
