---
topic: "tmux-conductor: existing git worktree creation for agents (clone endpoint POST /agents/:id/clone, worktreePath, any worktree code in host-server/, frontend/, scripts/) and what it would take to expose a \"create new worktree\" action/button on ANY agent in the dashboard (not just at agent-add time or on clones). Cover: current worktree creation path, where the UI surfaces it, gaps (agents without a worktree, agents sharing a workdir), and constraints from the wiki (concepts/entities mentioning worktree, clone agent)."
slug: worktree-on-any-agent
researched: 2026-09-20
sources: [./sources.md]
---

# Research: Create-a-worktree action on any agent

> A "Create worktree" button **already exists** on the agent detail view, backed by `POST /agents/:id/worktree` → `addWorktreeToAgent`. It is shown only while the agent has *no* worktree, and the backend hard-rejects (409) any agent that already has one. So "any agent" today means "any agent without a worktree, from the detail pane only". The genuine gaps are (1) the action is not reachable from the agent list/sidebar or the actions menu, (2) an agent that already has a worktree cannot get a *new* one because path and branch are derived deterministically from the agent id (`<repo>-worktrees/<id>`, `conductor/<id>`), and (3) Clone copies the source's workdir verbatim and only creates a worktree when the source already has one, so cloning a worktree-less agent yields two agents sharing one working tree. The most valuable, lowest-risk extension is a "Clone into new worktree" action available on every agent; surfacing the existing button in the actions menu is a small add-on; re-worktreeing a live agent in place is the risky option.

## Research Questions
1. What is the current worktree creation path (backend + git helpers)?
2. Where does the UI surface it today, and under what conditions?
3. What does `POST /agents/:id/clone` do with worktrees?
4. What are the gaps for "any agent" (no worktree, already has worktree, shared workdir, non-git workdir)?
5. What wiki/roadmap constraints apply (opt-in-only decision, path layout, teardown)?

## Current State (Codebase)

**Git helpers** (`host-server/git.ts`) [S1]: `createWorktree(gitRoot, worktreePath, branch)` runs `git worktree add <path> -b <branch> <baseRef>` with `baseRef` from `detectBaseBranch`; returns a boolean, no error detail. `siblingWorktreePath(gitRoot, agentId)` returns `<parent-of-gitRoot>/<repo>-worktrees/<agentId>`. Also `getGitRoot`, `isGitRepo`, `removeWorktree`, `deleteBranch`, `stashCheckpoint`, `applyStash`.

**Retroactive creation** (`host-server/db.ts::addWorktreeToAgent`) [S2]: throws `not found` for a missing agent, throws `already has a worktree` when `agent.worktreePath` is set, throws when `workdir` is not inside a git repo; otherwise creates the worktree at `siblingWorktreePath(gitRoot, agentId)` on branch `conductor/<agentId>`, writes `worktree_path`/`branch` to the `agents` row, applies the role fragment to the worktree's CLAUDE.md, and returns the agent. It does **not** restart the agent's tmux window or change its cwd.

**Route** (`host-server/index.ts`, `POST /agents/:id/worktree`) [S3]: maps error messages to 404 (`not found`), 409 (`already has a worktree`), 400 otherwise; replies 201 `{ ok, agent }`. Deliberately emits **no SSE broadcast**, because every `agent-update` payload is a full status-shaped record and a partial `{worktreePath, branch}` would be misread as a status change; the response updates the modal and the next status poll updates everyone else.

**Create-time path**: `POST /agents` accepts `useWorktree` (`createAgent`), and the frontend `AddAgentForm` exposes it as a "Use a git worktree" checkbox [S4].

**Clone** (`POST /agents/:id/clone`) [S3]: calls `createAgent` with the source's `workdir`, `launchCmd`, `projectId`, `role` and `useWorktree: Boolean(source.worktreePath)`, then `spawnAgentWindow`, then broadcasts an `agent-update`. The clone SSE payload omits `worktreePath`/`branch`.

**UI surface** (`frontend/src/components/AgentList.tsx`, `AgentDetailView`) [S5]: state `creatingWorktree`, `worktreeError`, `worktreeOverride`; `handleCreateWorktree()` calls `createWorktreeForAgent(agent.id)` (`frontend/src/lib/api.ts`) and stores the result in local override state. In the Details `<dl>`, the button renders only in the `effectiveBranch ? <branch badge> : <Create worktree button>` else-branch — i.e. **only when the agent has no branch**. Clone lives in `AgentActionsMenu` items (`onSelect: handleClone`); "Create worktree" is *not* an actions-menu item.

**Read-side self-heal** (`host-server/index.ts::resolveAgentWorktree`) [S3]: if `worktreePath` no longer exists on disk it clears the DB reference, so a manually removed worktree reverts the agent to "no worktree".

