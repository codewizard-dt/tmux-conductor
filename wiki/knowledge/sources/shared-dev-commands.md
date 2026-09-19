---
id: shared-dev-commands
title: Shared, Project-Scoped Dev Commands for Agents
updated: 2026-09-13
sources:
  - ../../../raw/research/shared-dev-commands/index.md
  - ../../../raw/research/shared-dev-commands/sources.md
  - ../../../raw/research/shared-dev-commands/index-2.md
  - ../../../raw/research/shared-dev-commands/sources-2.md
  - ../../../raw/research/shared-dev-commands/index-3.md
  - ../../../raw/research/shared-dev-commands/sources-3.md
confidence: extracted
tags: [bg-processes, host-server, skills, project-scoping]
---

# Shared, Project-Scoped Dev Commands for Agents

Research into a request for a way to register "vital" dev commands (`npm run dev`, `make dev`, etc.) per project, each running in its own tmux window, so that **every** agent working on that project — not just one designated agent — can check whether a given command is running and inspect its recent output, with management surfaced in the dashboard UI the same way agents are managed.

**The feature is already ~80% built** under the existing `bg_processes` mechanism: `scripts/conductor.sh`/`spawn.sh` spawn each registered background process in its own tmux window, `tmux pipe-pane` captures its output to `$LOG_DIR/bg-<name>.log`, and `scripts/monitor.sh` writes `alive`/`dead` to `$STATE_DIR/bg-<name>.state` on every poll tick. `CONDUCTOR_STATE_DIR`/`CONDUCTOR_LOG_DIR` are already exported into every agent's environment (not just a linked one), so any agent can in principle already resolve these paths. Dashboard management (`AddBgProcessForm.tsx`, `BgProcessSection`/`BgProcessRow` in `AgentList.tsx`) already exists as a flat, unscoped list.

Three gaps separate the current state from the request: **(1)** a live split-brain bug — the dashboard's `POST/DELETE /api/bg-processes` routes write bg-process definitions to `conductor.conf`'s `BG_PROCESSES` bash array, while `scripts/lib/db.sh`'s `load_bg()` (used by `conductor.sh`/`spawn.sh`/`monitor.sh`) reads definitions from the SQLite `bg_processes` table instead — the two stores are unsynced, and `host-server/db.ts`'s `createBgProcess`/`listBgProcesses`/`deleteBgProcess` are dead code as a result; **(2)** `bg_processes` has no `project_id`, unlike `agents`/`tasks`/`schedules`, so there is no structural way to scope commands to "this project's agents"; **(3)** no documented, discoverable command lets an *arbitrary* agent enumerate/check/tail a project's registered commands — only a single explicitly-linked agent gets the `CONDUCTOR_BG_NAME`/`LOG`/`STATE` env-var shortcut today.

**Recommended fix** (`inferred` synthesis, not stated by any single source): make SQLite the sole source of truth for bg-process definitions (wire the existing dead `db.ts` functions into the dashboard routes instead of the conductor.conf writers), add a `project_id` column + project-filtered listing endpoint, extend the existing add-form/list UI with a project selector (no new UI pattern needed), and ship a thin user-scoped `~/.claude/skills/` skill + bash script that wraps the *existing* log/state-file conventions (`list`/`status`/`tail`) rather than inventing a new registry. The tmux-window-per-process + captured-pane-output pattern is validated by external prior art (Overmind, a Procfile/tmux process manager) as the standard way to avoid the buffering/color-loss problems of naive stdout redirection — so the existing primitive should be extended, not replaced.

**Follow-up pass (2026-09-13, scoping ROADMAP-020 Phase 1 for `/task-add`)** re-confirmed the split-brain against current code and found it is wider than first reported: the bg↔agent *link* is split too, not just the bg-process list. `scripts/lib/db.sh`'s `load_agents()` already joins `bg_processes.linked_agent_id` via SQL to populate the `CONDUCTOR_BG_NAME`/`LOG`/`STATE` env injection in `conductor.sh`/`spawn.sh` — the bash side is **already fully SQLite-driven for the link**. Meanwhile `host-server/index.ts`'s `POST/DELETE /bg-processes` still write/remove that link in `conductor.conf`'s `AGENT_BG_LINKS` array (`addBgLink`/`removeBgLink` in `config.ts`), which nothing reads anymore for spawn purposes — a dashboard-linked bg process silently fails to inject its env vars into the linked agent's pane today. The concrete fix (four call sites in `index.ts`, all with zero other callers) is scoped in `raw/research/shared-dev-commands/index-2.md`.

**ROADMAP-020 Phase 0 assessment pass (2026-09-13, `raw/research/shared-dev-commands/index-3.md`)** re-verified every original assumption live (all still hold) and added two findings not covered by the Phase 1/2 follow-ups above: **(a)** `bg_processes.name` carries a *global* `UNIQUE` constraint today (cross-checked against agent window names too, since tmux window names are session-global) — unlike `agents.name`, which is unique only per project — so the coming `project_id` column must stay classificatory-only and must NOT relax name uniqueness to per-project scope the way the `agents_v2` migration did for agents; that migration is a counter-example here, not a template. **(b)** a survey of all 66 of this user's `~/.claude/skills/*` entries plus this repo's own `.claude/skills/typecheck/` found **zero** precedent anywhere for a skill bundling a `scripts/` subdirectory — every existing skill is `SKILL.md`-only. The "`SKILL.md` + `scripts/`" shape cited as the ROADMAP-020 Phase 4 approach is Anthropic's documented convention, not this user's established local one; a `SKILL.md`-only skill with inline Bash is the better-fitting default unless the `dev-commands` logic grows too complex to inline, in which case `install-hooks.sh` (repo root) is the closest local precedent for installing a bundled script into `~/.claude/` idempotently. The pass also recommended filing Phases 1-4 as four separate `depends_on`-chained tasks rather than one mega-task — independently confirmed by four sibling agents in the same session already doing exactly that concurrently.

uses::[[Host Server]]
relates_to::[[Claude Code Hooks]]
