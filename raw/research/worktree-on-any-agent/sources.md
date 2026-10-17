---
topic: "tmux-conductor: existing git worktree creation for agents (clone endpoint POST /agents/:id/clone, worktreePath, any worktree code in host-server/, frontend/, scripts/) and what it would take to expose a \"create new worktree\" action/button on ANY agent in the dashboard (not just at agent-add time or on clones). Cover: current worktree creation path, where the UI surfaces it, gaps (agents without a worktree, agents sharing a workdir), and constraints from the wiki (concepts/entities mentioning worktree, clone agent)."
slug: worktree-on-any-agent
researched: 2026-09-20
---

# Primary Sources — Create-a-worktree action on any agent

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/git.ts::createWorktree`, `::siblingWorktreePath` | 2026-09-20 | Worktree add command shape; id-derived sibling path; boolean-only result |
| S2 | codebase | `host-server/db.ts::addWorktreeToAgent` | 2026-09-20 | Preconditions (already-has-worktree, non-git), branch `conductor/<id>`, DB update, role fragment, no window restart |
| S3 | codebase | `host-server/index.ts` — `POST /agents/:id/worktree`, `POST /agents/:id/clone`, `resolveAgentWorktree`, `dispatchTaskToAgent`, diff/checkpoint/DELETE handlers | 2026-09-20 | Route status mapping, no-SSE rationale, clone `useWorktree: Boolean(source.worktreePath)`, self-heal, consumers of worktreePath, teardown |
| S4 | codebase | `frontend/src/components/AddAgentForm.tsx` (checkbox "Use a git worktree") | 2026-09-20 | Create-time opt-in surface |
| S5 | codebase | `frontend/src/components/AgentList.tsx::AgentDetailView` (`handleCreateWorktree`, Details `<dl>`, `agentActionItems`), `frontend/src/lib/api.ts::createWorktreeForAgent` | 2026-09-20 | Button only rendered when no branch; not in AgentActionsMenu; clone is in the menu |
| S6 | wiki | `wiki/work/roadmaps/archive/ROADMAP-007-git-workflow.md` (TASK-061 amendment, 2026-08-15 note) | 2026-09-20 | Opt-in-only decision, sibling layout, legacy nested worktrees |

## Excerpts

### S2 — addWorktreeToAgent
`host-server/db.ts:640-660`
> if (agent.worktreePath) {
>   throw new Error(`agent ${String(agentId)} already has a worktree`);
> }
> ...
> const worktreePath = siblingWorktreePath(gitRoot, agentId);
> const branch = `conductor/${String(agentId)}`;

### S3 — clone
`host-server/index.ts:1552-1574`
> // Clone an existing agent: same workdir/launchCmd/project/role/worktree-ness,
> ...
> useWorktree: Boolean(source.worktreePath),

### S3 — no SSE for worktree route
`host-server/index.ts:1196-1201`
> // No SSE broadcast here: every other 'agent-update' payload is a
> // full status-shaped record ... a partial payload with
> // just worktreePath/branch would be misread as a status change.

### S5 — button gating
`frontend/src/components/AgentList.tsx:939-953`
> {effectiveBranch ? (
>   <span className="font-mono text-[11px]">⎇ {effectiveBranch}</span>
> ) : (
>   <> <button ... >{creatingWorktree ? 'Creating…' : 'Create worktree'}</button> ...

### S6 — opt-in decision
`wiki/work/roadmaps/archive/ROADMAP-007-git-workflow.md:22`
> Worktree creation is now **opt-in only**: a checkbox on `AddAgentForm` at agent-creation time, or a "Create worktree" button in the `AgentDetailModal` Details panel for an agent that already exists (`POST /agents/:id/worktree`, `host-server/db.ts#addWorktreeToAgent`).
