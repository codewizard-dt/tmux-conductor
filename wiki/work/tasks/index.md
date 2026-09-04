---
title: Tasks Index
updated: 2026-08-27
---

# Tasks — Active Items

Lists **only active** tasks (`todo`, `in-progress`). When a task leaves the active set (`done`, `trashed`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [TASK-NNN — Title](TASK-NNN-slug.md) — one-line summary · status`

- [TASK-001 — Skill detection — backend scanner + dashboard surfacing](TASK-001-skill-detection.md) — scan ~/.claude/skills + per-agent project skills, expose GET /skills and GET /agents/:agent/skills, render in AgentDetailModal · in-progress
- [TASK-011 — Immediate dispatch for tasks enqueued to an idle agent with an empty queue](TASK-011-immediate-dispatch.md) — backend fast-path on the task-add routes: idle + no pending tasks → send-keys now instead of waiting for the monitor poll · in-progress
- [TASK-012 — Replace tail polling with SSE push for terminal output](TASK-012-sse-tail-stream.md) — replace LogTail.tsx interval polling with backend tailPollLoop broadcasting terminal-output events over existing GET /events SSE stream · in-progress
- [TASK-050 — App Platform live deploy runbook](TASK-050-app-platform-live-deploy-runbook.md) — manual cloud steps: OWNER in deploy/app.yaml, secrets, Google OAuth client, migrations, /healthz verify, gated first signup · todo
- [TASK-128 — monitor.sh single-instance startup guard — PID lockfile keyed on STATE_DIR](TASK-128-monitor-single-instance-lock.md) — prevents a real dispatch.sh send-keys/sleep-0.3/Enter keystroke-interleaving race between two concurrent monitor.sh instances; fail-open on any ambiguous liveness/identity check · todo
- [TASK-129 — Port isolation for scripts/verify-sqlite-migration.sh — stop the readiness probe from false-positiving against a live dev host-server](TASK-129-verify-script-port-isolation.md) — parameterize the hardcoded :8788 (16 call sites) to a scratch VERIFY_PORT default + verify the spawned PID actually owns the port instead of trusting an HTTP 200 alone · todo
- [TASK-130 — Dynamic tmux pane sizing from the browser terminal's full-width probe](TASK-130-dynamic-terminal-pane-sizing.md) — hidden xterm.js probe mirroring the expanded-modal's real width posts cols/rows to a new POST /api/terminal-size on first render + on resize; backend resizes every existing tmux window globally · pending-uat
- [TASK-132 — Fix context-window limit lookup in host-server/context.ts](TASK-132-context-window-limit-accuracy.md) — exact-model-ID context-window table (fixes Sonnet 5's false 200k assumption) + contextLimitConfident flag so an unrecognized model renders as "unconfirmed" instead of a silently-wrong percentage · todo
- [TASK-133 — Investigate BUG-0001 and wire a Notification-driven sentinel gate for background-agent-in-flight dispatch](TASK-133-sentinel-gate-background-agent-dispatch.md) — re-add a narrow on-notification.js hook to confirm agent_needs_input/agent_completed payload shapes live, then gate scripts/monitor.sh's dispatch call site on a per-agent pending-background-agent sentinel with a generous staleness fallback · todo
- [TASK-134 — Clone button in AgentDetailModal](TASK-134-clone-agent-button.md) — POST /agents/:id/clone derives a unique -copy name and mirrors the source agent's worktree setting via createAgent(); new Clone button in the modal header action row · todo
- [TASK-135 — Dark-mode sweep — replace remaining hardcoded bg-white/surface literals across every page and component](TASK-135-dark-mode-hardcoded-surface-sweep.md) — closes TASK-122's own flagged gap; same defect class as BUG-0007/BUG-0008 across ~15 files, verified live per-page with Playwright · pending-uat
