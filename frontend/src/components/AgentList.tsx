import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { API_BASE } from '../lib/api'
import AddTaskForm from './AddTaskForm'
import LogTail from './LogTail'
import ModeSwitcher from './ModeSwitcher'
import TaskList from './TaskList'

// ── Types ─────────────────────────────────────────────────────────────────

export type AgentStatus =
  | 'busy'
  | 'idle'
  | 'empty'
  | 'error'
  | 'awaiting'
  | 'stalled'
  | 'starting'
  | 'no-window'
  | 'exited'
  | 'unknown'

export type AgentMode = 'default' | 'acceptEdits' | 'plan' | 'bypass' | 'unknown'

export interface Agent {
  name: string
  state: string
  mode: AgentMode
  windowPresent: boolean
  queuedTasks: number
  launchCmd: string
  workdir: string
  linkedBg: string | null
  activeTask: string | null
}

export interface BgProcess {
  name: string
  workdir: string
  launchCmd: string
  windowPresent: boolean
  state: string | null
  logPath: string
  statePath: string
  linkedAgent: string | null
}

interface SessionState {
  session: string
  sessionAlive: boolean
  sessionExists: boolean
  agents: Agent[]
  bgProcesses: BgProcess[]
  timestamp: string
}

// ── Status ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AgentStatus, { bg: string; color: string; dot: string; label: string }> = {
  busy:        { bg: 'rgba(59,110,246,0.10)',  color: '#3b6ef6', dot: '#3b6ef6', label: 'busy' },
  idle:        { bg: 'rgba(48,164,108,0.10)',  color: '#30a46c', dot: '#30a46c', label: 'idle' },
  empty:       { bg: 'rgba(224,144,26,0.10)',  color: '#c07a10', dot: '#e0901a', label: 'no tasks' },
  error:       { bg: 'rgba(229,72,77,0.10)',   color: '#e5484d', dot: '#e5484d', label: 'error' },
  awaiting:    { bg: 'rgba(224,144,26,0.10)',  color: '#c07a10', dot: '#e0901a', label: 'waiting' },
  stalled:     { bg: 'rgba(229,72,77,0.10)',   color: '#e5484d', dot: '#e5484d', label: 'stalled' },
  starting:    { bg: 'rgba(79,90,120,0.08)',   color: '#4f5a78', dot: '#4f5a78', label: 'starting' },
  'no-window': { bg: '#f1f2f4',                color: '#9a9da5', dot: '#9a9da5', label: 'no window' },
  exited:      { bg: 'rgba(229,72,77,0.10)',   color: '#e5484d', dot: '#e5484d', label: 'exited' },
  unknown:     { bg: '#f1f2f4',                color: '#6b6e76', dot: '#9a9da5', label: 'unknown' },
}

export function getStatusColor(status: AgentStatus): string {
  return STATUS_CONFIG[status].dot
}

/** Statuses where the agent is blocked on a human — the interact CTA gets prominent. */
export function needsAttention(status: AgentStatus): boolean {
  return status === 'awaiting' || status === 'stalled'
}

export function deriveStatus(agent: Agent): AgentStatus {
  if (agent.state === 'no-window')                       return 'no-window'
  if (agent.state === 'awaiting')                        return 'awaiting'
  if (agent.state === 'stalled')                         return 'stalled'
  if (agent.state === 'busy')                            return 'busy'
  if (agent.state === 'starting')                        return 'starting'
  if (agent.state === 'idle' && agent.queuedTasks > 0)   return 'idle'
  if (agent.state === 'idle' && agent.queuedTasks === 0) return 'empty'
  if (agent.state === 'error')                           return 'error'
  if (agent.state === 'exited')                          return 'exited'
  return 'unknown'
}

// ── Sub-components ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AgentStatus }) {
  const cfg = STATUS_CONFIG[status]
  const title = status === 'empty' ? 'No queued tasks' : undefined
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
      style={{ background: cfg.bg, color: cfg.color }}
      title={title}
      aria-label={title}
    >
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: cfg.dot }} />
      {cfg.label}
    </span>
  )
}

interface QueueResponse {
  agent: string
  tasks: string[]
}

interface Skill {
  name: string
  title?: string
  description?: string
  userInvocable: boolean
  autoOnly: boolean
  source: 'user' | 'project' | 'plugin'
}

