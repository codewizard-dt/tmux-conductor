import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { API_BASE, addTask, renameAgent, type Task } from '../lib/api'
import AddTaskForm from './AddTaskForm'
import ErrorBoundary from './ErrorBoundary'
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
export type AgentType = 'claude' | 'codex' | 'custom'

export interface Agent {
  id: number
  name: string
  projectId: number | null
  projectName: string | null
  state: string
  mode: AgentMode
  agentType?: AgentType
  windowPresent: boolean
  queuedTasks: number
  launchCmd: string
  workdir: string
  linkedBg: string | null
  activeTask: string | null
  label?: string | null
  model?: string | null
  modelId?: string | null
  contextTokens?: number | null
  contextPct?: number | null
  contextLimit?: number | null
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
  busy: { bg: 'rgba(59,110,246,0.10)', color: '#3b6ef6', dot: '#3b6ef6', label: 'busy' },
  idle: { bg: 'rgba(48,164,108,0.10)', color: '#30a46c', dot: '#30a46c', label: 'idle' },
  empty: { bg: 'rgba(224,144,26,0.10)', color: '#c07a10', dot: '#e0901a', label: 'no tasks' },
  error: { bg: 'rgba(229,72,77,0.10)', color: '#e5484d', dot: '#e5484d', label: 'error' },
  awaiting: { bg: 'rgba(224,144,26,0.10)', color: '#c07a10', dot: '#e0901a', label: 'waiting' },
  stalled: { bg: 'rgba(229,72,77,0.10)', color: '#e5484d', dot: '#e5484d', label: 'stalled' },
  starting: { bg: 'rgba(79,90,120,0.08)', color: '#4f5a78', dot: '#4f5a78', label: 'starting' },
  'no-window': { bg: '#f1f2f4', color: '#9a9da5', dot: '#9a9da5', label: 'no window' },
  exited: { bg: 'rgba(229,72,77,0.10)', color: '#e5484d', dot: '#e5484d', label: 'exited' },
  unknown: { bg: '#f1f2f4', color: '#6b6e76', dot: '#9a9da5', label: 'unknown' },
}

export function getStatusColor(status: AgentStatus): string {
  return STATUS_CONFIG[status].dot
}

/** Statuses where the agent is blocked on a human — the interact CTA gets prominent. */
export function needsAttention(status: AgentStatus): boolean {
  return status === 'awaiting' || status === 'stalled'
}

export function deriveStatus(agent: Agent): AgentStatus {
  if (agent.state === 'no-window') return 'no-window'
  if (agent.state === 'awaiting') return 'awaiting'
  if (agent.state === 'stalled') return 'stalled'
  if (agent.state === 'busy') return 'busy'
  if (agent.state === 'starting') return 'starting'
  if (agent.state === 'idle' && agent.queuedTasks > 0) return 'idle'
  if (agent.state === 'idle' && agent.queuedTasks === 0) return 'empty'
  if (agent.state === 'error') return 'error'
  if (agent.state === 'exited') return 'exited'
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

function inferAgentType(agent: Agent): AgentType | null {
  if (agent.agentType === 'claude' || agent.agentType === 'codex') return agent.agentType
  const cmd = agent.launchCmd
    .trim()
    .split(/\s+/)
    .find((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
  const parts = (cmd ?? '').split('/')
  const name = parts[parts.length - 1]?.toLowerCase()
  if (name === 'claude' || name === 'codex') return name
  return null
}

function AgentTypeBadge({ agent }: { agent: Agent }) {
  const type = inferAgentType(agent)
  if (type === null) return null
  const palette = type === 'claude'
    ? { bg: 'rgba(126,87,194,0.10)', color: '#5b21b6', dot: '#7e57c2' }
    : { bg: 'rgba(20,126,105,0.10)', color: '#0f766e', dot: '#14a38b' }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
      style={{ background: palette.bg, color: palette.color }}
      title={`Agent type: ${type}`}
    >
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: palette.dot }} />
      {type}
    </span>
  )
}

/** Deterministic hue (0–359) from a project name so each project keeps a stable badge color. */
function projectHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

