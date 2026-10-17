---
id: ROADMAP-0025
title: Create a Worktree from Any Agent (Menu Action + Clone into New Worktree)
aliases: [ROADMAP-0025]
status: active
created: 2026-09-20
updated: 2026-09-20
owner: David Taylor
derived_from: [worktree-on-any-agent, agent-worktree-lifecycle]
linked_requirements: []
linked_decisions: []
tags: [worktree, agents, dashboard]
---

# Roadmap 0025: Create a Worktree from Any Agent (Menu Action + Clone into New Worktree)

## Goal

Make creating an isolated git worktree available on **any** agent, not just from the detail pane of an agent that has none. When every box is checked, the "create worktree" action is reachable from the agent actions menu with clear disabled states and real error text; a "Clone into new worktree" action works on every agent, whether or not it already has a worktree; every new worktree is created in a newly created sibling directory of the project root and never nested inside it; new worktrees show on all clients without a reload; and the live-agent cwd hazard is warned about and covered by tests.

## Phase 1: Surface

- [ ] [[TASK-0209: Add a Create worktree item to the agent actions menu with reasoned disabled states]]
- [ ] [[TASK-0210: Surface the backend's real worktree-creation error reason instead of a generic message]]
- [ ] [[TASK-0211: Propagate a newly created worktree/branch to all clients without a reload]]
- [x] [[TASK-0212: Guard and test that new worktrees land in a newly created sibling directory of the repo root]]

## Phase 2: Clone

- [ ] [[TASK-0213: Add a force-worktree option to POST /agents/:id/clone and start the clone's window inside the worktree]]
- [ ] [[TASK-0214: Add a Clone into new worktree item to the agent actions menu on every agent]]
- [ ] [[TASK-0215: Include worktreePath and branch in the clone agent-update SSE payload]]

## Phase 3: Harden

- [ ] [[TASK-0216: Warn, and offer a restart in the worktree, when adding a worktree to an agent whose window is live]]
- [x] [[TASK-0217: Cover delete-after-clone worktree and branch teardown with a test]]
- [ ] [[TASK-0218: Run UAT for the Create worktree menu action and the Clone into new worktree flow]]

## Notes

- **Out of scope:** giving a live agent a second or replacement worktree. Path and branch are derived from the agent id (`<repo>-worktrees/<id>`, `conductor/<id>`), so this needs a data-model decision first (`/decision-create`), not a roadmap item.
- **Constraints carried from ROADMAP-007:** worktrees stay opt-in only (never auto-created), and live in a sibling of the repo root so the source repo's working tree stays clean. The current `siblingWorktreePath` layout already satisfies the sibling rule; Phase 1's guard item makes it explicit and tested.
- **Open reading of "newly created sibling directory":** taken as "created on demand as a sibling of the project root, outside it" (today's `<repo>-worktrees/<id>`). If a distinct sibling directory per worktree is wanted instead (e.g. `<parent>/<repo>-<branch>`), settle that before the Phase 1 guard item is implemented.
- Research: `raw/research/worktree-on-any-agent/index.md`.
