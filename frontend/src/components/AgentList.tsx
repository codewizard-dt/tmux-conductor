import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { API_BASE, addTask, cloneAgent, createWorktreeForAgent, renameAgent, type AgentDisplayStatus, type AgentRunState, type AgentStatusContract, type Task } from '../lib/api'
import AddTaskForm from './AddTaskForm'
import AgentActionsMenu from './AgentActionsMenu'
import CheckpointList from './CheckpointList'
import ConfirmDialog from './ConfirmDialog'
import DiffPanel from './DiffPanel'
import ErrorBoundary from './ErrorBoundary'
import LogTail from './LogTail'
import ModeSwitcher from './ModeSwitcher'
import TaskList from './TaskList'
import { useSSEEvent } from '../hooks/useSSE'

// ── Types ─────────────────────────────────────────────────────────────────

export type AgentStatus = AgentDisplayStatus

export type AgentMode = 'default' | 'acceptEdits' | 'plan' | 'bypass' | 'unknown'
export type AgentType = 'claude' | 'codex' | 'custom'

export interface Agent {
  id: number
  name: string
  projectId: number | null
  projectName: string | null
  state: AgentRunState
  status?: AgentStatusContract
  mode: AgentMode
  agentType?: AgentType
  windowPresent: boolean
  queuedTasks: number
  launchCmd: string
  workdir: string
  branch?: string | null
  worktreePath?: string | null
  role?: string | null
  linkedBg: string | null
  activeTask: string | null
  label?: string | null
  model?: string | null
  modelId?: string | null
  contextTokens?: number | null
  contextPct?: number | null
  contextLimit?: number | null
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens: number
    cacheReadInputTokens: number
    costUsd: number
    sessions: number
  } | null
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
  projectId: number | null
  projectName: string | null
}

interface SessionState {
  session: string
  sessionAlive: boolean
  sessionExists: boolean
  agents: Agent[]
  bgProcesses: BgProcess[]
  timestamp: string
}

function isLogExpandShortcut(e: KeyboardEvent): boolean {
  return e.altKey && !e.metaKey && !e.ctrlKey && (e.code === 'KeyF' || e.key.toLowerCase() === 'f')
}

// ── Status ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AgentStatus, { bg: string; color: string; dot: string; label: string }> = {
  busy: { bg: 'var(--color-status-busy-bg)', color: 'var(--color-status-busy-text)', dot: '#3b6ef6', label: 'busy' },
  idle: { bg: 'var(--color-status-idle-bg)', color: 'var(--color-status-idle-text)', dot: '#30a46c', label: 'idle' },
  'idle-waiting': { bg: 'var(--color-status-success-bg)', color: 'var(--color-status-success-text)', dot: '#30a46c', label: 'idle/waiting' },
  empty: { bg: 'var(--color-status-warn-bg)', color: 'var(--color-status-warn-text)', dot: '#e0901a', label: 'no tasks' },
  error: { bg: 'var(--color-status-error-bg)', color: 'var(--color-status-error-text)', dot: '#e5484d', label: 'error' },
  awaiting: { bg: 'var(--color-status-warn-bg)', color: 'var(--color-status-warn-text)', dot: '#e0901a', label: 'waiting' },
  stalled: { bg: 'var(--color-status-error-bg)', color: 'var(--color-status-error-text)', dot: '#e5484d', label: 'stalled' },
  starting: { bg: 'var(--color-status-neutral-bg)', color: 'var(--color-status-neutral-text)', dot: '#4f5a78', label: 'starting' },
  'no-window': { bg: 'var(--color-badge-neutral-bg)', color: 'var(--color-badge-neutral-text)', dot: '#9a9da5', label: 'no window' },
  exited: { bg: 'var(--color-status-error-bg)', color: '#e5484d', dot: '#e5484d', label: 'exited' },
  unknown: { bg: 'var(--color-badge-neutral-bg)', color: 'var(--color-badge-neutral-text)', dot: '#9a9da5', label: 'unknown' },
}

export function getStatusColor(status: AgentStatus): string {
  return STATUS_CONFIG[status].dot
}

/** Statuses where the agent is blocked on a human — the interact CTA gets prominent. */
export function needsAttention(status: AgentStatus): boolean {
  return status === 'awaiting' || status === 'stalled'
}

