export const API_BASE = (import.meta as ImportMeta & { env: { PUBLIC_API_URL?: string } }).env.PUBLIC_API_URL ?? 'http://localhost:8788/api';

export interface KeysPayload {
  keys?: string[]
  text?: string
  enter?: boolean
}

/** Send keystrokes or literal text directly to an agent's tmux pane (bypasses the queue). */
export async function sendAgentKeys(agent: string, payload: KeysPayload): Promise<void> {
  const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(agent)}/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
}

/** Upload a dropped/pasted image; the backend saves it and types its path into the agent's pane. */
export async function uploadAgentImage(agent: string, file: File): Promise<void> {
  const qs = `filename=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type)}`
  const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(agent)}/upload?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
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
  status: 'queued' | 'backlog'
  source: 'manual' | 'schedule'
  scheduleId: number | null
  createdAt: string
}

export async function addTask(
  command: string,
  opts?: { agentName?: string; projectId?: number; placement?: 'tail' | 'head' },
): Promise<{ task: Task | null; dispatched: boolean }> {
  const res = await fetch(`${API_BASE}/tasks`, {
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
  const res = await fetch(`${API_BASE}/tasks/${id.toString()}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
}

export async function reorderTasks(ids: number[]): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/reorder`, {
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
  const res = await fetch(`${API_BASE}/tasks/${id.toString()}/jump-head`, {
    method: 'POST',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
  }
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
  const res = await fetch(`${API_BASE}/projects`);
  if (!res.ok) throw new Error(`HTTP ${res.status.toString()}`);
  return res.json() as Promise<Project[]>;
}

export interface ApiAgent {
  id: number;
  name: string;
  workdir: string;
  launchCmd: string;
  projectId: number | null;
  createdAt: string;
}

export async function fetchAgents(): Promise<ApiAgent[]> {
  const res = await fetch(`${API_BASE}/agents`);
  if (!res.ok) throw new Error(`HTTP ${res.status.toString()}`);
  return res.json() as Promise<ApiAgent[]>;
}

/** POST /api/projects — name must match ^[A-Za-z0-9_-]+$, workdir absolute. */
export async function createProject(input: {
  name: string;
  workdir: string;
  defaultLaunchCmd?: string;
}): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects`, {
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

/** POST /api/projects/:id/agents — omit name for auto-naming (project-N). Returns the new agent. */
export async function spawnAgentInProject(
  projectId: number,
  name?: string,
): Promise<unknown> {
  const res = await fetch(`${API_BASE}/projects/${projectId.toString()}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name !== undefined ? { name } : {}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
  }
  return res.json();
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
  const res = await fetch(`${API_BASE}/schedules`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status.toString()}`);
  }
  return res.json() as Promise<Schedule[]>;
}

/** POST /api/schedules — create a schedule. Returns the created schedule. */
export async function createSchedule(input: CreateScheduleInput): Promise<Schedule> {
  const res = await fetch(`${API_BASE}/schedules`, {
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
  const res = await fetch(`${API_BASE}/schedules/${id.toString()}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status.toString()}`);
  }
}
// ── end Schedules ──────────────────────────────────────────────────────────
// ── end Projects ──────────────────────────────────────────────────────────