/** Small colored pill identifying an agent's project. `null` name → neutral "Unassigned". */
function ProjectBadge({ name }: { name: string | null }) {
  if (name === null) {
    return (
      <span
        className="inline-flex flex-shrink-0 items-center rounded-pill bg-[#f1f2f4] px-2 py-0.5 text-[11px] font-semibold text-[#9a9da5]"
        title="No project assigned"
      >
        Unassigned
      </span>
    )
  }
  const hue = projectHue(name)
  return (
    <span
      className="inline-flex flex-shrink-0 items-center rounded-pill px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: `hsl(${String(hue)} 65% 94%)`, color: `hsl(${String(hue)} 55% 32%)` }}
      title={`Project: ${name}`}
    >
      {name}
    </span>
  )
}

/** Color for the context-fill bar: green under 70%, amber 70–90%, red above. */
function contextColor(pct: number): string {
  if (pct >= 90) return '#e5484d'
  if (pct >= 70) return '#c07a10'
  return '#30a46c'
}

/** Compact token count, e.g. 55336 → "55k". */
function formatTokens(n: number): string {
  if (n >= 1000) return `${String(Math.round(n / 1000))}k`
  return String(n)
}

function modelForAgentType(type: AgentType, model: string | null | undefined): string | null {
  if (!model) return null
  const normalized = model.toLowerCase()
  const isClaudeModel = /^(opus|sonnet|haiku|fable)\b/.test(normalized) || normalized.startsWith('claude-')
  const isCodexModel = normalized.startsWith('gpt-') || normalized.startsWith('o') || normalized.includes('codex')
  if (type === 'codex') return isClaudeModel ? null : model
  if (type === 'claude') return isCodexModel ? null : model
  return null
}