**Consumers of `worktreePath`** [S3]: pre-dispatch checkpoint stash (`dispatchTaskToAgent`), diff endpoint (uses `worktreePath || workdir`), checkpoint rollback (400 `agent has no worktree`), and delete-time teardown (`removeWorktree` + `deleteBranch`).

## Key Findings
- The action already exists but is gated on "agent has no worktree" in both UI [S5] and backend [S2]; the user's framing "agents can already create a new worktree" matches this. "Any agent" is not satisfied for agents that already have one.
- Identity collision: worktree path and branch are pure functions of agent id [S1][S2], so a second worktree for the same agent id is impossible without changing the naming scheme.
- Adding a worktree to a **running** agent updates only the DB row; the live tmux pane keeps its original cwd, so the agent keeps editing the shared workdir while the dashboard now reports (and diffs/stashes) the worktree path. This is a pre-existing sharp edge of the retroactive path [S2][S3]. *(inference from code — `addWorktreeToAgent` performs no window respawn or `cd`; not exercised at runtime in this research)*
- Clone of a worktree-less agent gives two agents on the same directory [S3]; project memory records this hazard (clone shares workdir, no isolated worktree unless source has one).
- Roadmap decision: worktrees are **opt-in only** since 2026-08-15, sibling layout, with two legacy nested worktrees left in place [S6]. Any new surface must stay explicit/user-initiated — never auto-create.
- Teardown is best-effort at agent delete and derives the git root from `workdir` with a path-based fallback [S3]; any additional worktree an agent owns must be included in that teardown or it leaks.

## Constraints
- Opt-in only (ROADMAP-007 amendment) [S6].
- Sibling layout `<repo>-worktrees/<id>`; branch `conductor/<id>` [S1][S2].
- No SSE broadcast for worktree changes today; a new client surface outside the detail view needs either a broadcast (full status-shaped payload) or a poll refresh [S3].
- `createWorktree` returns only a boolean — user-facing errors are generic ("failed to create git worktree").
- Non-git workdirs cannot get a worktree; the action must be disabled/explain, not fail opaquely [S2].
- One agent per project scaffolding rule and workdir-sharing caveats from project memory *(memory, not a repo source)*.

## Solution Comparison

| Criteria | A. Surface existing action everywhere | B. "Clone into new worktree" on any agent | C. Re-worktree a live agent in place |
|----------|----------------------------------------|------------------------------------------|--------------------------------------|
| **Approach** | Add "Create worktree" to `AgentActionsMenu` / list row for agents without one | New endpoint/flag: clone with forced `useWorktree` regardless of source | Allow a second/replacement worktree for an agent that already has one |
| **Pros** | Tiny; reuses route and handler | Fixes the shared-workdir clone hazard; works for agents with or without a worktree; fresh id ⇒ no naming collision; new window starts in the right cwd | Matches literal "any agent" reading |
| **Cons** | Does nothing for agents that already have a worktree; inherits the "live pane cwd unchanged" sharp edge | New API surface; clone naming/window spawn logic to extend | Needs new naming scheme, window respawn/`cd`, multi-worktree teardown, checkpoint semantics per worktree |
| **Complexity** | Low | Low–Medium | High |
| **Dependencies** | None | None | Schema change likely (multiple worktrees per agent) |
| **Codebase fit** | Excellent | Good — builds on `createAgent({useWorktree})` | Poor — fights id-derived path/branch |
| **Maintenance** | Low | Low | High |

## Recommendation
Treat this as a phased, low-risk extension, ordered A → B, and defer C:
1. **Make the existing action reachable from anywhere an agent is actionable** (actions menu / sidebar row), with clear disabled states (already has worktree, non-git workdir) and error text that surfaces the backend reason. Decide how the change propagates (poll refresh vs. a properly shaped SSE payload).
2. **Add "Clone into new worktree"** available on every agent: clone with `useWorktree: true` forced, so the new agent gets an isolated worktree + branch and its window spawns inside it. Include `worktreePath`/`branch` in the clone SSE payload.
3. **Close the sharp edge on the retroactive path**: either warn when the agent's window is live (cwd will not change) or offer a restart-in-worktree step — a product decision.
4. Leave in-place *replacement/multiple* worktrees (C) out of scope unless a real need appears.

Risks: leaking worktrees on delete if teardown assumptions change; users assuming a live agent moved into the new worktree; branch-name collisions if naming is ever changed. Mitigation: keep id-derived naming, extend UAT to cover delete-after-clone teardown.

Alternative if constraints change: if users genuinely need several worktrees per agent, that is a schema/design change (worktrees table) and belongs in a decision record, not a roadmap item.

## Next Steps
- Confirm which reading of "any agent" is intended (A only, A+B, or C) before phasing.
- `/roadmap-create` then `/task-add --roadmap ROADMAP-NNNN` for each phase item.
- If C is wanted: `/decision-create` first (multi-worktree data model).
