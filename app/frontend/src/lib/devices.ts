export interface Device {
  id: string
  name: string | null
  createdAt: string
  lastSeenAt: string | null
  revokedAt: string | null
  connected: boolean
}

export async function listDevices(): Promise<Device[]> {
  const res = await fetch('/api/devices', { credentials: 'include' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; error?: string }
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status.toString()}`)
  }
  return res.json() as Promise<Device[]>
}

export async function createPairingCode(): Promise<{ code: string; expiresAt: string }> {
  const res = await fetch('/api/pair/code', { method: 'POST', credentials: 'include' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; error?: string }
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status.toString()}`)
  }
  return res.json() as Promise<{ code: string; expiresAt: string }>
}

export async function renameDevice(id: string, name: string): Promise<Device> {
  const res = await fetch(`/api/devices/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; error?: string }
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status.toString()}`)
  }
  return res.json() as Promise<Device>
}

export async function revokeDevice(id: string): Promise<void> {
  const res = await fetch(`/api/devices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; error?: string }
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status.toString()}`)
  }
}