/** Model chip + thin context-fill bar. Shows model chip alone when contextPct is unknown. */
function ContextMeter({ agent, detailed = false }: { agent: Agent; detailed?: boolean }) {
  const type = inferAgentType(agent)
  if (type !== 'claude' && type !== 'codex') return null

  const pct = agent.contextPct
  const model = modelForAgentType(type, agent.model)

  if (pct == null && (!model || !detailed)) return null

  // Model chip only — no context data yet (new session, after /clear)
  if (pct == null) {
    return (
      <span className="rounded-pill bg-[#f1f2f4] px-1.5 py-0.5 text-[10px] font-semibold text-[#4f5a78]">
        {model}
      </span>
    )
  }

  const color = contextColor(pct)
  const limit = agent.contextLimit ?? 200000
  const tokenLabel =
    agent.contextTokens != null ? `${formatTokens(agent.contextTokens)} / ${formatTokens(limit)}` : null
  const title = `${String(pct)}% of context window used${tokenLabel ? ` (${tokenLabel})` : ''}`
  return (
    <div className="flex items-center gap-1.5" title={title} aria-label={title}>
      {model && detailed && (
        <span className="rounded-pill bg-[#f1f2f4] px-1.5 py-0.5 text-[10px] font-semibold text-[#4f5a78]">
          {model}
        </span>
      )}
      <div className="flex items-center gap-1">
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-[#e8e9ec]">
          <div className="h-full rounded-full" style={{ width: `${String(pct)}%`, background: color }} />
        </div>
        <span className="text-[10px] font-semibold tabular-nums" style={{ color }}>
          {pct}%
        </span>
      </div>
      {detailed && tokenLabel && (
        <span className="text-[10px] tabular-nums text-[#9a9da5]">{tokenLabel}</span>
      )}
    </div>
  )
}

interface QueueResponse {
  agent: string
  tasks: Task[]
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

function SkillRow({ skill, agentId, onQueued }: { skill: Skill; agentId: number; onQueued: (name: string | null) => void }) {
  const handleClick = () => {
    addTask(`/${skill.name}`, { agentId })
      .then(() => { onQueued(skill.name); setTimeout(() => { onQueued(null) }, 1500) })
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

function AgentDetailModal({ agent, project, projectId, status, onClose, armInteract, agentCount, onNavigate, onRenamed }: {
  agent: Agent
  project: string | null
  projectId: number | null
  status: AgentStatus
  onClose: () => void
  armInteract?: boolean
  agentCount: number
  onNavigate: (dir: 'prev' | 'next') => void
  onRenamed?: (id: number, newName: string) => void
}) {
  const isMac = /mac/i.test(navigator.platform)
  const [tasks, setTasks] = useState<Task[]>([])
  const [windowError, setWindowError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameInput, setRenameInput] = useState('')
  const [showRenameInput, setShowRenameInput] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [interacting, setInteracting] = useState(false)
  // Incrementing signal (re)enables Direct Input in LogTail; seeded by the card CTA.
  const interactSignal = armInteract ? 1 : 0
  const [skills, setSkills] = useState<SkillsResponse | null>(null)
  const [queuedSkill, setQueuedSkill] = useState<string | null>(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/queue/${agent.id.toString()}`)
      .then((r) => r.json() as Promise<QueueResponse>)
      .then((data) => { if (!cancelled) setTasks(data.tasks) })
      .catch(() => { })
    fetch(`${API_BASE}/agents/${agent.id.toString()}/skills`)
      .then((r) => r.json() as Promise<SkillsResponse>)
      .then((data) => { if (!cancelled) setSkills(data) })
      .catch(() => { })
    return () => { cancelled = true }
  }, [agent.id])

  useEffect(() => {
    // While interact mode is active, Escape belongs to the agent's dialog
    // (LogTail forwards it via send-keys) — don't close the modal.
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !interacting) { onClose(); return }
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'ArrowRight') { e.preventDefault(); onNavigate('next') }
        if (e.key === 'ArrowLeft') { e.preventDefault(); onNavigate('prev') }
      }
    }
    document.addEventListener('keydown', handler)
    return () => { document.removeEventListener('keydown', handler) }
  }, [onClose, onNavigate, interacting])

  async function handleCreateWindow() {
    setCreating(true)
    setWindowError(null)
    try {
      const res = await fetch(`${API_BASE}/agents/${agent.id.toString()}/window`, { method: 'POST' })
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
      const res = await fetch(`${API_BASE}/agents/${agent.id.toString()}`, { method: 'DELETE' })
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
      const res = await fetch(`${API_BASE}/agents/${agent.id.toString()}/window`, { method: 'DELETE' })
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

  async function handleRename() {
    const trimmed = renameInput.trim()
    if (!trimmed || renaming) return
    setRenaming(true)
    setRenameError(null)
    try {
      await renameAgent(agent.id, trimmed)
      setShowRenameInput(false)
      onRenamed?.(agent.id, trimmed)
    } catch (err: unknown) {
      setRenameError(err instanceof Error ? err.message : 'Rename failed')
    } finally {
      setRenaming(false)
    }
  }

  return createPortal(
    <ErrorBoundary>
      <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${agent.name} detail`}>
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          onClick={onClose}
          aria-hidden="true"
        />
        <div className="absolute inset-4 flex flex-col overflow-hidden rounded-[14px] bg-white shadow-pop md:inset-8">
          <div className="flex flex-shrink-0 items-center gap-3 border-b border-line px-5 py-3.5">
            <span className="flex min-w-0 flex-col">
              <span className="text-[15px] font-semibold tracking-tight text-ink leading-tight">{agent.name}</span>
              {agent.label && (
                <span className="text-[11px] font-semibold tracking-tight text-[#5b21b6] leading-tight">{agent.label}</span>
              )}
            </span>
            <ProjectBadge name={project} />
            <StatusBadge status={status} />
            <AgentTypeBadge agent={agent} />
            <ContextMeter agent={agent} detailed />
            {needsAttention(status) && (
              <span className="animate-flash text-[14px] font-bold leading-none" style={{ color: status === 'stalled' ? '#e5484d' : '#e0901a' }} aria-label="Needs attention">!</span>
            )}
            {queuedSkill && (
              <span className="text-[11px] text-accent-green">/{queuedSkill} queued ✓</span>
            )}
            <div className="ml-auto flex flex-shrink-0 items-center gap-2">
              {/* Agent actions — each styled distinctly: rename (blue), close (amber), remove (red). */}
              {!showRenameInput ? (
                <button
                  type="button"
                  onClick={() => { setRenameInput(agent.name); setShowRenameInput(true); setRenameError(null) }}
                  className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-accent-blue/30 bg-accent-blue/5 px-3 text-[12px] font-medium text-accent-blue transition hover:bg-accent-blue/10 active:scale-[0.985]"
                >
                  Rename
                </button>
              ) : (
                <>
                  <input
                    autoFocus
                    value={renameInput}
                    onChange={(e) => { setRenameInput(e.target.value) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { void handleRename() }
                      if (e.key === 'Escape') { setShowRenameInput(false) }
                    }}
                    className="h-7 w-36 rounded-[7px] border border-accent-blue/40 bg-white px-2 text-[12px] font-medium text-ink focus:outline-none focus:ring-1 focus:ring-accent-blue/50"
                    pattern="[A-Za-z0-9_-]+"
                  />
                  <button
                    type="button"
                    onClick={() => { void handleRename() }}
                    disabled={renaming}
                    className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-accent-green px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
                  >
                    {renaming ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowRenameInput(false) }}
                    className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-white px-3 text-[12px] font-medium text-ink transition hover:bg-canvas active:scale-[0.985]"
                  >
                    Cancel
                  </button>
                </>
              )}
              {agent.windowPresent && (
                <button
                  type="button"
                  onClick={() => { void handleCloseWindow() }}
                  disabled={closing}
                  className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[#e0901a]/40 bg-[#e0901a]/5 px-3 text-[12px] font-medium text-[#c07a10] transition hover:bg-[#e0901a]/10 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
                  title="Kill the tmux window but keep the agent registered"
                >
                  {closing ? 'Closing…' : 'Close agent'}
                </button>
              )}
              <button
                type="button"
                onClick={() => { void handleRemove() }}
                disabled={removing}
                className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-accent-red px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
                title="Unregister the agent and remove it"
              >
                {removing ? 'Removing…' : 'Remove agent'}
              </button>
              <span className="mx-0.5 h-5 w-px bg-line" aria-hidden="true" />
              {agentCount > 1 && (
                <div className="hidden select-none items-center gap-1.5 sm:flex">
                  <kbd className="inline-flex items-center gap-1 rounded-[5px] border border-line bg-canvas px-2 py-1 font-mono text-[20px] leading-none text-ink "><div>{isMac ? '⌘' : 'Ctrl'}</div> <div className='pb-1'>←</div></kbd>
                  <div className="text-[12px] text-muted-2">/</div>
                  <kbd className="inline-flex items-center gap-1 rounded-[5px] border border-line bg-canvas px-2 py-1 font-mono text-[20px] leading-none text-ink "><div >{isMac ? '⌘' : 'Ctrl'}</div> <div className="pb-1">→</div></kbd>
                </div>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-muted-2 transition hover:bg-canvas hover:text-ink"
                aria-label="Close"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          {(renameError ?? closeError ?? removeError) && (
            <div className="flex-shrink-0 border-b border-line bg-accent-red/5 px-5 py-1.5 text-[11px] text-accent-red">
              {renameError ?? closeError ?? removeError}
            </div>
          )}

          <div className="flex flex-col flex-1 overflow-hidden p-5">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_1.5fr] flex-shrink-0">
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

                <ModeSwitcher agentId={agent.id} mode={agent.mode} windowPresent={agent.windowPresent} />

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
              </div>

              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-2">
                  Queued tasks ({agent.queuedTasks})
                </p>
                <TaskList agentName={agent.name} tasks={tasks} onReorder={setTasks} />
                <AddTaskForm agentId={agent.id} onAdded={(task) => { setTasks((prev) => [...prev, task]) }} projectId={projectId} projectName={project} />
              </div>
            </div>

            <div className="flex flex-col flex-1 min-h-0 mt-5 border-t border-line pt-4">
              <ErrorBoundary>
                <LogTail key={agent.id} agentId={agent.id} agentName={agent.name} focused fillContainer interactSignal={interactSignal} onInteractChange={setInteracting} onCloseModal={onClose} />
              </ErrorBoundary>
            </div>

            {/* Skills section */}
            {skills && (
              <details className="mt-3 flex-shrink-0">
                <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-muted select-none">
                  Skills ({skills.project.length + skills.user.length})
                </summary>
                <div className="mt-2 space-y-3">
                  {/* Project skills — expanded */}
                  {skills.project.length > 0 && (
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-2">Project</div>
                      {skills.project.map((skill) => (
                        <SkillRow key={skill.name} skill={skill} agentId={agent.id} onQueued={setQueuedSkill} />
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
                        <SkillRow key={skill.name} skill={skill} agentId={agent.id} onQueued={setQueuedSkill} />
                      ))}
                    </div>
                  </details>
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
    </ErrorBoundary>,
    document.body,
  )
}

// Compact, modal-only tile. All detail (task queue, mode switch, window
// controls, log tail) lives in AgentDetailModal — clicking the tile opens it.
function AgentItem({ agent, project, onExpand }: {
  agent: Agent
  project: string | null
  onExpand: (armInteract: boolean) => void
}) {
  const status = deriveStatus(agent)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => { onExpand(false) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand(false) } }}
      className="mb-2 flex flex-col gap-1.5 animate-popIn cursor-pointer select-none rounded-[10px] border border-line bg-white px-3.5 py-2.5 shadow-card transition-shadow last:mb-0 hover:shadow-card-hover"
      aria-label={`${agent.name} detail`}
    >
      {/* Row 1 — project + name (left) / status (right) */}
      <div className="flex items-center gap-2">
        <ProjectBadge name={project} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-ink">{agent.name}</span>
        <StatusBadge status={status} />
      </div>

      {/* Row 2 — label (left) / context meter (right) */}
      {(agent.label || agent.contextPct != null) && (
        <div className="flex items-center gap-2">
          {agent.label && (
            <span
              className="flex-shrink-0 rounded-[4px] bg-[#ede9fe] px-1.5 py-px text-[10px] font-semibold tracking-tight text-[#5b21b6]"
              title={agent.label}
            >
              {agent.label}
            </span>
          )}
          <div className="ml-auto"><ContextMeter agent={agent} /></div>
        </div>
      )}

      {/* Active task — own slot when present */}
      {agent.activeTask && (
        <span className="block truncate font-mono text-[10px] text-muted-2" title={agent.activeTask}>
          {agent.activeTask}
        </span>
      )}

      {/* Row 3 — full-width Direct Input CTA, only when attention needed */}
      {needsAttention(status) && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onExpand(true) }}
          className="mt-0.5 w-full animate-pulse cursor-pointer rounded-[7px] px-2.5 py-1 text-center text-[11px] font-bold uppercase tracking-[0.06em] text-white transition hover:opacity-85"
          style={{ background: status === 'stalled' ? '#e5484d' : '#e0901a' }}
          aria-label={`Direct Input to ${agent.name} — it needs your input`}
        >
          Direct Input — needs you
        </button>
      )}
    </div>
  )
}

// ── Board ─────────────────────────────────────────────────────────────────

// Agents live in a single flat list sorted by project. Within a project they
// order by urgency via this priority map (lower sorts first) so attention-needing
// agents float to the top of their project's run.
const STATUS_SORT: Record<AgentStatus, number> = {
  awaiting: 0,
  stalled: 0,
  busy: 1,
  starting: 1,
  idle: 2,
  empty: 3,
  error: 4,
  exited: 4,
  'no-window': 4,
  unknown: 4,
}

// Kanban columns keyed by status group. Statuses not listed here (no-window,
// exited, unknown) are "not running" and render in a separate section below.
interface Column {
  key: 'attention' | 'busy' | 'ready'
  label: string
  statuses: AgentStatus[]
}

const COLUMNS: Column[] = [
  { key: 'attention', label: 'Waiting / Stalled', statuses: ['awaiting', 'stalled', 'error'] },
  { key: 'busy', label: 'Busy', statuses: ['busy', 'starting'] },
  { key: 'ready', label: 'Ready / No tasks', statuses: ['idle', 'empty'] },
]

/**
 * The kanban column a status belongs to, or null when it's an "inactive" status
 * (no-window / exited / unknown) that renders in a separate section.
 */
function columnFor(status: AgentStatus): Column['key'] | null {
  for (const col of COLUMNS) {
    if (col.statuses.includes(status)) return col.key
  }
  return null
}

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
  const [acting, setActing] = useState<'open' | 'close' | 'remove' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function callApi(path: string, method: string, kind: 'open' | 'close' | 'remove') {
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
      `Remove background process "${bg.name}"? This kills its tmux window (if any) and removes it from the conductor registry.`,
    )
    if (!confirmed) return
    void callApi(`/bg-processes/${encodeURIComponent(bg.name)}`, 'DELETE', 'remove')
  }

  function handleCloseWindow() {
    const confirmed = window.confirm(
      `Close "${bg.name}"'s window? The process stays registered and can be relaunched with "Open window".`,
    )
    if (!confirmed) return
    void callApi(`/bg-processes/${encodeURIComponent(bg.name)}/window`, 'DELETE', 'close')
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
      <div className="ml-auto flex flex-shrink-0 items-center gap-2">
        {bg.windowPresent ? (
          <button
            type="button"
            onClick={handleCloseWindow}
            disabled={acting !== null}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-white px-3 text-[12px] font-medium text-ink-2 transition hover:bg-canvas active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          >
            {acting === 'close' ? 'Closing…' : 'Close window'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { void callApi(`/bg-processes/${encodeURIComponent(bg.name)}/window`, 'POST', 'open') }}
            disabled={acting !== null}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-accent-blue px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          >
            {acting === 'open' ? 'Opening…' : 'Open window'}
          </button>
        )}
        <button
          type="button"
          onClick={handleRemove}
          disabled={acting !== null}
          className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-white px-3 text-[12px] font-medium text-accent-red transition hover:border-accent-red/30 hover:bg-accent-red/5 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
        >
          {acting === 'remove' ? 'Removing…' : (bg.windowPresent ? 'Remove' : 'Remove definition')}
        </button>
      </div>
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

// ── Audio synthesis ───────────────────────────────────────────────────────

function playDoorbell(ctx: AudioContext): void {
  const master = ctx.createGain()
  master.gain.setValueAtTime(0.35, ctx.currentTime)
  master.connect(ctx.destination)

  const notes = [
    { freq: 1318.5, start: 0, dur: 0.55 },  // E6 — "ding"
    { freq: 880.0, start: 0.45, dur: 0.75 },  // A5 — "dong"
  ]

  const now = ctx.currentTime
  for (const { freq, start, dur } of notes) {
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, now + start)
    env.gain.setValueAtTime(0, now + start)
    env.gain.linearRampToValueAtTime(1, now + start + 0.02)
    env.gain.exponentialRampToValueAtTime(0.0001, now + start + dur)
    osc.connect(env)
    env.connect(master)
    osc.start(now + start)
    osc.stop(now + start + dur)
  }
}

/** Ascending C-major triad chime (~1.2 s) — played when a task completes. */
function playChime(ctx: AudioContext): void {
  const master = ctx.createGain()
  master.gain.setValueAtTime(0.25, ctx.currentTime)
  master.connect(ctx.destination)
  const notes = [
    { freq: 783.99,  start: 0,    dur: 0.75 },  // G5 — dominant, creates motion
    { freq: 1046.5,  start: 0.14, dur: 0.75 },  // C6 — tonic, resolves
    { freq: 1318.5,  start: 0.28, dur: 0.90 },  // E6 — third, brightens and lingers
  ]
  const now = ctx.currentTime
  for (const { freq, start, dur } of notes) {
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, now + start)
    env.gain.setValueAtTime(0, now + start)
    env.gain.linearRampToValueAtTime(1, now + start + 0.01)
    env.gain.exponentialRampToValueAtTime(0.0001, now + start + dur)
    osc.connect(env)
    env.connect(master)
    osc.start(now + start)
    osc.stop(now + start + dur)
  }
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
  // Project membership rides on every runtime agent payload (projectId/projectName
  // from GET /status and SSE agent-update), so grouping reads straight off the
  // agent — no separate name-keyed membership map (names are only unique per
  // project, so a name-keyed map collapses same-named agents across projects).
  // Modal state lives here (not in AgentItem) so it survives the agent moving
  // between board columns — a status change remounts AgentItem but not us.
  // Keyed by the globally-unique agent id, not name.
  const [expandedAgent, setExpandedAgent] = useState<{ id: number; armInteract: boolean } | null>(null)
  const orderedAgentIds = useMemo(
    () => [...agents].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())).map((a) => a.id),
    [agents],
  )
  const handleNavigate = useCallback((dir: 'prev' | 'next') => {
    setExpandedAgent((prev) => {
      if (!prev) return prev
      const idx = orderedAgentIds.indexOf(prev.id)
      if (idx === -1) return prev
      const next = dir === 'next'
        ? (idx + 1) % orderedAgentIds.length
        : (idx - 1 + orderedAgentIds.length) % orderedAgentIds.length
      return { id: orderedAgentIds[next]!, armInteract: false }
    })
  }, [orderedAgentIds])
  const prevStatusRef = useRef<Map<number, AgentStatus>>(new Map())
  const audioCtxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    // Guard: if SSE delivers state before /status resolves, skip the overwrite.
    let hasReceivedSSEState = false

    fetch(`${apiUrl}/status`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status.toString()}`)
        return r.json() as Promise<SessionState>
      })
      .then((data) => {
        if (!hasReceivedSSEState) {
          setAgents(data.agents)
          for (const agent of data.agents) {
            prevStatusRef.current.set(agent.id, deriveStatus(agent))
          }
          setBgs(data.bgProcesses)
          setSessionAlive(data.sessionAlive)
          setSessionExists(data.sessionExists)
        }
        setLoading(false)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        setError(`Failed to load status: ${msg}`)
        setLoading(false)
      })

    const es = new EventSource(`${apiUrl}/events`)

    es.onerror = () => {
      console.warn('[AgentList] SSE connection error — browser will reconnect')
    }

    es.addEventListener('agent-update', (e: MessageEvent) => {
      try {
        hasReceivedSSEState = true
        const updated: Agent = JSON.parse(e.data as string) as Agent
        const newStatus = deriveStatus(updated)
        const prevStatus = prevStatusRef.current.get(updated.id)
        const wasWorking = prevStatus === 'busy' || prevStatus === 'starting'
        const isDone = newStatus === 'idle' || newStatus === 'empty'
        if (needsAttention(newStatus) && prevStatus !== undefined && !needsAttention(prevStatus)) {
          if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
          const ctx = audioCtxRef.current
          if (ctx.state === 'suspended') {
            ctx.resume().then(() => { playDoorbell(ctx) }).catch(() => { /* autoplay blocked */ })
          } else {
            playDoorbell(ctx)
          }
        } else if (wasWorking && isDone && prevStatus !== undefined) {
          if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
          const ctx = audioCtxRef.current
          if (ctx.state === 'suspended') {
            ctx.resume().then(() => { playChime(ctx) }).catch(() => { /* autoplay blocked */ })
          } else {
            playChime(ctx)
          }
        }
        prevStatusRef.current.set(updated.id, newStatus)
        setAgents((prev) => {
          const idx = prev.findIndex((a) => a.id === updated.id)
          if (idx === -1) {
            // Brand-new agent appended — its payload already carries project info.
            return [...prev, updated]
          }
          const next = [...prev]
          next[idx] = { ...next[idx], ...updated }
          return next
        })
      } catch { /* ignore malformed events */ }
    })

    es.addEventListener('agent-removed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { id?: number }
        if (typeof data.id === 'number') {
          const id = data.id
          prevStatusRef.current.delete(id)
          setAgents((prev) => prev.filter((a) => a.id !== id))
        }
      } catch { /* ignore malformed events */ }
    })

    es.addEventListener('agent-renamed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { id?: number; newName?: string }
        if (typeof data.id === 'number' && typeof data.newName === 'string') {
          const { id, newName } = data
          // Identity is the id, which is stable across rename — only the display
          // name changes, so no prevStatus/dedup juggling is needed.
          setAgents((prev) => prev.map((a) => a.id === id ? { ...a, name: newName } : a))
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

    // ID-based task SSE events are LIGHTWEIGHT TRIGGERS: we do NOT keep a parallel
    // task store. Per-agent queuedTasks/activeTask are recomputed server-side and
    // pushed via the subsequent agent-update (which also carries project info), so
    // these handlers need no action — the {id}-only events are just validated.
    es.addEventListener('task-added', (e: MessageEvent) => {
      try {
        JSON.parse(e.data as string)
      } catch { /* ignore malformed events */ }
    })

    es.addEventListener('task-removed', (e: MessageEvent) => {
      try {
        JSON.parse(e.data as string)
      } catch { /* ignore malformed events */ }
    })

    es.addEventListener('queue-reordered', (e: MessageEvent) => {
      try {
        JSON.parse(e.data as string)
      } catch { /* ignore malformed events */ }
    })

    es.addEventListener('task-moved', (e: MessageEvent) => {
      try {
        JSON.parse(e.data as string)
      } catch { /* ignore malformed events */ }
    })

    return () => {
      es.close()
      audioCtxRef.current?.close().catch(() => { /* ignore */ })
    }
  }, [apiUrl])

  const expandedModalAgent = expandedAgent ? agents.find((a) => a.id === expandedAgent.id) : undefined

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

  // Project membership rides on the agent payload itself, so resolution is a
  // direct field read — no name-keyed map that would collapse same-named agents.
  const projectLabelFor = (agent: Agent): string | null => agent.projectName
  const projectIdFor = (agent: Agent): number | null => agent.projectId

  // Shared comparator: project name (unassigned last) → status urgency → name.
  // Keeps same-project agents adjacent so each column can sub-group by project.
  const byProjectThenStatus = (a: Agent, b: Agent): number => {
    const pa = projectLabelFor(a)
    const pb = projectLabelFor(b)
    if (pa !== pb) {
      if (pa === null) return 1
      if (pb === null) return -1
      const cmp = pa.toLowerCase().localeCompare(pb.toLowerCase())
      if (cmp !== 0) return cmp
    }
    const sc = STATUS_SORT[deriveStatus(a)] - STATUS_SORT[deriveStatus(b)]
    if (sc !== 0) return sc
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  }

  // Partition agents into the three kanban columns (inactive agents are handled
  // by AddAgentForm at the top of the page), then sort each by project.
  const columnAgents: Record<Column['key'], Agent[]> = { attention: [], busy: [], ready: [] }
  for (const agent of agents) {
    const col = columnFor(deriveStatus(agent))
    if (col !== null) columnAgents[col].push(agent)
  }
  for (const key of Object.keys(columnAgents) as Column['key'][]) {
    columnAgents[key].sort(byProjectThenStatus)
  }

  // Cluster a sorted list into consecutive same-project groups so each column
  // can render a project sub-header above that project's cards.
  const groupByProject = (list: Agent[]): { project: string | null; agents: Agent[] }[] => {
    const groups: { project: string | null; agents: Agent[] }[] = []
    for (const agent of list) {
      const project = projectLabelFor(agent)
      const last = groups[groups.length - 1]
      if (last && last.project === project) last.agents.push(agent)
      else groups.push({ project, agents: [agent] })
    }
    return groups
  }

  const renderTile = (agent: Agent) => (
    <AgentItem
      key={agent.id}
      agent={agent}
      project={projectLabelFor(agent)}
      onExpand={(armInteract) => { setExpandedAgent({ id: agent.id, armInteract }) }}
    />
  )

  return (
    <div className="animate-riseIn">
      <h1 className={sectionLabelCls}>tmux Conductor — Agents</h1>
      {!sessionAlive && <SessionBanner sessionExists={sessionExists} />}
      {agents.length === 0 ? (
        <p className="text-[13px] italic text-muted-2">No agents registered.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const count = columnAgents[col.key].length
            const groups = groupByProject(columnAgents[col.key])
            return (
              <div key={col.key} className="rounded-[12px] border border-line bg-canvas/40 p-2.5">
                <div className="mb-2.5 flex items-center gap-2 px-1">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{col.label}</h2>
                  <span className="rounded-pill bg-line px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-2">{count}</span>
                </div>
                {count === 0 ? (
                  <p className="px-1 py-2 text-[12px] italic text-muted-2">None</p>
                ) : (
                  groups.map((group) => (
                    <div key={group.project ?? '__unassigned__'} className="mb-3 last:mb-0">
                      <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-2">
                        {group.project ?? 'Unassigned'}
                      </p>
                      {group.agents.map(renderTile)}
                    </div>
                  ))
                )}
              </div>
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
          project={projectLabelFor(expandedModalAgent)}
          projectId={projectIdFor(expandedModalAgent)}
          status={deriveStatus(expandedModalAgent)}
          armInteract={expandedAgent.armInteract}
          onClose={() => { setExpandedAgent(null) }}
          agentCount={agents.length}
          onNavigate={handleNavigate}
          onRenamed={(id, newName) => {
            // Optimistic rename by stable id; the SSE agent-renamed reconciles too.
            setAgents((prev) => prev.map((a) => a.id === id ? { ...a, name: newName } : a))
          }}
        />
      )}
    </div>
  )
}
