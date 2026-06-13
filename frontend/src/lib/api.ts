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
