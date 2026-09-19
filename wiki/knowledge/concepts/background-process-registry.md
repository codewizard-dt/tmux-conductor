---
id: background-process-registry
title: Background Process Registry (bg_processes) — Mechanism and Gaps
updated: 2026-09-13
sources:
  - ../../../raw/research/shared-dev-commands/index.md
  - ../../../raw/research/shared-dev-commands/index-2.md
  - ../../../raw/research/shared-dev-commands/index-3.md
confidence: inferred
tags: [bg-processes, tmux, host-server, project-scoping]
---

# Background Process Registry (`bg_processes`) — Mechanism and Gaps

tmux-conductor's `bg_processes` concept is the existing mechanism for running a named, long-lived, non-agent command (a dev server, watcher, log tailer) as its own tmux window inside the shared conductor session. It is the natural extension point for "shared dev commands agents can check on," and understanding its current mechanism and gaps matters before building anything new on top of it.

**Mechanism** (three parts, all already implemented):
1. **Registry** — `name:workdir:launchCmd`, optionally with a single `linked_agent_id`. Spawned as its own tmux window by `scripts/conductor.sh`/`spawn.sh`; never dispatched to, never affects idle/usage-based shutdown (see `architecture/script-integration` in the project's Serena memory).
2. **Output capture** — `tmux pipe-pane -t $SESSION:$name -o "cat >> '$LOG_DIR/bg-$name.log'"`, attached at spawn time. This avoids the buffered/color-stripped output that plain stdout redirection causes when a process detects it isn't attached to a real terminal — the same reasoning Procfile/tmux process managers like Overmind use for running each process in a real tmux window rather than piping file descriptors directly.
3. **Liveness** — `scripts/monitor.sh` writes `alive`/`dead` to `$STATE_DIR/bg-<name>.state` on every poll tick (`tmux has-session` check), independent of the log file.

Every agent (not just a linked one) already receives `CONDUCTOR_STATE_DIR` and `CONDUCTOR_LOG_DIR` as absolute-path environment variables at spawn, so in principle any agent can already resolve `bg-<name>.log`/`bg-<name>.state` paths for a *known* name — see relates_to::[[Claude Code Hooks]] for how these env vars flow through the same spawn path as hook configuration.

**Known gaps, as of 2026-09-13** (see the full research at `raw/research/shared-dev-commands/index.md` for detail):
- **Split-brain source of truth**: `host-server/index.ts`'s `POST/DELETE /api/bg-processes` routes read/write `conductor.conf`'s `BG_PROCESSES` bash array, while `scripts/lib/db.sh`'s `load_bg()` (used by the shell scripts that actually spawn and monitor processes) reads the SQLite `bg_processes` table. The two are not synced. `host-server/db.ts`'s `createBgProcess`/`listBgProcesses`/`deleteBgProcess` are fully implemented but uncalled — dead code. This contradicts both CLAUDE.md's description ("Background processes are stored in the SQLite `bg_processes` table … not the `conductor.conf` `BG_PROCESSES` array") and the project's own `architecture/script-integration` Serena memory, both of which describe the pre-drift model.
- **No project scoping**: unlike `agents`/`tasks`/`schedules`, `bg_processes` carries no `project_id` — every bg process in a session is visible to every agent in that session with no per-project filter.
- **No agent-facing discovery command**: the `CONDUCTOR_BG_NAME`/`LOG`/`STATE` convenience env vars are only injected for one explicitly-linked agent (`AGENT_BG_LINKS`, one bg process → one agent); nothing lets any other agent ask "what's registered for my project" or cross-check a possibly-`POLL_INTERVAL`-stale state file against live `tmux has-session`.

**Design implication**: any future "list vital dev commands" / shared dev-process feature should extend this mechanism (fix the split-brain, add `project_id`, add a thin discovery script over the *existing* log/state file conventions) rather than build a parallel registry — a second registry would either duplicate the split-brain problem at a new layer or require reconciling two overlapping "named shared process" concepts in the UI and data model.

**UI project-grouping precedent (2026-09-13, see `raw/research/shared-dev-commands/index-3.md`)**: the dashboard already implements consecutive-run project grouping for agents — `frontend/src/components/AgentList.tsx:1561-1604`'s `projectLabelFor`/`projectIdFor`/`groupByProject` helpers, rendered as project sub-headers above each column's agent tiles (`AgentList.tsx:1637-1655`). `BgProcessSection`/`BgProcess` (same file, ~lines 55-63 and 1278-1288) has no equivalent grouping and no `projectId`/`projectName` fields yet on either the frontend `BgProcess` type or the backend `BgStatus`/`buildBgStatuses` (`host-server/index.ts:136-165`) — extending bg-process UI to group by project should reuse the existing `groupByProject` clustering shape rather than invent a new one, once those fields exist end-to-end (tracked as ROADMAP-020 Phase 2 → Phase 3, see [[TASK-156]]).

**Update (2026-09-13)**: the `project_id` gap now has a concrete implementation plan — see [[bg_processes Project Scoping — Migration and Endpoint Shape (ROADMAP-020 Phase 2)]] and `TASK-156`. Recommendation: a v1-shaped nullable `project_id` column (no per-project unique-index rebuild, since nothing requires bg-process names to be unique per project the way `agents` needed once `POST /projects/:id/agents` allowed duplicate names across projects) plus a new `GET /projects/:id/bg-processes` endpoint. The split-brain gap above was re-confirmed still live during that follow-up research.

**Update (2026-09-13, ROADMAP-020 Phase 1 scoped)**: the split-brain fix itself (definitions **and** the bg↔agent link — see the refinement above) is now scoped as `TASK-159` (`wiki/work/tasks/TASK-159-bg-processes-sqlite-source-of-truth.md`; originally drafted as `TASK-157` but renamed after a same-session task-ID race — see `wiki/log.md`'s "TASK-159 created" entry), independent of and not blocked by `TASK-156`'s Phase 2 work. Per `raw/research/shared-dev-commands/index-2.md`, the fix touches exactly four call sites in `host-server/index.ts` (`POST/DELETE /bg-processes`, `POST/DELETE /bg-processes/:name/window`) plus `buildBgStatuses`, rewiring them onto `db.ts`'s `createBgProcess`/`deleteBgProcess`/`listBgProcesses`, and removes the now-dead `config.ts` writer functions (`appendBgProcessToConf`, `removeBgProcessFromConf`, `addBgLink`, `removeBgLink`).

relates_to::[[Host Server]]
relates_to::[[Shared, Project-Scoped Dev Commands for Agents]]
relates_to::[[bg_processes Project Scoping — Migration and Endpoint Shape (ROADMAP-020 Phase 2)]]