export function deriveStatus(agent: Agent): AgentStatus {
  if (agent.status) return agent.status.display
  if (agent.state === 'no-window') return 'no-window'
  if (agent.state === 'awaiting') return 'awaiting'
  if (agent.state === 'stalled') return 'stalled'
  if (agent.state === 'busy') return 'busy'
  if (agent.state === 'starting') return 'starting'
  if (agent.state === 'idle' && agent.queuedTasks > 0) return 'idle'
  if (agent.state === 'idle' && inferAgentType(agent) === 'codex') return 'idle-waiting'
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
    ? { bg: 'var(--color-badge-type-claude-bg)', color: 'var(--color-badge-type-claude-text)', dot: '#7e57c2' }
    : { bg: 'var(--color-badge-type-codex-bg)', color: 'var(--color-badge-type-codex-text)', dot: '#14a38b' }
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


export const ROLE_CONFIG: Record<string, { bg: string; text: string; dot: string }> = {
  frontend: { bg: 'var(--role-badge-frontend-bg)', text: 'var(--role-badge-frontend-text)', dot: '#c026d3' },
  backend: { bg: 'var(--role-badge-backend-bg)', text: 'var(--role-badge-backend-text)', dot: '#63cf17' },
  qa: { bg: 'var(--role-badge-qa-bg)', text: 'var(--role-badge-qa-text)', dot: '#06b6d4' },
  devops: { bg: 'var(--role-badge-devops-bg)', text: 'var(--role-badge-devops-text)', dot: '#c026a0' },
  security: { bg: 'var(--role-badge-security-bg)', text: 'var(--role-badge-security-text)', dot: '#2bc91d' },
  architect: { bg: 'var(--color-badge-neutral-bg)', text: 'var(--color-badge-neutral-text)', dot: '#78716c' },
}

// TASK-115: enumerable, testable role-list derivation — never hand-type the
// role list a second time. 'generic' is deliberately excluded from
// ROLE_CONFIG (resolveRoleBadge treats it as "no badge"), so it's prepended
// here to get the full 7-value set the backend's ROLE_VALUES
// (host-server/rolePresets.ts) validates against.
export const ROLE_VALUES = ['generic', ...Object.keys(ROLE_CONFIG)] as const

const SKILLS_VISIBLE_LIMIT = 5

export function isValidAgentRole(role: string): role is (typeof ROLE_VALUES)[number] {
  return (ROLE_VALUES as readonly string[]).includes(role)
}

export function resolveRoleBadge(
  role: string | null | undefined
): { role: string; bg: string; text: string; dot: string } | null {
  if (role == null || role === 'generic') return null
  const cfg = ROLE_CONFIG[role]
  if (!cfg) return null
  return { role, bg: cfg.bg, text: cfg.text, dot: cfg.dot }
}

function RoleBadge({ role }: { role: string | null | undefined }) {
  const resolved = resolveRoleBadge(role)
  if (!resolved) return null
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
      style={{ background: resolved.bg, color: resolved.text }}
      title={`Role: ${resolved.role}`}
    >
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: resolved.dot }} />
      {resolved.role}
    </span>
  )
}

/** Merged type+role identity pill: falls back to a single-value pill when only one side resolves. */
function AgentIdentityBadge({ agent }: { agent: Agent }) {
  const type = inferAgentType(agent)
  const role = resolveRoleBadge(agent.role)
  if (type === null && !role) return null

  const typePalette = type === null
    ? null
    : type === 'claude'
      ? { bg: 'var(--color-badge-type-claude-bg)', color: 'var(--color-badge-type-claude-text)', dot: '#7e57c2' }
      : { bg: 'var(--color-badge-type-codex-bg)', color: 'var(--color-badge-type-codex-text)', dot: '#14a38b' }

  const title = type && role
    ? `Agent type: ${type}, Role: ${role.role}`
    : type
      ? `Agent type: ${type}`
      : `Role: ${role?.role ?? ''}`

  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
      style={{ background: typePalette?.bg ?? role?.bg, color: typePalette?.color ?? role?.text }}
      title={title}
    >
      {typePalette && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: typePalette.dot }} />}
      {role && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: role.dot }} />}
      {type && role ? `${type} · ${role.role}` : type ?? role?.role}
    </span>
  )
}

/** Deterministic hue (0–359) from a project name so each project keeps a stable badge color. */
function projectHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  // Map the raw hash into one of three safe sub-ranges that avoid the ±20° exclusion
  // bands around the semantic status hues (amber/red/green/blue/violet/rose) used
  // elsewhere in the UI, so identity (project) hues never collide with status hues.
  // Safe ranges, walked in order: (56,132] width 76, (172,207] width 35, (278,331] width 53.
  // Each branch adds 1 before the offset so x=0 lands one past the (open) lower bound
  // instead of on it — the ranges are open-below/closed-above, so the boundary value
  // itself (56, 172, 278) is excluded, not safe.
  let x = h % 144
  if (x < 76) return 57 + x
  x -= 76
  if (x < 35) return 173 + x
  x -= 35
  return 279 + x
}

/** Small colored pill identifying an agent's project. `null` name → neutral "Unassigned". */
export function ProjectBadge({ name, size = 'sm' }: { name: string | null; size?: 'sm' | 'md' }) {
  const textSize = size === 'md' ? 'text-[15px]' : 'text-[13px]'
  if (name === null) {
    return (
      <span
        className={`inline-flex flex-shrink-0 items-center rounded-pill bg-[var(--color-badge-neutral-bg)] px-2 py-0.5 ${textSize} font-semibold text-[var(--color-badge-neutral-text)]`}
        title="No project assigned"
      >
        Unassigned
      </span>
    )
  }
  const hue = projectHue(name)
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center rounded-pill px-2 py-0.5 ${textSize} font-semibold`}
      style={{ background: `hsl(${String(hue)} var(--project-badge-bg-s) var(--project-badge-bg-l))`, color: `hsl(${String(hue)} var(--project-badge-text-s) var(--project-badge-text-l))` }}
      title={`Project: ${name}`}
    >
      {name}
    </span>
  )
}

/** Color for the context-fill bar: green under 70%, amber 70–90%, red above. */
function contextColor(pct: number): string {
  if (pct >= 90) return 'var(--color-status-error-text)'
  if (pct >= 70) return 'var(--color-status-warn-text)'
  return 'var(--color-status-idle-text)'
}

/** Compact token count, e.g. 55336 → "55k". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${String(Math.round(n / 1000))}k`
  return String(n)
}

