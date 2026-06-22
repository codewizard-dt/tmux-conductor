import { useEffect, useState } from 'react'
import { API_BASE } from './api'
import type { Agent } from '../components/AgentList'

interface SessionState {
  session: string
  sessionAlive: boolean
  agents: Agent[]
  timestamp: string
}

/**
 * Live agent list: initial fetch of /status plus SSE updates from /events.
 * Each caller holds its own EventSource — fine for the couple of dashboard
 * islands that need it (the backend supports any number of SSE clients).
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

    const es = new EventSource(`${API_BASE}/events`)

    es.addEventListener('agent-update', (e: MessageEvent) => {
      try {
        const updated = JSON.parse(e.data as string) as Agent
        setAgents((prev) => {
          const idx = prev.findIndex((a) => a.name === updated.name)
          if (idx === -1) return [...prev, updated]
          const next = [...prev]
          next[idx] = { ...next[idx], ...updated }
          return next
        })
      } catch { /* ignore malformed events */ }
    })

    es.addEventListener('agent-removed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { name?: string }
        if (typeof data.name === 'string') {
          setAgents((prev) => prev.filter((a) => a.name !== data.name))
        }
      } catch { /* ignore malformed events */ }
    })

    es.addEventListener('session-update', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { sessionAlive?: boolean }
        if (typeof data.sessionAlive === 'boolean') {
          setSessionAlive(data.sessionAlive)
        }
      } catch { /* ignore malformed events */ }
    })

    return () => { es.close() }
  }, [])

  return { agents, sessionAlive, loading, error }
}