interface SkillsResponse {
  agent: string
  project: Skill[]
  user: Skill[]
}

function SkillBadge({ skill }: { skill: Skill }) {
  return (
    <span className="flex gap-1">
      {skill.source === 'project' && (
        <span className="rounded px-1 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700">project</span>
      )}
      {!skill.userInvocable && (
        <span className="rounded px-1 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700">auto-only</span>
      )}
      {skill.autoOnly && (
        <span className="rounded px-1 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700">manual</span>
      )}
    </span>
  )
}

function SkillRow({ skill, agentName, onQueued }: { skill: Skill; agentName: string; onQueued: (name: string | null) => void }) {
  const handleClick = () => {
    fetch(`${API_BASE}/queue/${encodeURIComponent(agentName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: `/${skill.name}` }),
    })
      .then((r) => { if (r.ok) { onQueued(skill.name); setTimeout(() => { onQueued(null) }, 1500) } })
      .catch(() => { /* ignore */ })
  }
  return (
    <button
      onClick={handleClick}
      className="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-line transition-colors"
    >
      <span className="font-mono text-accent-blue shrink-0">/{skill.name}</span>
      {skill.title && skill.title !== skill.name && (
        <span className="text-muted truncate">{skill.title}</span>
      )}
      {skill.description && (
        <span className="text-muted-2 truncate flex-1" title={skill.description}>{skill.description}</span>
      )}
      <SkillBadge skill={skill} />
    </button>
  )
}

function AgentDetailModal({ agent, status, onClose, armInteract }: {
  agent: Agent
  status: AgentStatus
  onClose: () => void
  armInteract?: boolean
}) {
  const [tasks, setTasks] = useState<string[]>([])
  const [windowError, setWindowError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [interacting, setInteracting] = useState(false)
  // Incrementing signal (re)enables Direct Input in LogTail; seeded by the card CTA.
  const [interactSignal, setInteractSignal] = useState(armInteract ? 1 : 0)
  const [skills, setSkills] = useState<SkillsResponse | null>(null)
  const [queuedSkill, setQueuedSkill] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/queue/${encodeURIComponent(agent.name)}`)
      .then((r) => r.json() as Promise<QueueResponse>)
      .then((data) => { if (!cancelled) setTasks(data.tasks) })
      .catch(() => {})
    fetch(`${API_BASE}/agents/${encodeURIComponent(agent.name)}/skills`)
      .then((r) => r.json() as Promise<SkillsResponse>)
      .then((data) => { if (!cancelled) setSkills(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [agent.name])

  useEffect(() => {
    // While interact mode is active, Escape belongs to the agent's dialog
    // (LogTail forwards it via send-keys) — don't close the modal.
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !interacting) onClose() }
    document.addEventListener('keydown', handler)
    return () => { document.removeEventListener('keydown', handler) }
  }, [onClose, interacting])

  async function handleCreateWindow() {
    setCreating(true)
    setWindowError(null)
    try {
      const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(agent.name)}/window`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
      }
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
      const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(agent.name)}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
      }
      onClose()
    } catch (err: unknown) {
      setRemoveError(err instanceof Error ? err.message : 'Failed to remove agent')
      setRemoving(false)
    }
  }

  async function handleCloseWindow() {
    const confirmed = window.confirm(
      `Close agent "${agent.name}"'s window? The agent stays registered and can be relaunched with "Create window".`,
    )
    if (!confirmed) return
    setClosing(true)
    setCloseError(null)
    try {
      const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(agent.name)}/window`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
      }
    } catch (err: unknown) {
      setCloseError(err instanceof Error ? err.message : 'Failed to close window')
    } finally {
      setClosing(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${agent.name} detail`}>
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-4 flex flex-col overflow-hidden rounded-[14px] bg-white shadow-pop md:inset-8">
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="text-[15px] font-semibold tracking-tight text-ink">{agent.name}</span>
          <StatusBadge status={status} />
          {needsAttention(status) && (
            <span className="animate-flash text-[14px] font-bold leading-none" style={{ color: status === 'stalled' ? '#e5484d' : '#e0901a' }} aria-label="Needs attention">!</span>
          )}
          {queuedSkill && (
            <span className="text-[11px] text-accent-green">/{queuedSkill} queued ✓</span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-muted-2 transition hover:bg-canvas hover:text-ink"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_1.5fr]">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-2">Details</p>
              <dl className="mb-4 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px]">
                <dt className="self-start pt-px text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-2">Command</dt>
                <dd className="m-0 min-w-0"><code className="break-all font-mono text-[11px] text-ink">{agent.launchCmd || '—'}</code></dd>
                <dt className="self-start pt-px text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-2">Workdir</dt>
                <dd className="m-0 min-w-0"><code className="break-all font-mono text-[11px] text-ink">{agent.workdir || '—'}</code></dd>
                <dt className="self-center text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-2">Window</dt>
                <dd className="m-0 text-ink-2">{agent.windowPresent ? 'present' : 'missing'}</dd>
              </dl>

              <ModeSwitcher agentName={agent.name} mode={agent.mode} windowPresent={agent.windowPresent} />

              {!agent.windowPresent && (
                <div className="mb-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { void handleCreateWindow() }}
                    disabled={creating}
                    className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-accent-blue px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
                  >
                    {creating ? 'Creating…' : 'Create window'}
                  </button>
                  {windowError && <span className="text-[11px] text-accent-red">{windowError}</span>}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
                {agent.windowPresent && (
                  <button
                    type="button"
                    onClick={() => { void handleCloseWindow() }}
                    disabled={closing}
                    className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-white px-3 text-[12px] font-medium text-ink transition hover:bg-canvas active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
                    title="Kill the tmux window but keep the agent registered"
                  >
                    {closing ? 'Closing…' : 'Close agent'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { void handleRemove() }}
                  disabled={removing}
                  className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-white px-3 text-[12px] font-medium text-accent-red transition hover:border-accent-red/30 hover:bg-accent-red/5 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
                >
                  {removing ? 'Removing…' : 'Remove agent'}
                </button>
                {closeError && <p className="m-0 text-[11px] text-accent-red">{closeError}</p>}
                {removeError && <p className="m-0 text-[11px] text-accent-red">{removeError}</p>}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-2">
                Queued tasks ({agent.queuedTasks})
              </p>
              <TaskList agentName={agent.name} tasks={tasks} onReorder={setTasks} />
              <AddTaskForm agentName={agent.name} onAdded={(task) => { setTasks((prev) => [...prev, task]) }} />
            </div>
          </div>

          <div className="mt-5 border-t border-line pt-4">
            {needsAttention(status) && (
              <div
                className="mb-3 flex flex-col gap-3 rounded-[10px] border px-4 py-3 text-[13px] font-medium sm:flex-row sm:items-center"
                style={status === 'stalled'
                  ? { borderColor: 'rgba(229,72,77,0.25)', background: 'rgba(229,72,77,0.06)', color: '#a02a2e' }
                  : { borderColor: 'rgba(224,144,26,0.25)', background: 'rgba(224,144,26,0.06)', color: '#7a4c06' }}
              >
                <span className="flex-1">
                  {status === 'stalled'
                    ? 'Agent appears stuck in an unrecognized state — use Direct Input to send it keystrokes.'
                    : 'Agent is waiting for your input — Direct Input sends your keystrokes straight to its tmux pane.'}
                </span>
                <button
                  type="button"
                  onClick={() => { setInteractSignal((s) => s + 1) }}
                  className="inline-flex h-9 flex-shrink-0 animate-pulse cursor-pointer items-center justify-center gap-2 rounded-[8px] px-5 text-[13px] font-bold uppercase tracking-[0.06em] text-white shadow-card transition hover:opacity-85 active:scale-[0.985]"
                  style={{ background: status === 'stalled' ? '#e5484d' : '#e0901a' }}
                >
                  <span aria-hidden="true">⌨</span>
                  Direct Input
                </button>
              </div>
            )}
            <LogTail agentName={agent.name} interactSignal={interactSignal} onInteractChange={setInteracting} pollMs={100} />
          </div>

          {/* Skills section */}
          {skills && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-muted select-none">
                Skills ({skills.project.length + skills.user.length})
              </summary>
              <div className="mt-2 space-y-3">
                {/* Project skills — expanded */}
                {skills.project.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-2">Project</div>
                    {skills.project.map((skill) => (
                      <SkillRow key={skill.name} skill={skill} agentName={agent.name} onQueued={setQueuedSkill} />
                    ))}
                  </div>
                )}
                {/* User skills — collapsed */}
                <details>
                  <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-muted-2 select-none">
                    User ({skills.user.length})
                  </summary>
                  <div className="mt-1">
                    {skills.user.map((skill) => (
                      <SkillRow key={skill.name} skill={skill} agentName={agent.name} onQueued={setQueuedSkill} />
                    ))}
                  </div>
                </details>
              </div>
            </details>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function AgentItem({ agent, onExpand, isColumnOpen, onOpen, onClose }: {
  agent: Agent
  onExpand: (armInteract: boolean) => void
  isColumnOpen: boolean
  onOpen: () => void
  onClose?: () => void
}) {
  const status = deriveStatus(agent)

  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<string[]>([])
  const [windowError, setWindowError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)

  const detailsRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (!isColumnOpen && detailsRef.current?.open) {
      detailsRef.current.removeAttribute('open')
      setOpen(false)
    }
  }, [isColumnOpen])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch(`${API_BASE}/queue/${encodeURIComponent(agent.name)}`)
      .then((r) => r.json() as Promise<QueueResponse>)
      .then((data) => { if (!cancelled) setTasks(data.tasks) })
      .catch(() => { /* transient error — leave tasks as-is */ })
    return () => { cancelled = true }
  }, [open, agent.queuedTasks, agent.name])

  async function handleCreateWindow() {
    setCreating(true)
    setWindowError(null)
    try {
      const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(agent.name)}/window`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
      }
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
      const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(agent.name)}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
      }
    } catch (err: unknown) {
      setRemoveError(err instanceof Error ? err.message : 'Failed to remove agent')
      setRemoving(false)
    }
  }

  async function handleCloseWindow() {
    const confirmed = window.confirm(
      `Close agent "${agent.name}"'s window? The agent stays registered and can be relaunched with "Create window".`,
    )
    if (!confirmed) return
    setClosing(true)
    setCloseError(null)
    try {
      const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(agent.name)}/window`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
      }
    } catch (err: unknown) {
      setCloseError(err instanceof Error ? err.message : 'Failed to close window')
    } finally {
      setClosing(false)
    }
  }

  return (
    <details
      ref={detailsRef}
      className="mb-2 animate-popIn overflow-hidden rounded-[10px] border border-line bg-white shadow-card transition-shadow last:mb-0 hover:shadow-card-hover"
      onToggle={(e: SyntheticEvent<HTMLDetailsElement>) => {
        const isOpen = e.currentTarget.open
        setOpen(isOpen)
        if (isOpen) onOpen()
        else onClose?.()
      }}
    >
      <summary className="flex cursor-pointer select-none list-none items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-canvas [&::-webkit-details-marker]:hidden">
        <span
          className="flex-shrink-0 text-[9px] text-muted-2 transition-transform duration-150"
          style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none' }}
        >▶</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold tracking-tight text-ink">{agent.name}</span>
          {agent.activeTask && (
            <span className="block truncate font-mono text-[10px] text-muted-2" title={agent.activeTask}>
              {agent.activeTask}
            </span>
          )}
        </span>
        {needsAttention(status) && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onExpand(true) }}
            className="flex-shrink-0 animate-pulse cursor-pointer rounded-pill px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-white transition hover:opacity-85"
            style={{ background: status === 'stalled' ? '#e5484d' : '#e0901a' }}
            aria-label={`Direct Input to ${agent.name} — it needs your input`}
          >
            Direct Input
          </button>
        )}
        <StatusBadge status={status} />
        <button
          type="button"
          title="Expand"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onExpand(false) }}
          className="flex-shrink-0 rounded-[5px] p-0.5 text-muted-2 transition hover:bg-line hover:text-ink"
          aria-label="Expand agent detail"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M2 8v3h3M11 5V2H8M2 5V2h3M11 8v3H8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {needsAttention(status) && (
          <span
            className="ml-0.5 animate-flash text-[14px] font-bold leading-none"
            style={{ color: status === 'stalled' ? '#e5484d' : '#e0901a' }}
            aria-live="polite"
            aria-label="Needs attention"
          >!</span>
        )}
      </summary>

      <div className="border-t border-line bg-white px-3.5 pb-3.5 pt-3">
        <dl className="mb-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          <dt className="self-center text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-2">Command</dt>
          <dd className="m-0 min-w-0"><code className="break-all font-mono text-[11px] text-ink">{agent.launchCmd || '—'}</code></dd>
          <dt className="self-center text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-2">Workdir</dt>
          <dd className="m-0 min-w-0"><code className="break-all font-mono text-[11px] text-ink">{agent.workdir || '—'}</code></dd>
          <dt className="self-center text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-2">Window</dt>
          <dd className="m-0 text-ink-2">{agent.windowPresent ? 'present' : 'missing'}</dd>
          {agent.linkedBg && (
            <>
              <dt className="self-center text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-2">Linked bg</dt>
              <dd className="m-0 flex items-center gap-1.5">
                <code className="font-mono text-[11px] text-ink">{agent.linkedBg}</code>
              </dd>
            </>
          )}
        </dl>

        <ModeSwitcher agentName={agent.name} mode={agent.mode} windowPresent={agent.windowPresent} />

        {!agent.windowPresent && (
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void handleCreateWindow() }}
              disabled={creating}
              className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-accent-blue px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
            >
              {creating ? 'Creating…' : 'Create window'}
            </button>
            {windowError && <span className="text-[11px] text-accent-red">{windowError}</span>}
          </div>
        )}

        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-2">
          Queued tasks ({agent.queuedTasks})
        </p>
        <TaskList agentName={agent.name} tasks={tasks} onReorder={setTasks} />
        <AddTaskForm agentName={agent.name} onAdded={(task) => { setTasks((prev) => [...prev, task]) }} />

        <div className="mt-3 border-t border-line pt-2.5">
          {open && <LogTail agentName={agent.name} maxHeightClass="max-h-[280px]" />}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
          {agent.windowPresent && (
            <button
              type="button"
              onClick={() => { void handleCloseWindow() }}
              disabled={closing}
              className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-white px-3 text-[12px] font-medium text-ink transition hover:bg-canvas active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
              title="Kill the tmux window but keep the agent registered"
            >
              {closing ? 'Closing…' : 'Close agent'}
            </button>
          )}
          <button
            type="button"
            onClick={() => { void handleRemove() }}
            disabled={removing}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-white px-3 text-[12px] font-medium text-accent-red transition hover:border-accent-red/30 hover:bg-accent-red/5 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          >
            {removing ? 'Removing…' : 'Remove agent'}
          </button>
          {closeError && <span className="text-[11px] text-accent-red">{closeError}</span>}
          {removeError && <span className="text-[11px] text-accent-red">{removeError}</span>}
        </div>
      </div>
    </details>
  )
}

// ── Board ─────────────────────────────────────────────────────────────────

interface BoardColumn {
  key: string
  title: string
  statuses: AgentStatus[]
}

// no-window/exited/error/unknown agents are NOT board columns — they appear in
// AddAgentForm's "Inactive Agents" list with Wake/Remove actions.
const BOARD_COLUMNS: BoardColumn[] = [
  { key: 'awaiting', title: 'Waiting', statuses: ['awaiting', 'stalled'] },
  { key: 'running',  title: 'Running',  statuses: ['busy', 'starting'] },
  { key: 'ready',    title: 'Ready',    statuses: ['idle', 'empty'] },
]

// ── Session banner ────────────────────────────────────────────────────────

// Shown whenever the monitor window is gone. Two flavours: the session still
// exists (backend auto-heals the monitor; button is a manual fallback) or the
// whole session is gone (button runs conductor.sh via the backend).
function SessionBanner({ sessionExists }: { sessionExists: boolean }) {
  const [starting, setStarting] = useState<boolean>(false)
  const [startError, setStartError] = useState<string | null>(null)

  async function handleStart() {
    setStarting(true)
    setStartError(null)
    try {
      const res = await fetch(`${API_BASE}/session/start`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
      }
    } catch (err: unknown) {
      setStartError(err instanceof Error ? err.message : 'Failed to start session')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-accent-amber/20 bg-accent-amber/5 px-4 py-3 text-[13px] font-medium" style={{ color: '#7a4c06' }}>
      <span>
        {sessionExists ? 'Monitor offline — restarting…' : 'Session offline — showing last known state'}
        {startError && <span className="ml-2 font-normal" style={{ color: '#e5484d' }}>{startError}</span>}
      </span>
      <button
        type="button"
        onClick={() => { void handleStart() }}
        disabled={starting}
        className="inline-flex h-7 flex-shrink-0 cursor-pointer items-center rounded-[7px] bg-accent-blue px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
      >
        {starting
          ? (sessionExists ? 'Reconnecting…' : 'Starting…')
          : (sessionExists ? 'Reconnect' : 'Start session')}
      </button>
    </div>
  )
}

// ── Background processes ──────────────────────────────────────────────────

// One row per BG_PROCESSES entry. When the window has died, the row turns
// amber and offers the choice: respawn the window or remove the definition
// from conductor.conf entirely.
function BgProcessRow({ bg }: { bg: BgProcess }) {
  const [acting, setActing] = useState<'open' | 'remove' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function callApi(path: string, method: string, kind: 'open' | 'remove') {
    setActing(kind)
    setActionError(null)
    try {
      const res = await fetch(`${API_BASE}${path}`, { method })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setActing(null)
    }
  }

  function handleRemove() {
    const confirmed = window.confirm(
      `Remove background process "${bg.name}"? This kills its tmux window (if any) and deletes it from conductor.conf.`,
    )
    if (!confirmed) return
    void callApi(`/bg-processes/${encodeURIComponent(bg.name)}`, 'DELETE', 'remove')
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border px-4 py-3 ${bg.windowPresent ? 'border-line bg-canvas' : 'border-accent-amber/30 bg-accent-amber/5'}`}>
      <span className="font-mono text-[13px] font-medium text-ink">{bg.name}</span>
      <span
        className="inline-flex items-center rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
        style={bg.windowPresent
          ? { background: 'rgba(48,164,108,0.10)', color: '#30a46c' }
          : { background: 'rgba(224,144,26,0.10)', color: '#c07a10' }}
      >
        {bg.windowPresent ? 'running' : 'window missing'}
      </span>
      <span className="truncate font-mono text-[11px] text-muted-2" title={`${bg.launchCmd} (in ${bg.workdir})`}>{bg.launchCmd}</span>
      {bg.linkedAgent && <span className="text-[11px] text-muted">linked to {bg.linkedAgent}</span>}
      {!bg.windowPresent && (
        <div className="ml-auto flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => { void callApi(`/bg-processes/${encodeURIComponent(bg.name)}/window`, 'POST', 'open') }}
            disabled={acting !== null}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-accent-blue px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          >
            {acting === 'open' ? 'Opening…' : 'Open window'}
          </button>
          <button
            type="button"
            onClick={handleRemove}
            disabled={acting !== null}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-white px-3 text-[12px] font-medium text-accent-red transition hover:border-accent-red/30 hover:bg-accent-red/5 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          >
            {acting === 'remove' ? 'Removing…' : 'Remove definition'}
          </button>
        </div>
      )}
      {actionError && <span className="w-full text-[12px]" style={{ color: '#e5484d' }}>{actionError}</span>}
    </div>
  )
}

function BgProcessSection({ bgs }: { bgs: BgProcess[] }) {
  if (bgs.length === 0) return null
  return (
    <div className="mt-6">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Background processes</h2>
      <div className="flex flex-col gap-2">
        {bgs.map((bg) => <BgProcessRow key={bg.name} bg={bg} />)}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────

export default function AgentList() {
  const apiUrl = API_BASE

  const [agents, setAgents] = useState<Agent[]>([])
  const [bgs, setBgs] = useState<BgProcess[]>([])
  const [sessionAlive, setSessionAlive] = useState<boolean>(true)
  const [sessionExists, setSessionExists] = useState<boolean>(true)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  // Modal state lives here (not in AgentItem) so it survives the agent moving
  // between board columns — a status change remounts AgentItem but not us.
  const [expandedAgent, setExpandedAgent] = useState<{ name: string; armInteract: boolean } | null>(null)
  const [openByColumn, setOpenByColumn] = useState<Record<string, string | null>>({})

  useEffect(() => {
    fetch(`${apiUrl}/status`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status.toString()}`)
        return r.json() as Promise<SessionState>
      })
      .then((data) => {
        setAgents(data.agents)
        setBgs(data.bgProcesses)
        setSessionAlive(data.sessionAlive)
        setSessionExists(data.sessionExists)
        setLoading(false)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        setError(`Failed to load status: ${msg}`)
        setLoading(false)
      })

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

    es.addEventListener('bg-update', (e: MessageEvent) => {
      try {
        const updated = JSON.parse(e.data as string) as BgProcess
        setBgs((prev) => {
          const idx = prev.findIndex((b) => b.name === updated.name)
          if (idx === -1) return [...prev, updated]
          const next = [...prev]
          next[idx] = { ...next[idx], ...updated }
          return next
        })
      } catch { /* ignore malformed events */ }
    })

    es.addEventListener('bg-removed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { name?: string }
        if (typeof data.name === 'string') {
          setBgs((prev) => prev.filter((b) => b.name !== data.name))
        }
      } catch { /* ignore malformed events */ }
    })

    es.addEventListener('session-update', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { sessionAlive?: boolean; sessionExists?: boolean }
        if (typeof data.sessionAlive === 'boolean') {
          setSessionAlive(data.sessionAlive)
        }
        if (typeof data.sessionExists === 'boolean') {
          setSessionExists(data.sessionExists)
        }
      } catch { /* ignore malformed events */ }
    })

    return () => { es.close() }
  }, [apiUrl])

  const expandedModalAgent = expandedAgent ? agents.find((a) => a.name === expandedAgent.name) : undefined

  const sectionLabelCls = 'mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted'

  if (loading) {
    return (
      <div>
        <h1 className={sectionLabelCls}>tmux Conductor — Agents</h1>
        <p className="animate-pulse text-[13px] italic text-muted-2">Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className={sectionLabelCls}>tmux Conductor — Agents</h1>
        <div className="rounded-[10px] border border-accent-red/20 bg-accent-red/5 px-4 py-3 text-[13px] text-accent-red">{error}</div>
      </div>
    )
  }

  if (agents.length === 0 && !sessionAlive) {
    return (
      <div>
        <h1 className={sectionLabelCls}>tmux Conductor — Agents</h1>
        <SessionBanner sessionExists={sessionExists} />
      </div>
    )
  }

  return (
    <div className="animate-riseIn">
      <h1 className={sectionLabelCls}>tmux Conductor — Agents</h1>
      {!sessionAlive && <SessionBanner sessionExists={sessionExists} />}
      {agents.length === 0 ? (
        <p className="text-[13px] italic text-muted-2">No agents registered.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] items-start gap-3">
          {BOARD_COLUMNS.map((col) => {
            const inColumn = agents.filter((a) => col.statuses.includes(deriveStatus(a)))
            return (
              <section
                key={col.key}
                className="animate-popIn rounded-card border border-line bg-canvas p-3.5"
              >
                <h2 className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  {col.title}
                  <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-line px-1 text-[10px] font-semibold text-muted">
                    {inColumn.length}
                  </span>
                </h2>
                {inColumn.length === 0 ? (
                  <p className="text-center text-[12px] text-muted-2">—</p>
                ) : (
                  inColumn.map((agent) => (
                    <AgentItem
                      key={agent.name}
                      agent={agent}
                      onExpand={(armInteract) => { setExpandedAgent({ name: agent.name, armInteract }) }}
                      isColumnOpen={openByColumn[col.key] === agent.name}
                      onOpen={() => { setOpenByColumn((prev) => ({ ...prev, [col.key]: agent.name })) }}
                      onClose={() => { setOpenByColumn((prev) => prev[col.key] === agent.name ? { ...prev, [col.key]: null } : prev) }}
                    />
                  ))
                )}
              </section>
            )
          })}
        </div>
      )}
      <BgProcessSection bgs={bgs} />
      {/* Rendered from live `agents` state so the badge/banner keep updating
          while open; if the agent is removed, the lookup empties and the
          modal disappears. */}
      {expandedModalAgent && expandedAgent && (
        <AgentDetailModal
          agent={expandedModalAgent}
          status={deriveStatus(expandedModalAgent)}
          armInteract={expandedAgent.armInteract}
          onClose={() => { setExpandedAgent(null) }}
        />
      )}
    </div>
  )
}