export function formatCost(usd: number): string {
  if (usd >= 0.01) return `$${usd.toFixed(2)}`
  if (usd > 0) return '<$0.01'
  return ''
}

// Filter matches against name, projectName, role, and branch — deliberately NOT
// workdir (most agents share a long common path prefix, making it low-signal)
// or label/agentType (label is ephemeral pane-derived text; agentType is an
// internal detection value nearly every agent in this project shares).
// Case-insensitive substring match, consistent with the existing name-sort's
// .toLowerCase() convention. Empty/whitespace-only filterText matches everything.
export function agentMatchesFilter(agent: Agent, filterText: string): boolean {
  const needle = filterText.trim().toLowerCase()
  if (needle === '') return true
  const haystack = [agent.name, agent.projectName, agent.role, agent.branch]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

// session_start is normally the session's first-record ISO timestamp, but falls
// back to the session UUID (TASK-075) — never render those as "Invalid Date".
export function formatSessionStart(s: string): string {
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return `${s.slice(0, 8)}…`
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
      <span className="rounded-pill bg-[var(--color-badge-neutral-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-badge-neutral-text)]">
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
        <span className="rounded-pill bg-[var(--color-badge-neutral-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-badge-neutral-text)]">
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

export function UsageBadge({ agent }: { agent: Agent }) {
  const u = agent.usage
  if (!u) return null
  const totalTokens = u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens
  if (totalTokens === 0 && u.costUsd === 0) return null
  const cost = formatCost(u.costUsd)
  const label = cost ? `${cost} · ${formatTokens(totalTokens)}` : formatTokens(totalTokens)
  const title = `Session usage: ${cost || 'cost n/a'} · in ${String(u.inputTokens)} / out ${String(u.outputTokens)} / cache-w ${String(u.cacheCreationInputTokens)} / cache-r ${String(u.cacheReadInputTokens)} · ${String(u.sessions)} session(s)`
  return (
    <span
      className="flex-shrink-0 rounded-pill bg-[var(--color-badge-neutral-bg)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--color-badge-neutral-text)]"
      title={title}
      aria-label={title}
    >
      {label}
    </span>
  )
}

// Per-session usage table for the detail modal. Fetches its own data on mount
// (lazy — per-session rows are not on the snapshot payload) and renders nothing
// for agents without usage rows (Codex/Aider, fresh sessions, fetch errors).
function UsageBreakdown({ agentId }: { agentId: number }) {
  const [sessions, setSessions] = useState<AgentUsageSession[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/agents/${agentId.toString()}/usage`)
      .then((r) => r.json() as Promise<AgentUsageResponse>)
      .then((data) => { if (!cancelled) setSessions(data.sessions) })
      .catch(() => { })
    return () => { cancelled = true }
  }, [agentId])

  if (!sessions || sessions.length === 0) return null

  // updatedAt, not sessionStart: UUID fallback keys don't sort chronologically.
  const sorted = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const totalOf = (s: AgentUsageSession) =>
    s.inputTokens + s.outputTokens + s.cacheCreationInputTokens + s.cacheReadInputTokens
  const sum = (f: (s: AgentUsageSession) => number) => sessions.reduce((acc, s) => acc + f(s), 0)
  const numTh = 'px-2 py-0.5 text-right'
  const numTd = 'px-2 py-0.5 text-right tabular-nums'

  return (
    <details className="mt-3 flex-shrink-0">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-muted select-none">
        Usage ({sessions.length} session{sessions.length === 1 ? '' : 's'})
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-wider text-muted-2">
              <th className="px-2 py-0.5 text-left">Session</th>
              <th className={numTh}>In</th>
              <th className={numTh}>Out</th>
              <th className={numTh}>Cache W</th>
              <th className={numTh}>Cache R</th>
              <th className={numTh}>Total</th>
              <th className={numTh}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const started = formatSessionStart(s.sessionStart)
              return (
                <tr key={s.id}>
                  <td className={`px-2 py-0.5 text-left${started.endsWith('…') ? ' font-mono' : ''}`} title={s.sessionStart}>{started}</td>
                  <td className={numTd} title={String(s.inputTokens)}>{formatTokens(s.inputTokens)}</td>
                  <td className={numTd} title={String(s.outputTokens)}>{formatTokens(s.outputTokens)}</td>
                  <td className={numTd} title={String(s.cacheCreationInputTokens)}>{formatTokens(s.cacheCreationInputTokens)}</td>
                  <td className={numTd} title={String(s.cacheReadInputTokens)}>{formatTokens(s.cacheReadInputTokens)}</td>
                  <td className={numTd} title={String(totalOf(s))}>{formatTokens(totalOf(s))}</td>
                  <td className={numTd} title={String(s.costUsd)}>{formatCost(s.costUsd) || '—'}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-semibold">
              <td className="px-2 py-0.5 text-left">Total</td>
              <td className={numTd} title={String(sum((s) => s.inputTokens))}>{formatTokens(sum((s) => s.inputTokens))}</td>
              <td className={numTd} title={String(sum((s) => s.outputTokens))}>{formatTokens(sum((s) => s.outputTokens))}</td>
              <td className={numTd} title={String(sum((s) => s.cacheCreationInputTokens))}>{formatTokens(sum((s) => s.cacheCreationInputTokens))}</td>
              <td className={numTd} title={String(sum((s) => s.cacheReadInputTokens))}>{formatTokens(sum((s) => s.cacheReadInputTokens))}</td>
              <td className={numTd} title={String(sum(totalOf))}>{formatTokens(sum(totalOf))}</td>
              <td className={numTd} title={String(sum((s) => s.costUsd))}>{formatCost(sum((s) => s.costUsd)) || '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>
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

interface AgentUsageSession {
  id: number
  agentId: number
  sessionStart: string
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  costUsd: number
  updatedAt: string
}

interface AgentUsageResponse {
  agent: string
  sessions: AgentUsageSession[]
}

function SkillBadge({ skill }: { skill: Skill }) {
  return (
    <span className="flex gap-1">
      {skill.source === 'project' && (
        <span className="rounded px-1 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">project</span>
      )}
      {!skill.userInvocable && (
        <span className="rounded px-1 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">auto-only</span>
      )}
      {skill.autoOnly && (
        <span className="rounded px-1 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">manual</span>
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

export function AgentDetailModal({ agent, project, projectId, status, onClose, armInteract, agentCount, onNavigate, onRenamed }: {
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
  const [tasks, setTasks] = useState<Task[]>([])
  const [windowError, setWindowError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [worktreeOverride, setWorktreeOverride] = useState<{ worktreePath: string; branch: string } | null>(null)
  const [creatingWorktree, setCreatingWorktree] = useState(false)
  const [worktreeError, setWorktreeError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameInput, setRenameInput] = useState('')
  const [showRenameInput, setShowRenameInput] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState<string | null>(null)
  const [interacting, setInteracting] = useState(false)
  const [logExpanded, setLogExpanded] = useState(false)
  // Incrementing signal (re)enables Direct Input in LogTail; seeded by the card CTA.
  const interactSignal = armInteract ? 1 : 0
  const [skills, setSkills] = useState<SkillsResponse | null>(null)
  const [queuedSkill, setQueuedSkill] = useState<string | null>(null)
  const [showAllSkills, setShowAllSkills] = useState(false)

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
      if (isLogExpandShortcut(e)) {
        e.preventDefault()
        setLogExpanded((v) => !v)
        return
      }
      if (e.key === 'Escape' && !interacting) { onClose(); return }
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      if (e.metaKey && e.shiftKey) {
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

  // ROADMAP-007: worktrees are opt-in — this lets an agent that was created
  // without one get one retroactively. No SSE broadcast backs this (see the
  // route comment in host-server/index.ts), so the result is held in local
  // override state until the next full status poll folds it into `agent`.
  async function handleCreateWorktree() {
    setCreatingWorktree(true)
    setWorktreeError(null)
    try {
      const updated = await createWorktreeForAgent(agent.id)
      if (updated.worktreePath && updated.branch) {
        setWorktreeOverride({ worktreePath: updated.worktreePath, branch: updated.branch })
      }
    } catch (err: unknown) {
      setWorktreeError(err instanceof Error ? err.message : 'Failed to create worktree')
    } finally {
      setCreatingWorktree(false)
    }
  }

  async function doRemove() {
    setConfirmingRemove(false)
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

  async function doCloseWindow() {
    setConfirmingClose(false)
    setClosing(true)
    setCloseError(null)
    try {
      const res = await fetch(`${API_BASE}/agents/${agent.id.toString()}/window`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
      }
      // Window close is one of the two "agent went away" actions (the other
      // being remove) that this modal's own dropdown can trigger — close it
      // like doRemove does, rather than leaving it open on a windowless agent.
      onClose()
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

  async function handleClone() {
    if (cloning) return
    setCloning(true)
    setCloneError(null)
    try {
      await cloneAgent(agent.id)
    } catch (err: unknown) {
      setCloneError(err instanceof Error ? err.message : 'Clone failed')
    } finally {
      setCloning(false)
    }
  }

  const effectiveWorktreePath = agent.worktreePath ?? worktreeOverride?.worktreePath ?? null
  const effectiveBranch = agent.branch ?? worktreeOverride?.branch ?? null

  const agentActionItems: { key: string; label: string; onSelect: () => void; disabled?: boolean; title?: string; tone?: 'default' | 'danger' | 'warning' }[] = [
    {
      key: 'rename',
      label: 'Rename',
      onSelect: () => { setRenameInput(agent.name); setShowRenameInput(true); setRenameError(null) },
    },
    ...(agent.windowPresent
      ? [{
          key: 'close',
          label: 'Close agent',
          onSelect: () => { setConfirmingClose(true) },
          disabled: closing,
          tone: 'warning' as const,
          title: 'Kill the tmux window (agent stays registered) and close this view',
        }]
      : []),
    {
      key: 'remove',
      label: 'Remove agent',
      onSelect: () => { setConfirmingRemove(true) },
      disabled: removing,
      tone: 'danger' as const,
      title: 'Unregister the agent and remove it',
    },
    {
      key: 'clone',
      label: 'Clone',
      onSelect: () => { void handleClone() },
      disabled: cloning,
    },
  ]

  return createPortal(
    <ErrorBoundary>
      <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${agent.name} detail`}>
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          onClick={onClose}
          aria-hidden="true"
        />
        <div className="absolute inset-4 flex flex-col overflow-hidden rounded-[14px] bg-card shadow-pop md:inset-8">
          <div className="flex flex-shrink-0 items-center gap-3 border-b border-line px-5 py-3.5">
            <span className="flex min-w-0 flex-col">
              <span className="text-[17px] font-semibold tracking-tight text-accent-blue leading-tight">{agent.name}</span>
              {agent.label && (
                <span className="text-[11px] font-semibold tracking-tight text-[#5b21b6] leading-tight">{agent.label}</span>
              )}
            </span>
            <ProjectBadge name={project} size="md" />
            <StatusBadge status={status} />
            <AgentIdentityBadge agent={agent} />
            <ContextMeter agent={agent} detailed />
            {needsAttention(status) && (
              <span className="animate-flash text-[14px] font-bold leading-none" style={{ color: status === 'stalled' ? '#e5484d' : '#e0901a' }} aria-label="Needs attention">!</span>
            )}
            {queuedSkill && (
              <span className="text-[11px] text-accent-green">/{queuedSkill} queued ✓</span>
            )}
            <div className="ml-auto flex flex-shrink-0 items-center gap-2">
              {!showRenameInput ? (
                <AgentActionsMenu items={agentActionItems} />
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
                    className="h-7 w-36 rounded-[7px] border border-accent-blue/40 bg-card px-2 text-[12px] font-medium text-ink focus:outline-none focus:ring-1 focus:ring-accent-blue/50"
                    pattern="[A-Za-z0-9_-]+"
                  />
                  <button
                    type="button"
                    onClick={() => { void handleRename() }}
                    disabled={renaming}
                    className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-accent-green-solid px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
                  >
                    {renaming ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowRenameInput(false) }}
                    className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-card px-3 text-[12px] font-medium text-ink transition hover:bg-canvas active:scale-[0.985]"
                  >
                    Cancel
                  </button>
                </>
              )}
              <span className="mx-0.5 h-5 w-px bg-line" aria-hidden="true" />
              {agentCount > 1 && (
                <div className="hidden select-none items-center gap-1.5 sm:flex">
                  <button
                    type="button"
                    onClick={() => { onNavigate('prev') }}
                    aria-label="Previous agent"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-[5px] border border-line bg-canvas px-2 py-1 font-mono text-[20px] leading-none text-ink transition hover:opacity-80 active:scale-[0.985]"
                  ><div>Shift+Cmd</div> <div className='pb-1'>←</div></button>
                  <div className="text-[12px] text-muted-2">/</div>
                  <button
                    type="button"
                    onClick={() => { onNavigate('next') }}
                    aria-label="Next agent"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-[5px] border border-line bg-canvas px-2 py-1 font-mono text-[20px] leading-none text-ink transition hover:opacity-80 active:scale-[0.985]"
                  ><div>Shift+Cmd</div> <div className="pb-1">→</div></button>
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

          {agent.activeTask && (
            <div
              className="flex-shrink-0 border-b border-line bg-canvas/50 px-5 py-1.5 font-mono text-[11px] text-muted-2 truncate"
              title={agent.activeTask}
            >
              {agent.activeTask}
            </div>
          )}

          {(renameError ?? closeError ?? removeError ?? cloneError) && (
            <div className="flex-shrink-0 border-b border-line bg-accent-red/5 px-5 py-1.5 text-[11px] text-accent-red">
              {renameError ?? closeError ?? removeError ?? cloneError}
            </div>
          )}

          <div className="flex flex-col flex-1 overflow-hidden p-5">
            <details className={`flex-shrink-0${logExpanded ? ' hidden' : ''}`} open={!agent.windowPresent}>
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-muted select-none">
                Details
              </summary>
              <div className="mt-2">
                <dl className="mb-4 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px]">
                  <dt className="self-start pt-px text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-2">Command</dt>
                  <dd className="m-0 min-w-0"><code className="break-all font-mono text-[11px] text-ink">{agent.launchCmd || '—'}</code></dd>
                  <dt className="self-start pt-px text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-2">Workdir</dt>
                  <dd className="m-0 min-w-0"><code className="break-all font-mono text-[11px] text-ink">{agent.workdir || '—'}</code></dd>
                  <dt className="self-center text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-2">Window</dt>
                  <dd className="m-0 text-ink-2">{agent.windowPresent ? 'present' : 'missing'}</dd>
                  <dt className="self-center text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-2">Worktree</dt>
                  <dd className="m-0 flex items-center gap-2 text-ink-2">
                    {effectiveBranch ? (
                      <span className="font-mono text-[11px]">⎇ {effectiveBranch}</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => { void handleCreateWorktree() }}
                          disabled={creatingWorktree}
                          className="inline-flex h-6 cursor-pointer items-center rounded-[6px] border border-line bg-canvas px-2 text-[11px] font-medium text-muted transition hover:text-ink hover:border-ink/30 disabled:pointer-events-none disabled:opacity-40"
                          title="Opt in to an isolated git worktree + branch for this agent"
                        >
                          {creatingWorktree ? 'Creating…' : 'Create worktree'}
                        </button>
                        {worktreeError && <span className="text-[11px] text-accent-red">{worktreeError}</span>}
                      </>
                    )}
                  </dd>
                </dl>

                <ModeSwitcher agentId={agent.id} mode={agent.mode} windowPresent={agent.windowPresent} />

                {!agent.windowPresent && (
                  <div className="mb-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { void handleCreateWindow() }}
                      disabled={creating}
                      className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-accent-blue-solid px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
                    >
                      {creating ? 'Creating…' : 'Create window'}
                    </button>
                    {windowError && <span className="text-[11px] text-accent-red">{windowError}</span>}
                  </div>
                )}
              </div>
            </details>

            <details className={`mt-3 flex-shrink-0${logExpanded ? ' hidden' : ''}`} open={agent.queuedTasks > 0}>
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-muted select-none">
                Queued tasks ({agent.queuedTasks})
              </summary>
              <div className="mt-2">
                <TaskList agentName={agent.name} tasks={tasks} onReorder={setTasks} />
                <AddTaskForm agentId={agent.id} onAdded={(task) => { setTasks((prev) => [...prev, task]) }} projectId={projectId} projectName={project} />
              </div>
            </details>

            <div className={`flex flex-col flex-1 min-h-0${logExpanded ? '' : ' mt-5 border-t border-line pt-4'}`}>
              <ErrorBoundary>
                <LogTail key={agent.id} agentId={agent.id} agentName={agent.name} focused fillContainer interactSignal={interactSignal} onInteractChange={setInteracting} onCloseModal={onClose} expanded={logExpanded} onToggleExpand={() => { setLogExpanded((v) => !v) }} />
              </ErrorBoundary>
            </div>

            {/* Skills section */}
            {skills && !logExpanded && (() => {
              const allSkills = [
                ...skills.project.map((skill) => ({ skill, group: 'project' as const })),
                ...skills.user.map((skill) => ({ skill, group: 'user' as const })),
              ]
              const visibleSkills = showAllSkills ? allSkills : allSkills.slice(0, SKILLS_VISIBLE_LIMIT)
              const hiddenCount = allSkills.length - SKILLS_VISIBLE_LIMIT
              return (
                <details className="mt-3 flex-shrink-0">
                  <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-muted select-none">
                    Skills ({allSkills.length})
                  </summary>
                  <div className="mt-2 space-y-1">
                    {visibleSkills.map(({ skill, group }, i) => (
                      <div key={skill.name}>
                        {(i === 0 || visibleSkills[i - 1]?.group !== group) && (
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-2">
                            {group === 'project' ? 'Project' : 'User'}
                          </div>
                        )}
                        <SkillRow skill={skill} agentId={agent.id} onQueued={setQueuedSkill} />
                      </div>
                    ))}
                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        onClick={() => { setShowAllSkills((v) => !v) }}
                        className="text-[11px] text-accent-blue hover:underline"
                      >
                        {showAllSkills ? 'Show less' : `+${String(hiddenCount)} more`}
                      </button>
                    )}
                  </div>
                </details>
              )
            })()}

            {!logExpanded && <DiffPanel agentId={agent.id} />}

            {/* Per-session usage breakdown */}
            {!logExpanded && <UsageBreakdown agentId={agent.id} />}

            {!logExpanded && effectiveWorktreePath && <CheckpointList agentId={agent.id} />}
          </div>

          <ConfirmDialog
            open={confirmingRemove}
            message={`Remove agent "${agent.name}"? This kills its tmux window, deletes it from conductor.conf, and drops its queued tasks.`}
            confirmLabel="Remove"
            onConfirm={() => { void doRemove() }}
            onCancel={() => { setConfirmingRemove(false) }}
          />
          <ConfirmDialog
            open={confirmingClose}
            message={`Close agent "${agent.name}"'s window and close this view? The agent stays registered and can be relaunched with "Create window".`}
            confirmLabel="Close"
            onConfirm={() => { void doCloseWindow() }}
            onCancel={() => { setConfirmingClose(false) }}
          />
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
      className="mb-2 flex flex-col gap-1.5 animate-popIn cursor-pointer select-none rounded-[10px] border border-line bg-card px-3.5 py-2.5 shadow-card transition-shadow last:mb-0 hover:shadow-card-hover"
      aria-label={`${agent.name} detail`}
    >
      {/* Row 1 — project + name (left) / type + status (right). flex-wrap lets the
          trailing pills flow onto a second line rather than squeezing the name span
          below its min-width floor on narrow (real 3-column grid) card widths. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ProjectBadge name={project} />
        <span className="min-w-[72px] flex-1 truncate text-[13px] font-semibold tracking-tight text-ink">{agent.name}</span>
        <UsageBadge agent={agent} />
        <AgentTypeBadge agent={agent} />
        <RoleBadge role={agent.role} />
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

      {/* Branch badge — subtle, muted; only rendered when the agent has a git branch */}
      {agent.branch && (
        <span className="block truncate font-mono text-[10px] text-muted-2" title={agent.branch}>
          ⎇ {agent.branch}
        </span>
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
  'idle-waiting': 2,
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
  { key: 'ready', label: 'Ready / No tasks', statuses: ['idle', 'idle-waiting', 'empty'] },
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
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-accent-amber/20 bg-accent-amber/5 px-4 py-3 text-[13px] font-medium" style={{ color: 'var(--color-banner-warn-text)' }}>
      <span>
        {sessionExists ? 'Monitor offline — restarting…' : 'Session offline — showing last known state'}
        {startError && <span className="ml-2 font-normal" style={{ color: '#e5484d' }}>{startError}</span>}
      </span>
      <button
        type="button"
        onClick={() => { void handleStart() }}
        disabled={starting}
        className="inline-flex h-7 flex-shrink-0 cursor-pointer items-center rounded-[7px] bg-accent-blue-solid px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
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
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)

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

  function doRemove() {
    setConfirmingRemove(false)
    void callApi(`/bg-processes/${encodeURIComponent(bg.name)}`, 'DELETE', 'remove')
  }

  function doCloseWindow() {
    setConfirmingClose(false)
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
            onClick={() => { setConfirmingClose(true) }}
            disabled={acting !== null}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-card px-3 text-[12px] font-medium text-ink-2 transition hover:bg-canvas active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          >
            {acting === 'close' ? 'Closing…' : 'Close window'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { void callApi(`/bg-processes/${encodeURIComponent(bg.name)}/window`, 'POST', 'open') }}
            disabled={acting !== null}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-accent-blue-solid px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          >
            {acting === 'open' ? 'Opening…' : 'Open window'}
          </button>
        )}
        <button
          type="button"
          onClick={() => { setConfirmingRemove(true) }}
          disabled={acting !== null}
          className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-card px-3 text-[12px] font-medium text-accent-red transition hover:border-accent-red/30 hover:bg-accent-red/5 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
        >
          {acting === 'remove' ? 'Removing…' : (bg.windowPresent ? 'Remove' : 'Remove definition')}
        </button>
      </div>
      {actionError && <span className="w-full text-[12px]" style={{ color: '#e5484d' }}>{actionError}</span>}
      <ConfirmDialog
        open={confirmingRemove}
        message={`Remove background process "${bg.name}"? This kills its tmux window (if any) and removes it from the conductor registry.`}
        confirmLabel="Remove"
        onConfirm={doRemove}
        onCancel={() => { setConfirmingRemove(false) }}
      />
      <ConfirmDialog
        open={confirmingClose}
        message={`Close "${bg.name}"'s window? The process stays registered and can be relaunched with "Open window".`}
        confirmLabel="Close"
        onConfirm={doCloseWindow}
        onCancel={() => { setConfirmingClose(false) }}
      />
    </div>
  )
}

