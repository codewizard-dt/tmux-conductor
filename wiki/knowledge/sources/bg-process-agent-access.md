---
id: bg-process-agent-access
title: "Project-Linked Background Processes That Every Project Agent Can Inspect and Restart"
aliases: [bg-process-agent-access]
updated: 2026-09-19
sources:
  - ../../../raw/research/bg-process-agent-access/index.md
  - ../../../raw/research/bg-process-agent-access/sources.md
confidence: inferred
tags: [bg-processes, host-server, skills, project-scoping, tmux]
---

# Project-Linked Background Processes That Every Project Agent Can Inspect and Restart

Follow-up to [[Background Process Registry (bg_processes) — Mechanism and Gaps]] and [[bg_processes Project Scoping — Migration and Endpoint Shape (ROADMAP-020 Phase 2)]], asked after ROADMAP-020 closed. **"Link a bg process to a project" is already done at the data layer** (`bg_processes.project_id`, `GET /projects/:id/bg-processes`, project selector and grouping in the UI, and the agent-facing `dev-commands` skill with `list`/`status`/`tail`). What is missing is the agent-facing half: any agent in the project inspecting output and restarting the process.

**Three gaps, all confirmed against live code.** (1) **No restart primitive**: the only bg routes are separate open/close-window calls, and `POST /bg-processes/:name/window` returns 409 when the window exists, so a restart is two non-atomic calls that no UI or script makes. (2) **The skill is project-blind**: `dev-commands.sh list` prints every bg process, and agents get no project identifier in their env (only `CONDUCTOR_AGENT_NAME`, `CONDUCTOR_STATE_DIR`, `CONDUCTOR_LOG_DIR`). (3) **"alive" only means the tmux window exists**: a crashed dev server that falls back to the shell prompt still reads `alive` (an inference from the spawn shape, since the launch command is typed into a persistent shell), which undermines "restart if necessary". Also noted: the log is raw `pipe-pane` bytes (ANSI escapes, unbounded growth, no restart boundary), `SKILL.md` documents an idle/busy/running vocabulary that `monitor.sh` never writes (only `alive`/`dead`), and the window-open route interpolates `launchCmd` inside literal double quotes, a quoting fragility that agent-triggered restarts would exercise far more.

**Recommendation (Option A)**: one server-side `POST /bg-processes/:name/restart`, a real liveness signal (`running`/`exited` via `pane_current_command`, matching the agent-liveness rule), caller→project resolution on the server from `CONDUCTOR_AGENT_NAME` (works for already-running agents, unlike a spawn-time env var), a project-scoped guard plus cooldown and audit log for restarts, then a `dev-commands.sh restart` subcommand, project-filtered `list`, and a dashboard Restart button. `tmux respawn-window -k` is a candidate mechanism but whether `pipe-pane` survives a respawn is **unverified** and needs a spike. Open decisions: policy for legacy `NULL project_id` rows, fate of the single-agent `linked_agent_id`, and per-project name uniqueness (bg names and log/state filenames are globally unique today).

Full report: `raw/research/bg-process-agent-access/index.md` (sources: `raw/research/bg-process-agent-access/sources.md`).

derived_from::[[Background Process Registry (bg_processes) — Mechanism and Gaps]]
relates_to::[[bg_processes Project Scoping — Migration and Endpoint Shape (ROADMAP-020 Phase 2)]]
relates_to::[[Shared, Project-Scoped Dev Commands for Agents]]
relates_to::[[Host Server]]
relates_to::[[tmux Window Targets Prefix-Match — Use `=` for Exact Names]]
