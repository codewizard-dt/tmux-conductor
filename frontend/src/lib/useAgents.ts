import { useEffect, useState } from 'react'
import { API_BASE } from './api'
import type { Agent } from '../components/AgentList'
import { useSSEEvent } from '../hooks/useSSE'

interface SessionState {
  session: string
  sessionAlive: boolean
  agents: Agent[]
  timestamp: string
}

/**
 * Live agent list: initial fetch of /status plus SSE updates from /events.
 * SSE subscriptions share the module-level EventSource from useSSEEvent.
 */
export function useAgents(): { agents: Agent[]; sessionAlive: boolean; loading: boolean; error: string | null } {
  const [agents, setAgents] = useState<Agent[]>([])
  const [sessionAlive, setSessionAlive] = useState<boolean>(true)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/status`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status.toString()}`)
        return r.json() as Promise<SessionState>
      })
      .then((data) => {
        setAgents(data.agents)
        setSessionAlive(data.sessionAlive)
        setLoading(false)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        setError(`Failed to load status: ${msg}`)
        setLoading(false)
      })

  }, [])

  useSSEEvent<Agent>('agent-update', (updated) => {
    setAgents((prev) => {
      const idx = prev.findIndex((a) => a.id === updated.id)
      if (idx === -1) return [...prev, updated]
      const next = [...prev]
      next[idx] = { ...next[idx], ...updated }
      return next
    })
  })

  useSSEEvent<{ id?: number; name?: string }>('agent-removed', (data) => {
    if (typeof data.id === 'number') {
      setAgents((prev) => prev.filter((a) => a.id !== data.id))
    }
  })

  useSSEEvent<{ sessionAlive?: boolean }>('session-update', (data) => {
    if (typeof data.sessionAlive === 'boolean') {
      setSessionAlive(data.sessionAlive)
    }
  })

  return { agents, sessionAlive, loading, error }
}
