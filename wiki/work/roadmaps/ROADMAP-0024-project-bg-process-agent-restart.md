---
id: ROADMAP-0024
title: Project-Linked Background Processes — Agent Access and Restart
aliases: [ROADMAP-0024]
status: active
created: 2026-09-19
updated: 2026-09-19
owner: David Taylor
derived_from: [bg-process-agent-access, background-process-registry, bg-processes-project-scoping, shared-dev-commands]
linked_requirements: []
linked_decisions: []
tags: [bg-processes, host-server, skills]
---

# Roadmap 0024: Project-Linked Background Processes — Agent Access and Restart

## Goal

Finish the agent-facing half of project-linked background processes (ROADMAP-020 already delivered `project_id`, grouping, and `dev-commands` list/status/tail). When every box is checked, any agent in a project can list only its project's bg processes, read readable tail output, see whether each is really running, and restart it in one safe, audited action; the dashboard offers the same view and Restart, including a Background tab in the agent detail tablist.

## Phase 1: Decisions & Spike

- [x] [[TASK-0186: Decide how bg processes with no project are treated (visible to all, hidden, or must be assigned)]]
- [x] [[TASK-0187: Decide the fate of the single-agent linked_agent_id now that projects own bg processes]]
- [x] [[TASK-0188: Decide whether bg process names become unique per project]]
- [x] [[TASK-0189: Spike whether pipe-pane log capture survives respawn-window -k versus kill-window plus new-window]]

## Phase 2: Backend

- [x] [[TASK-0196: Implement per-project bg process name uniqueness with a derived project-name slug identity]]

- [x] [[TASK-0190: Add one atomic restart operation for a bg process that reattaches log capture and writes a restart marker]]
- [x] [[TASK-0191: Report real running/exited liveness for bg processes instead of window-exists-only]]
- [x] [[TASK-0192: Add an ANSI-stripped bg process output endpoint]]
- [x] [[TASK-0193: Add a restart cooldown and an audit log recording which agent triggered each restart]]

## Phase 3: Agent Access

- [x] [[TASK-0194: Resolve the calling agent's project on the server and restrict bg restart to same-project callers]]
- [x] [[TASK-0202: Make `dev-commands list` default to the caller's project, with an all-projects option]]
- [x] [[TASK-0203: Add a `restart` subcommand to the `dev-commands` skill]]
- [x] [[TASK-0204: Point `dev-commands status`/`tail` at the new liveness and output endpoints and fix the `SKILL.md` state vocabulary]]

## Phase 4: Dashboard & Verify

- [ ] [[TASK-0205: Add a Background tab to the agent detail tablist listing the agent's project's bg processes with a running/exited badge and live output tail (tab hidden when the agent has no project)]]
- [ ] [[TASK-0206: Add a Restart action with confirmation on each process in the Background tab and on the existing bg process tile]]
- [x] [[TASK-0207: Show last restart time and the triggering agent next to each process]]
- [ ] [[TASK-0208: Extend `verify-dev-commands.sh` and write a UAT for an agent-driven restart]]
- [x] [[TASK-0195: Require a project for every bg process (validate POST/PATCH, cascade on project delete, backfill, remove Unassigned UI)]]
- [x] [[TASK-0197: Stop reading and writing bg_processes.linked_agent_id]]
- [x] [[TASK-0198: Drop bg_processes.linked_agent_id via a table-rebuild migration]]

## Notes

