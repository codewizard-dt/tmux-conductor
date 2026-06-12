import { useEffect, useState, type SyntheticEvent } from 'react'
import '../styles/dashboard.css'
import { API_BASE } from '../lib/api'
import AddTaskForm from './AddTaskForm'
import TaskList from './TaskList'

// ── Types ─────────────────────────────────────────────────────────────────

export type AgentStatus =
  | 'busy'
  | 'idle'
  | 'empty'
  | 'error'
  | 'awaiting'
  | 'starting'
  | 'no-window'
  | 'unknown'

export interface Agent {
  name: string
  state: string
  windowPresent: boolean
  queuedTasks: number
  launchCmd: string
  workdir: string
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
    case 'busy':      return '#2563eb'  // blue
    case 'idle':      return '#16a34a'  // green
    case 'empty':     return '#d97706'  // amber
    case 'error':     return '#dc2626'  // red
    case 'awaiting':  return '#ca8a04'  // yellow (distinct from amber)
    case 'starting':  return '#0891b2'  // cyan
    case 'no-window': return '#6b7280'  // slate
    default:          return '#9ca3af'  // gray
  }
}

export function deriveStatus(agent: Agent): AgentStatus {
  // The backend now resolves a concrete status (detectAgentStatus); the only
  // refinement done here is splitting an idle agent into idle/empty by queue depth.
  if (agent.state === 'no-window')                            return 'no-window'
  if (agent.state === 'awaiting')                             return 'awaiting'
  if (agent.state === 'busy')                                 return 'busy'
  if (agent.state === 'starting')                             return 'starting'
  if (agent.state === 'idle' && agent.queuedTasks > 0)        return 'idle'
  if (agent.state === 'idle' && agent.queuedTasks === 0)      return 'empty'
  if (agent.state === 'error')                                return 'error'
  return 'unknown'
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  busy:        'busy',
  idle:        'idle',
  empty:       'no tasks',
  error:       'error',
  awaiting:    'awaiting',
  starting:    'starting',
  'no-window': 'no window',
  unknown:     'unknown',
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

interface QueueResponse {
  agent: string
  tasks: string[]
}

interface DiffResponse {
  isRepo: boolean
  changedFiles: string[]
  stat: string
  diff: string
}

function AgentItem({ agent }: { agent: Agent }) {
  const status = deriveStatus(agent)

  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<string[]>([])
  const [diff, setDiff] = useState<DiffResponse | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [windowError, setWindowError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  // Lazy-load the queue when the panel is open; re-load when the dispatch loop
  // changes the queue depth (queuedTasks arrives via SSE).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch(`${API_BASE}/queue/${encodeURIComponent(agent.name)}`)
      .then((r) => r.json() as Promise<QueueResponse>)
      .then((data) => { if (!cancelled) setTasks(data.tasks) })
      .catch(() => { /* leave tasks as-is on transient error */ })
    return () => { cancelled = true }
  }, [open, agent.queuedTasks, agent.name])

  function loadDiff() {
    setDiffLoading(true)
    fetch(`${API_BASE}/agents/${encodeURIComponent(agent.name)}/diff`)
      .then((r) => r.json() as Promise<DiffResponse>)
      .then((data) => { setDiff(data) })
      .catch(() => { setDiff(null) })
      .finally(() => { setDiffLoading(false) })
  }

  function toggleDiff() {
    const next = !showDiff
    setShowDiff(next)
    if (next) loadDiff()
  }

  async function handleCreateWindow() {
    setCreating(true)
    setWindowError(null)
    try {
      const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(agent.name)}/window`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
      }
      // windowPresent / status flip back via the SSE poll loop
    } catch (err: unknown) {
      setWindowError(err instanceof Error ? err.message : 'Failed to create window')
    } finally {
      setCreating(false)
    }
  }

  async function handleRemove() {
    const confirmed = window.confirm(
      `Remove agent "${agent.name}"? This kills its tmux window, deletes it from conductor.conf, and drops its queued tasks.`,
    )
    if (!confirmed) return
    setRemoving(true)
    setRemoveError(null)
    try {
      const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(agent.name)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
      }
      // the card disappears via the 'agent-removed' SSE event
    } catch (err: unknown) {
      setRemoveError(err instanceof Error ? err.message : 'Failed to remove agent')
      setRemoving(false)
    }
  }

  return (
    <details
      className="agent-item"
      onToggle={(e: SyntheticEvent<HTMLDetailsElement>) => { setOpen(e.currentTarget.open) }}
    >
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
        <dl className="agent-meta">
          <dt>Command</dt>
          <dd><code>{agent.launchCmd || '—'}</code></dd>
          <dt>Workdir</dt>
          <dd><code>{agent.workdir || '—'}</code></dd>
          <dt>Window</dt>
          <dd>{agent.windowPresent ? 'present' : 'missing'}</dd>
        </dl>

        {!agent.windowPresent && (
          <div className="window-action">
            <button type="button" onClick={() => { void handleCreateWindow() }} disabled={creating}>
              {creating ? 'Creating…' : 'Create window'}
            </button>
            {windowError && <span className="window-error">{windowError}</span>}
          </div>
        )}

        <h3>Queued tasks ({agent.queuedTasks})</h3>
        <TaskList agentName={agent.name} tasks={tasks} onReorder={setTasks} />
        <AddTaskForm agentName={agent.name} onAdded={(task) => { setTasks((prev) => [...prev, task]) }} />

        <div className="diff-section">
          <button type="button" className="diff-toggle" onClick={toggleDiff}>
            {showDiff ? '▾ Hide changes' : '▸ Show changes'}
          </button>
          {showDiff && (
            diffLoading ? (
              <p className="diff-empty">Loading…</p>
            ) : diff === null ? (
              <p className="diff-empty">Could not load diff.</p>
            ) : !diff.isRepo ? (
              <p className="diff-empty">Workdir is not a git repository.</p>
            ) : diff.changedFiles.length === 0 ? (
              <p className="diff-empty">No uncommitted changes.</p>
            ) : (
              <>
                <ul className="diff-files">
                  {diff.changedFiles.map((f, i) => (
                    <li key={i}><code>{f}</code></li>
                  ))}
                </ul>
                <pre className="diff-body">{diff.diff}</pre>
              </>
            )
          )}
        </div>

        <div className="remove-action">
          <button type="button" onClick={() => { void handleRemove() }} disabled={removing}>
            {removing ? 'Removing…' : 'Remove agent'}
          </button>
          {removeError && <span className="window-error">{removeError}</span>}
        </div>
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

    // 2. SSE subscription
    const es = new EventSource(`${apiUrl}/events`)

    es.addEventListener('agent-update', (e: MessageEvent) => {
      try {
        const updated: Agent = JSON.parse(e.data as string) as Agent
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

    es.addEventListener('agent-removed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { name?: string }
        if (typeof data.name === 'string') {
          setAgents((prev) => prev.filter((a) => a.name !== data.name))
        }
      } catch {
        // ignore malformed events
      }
    })

    es.addEventListener('session-update', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { sessionAlive?: boolean }
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
        <div className="agent-board">
          {BOARD_COLUMNS.map((col) => {
            const inColumn = agents.filter((a) => col.statuses.includes(deriveStatus(a)))
            return (
              <section className="board-column" key={col.key}>
                <h2 className="board-column-title">{col.title} <span className="board-count">{inColumn.length}</span></h2>
                {inColumn.length === 0 ? (
                  <p className="board-empty">—</p>
                ) : (
                  inColumn.map((agent) => <AgentItem key={agent.name} agent={agent} />)
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface BoardColumn {
  key: string
  title: string
  statuses: AgentStatus[]
}

// Cross-agent status board. Every AgentStatus maps into exactly one column so
// no agent can be dropped or double-counted.
const BOARD_COLUMNS: BoardColumn[] = [
  { key: 'awaiting', title: 'Awaiting', statuses: ['awaiting'] },
  { key: 'running',  title: 'Running',  statuses: ['busy', 'starting'] },
  { key: 'ready',    title: 'Ready',    statuses: ['idle', 'empty'] },
  { key: 'offline',  title: 'Offline',  statuses: ['no-window', 'error', 'unknown'] },
]
