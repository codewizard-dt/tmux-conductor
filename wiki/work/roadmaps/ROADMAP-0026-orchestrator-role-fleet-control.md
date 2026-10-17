---
id: ROADMAP-0026
title: Orchestrator Agent Role — Fleet Lifecycle Management (Windows, Bg Processes, Enqueue, Status Watch)
aliases: [ROADMAP-0026]
status: active
created: 2026-09-20
updated: 2026-09-20
owner: David Taylor
derived_from: [orchestrator-role-fleet-control, agent-role-capability-grant, background-process-registry, agent-as-tool-vs-subagent, multi-agent-infrastructure-requirements]
linked_requirements: []
linked_decisions: [DEC-0006, DEC-0003]
tags: [orchestration, roles, host-server]
---

# Roadmap 0026: Orchestrator Agent Role — Fleet Lifecycle Management (Windows, Bg Processes, Enqueue, Status Watch)

## Goal

Add `orchestrator` as an agent role. When every box is checked, an agent with that role can, through a `fleet-control` skill, create agents, open/close/reopen agent windows, open/close/restart/tail bg processes, enqueue tasks to worker agents (queue only, never pane keystrokes), and observe worker status transitions from the signals that already exist (non-semantic completion tracking). The server enforces guardrails and writes an audit log, and the dashboard shows the role.

## Phase 1: Decisions

- [ ] Decide whether `orchestrator` is a privilege class or a specialty, and exclude it from role-matched task placement
- [ ] Decide the orchestrator's route grant and which verbs need human confirmation
- [ ] Decide caller identity: numeric agent id in env and header, or the window name
- [ ] Decide how the role reaches a non-worktree agent's prompt (env plus skill, or launch-flag injection)
- [ ] Decide the maximum-active-agents cap and where it is configured
- [ ] Decide how the orchestrator observes agent status changes (poll status, subscribe to events, or read the transitions log)

## Phase 2: Role Foundation

- [ ] Add `orchestrator` to the agents role enum via a table-rebuild migration with a fixture test
- [ ] Keep the role constant, presets file and migration fixtures in sync, and add the orchestrator preset fragment
- [ ] Export the agent id and role into every agent's spawn environment
- [ ] Give the role a behavioural effect for agents without a worktree

## Phase 3: Server Guardrails

- [ ] Resolve the caller to an agent and role on the server, reusing ROADMAP-0024's resolver
- [ ] Refuse an orchestrator targeting its own window or agent
- [ ] Refuse an orchestrator creating another orchestrator
- [ ] Enforce a maximum-active-agents cap on agent creation
- [ ] Require human confirmation before an orchestrator deletes an agent
- [ ] Write one audit record per orchestrator action (caller, verb, target, outcome)

## Phase 4: Agent Client

- [ ] Create a `fleet-control` skill that lists agents and bg processes and tails their output
- [ ] Add agent create and window open/close/reopen subcommands to the skill
- [ ] Add bg process open/close/restart subcommands to the skill, reusing `dev-commands` restart
- [ ] Add a subcommand to enqueue a task to a worker agent through the queue only
- [ ] Add a subcommand that reports worker status transitions, as non-semantic completion tracking
- [ ] Add an optional schedule preset that wakes the orchestrator for periodic fleet review

## Phase 5: Dashboard & Verify

- [ ] Add `orchestrator` to the role picker and show an orchestrator badge in the dashboard
- [ ] Show each orchestrator's audit log in the agent detail view
- [ ] Add a verify script for the `fleet-control` skill
- [ ] Write a UAT where an orchestrator restarts a crashed bg process, reopens a dead agent window and enqueues to a worker

## Notes

- **Depends on ROADMAP-0024** for the bg half: `TASK-0190` (atomic restart), `TASK-0191` (real liveness), `TASK-0193` (cooldown, caller header, audit writer), `TASK-0194` (caller resolution and guard), `TASK-0202` (`whoami`), `TASK-0203` (`dev-commands restart`). Deliberately not re-listed here so task auto-checkoff isn't double-counted.
- **Schema versions:** the role-enum migration must claim its version in coordination with ROADMAP-0024's migrations (`TASK-0195`/`0196`/`0198`); the DB is at v10.
- **UI items follow ROADMAP-0023** (the `AgentList` sidebar/detail rewrite) and touch the same components as ROADMAP-0024's Background tab.
- **"Completion" is non-semantic by design:** it means an agent's status transition (for example busy to idle), not a task-complete signal. BUG-0001 can misreport idle while background sub-agents run, and `popTask` still marks a task `done` at dispatch. Semantic completion (task id through dispatch, lease and attempt columns) remains out of scope; see `multi-agent-infrastructure-requirements`.
- **Guardrails are not a security boundary:** a headerless call is treated as a human and agents run with `--dangerously-skip-permissions`, so the role is a grant plus guardrails plus audit. See `agent-role-capability-grant` and DEC-0003.
- **Enqueue-only:** the orchestrator's grant excludes `/agents/:id/keys` and `/mode` per DEC-0006 driver 7 and `agent-as-tool-vs-subagent`.
- **DEC-0006 premise to correct:** its "role → behaviour injection exists" holds only for worktree agents; see the contradiction callout in `orchestrator-role-fleet-control`.
