// ---------------------------------------------------------------------------
// Relay-aware conductor API base.
// `API_BASE` is the string prefix every conductor call site concatenates
// (`${API_BASE}/agents`, `${API_BASE}/events`, ...). It supports two modes:
//   - 'direct': dev/local — hits the host-server via the Vite proxy at `/api`
//     (or VITE_API_URL). This is the default and keeps local dev identical.
//   - 'relay': production — prefixes conductor calls with the selected device's
//     relay path on app/api (`/relay/<deviceId>/api`), which forwards the inner
//     `/api/...` path to the host-server.
//
// Injection seam for TASK-056: call `setRelayConfig({ mode, deviceId })` at
// runtime to flip every existing `${API_BASE}/...` call site at once. Because
// `API_BASE` is an `export let` recomputed inside `setRelayConfig`, ES-module
// live bindings propagate the new value to all importers (they evaluate the
// template literal per call). The env reads below are STUBS so this file
// compiles/builds standalone; TASK-056 wires real runtime detection.
//
// Auth/admin/invite calls do NOT import API_BASE (they hard-code `/api/auth/*`
// etc.), so they always hit app/api directly and are never relay-prefixed.
// ---------------------------------------------------------------------------

type ViteEnv = ImportMeta & {
  env: {
    VITE_API_URL?: string
    VITE_API_MODE?: string
    VITE_DEVICE_ID?: string
  }
}

const viteEnv = ((import.meta as ViteEnv).env ?? {}) as ViteEnv['env']

export type ApiMode = 'direct' | 'relay'

export interface RelayConfig {
  mode: ApiMode
  deviceId: string | null
}

/** Dev/local default: Vite proxy at `/api` (overridable via VITE_API_URL). */
const DIRECT_BASE = viteEnv.VITE_API_URL ?? '/api'

let relayConfig: RelayConfig = {
  mode: viteEnv.VITE_API_MODE === 'relay' ? 'relay' : 'direct',
  deviceId: viteEnv.VITE_DEVICE_ID ?? null,
}

/**
 * Compute the conductor API base for the current relay config.
 * In 'relay' mode with a device id, returns the relative relay path on app/api;
 * otherwise returns the dev direct-proxy default.
 */
export function getApiBase(): string {
  if (relayConfig.mode === 'relay' && relayConfig.deviceId !== null) {
    return `/relay/${relayConfig.deviceId}/api`
  }
  return DIRECT_BASE
}

/**
 * Injection seam (TASK-056): update the relay config at runtime. Recomputes
 * `API_BASE` so the live binding updates for every importer.
 */
export function setRelayConfig(cfg: Partial<RelayConfig>): void {
  relayConfig = { ...relayConfig, ...cfg }
  API_BASE = getApiBase()
}

/** Conductor API base — live binding; recomputed by setRelayConfig(). */
export let API_BASE = getApiBase()

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'))
    throw new Error('Session expired')
  }
  return res
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
  status: 'queued' | 'backlog'
  source: 'manual' | 'schedule'
  scheduleId: number | null
  createdAt: string
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
  createdAt: string;
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
): Promise<unknown> {
  const res = await apiFetch(`${API_BASE}/projects/${projectId.toString()}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(name !== undefined ? { name } : {}),
      ...(launchCmd !== undefined ? { launchCmd } : {}),
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
  }
  return res.json();
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
// ── end Projects ──────────────────────────────────────────────────────────
