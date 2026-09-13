// ---------------------------------------------------------------------------
// Conductor API base.
// `API_BASE` is the string prefix every conductor call site concatenates
// (`${API_BASE}/agents`, `${API_BASE}/events`, ...). The frontend talks
// directly to the host-server via the Vite dev proxy at `/api` (overridable
// with VITE_API_URL).
// ---------------------------------------------------------------------------

type ViteEnv = ImportMeta & {
  env: {
    VITE_API_URL?: string
  }
}

const viteEnv = (import.meta as ViteEnv).env

/** Conductor API base — Vite proxy at `/api` (overridable via VITE_API_URL). */
export const API_BASE = viteEnv.VITE_API_URL ?? '/api'

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init)
}

export interface KeysPayload {
  keys?: string[]
  text?: string
  enter?: boolean
}

/** Send keystrokes or literal text directly to an agent's tmux pane (bypasses the queue). Addressed by agent id. */
export async function sendAgentKeys(agentId: number, payload: KeysPayload): Promise<void> {
  const res = await apiFetch(`${API_BASE}/agents/${agentId.toString()}/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
}


// Best-effort background sync of the browser terminal's full-width probe size to the
// shared tmux session's window geometry. Never throws — a failed sync should never
// surface an error banner to the user, it just means the next probe (or resize) retries.
export async function syncTerminalSize(cols: number, rows: number): Promise<void> {
  try {
    const res = await apiFetch(`${API_BASE}/terminal-size`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      console.error('syncTerminalSize failed:', body.error ?? `HTTP ${res.status.toString()}`)
    }
  } catch (err) {
    console.error('syncTerminalSize failed:', err)
  }
}


export async function fetchAgentDiff(agentId: number): Promise<{ diff: string | null; base: string | null; truncated?: boolean }> {
  const res = await apiFetch(`${API_BASE}/agents/${agentId.toString()}/diff`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
  return res.json() as Promise<{ diff: string | null; base: string | null; truncated?: boolean }>
}

export async function fetchAgentCheckpoints(agentId: number): Promise<{ checkpoints: AgentCheckpoint[] }> {
  const res = await apiFetch(`${API_BASE}/agents/${agentId.toString()}/checkpoints`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
  return res.json() as Promise<{ checkpoints: AgentCheckpoint[] }>
}

export async function rollbackAgent(agentId: number, checkpointId: number): Promise<{ ok: boolean; stash_ref: string }> {
  const res = await apiFetch(`${API_BASE}/agents/${agentId.toString()}/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkpoint_id: checkpointId }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
  return res.json() as Promise<{ ok: boolean; stash_ref: string }>
}

/** Upload a dropped/pasted image; the backend saves it and types its path into the agent's pane. Addressed by agent id. */
export async function uploadAgentImage(agentId: number, file: File): Promise<void> {
  const qs = `filename=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type)}`
  const res = await apiFetch(`${API_BASE}/agents/${agentId.toString()}/upload?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
}

/** Upload an image for the task textarea: saves the file and returns its path, does NOT type it into the pane. Addressed by agent id. */
export async function uploadImageForPath(agentId: number, file: File): Promise<string> {
  const qs = `filename=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type)}&paneInsert=false`
  const res = await apiFetch(`${API_BASE}/agents/${agentId.toString()}/upload?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
  const body = await res.json() as { path?: string }
  if (!body.path) throw new Error('Upload succeeded but no path returned')
  return body.path
}

// ---------------------------------------------------------------------------
// Tasks / queue
// ---------------------------------------------------------------------------

export interface Task {
  id: number
  command: string
  agentId: number | null
  projectId: number | null
  position: number
  status: 'queued' | 'backlog' | 'done'
  source: 'manual' | 'schedule'
  scheduleId: number | null
  createdAt: string
  completedAt?: string | null
}

