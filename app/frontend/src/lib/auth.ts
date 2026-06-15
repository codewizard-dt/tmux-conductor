export interface AuthUser {
  id: string
  email: string
  name: string
  image: string | null
  createdAt: string
  updatedAt: string
}

export interface AuthSession {
  user: AuthUser
  session: {
    id: string
    userId: string
    expiresAt: string
    token: string
  }
}

export async function getSession(): Promise<AuthSession | null> {
  const res = await fetch('/api/auth/get-session', { credentials: 'include' })
  if (!res.ok) return null
  return res.json() as Promise<AuthSession | null>
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const res = await fetch('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; error?: string }
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status.toString()}`)
  }
  return res.json() as Promise<AuthSession>
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' })
}

export async function validateInviteCode(code: string): Promise<{ valid: boolean; error?: string }> {
  const res = await fetch('/api/invite-codes/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ code }),
  })
  return res.json() as Promise<{ valid: boolean; error?: string }>
}

export async function signUp({
  name,
  email,
  password,
  inviteCode,
}: {
  name: string
  email: string
  password: string
  inviteCode: string
}): Promise<AuthSession> {
  const res = await fetch('/api/auth/sign-up/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Invite-Code': inviteCode,
    },
    credentials: 'include',
    body: JSON.stringify({ name, email, password }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; error?: string }
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status.toString()}`)
  }
  return res.json() as Promise<AuthSession>
}

export function getInitials(name: string, email: string): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return ((parts[0]![0] ?? '') + (parts[parts.length - 1]![0] ?? '')).toUpperCase()
    return (parts[0]![0] ?? '').toUpperCase()
  }
  return (email?.[0] ?? '?').toUpperCase()
}