import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronLeft, ChevronRight, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE, addTask, cloneAgent, createWorktreeForAgent, listProjects, renameAgent, restartAgentWindow, updateAgentDescription, updateAgentRole,updateBgProcess, type AgentDisplayStatus, type AgentRunState, type AgentStatusContract, type BgLastRestart as BgLastRestartValue, type BgRestartResult, type Project, type Task } from '../lib/api'
import { clearOrder, loadOrder, orderAgents, reorderGroup, saveOrder } from '../lib/agentOrder'
import { setActiveAgentProjectId } from '../lib/activeAgent'
import { SIDEBAR_COLLAPSED_WIDTH_PX, SIDEBAR_WIDTH_PX } from '../lib/layoutConstants'
import { loadSidebarCollapsed, setSidebarCollapsed } from '../lib/sidebarState'
import { reprobeTerminalSize } from '../lib/terminalSizeProbe'
import { clearLastPayload, firstLinePreview, saveLastPayload, sweepOrphanedLastPayloads, useLastPayload } from '../lib/lastPayload'
import AddTaskForm from './AddTaskForm'
import AddBgProcessForm from './AddBgProcessForm'
import AgentActionsMenu from './AgentActionsMenu'
import AgentInfoTabs, { type AgentInfoTabDef } from './AgentInfoTabs'
import { BackgroundProcessesTab } from './BackgroundProcessesTab'
import { BgLastRestart } from './BgLastRestart'
import { BgLivenessBadge } from './BgLivenessBadge'
import { BgRestartButton } from './BgRestartButton'
import { bgQualifiedLabel } from '../lib/bgLabel'
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
  inGitRepo?: boolean
  role?: string | null
  description?: string | null
  activeTask: string | null
  lastPrompt?: { text: string; ts: string } | null
  label?: string | null
  model?: string | null
  modelId?: string | null
  contextTokens?: number | null
  contextPct?: number | null
  contextLimit?: number | null
  contextLimitConfident?: boolean | null
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
  /**
   * Derived identity `<projectName>-<name>` (TASK-0196). `name` is only unique
   * within a project, so every route, React key and SSE match uses the slug.
   */
  slug: string
  /** Display label; unique per project, not globally. */
  name: string
  workdir: string
  launchCmd: string
  windowPresent: boolean
  liveness?: 'running' | 'exited' | 'stopped'
  state: string | null
  logPath: string
  statePath: string
  /** Every bg process belongs to a project (TASK-0195) — never null. */
  projectId: number
  projectName: string
  /** TASK-0193: last successful restart (who/when); null/absent = never restarted. */
  lastRestart?: BgLastRestartValue | null
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

export const STATUS_CONFIG: Record<AgentStatus, { bg: string; color: string; dot: string; label: string }> = {
  busy: { bg: 'var(--color-status-busy-bg)', color: 'var(--color-status-busy-text)', dot: '#3b6ef6', label: 'busy' },
  idle: { bg: 'var(--color-status-idle-bg)', color: 'var(--color-status-idle-text)', dot: '#30a46c', label: 'idle' },
  'idle-waiting': { bg: 'var(--color-status-success-bg)', color: 'var(--color-status-success-text)', dot: '#30a46c', label: 'idle/waiting' },
  empty: { bg: 'var(--color-status-idle-bg)', color: 'var(--color-status-idle-text)', dot: '#30a46c', label: 'ready' },
  error: { bg: 'var(--color-status-error-bg)', color: 'var(--color-status-error-text)', dot: '#e5484d', label: 'error' },
  awaiting: { bg: 'var(--color-status-warn-bg)', color: 'var(--color-status-warn-text)', dot: '#eab308', label: 'waiting' },
  stalled: { bg: 'var(--color-status-error-bg)', color: 'var(--color-status-error-text)', dot: '#e5484d', label: 'stalled' },
  starting: { bg: 'var(--color-status-neutral-bg)', color: 'var(--color-status-neutral-text)', dot: '#4f5a78', label: 'starting' },
  'no-window': { bg: 'var(--color-badge-neutral-bg)', color: 'var(--color-badge-neutral-text)', dot: '#9a9da5', label: 'no window' },
  exited: { bg: 'var(--color-status-error-bg)', color: '#e5484d', dot: '#e5484d', label: 'exited' },
  unknown: { bg: 'var(--color-badge-neutral-bg)', color: 'var(--color-badge-neutral-text)', dot: '#9a9da5', label: 'unknown' },
}

// Presentation override: inactive sidebar rows all share the red border, regardless of
// the per-status dot color in STATUS_CONFIG (no-window/unknown are grey there).
const INACTIVE_BORDER_COLOR = '#e5484d'

export function getStatusColor(status: AgentStatus): string {
  return STATUS_CONFIG[status].dot
}

/** Statuses where the agent is blocked on a human — the interact CTA gets prominent. */
export function needsAttention(status: AgentStatus): boolean {
  return status === 'awaiting' || status === 'stalled'
}

/**
 * Mirror the host-server's authoritative `lastPrompt` into the per-agent localStorage
 * store (side effect only — nothing renders from here). `undefined` (one-shot partial
 * `agent-update` payloads omit the field, meaning "unchanged") and `null` (no prompt
 * captured yet) both write nothing. Newest-timestamp-wins lives in `saveLastPayload`.
 */