export async function addTask(
  command: string,
  opts?: { agentId?: number; projectId?: number; placement?: 'tail' | 'head' },
): Promise<{ task: Task | null; dispatched: boolean }> {
  const res = await apiFetch(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, ...opts }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
  if (res.status === 200) {
    return { task: null, dispatched: true }
  }
  const task = await res.json() as Task
  return { task, dispatched: false }
}

export async function deleteTask(id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/tasks/${id.toString()}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
}

export async function reorderTasks(ids: number[]): Promise<void> {
  const res = await apiFetch(`${API_BASE}/tasks/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
}

export async function jumpTaskToHead(id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/tasks/${id.toString()}/jump-head`, {
    method: 'POST',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
}

export async function fetchProjectTasks(projectId: number): Promise<Task[]> {
  const res = await apiFetch(`${API_BASE}/tasks?projectId=${projectId.toString()}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
  return res.json() as Promise<Task[]>
}

/** Completed task history (status='done'), newest-completed first. Optional filters scope by agent/project/count. */
export async function fetchTaskHistory(opts?: { agentId?: number; projectId?: number; limit?: number }): Promise<Task[]> {
  const params = new URLSearchParams()
  if (opts?.agentId !== undefined) params.set('agentId', opts.agentId.toString())
  if (opts?.projectId !== undefined) params.set('projectId', opts.projectId.toString())
  if (opts?.limit !== undefined) params.set('limit', opts.limit.toString())
  const qs = params.toString()
  const res = await apiFetch(`${API_BASE}/tasks/history${qs ? `?${qs}` : ''}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
  return res.json() as Promise<Task[]>
}

// ── Projects ──────────────────────────────────────────────────────────────
export interface Project {
  id: number;
  name: string;
  workdir: string;
  defaultLaunchCmd: string;
  createdAt: string;
}

/** GET /api/projects */
export async function listProjects(): Promise<Project[]> {
  const res = await apiFetch(`${API_BASE}/projects`);
  if (!res.ok) throw new Error(`HTTP ${res.status.toString()}`);
  return res.json() as Promise<Project[]>;
}

export interface ApiAgent {
  id: number;
  name: string;
  workdir: string;
  launchCmd: string;
  projectId: number | null;
  worktreePath?: string | null;
  branch?: string | null;
  createdAt: string;
}

export interface AgentCheckpoint {
  id: number;
  agentId: number;
  ts: number;
  stashRef: string;
  createdAt: number;
}

export type AgentRunState =
  | 'busy'
  | 'idle'
  | 'awaiting'
  | 'stalled'
  | 'starting'
  | 'no-window'
  | 'exited'
  | 'error'
  | 'unknown';

export type AgentDisplayStatus = AgentRunState | 'empty' | 'idle-waiting';

export interface AgentStatusContract {
  state: AgentRunState;
  display: AgentDisplayStatus;
  reason: string;
  needsAttention: boolean;
  activeTask: string | null;
  evidence: {
    windowName: string;
    windowPresent: boolean;
    paneCurrentCommand: string | null;
    stateFile: {
      path: string;
      present: boolean;
      value: string | null;
      ageSeconds: number | null;
    };
    activeTaskRetained: boolean;
  };
}

export async function fetchAgents(): Promise<ApiAgent[]> {
  const res = await apiFetch(`${API_BASE}/agents`);
  if (!res.ok) throw new Error(`HTTP ${res.status.toString()}`);
  return res.json() as Promise<ApiAgent[]>;
}

/** POST /api/projects — name must match ^[A-Za-z0-9_-]+$, workdir absolute. */
export async function createProject(input: {
  name: string;
  workdir: string;
  defaultLaunchCmd?: string;
}): Promise<Project> {
  const res = await apiFetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
  }
  return res.json() as Promise<Project>;
}

/** PATCH /api/agents/:id — rename an agent (addressed by id). Returns the updated agent. */
export async function renameAgent(agentId: number, newName: string): Promise<ApiAgent> {
  const res = await apiFetch(`${API_BASE}/agents/${agentId.toString()}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
  }
  return (res.json() as Promise<{ agent: ApiAgent }>).then((b) => b.agent);
}

/** POST /api/projects/:id/agents — omit name for auto-naming (project-N). Returns the new agent. */
export async function spawnAgentInProject(
  projectId: number,
  name?: string,
  launchCmd?: string,
  role?: string,
  useWorktree?: boolean,
): Promise<unknown> {
  const res = await apiFetch(`${API_BASE}/projects/${projectId.toString()}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(name !== undefined ? { name } : {}),
      ...(launchCmd !== undefined ? { launchCmd } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(useWorktree !== undefined ? { useWorktree } : {}),
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
  }
  return res.json();
}

/**
 * POST /api/agents/:id/worktree — opt-in worktree creation for an agent that
 * was created without one (ROADMAP-007: worktrees are opt-in only). 400 when
 * the agent's workdir isn't inside a git repo, 409 when it already has one.
 */
export async function createWorktreeForAgent(agentId: number): Promise<ApiAgent> {
  const res = await apiFetch(`${API_BASE}/agents/${agentId.toString()}/worktree`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
  }
  return (res.json() as Promise<{ agent: ApiAgent }>).then((b) => b.agent);
}

/** DELETE /api/projects/:id */
export async function deleteProject(projectId: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/projects/${projectId.toString()}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
  }
}

// Updates a bg process's stored definition (workdir/launchCmd/projectId only —
// name is immutable). Writes SQLite only; does not touch a live tmux window.
export interface BgProcessDefinition {
  id: number;
  name: string;
  workdir: string;
  launchCmd: string;
  linkedAgentId: number | null;
  projectId: number | null;
}

export async function updateBgProcess(
  name: string,
  data: Partial<{ workdir: string; launchCmd: string; projectId: number | null }>,
): Promise<BgProcessDefinition> {
  const res = await apiFetch(`${API_BASE}/bg-processes/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
  }
  return res.json() as Promise<BgProcessDefinition>;
}

// ── Schedules ──────────────────────────────────────────────────────────────

export interface Schedule {
  id: number;
  name: string | null;
  command: string;
  intervalSeconds: number;
  action: 'append' | 'jump';
  agentId: number | null;
  projectId: number | null;
  enabled: number;
  skipIfPending: number;
  lastEnqueuedAt: number | null;
  createdAt: string;
}

export interface CreateScheduleInput {
  name?: string;
  command: string;
  intervalSeconds: number;
  action?: 'append' | 'jump';
  skipIfPending?: boolean;
}

/** GET /api/schedules — list all schedules. */
export async function listSchedules(): Promise<Schedule[]> {
  const res = await apiFetch(`${API_BASE}/schedules`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status.toString()}`);
  }
  return res.json() as Promise<Schedule[]>;
}

/** POST /api/schedules — create a schedule. Returns the created schedule. */
export async function createSchedule(input: CreateScheduleInput): Promise<Schedule> {
  const res = await apiFetch(`${API_BASE}/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
  }
  return res.json() as Promise<Schedule>;
}

/** DELETE /api/schedules/:id — delete a schedule (204, no body). */
export async function deleteSchedule(id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/schedules/${id.toString()}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status.toString()}`);
  }
}
// ── end Schedules ──────────────────────────────────────────────────────────
// ── Filesystem browse ──────────────────────────────────────────────────────

export interface BrowseEntry {
  name: string;
  path: string;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
}

/** GET /api/browse — list subdirectories at `dirPath` (defaults to home dir). */
export async function browseDirectory(dirPath?: string): Promise<BrowseResult> {
  const qs = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
  const res = await apiFetch(`${API_BASE}/browse${qs}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
  }
  return res.json() as Promise<BrowseResult>;
}

// ── end Filesystem browse ──────────────────────────────────────────────────
// ── end Projects ──────────────────────────────────────────────────────────
