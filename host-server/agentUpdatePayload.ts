// Pure builder for the one-shot `agent-update` SSE body the host-server
// broadcasts right after it creates an agent (POST /agents,
// POST /projects/:id/agents, POST /agents/:id/clone). Before this existed each
// route hand-assembled the same literal and none of them carried the worktree
// fields, so a fresh worktree-backed agent rendered badge-less until the next
// periodic pollAndDiff tick. Kept free of imports from index.ts so it is
// unit-testable in isolation.
import type { AgentContext } from './context.ts';
import type { Agent } from './db.ts';
import type { AgentMode, AgentRunState, AgentType } from './state.ts';

export type NewAgentUpdateSource = Pick<
  Agent,
  'id' | 'name' | 'projectId' | 'projectName' | 'launchCmd' | 'workdir' | 'worktreePath' | 'branch' | 'role' | 'description'
>;

export interface NewAgentLiveState {
  state: AgentRunState;
  mode: AgentMode;
  agentType: AgentType;
  windowPresent: boolean;
  queuedTasks?: number;
  activeTask?: string | null;
  inGitRepo?: boolean;
  /** Context fields (model, contextPct, ...) spread last, as the routes always did. */
  context: AgentContext;
}

export type NewAgentUpdate = NewAgentUpdateSource & {
  state: AgentRunState;
  mode: AgentMode;
  agentType: AgentType;
  windowPresent: boolean;
  queuedTasks: number;
  activeTask: string | null;
  inGitRepo: boolean;
} & AgentContext;

export function buildNewAgentUpdate(agent: NewAgentUpdateSource, live: NewAgentLiveState): NewAgentUpdate {
  return {
    id: agent.id,
    name: agent.name,
    projectId: agent.projectId,
    projectName: agent.projectName,
    state: live.state,
    mode: live.mode,
    agentType: live.agentType,
    windowPresent: live.windowPresent,
    queuedTasks: live.queuedTasks ?? 0,
    launchCmd: agent.launchCmd,
    workdir: agent.workdir,
    worktreePath: agent.worktreePath ?? null,
    branch: agent.branch ?? null,
    role: agent.role,
    description: agent.description ?? null,
    activeTask: live.activeTask ?? null,
    inGitRepo: live.inGitRepo ?? false,
    ...live.context,
  };
}
