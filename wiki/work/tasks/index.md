---
title: Tasks Index
updated: 2026-06-13
---

# Tasks — Active Items

Lists **only active** tasks (`todo`, `in-progress`). When a task leaves the active set (`done`, `trashed`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [TASK-NNN — Title](TASK-NNN-slug.md) — one-line summary · status`

- [TASK-001 — Skill detection — backend scanner + dashboard surfacing](TASK-001-skill-detection.md) — scan ~/.claude/skills + per-agent project skills, expose GET /skills and GET /agents/:agent/skills, render in AgentDetailModal · in-progress
- [TASK-011 — Immediate dispatch for tasks enqueued to an idle agent with an empty queue](TASK-011-immediate-dispatch.md) — backend fast-path on the task-add routes: idle + no pending tasks → send-keys now instead of waiting for the monitor poll · in-progress
- [TASK-012 — Replace tail polling with SSE push for terminal output](TASK-012-sse-tail-stream.md) — replace LogTail.tsx interval polling with backend tailPollLoop broadcasting terminal-output events over existing GET /events SSE stream · in-progress
- [TASK-031 — Portal pairing-code creation API + rate-limited /pair/redeem (hashed, single-use, 10-min expiry)](TASK-031-portal-pairing-code-api-redeem.md) — POST /api/pair/code (Crockford base32, ≤5 outstanding, stored hashed) + POST /api/pair/redeem (atomic single-use, creates device + one-time token) · todo
- [TASK-032 — daemon/pair.ts + daemon/credentials.ts; conductor pair / conductor unpair CLI](TASK-032-daemon-pair-credentials-cli.md) — local daemon pairing flow: persist device token to device.json, pair/unpair subcommands, atomic write + chmod 600 · todo
- [TASK-033 — Portal Devices API: list with connected flag, rename, revoke](TASK-033-portal-devices-api.md) — GET/PATCH/DELETE /api/devices with ownership-404, connected flag stub (real in Phase 4), revoke closes live relay connection · todo
- [TASK-035 — Portal WS relay endpoint, connection registry, and request mux](TASK-035-portal-ws-relay-endpoint-registry-mux.md) — GET /relay/:deviceId WS upgrade (device-token auth), in-memory registry, HTTP→WS mux with in-flight caps/timeouts/fail-on-drop · todo