// Bg-process equivalent of AgentList's projectLabelFor/projectIdFor below —
// direct field reads off the bg-process payload itself, no name-keyed map.
const bgProjectLabelFor = (bg: BgProcess): string | null => bg.projectName
const bgProjectIdFor = (bg: BgProcess): number | null => bg.projectId

// Cluster a pre-sorted list into consecutive same-project groups, mirroring
// groupByProject below but scoped to BgProcess[]. Bg processes have no
// status-derived kanban columns, so there's just one clustered list.
const groupBgsByProject = (list: BgProcess[]): { project: string | null; projectId: number | null; bgs: BgProcess[] }[] => {
  const groups: { project: string | null; projectId: number | null; bgs: BgProcess[] }[] = []
  for (const bg of list) {
    const project = bgProjectLabelFor(bg)
    const last = groups[groups.length - 1]
    if (last && last.project === project) last.bgs.push(bg)
    else groups.push({ project, projectId: bgProjectIdFor(bg), bgs: [bg] })
  }
  return groups
}

function BgProcessSection({ bgs }: { bgs: BgProcess[] }) {
  if (bgs.length === 0) {
    return (
      <div className="mt-6">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Background processes</h2>
        <p className="text-[13px] italic text-muted-2">No background processes.</p>
      </div>
    )
  }

  // Project name (unassigned last), then name — matches the project-ordering
  // half of AgentList's byProjectThenStatus below. groupBgsByProject only
  // clusters consecutive runs, so the input must be pre-sorted.
  const sorted = [...bgs].sort((a, b) => {
    const pa = bgProjectLabelFor(a)
    const pb = bgProjectLabelFor(b)
    if (pa !== pb) {
      if (pa === null) return 1
      if (pb === null) return -1
      const cmp = pa.toLowerCase().localeCompare(pb.toLowerCase())
      if (cmp !== 0) return cmp
    }
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })
  const groups = groupBgsByProject(sorted)

  return (
    <div className="mt-6">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Background processes</h2>
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.projectId ?? group.project ?? '__unassigned__'}>
            <p className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-2">
              {group.project ?? 'Unassigned'}
            </p>
            <div className="flex flex-col gap-2">
              {group.bgs.map((bg) => <BgProcessRow key={bg.name} bg={bg} />)}
            </div>
          </div>
        ))}
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
  const [filterText, setFilterText] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Lives with the other top-level hooks (not after the loading/error/session-dead
  // early returns below) so this component never calls a different number of hooks
  // across renders — violating that would trip React's Rules of Hooks the moment
  // `loading` flips from true to false.
  const filteredAgents = useMemo(
    () => agents.filter((a) => agentMatchesFilter(a, filterText)),
    [agents, filterText],
  )
  // Project membership rides on every runtime agent payload (projectId/projectName
  // from GET /status and SSE agent-update), so grouping reads straight off the
  // agent — no separate name-keyed membership map (names are only unique per
  // project, so a name-keyed map collapses same-named agents across projects).
  // Modal state lives here (not in AgentItem) so it survives the agent moving
  // between board columns — a status change remounts AgentItem but not us.
  // Keyed by the globally-unique agent id, not name.
  const [expandedAgent, setExpandedAgent] = useState<{ id: number; armInteract: boolean } | null>(null)
  // Cycle navigation (Cmd+Shift+Arrow) must skip inactive agents entirely — an
  // exited/gone agent should never be a valid prev/next target. Otherwise this
  // stays on the unfiltered `agents` list (not filteredAgents) deliberately: if
  // a user has an agent's detail modal open and then types a filter that would
  // exclude that agent from the visible grid, prev/next navigation should not
  // suddenly change behavior or strand — keeping full-list navigation
  // independent of the grid filter is the least surprising choice.
  const activeAgents = useMemo(
    () => agents.filter((a) => columnFor(deriveStatus(a)) !== null),
    [agents],
  )
  const orderedAgentIds = useMemo(
    () => [...activeAgents].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())).map((a) => a.id),
    [activeAgents],
  )
  const handleNavigate = useCallback((dir: 'prev' | 'next') => {
    setExpandedAgent((prev) => {
      if (!prev) return prev
      const idx = orderedAgentIds.indexOf(prev.id)
      if (idx === -1) return prev
      const next = dir === 'next'
        ? (idx + 1) % orderedAgentIds.length
        : (idx - 1 + orderedAgentIds.length) % orderedAgentIds.length
      const nextAgentId = orderedAgentIds[next]
      if (nextAgentId === undefined) return prev
      return { id: nextAgentId, armInteract: false }
    })
  }, [orderedAgentIds])
  const prevStatusRef = useRef<Map<number, AgentStatus>>(new Map())
  const hasReceivedSSEStateRef = useRef(false)
  const audioCtxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    fetch(`${apiUrl}/status`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status.toString()}`)
        return r.json() as Promise<SessionState>
      })
      .then((data) => {
        if (!hasReceivedSSEStateRef.current) {
          // A stale/older host-server may omit array fields in /status.
          // Coerce to arrays so a missing agents/bgProcesses can't crash the render
          // (e.g. BgProcessSection's `bgs.length` on an undefined value).
          const agentList = Array.isArray(data.agents) ? data.agents : []
          setAgents(agentList)
          for (const agent of agentList) {
            prevStatusRef.current.set(agent.id, deriveStatus(agent))
          }
          setBgs(Array.isArray(data.bgProcesses) ? data.bgProcesses : [])
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

    return () => {
      audioCtxRef.current?.close().catch(() => { /* ignore */ })
    }
  }, [apiUrl])

  useSSEEvent<Agent>('agent-update', (updated) => {
    hasReceivedSSEStateRef.current = true
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
    } else if (wasWorking && isDone) {
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
        return [...prev, updated]
      }
      const next = [...prev]
      next[idx] = { ...next[idx], ...updated }
      return next
    })
  })

  useSSEEvent<{ id?: number }>('agent-removed', (data) => {
    if (typeof data.id === 'number') {
      const id = data.id
      prevStatusRef.current.delete(id)
      setAgents((prev) => prev.filter((a) => a.id !== id))
    }
  })

  useSSEEvent<{ id?: number; newName?: string }>('agent-renamed', (data) => {
    if (typeof data.id === 'number' && typeof data.newName === 'string') {
      const { id, newName } = data
      setAgents((prev) => prev.map((a) => a.id === id ? { ...a, name: newName } : a))
    }
  })

  useSSEEvent<BgProcess>('bg-update', (updated) => {
    setBgs((prev) => {
      const idx = prev.findIndex((b) => b.name === updated.name)
      if (idx === -1) return [...prev, updated]
      const next = [...prev]
      next[idx] = { ...next[idx], ...updated }
      return next
    })
  })

  useSSEEvent<{ name?: string }>('bg-removed', (data) => {
    if (typeof data.name === 'string') {
      setBgs((prev) => prev.filter((b) => b.name !== data.name))
    }
  })

  useSSEEvent<{ sessionAlive?: boolean; sessionExists?: boolean }>('session-update', (data) => {
    if (typeof data.sessionAlive === 'boolean') {
      setSessionAlive(data.sessionAlive)
    }
    if (typeof data.sessionExists === 'boolean') {
      setSessionExists(data.sessionExists)
    }
  })

  useSSEEvent('task-added', () => {})
  useSSEEvent('task-removed', () => {})
  useSSEEvent('queue-reordered', () => {})
  useSSEEvent('task-moved', () => {})

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
    const isNotConnected = error.includes('HTTP 404') || error.includes('HTTP 503')
    return (
      <div>
        <h1 className={sectionLabelCls}>tmux Conductor — Agents</h1>
        {isNotConnected ? (
          <div className="rounded-[10px] border border-line bg-card px-5 py-5 shadow-card">
            <p className="mb-1 text-[15px] font-semibold text-ink">Conductor host-server not reachable</p>
            <p className="text-[13px] leading-relaxed text-muted">
              Can&apos;t reach the conductor host-server. Make sure it&apos;s running on
              port 8788 (<code className="rounded bg-canvas px-1">make dev</code> or
              <code className="rounded bg-canvas px-1"> cd host-server &amp;&amp; npm run dev</code>).
            </p>
          </div>
        ) : (
          <div className="rounded-[10px] border border-accent-red/20 bg-accent-red/5 px-4 py-3 text-[13px] text-accent-red">{error}</div>
        )}
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
  for (const agent of filteredAgents) {
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
      {agents.length > 0 && (
        <input
          type="text"
          value={filterText}
          onChange={(e) => { setFilterText(e.target.value) }}
          placeholder="Filter agents by name, project, role, or branch…"
          aria-label="Filter agents"
          className="mb-4 max-w-xs rounded-[8px] border border-line-input bg-card px-3 py-1.5 font-mono text-[12px] text-ink placeholder:text-muted-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:opacity-40"
        />
      )}
      {agents.length === 0 ? (
        <p className="text-[13px] italic text-muted-2">No agents registered.</p>
      ) : filteredAgents.length === 0 ? (
        <p className="text-[13px] italic text-muted-2">No agents match your filter.</p>
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
                      <p className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-2">
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
          agentCount={activeAgents.length}
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
