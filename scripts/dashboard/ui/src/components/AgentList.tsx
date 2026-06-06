import { useEffect, useState } from 'react'
import '../styles/dashboard.css'
import { API_BASE } from '../lib/api'

// ── Types ─────────────────────────────────────────────────────────────────

export type AgentStatus = 'busy' | 'idle' | 'empty' | 'error' | 'awaiting' | 'unknown'

export interface Agent {
  name: string
  state: string
  windowPresent: boolean
  queuedTasks: number
}

interface SessionState {
  session: string
  sessionAlive: boolean
  agents: Agent[]
  timestamp: string
}

// ── Status helper (exported for reuse in tasks 030–032) ───────────────────

export function getStatusColor(status: AgentStatus): string {
  switch (status) {
    case 'busy':     return '#2563eb'  // blue
    case 'idle':     return '#16a34a'  // green
    case 'empty':    return '#d97706'  // amber
    case 'error':    return '#dc2626'  // red
    case 'awaiting': return '#ca8a04'  // yellow (distinct from amber)
    default:         return '#9ca3af'  // gray
  }
}

export function deriveStatus(agent: Agent): AgentStatus {
  if (agent.state === 'awaiting')                              return 'awaiting'
  if (agent.state === 'busy')                                  return 'busy'
  if (agent.state === 'idle' && agent.queuedTasks > 0)         return 'idle'
  if (agent.state === 'idle' && agent.queuedTasks === 0)       return 'empty'
  if (agent.state === 'error')                                 return 'error'
  return 'unknown'
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  busy:     'busy',
  idle:     'idle',
  empty:    'no tasks',
  error:    'error',
  awaiting: 'awaiting',
  unknown:  'unknown',
}

// ── Sub-components ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AgentStatus }) {
  const title = status === 'empty' ? 'No queued tasks' : undefined
  return (
    <span className={`status-badge status-${status}`} title={title} aria-label={title}>
      <span className="status-dot" />
      {STATUS_LABEL[status]}
    </span>
  )
}

function AgentItem({ agent }: { agent: Agent }) {
  const status = deriveStatus(agent)

  return (
    <details className="agent-item">
      <summary>
        <span className="agent-name">{agent.name}</span>
        <StatusBadge status={status} />
        {status === 'awaiting' && (
          <span
            className="flash awaiting-icon"
            aria-live="polite"
            aria-label="Awaiting user input"
          >!</span>
        )}
      </summary>
      <div className="agent-body">
        <h3>Queued tasks ({agent.queuedTasks})</h3>
        {agent.queuedTasks === 0 ? (
          <p className="no-tasks">No tasks in queue.</p>
        ) : (
          <ul className="task-list">
            {Array.from({ length: agent.queuedTasks }, (_, i) => (
              <li key={i}>Task {i + 1}</li>
            ))}
          </ul>
        )}
        <p className="window-status">
          Window: {agent.windowPresent ? 'present' : 'missing'}
        </p>
      </div>
    </details>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function AgentList() {
  const apiUrl = API_BASE

  const [agents, setAgents] = useState<Agent[]>([])
  const [sessionAlive, setSessionAlive] = useState<boolean>(true)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 1. Initial fetch
    fetch(`${apiUrl}/status`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<SessionState>
      })
      .then((data) => {
        setAgents(data.agents ?? [])
        setSessionAlive(data.sessionAlive ?? true)
        setLoading(false)
      })
      .catch((err) => {
        setError(`Failed to load status: ${err.message}`)
        setLoading(false)
      })

    // 2. SSE subscription
    const es = new EventSource(`${apiUrl}/events`)

    es.addEventListener('agent-update', (e: MessageEvent) => {
      try {
        const updated: Agent = JSON.parse(e.data)
        setAgents((prev) => {
          const idx = prev.findIndex((a) => a.name === updated.name)
          if (idx === -1) return [...prev, updated]
          const next = [...prev]
          next[idx] = { ...next[idx], ...updated }
          return next
        })
      } catch {
        // ignore malformed events
      }
    })

    es.addEventListener('session-update', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        if (typeof data.sessionAlive === 'boolean') {
          setSessionAlive(data.sessionAlive)
        }
      } catch {
        // ignore malformed events
      }
    })

    es.onerror = () => {
      // Connection dropped — SSE will auto-reconnect; no UI change needed
    }

    return () => {
      es.close()
    }
  }, [apiUrl])

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="agent-list">
        <h1>tmux Conductor — Agents</h1>
        <p className="agent-empty">Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="agent-list">
        <h1>tmux Conductor — Agents</h1>
        <p className="session-banner">{error}</p>
      </div>
    )
  }

  if (agents.length === 0 && !sessionAlive) {
    return (
      <div className="agent-list">
        <h1>tmux Conductor — Agents</h1>
        <div className="session-banner">Session not running</div>
      </div>
    )
  }

  return (
    <div className="agent-list">
      <h1>tmux Conductor — Agents</h1>
      {!sessionAlive && (
        <div className="session-banner" style={{ marginBottom: '1rem' }}>
          Session offline — showing last known state
        </div>
      )}
      {agents.length === 0 ? (
        <p className="agent-empty">No agents registered.</p>
      ) : (
        agents.map((agent) => <AgentItem key={agent.name} agent={agent} />)
      )}
    </div>
  )
}