function mirrorLastPrompt(agent: Pick<Agent, 'id' | 'lastPrompt'>): void {
  const lp = agent.lastPrompt
  if (typeof lp !== 'object' || lp === null) return
  if (typeof lp.text !== 'string' || lp.text === '' || typeof lp.ts !== 'string') return
  saveLastPayload(agent.id, { text: lp.text, ts: lp.ts, source: 'hook' })
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
  const title = status === 'empty' ? 'Ready — no queued tasks' : undefined
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

/**
 * Model chip + thin context-fill bar. Shows model chip alone when contextPct is unknown.
 * When `agent.contextLimitConfident === false`, renders the fill in a neutral grey with an
 * "unconfirmed context window" tooltip instead of the normal percentage-colored bar, since the
 * limit used to compute `pct` may not match the model's real context window.
 */
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

  const unconfident = agent.contextLimitConfident === false
  const color = unconfident ? '#9a9da5' : contextColor(pct)
  const limit = agent.contextLimit ?? 200000
  const tokenLabel =
    agent.contextTokens != null ? `${formatTokens(agent.contextTokens)} / ${formatTokens(limit)}` : null
  const title = unconfident
    ? `~${formatTokens(agent.contextTokens ?? 0)} tokens used, context window size unconfirmed for this model`
    : `${String(pct)}% of context window used${tokenLabel ? ` (${tokenLabel})` : ''}`
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

// Per-session usage table for the agent detail view. Fetches its own data on mount
// (lazy — per-session rows are not on the snapshot payload) and renders nothing
// for agents without usage rows (Codex/Aider, fresh sessions, fetch errors).
function UsageBreakdown({ agentId, onPresenceChange }: { agentId: number; onPresenceChange?: (present: boolean) => void }) {
  const [sessions, setSessions] = useState<AgentUsageSession[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/agents/${agentId.toString()}/usage`)
      .then((r) => r.json() as Promise<AgentUsageResponse>)
      .then((data) => { if (!cancelled) setSessions(data.sessions) })
      .catch(() => { })
    return () => { cancelled = true }
  }, [agentId])

  // Same guard as before (no sessions yet, or an empty list), just relayed outward via
  // onPresenceChange (TASK-157) instead of only expressed as an internal `return null` — the
  // Usage tab is entirely omitted from the tab list while this is false.
  const present = sessions !== null && sessions.length > 0

  useEffect(() => {
    onPresenceChange?.(present)
  }, [present, onPresenceChange])

  if (!present) return null

  // updatedAt, not sessionStart: UUID fallback keys don't sort chronologically.
  const sorted = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const totalOf = (s: AgentUsageSession) =>
    s.inputTokens + s.outputTokens + s.cacheCreationInputTokens + s.cacheReadInputTokens
  const sum = (f: (s: AgentUsageSession) => number) => sessions.reduce((acc, s) => acc + f(s), 0)
  const numTh = 'px-2 py-0.5 text-right'
  const numTd = 'px-2 py-0.5 text-right tabular-nums'

  // TASK-157: no longer a standalone <details> accordion — this is now the Usage tab's whole
  // panel content, so the heading is a plain label, not a collapsible summary.
  return (
    <div className="flex-shrink-0">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        Usage ({sessions.length} session{sessions.length === 1 ? '' : 's'})
      </div>
      <div className="overflow-x-auto">
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

interface AgentDetailViewProps {
  agent: Agent
  project: string | null
  projectId: number | null
  /** Bg processes owned by the agent's project (empty when the agent has no project). */
  projectBgs: BgProcess[]
  /** Called with the slug and server result after a successful Restart/Start from the Background tab. */
  onBgRestarted?: (slug: string, result: BgRestartResult) => void
  status: AgentStatus
  onClose: () => void
  armInteract?: boolean
  agentCount: number
  onNavigate: (dir: 'prev' | 'next') => void
  onRenamed?: (id: number, newName: string) => void
  onCloned?: (id: number) => void
  onRoleChanged?: (agentId: number, role: string) => void
  onDescriptionChanged?: (agentId: number, description: string | null) => void
  onWorktreeCreated?: (id: number, worktreePath: string, branch: string) => void
}

// The agent detail content, mounted directly in the Agents page's main pane. `onClose` means
// "deselect" (return the pane to its empty state).
export function AgentDetailView({ agent, project, projectId, projectBgs, onBgRestarted, status, onClose, armInteract, agentCount, onNavigate, onRenamed, onCloned, onRoleChanged, onDescriptionChanged, onWorktreeCreated }: AgentDetailViewProps) {
  const isMac = /mac/i.test(navigator.userAgent)
  // TASK-0226: last user payload for the strip under the header (retained until replaced).
  const lastPayload = useLastPayload(agent.id)
  const [tasks, setTasks] = useState<Task[]>([])
  const [windowError, setWindowError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [worktreeOverride, setWorktreeOverride] = useState<{ worktreePath: string; branch: string } | null>(null)
  const [creatingWorktree, setCreatingWorktree] = useState(false)
  const [worktreeError, setWorktreeError] = useState<string | null>(null)
  // TASK-0216: a worktree added to an agent whose window is live only updates the DB row — the
  // pane keeps its cwd. These drive the warn-first dialog, the persistent notice, and the
  // confirmed "Restart in worktree" (stop + relaunch the window).
  const [confirmingWorktree, setConfirmingWorktree] = useState(false)
  const [worktreeNeedsRestart, setWorktreeNeedsRestart] = useState(false)
  const [confirmingRestart, setConfirmingRestart] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [restartError, setRestartError] = useState<string | null>(null)
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
  const [changingRole, setChangingRole] = useState(false)
  const [roleInput, setRoleInput] = useState('')
  const [showRoleInput, setShowRoleInput] = useState(false)
  const [roleError, setRoleError] = useState<string | null>(null)
  const [changingDescription, setChangingDescription] = useState(false)
  const [descriptionInput, setDescriptionInput] = useState('')
  const [showDescriptionInput, setShowDescriptionInput] = useState(false)
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState<string | null>(null)
  const [showAddBg, setShowAddBg] = useState(false)
  // Incrementing signal (re)enables Direct Input in LogTail; seeded by the card CTA.
  const interactSignal = armInteract ? 1 : 0
  const [skills, setSkills] = useState<SkillsResponse | null>(null)
  const [queuedSkill, setQueuedSkill] = useState<string | null>(null)
  const [showAllSkills, setShowAllSkills] = useState(false)
  // TASK-157: which AgentInfoTabs tab is active. Terminal is the default-active tab on open
  // (Objective: "terminal is what you see first"), and is also the only tab that is always
  // present (never conditionally omitted).
  const [activeTabId, setActiveTabId] = useState('terminal')
  // Diff/Usage presence is data-driven and only known once DiffPanel/UsageBreakdown's own
  // fetch resolves (see the onPresenceChange wiring below and their components' own comments).
  // Both default to `true` — not because that mirrors either component's literal initial
  // "no data yet" condition (UsageBreakdown's actually starts false), but because
  // AgentInfoTabs entirely omits (unmounts) a tab whose `present` is false. If Usage defaulted
  // to false, UsageBreakdown would never be mounted in the first place and could never run its
  // fetch to report a real presence — a permanent dead tab. Defaulting both to true guarantees
  // one mount-and-fetch cycle; the tradeoff is a possible one-frame tab flash for an agent with
  // truly no diff/usage data, which self-corrects via the callback below.
  const [diffPresent, setDiffPresent] = useState(true)
  const [usagePresent, setUsagePresent] = useState(true)

  // TASK-157 item 3: selecting the agent via the needs-attention CTA / notification-toast
  // (armInteract: true) must land Direct Input's auto-focus on a visible panel, not a hidden
  // inactive one — force the Terminal tab active in addition to whatever interactSignal
  // already does inside LogTail.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pre-existing, unrelated to this task; syncing local tab state to an external prop signal
    if (armInteract) setActiveTabId('terminal')
  }, [armInteract])

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
    // The view owns only the prev/next shortcut; deselect is the caller's `onClose`.
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      const modifierPressed = isMac ? e.metaKey : e.ctrlKey
      if (modifierPressed && e.shiftKey) {
        if (e.key === 'ArrowRight') { e.preventDefault(); onNavigate('next') }
        if (e.key === 'ArrowLeft') { e.preventDefault(); onNavigate('prev') }
      }
    }
    document.addEventListener('keydown', handler)
    return () => { document.removeEventListener('keydown', handler) }
  }, [isMac, onNavigate])

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
  // without one get one retroactively. The route itself does not broadcast (see
  // its comment in host-server/index.ts); the periodic diff emits a full
  // `agent-update` within one status tick. Until then the result is held in
  // local override state and patched into the sidebar via onWorktreeCreated.
  async function handleCreateWorktree() {
    setCreatingWorktree(true)
    setWorktreeError(null)
    try {
      const updated = await createWorktreeForAgent(agent.id)
      if (updated.worktreePath && updated.branch) {
        setWorktreeOverride({ worktreePath: updated.worktreePath, branch: updated.branch })
        setWorktreeNeedsRestart(agent.windowPresent)
        onWorktreeCreated?.(agent.id, updated.worktreePath, updated.branch)
      }
    } catch (err: unknown) {
      setWorktreeError(err instanceof Error ? err.message : 'Failed to create worktree')
    } finally {
      setCreatingWorktree(false)
    }
  }

  // TASK-0216: single entry point for both "Create worktree" triggers (menu item + Details tab).
  // A live window keeps its cwd, so warn first; a windowless agent lands in the worktree on its
  // next start (agentPaneCwd) and needs no warning.
  function requestCreateWorktree() {
    if (agent.windowPresent) setConfirmingWorktree(true)
    else void handleCreateWorktree()
  }

  // Stop + relaunch the window so it starts inside the worktree. Deliberately not doCloseWindow():
  // that deselects the agent, and here the view must stay put.
  async function doRestartInWorktree() {
    setConfirmingRestart(false)
    setRestarting(true)
    setRestartError(null)
    try {
      await restartAgentWindow(agent.id)
      setWorktreeNeedsRestart(false)
    } catch (err: unknown) {
      setRestartError(err instanceof Error ? err.message : 'Failed to restart window')
    } finally {
      setRestarting(false)
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
      // True deletion only (not window close): drop the stored payload so a reused id starts empty.
      clearLastPayload(agent.id)
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
      // being remove) that this view's own dropdown can trigger — deselect
      // like doRemove does, rather than leaving the pane on a windowless agent.
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

  async function handleChangeRole() {
    if (changingRole) return
    setChangingRole(true)
    setRoleError(null)
    try {
      await updateAgentRole(agent.id, roleInput)
      setShowRoleInput(false)
      onRoleChanged?.(agent.id, roleInput)
    } catch (err: unknown) {
      setRoleError(err instanceof Error ? err.message : 'Role change failed')
    } finally {
      setChangingRole(false)
    }
  }

  async function handleChangeDescription() {
    if (changingDescription) return
    setChangingDescription(true)
    setDescriptionError(null)
    try {
      const trimmed = descriptionInput.trim()
      await updateAgentDescription(agent.id, trimmed === '' ? null : trimmed)
      setShowDescriptionInput(false)
      onDescriptionChanged?.(agent.id, trimmed === '' ? null : trimmed)
    } catch (err: unknown) {
      setDescriptionError(err instanceof Error ? err.message : 'Description change failed')
    } finally {
      setChangingDescription(false)
    }
  }

  async function handleClone(opts?: { forceWorktree?: boolean }) {
    if (cloning) return
    setCloning(true)
    setCloneError(null)
    try {
      // A plain Clone keeps its original one-argument call so its request shape is unchanged.
      const cloned = await (opts ? cloneAgent(agent.id, opts) : cloneAgent(agent.id))
      onCloned?.(cloned.id)
    } catch (err: unknown) {
      setCloneError(err instanceof Error ? err.message : 'Clone failed')
    } finally {
      setCloning(false)
    }
  }

  function handleActiveTabChange(id: string) {
    setActiveTabId(id)
  }

  // Always hand LogTail a defined callback: it gates click-to-interact on `onInteractChange !== undefined`,
  // so omitting it would silently disable Direct Input. The pane has no interact-state consumer.
  const handleInteractChange = useCallback(() => { /* intentionally empty */ }, [])

  // TASK-0216: the "still running in <workdir>" notice is moot once the window is gone — a later
  // "Create window" spawns straight into the worktree. Adjusting state during render (rather than
  // in an effect) is React's documented pattern for deriving state from a prop change.
  if (worktreeNeedsRestart && !agent.windowPresent) setWorktreeNeedsRestart(false)

  const effectiveWorktreePath = agent.worktreePath ?? worktreeOverride?.worktreePath ?? null
  const effectiveBranch = agent.branch ?? worktreeOverride?.branch ?? null

  // TASK-0209: the "Create worktree" menu item mirrors the Details tab's inline button; it is
  // disabled (with a reason) when a worktree already exists or the workdir isn't a git repo.
  const hasWorktree = Boolean(effectiveWorktreePath ?? effectiveBranch)
  const worktreeMenuDescription = hasWorktree
    ? `Already has a worktree (${effectiveBranch ?? effectiveWorktreePath ?? ''})`
    : agent.inGitRepo === false
      ? 'Workdir is not inside a git repository'
      : undefined

  const agentActionItems: { key: string; label: string; onSelect: () => void; disabled?: boolean; title?: string; description?: string; tone?: 'default' | 'danger' | 'warning' }[] = [
    {
      key: 'rename',
      label: 'Rename',
      onSelect: () => { setRenameInput(agent.name); setShowRenameInput(true); setRenameError(null); setShowRoleInput(false) },
    },
    {
      key: 'change-role',
      label: 'Change role',
      onSelect: () => { setRoleInput(agent.role ?? 'generic'); setShowRoleInput(true); setRoleError(null); setShowRenameInput(false) },
    },
    {
      key: 'edit-description',
      label: 'Edit description',
      onSelect: () => { setDescriptionInput(agent.description ?? ''); setShowDescriptionInput(true); setDescriptionError(null) },
    },
    {
      key: 'clone',
      label: 'Clone',
      onSelect: () => { void handleClone() },
      disabled: cloning,
    },
    {
      // TASK-0214: available on every agent (with or without a worktree) — the clone, not the
      // source, gets the fresh worktree. `undefined` inGitRepo is unknown → enabled; the backend
      // answers with its real reason.
      key: 'clone-into-worktree',
      label: cloning ? 'Cloning…' : 'Clone into new worktree',
      onSelect: () => { void handleClone({ forceWorktree: true }) },
      disabled: cloning || agent.inGitRepo === false,
      title: 'Spawn a copy of this agent in its own new git worktree and branch (off the base branch — uncommitted work is not copied)',
      ...(agent.inGitRepo === false ? { description: 'Workdir is not inside a git repository' } : {}),
    },
    {
      key: 'create-worktree',
      label: creatingWorktree ? 'Creating worktree…' : 'Create worktree',
      onSelect: requestCreateWorktree,
      disabled: worktreeMenuDescription !== undefined || creatingWorktree,
      title: (hasWorktree ? worktreeMenuDescription : undefined) ?? 'Opt in to an isolated git worktree + branch for this agent',
      ...(worktreeMenuDescription !== undefined ? { description: worktreeMenuDescription } : {}),
    },
    {
      key: 'add-bg-process',
      label: 'Add background process',
      onSelect: () => { setShowAddBg(true) },
    },
  ]

  // TASK-157: Terminal/Skills/Diff/Usage/Checkpoints, consolidated into one tabbed panel
  // (replacing four standalone <details> accordions + the terminal's old always-visible
  // position). Terminal is always present; Skills is always present (still renders even with
  // zero skills, matching pre-existing behavior); Diff/Usage/Checkpoints are present only per
  // their own existing mount conditions (see the state comments above and each component's own
  // onPresenceChange wiring for Diff/Usage, and effectiveWorktreePath directly for Checkpoints).
  // TASK-0205: Background (the agent's project's bg processes) sits after Queued tasks and is
  // present only when the agent has a project.
  const tabs: AgentInfoTabDef[] = [
    {
      id: 'terminal',
      label: 'Terminal',
      // No window means no terminal to show: offer to create one right here, in place of LogTail.
      content: agent.windowPresent ? (
        <ErrorBoundary>
          <LogTail
            key={agent.id}
            agentId={agent.id}
            agentName={agent.name}
            focused
            fillContainer
            interactSignal={interactSignal}
            onInteractChange={handleInteractChange}
            onCloseModal={onClose}
            taskInput={(
              <AddTaskForm
                className="min-w-0 flex-1"
                agentId={agent.id}
                onAdded={(task) => { setTasks((prev) => [...prev, task]) }}
                projectId={projectId}
                projectName={project}
              />
            )}
          />
        </ErrorBoundary>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
          <p className="m-0 text-[12px] text-muted">This agent has no tmux window.</p>
          <button
            type="button"
            onClick={() => { void handleCreateWindow() }}
            disabled={creating}
            className="inline-flex h-8 cursor-pointer items-center rounded-[7px] bg-accent-blue-solid px-4 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          >
            {creating ? 'Creating…' : 'Create window'}
          </button>
          {windowError && <span className="text-[11px] text-accent-red">{windowError}</span>}
          <AddTaskForm
            className="w-full max-w-md text-left"
            agentId={agent.id}
            onAdded={(task) => { setTasks((prev) => [...prev, task]) }}
            projectId={projectId}
            projectName={project}
          />
        </div>
      ),
    },
    {
      id: 'skills',
      label: 'Skills',
      content: skills ? (() => {
        const allSkills = [
          ...skills.project.map((skill) => ({ skill, group: 'project' as const })),
          ...skills.user.map((skill) => ({ skill, group: 'user' as const })),
        ]
        const visibleSkills = showAllSkills ? allSkills : allSkills.slice(0, SKILLS_VISIBLE_LIMIT)
        const hiddenCount = allSkills.length - SKILLS_VISIBLE_LIMIT
        return (
          <div className="flex-shrink-0">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Skills ({allSkills.length})
            </div>
            <div className="space-y-1">
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
          </div>
        )
      })() : (
        <p className="text-[12px] italic text-muted-2">Loading…</p>
      ),
    },
    {
      id: 'details',
      label: 'Details',
      content: (
        <div className="flex-shrink-0">
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
                    onClick={requestCreateWorktree}
                    disabled={creatingWorktree}
                    className="inline-flex h-6 cursor-pointer items-center rounded-[6px] border border-line bg-canvas px-2 text-[11px] font-medium text-muted transition hover:text-ink hover:border-ink/30 disabled:pointer-events-none disabled:opacity-40"
                    title="Opt in to an isolated git worktree + branch for this agent"
                  >
                    {creatingWorktree ? 'Creating…' : 'Create worktree'}
                  </button>
                </>
              )}
            </dd>
          </dl>

          <ModeSwitcher agentId={agent.id} mode={agent.mode} windowPresent={agent.windowPresent} />

        </div>
      ),
    },
    {
      id: 'queued-tasks',
      label: `Queued tasks (${String(agent.queuedTasks)})`,
      content: (
        <div className="flex-shrink-0">
          <TaskList agentName={agent.name} tasks={tasks} onReorder={setTasks} projectId={projectId} />
        </div>
      ),
    },
    {
      id: 'background',
      label: `Background (${String(projectBgs.length)})`,
      present: projectId !== null,
      content: <BackgroundProcessesTab bgs={projectBgs} projectName={project ?? ''} active={activeTabId === 'background'} onBgRestarted={onBgRestarted} />,
    },
    {
      id: 'diff',
      label: 'Diff',
      present: diffPresent,
      content: <DiffPanel agentId={agent.id} onPresenceChange={setDiffPresent} />,
    },
    {
      id: 'usage',
      label: 'Usage',
      present: usagePresent,
      content: <UsageBreakdown agentId={agent.id} onPresenceChange={setUsagePresent} />,
    },
    {
      id: 'checkpoints',
      label: 'Checkpoints',
      present: !!effectiveWorktreePath,
      content: <CheckpointList agentId={agent.id} />,
    },
  ]

  return (
    <ErrorBoundary>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-line px-5 py-3.5">
          <div className='flex flex-wrap gap-x-2 gap-y-1'>
            <span className="flex min-w-0 flex-col">
              <span className="text-[17px] font-semibold tracking-tight text-accent-blue leading-tight flex-1">{agent.name}</span>
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

          </div>
          {queuedSkill && (
            <span className="text-[11px] text-accent-green">/{queuedSkill} queued ✓</span>
          )}
          <div className="ml-auto flex flex-shrink-0 items-center gap-2">
            {!showRenameInput && !showRoleInput ? (
              <>
                {agent.windowPresent && (
                  <button
                    type="button"
                    aria-label="Stop agent"
                    title="Kill the tmux window (agent stays registered) and close this view"
                    onClick={() => { setConfirmingClose(true) }}
                    disabled={closing}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[7px] text-[var(--color-status-warn-text)] transition hover:bg-[var(--color-accent-amber)]/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Square size={16} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Destroy agent"
                  title="Unregister the agent and remove it"
                  onClick={() => { setConfirmingRemove(true) }}
                  disabled={removing}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[7px] text-accent-red transition hover:bg-accent-red/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
                <AgentActionsMenu items={agentActionItems} />
              </>
            ) : showRenameInput ? (
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
            ) : (
              <>
                <select
                  autoFocus
                  value={roleInput}
                  onChange={(e) => { setRoleInput(e.target.value) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { void handleChangeRole() }
                    if (e.key === 'Escape') { setShowRoleInput(false) }
                  }}
                  className="h-7 w-36 rounded-[7px] border border-accent-blue/40 bg-card px-2 text-[12px] font-medium text-ink focus:outline-none focus:ring-1 focus:ring-accent-blue/50"
                >
                  {ROLE_VALUES.map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => { void handleChangeRole() }}
                  disabled={changingRole}
                  className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-accent-green-solid px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
                >
                  {changingRole ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowRoleInput(false) }}
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
                  title={`Previous agent (Shift+${isMac ? 'Cmd' : 'Ctrl'}+←)`}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-[5px] border border-line bg-canvas px-2 py-1 font-mono text-[20px] leading-none text-ink transition hover:opacity-80 active:scale-[0.985]"
                ><span>⇧{isMac ? '⌘' : 'Ctrl'}</span> <ChevronLeft size={16} aria-hidden="true" /></button>
                <div className="text-[12px] text-muted-2">/</div>
                <button
                  type="button"
                  onClick={() => { onNavigate('next') }}
                  aria-label="Next agent"
                  title={`Next agent (Shift+${isMac ? 'Cmd' : 'Ctrl'}+→)`}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-[5px] border border-line bg-canvas px-2 py-1 font-mono text-[20px] leading-none text-ink transition hover:opacity-80 active:scale-[0.985]"
                ><span>⇧{isMac ? '⌘' : 'Ctrl'}</span> <ChevronRight size={16} aria-hidden="true" /></button>
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

        {lastPayload && (
          <div
            className="flex-shrink-0 border-b border-line bg-canvas/50 px-5 py-1.5 font-mono text-[11px] text-muted-2 truncate"
            title={lastPayload.text}
          >
            {firstLinePreview(lastPayload.text)}
          </div>
        )}

        {showDescriptionInput ? (
          <div className="flex flex-shrink-0 items-start gap-2 border-b border-line px-5 py-2">
            <textarea
              autoFocus
              value={descriptionInput}
              onChange={(e) => { setDescriptionInput(e.target.value) }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setShowDescriptionInput(false) }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { void handleChangeDescription() }
              }}
              rows={2}
              aria-label="Agent description"
              placeholder="What this agent specializes in"
              className="min-w-0 flex-1 rounded-[7px] border border-accent-blue/40 bg-card px-2 py-1 text-[12px] text-ink focus:outline-none focus:ring-1 focus:ring-accent-blue/50"
            />
            <button
              type="button"
              onClick={() => { void handleChangeDescription() }}
              disabled={changingDescription}
              className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-accent-green-solid px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
            >
              {changingDescription ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => { setShowDescriptionInput(false) }}
              className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-card px-3 text-[12px] font-medium text-ink transition hover:bg-canvas active:scale-[0.985]"
            >
              Cancel
            </button>
          </div>
        ) : agent.description ? (
          <div
            className="flex-shrink-0 border-b border-line px-5 py-1.5 text-[12px] text-ink-2 break-words"
            title={agent.description}
          >
            {agent.description}
          </div>
        ) : null}

        {(renameError ?? roleError ?? descriptionError ?? closeError ?? removeError ?? cloneError ?? worktreeError ?? restartError) && (
          <div className="flex-shrink-0 border-b border-line bg-accent-red/5 px-5 py-1.5 text-[11px] text-accent-red break-words">
            {renameError ?? roleError ?? descriptionError ?? closeError ?? removeError ?? cloneError ?? worktreeError ?? restartError}
          </div>
        )}

        {worktreeNeedsRestart && (
          <div
            role="status"
            className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-accent-amber/5 px-5 py-1.5 text-[11px] text-accent-amber break-words"
          >
            <span className="min-w-0 flex-1">
              Worktree created, but {agent.name} is still running in {agent.workdir}. Restart its window to work inside {effectiveWorktreePath ?? 'the worktree'}.
            </span>
            <button
              type="button"
              onClick={() => { setConfirmingRestart(true) }}
              disabled={restarting}
              className="inline-flex h-6 cursor-pointer items-center rounded-[6px] border border-accent-amber/40 bg-canvas px-2 text-[11px] font-medium text-accent-amber transition hover:border-accent-amber disabled:pointer-events-none disabled:opacity-40"
            >
              {restarting ? 'Restarting…' : 'Restart in worktree'}
            </button>
          </div>
        )}

        <div className="flex flex-col flex-1 overflow-hidden p-5">
          <AgentInfoTabs
            tabs={tabs}
            activeId={activeTabId}
            onActiveIdChange={handleActiveTabChange}
            tabListLabel={`${agent.name} detail sections`}
            className="flex flex-col flex-1 min-h-0"
          />
        </div>

        <ConfirmDialog
          open={confirmingRemove}
          message={`Destroy agent "${agent.name}"? This kills its tmux window, deletes it from conductor.conf, and drops its queued tasks.`}
          confirmLabel="Destroy"
          onConfirm={() => { void doRemove() }}
          onCancel={() => { setConfirmingRemove(false) }}
        />
        <ConfirmDialog
          open={confirmingClose}
          message={`Stop agent "${agent.name}"'s window and close this view? The agent stays registered and can be relaunched with "Create window".`}
          confirmLabel="Stop"
          onConfirm={() => { void doCloseWindow() }}
          onCancel={() => { setConfirmingClose(false) }}
        />
        <ConfirmDialog
          open={confirmingWorktree}
          message={`${agent.name} is running in ${agent.workdir}. A new worktree will not move the running agent; it keeps editing that directory until its window is restarted. Create the worktree anyway?`}
          confirmLabel="Create worktree"
          onConfirm={() => { setConfirmingWorktree(false); void handleCreateWorktree() }}
          onCancel={() => { setConfirmingWorktree(false) }}
        />
        <ConfirmDialog
          open={confirmingRestart}
          message={`Restart "${agent.name}" in its worktree? This stops the running agent process and relaunches it; in-flight work and conversation context are lost.${status === 'busy' || status === 'awaiting' || status === 'stalled' ? ` ${agent.name} is currently ${status === 'awaiting' ? 'waiting for input' : status}: restarting now will interrupt what it is doing.` : ''}`}
          confirmLabel="Restart"
          onConfirm={() => { void doRestartInWorktree() }}
          onCancel={() => { setConfirmingRestart(false) }}
        />
        {showAddBg && (
          <AddBgProcessForm
            open
            defaultProjectId={projectId}
            onClose={() => { setShowAddBg(false) }}
          />
        )}
      </div>
    </ErrorBoundary>
  )
}

// Compact sidebar row. All detail (task queue, mode switch, window
// controls, log tail) lives in AgentDetailView — clicking the row selects it into the main pane.
function AgentItem({ agent, project, selected = false, onExpand }: {
  agent: Agent
  project: string | null
  /** True when this row's agent is the one rendered in the main detail pane. */
  selected?: boolean
  onExpand: (armInteract: boolean) => void
}) {
  const status = deriveStatus(agent)
  const lastPayload = useLastPayload(agent.id)
  const lastPayloadPreview = lastPayload ? firstLinePreview(lastPayload.text) : ''

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => { onExpand(false) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand(false) } }}
      className={`flex flex-col gap-1.5 animate-popIn cursor-pointer select-none rounded-[10px] border border-r-[4px] border-line px-3.5 py-2.5 shadow-card transition-shadow hover:shadow-card-hover ${selected ? 'bg-canvas ring-2 ring-accent-blue/50' : 'bg-card'}`}
      style={{ borderRightColor: isInactiveStatus(status) ? INACTIVE_BORDER_COLOR : status === 'empty' ? 'transparent' : getStatusColor(status) }}
      aria-current={selected ? 'true' : undefined}
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

      {/* Last payload — own slot when present (TASK-0227; replaces the transient activeTask) */}
      {lastPayload && lastPayloadPreview !== '' && (
        <span className="block truncate font-mono text-[10px] text-muted-2" title={lastPayload.text}>
          {lastPayloadPreview}
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

// Agents live in a single flat list sorted by project; within a project they follow the
// user's saved drag order, else alphabetical (see sortAgentsForSidebar).

// Statuses that always render as sidebar rows and take part in Cmd+Shift+Arrow cycling.
// The rest (no-window, exited, unknown) are "not running" and only appear while the
// "Show inactive" checkbox is on. `error` is intentionally in both sets — an errored
// agent is always shown.
const ACTIVE_STATUSES: readonly AgentStatus[] = [
  'awaiting',
  'stalled',
  'error',
  'busy',
  'starting',
  'idle',
  'idle-waiting',
  'empty',
]

function isActiveStatus(status: AgentStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}

// Statuses treated as "not running" — hidden from the sidebar (and shortcut cycling)
// unless "Show inactive" is checked.
const INACTIVE_STATUSES: readonly AgentStatus[] = ['no-window', 'exited', 'error', 'unknown']

export function isInactiveStatus(status: AgentStatus): boolean {
  return INACTIVE_STATUSES.includes(status)
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
function BgProcessRow({ bg, projects, onUpdated, onRestarted }: { bg: BgProcess; projects: Project[]; onUpdated: (updated: BgProcess, previousSlug: string) => void; onRestarted: (slug: string, result: BgRestartResult) => void }) {
  const [acting, setActing] = useState<'open' | 'close' | 'remove' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)

  const [editing, setEditing] = useState(false)
  const [editWorkdir, setEditWorkdir] = useState(bg.workdir)
  const [editLaunchCmd, setEditLaunchCmd] = useState(bg.launchCmd)
  const [editProjectId, setEditProjectId] = useState<number>(bg.projectId)
  const [editError, setEditError] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)

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
    void callApi(`/bg-processes/${encodeURIComponent(bg.slug)}`, 'DELETE', 'remove')
  }

  function doCloseWindow() {
    setConfirmingClose(false)
    void callApi(`/bg-processes/${encodeURIComponent(bg.slug)}/window`, 'DELETE', 'close')
  }

  function startEdit() {
    setEditWorkdir(bg.workdir)
    setEditLaunchCmd(bg.launchCmd)
    setEditProjectId(bg.projectId)
    setEditError(null)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setEditError(null)
  }

  async function saveEdit() {
    if (!editWorkdir.startsWith('/')) {
      setEditError('Working directory must be an absolute path (start with /)')
      return
    }
    if (!editLaunchCmd.trim()) {
      setEditError('Launch command is required')
      return
    }
    setEditSaving(true)
    setEditError(null)
    try {
      const saved = await updateBgProcess(bg.slug, {
        workdir: editWorkdir,
        launchCmd: editLaunchCmd,
        projectId: editProjectId,
      })
      const projectName = projects.find((p) => p.id === saved.projectId)?.name ?? bg.projectName
      onUpdated({
        ...bg,
        // A project change re-derives the slug (`<projectName>-<name>`).
        slug: `${projectName}-${bg.name}`,
        workdir: saved.workdir,
        launchCmd: saved.launchCmd,
        projectId: saved.projectId,
        projectName,
      }, bg.slug)
      setEditing(false)
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setEditSaving(false)
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border px-4 py-3 ${bg.windowPresent ? 'border-line bg-canvas' : 'border-accent-amber/30 bg-accent-amber/5'}`}>
      <span className="font-mono text-[13px] font-medium text-ink" title={bg.slug !== bg.name ? bg.slug : undefined}>{bg.name}</span>
      {bg.slug !== bg.name && (
        <span className="font-mono text-[11px] text-muted-2" data-testid="bg-slug">{bg.slug}</span>
      )}
      <BgLivenessBadge liveness={bg.liveness} windowPresent={bg.windowPresent} />
      <span className="truncate font-mono text-[11px] text-muted-2" title={`${bg.launchCmd} (in ${bg.workdir})`}>{bg.launchCmd}</span>
      <BgLastRestart lastRestart={bg.lastRestart} className="min-w-0 max-w-full truncate" />
      <div className="ml-auto flex flex-shrink-0 items-center gap-2">
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            disabled={acting !== null}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-card px-3 text-[12px] font-medium text-ink-2 transition hover:bg-canvas active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          >
            Edit
          </button>
        )}
        {/* Only with a live window: when it is missing, "Open window" below already covers starting it. */}
        {bg.windowPresent && (
          <BgRestartButton
            slug={bg.slug}
            label={bg.name}
            windowPresent={bg.windowPresent}
            projectName={bg.projectName}
            onRestarted={(result) => { onRestarted(bg.slug, result) }}
          />
        )}
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
            onClick={() => { void callApi(`/bg-processes/${encodeURIComponent(bg.slug)}/window`, 'POST', 'open') }}
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
      {editing && (
        <div className="mt-1 flex w-full flex-col gap-2 rounded-[8px] border border-line bg-card p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Working Directory</label>
              <input
                type="text"
                value={editWorkdir}
                onChange={(e) => { setEditWorkdir(e.target.value) }}
                placeholder="/absolute/path"
                className="w-full rounded-[8px] border border-line-input bg-canvas px-3 py-1.5 font-mono text-[12px] text-ink placeholder:text-muted-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Launch Command</label>
              <input
                type="text"
                value={editLaunchCmd}
                onChange={(e) => { setEditLaunchCmd(e.target.value) }}
                placeholder="npm run dev"
                className="w-full rounded-[8px] border border-line-input bg-canvas px-3 py-1.5 font-mono text-[12px] text-ink placeholder:text-muted-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Project</label>
            <select
              value={editProjectId.toString()}
              onChange={(e) => { setEditProjectId(Number(e.target.value)) }}
              className="w-full rounded-[8px] border border-line-input bg-canvas px-3 py-1.5 font-mono text-[12px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <p className="text-[10px] text-muted-2">
            Changes are saved to the process definition only — they take effect the next time this process&apos;s window is (re)created (Open window, or a fresh conductor.sh/spawn.sh run), not immediately.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void saveEdit() }}
              disabled={editSaving}
              className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-button-primary px-3 text-[12px] font-medium text-button-primary-text transition hover:opacity-90 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50"
            >
              {editSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={editSaving}
              className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-card px-3 text-[12px] font-medium text-ink-2 transition hover:bg-canvas active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
            >
              Cancel
            </button>
            {editError && <span className="text-[12px]" style={{ color: '#e5484d' }}>{editError}</span>}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmingRemove}
        message={`Remove background process ${bgQualifiedLabel(bg)}? This kills its tmux window (if any) and removes it from the conductor registry.`}
        confirmLabel="Remove"
        onConfirm={doRemove}
        onCancel={() => { setConfirmingRemove(false) }}
      />
      <ConfirmDialog
        open={confirmingClose}
        message={`Close the window of ${bgQualifiedLabel(bg)}? The process stays registered and can be relaunched with "Open window".`}
        confirmLabel="Close"
        onConfirm={doCloseWindow}
        onCancel={() => { setConfirmingClose(false) }}
      />
    </div>
  )
}

// Bg-process equivalent of AgentList's projectLabelFor/projectIdFor below —
// direct field reads off the bg-process payload itself, no name-keyed map.
const bgProjectLabelFor = (bg: BgProcess): string => bg.projectName
const bgProjectIdFor = (bg: BgProcess): number => bg.projectId

// Cluster a pre-sorted list into consecutive same-project groups, mirroring
// groupByProject below but scoped to BgProcess[]. Bg processes have no
// status-derived kanban columns, so there's just one clustered list. Every bg
// process belongs to a project (TASK-0195), so there is no "Unassigned" group.
const groupBgsByProject = (list: BgProcess[]): { project: string; projectId: number; bgs: BgProcess[] }[] => {
  const groups: { project: string; projectId: number; bgs: BgProcess[] }[] = []
  for (const bg of list) {
    const project = bgProjectLabelFor(bg)
    const last = groups[groups.length - 1]
    if (last && last.projectId === bgProjectIdFor(bg)) last.bgs.push(bg)
    else groups.push({ project, projectId: bgProjectIdFor(bg), bgs: [bg] })
  }
  return groups
}

function BgProcessSection({ bgs, onUpdated, onRestarted }: { bgs: BgProcess[]; onUpdated: (updated: BgProcess, previousSlug: string) => void; onRestarted: (slug: string, result: BgRestartResult) => void }) {
  // Fetched once here (not per-row) so every BgProcessRow's edit form shares
  // the same project options — mirrors AddBgProcessForm's own local fetch.
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => {
    listProjects().then(setProjects).catch(() => { /* best-effort */ })
  }, [])

  if (bgs.length === 0) {
    return (
      <div className="mt-6">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Background processes</h2>
        <p className="text-[13px] italic text-muted-2">No background processes.</p>
      </div>
    )
  }

  // Project name, then name — matches the project-ordering half of
  // AgentList's byProject below. groupBgsByProject only clusters consecutive
  // runs, so the input must be pre-sorted (project id breaks name ties so two
  // same-named projects never interleave).
  const sorted = [...bgs].sort((a, b) => {
    const cmp = bgProjectLabelFor(a).toLowerCase().localeCompare(bgProjectLabelFor(b).toLowerCase())
    if (cmp !== 0) return cmp
    if (a.projectId !== b.projectId) return a.projectId - b.projectId
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })
  const groups = groupBgsByProject(sorted)

  return (
    <div className="mt-6">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Background processes</h2>
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.projectId}>
            <p className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-2">
              {group.project}
            </p>
            <div className="flex flex-col gap-2">
              {group.bgs.map((bg) => <BgProcessRow key={bg.slug} bg={bg} projects={projects} onUpdated={onUpdated} onRestarted={onRestarted} />)}
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

// ── Main ──────────────────────────────────────────────────────────────────

// Project membership rides on the agent payload itself, so resolution is a
// direct field read — no name-keyed map that would collapse same-named agents.
const projectLabelFor = (agent: Agent): string | null => agent.projectName
const projectIdFor = (agent: Agent): number | null => agent.projectId

// Shared comparator: project name only (case-insensitive, unassigned last). Keeps
// same-project agents adjacent so the sidebar can sub-group by project; the order
// *within* a project comes from orderAgents (saved drag order, else alphabetical).
const byProject = (a: Agent, b: Agent): number => {
  const pa = projectLabelFor(a)
  const pb = projectLabelFor(b)
  if (pa === pb) return 0
  if (pa === null) return 1
  if (pb === null) return -1
  return pa.toLowerCase().localeCompare(pb.toLowerCase())
}

// Cluster a sorted list into consecutive same-project groups so the sidebar
// can render a project header above that project's rows.
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

// Sidebar order: projects alphabetical (unassigned last), and within each project the saved
// drag order first, then alphabetical by name. Shared by the sidebar render and the
// next/prev cycle list so the keyboard shortcut walks exactly what the sidebar shows.
const sortAgentsForSidebar = (agents: Agent[], saved: readonly number[]): Agent[] =>
  groupByProject([...agents].sort(byProject)).flatMap((group) => orderAgents(group.agents, saved))

// Left-hand agent list: filter input and "Show inactive" checkbox on top, then the
// agents grouped under project headers (unassigned last). Rows are AgentItem so the badges,
// context meter and "Direct Input" CTA stay defined in exactly one place.
function AgentSidebar({ agents, agentOrder, onReorder, onResetOrder, filterText, onFilterChange, showInactive, onShowInactiveChange, onExpand, selectedAgentId, totalAgentCount, collapsed, onToggleCollapsed }: {
  agents: Agent[]
  agentOrder: number[]
  onReorder: (project: string | null, activeId: number, overId: number) => void
  onResetOrder: () => void
  filterText: string
  onFilterChange: (value: string) => void
  showInactive: boolean
  onShowInactiveChange: (value: boolean) => void
  onExpand: (agentId: number, armInteract: boolean) => void
  selectedAgentId: number | null
  totalAgentCount: number
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const groups = groupByProject(sortAgentsForSidebar(agents, agentOrder))
  // `distance` keeps a plain click selecting the agent; drag only starts after 6px of movement.
  // No KeyboardSensor: rows are role="button" and Enter/Space already mean "select".
  // Called unconditionally (Rules of Hooks) even though the collapsed rail never uses it.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const ToggleIcon = collapsed ? ChevronRight : ChevronLeft
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar'

  return (
    <aside
      id="agent-sidebar"
      aria-label="Agents"
      style={{ width: collapsed ? SIDEBAR_COLLAPSED_WIDTH_PX : SIDEBAR_WIDTH_PX }}
      className={`flex-shrink-0 overflow-y-auto border-r border-line bg-canvas/40 motion-safe:transition-[width] ${collapsed ? 'p-1.5' : 'p-3'}`}
    >
      <div className={`mb-2 flex ${collapsed ? 'justify-center' : 'justify-end'}`}>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="agent-sidebar"
          aria-label={toggleLabel}
          title={toggleLabel}
          className="rounded-[6px] p-1 text-muted hover:text-ink"
        >
          <ToggleIcon size={16} aria-hidden="true" />
        </button>
      </div>
      {collapsed ? (
        <div className="flex flex-col items-center gap-1.5">
          {sortAgentsForSidebar(agents, agentOrder).map((agent) => (
            <SidebarRailDot
              key={agent.id}
              agent={agent}
              selected={selectedAgentId === agent.id}
              onSelect={() => { onExpand(agent.id, false) }}
            />
          ))}
        </div>
      ) : (
        <>
          {totalAgentCount > 0 && (
            <input
              type="text"
              value={filterText}
              onChange={(e) => { onFilterChange(e.target.value) }}
              placeholder="Filter agents by name, project, role, or branch…"
              aria-label="Filter agents"
              className="mb-4 w-full rounded-[8px] border border-line-input bg-card px-3 py-1.5 font-mono text-[12px] text-ink placeholder:text-muted-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:opacity-40"
            />
          )}
          {totalAgentCount > 0 && (
            <label className="mb-4 flex items-center gap-1.5 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => { onShowInactiveChange(e.target.checked) }}
              />
              Show inactive
            </label>
          )}
          {totalAgentCount > 0 && agentOrder.length > 0 && (
            <button type="button" onClick={onResetOrder} className="mb-4 text-[12px] text-muted underline hover:text-ink">
              Reset to A–Z
            </button>
          )}
          {totalAgentCount === 0 ? (
            <p className="text-[13px] italic text-muted-2">No agents registered.</p>
          ) : filterText.trim() !== '' && agents.length === 0 ? (
            <p className="text-[13px] italic text-muted-2">No agents match your filter.</p>
          ) : agents.length === 0 ? (
            // Only reachable with "Show inactive" off: with it on, `agents` is every registered
            // agent, so an empty list under a blank filter implies totalAgentCount === 0 above.
            <p className="text-[13px] italic text-muted-2">No active agents.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((group) => (
                <div key={group.project ?? '__unassigned__'}>
                  <p className="mb-1.5 flex items-baseline justify-between px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-2">
                    <span className="truncate">{group.project ?? 'Unassigned'}</span>
                    <span className="ml-2 flex-shrink-0 font-mono text-[10px] font-medium normal-case tracking-normal">{group.agents.length}</span>
                  </p>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={({ active, over }: DragEndEvent) => {
                      if (!over || active.id === over.id) return
                      onReorder(group.project, Number(active.id), Number(over.id))
                    }}
                  >
                    <SortableContext items={group.agents.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                      {group.agents.map((agent) => (
                        <SortableAgentRow
                          key={agent.id}
                          agent={agent}
                          project={projectLabelFor(agent)}
                          selected={selectedAgentId === agent.id}
                          onExpand={(armInteract) => { onExpand(agent.id, armInteract) }}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  )
}

// One status-colored dot per agent in the collapsed sidebar rail. Selection calls the same
// callback the expanded rows use; the name lives only in aria-label/title (no room for text).
// The hover title is `<project> <agent>` (agent names are only unique per project); the
// aria-label stays the bare agent name.
function SidebarRailDot({ agent, selected, onSelect }: {
  agent: Agent
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={agent.name}
      title={agent.projectName ? `${agent.projectName} ${agent.name}` : agent.name}
      aria-current={selected ? 'true' : undefined}
      className={`flex h-6 w-6 items-center justify-center rounded-full transition ${selected ? 'bg-line ring-2 ring-accent' : 'hover:bg-line'}`}
    >
      <span
        aria-hidden="true"
        className="block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: getStatusColor(deriveStatus(agent)) }}
      />
    </button>
  )
}

// One draggable sidebar row. Only `listeners` are spread (not dnd-kit's `attributes`, whose
// role="button" would nest inside AgentItem's own role="button"). The transform lives on this
// wrapper rather than the row because the row's animate-popIn already animates transform.
function SortableAgentRow({ agent, project, selected, onExpand }: {
  agent: Agent
  project: string | null
  selected: boolean
  onExpand: (armInteract: boolean) => void
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: agent.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...listeners}
      className={`mb-2 last:mb-0 ${isDragging ? 'relative z-10 opacity-60' : ''}`}
    >
      <AgentItem agent={agent} project={project} selected={selected} onExpand={onExpand} />
    </div>
  )
}

export default function AgentList() {
  const apiUrl = API_BASE

  const [agents, setAgents] = useState<Agent[]>([])
  const [bgs, setBgs] = useState<BgProcess[]>([])
  const [sessionAlive, setSessionAlive] = useState<boolean>(true)
  const [sessionExists, setSessionExists] = useState<boolean>(true)
  const [loading, setLoading] = useState<boolean>(true)
  const [filterText, setFilterText] = useState('')
  const [showInactive, setShowInactive] = useState(false)
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
  // Selection state (historically "expanded"; now the agent shown in the main detail pane)
  // lives here (not in AgentItem) so it survives a status change remounting AgentItem.
  // Keyed by the globally-unique agent id, not name.
  const [expandedAgent, setExpandedAgent] = useState<{ id: number; armInteract: boolean } | null>(null)
  // Cycle navigation (Cmd+Shift+Arrow) walks one list: the active agents, plus the
  // inactive ones (no-window, exited, unknown) when the "Show inactive" checkbox is on.
  // Built from the unfiltered `agents` (not filteredAgents) deliberately: if a user has
  // an agent's detail pane open and then types a filter that would exclude that agent
  // from the sidebar, prev/next navigation should not suddenly change behavior or
  // strand — keeping full-list navigation independent of the sidebar filter is the
  // least surprising choice.
  const cycleAgents = useMemo(
    () => agents.filter((a) => showInactive || isActiveStatus(deriveStatus(a))),
    [agents, showInactive],
  )
  // User-defined within-project order (flat list of agent ids, persisted in localStorage).
  // Empty means "alphabetical everywhere". Declared above the early returns (Rules of Hooks).
  const [agentOrder, setAgentOrder] = useState<number[]>(() => loadOrder())
  // Sidebar rail mode (persisted). The setter updates module state first so the terminal size
  // probe reads the new width, then re-syncs the terminals to the reflowed pane.
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(() => loadSidebarCollapsed())
  const handleToggleSidebarCollapsed = useCallback(() => {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    setSidebarCollapsedState(next)
    reprobeTerminalSize()
  }, [sidebarCollapsed])
  // Computed from the unfiltered `agents` so members hidden by the filter or the inactive
  // toggle keep their relative positions when a visible row is dragged.
  const handleReorder = useCallback(
    (groupProject: string | null, activeId: number, overId: number) => {
      const group = groupByProject(sortAgentsForSidebar(agents, agentOrder)).find(
        (g) => g.project === groupProject,
      )
      if (!group) return
      const next = reorderGroup(
        group.agents.map((a) => a.id),
        activeId,
        overId,
        agentOrder,
      )
      setAgentOrder(next)
      saveOrder(next)
    },
    [agents, agentOrder],
  )
  const handleResetOrder = useCallback(() => {
    clearOrder()
    setAgentOrder([])
  }, [])
  // Cycling follows what the user sees: the sidebar's flat order (project alphabetical,
  // then the saved drag order within a project, else name — the same sortAgentsForSidebar
  // rule AgentSidebar renders with). Recomputed whenever the cycle set or the saved order
  // changes.
  const orderedAgentIds = useMemo(
    () => sortAgentsForSidebar(cycleAgents, agentOrder).map((a) => a.id),
    [cycleAgents, agentOrder],
  )
  const handleNavigate = useCallback((dir: 'prev' | 'next') => {
    setExpandedAgent((prev) => {
      if (!prev) return prev
      const idx = orderedAgentIds.indexOf(prev.id)
      // A selection outside the cycle set (e.g. an agent removed mid-selection, or an
      // inactive agent selected while "Show inactive" is off) makes the shortcut a
      // no-op rather than jumping somewhere unrelated.
      if (idx === -1) return prev
      const next = ((dir === 'next' ? idx + 1 : idx - 1) + orderedAgentIds.length) % orderedAgentIds.length
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
        // A stale/older host-server may omit array fields in /status.
        // Coerce to arrays so a missing agents/bgProcesses can't crash the render
        // (e.g. BgProcessSection's `bgs.length` on an undefined value).
        const agentList = Array.isArray(data.agents) ? data.agents : []
        // Mirror before the SSE guard: newest-wins makes a redundant write harmless.
        for (const agent of agentList) mirrorLastPrompt(agent)
        if (!hasReceivedSSEStateRef.current) {
          setAgents(agentList)
          // Only sweep against a real list: a stale server omitting `agents` coerces to [] above,
          // and sweeping against that would wipe every stored payload.
          if (Array.isArray(data.agents)) sweepOrphanedLastPayloads(agentList.map((a) => a.id))
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
    mirrorLastPrompt(updated)
    const newStatus = deriveStatus(updated)
    const prevStatus = prevStatusRef.current.get(updated.id)
    // Sound only when an agent switches into a needs-input state (waiting/stalled); every other transition is silent.
    if (needsAttention(newStatus) && prevStatus !== undefined && !needsAttention(prevStatus)) {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => { playDoorbell(ctx) }).catch(() => { /* autoplay blocked */ })
      } else {
        playDoorbell(ctx)
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
      clearLastPayload(id)
      setAgents((prev) => prev.filter((a) => a.id !== id))
      // Deselect a removed agent so the pane returns to the empty state and does not
      // resurrect the selection if an agent with this id ever reappears. Done here rather
      // than in an effect on `agents`: a just-cloned agent is selected (onCloned) before its
      // SSE agent-update lands, so "selected id absent from agents" is not proof of removal.
      setExpandedAgent((prev) => (prev?.id === id ? null : prev))
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
      const idx = prev.findIndex((b) => b.slug === updated.slug)
      if (idx === -1) return [...prev, updated]
      const next = [...prev]
      next[idx] = { ...next[idx], ...updated }
      return next
    })
  })

  // Local counterpart to the bg-update SSE handler above: the PATCH route
  // only writes SQLite (workdir/launchCmd/projectId) and doesn't touch the
  // live tmux window, so the poll loop's windowPresent/state/liveness
  // diff never fires an SSE broadcast for it — the edit form applies the
  // saved fields to local state directly instead of waiting on the server.
  const handleBgUpdated = useCallback((updated: BgProcess, previousSlug: string) => {
    setBgs((prev) => {
      const idx = prev.findIndex((b) => b.slug === previousSlug)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], ...updated }
      return next
    })
  }, [])

  // Optimistic patch after a successful Restart/Start (TASK-0206): the server
  // has just (re)created the window, so flip liveness/windowPresent now; the
  // bg-update SSE from pollAndDiff then reconciles it. lastRestart is patched
  // too (TASK-0207): the dashboard is always a null-caller (human) restart.
  const handleBgRestarted = useCallback((slug: string, result: BgRestartResult) => {
    setBgs((prev) => prev.map((b): BgProcess => (
      b.slug === slug
        ? { ...b, liveness: 'running', windowPresent: true, lastRestart: { at: result.restartedAt, caller: null } }
        : b
    )))
  }, [])

  useSSEEvent<{ slug?: string; name?: string }>('bg-removed', (data) => {
    if (typeof data.slug === 'string') {
      const { slug } = data
      setBgs((prev) => prev.filter((b) => b.slug !== slug))
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

  // Resolved against the full `agents` state (not only the cycle set) so a selected
  // inactive agent still renders in the pane when "Show inactive" is unchecked.
  const selectedAgent = expandedAgent ? agents.find((a) => a.id === expandedAgent.id) : undefined
  // TASK-0232: publish the selected agent's project for NavBar's Add Agent modal preselect.
  const selectedProjectId = selectedAgent?.projectId ?? null
  useEffect(() => {
    setActiveAgentProjectId(selectedProjectId)
  }, [selectedProjectId])
  useEffect(() => () => { setActiveAgentProjectId(null) }, [])
  // The view's prev/next counter reflects the list the shortcut cycles through.
  const selectedCycleCount = orderedAgentIds.length

  const sectionLabelCls = 'mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted'

  if (loading) {
    return (
      <div className="px-6 py-6">
        <h1 className={sectionLabelCls}>tmux Conductor — Agents</h1>
        <p className="animate-pulse text-[13px] italic text-muted-2">Loading…</p>
      </div>
    )
  }

  if (error) {
    const isNotConnected = error.includes('HTTP 404') || error.includes('HTTP 503')
    return (
      <div className="px-6 py-6">
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
      <div className="px-6 py-6">
        <h1 className={sectionLabelCls}>tmux Conductor — Agents</h1>
        <SessionBanner sessionExists={sessionExists} />
      </div>
    )
  }

  // Agents that match the filter; the sidebar sorts and groups them by project →
  // status. Inactive agents are included only when "Show inactive" is checked.
  const visibleAgents = showInactive
    ? filteredAgents
    : filteredAgents.filter((a) => isActiveStatus(deriveStatus(a)))

  return (
    <div className="flex min-h-0 flex-1 animate-riseIn flex-col">
      <div className="px-6 pt-6">
        {!sessionAlive && <SessionBanner sessionExists={sessionExists} />}
      </div>
      <div className="flex min-h-0 flex-1 border-t border-line">
        <AgentSidebar
          agents={visibleAgents}
          agentOrder={agentOrder}
          onReorder={handleReorder}
          onResetOrder={handleResetOrder}
          filterText={filterText}
          onFilterChange={setFilterText}
          showInactive={showInactive}
          onShowInactiveChange={setShowInactive}
          onExpand={(id, armInteract) => { setExpandedAgent({ id, armInteract }) }}
          selectedAgentId={expandedAgent?.id ?? null}
          totalAgentCount={agents.length}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={handleToggleSidebarCollapsed}
        />
        {/* Rendered from live `agents` state so the badge/banner keep updating while the
            agent is selected; if it is removed, the lookup empties and the pane falls back
            to the empty state. Keyed by agent id so switching rows fully remounts the view
            (resets rename/role inputs, confirm dialogs, active tab, worktree override). */}
        {selectedAgent && expandedAgent ? (
          <div
            role="region"
            aria-label={`${selectedAgent.name} detail`}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <AgentDetailView
              key={selectedAgent.id}
              agent={selectedAgent}
              project={projectLabelFor(selectedAgent)}
              projectId={projectIdFor(selectedAgent)}
              projectBgs={bgs.filter((b) => projectIdFor(selectedAgent) !== null && b.projectId === projectIdFor(selectedAgent))}
              onBgRestarted={handleBgRestarted}
              status={deriveStatus(selectedAgent)}
              armInteract={expandedAgent.armInteract}
              onClose={() => { setExpandedAgent(null) }}
              agentCount={selectedCycleCount}
              onNavigate={handleNavigate}
              onRenamed={(id, newName) => {
                // Optimistic rename by stable id; the SSE agent-renamed reconciles too.
                setAgents((prev) => prev.map((a) => a.id === id ? { ...a, name: newName } : a))
              }}
              onRoleChanged={(id, role) => {
                // Optimistic role change by stable id; the next status poll/SSE reconciles too.
                setAgents((prev) => prev.map((a) => a.id === id ? { ...a, role } : a))
              }}
              onDescriptionChanged={(id, description) => {
                // Optimistic description change by stable id; the SSE agent-update reconciles too.
                setAgents((prev) => prev.map((a) => a.id === id ? { ...a, description } : a))
              }}
              onWorktreeCreated={(id, worktreePath, branch) => {
                // Optimistic local patch; the SSE agent-update from the host-server reconciles every other client.
                setAgents((prev) => prev.map((a) => a.id === id ? { ...a, worktreePath, branch } : a))
              }}
              onCloned={(id) => {
                // cloneAgent() only returns the thin ApiAgent shape (no status/mode/etc.), so we
                // can't optimistically splice a full Agent into state here — just re-point the
                // selection at the new id and wait for the SSE agent-update the host-server
                // already broadcasts right after spawning it to populate `agents`.
                setExpandedAgent({ id, armInteract: false })
              }}
            />
          </div>
        ) : (
          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            <div className="mb-6 rounded-[10px] border border-line bg-card px-5 py-8 text-center shadow-card">
              <p className="text-[13px] italic text-muted-2">Select an agent from the sidebar</p>
            </div>
            <BgProcessSection bgs={bgs} onUpdated={handleBgUpdated} onRestarted={handleBgRestarted} />
          </div>
        )}
      </div>
    </div>
  )
}
