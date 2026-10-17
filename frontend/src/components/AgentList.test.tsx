import { useEffect, type ComponentProps } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { __resetLastPayloadCacheForTests, loadLastPayload, saveLastPayload } from '../lib/lastPayload'

// TASK-157: AgentDetailModal's Terminal tab wraps LogTail, whose own effect mounts a real
// @xterm/xterm Terminal — jsdom has no window.matchMedia (see terminalSizeProbe.test.ts's own
// comment on this exact gap), so a genuine Terminal instance is out of scope for this test
// environment. Stub LogTail itself instead, as a real component (not vi.fn()) so React's
// mount/unmount lifecycle runs for real and is observable via spies. This is what the
// Terminal-tab-persistence tests below use to assert "never unmounted across tab switches"
// without needing a working xterm instance — the claim under test is AgentInfoTabs' own
// mounting contract (every present tab's content renders on every render; only a `hidden`
// class toggles visibility), not xterm's internals, which are TASK-131's concern, not this
// task's.
const { logTailMountSpy, logTailUnmountSpy } = vi.hoisted(() => ({
  logTailMountSpy: vi.fn(),
  logTailUnmountSpy: vi.fn(),
}))
// Latest onInteractChange handed to the mocked LogTail, so wrapper tests can simulate Direct Input
// turning on/off the way the real LogTail reports it.
const mockLogTailHandlers: {
  onInteractChange: ((interacting: boolean) => void) | undefined
  onCloseModal: (() => void) | undefined
} = { onInteractChange: undefined, onCloseModal: undefined }
function MockLogTail(props: { agentId: number; interactSignal?: number; onInteractChange?: (interacting: boolean) => void; onCloseModal?: () => void }) {
  useEffect(() => {
    mockLogTailHandlers.onInteractChange = props.onInteractChange
    mockLogTailHandlers.onCloseModal = props.onCloseModal
  })
  useEffect(() => {
    logTailMountSpy(props.agentId)
    return () => { logTailUnmountSpy(props.agentId) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div data-testid="mock-log-tail" data-agent-id={props.agentId} data-interact-signal={props.interactSignal} />
}
vi.mock('./LogTail', () => ({ default: MockLogTail }))

// TASK-0209: the "Create worktree" menu tests observe the API call through a spy standing in for
// createWorktreeForAgent (every other ../lib/api export stays real).
// TASK-0205: `bgTail` is stubbed too so the Background tab's output polling never hits the network.
// TASK-0214: `cloneAgent` is a spy too, but delegates to the real implementation by default so the
// older clone tests (which stub `fetch`) keep working; the "Clone into new worktree" tests override
// it per-call with `mockImplementationOnce` and assert the exact arguments.
// TASK-0216: `restartAgentWindow` is a spy as well (the warn-first / Restart-in-worktree tests).
const { createWorktreeForAgentMock, restartAgentWindowMock, bgTailMock, cloneAgentMock } = vi.hoisted(() => ({
  createWorktreeForAgentMock: vi.fn(),
  restartAgentWindowMock: vi.fn(),
  bgTailMock: vi.fn(),
  cloneAgentMock: vi.fn(),
}))
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  cloneAgentMock.mockImplementation((...args: Parameters<typeof actual.cloneAgent>) => actual.cloneAgent(...args))
  return { ...actual, createWorktreeForAgent: createWorktreeForAgentMock, restartAgentWindow: restartAgentWindowMock, bgTail: bgTailMock, cloneAgent: cloneAgentMock }
})

// TASK-0201: toggling the sidebar re-probes the terminal size so xterm re-fits the reflowed pane.
// Only `reprobeTerminalSize` is replaced (with a spy); every other export stays real.
const { reprobeTerminalSizeSpy } = vi.hoisted(() => ({ reprobeTerminalSizeSpy: vi.fn() }))
vi.mock('../lib/terminalSizeProbe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/terminalSizeProbe')>()
  return { ...actual, reprobeTerminalSize: reprobeTerminalSizeSpy }
})

// TASK-0183: jsdom cannot drive real pointer drags, so the sidebar's drag-to-reorder wiring is
// tested by capturing each project group's DndContext `onDragEnd` and invoking it directly with
// the event dnd-kit would deliver. The wrapper is a passthrough (the real DndContext still
// renders). Each group's DndContext wraps exactly one SortableContext, whose `items` are that
// group's agent ids — so a handler is looked up by any member id (see `dragRow`), newest entry
// first so the handler closes over the latest render's state.
const dndCapture = vi.hoisted(() => ({
  entries: [] as { items: number[]; onDragEnd: (event: DragEndEvent) => void }[],
}))
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const { createElement, isValidElement, useEffect: useReactEffect } = await import('react')
  function CapturingDndContext(props: ComponentProps<typeof actual.DndContext>) {
    const child = props.children
    const items = isValidElement<{ items?: number[] }>(child) ? (child.props.items ?? []) : []
    useReactEffect(() => {
      dndCapture.entries.push({ items, onDragEnd: (event) => { props.onDragEnd?.(event) } })
    })
    return createElement(actual.DndContext, props)
  }
  return { ...actual, DndContext: CapturingDndContext }
})

import AgentList, {
  agentMatchesFilter,
  AgentDetailView,
  formatCost,
  formatSessionStart,
  formatTokens,
  isValidAgentRole,
  ProjectBadge,
  resolveRoleBadge,
  ROLE_CONFIG,
  ROLE_VALUES,
  STATUS_CONFIG,
  UsageBadge,
  type Agent,
  type AgentStatus,
  type BgProcess,
} from './AgentList'
import AgentsPage from '../pages/AgentsPage'
import { AGENT_ORDER_STORAGE_KEY } from '../lib/agentOrder'
import { SIDEBAR_COLLAPSED_WIDTH_PX, SIDEBAR_WIDTH_PX } from '../lib/layoutConstants'
import { SIDEBAR_COLLAPSED_STORAGE_KEY, setSidebarCollapsed } from '../lib/sidebarState'
// RTL's auto-cleanup registration relies on vitest's `test.globals: true`, which this repo
// does not set (see vitest.setup.ts's own comment on the same constraint for jest-dom) — so
// without this, render() output from one test leaks into the next test's DOM within this
// file, causing "multiple elements found" failures the moment more than one render()-based
// test exists here. Explicit, not implicit.
afterEach(() => { cleanup() })
// TASK-0183: the sidebar persists a custom agent order in localStorage and reads it on mount, so
// clear it (and the captured drag handlers) before every test — nothing may leak between tests.
beforeEach(() => {
  localStorage.clear()
  dndCapture.entries.length = 0
  reprobeTerminalSizeSpy.mockClear()
})

// Simulates dropping the row for agent `activeId` onto the row for `overId` (or onto nothing when
// null) inside that agent's project group, by invoking the group's captured `onDragEnd`.
function dragRow(activeId: number, overId: number | null) {
  const entry = [...dndCapture.entries].reverse().find((e) => e.items.includes(activeId))
  if (!entry) throw new Error(`no captured DndContext onDragEnd for agent ${activeId.toString()}`)
  act(() => {
    entry.onDragEnd({ active: { id: activeId }, over: overId === null ? null : { id: overId } } as unknown as DragEndEvent)
  })
}

// ── formatTokens ──────────────────────────────────────────────────────────

describe('formatTokens', () => {
  it('formats 0 as "0"', () => {
    expect(formatTokens(0)).toBe('0')
  })

  it('formats 999 as "999" (below k-tier)', () => {
    expect(formatTokens(999)).toBe('999')
  })

  it('formats 1000 as "1k" (k-tier boundary)', () => {
    expect(formatTokens(1000)).toBe('1k')
  })

  it('formats 56201 as "56k"', () => {
    expect(formatTokens(56201)).toBe('56k')
  })

  it('formats 999999 as "1000k" (just under M-tier boundary)', () => {
    expect(formatTokens(999999)).toBe('1000k')
  })

  it('formats 1000000 as "1M" (M-tier boundary)', () => {
    expect(formatTokens(1000000)).toBe('1M')
  })

  it('formats 9964532 as "10M" (trailing-zero-stripped rounding)', () => {
    expect(formatTokens(9964532)).toBe('10M')
  })
})

// ── formatCost ────────────────────────────────────────────────────────────

describe('formatCost', () => {
  it('formats 0 as "" (empty string) so callers can detect and drop the cost segment', () => {
    // Was briefly '$0.00' due to an untracked regression (fixed by TASK-127's own follow-up
    // work) — this is the original spec from TASK-074/UAT-074, restored here. UsageBadge's
    // `cost ? ... : formatTokens(...)` and `cost || 'cost n/a'` both depend on this being falsy.
    expect(formatCost(0)).toBe('')
  })
  it('formats a negative value as "" (same as zero)', () => {
    expect(formatCost(-1)).toBe('')
  })

  it('formats 0.005 as "<$0.01" (positive but below cent granularity)', () => {
    expect(formatCost(0.005)).toBe('<$0.01')
  })

  it('formats 0.01 as "$0.01"', () => {
    expect(formatCost(0.01)).toBe('$0.01')
  })

  it('formats 0.140629 as "$0.14"', () => {
    expect(formatCost(0.140629)).toBe('$0.14')
  })

  it('formats 5.5 as "$5.50"', () => {
    expect(formatCost(5.5)).toBe('$5.50')
  })
})

// ── formatSessionStart ────────────────────────────────────────────────────

describe('formatSessionStart', () => {
  it('falls back to a truncated "…"-suffixed string for a UUID-shaped (unparseable) value', () => {
    expect(formatSessionStart('a1b2c3d4-5678-90ab-cdef-1234567890ab')).toBe('a1b2c3d4…')
  })

  it('takes the date-formatting branch for a real ISO date string', () => {
    const result = formatSessionStart('2026-07-06T10:00:00Z')
    expect(result.endsWith('…')).toBe(false)
  })
})

// ── resolveRoleBadge ──────────────────────────────────────────────────────

describe('resolveRoleBadge', () => {
  it('resolves a known non-generic role ("qa") to its current config', () => {
    expect(resolveRoleBadge('qa')).toEqual({
      role: 'qa',
      bg: 'var(--role-badge-qa-bg)',
      text: 'var(--role-badge-qa-text)',
      dot: '#06b6d4',
    })
  })

  it('returns null for the "generic" role', () => {
    expect(resolveRoleBadge('generic')).toBeNull()
  })

  it('returns null for null', () => {
    expect(resolveRoleBadge(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(resolveRoleBadge(undefined)).toBeNull()
  })

  it('returns null for an unrecognized role string', () => {
    expect(resolveRoleBadge('nonexistent-role')).toBeNull()
  })
})

// ── ROLE_VALUES / isValidAgentRole ────────────────────────────────────────
// TASK-115: ROLE_VALUES is derived from ROLE_CONFIG's own keys rather than
// hand-typed as a parallel list, so it structurally cannot diverge from the
// colour map the role selectors (AddAgentForm, ProjectList) reuse.

describe('ROLE_VALUES', () => {
  it("is derived from ROLE_CONFIG's own keys plus 'generic' — 7 total", () => {
    expect(ROLE_VALUES).toEqual(['generic', ...Object.keys(ROLE_CONFIG)])
    expect(ROLE_VALUES).toHaveLength(7)
  })
})

describe('isValidAgentRole', () => {
  it('accepts every value in ROLE_VALUES', () => {
    for (const role of ROLE_VALUES) {
      expect(isValidAgentRole(role)).toBe(true)
    }
  })

  it('rejects unknown, empty, and mismatched-case role strings', () => {
    expect(isValidAgentRole('manager')).toBe(false)
    expect(isValidAgentRole('')).toBe(false)
    // Case-sensitive on purpose — matches the backend's ROLE_VALUES.includes()
    // check (host-server/rolePresets.ts), which does not normalize case.
    expect(isValidAgentRole('Generic')).toBe(false)
    expect(isValidAgentRole('BACKEND')).toBe(false)
  })
})

// ── UsageBadge (render) ───────────────────────────────────────────────────

// Agent['usage'] is an indexed-access type over an *optional* field
// (`usage?: {...} | null`), which TS widens to include `undefined` via
// indexed access regardless of exactOptionalPropertyTypes — but this helper
// is only ever called with a real usage object or `null`, never `undefined`,
// so NonNullable<...> | null matches actual usage and satisfies the strict
// object-literal assignment below.
function baseAgent(usage: NonNullable<Agent['usage']> | null): Agent {
  return {
    id: 1,
    name: 'test-agent',
    projectId: null,
    projectName: null,
    state: 'idle',
    mode: 'default',
    windowPresent: true,
    queuedTasks: 0,
    launchCmd: 'claude',
    workdir: '/tmp/test',
    activeTask: null,
    usage,
  }
}

describe('UsageBadge', () => {
  it('renders the cost + token label derived from the real formatCost/formatTokens output', () => {
    const usage = {
      inputTokens: 1200,
      outputTokens: 3400,
      cacheCreationInputTokens: 500,
      cacheReadInputTokens: 250000,
      costUsd: 0.42,
      sessions: 1,
    }
    const agent = baseAgent(usage)
    const totalTokens =
      usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens
    const expectedLabel = `${formatCost(usage.costUsd)} · ${formatTokens(totalTokens)}`

    render(<UsageBadge agent={agent} />)

    const el = screen.getByText(expectedLabel)
    expect(el).toBeInTheDocument()
  })

  it('renders nothing when agent.usage is null', () => {
    const agent = baseAgent(null)
    const { container } = render(<UsageBadge agent={agent} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the token segment only for a zero-cost, nonzero-token agent — regression test for the formatCost "$0.00" bug', () => {
    // formatCost(0) briefly returned '$0.00' instead of '', which made this label read
    // "$0.00 · 255k" (asserting the session cost nothing, when it's actually unknown/unpriced)
    // instead of the intended token-only label. Pins the fix at the rendered-DOM level, not
    // just at formatCost's own unit level, since this bug specifically hid in the composition.
    const usage = {
      inputTokens: 1200,
      outputTokens: 3400,
      cacheCreationInputTokens: 500,
      cacheReadInputTokens: 250000,
      costUsd: 0,
      sessions: 1,
    }
    const agent = baseAgent(usage)
    const totalTokens =
      usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens

    render(<UsageBadge agent={agent} />)

    const el = screen.getByText(formatTokens(totalTokens))
    expect(el).toBeInTheDocument()
    expect(el.textContent).not.toContain('$0.00')
    expect(el.getAttribute('title')).toContain('cost n/a')
  })
})

// ── ProjectBadge (TASK-140: theme-aware HSL custom properties) ────────────
// The unassigned pill uses the neutral-badge var() tokens (Step 2); the named-project
// pill's inline hsl() now reads --project-badge-{bg,text}-{s,l} custom properties instead
// of hardcoded 94%/32% lightness (Step 7) — this pins the token-based output so a future
// edit can't silently reintroduce a hardcoded, theme-invariant lightness value. The exact
// hue per name is a deterministic char-code hash mapped into one of three safe sub-ranges
// (projectHue, private to AgentList.tsx — TASK-150 Step 3), verified here for the same two
// example project names ("cryptwiz", "tmux-conductor") the task's own audit used when
// checking both themes' contrast.

describe('ProjectBadge', () => {
  it('renders the unassigned pill using the neutral badge tokens', () => {
    render(<ProjectBadge name={null} />)
    const el = screen.getByText('Unassigned')
    expect(el.className).toContain('bg-[var(--color-badge-neutral-bg)]')
    expect(el.className).toContain('text-[var(--color-badge-neutral-text)]')
  })

  it('renders a named-project pill via the theme-aware HSL custom properties (hue 131 for "cryptwiz")', () => {
    render(<ProjectBadge name="cryptwiz" />)
    const badge = screen.getByText('cryptwiz')
    expect(badge.style.background).toBe('hsl(131 var(--project-badge-bg-s) var(--project-badge-bg-l))')
    expect(badge.style.color).toBe('hsl(131 var(--project-badge-text-s) var(--project-badge-text-l))')
  })

  it('computes a different, still-deterministic hue for a different name (hue 71 for "tmux-conductor")', () => {
    render(<ProjectBadge name="tmux-conductor" />)
    const badge = screen.getByText('tmux-conductor')
    expect(badge.style.background).toBe('hsl(71 var(--project-badge-bg-s) var(--project-badge-bg-l))')
    expect(badge.style.color).toBe('hsl(71 var(--project-badge-text-s) var(--project-badge-text-l))')
  })

  // TASK-150 Step 3: projectHue() now constrains its hash-derived output to one of three
  // safe sub-ranges — (56,132], (172,207], (278,331] — so identity (project) badge hues can
  // never fall inside the ±20° exclusion bands around the semantic status hues (amber/red/
  // green/blue/violet/rose). Assert this holds for a representative sample of project names,
  // real and synthetic, by parsing the rendered hue back out of the badge's inline hsl().
  it('never produces a hue inside an excluded (semantic-status) band, for a representative sample of project names', () => {
    const isSafe = (hue: number) =>
      (hue > 56 && hue <= 132) || (hue > 172 && hue <= 207) || (hue > 278 && hue <= 331)

    const sampleNames = [
      'cryptwiz',
      'tmux-conductor',
      'claude-code-lsp-enforcement-kit',
      'tmux-agent-status',
      'frontend',
      'host-server',
      'a',
      'ab',
      'abc',
      'project-1',
      'project-2',
      'project-3',
      'zzzzzzzzzz',
      'The Quick Brown Fox',
      '日本語プロジェクト',
      'x'.repeat(50),
      'my.project.name',
      'CamelCaseProject',
      'snake_case_project',
      'kebab-case-project',
    ]

    for (const name of sampleNames) {
      render(<ProjectBadge name={name} />)
      const badge = screen.getByText(name)
      const match = badge.style.background.match(/^hsl\((\d+(?:\.\d+)?) /)
      expect(match).not.toBeNull()
      const hue = Number(match?.[1] ?? 0)
      expect(isSafe(hue)).toBe(true)
      cleanup()
    }
  })
})

// ── StatusBadge / AgentTypeBadge token-reference regression (TASK-150 Step 4) ──
// STATUS_CONFIG and AgentTypeBadge's non-Claude branch were migrated from inline
// hex/rgba literals to the CSS custom properties defined in global.css (busy,
// idle-waiting→success, stalled/error→error, starting→neutral, codex type badge).
// StatusBadge/AgentTypeBadge are module-private (not exported), so assert through
// the full AgentList render tree using the same literal var(...) equality check the
// ProjectBadge tests above use for its hsl(...) inline styles.

describe('status and agent-type badge tokens (TASK-150 Step 4 detokenization)', () => {
  function stubEventSourceAndFetch(agent: Agent) {
    class MockEventSource {
      addEventListener() { /* no-op */ }
      removeEventListener() { /* no-op */ }
      close() { /* no-op */ }
    }
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({
        session: 'test-session',
        sessionAlive: true,
        sessionExists: true,
        agents: [agent],
        bgProcesses: [],
        timestamp: new Date().toISOString(),
      }),
    }))
  }

  it('renders the "busy" status badge using --color-status-busy-{bg,text}', async () => {
    stubEventSourceAndFetch({ ...baseAgent(null), id: 1, name: 'agent-busy', state: 'busy' })
    render(<AgentList />)
    const badge = await screen.findByText('busy')
    expect(badge.style.background).toBe('var(--color-status-busy-bg)')
    expect(badge.style.color).toBe('var(--color-status-busy-text)')
    vi.unstubAllGlobals()
  })

  it('renders the "starting" status badge using --color-status-neutral-{bg,text}', async () => {
    stubEventSourceAndFetch({ ...baseAgent(null), id: 1, name: 'agent-starting', state: 'starting' })
    render(<AgentList />)
    const badge = await screen.findByText('starting')
    expect(badge.style.background).toBe('var(--color-status-neutral-bg)')
    expect(badge.style.color).toBe('var(--color-status-neutral-text)')
    vi.unstubAllGlobals()
  })

  it('renders the idle-with-empty-queue status badge as "ready" using the same green --color-status-idle-{bg,text} tokens as the "idle" badge, with a tooltip explaining the empty queue', async () => {
    stubEventSourceAndFetch({ ...baseAgent(null), id: 1, name: 'agent-ready', state: 'idle', queuedTasks: 0 })
    render(<AgentList />)
    const badge = await screen.findByText('ready')
    expect(badge.style.background).toBe('var(--color-status-idle-bg)')
    expect(badge.style.color).toBe('var(--color-status-idle-text)')
    expect(badge.getAttribute('title')).toBe('Ready — no queued tasks')
    expect(screen.queryByText('no tasks')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('renders the "idle/waiting" status badge using --color-status-success-{bg,text}, and the codex type badge using --color-badge-type-codex-{bg,text}, for an idle codex agent with no queued tasks', async () => {
    stubEventSourceAndFetch({
      ...baseAgent(null),
      id: 1,
      name: 'agent-codex-idle',
      state: 'idle',
      queuedTasks: 0,
      agentType: 'codex',
    })
    render(<AgentList />)
    const statusBadge = await screen.findByText('idle/waiting')
    expect(statusBadge.style.background).toBe('var(--color-status-success-bg)')
    expect(statusBadge.style.color).toBe('var(--color-status-success-text)')

    const typeBadge = screen.getByText('codex')
    expect(typeBadge.style.background).toBe('var(--color-badge-type-codex-bg)')
    expect(typeBadge.style.color).toBe('var(--color-badge-type-codex-text)')
    vi.unstubAllGlobals()
  })

  it('renders the "stalled" status badge using --color-status-error-{bg,text}', async () => {
    stubEventSourceAndFetch({ ...baseAgent(null), id: 1, name: 'agent-stalled', state: 'stalled' })
    render(<AgentList />)
    const badge = await screen.findByText('stalled')
    expect(badge.style.background).toBe('var(--color-status-error-bg)')
    expect(badge.style.color).toBe('var(--color-status-error-text)')
    vi.unstubAllGlobals()
  })

  it('renders the "error" status badge using --color-status-error-{bg,text}', async () => {
    stubEventSourceAndFetch({ ...baseAgent(null), id: 1, name: 'agent-error', state: 'error' })
    render(<AgentList />)
    const badge = await screen.findByText('error')
    expect(badge.style.background).toBe('var(--color-status-error-bg)')
    expect(badge.style.color).toBe('var(--color-status-error-text)')
    vi.unstubAllGlobals()
  })

  // 'exited' (and 'no-window'/'unknown') are terminal statuses that isActiveStatus() excludes
  // from the sidebar until the "Show inactive" checkbox is checked (TASK-0181), so they are
  // not reachable through this describe's default render. Their row border is covered in the
  // "sidebar row status right border" describe below; STATUS_CONFIG.exited's badge tokenization
  // (bg tokenized, text/dot kept as the literal #e5484d per the TASK-150 Step 4 note) remains
  // unasserted here, flagged as a gap in UAT-150.
})

// ── agentMatchesFilter ────────────────────────────────────────────────────

describe('agentMatchesFilter', () => {
  // baseAgent doesn't carry role/branch/projectName, so layer overrides on top
  // of it rather than duplicating the full Agent fixture shape here.
  function agentWith(overrides: Partial<Agent>): Agent {
    return { ...baseAgent(null), ...overrides }
  }

  it('matches regardless of field contents when filterText is empty', () => {
    const agent = agentWith({ name: 'backend-1' })
    expect(agentMatchesFilter(agent, '')).toBe(true)
  })

  it('matches regardless of field contents when filterText is whitespace-only', () => {
    const agent = agentWith({ name: 'backend-1' })
    expect(agentMatchesFilter(agent, '   ')).toBe(true)
  })

  it('matches case-insensitively on a name substring', () => {
    const agent = agentWith({ name: 'backend-1' })
    expect(agentMatchesFilter(agent, 'BACK')).toBe(true)
  })

  it('matches on projectName', () => {
    const agent = agentWith({ name: 'agent-a', projectName: 'tmux-conductor' })
    expect(agentMatchesFilter(agent, 'conductor')).toBe(true)
  })

  it('matches on role', () => {
    const agent = agentWith({ name: 'agent-a', role: 'backend-engineer' })
    expect(agentMatchesFilter(agent, 'engineer')).toBe(true)
  })

  it('matches on branch', () => {
    const agent = agentWith({ name: 'agent-a', branch: 'feature/filter-ui' })
    expect(agentMatchesFilter(agent, 'filter-ui')).toBe(true)
  })

  it('returns false when the filter substring matches none of the matched fields', () => {
    const agent = agentWith({
      name: 'agent-a',
      projectName: 'tmux-conductor',
      role: 'backend-engineer',
      branch: 'main',
    })
    expect(agentMatchesFilter(agent, 'zzz-no-match')).toBe(false)
  })

  it('treats null projectName/role/branch as non-matching without throwing', () => {
    const agent = agentWith({ name: 'agent-a', projectName: null, role: null, branch: null })
    expect(() => agentMatchesFilter(agent, 'backend')).not.toThrow()
    expect(agentMatchesFilter(agent, 'backend')).toBe(false)
  })

  it('does not match against workdir (deliberately excluded from the matched fields)', () => {
    const agent = agentWith({ name: 'agent-a', workdir: '/Users/dev/projects/super-secret-workdir' })
    expect(agentMatchesFilter(agent, 'super-secret-workdir')).toBe(false)
  })
})

// ── AgentList filter (integration) ────────────────────────────────────────

describe('AgentList filter (integration)', () => {
  it('typing into the filter input narrows the rendered agent cards', async () => {
    class MockEventSource {
      addEventListener() { /* no-op */ }
      removeEventListener() { /* no-op */ }
      close() { /* no-op */ }
    }
    vi.stubGlobal('EventSource', MockEventSource)

    const agentAlpha: Agent = { ...baseAgent(null), id: 1, name: 'alpha-backend' }
    const agentBeta: Agent = { ...baseAgent(null), id: 2, name: 'beta-frontend' }

    const sessionStateFixture = {
      session: 'test-session',
      sessionAlive: true,
      sessionExists: true,
      agents: [agentAlpha, agentBeta],
      bgProcesses: [],
      timestamp: new Date().toISOString(),
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => sessionStateFixture }))

    render(<AgentList />)

    expect(await screen.findByText('alpha-backend')).toBeInTheDocument()
    expect(screen.getByText('beta-frontend')).toBeInTheDocument()

    const input = screen.getByLabelText('Filter agents')
    fireEvent.change(input, { target: { value: 'alpha' } })

    expect(screen.getByText('alpha-backend')).toBeInTheDocument()
    expect(screen.queryByText('beta-frontend')).toBeNull()

    vi.unstubAllGlobals()
  })
})


describe('AgentList board (no Kanban columns)', () => {
  it('renders busy, idle and awaiting agents in one list, omits exited agents, and has no column headings', async () => {
    class MockEventSource {
      addEventListener() { /* no-op */ }
      removeEventListener() { /* no-op */ }
      close() { /* no-op */ }
    }
    vi.stubGlobal('EventSource', MockEventSource)

    const agents: Agent[] = [
      { ...baseAgent(null), id: 1, name: 'agent-busy', state: 'busy' },
      { ...baseAgent(null), id: 2, name: 'agent-idle', state: 'idle', queuedTasks: 2 },
      { ...baseAgent(null), id: 3, name: 'agent-awaiting', state: 'awaiting' },
      { ...baseAgent(null), id: 4, name: 'agent-exited', state: 'exited' },
    ]
    const sessionStateFixture = {
      session: 'test-session',
      sessionAlive: true,
      sessionExists: true,
      agents,
      bgProcesses: [],
      timestamp: new Date().toISOString(),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => sessionStateFixture }))

    render(<AgentList />)

    expect(await screen.findByText('agent-busy')).toBeInTheDocument()
    expect(screen.getByText('agent-idle')).toBeInTheDocument()
    expect(screen.getByText('agent-awaiting')).toBeInTheDocument()
    expect(screen.queryByText('agent-exited')).toBeNull()

    expect(screen.queryByText('Waiting / Stalled')).toBeNull()
    expect(screen.queryByText('Busy')).toBeNull()
    expect(screen.queryByText('Ready / No tasks')).toBeNull()

    vi.unstubAllGlobals()
  })

  it('keeps an error-status agent on the board (overlap with the inactive panel preserved)', async () => {
    class MockEventSource {
      addEventListener() { /* no-op */ }
      removeEventListener() { /* no-op */ }
      close() { /* no-op */ }
    }
    vi.stubGlobal('EventSource', MockEventSource)

    const agents: Agent[] = [
      { ...baseAgent(null), id: 1, name: 'agent-busy', state: 'busy' },
      { ...baseAgent(null), id: 2, name: 'agent-error', state: 'error' },
    ]
    const sessionStateFixture = {
      session: 'test-session',
      sessionAlive: true,
      sessionExists: true,
      agents,
      bgProcesses: [],
      timestamp: new Date().toISOString(),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => sessionStateFixture }))

    render(<AgentList />)

    expect(await screen.findByText('agent-busy')).toBeInTheDocument()
    expect(screen.getByText('agent-error')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })
})

describe('AgentList sidebar (project grouping, TASK-0170)', () => {
  function stubSidebarFetch(agents: Agent[]) {
    class MockEventSource {
      addEventListener() { /* no-op */ }
      removeEventListener() { /* no-op */ }
      close() { /* no-op */ }
    }
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/queue/')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: 'x', tasks: [] }) })
      }
      if (url.includes('/skills')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: 'x', project: [], user: [] }) })
      }
      if (url.includes('/checkpoints')) {
        return Promise.resolve({ ok: true, json: () => ({ checkpoints: [] }) })
      }
      return Promise.resolve({
        ok: true,
        json: () => ({
          session: 'test-session', sessionAlive: true, sessionExists: true,
          agents, bgProcesses: [], timestamp: new Date().toISOString(),
        }),
      })
    }))
  }

  const groupedAgents = (): Agent[] => [
    { ...baseAgent(null), id: 1, name: 'zeta-loose', projectId: null, projectName: null },
    { ...baseAgent(null), id: 2, name: 'beta-api', projectId: 20, projectName: 'Beta' },
    { ...baseAgent(null), id: 3, name: 'alpha-ui', projectId: 10, projectName: 'Alpha' },
    { ...baseAgent(null), id: 4, name: 'alpha-worker', projectId: 10, projectName: 'Alpha' },
  ]

  it('renders agents under project headers in order, unassigned last, with per-group counts', async () => {
    stubSidebarFetch(groupedAgents())

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByText('alpha-ui')

    const text = sidebar.textContent || ''
    const alphaHeader = text.indexOf('Alpha')
    const betaHeader = text.indexOf('Beta')
    const unassignedHeader = text.indexOf('Unassigned')
    expect(alphaHeader).toBeGreaterThanOrEqual(0)
    expect(betaHeader).toBeGreaterThan(alphaHeader)
    expect(unassignedHeader).toBeGreaterThan(betaHeader)
    expect(text.indexOf('zeta-loose')).toBeGreaterThan(unassignedHeader)
    expect(text.indexOf('beta-api')).toBeGreaterThan(betaHeader)
    expect(text.indexOf('beta-api')).toBeLessThan(unassignedHeader)

    // Three header paragraphs (Alpha, Beta, Unassigned) — counts sit alongside the label.
    const headers = Array.from(sidebar.querySelectorAll('p')).map((p) => p.textContent)
    expect(headers).toEqual(['Alpha2', 'Beta1', 'Unassigned1'])

    vi.unstubAllGlobals()
  })

  it('keeps the filter input inside the sidebar', async () => {
    stubSidebarFetch(groupedAgents())

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByText('alpha-ui')

    expect(within(sidebar).getByLabelText('Filter agents')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('renders the detail view in the main pane (not an overlay dialog) when a sidebar row is clicked (TASK-0173)', async () => {
    stubSidebarFetch(groupedAgents())

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    expect(screen.queryByRole('region', { name: 'beta-api detail' })).toBeNull()

    fireEvent.click(await within(sidebar).findByText('beta-api'))

    const pane = await screen.findByRole('region', { name: 'beta-api detail' })
    expect(within(pane).getByRole('tab', { name: 'Terminal' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    // The pane sits beside the sidebar, never inside it.
    expect(sidebar.contains(pane)).toBe(false)

    vi.unstubAllGlobals()
  })

  it('shows the empty state plus BgProcessSection when nothing is selected, and hides BgProcessSection while an agent is selected (TASK-0173)', async () => {
    stubSidebarFetch(groupedAgents())

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByText('beta-api')

    expect(screen.getByText('Select an agent from the sidebar')).toBeInTheDocument()
    expect(screen.getByText('Background processes')).toBeInTheDocument()

    fireEvent.click(within(sidebar).getByText('beta-api'))
    await screen.findByRole('region', { name: 'beta-api detail' })

    expect(screen.queryByText('Select an agent from the sidebar')).toBeNull()
    expect(screen.queryByText('Background processes')).toBeNull()

    vi.unstubAllGlobals()
  })

  it("the view's close button deselects the agent and returns the pane to the empty state (TASK-0173)", async () => {
    stubSidebarFetch(groupedAgents())

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    fireEvent.click(await within(sidebar).findByText('beta-api'))
    const pane = await screen.findByRole('region', { name: 'beta-api detail' })

    fireEvent.click(within(pane).getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('region', { name: 'beta-api detail' })).toBeNull()
    expect(screen.getByText('Select an agent from the sidebar')).toBeInTheDocument()
    expect(screen.getByText('Background processes')).toBeInTheDocument()
    expect(within(sidebar).getByRole('button', { name: 'beta-api detail' })).not.toHaveAttribute('aria-current')

    vi.unstubAllGlobals()
  })

  it('marks only the selected sidebar row with aria-current (TASK-0173)', async () => {
    stubSidebarFetch(groupedAgents())

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    const betaRow = await within(sidebar).findByRole('button', { name: 'beta-api detail' })
    const alphaRow = within(sidebar).getByRole('button', { name: 'alpha-ui detail' })
    expect(betaRow).not.toHaveAttribute('aria-current')

    fireEvent.click(betaRow)
    await screen.findByRole('region', { name: 'beta-api detail' })
    expect(betaRow).toHaveAttribute('aria-current', 'true')
    expect(alphaRow).not.toHaveAttribute('aria-current')

    fireEvent.click(alphaRow)
    await screen.findByRole('region', { name: 'alpha-ui detail' })
    expect(alphaRow).toHaveAttribute('aria-current', 'true')
    expect(betaRow).not.toHaveAttribute('aria-current')

    vi.unstubAllGlobals()
  })

  it("switching rows remounts the view, dropping the previous agent's local state such as an open rename input (TASK-0173)", async () => {
    stubSidebarFetch(groupedAgents())

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    fireEvent.click(await within(sidebar).findByText('beta-api'))
    const betaPane = await screen.findByRole('region', { name: 'beta-api detail' })

    fireEvent.click(within(betaPane).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(betaPane).getByRole('menuitem', { name: 'Rename' }))
    expect(within(betaPane).getByDisplayValue('beta-api')).toBeInTheDocument()

    fireEvent.click(within(sidebar).getByText('alpha-ui'))
    const alphaPane = await screen.findByRole('region', { name: 'alpha-ui detail' })

    expect(screen.queryByDisplayValue('beta-api')).toBeNull()
    expect(within(alphaPane).getByRole('button', { name: 'Agent actions' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('shows the no-match copy inside the sidebar when the filter excludes every agent', async () => {
    stubSidebarFetch(groupedAgents())

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByText('alpha-ui')

    fireEvent.change(within(sidebar).getByLabelText('Filter agents'), { target: { value: 'zzz-no-such-agent' } })

    expect(within(sidebar).getByText('No agents match your filter.')).toBeInTheDocument()
    expect(within(sidebar).queryByText('alpha-ui')).toBeNull()
    expect(within(sidebar).queryByText('Alpha')).toBeNull()
    // The filter input stays in the sidebar so the empty result can be cleared.
    expect(within(sidebar).getByLabelText('Filter agents')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('restores the full grouped sidebar after clearing a no-match filter', async () => {
    stubSidebarFetch(groupedAgents())

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByText('alpha-ui')
    const headersBefore = Array.from(sidebar.querySelectorAll('p')).map((p) => p.textContent)
    const rowOrder = (): string[] =>
      ['alpha-ui', 'alpha-worker', 'beta-api', 'zeta-loose']
        .map((name) => ({ name, at: (sidebar.textContent || '').indexOf(name) }))
        .sort((a, b) => a.at - b.at)
        .map((r) => r.name)
    const rowsBefore = rowOrder()

    const input = within(sidebar).getByLabelText('Filter agents')
    fireEvent.change(input, { target: { value: 'zzz-no-such-agent' } })
    expect(within(sidebar).getByText('No agents match your filter.')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '' } })

    expect(within(sidebar).queryByText('No agents match your filter.')).toBeNull()
    expect(within(sidebar).getByText('alpha-ui')).toBeInTheDocument()
    expect(within(sidebar).getByText('alpha-worker')).toBeInTheDocument()
    expect(within(sidebar).getByText('beta-api')).toBeInTheDocument()
    expect(within(sidebar).getByText('zeta-loose')).toBeInTheDocument()
    expect(Array.from(sidebar.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['Alpha2', 'Beta1', 'Unassigned1'])
    expect(Array.from(sidebar.querySelectorAll('p')).map((p) => p.textContent)).toEqual(headersBefore)
    expect(rowOrder()).toEqual(rowsBefore)

    vi.unstubAllGlobals()
  })

  it('renders an unchecked "Show inactive" checkbox by default and keeps inactive agents out of the sidebar (TASK-0181)', async () => {
    stubSidebarFetch([
      ...groupedAgents(),
      { ...baseAgent(null), id: 8, name: 'sleepy-one', state: 'exited' },
      { ...baseAgent(null), id: 9, name: 'sleepy-two', windowPresent: false, state: 'no-window' },
    ])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByText('alpha-ui')

    const checkbox = within(sidebar).getByLabelText('Show inactive')
    expect(checkbox).toHaveAttribute('type', 'checkbox')
    expect(checkbox).not.toBeChecked()
    expect(within(sidebar).queryByText('sleepy-one')).toBeNull()
    expect(within(sidebar).queryByText('sleepy-two')).toBeNull()
    // The old collapsible accordion is gone, and group counts cover active agents only.
    expect(within(sidebar).queryByRole('button', { name: /Inactive Agents/ })).toBeNull()
    expect(Array.from(sidebar.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['Alpha2', 'Beta1', 'Unassigned1'])

    vi.unstubAllGlobals()
  })

  it('checking "Show inactive" lists inactive agents inline, inside their project group and alphabetically among that group\'s active rows; unchecking hides them again (TASK-0181, TASK-0183)', async () => {
    stubSidebarFetch([
      ...groupedAgents(),
      // Status no longer sorts: inactive rows interleave alphabetically with the active ones.
      // 'aaa-sleepy' sorts before both active Alpha rows, 'mmm-sleepy' before 'zeta-loose'.
      { ...baseAgent(null), id: 8, name: 'aaa-sleepy', projectId: 10, projectName: 'Alpha', state: 'exited' },
      { ...baseAgent(null), id: 9, name: 'mmm-sleepy', projectId: null, projectName: null, windowPresent: false, state: 'no-window' },
    ])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByText('alpha-ui')
    const checkbox = within(sidebar).getByLabelText('Show inactive')

    fireEvent.click(checkbox)

    expect(checkbox).toBeChecked()
    expect(await within(sidebar).findByText('aaa-sleepy')).toBeInTheDocument()
    expect(within(sidebar).getByText('mmm-sleepy')).toBeInTheDocument()
    expect(Array.from(sidebar.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['Alpha3', 'Beta1', 'Unassigned2'])
    const text = sidebar.textContent || ''
    const at = (name: string): number => text.indexOf(name)
    expect(at('aaa-sleepy')).toBeLessThan(at('alpha-ui'))
    expect(at('alpha-ui')).toBeLessThan(at('alpha-worker'))
    expect(at('alpha-worker')).toBeLessThan(at('beta-api'))
    expect(at('mmm-sleepy')).toBeLessThan(at('zeta-loose'))

    fireEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
    expect(within(sidebar).queryByText('aaa-sleepy')).toBeNull()
    expect(within(sidebar).queryByText('mmm-sleepy')).toBeNull()
    expect(Array.from(sidebar.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['Alpha2', 'Beta1', 'Unassigned1'])

    vi.unstubAllGlobals()
  })

  it('shows "No active agents." when every registered agent is inactive and the checkbox is off; checking it lists them and drops the message (TASK-0181)', async () => {
    stubSidebarFetch([
      { ...baseAgent(null), id: 1, name: 'sleepy-one', state: 'exited' },
      { ...baseAgent(null), id: 2, name: 'sleepy-two', windowPresent: false, state: 'no-window' },
    ])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })

    expect(await within(sidebar).findByText('No active agents.')).toBeInTheDocument()
    // Neither of the other two empty states fires for this case.
    expect(within(sidebar).queryByText('No agents registered.')).toBeNull()
    expect(within(sidebar).queryByText('No agents match your filter.')).toBeNull()
    expect(within(sidebar).getByLabelText('Filter agents')).toBeInTheDocument()
    expect(within(sidebar).queryByText('sleepy-one')).toBeNull()

    fireEvent.click(within(sidebar).getByLabelText('Show inactive'))

    expect(await within(sidebar).findByText('sleepy-one')).toBeInTheDocument()
    expect(within(sidebar).getByText('sleepy-two')).toBeInTheDocument()
    expect(within(sidebar).queryByText('No active agents.')).toBeNull()

    vi.unstubAllGlobals()
  })

  it('shows "No agents match your filter." for a non-matching filter with "Show inactive" on, and restores the rows when the filter clears (TASK-0181)', async () => {
    stubSidebarFetch([
      ...groupedAgents(),
      { ...baseAgent(null), id: 8, name: 'sleepy-one', state: 'exited' },
    ])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByText('alpha-ui')
    fireEvent.click(within(sidebar).getByLabelText('Show inactive'))
    expect(await within(sidebar).findByText('sleepy-one')).toBeInTheDocument()

    const filter = within(sidebar).getByLabelText('Filter agents')
    fireEvent.change(filter, { target: { value: 'zzz-no-such-agent' } })
    expect(within(sidebar).getByText('No agents match your filter.')).toBeInTheDocument()
    expect(within(sidebar).queryByText('No active agents.')).toBeNull()
    expect(within(sidebar).queryByText('sleepy-one')).toBeNull()
    // The checkbox stays put so the state survives an empty result.
    expect(within(sidebar).getByLabelText('Show inactive')).toBeChecked()

    fireEvent.change(filter, { target: { value: 'sleepy' } })
    expect(within(sidebar).getByText('sleepy-one')).toBeInTheDocument()
    expect(within(sidebar).queryByText('alpha-ui')).toBeNull()

    vi.unstubAllGlobals()
  })

  it('lists an error-status agent once in its project group without the checkbox, painted with the error right border, and unchanged when the checkbox is checked (TASK-0181)', async () => {
    stubSidebarFetch([
      ...groupedAgents(),
      { ...baseAgent(null), id: 9, name: 'errored-one', projectId: 20, projectName: 'Beta', state: 'error' },
    ])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    const row = await within(sidebar).findByRole('button', { name: 'errored-one detail' })

    expect(Array.from(sidebar.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['Alpha2', 'Beta2', 'Unassigned1'])
    expect(row.style.borderRightColor).toBe(normalizedColor('#e5484d'))
    expect(within(row).getByText('error')).toBeInTheDocument()

    fireEvent.click(within(sidebar).getByLabelText('Show inactive'))
    // Still a single row: no duplicate now that inactive agents share the one list.
    expect(within(sidebar).getAllByText('errored-one')).toHaveLength(1)
    expect(within(sidebar).getByRole('button', { name: 'errored-one detail' }).style.borderRightColor).toBe(normalizedColor('#e5484d'))

    vi.unstubAllGlobals()
  })

  it('AgentsPage renders the "Show inactive" checkbox only inside the sidebar and no Inactive Agents panel anywhere (TASK-0181)', async () => {
    stubSidebarFetch([...groupedAgents(), { ...baseAgent(null), id: 9, name: 'sleepy-one', state: 'exited' }])

    render(<AgentsPage />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByText('alpha-ui')

    const checkboxes = screen.getAllByLabelText('Show inactive')
    expect(checkboxes).toHaveLength(1)
    expect(sidebar.contains(checkboxes[0] as HTMLElement)).toBe(true)
    expect(document.body.textContent).not.toContain('Inactive Agents')
    expect(screen.queryByRole('button', { name: /Inactive Agents/ })).toBeNull()

    vi.unstubAllGlobals()
  })

  it('orders rows within a project group alphabetically and case-insensitively, regardless of status (TASK-0183)', async () => {
    // Status no longer sorts: a-idle / b-busy / c-await stay A-Z even though awaiting and busy
    // agents used to jump above idle ones.
    stubSidebarFetch([
      { ...baseAgent(null), id: 1, name: 'a-idle', projectId: 10, projectName: 'Alpha', state: 'idle' },
      { ...baseAgent(null), id: 2, name: 'b-busy', projectId: 10, projectName: 'Alpha', state: 'busy' },
      { ...baseAgent(null), id: 3, name: 'c-await', projectId: 10, projectName: 'Alpha', state: 'awaiting' },
      // Case-insensitive name order puts 'apple' before 'Banana'
      // (a case-sensitive sort would put 'Banana' first).
      { ...baseAgent(null), id: 4, name: 'Banana', projectId: 20, projectName: 'Beta', state: 'busy' },
      { ...baseAgent(null), id: 5, name: 'apple', projectId: 20, projectName: 'Beta', state: 'busy' },
    ])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByText('c-await')

    const precedes = (first: string, second: string): boolean =>
      (within(sidebar).getByText(first).compareDocumentPosition(within(sidebar).getByText(second)) &
        Node.DOCUMENT_POSITION_FOLLOWING) !== 0

    expect(precedes('a-idle', 'b-busy')).toBe(true)
    expect(precedes('b-busy', 'c-await')).toBe(true)
    expect(precedes('apple', 'Banana')).toBe(true)

    vi.unstubAllGlobals()
  })

  it('does not render an exited agent as a sidebar row', async () => {
    stubSidebarFetch([
      { ...baseAgent(null), id: 1, name: 'alpha-live', projectId: 10, projectName: 'Alpha', state: 'busy' },
      { ...baseAgent(null), id: 2, name: 'alpha-gone', projectId: 10, projectName: 'Alpha', state: 'exited' },
    ])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByText('alpha-live')

    expect(within(sidebar).queryByText('alpha-gone')).toBeNull()

    vi.unstubAllGlobals()
  })

  // ── TASK-0183: alphabetical default + drag-to-reorder persisted in localStorage ──

  async function renderSidebar(agents: Agent[]): Promise<HTMLElement> {
    stubSidebarFetch(agents)
    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findAllByRole('button', { name: / detail$/ })
    return sidebar
  }

  const rowOrder = (sidebar: HTMLElement): string[] =>
    within(sidebar)
      .getAllByRole('button', { name: / detail$/ })
      .map((row) => (row.getAttribute('aria-label') ?? '').replace(/ detail$/, ''))

  const storedOrder = (): unknown => JSON.parse(localStorage.getItem(AGENT_ORDER_STORAGE_KEY) ?? 'null') as unknown

  it('TASK-0183: renders agents A-Z within a project regardless of status (a busy zeta after an idle alpha)', async () => {
    const sidebar = await renderSidebar([
      { ...baseAgent(null), id: 1, name: 'zeta', projectId: 10, projectName: 'Alpha', state: 'busy' },
      { ...baseAgent(null), id: 2, name: 'alpha', projectId: 10, projectName: 'Alpha', state: 'idle' },
    ])

    expect(rowOrder(sidebar)).toEqual(['alpha', 'zeta'])

    vi.unstubAllGlobals()
  })

  it('TASK-0183: honours a saved order in localStorage that is present before mount on first render', async () => {
    localStorage.setItem(AGENT_ORDER_STORAGE_KEY, JSON.stringify([4, 3]))
    const sidebar = await renderSidebar(groupedAgents())

    // Alpha is reversed by the saved order; Beta and Unassigned are untouched and groups stay A-Z.
    expect(rowOrder(sidebar)).toEqual(['alpha-worker', 'alpha-ui', 'beta-api', 'zeta-loose'])

    vi.unstubAllGlobals()
  })

  it('TASK-0183: renders a newly-appearing agent (id not in the saved order) after the saved-order members of its group', async () => {
    localStorage.setItem(AGENT_ORDER_STORAGE_KEY, JSON.stringify([4, 3]))
    const sidebar = await renderSidebar([
      ...groupedAgents(),
      // Alphabetically first in Alpha, but never dragged and absent from the saved order.
      { ...baseAgent(null), id: 8, name: 'alpha-aaa', projectId: 10, projectName: 'Alpha' },
    ])

    expect(rowOrder(sidebar)).toEqual(['alpha-worker', 'alpha-ui', 'alpha-aaa', 'beta-api', 'zeta-loose'])

    vi.unstubAllGlobals()
  })

  it('TASK-0183: a drag end reorders the group in the DOM and persists the new order to localStorage', async () => {
    const sidebar = await renderSidebar(groupedAgents())
    expect(rowOrder(sidebar)).toEqual(['alpha-ui', 'alpha-worker', 'beta-api', 'zeta-loose'])
    expect(storedOrder()).toBeNull()

    dragRow(4, 3)

    expect(rowOrder(sidebar)).toEqual(['alpha-worker', 'alpha-ui', 'beta-api', 'zeta-loose'])
    expect(storedOrder()).toEqual([4, 3])

    vi.unstubAllGlobals()
  })

  it('TASK-0183: a drop with no target (over: null) changes nothing and writes nothing', async () => {
    const sidebar = await renderSidebar(groupedAgents())

    dragRow(4, null)

    expect(rowOrder(sidebar)).toEqual(['alpha-ui', 'alpha-worker', 'beta-api', 'zeta-loose'])
    expect(localStorage.getItem(AGENT_ORDER_STORAGE_KEY)).toBeNull()
    expect(within(sidebar).queryByRole('button', { name: 'Reset to A–Z' })).toBeNull()

    vi.unstubAllGlobals()
  })

  it("TASK-0183: a drag in one project does not change another project's order", async () => {
    const sidebar = await renderSidebar([
      ...groupedAgents(),
      { ...baseAgent(null), id: 5, name: 'beta-zzz', projectId: 20, projectName: 'Beta' },
    ])
    expect(rowOrder(sidebar)).toEqual(['alpha-ui', 'alpha-worker', 'beta-api', 'beta-zzz', 'zeta-loose'])

    dragRow(4, 3)

    expect(rowOrder(sidebar)).toEqual(['alpha-worker', 'alpha-ui', 'beta-api', 'beta-zzz', 'zeta-loose'])
    // Only the dragged group's ids are stored, so Beta is still pure A-Z.
    expect(storedOrder()).toEqual([4, 3])

    dragRow(5, 2)

    expect(rowOrder(sidebar)).toEqual(['alpha-worker', 'alpha-ui', 'beta-zzz', 'beta-api', 'zeta-loose'])
    expect(storedOrder()).toEqual([4, 3, 5, 2])

    vi.unstubAllGlobals()
  })

  it("TASK-0183: reordering while the filter hides a group member preserves that member's relative position", async () => {
    // Unassigned group, A-Z: cat-a(11), dog-x(12), eel-a(13), fox-a(14). The filter '-a' hides dog-x.
    const sidebar = await renderSidebar([
      { ...baseAgent(null), id: 11, name: 'cat-a' },
      { ...baseAgent(null), id: 12, name: 'dog-x' },
      { ...baseAgent(null), id: 13, name: 'eel-a' },
      { ...baseAgent(null), id: 14, name: 'fox-a' },
    ])
    fireEvent.change(within(sidebar).getByLabelText('Filter agents'), { target: { value: '-a' } })
    expect(rowOrder(sidebar)).toEqual(['cat-a', 'eel-a', 'fox-a'])

    dragRow(14, 11)
    expect(rowOrder(sidebar)).toEqual(['fox-a', 'cat-a', 'eel-a'])

    // Clearing the filter: dog-x is still between cat-a and eel-a, exactly where it was.
    fireEvent.change(within(sidebar).getByLabelText('Filter agents'), { target: { value: '' } })
    expect(rowOrder(sidebar)).toEqual(['fox-a', 'cat-a', 'dog-x', 'eel-a'])
    expect(storedOrder()).toEqual([14, 11, 12, 13])

    vi.unstubAllGlobals()
  })

  it('TASK-0183: "Reset to A–Z" is absent without a saved order, appears after a reorder, and clicking it restores A-Z and clears storage', async () => {
    const sidebar = await renderSidebar(groupedAgents())
    expect(within(sidebar).queryByRole('button', { name: 'Reset to A–Z' })).toBeNull()

    dragRow(4, 3)
    expect(rowOrder(sidebar)).toEqual(['alpha-worker', 'alpha-ui', 'beta-api', 'zeta-loose'])

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Reset to A–Z' }))

    expect(rowOrder(sidebar)).toEqual(['alpha-ui', 'alpha-worker', 'beta-api', 'zeta-loose'])
    expect(localStorage.getItem(AGENT_ORDER_STORAGE_KEY)).toBeNull()
    expect(within(sidebar).queryByRole('button', { name: 'Reset to A–Z' })).toBeNull()

    vi.unstubAllGlobals()
  })

  it('TASK-0183: a plain click on a sortable row still selects the agent and opens the detail pane', async () => {
    const sidebar = await renderSidebar(groupedAgents())
    const row = within(sidebar).getByRole('button', { name: 'beta-api detail' })

    fireEvent.click(row)

    expect(await screen.findByRole('region', { name: 'beta-api detail' })).toBeInTheDocument()
    expect(row).toHaveAttribute('aria-current', 'true')

    vi.unstubAllGlobals()
  })

  it('TASK-0183: renders A-Z without throwing when localStorage.getItem throws', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage denied') })
    try {
      const sidebar = await renderSidebar(groupedAgents())
      expect(rowOrder(sidebar)).toEqual(['alpha-ui', 'alpha-worker', 'beta-api', 'zeta-loose'])
    } finally {
      getItem.mockRestore()
    }

    vi.unstubAllGlobals()
  })
})

describe('AgentList empty states (agent filter)', () => {
  function stubEventSourceAndFetch(sessionStateFixture: {
    session: string
    sessionAlive: boolean
    sessionExists: boolean
    agents: Agent[]
    bgProcesses: BgProcess[]
    timestamp: string
  }) {
    class MockEventSource {
      addEventListener() { /* no-op */ }
      removeEventListener() { /* no-op */ }
      close() { /* no-op */ }
    }
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => sessionStateFixture }))
  }

  it('shows "No agents registered." (and no filter input) when there are zero agents', async () => {
    stubEventSourceAndFetch({
      session: 'test-session',
      sessionAlive: true,
      sessionExists: true,
      agents: [],
      bgProcesses: [],
      timestamp: new Date().toISOString(),
    })

    render(<AgentList />)

    expect(await screen.findByText('No agents registered.')).toBeInTheDocument()
    // The filter input only renders when agents.length > 0 — no point filtering an
    // already-empty list.
    expect(screen.queryByLabelText('Filter agents')).toBeNull()

    vi.unstubAllGlobals()
  })

  it('shows "No agents match your filter." — distinct from the zero-agents state — when the filter excludes every agent', async () => {
    const agentAlpha: Agent = { ...baseAgent(null), id: 1, name: 'alpha-backend' }
    stubEventSourceAndFetch({
      session: 'test-session',
      sessionAlive: true,
      sessionExists: true,
      agents: [agentAlpha],
      bgProcesses: [],
      timestamp: new Date().toISOString(),
    })

    render(<AgentList />)
    expect(await screen.findByText('alpha-backend')).toBeInTheDocument()

    const input = screen.getByLabelText('Filter agents')
    fireEvent.change(input, { target: { value: 'zzz-no-such-agent' } })

    expect(await screen.findByText('No agents match your filter.')).toBeInTheDocument()
    expect(screen.queryByText('alpha-backend')).toBeNull()
    // The two empty-state messages must never both/either-way be shown for the wrong reason.
    expect(screen.queryByText('No agents registered.')).toBeNull()

    vi.unstubAllGlobals()
  })

  it('leaves background-process cards visible and unaffected when the agent filter matches nothing', async () => {
    const agentAlpha: Agent = { ...baseAgent(null), id: 1, name: 'alpha-backend' }
    const bgProc: BgProcess = {
      slug: 'bg-project-my-bg-process',
      name: 'my-bg-process',
      workdir: '/tmp/bg',
      launchCmd: 'npm run watch',
      windowPresent: true,
      state: null,
      logPath: '/tmp/bg.log',
      statePath: '/tmp/bg.state',
      projectId: 1,
      projectName: 'bg-project',
    }
    stubEventSourceAndFetch({
      session: 'test-session',
      sessionAlive: true,
      sessionExists: true,
      agents: [agentAlpha],
      bgProcesses: [bgProc],
      timestamp: new Date().toISOString(),
    })

    render(<AgentList />)
    expect(await screen.findByText('alpha-backend')).toBeInTheDocument()
    expect(screen.getByText('my-bg-process')).toBeInTheDocument()
    // TASK-0197: the bg<->agent link is retired, so a bg tile never renders "linked to <agent>".
    expect(screen.queryByText(/linked to/)).toBeNull()

    const input = screen.getByLabelText('Filter agents')
    fireEvent.change(input, { target: { value: 'zzz-no-such-agent' } })

    expect(await screen.findByText('No agents match your filter.')).toBeInTheDocument()
    expect(screen.queryByText('alpha-backend')).toBeNull()
    // Background-process cards are a separate section (BgProcessSection, driven by its own
    // `bgs` state) — the agent filter must never reach into it.
    expect(screen.getByText('my-bg-process')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('groups background processes under per-project sub-headers, ordered like the agent grouping, with no Unassigned group (TASK-161, TASK-0195)', async () => {
    const agentAlpha: Agent = { ...baseAgent(null), id: 1, name: 'solo-agent' }
    const bgZ1: BgProcess = {
      slug: 'zeta-project-zeta-watcher',
      name: 'zeta-watcher',
      workdir: '/tmp/zeta',
      launchCmd: 'npm run watch',
      windowPresent: true,
      state: null,
      logPath: '/tmp/zeta.log',
      statePath: '/tmp/zeta.state',
      projectId: 10,
      projectName: 'zeta-project',
    }
    const bgZ2: BgProcess = { ...bgZ1, slug: 'zeta-project-zeta-builder', name: 'zeta-builder' }
    const bgA1: BgProcess = {
      slug: 'alpha-project-alpha-runner',
      name: 'alpha-runner',
      workdir: '/tmp/alpha',
      launchCmd: 'npm run dev',
      windowPresent: true,
      state: null,
      logPath: '/tmp/alpha.log',
      statePath: '/tmp/alpha.state',
      projectId: 20,
      projectName: 'alpha-project',
    }

    stubEventSourceAndFetch({
      session: 'test-session',
      sessionAlive: true,
      sessionExists: true,
      agents: [agentAlpha],
      bgProcesses: [bgZ1, bgZ2, bgA1],
      timestamp: new Date().toISOString(),
    })

    render(<AgentList />)
    expect(await screen.findByText('solo-agent')).toBeInTheDocument()

    // Sub-headers: project name (case-insensitive alpha order) — the same
    // ordering convention BgProcessSection borrows from the agent list's
    // byProject/groupByProject grouping. Every bg process belongs to a project
    // (TASK-0195), so there is no "Unassigned" group.
    const heading = screen.getByText('Background processes')
    const section = heading.parentElement as HTMLElement
    const headerEls = Array.from(section.querySelectorAll('p'))
    const headerTexts = headerEls.map((el) => el.textContent)
    expect(headerTexts).toEqual(['alpha-project', 'zeta-project'])
    // (Scoped to the bg section: the project-less agent row legitimately
    // still renders its own "Unassigned" badge.)
    expect(section.textContent).not.toContain('Unassigned')

    // Each header's row group is its next sibling; row names live in the
    // name span (`.text-ink`), which is unique to that span among a row's
    // font-mono spans (the launch-cmd span uses `.text-muted-2` instead).
    const rowNamesFor = (headerEl: Element) => {
      const rowContainer = headerEl.nextElementSibling as HTMLElement
      return Array.from(rowContainer.querySelectorAll('span.text-ink')).map((s) => s.textContent)
    }
    const headerAt = (i: number): Element => {
      const el = headerEls[i]
      if (!el) throw new Error(`expected a sub-header at index ${String(i)}`)
      return el
    }
    expect(rowNamesFor(headerAt(0))).toEqual(['alpha-runner'])
    expect(rowNamesFor(headerAt(1))).toEqual(['zeta-builder', 'zeta-watcher'])

    vi.unstubAllGlobals()
  })
})

// TASK-161-uat-fix: the inline Edit affordance added to each BgProcessSection
// row — editing workdir/launchCmd/project and saving calls the new
// PATCH /bg-processes/:slug route, then applies the response to local state
// directly (see AgentList.tsx's handleBgUpdated comment: the poll loop's
// bg-update SSE broadcast only fires on windowPresent/state/liveness
// changes, never on a workdir/launchCmd/projectId edit).
describe('BgProcessRow inline edit (TASK-161-uat-fix)', () => {
  function stubBgEditFetch(opts: {
    agent: Agent
    bg: BgProcess
    projects: { id: number; name: string; workdir: string; defaultLaunchCmd: string; createdAt: string }[]
    onPatch: (name: string, body: { workdir?: string; launchCmd?: string; projectId?: number | null }) => { ok: boolean; json: () => unknown }
  }) {
    class MockEventSource {
      addEventListener() { /* no-op */ }
      removeEventListener() { /* no-op */ }
      close() { /* no-op */ }
    }
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/bg-processes/') && init?.method === 'PATCH') {
        const name = decodeURIComponent(url.split('/bg-processes/')[1] ?? '')
        const body = init.body ? JSON.parse(init.body as string) as { workdir?: string; launchCmd?: string; projectId?: number | null } : {}
        return Promise.resolve(opts.onPatch(name, body))
      }
      if (url.includes('/projects')) {
        return Promise.resolve({ ok: true, json: () => opts.projects })
      }
      return Promise.resolve({
        ok: true,
        json: () => ({
          session: 'test-session', sessionAlive: true, sessionExists: true,
          agents: [opts.agent], bgProcesses: [opts.bg], timestamp: new Date().toISOString(),
        }),
      })
    }))
  }

  it('editing workdir/launchCmd/project and saving PATCHes /bg-processes/:slug and renders the new values', async () => {
    const agent: Agent = { ...baseAgent(null), id: 1, name: 'solo-agent' }
    const bg: BgProcess = {
      slug: 'project-one-editable-bg',
      name: 'editable-bg',
      workdir: '/tmp/before',
      launchCmd: 'npm run before',
      windowPresent: true,
      state: null,
      logPath: '/tmp/before.log',
      statePath: '/tmp/before.state',
      projectId: 1,
      projectName: 'project-one',
    }
    const projects = [
      { id: 1, name: 'project-one', workdir: '/tmp/p1', defaultLaunchCmd: 'claude', createdAt: new Date().toISOString() },
      { id: 2, name: 'project-two', workdir: '/tmp/p2', defaultLaunchCmd: 'claude', createdAt: new Date().toISOString() },
    ]

    stubBgEditFetch({
      agent,
      bg,
      projects,
      onPatch: (name, body) => {
        expect(name).toBe('project-one-editable-bg')
        expect(body).toEqual({ workdir: '/tmp/after', launchCmd: 'npm run after', projectId: 2 })
        return {
          ok: true,
          json: () => ({ id: 1, name: 'editable-bg', workdir: '/tmp/after', launchCmd: 'npm run after', projectId: 2 }),
        }
      },
    })

    render(<AgentList />)
    expect(await screen.findByText('editable-bg')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const workdirInput = await screen.findByDisplayValue('/tmp/before')
    fireEvent.change(workdirInput, { target: { value: '/tmp/after' } })
    const launchCmdInput = screen.getByDisplayValue('npm run before')
    fireEvent.change(launchCmdInput, { target: { value: 'npm run after' } })
    // The project <select> is the only combobox rendered by the edit form.
    const projectSelect = screen.getByRole('combobox')
    // Every bg process requires a project (TASK-0195): no "— Unassigned —" choice.
    expect(screen.queryByRole('option', { name: /unassigned/i })).toBeNull()
    fireEvent.change(projectSelect, { target: { value: '2' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // The row reflects the PATCH response once applied to local state — no
    // page reload / re-fetch required.
    expect(await screen.findByTitle('npm run after (in /tmp/after)')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('/tmp/after')).toBeNull()

    vi.unstubAllGlobals()
  })

  it('Cancel discards edits without calling PATCH', async () => {
    const agent: Agent = { ...baseAgent(null), id: 1, name: 'solo-agent' }
    const bg: BgProcess = {
      slug: 'project-one-cancel-bg',
      name: 'cancel-bg',
      workdir: '/tmp/orig',
      launchCmd: 'npm run orig',
      windowPresent: true,
      state: null,
      logPath: '/tmp/orig.log',
      statePath: '/tmp/orig.state',
      projectId: 1,
      projectName: 'project-one',
    }
    const patchSpy = vi.fn()
    stubBgEditFetch({
      agent,
      bg,
      projects: [],
      onPatch: (name, body) => { patchSpy(name, body); return { ok: true, json: () => ({}) } },
    })

    render(<AgentList />)
    expect(await screen.findByText('cancel-bg')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const workdirInput = await screen.findByDisplayValue('/tmp/orig')
    fireEvent.change(workdirInput, { target: { value: '/tmp/never-saved' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByDisplayValue('/tmp/never-saved')).toBeNull()
    expect(await screen.findByTitle('npm run orig (in /tmp/orig)')).toBeInTheDocument()
    expect(patchSpy).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})

describe('AgentList keyboard navigation ignores the grid filter', () => {
  it('next-agent navigation still reaches an agent hidden by the current filter (orderedAgentIds stays unfiltered)', async () => {
    class MockEventSource {
      addEventListener() { /* no-op */ }
      removeEventListener() { /* no-op */ }
      close() { /* no-op */ }
    }
    vi.stubGlobal('EventSource', MockEventSource)
    // AgentDetailModal's keyboard-navigation shortcut is OS-aware (Shift+Cmd on Mac,
    // Shift+Ctrl elsewhere) — pin navigator.userAgent to a Mac string so the metaKey-based
    // assertions below exercise the Mac branch regardless of the test runner's real platform
    // or jsdom's own (non-OS-specific) default userAgent.
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')

    const agentAlpha: Agent = { ...baseAgent(null), id: 1, name: 'node-alpha', role: 'backend' }
    const agentBeta: Agent = { ...baseAgent(null), id: 2, name: 'node-beta', role: 'frontend' }
    const agentGamma: Agent = { ...baseAgent(null), id: 3, name: 'node-gamma', role: 'backend' }

    const sessionStateFixture = {
      session: 'test-session',
      sessionAlive: true,
      sessionExists: true,
      agents: [agentAlpha, agentBeta, agentGamma],
      bgProcesses: [],
      timestamp: new Date().toISOString(),
    }

    // URL-aware: the open detail modal fires its own /queue/ and /skills fetches on mount,
    // which need their own (empty, but shape-valid) responses rather than the /status shape.
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/queue/')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: 'x', tasks: [] }) })
      }
      if (url.includes('/skills')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: 'x', project: [], user: [] }) })
      }
      return Promise.resolve({ ok: true, json: () => sessionStateFixture })
    }))

    render(<AgentList />)

    expect(await screen.findByText('node-alpha')).toBeInTheDocument()
    expect(screen.getByText('node-beta')).toBeInTheDocument()
    expect(screen.getByText('node-gamma')).toBeInTheDocument()

    // Open the detail modal for the middle agent (sorted name order: alpha, beta, gamma).
    fireEvent.click(screen.getByRole('button', { name: 'node-beta detail' }))
    expect(await screen.findByRole('region', { name: 'node-beta detail' })).toBeInTheDocument()

    // Filter the grid down to a set that excludes the agent whose modal is currently open.
    const input = screen.getByLabelText('Filter agents')
    fireEvent.change(input, { target: { value: 'backend' } })
    expect(await screen.findByText('node-alpha')).toBeInTheDocument()
    expect(screen.getByText('node-gamma')).toBeInTheDocument()
    // The card is gone from the grid (queried by its own accessible role, not by its name
    // text — that text is still legitimately present inside the still-open modal below).
    expect(screen.queryByRole('button', { name: 'node-beta detail' })).toBeNull()
    // Filtering the grid must never silently close an in-progress detail view.
    expect(screen.getByRole('region', { name: 'node-beta detail' })).toBeInTheDocument()

    // Navigate "next" from beta. If orderedAgentIds were wrongly derived from the filtered
    // list, beta's id would no longer appear in it at all — handleNavigate's own
    // `orderedAgentIds.indexOf(prev.id) === -1` guard would then leave the modal stuck on
    // beta instead of advancing. Reaching gamma here is the proof it uses the unfiltered list.
    // Regression guard (TASK-141): a bare Cmd-only ArrowRight (no Shift) must NOT trigger
    // agent-switch navigation — it must reach the terminal as cursor navigation instead.
    // The previous Ctrl+Alt combo must also no longer trigger navigation. Assert these
    // no-ops first so a reintroduced conflict fails loudly here instead of only showing
    // up as the real navigation assertion below happening to still pass.
    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true })
    expect(screen.getByRole('region', { name: 'node-beta detail' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true, altKey: true })
    expect(screen.getByRole('region', { name: 'node-beta detail' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
    expect(await screen.findByRole('region', { name: 'node-gamma detail' })).toBeInTheDocument()

    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('clicking the Ctrl+Alt prev/next hint buttons calls onNavigate with the correct direction', async () => {
    class MockEventSource {
      addEventListener() { /* no-op */ }
      removeEventListener() { /* no-op */ }
      close() { /* no-op */ }
    }
    vi.stubGlobal('EventSource', MockEventSource)
    // Pin navigator.userAgent to a Mac string so the "Previous/Next agent" hint buttons render
    // their Mac-branch content (the buttons' onClick wiring is OS-independent, but this keeps
    // the test deterministic regardless of the runner's real platform).
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')

    const agentAlpha: Agent = { ...baseAgent(null), id: 1, name: 'node-alpha', role: 'backend' }
    const agentBeta: Agent = { ...baseAgent(null), id: 2, name: 'node-beta', role: 'frontend' }
    const agentGamma: Agent = { ...baseAgent(null), id: 3, name: 'node-gamma', role: 'backend' }

    const sessionStateFixture = {
      session: 'test-session',
      sessionAlive: true,
      sessionExists: true,
      agents: [agentAlpha, agentBeta, agentGamma],
      bgProcesses: [],
      timestamp: new Date().toISOString(),
    }

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/queue/')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: 'x', tasks: [] }) })
      }
      if (url.includes('/skills')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: 'x', project: [], user: [] }) })
      }
      return Promise.resolve({ ok: true, json: () => sessionStateFixture })
    }))

    render(<AgentList />)

    expect(await screen.findByText('node-alpha')).toBeInTheDocument()

    // Open the detail modal for the middle agent (sorted name order: alpha, beta, gamma).
    fireEvent.click(screen.getByRole('button', { name: 'node-beta detail' }))
    expect(await screen.findByRole('region', { name: 'node-beta detail' })).toBeInTheDocument()

    // Clicking the "next" hint button should behave exactly like the Ctrl+Alt+ArrowRight
    // keyboard shortcut it documents, calling onNavigate('next').
    fireEvent.click(screen.getByRole('button', { name: 'Next agent' }))
    expect(await screen.findByRole('region', { name: 'node-gamma detail' })).toBeInTheDocument()

    // Clicking the "prev" hint button should call onNavigate('prev'), navigating back.
    fireEvent.click(screen.getByRole('button', { name: 'Previous agent' }))
    expect(await screen.findByRole('region', { name: 'node-beta detail' })).toBeInTheDocument()

    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
})

// ── Cycling in sidebar visual order + selection-driven arming (TASK-0174) ──
//
// Cycling follows the sidebar's flat order (project, then alphabetical within the project unless
// the user dragged a custom order — TASK-0183), not a global name sort, and stays independent of
// the sidebar's text filter. The row-CTA
// path selects the agent with Direct Input armed (LogTail interactSignal 1); a plain row click
// leaves it 0.
describe('AgentList cycling order and arm-interact against the pane selection (TASK-0174)', () => {
  const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
  const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'

  // Sidebar order: Project A -> alpha, charlie (busy), delta; Project B -> bravo.
  // A global name sort would instead be alpha, bravo, charlie, delta — so every hop below
  // distinguishes the two orders.
  const fixture: Agent[] = [
    { ...baseAgent(null), id: 1, name: 'alpha', projectId: 10, projectName: 'Project A', state: 'idle', queuedTasks: 1 },
    { ...baseAgent(null), id: 2, name: 'bravo', projectId: 20, projectName: 'Project B', state: 'idle', queuedTasks: 1 },
    { ...baseAgent(null), id: 3, name: 'charlie', projectId: 10, projectName: 'Project A', state: 'busy', queuedTasks: 1 },
    { ...baseAgent(null), id: 4, name: 'delta', projectId: 10, projectName: 'Project A', state: 'idle', queuedTasks: 1 },
  ]

  beforeEach(() => {
    capturedEventSource = null
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function stubFetchWithAgents(agents: Agent[]) {
    stubAgentDetailFetch(agents[0] ?? baseAgent(null), (url) => {
      if (url.endsWith('/status')) {
        return {
          ok: true,
          json: () => ({
            session: 'test-session', sessionAlive: true, sessionExists: true,
            agents, bgProcesses: [], timestamp: new Date().toISOString(),
          }),
        }
      }
      return null
    })
  }

  async function openAgent(name: string) {
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    fireEvent.click(await within(sidebar).findByRole('button', { name: `${name} detail` }))
    await screen.findByRole('region', { name: `${name} detail` })
  }

  it('Shift+Cmd+Right walks the sidebar order (alphabetical within a project, then the next project) and wraps at the end; Left wraps backwards', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
    stubFetchWithAgents(fixture)

    render(<AgentList />)
    await openAgent('alpha')

    for (const next of ['charlie', 'delta', 'bravo', 'alpha']) {
      fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
      expect(await screen.findByRole('region', { name: `${next} detail` })).toBeInTheDocument()
    }

    // Left from the first sidebar row wraps to the last one (bravo, Project B).
    fireEvent.keyDown(document, { key: 'ArrowLeft', metaKey: true, shiftKey: true })
    expect(await screen.findByRole('region', { name: 'bravo detail' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'ArrowLeft', metaKey: true, shiftKey: true })
    expect(await screen.findByRole('region', { name: 'delta detail' })).toBeInTheDocument()
  })

  it('TASK-0183: Shift+Cmd+Arrow follows a dragged custom order, not alphabetical', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
    stubFetchWithAgents(fixture)

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: 'delta detail' })
    // Project A alphabetical is alpha, charlie, delta; drag delta to the top -> delta, alpha, charlie.
    dragRow(4, 1)
    await openAgent('delta')

    // Custom order: delta, alpha, charlie, bravo (alphabetical would hop delta -> bravo).
    for (const next of ['alpha', 'charlie', 'bravo', 'delta']) {
      fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
      expect(await screen.findByRole('region', { name: `${next} detail` })).toBeInTheDocument()
    }

    // Left from the first custom row (delta) wraps to the last row (bravo).
    fireEvent.keyDown(document, { key: 'ArrowLeft', metaKey: true, shiftKey: true })
    expect(await screen.findByRole('region', { name: 'bravo detail' })).toBeInTheDocument()
  })

  it('the prev/next buttons follow the same sidebar order', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
    stubFetchWithAgents(fixture)

    render(<AgentList />)
    await openAgent('delta')

    fireEvent.click(screen.getByRole('button', { name: 'Next agent' }))
    expect(await screen.findByRole('region', { name: 'bravo detail' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous agent' }))
    expect(await screen.findByRole('region', { name: 'delta detail' })).toBeInTheDocument()
  })

  it('cycling still reaches an agent hidden by the sidebar filter, in sidebar order', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
    stubFetchWithAgents(fixture)

    render(<AgentList />)
    await openAgent('delta')

    // Only bravo (Project B) matches; delta's own row is filtered out but its pane stays open.
    fireEvent.change(screen.getByLabelText('Filter agents'), { target: { value: 'Project B' } })
    const sidebar = screen.getByRole('complementary', { name: 'Agents' })
    await waitFor(() => { expect(within(sidebar).queryByRole('button', { name: 'delta detail' })).toBeNull() })
    expect(screen.getByRole('region', { name: 'delta detail' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
    expect(await screen.findByRole('region', { name: 'bravo detail' })).toBeInTheDocument()
    // Next from the last row wraps to alpha, which the filter hides from the sidebar.
    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
    expect(await screen.findByRole('region', { name: 'alpha detail' })).toBeInTheDocument()
    expect(within(sidebar).queryByRole('button', { name: 'alpha detail' })).toBeNull()
  })

  it('the shortcut is OS-aware: Shift+Ctrl cycles off-Mac and Shift+Cmd does not', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(LINUX_UA)
    stubFetchWithAgents(fixture)

    render(<AgentList />)
    await openAgent('alpha')

    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
    expect(screen.getByRole('region', { name: 'alpha detail' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true, shiftKey: true })
    expect(await screen.findByRole('region', { name: 'charlie detail' })).toBeInTheDocument()
  })

  it('a plain row click leaves Direct Input unarmed (interactSignal 0); the row CTA arms it (1) and forces the Terminal tab', async () => {
    const busy: Agent = { ...baseAgent(null), id: 41, name: 'cta-busy', state: 'busy' }
    const waiting: Agent = { ...baseAgent(null), id: 42, name: 'cta-waiting', state: 'awaiting' }
    stubFetchWithAgents([busy, waiting])

    render(<AgentList />)
    await openAgent('cta-busy')
    const busyPane = screen.getByRole('region', { name: 'cta-busy detail' })
    expect(within(busyPane).getByTestId('mock-log-tail')).toHaveAttribute('data-interact-signal', '0')
    fireEvent.click(within(busyPane).getByRole('tab', { name: 'Skills' }))

    const sidebar = screen.getByRole('complementary', { name: 'Agents' })
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Direct Input to cta-waiting — it needs your input' }))

    const pane = await screen.findByRole('region', { name: 'cta-waiting detail' })
    expect(screen.queryByRole('region', { name: 'cta-busy detail' })).toBeNull()
    expect(within(pane).getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true')
    expect(within(pane).getByTestId('mock-log-tail')).toHaveAttribute('data-interact-signal', '1')
  })

  it.each(['no-window', 'exited'] as const)('is a no-op for Shift+Cmd+Arrow when the selected agent turns %s while "Show inactive" is off (TASK-0181): the pane stays mounted and no active agent is selected', async (nextState) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
    const gone: Agent = { ...baseAgent(null), id: 81, name: 'noop-gone', state: 'busy', windowPresent: true }
    const x: Agent = { ...baseAgent(null), id: 82, name: 'noop-x', state: 'idle' }
    const y: Agent = { ...baseAgent(null), id: 83, name: 'noop-y', state: 'idle' }
    stubFetchWithAgents([gone, x, y])

    render(<AgentList />)
    await openAgent('noop-gone')
    const pane = screen.getByRole('region', { name: 'noop-gone detail' })

    act(() => { fireSSE('agent-update', { ...gone, state: nextState, windowPresent: false }) })
    const sidebar = screen.getByRole('complementary', { name: 'Agents' })
    await waitFor(() => { expect(within(sidebar).queryByRole('button', { name: 'noop-gone detail' })).toBeNull() })
    expect(screen.getByRole('region', { name: 'noop-gone detail' })).toBe(pane)

    const assertUntouched = () => {
      expect(screen.getByRole('region', { name: 'noop-gone detail' })).toBe(pane)
      expect(screen.queryByRole('region', { name: /^noop-(x|y) detail$/ })).toBeNull()
      expect(sidebar.querySelector('[aria-current="true"]')).toBeNull()
    }

    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
    await act(async () => { await Promise.resolve() })
    assertUntouched()
    fireEvent.keyDown(document, { key: 'ArrowLeft', metaKey: true, shiftKey: true })
    await act(async () => { await Promise.resolve() })
    assertUntouched()
  })

  describe('inactive agents inline in the sidebar and in cycling (TASK-0181)', () => {
    // No project, so the sidebar order is pure A-Z regardless of status (TASK-0183):
    // err-one, live-one, live-two, sleep-a, sleep-b.
    const inactiveFixture = (): Agent[] => [
      { ...baseAgent(null), id: 101, name: 'live-one', state: 'idle', windowPresent: true },
      { ...baseAgent(null), id: 102, name: 'live-two', state: 'busy', windowPresent: true },
      { ...baseAgent(null), id: 103, name: 'sleep-a', state: 'exited', windowPresent: false },
      { ...baseAgent(null), id: 104, name: 'sleep-b', state: 'no-window', windowPresent: false },
      { ...baseAgent(null), id: 105, name: 'err-one', state: 'error', windowPresent: false },
    ]

    const pressRight = () => { fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true }) }
    const pressLeft = () => { fireEvent.keyDown(document, { key: 'ArrowLeft', metaKey: true, shiftKey: true }) }

    it('with "Show inactive" off, Shift+Cmd+Right skips inactive agents and wraps within the active ones only (error stays in the active set)', async () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
      stubFetchWithAgents(inactiveFixture())

      render(<AgentList />)
      await openAgent('live-two')

      for (const next of ['err-one', 'live-one', 'live-two']) {
        pressRight()
        expect(await screen.findByRole('region', { name: `${next} detail` })).toBeInTheDocument()
      }
      expect(screen.queryByRole('region', { name: /^sleep-[ab] detail$/ })).toBeNull()
    })

    it('with "Show inactive" on, cycling walks the sidebar order including inactive agents and wraps at both ends', async () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
      stubFetchWithAgents(inactiveFixture())

      render(<AgentList />)
      const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
      fireEvent.click(await within(sidebar).findByLabelText('Show inactive'))
      await openAgent('err-one')

      for (const next of ['live-one', 'live-two', 'sleep-a', 'sleep-b', 'err-one']) {
        pressRight()
        expect(await screen.findByRole('region', { name: `${next} detail` })).toBeInTheDocument()
      }

      // Left from the first sidebar row wraps to the last inactive row.
      pressLeft()
      expect(await screen.findByRole('region', { name: 'sleep-b detail' })).toBeInTheDocument()
      pressLeft()
      expect(await screen.findByRole('region', { name: 'sleep-a detail' })).toBeInTheDocument()
    })

    it('an inactive agent selected with "Show inactive" on stays selected but the shortcut becomes a no-op once the checkbox is unchecked', async () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
      stubFetchWithAgents(inactiveFixture())

      render(<AgentList />)
      const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
      const checkbox = await within(sidebar).findByLabelText('Show inactive')
      fireEvent.click(checkbox)
      await openAgent('sleep-a')

      fireEvent.click(checkbox)
      await waitFor(() => { expect(within(sidebar).queryByRole('button', { name: 'sleep-a detail' })).toBeNull() })
      const pane = screen.getByRole('region', { name: 'sleep-a detail' })

      pressRight()
      await act(async () => { await Promise.resolve() })
      expect(screen.getByRole('region', { name: 'sleep-a detail' })).toBe(pane)
      pressLeft()
      await act(async () => { await Promise.resolve() })
      expect(screen.getByRole('region', { name: 'sleep-a detail' })).toBe(pane)
    })

    it('the prev/next buttons appear only when the cycle set has more than one agent, so checking "Show inactive" adds inactive agents to the count', async () => {
      stubFetchWithAgents([
        { ...baseAgent(null), id: 111, name: 'solo-live', state: 'busy', windowPresent: true },
        { ...baseAgent(null), id: 112, name: 'solo-sleep', state: 'exited', windowPresent: false },
      ])

      render(<AgentList />)
      await openAgent('solo-live')
      const pane = screen.getByRole('region', { name: 'solo-live detail' })
      expect(within(pane).queryByRole('button', { name: 'Next agent' })).toBeNull()

      const sidebar = screen.getByRole('complementary', { name: 'Agents' })
      fireEvent.click(within(sidebar).getByLabelText('Show inactive'))
      expect(await within(pane).findByRole('button', { name: 'Next agent' })).toBeInTheDocument()
      fireEvent.click(within(pane).getByRole('button', { name: 'Next agent' }))
      expect(await screen.findByRole('region', { name: 'solo-sleep detail' })).toBeInTheDocument()
    })
  })

  it('renders the prev/next header buttons only while more than one agent is active (agentCount > 1)', async () => {
    const solo: Agent = { ...baseAgent(null), id: 91, name: 'gate-solo', state: 'busy', windowPresent: true }
    const other: Agent = { ...baseAgent(null), id: 92, name: 'gate-other', state: 'no-window', windowPresent: false }
    stubFetchWithAgents([solo, other])

    render(<AgentList />)
    await openAgent('gate-solo')
    const pane = screen.getByRole('region', { name: 'gate-solo detail' })
    expect(within(pane).queryByRole('button', { name: 'Next agent' })).toBeNull()
    expect(within(pane).queryByRole('button', { name: 'Previous agent' })).toBeNull()

    // A second agent becomes active: the buttons appear.
    act(() => { fireSSE('agent-update', { ...other, state: 'idle', windowPresent: true }) })
    expect(await within(pane).findByRole('button', { name: 'Next agent' })).toBeInTheDocument()
    expect(within(pane).getByRole('button', { name: 'Previous agent' })).toBeInTheDocument()

    // It goes away again: the buttons disappear.
    act(() => { fireSSE('agent-update', { ...other, state: 'no-window', windowPresent: false }) })
    await waitFor(() => { expect(within(pane).queryByRole('button', { name: 'Next agent' })).toBeNull() })
  })
})

// ── AgentDetailModal Skills section (flattened, TASK-153) ──────────────────

describe('AgentDetailModal Skills section (flattened list)', () => {
  it('shows only the first SKILLS_VISIBLE_LIMIT skills, then reveals the rest via "+N more"', async () => {
    class MockEventSource {
      addEventListener() { /* no-op */ }
      removeEventListener() { /* no-op */ }
      close() { /* no-op */ }
    }
    vi.stubGlobal('EventSource', MockEventSource)

    const agent: Agent = { ...baseAgent(null), id: 1, name: 'skills-agent' }

    const sessionStateFixture = {
      session: 'test-session',
      sessionAlive: true,
      sessionExists: true,
      agents: [agent],
      bgProcesses: [],
      timestamp: new Date().toISOString(),
    }

    // 4 project + 4 user = 8 total, over the SKILLS_VISIBLE_LIMIT of 5.
    const projectSkills = ['proj-one', 'proj-two', 'proj-three', 'proj-four'].map((name) => ({
      name, userInvocable: true, autoOnly: false, source: 'project' as const,
    }))
    const userSkills = ['user-one', 'user-two', 'user-three', 'user-four'].map((name) => ({
      name, userInvocable: true, autoOnly: false, source: 'user' as const,
    }))

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/queue/')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: 'x', tasks: [] }) })
      }
      if (url.includes('/skills')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: 'x', project: projectSkills, user: userSkills }) })
      }
      return Promise.resolve({ ok: true, json: () => sessionStateFixture })
    }))

    render(<AgentList />)

    expect(await screen.findByText('skills-agent')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'skills-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'skills-agent detail' })

    // Combined list is project skills first, then user skills — the first
    // SKILLS_VISIBLE_LIMIT (5) rows are the 4 project skills plus user-one.
    expect(await within(dialog).findByText('/proj-one')).toBeInTheDocument()
    expect(within(dialog).getByText('/proj-two')).toBeInTheDocument()
    expect(within(dialog).getByText('/proj-three')).toBeInTheDocument()
    expect(within(dialog).getByText('/proj-four')).toBeInTheDocument()
    expect(within(dialog).getByText('/user-one')).toBeInTheDocument()
    expect(within(dialog).queryByText('/user-two')).toBeNull()
    expect(within(dialog).queryByText('/user-three')).toBeNull()
    expect(within(dialog).queryByText('/user-four')).toBeNull()

    // hiddenCount = 8 - 5 = 3.
    const moreButton = within(dialog).getByRole('button', { name: '+3 more' })
    fireEvent.click(moreButton)

    expect(await within(dialog).findByText('/user-two')).toBeInTheDocument()
    expect(within(dialog).getByText('/user-three')).toBeInTheDocument()
    expect(within(dialog).getByText('/user-four')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Show less' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('renders no "+N more" toggle when combined project+user skills are at or under SKILLS_VISIBLE_LIMIT', async () => {
    class MockEventSource {
      addEventListener() { /* no-op */ }
      removeEventListener() { /* no-op */ }
      close() { /* no-op */ }
    }
    vi.stubGlobal('EventSource', MockEventSource)

    const agent: Agent = { ...baseAgent(null), id: 1, name: 'skills-agent-small' }

    const sessionStateFixture = {
      session: 'test-session',
      sessionAlive: true,
      sessionExists: true,
      agents: [agent],
      bgProcesses: [],
      timestamp: new Date().toISOString(),
    }

    // 2 project + 2 user = 4 total, at or under the SKILLS_VISIBLE_LIMIT of 5.
    const projectSkills = ['proj-one', 'proj-two'].map((name) => ({
      name, userInvocable: true, autoOnly: false, source: 'project' as const,
    }))
    const userSkills = ['user-one', 'user-two'].map((name) => ({
      name, userInvocable: true, autoOnly: false, source: 'user' as const,
    }))

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/queue/')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: 'x', tasks: [] }) })
      }
      if (url.includes('/skills')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: 'x', project: projectSkills, user: userSkills }) })
      }
      return Promise.resolve({ ok: true, json: () => sessionStateFixture })
    }))

    render(<AgentList />)

    expect(await screen.findByText('skills-agent-small')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'skills-agent-small detail' }))
    const dialog = await screen.findByRole('region', { name: 'skills-agent-small detail' })

    // All 4 rows are visible without expanding anything — single click on the
    // outer "Skills" details is enough, no inner accordion for User skills.
    expect(await within(dialog).findByText('/proj-one')).toBeInTheDocument()
    expect(within(dialog).getByText('/proj-two')).toBeInTheDocument()
    expect(within(dialog).getByText('/user-one')).toBeInTheDocument()
    expect(within(dialog).getByText('/user-two')).toBeInTheDocument()

    expect(within(dialog).queryByRole('button', { name: /more$/ })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Show less' })).toBeNull()

    vi.unstubAllGlobals()
  })
})

// ── AgentDetailModal actions menu wiring (TASK-148) ─────────────────────────
// Closes the gap UAT-148 (UAT-UI-001/005/006/007) flagged: a wiring-level test
// of the `agentActionItems` array (order, the windowPresent-gated omission of
// "Stop agent" icon button, and the Stop/Destroy icon buttons + Rename/Change role/Clone menu entry points) belongs here,
// distinct from AgentActionsMenu.test.tsx's generic-mechanics coverage.

function stubAgentDetailFetch(agent: Agent, extra?: (url: string) => { ok: boolean; json: () => unknown } | null) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    const overridden = extra?.(url)
    if (overridden) return Promise.resolve(overridden)
    if (url.includes('/queue/')) {
      return Promise.resolve({ ok: true, json: () => ({ agent: 'x', tasks: [] }) })
    }
    if (url.includes('/skills')) {
      return Promise.resolve({ ok: true, json: () => ({ agent: 'x', project: [], user: [] }) })
    }
    return Promise.resolve({
      ok: true,
      json: () => ({
        session: 'test-session', sessionAlive: true, sessionExists: true,
        agents: [agent], bgProcesses: [], timestamp: new Date().toISOString(),
      }),
    })
  }))
}

class MockActionsMenuEventSource {
  addEventListener() { /* no-op */ }
  removeEventListener() { /* no-op */ }
  close() { /* no-op */ }
}

describe('AgentDetailModal actions menu wiring (TASK-148)', () => {
  it('shows Stop/Destroy as icon buttons beside the menu, which lists only Rename, Change role, Clone, Clone into new worktree, Create worktree, Add background process', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 1, name: 'actions-agent', windowPresent: true }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    expect(await screen.findByText('actions-agent')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'actions-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'actions-agent detail' })

    expect(within(dialog).queryByRole('button', { name: 'Rename' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Stop agent' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Destroy agent' })).toBeInTheDocument()

    const trigger = within(dialog).getByRole('button', { name: 'Agent actions' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'true')
    fireEvent.click(trigger)

    const menuItems = within(dialog).getAllByRole('menuitem')
    expect(menuItems.map((el) => el.textContent)).toEqual(['Rename', 'Change role', 'Clone', 'Clone into new worktree', 'Create worktree', 'Add background process'])

    vi.unstubAllGlobals()
  })

  it('omits the Stop agent button entirely (not just disabled) when the agent has no live window', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 2, name: 'inactive-agent', windowPresent: false }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    const detailButton = await screen.findByRole('button', { name: 'inactive-agent detail' })
    fireEvent.click(detailButton)
    const dialog = await screen.findByRole('region', { name: 'inactive-agent detail' })

    expect(within(dialog).queryByRole('button', { name: 'Stop agent' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Destroy agent' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent actions' }))
    const menuItems = within(dialog).getAllByRole('menuitem')
    expect(menuItems.map((el) => el.textContent)).toEqual(['Rename', 'Change role', 'Clone', 'Clone into new worktree', 'Create worktree', 'Add background process'])

    vi.unstubAllGlobals()
  })

  it('selecting Add background process opens the bg-process form', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 4, name: 'bg-agent', windowPresent: true }
    stubAgentDetailFetch(agent, (url) => (url.includes('/projects') ? { ok: true, json: () => [] } : null))

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'bg-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'bg-agent detail' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(dialog).getByRole('menuitem', { name: 'Add background process' }))

    expect(await screen.findByText('Add Background Process')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('selecting Rename closes the menu and swaps the trigger for the pre-filled inline input', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 3, name: 'rename-agent', windowPresent: true }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'rename-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'rename-agent detail' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(dialog).getByRole('menuitem', { name: 'Rename' }))

    expect(within(dialog).queryByRole('menu')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Agent actions' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Stop agent' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Destroy agent' })).toBeNull()
    expect(within(dialog).getByDisplayValue('rename-agent')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('clicking Stop agent shows the ConfirmDialog message and "Stop" confirm label', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 4, name: 'close-agent', windowPresent: true }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'close-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'close-agent detail' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop agent' }))

    const closeMessage = within(dialog).getByText('Stop agent "close-agent"\'s window and close this view? The agent stays registered and can be relaunched with "Create window".')
    const closeButtonRow = closeMessage.parentElement?.nextElementSibling as HTMLElement
    expect(within(closeButtonRow).getByRole('button', { name: 'Stop' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('clicking Destroy agent shows the ConfirmDialog message and "Destroy" confirm label', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 5, name: 'remove-agent', windowPresent: true }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'remove-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'remove-agent detail' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Destroy agent' }))

    expect(within(dialog).getByText('Destroy agent "remove-agent"? This kills its tmux window, deletes it from conductor.conf, and drops its queued tasks.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Destroy' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('selecting Clone fires POST /agents/:id/clone immediately with no confirmation dialog', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 6, name: 'clone-agent', windowPresent: true }
    const fetchSpy = vi.fn()
    stubAgentDetailFetch(agent, (url) => {
      if (url.includes('/clone')) {
        fetchSpy(url)
        return { ok: true, json: () => ({ agent: { ...agent, id: 60, name: 'clone-agent-copy' } }) }
      }
      return null
    })

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'clone-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'clone-agent detail' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(dialog).getByRole('menuitem', { name: 'Clone' }))

    await vi.waitFor(() => { expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/agents/6/clone')) })
    // Non-destructive — no ConfirmDialog text should appear.
    expect(within(dialog).queryByText(/^Destroy agent|^Stop agent "/)).toBeNull()

    vi.unstubAllGlobals()
  })

  it('confirming Stop agent closes the modal once the window DELETE succeeds', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 7, name: 'close-confirm-agent', windowPresent: true }
    stubAgentDetailFetch(agent, (url) => {
      if (url.includes('/agents/7/window')) return { ok: true, json: () => ({ ok: true }) }
      return null
    })

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'close-confirm-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'close-confirm-agent detail' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop agent' }))
    const closeMessage = within(dialog).getByText(/window and close this view\?/)
    const closeButtonRow = closeMessage.parentElement?.nextElementSibling as HTMLElement
    fireEvent.click(within(closeButtonRow).getByRole('button', { name: 'Stop' }))

    await waitFor(() => { expect(screen.queryByRole('region', { name: 'close-confirm-agent detail' })).toBeNull() })

    vi.unstubAllGlobals()
  })

  it('confirming Destroy agent closes the modal once the DELETE succeeds', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 8, name: 'remove-confirm-agent', windowPresent: true }
    stubAgentDetailFetch(agent, (url) => {
      if (url.endsWith('/agents/8')) return { ok: true, json: () => ({ ok: true }) }
      return null
    })

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'remove-confirm-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'remove-confirm-agent detail' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Destroy agent' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Destroy' }))

    await waitFor(() => { expect(screen.queryByRole('region', { name: 'remove-confirm-agent detail' })).toBeNull() })

    vi.unstubAllGlobals()
  })
})

// ── AgentDetailView "Clone into new worktree" menu item (TASK-0214) ─────────
// Same direct-render setup as the TASK-0209 block below. `cloneAgent` is the module-scope spy
// (delegating to the real helper unless overridden per call), so the exact arguments can be asserted.
describe('AgentDetailView "Clone into new worktree" menu item (TASK-0214)', () => {
  const TOOLTIP = 'Spawn a copy of this agent in its own new git worktree and branch (off the base branch — uncommitted work is not copied)'

  function renderView(agent: Agent, onCloned = vi.fn()) {
    render(<AgentDetailView agent={agent} project={null} projectId={null} projectBgs={[]} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} onCloned={onCloned} />)
    return document.body
  }

  function openMenu(root: HTMLElement) {
    fireEvent.click(within(root).getByRole('button', { name: 'Agent actions' }))
  }

  beforeEach(() => {
    cloneAgentMock.mockClear()
  })

  it.each([
    ['without a worktree', {}],
    ['with a worktree', { worktreePath: '/tmp/wt/61', branch: 'conductor/61' }],
  ])('is present and enabled for an agent %s, right after Clone, with the tooltip copy', (_label, extra) => {
    const agent: Agent = { ...baseAgent(null), id: 61, name: 'cwt-present-agent', inGitRepo: true, ...extra }
    stubAgentDetailFetch(agent, (url) => (url.includes('/checkpoints') ? { ok: true, json: () => ({ checkpoints: [] }) } : null))
    const root = renderView(agent)

    openMenu(root)
    const items = within(root).getAllByRole('menuitem')
    const names = items.map((el) => el.textContent)
    expect(names.indexOf('Clone into new worktree')).toBe(names.indexOf('Clone') + 1)
    const item = within(root).getByRole('menuitem', { name: 'Clone into new worktree' })
    expect(item).toBeEnabled()
    expect(item).toHaveAttribute('title', TOOLTIP)
    // Plain Clone is untouched.
    expect(within(root).getByRole('menuitem', { name: 'Clone' })).toBeEnabled()
  })

  it('calls cloneAgent with { forceWorktree: true }, while plain Clone calls it with only the agent id', async () => {
    const agent: Agent = { ...baseAgent(null), id: 62, name: 'cwt-args-agent', inGitRepo: true }
    stubAgentDetailFetch(agent)
    cloneAgentMock.mockImplementationOnce(() => Promise.resolve({ id: 620 })).mockImplementationOnce(() => Promise.resolve({ id: 620 }))
    const onCloned = vi.fn()
    const root = renderView(agent, onCloned)

    openMenu(root)
    fireEvent.click(within(root).getByRole('menuitem', { name: 'Clone into new worktree' }))
    await vi.waitFor(() => { expect(onCloned).toHaveBeenCalledTimes(1) })
    expect(cloneAgentMock).toHaveBeenCalledTimes(1)
    expect(cloneAgentMock.mock.calls[0]).toEqual([62, { forceWorktree: true }])

    openMenu(root)
    fireEvent.click(within(root).getByRole('menuitem', { name: 'Clone' }))
    await vi.waitFor(() => { expect(onCloned).toHaveBeenCalledTimes(2) })
    expect(cloneAgentMock).toHaveBeenCalledTimes(2)
    expect(cloneAgentMock.mock.calls[1]).toEqual([62])
    expect(onCloned).toHaveBeenCalledWith(620)
  })

  it('shows the backend reason in the shared banner when the clone is rejected', async () => {
    const reason = "failed to create git worktree at /x/y: a branch named 'conductor/63' already exists"
    const agent: Agent = { ...baseAgent(null), id: 63, name: 'cwt-error-agent', inGitRepo: true }
    stubAgentDetailFetch(agent)
    cloneAgentMock.mockImplementationOnce(() => Promise.reject(new Error(reason)))
    const onCloned = vi.fn()
    const root = renderView(agent, onCloned)

    openMenu(root)
    fireEvent.click(within(root).getByRole('menuitem', { name: 'Clone into new worktree' }))

    const banner = await within(root).findByText(reason)
    expect(banner).toHaveClass('text-accent-red')
    expect(onCloned).not.toHaveBeenCalled()
    // Re-enabled so the user can retry.
    openMenu(root)
    expect(within(root).getByRole('menuitem', { name: 'Clone into new worktree' })).toBeEnabled()
  })

  it('is disabled with the not-a-repo reason when inGitRepo is false, and clicking does nothing', () => {
    const agent: Agent = { ...baseAgent(null), id: 64, name: 'cwt-no-repo-agent', inGitRepo: false }
    stubAgentDetailFetch(agent)
    const root = renderView(agent)

    openMenu(root)
    const item = within(root).getByRole('menuitem', { name: 'Clone into new worktree' })
    expect(item).toBeDisabled()
    expect(item).toHaveTextContent('Workdir is not inside a git repository')
    // Plain Clone stays available: it needs no repo.
    expect(within(root).getByRole('menuitem', { name: 'Clone' })).toBeEnabled()

    fireEvent.click(item)
    expect(cloneAgentMock).not.toHaveBeenCalled()
  })

  it('is enabled when inGitRepo is undefined (unknown counts as allowed) and shows no reason', () => {
    const agent: Agent = { ...baseAgent(null), id: 65, name: 'cwt-unknown-agent' }
    expect(agent.inGitRepo).toBeUndefined()
    stubAgentDetailFetch(agent)
    const root = renderView(agent)

    openMenu(root)
    const item = within(root).getByRole('menuitem', { name: 'Clone into new worktree' })
    expect(item).toBeEnabled()
    expect(item).not.toHaveTextContent('Workdir is not inside a git repository')
  })

  it('disables both clone items while a clone is in flight and fires cloneAgent only once', async () => {
    const agent: Agent = { ...baseAgent(null), id: 66, name: 'cwt-inflight-agent', inGitRepo: true }
    stubAgentDetailFetch(agent)
    cloneAgentMock.mockImplementationOnce(() => new Promise(() => { /* never settles */ }))
    const root = renderView(agent)

    openMenu(root)
    fireEvent.click(within(root).getByRole('menuitem', { name: 'Clone into new worktree' }))
    await vi.waitFor(() => { expect(cloneAgentMock).toHaveBeenCalledTimes(1) })

    openMenu(root)
    const inFlight = within(root).getByRole('menuitem', { name: 'Cloning…' })
    expect(inFlight).toBeDisabled()
    expect(within(root).getByRole('menuitem', { name: 'Clone' })).toBeDisabled()

    fireEvent.click(inFlight)
    fireEvent.click(within(root).getByRole('menuitem', { name: 'Clone' }))
    expect(cloneAgentMock).toHaveBeenCalledTimes(1)
  })
})

// ── AgentDetailView "Create worktree" menu item (TASK-0209) ─────────────────
// Renders AgentDetailView directly (LogTail is mocked at module scope, so no EventSource stub is
// needed). createWorktreeForAgent is replaced by a spy at module scope above.
describe('AgentDetailView "Create worktree" menu item (TASK-0209)', () => {
  function renderView(agent: Agent) {
    render(<AgentDetailView agent={agent} project={null} projectId={null} projectBgs={[]} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    return document.body
  }

  function openMenu(root: HTMLElement) {
    fireEvent.click(within(root).getByRole('button', { name: 'Agent actions' }))
  }

  beforeEach(() => {
    createWorktreeForAgentMock.mockReset()
  })

  it('enabled for an in-repo agent without a worktree: clicking it calls createWorktreeForAgent once and the branch badge appears', async () => {
    const agent: Agent = { ...baseAgent(null), id: 11, name: 'wt-create-agent', inGitRepo: true, windowPresent: false }
    stubAgentDetailFetch(agent, (url) => (url.includes('/checkpoints') ? { ok: true, json: () => ({ checkpoints: [] }) } : null))
    createWorktreeForAgentMock.mockResolvedValue({ ...agent, worktreePath: '/tmp/wt/11', branch: 'conductor/11' })
    const root = renderView(agent)

    expect(within(root).queryByText('⎇ conductor/11')).toBeNull()
    openMenu(root)
    const item = within(root).getByRole('menuitem', { name: 'Create worktree' })
    expect(item).toBeEnabled()
    fireEvent.click(item)

    expect(createWorktreeForAgentMock).toHaveBeenCalledTimes(1)
    expect(createWorktreeForAgentMock).toHaveBeenCalledWith(11)
    expect(await within(root).findByText('⎇ conductor/11')).toBeInTheDocument()

    // Once created, the menu item is disabled and its description names the new branch.
    openMenu(root)
    const after = within(root).getByRole('menuitem', { name: 'Create worktree' })
    expect(after).toBeDisabled()
    expect(after).toHaveTextContent('Already has a worktree (conductor/11)')
  })

  it('disabled for an agent that already has a worktree, with a description naming the branch', () => {
    const agent: Agent = { ...baseAgent(null), id: 12, name: 'wt-existing-agent', inGitRepo: true, worktreePath: '/tmp/wt/12', branch: 'conductor/12' }
    stubAgentDetailFetch(agent, (url) => (url.includes('/checkpoints') ? { ok: true, json: () => ({ checkpoints: [] }) } : null))
    const root = renderView(agent)

    openMenu(root)
    const item = within(root).getByRole('menuitem', { name: 'Create worktree' })
    expect(item).toBeDisabled()
    expect(item).toHaveTextContent('Already has a worktree (conductor/12)')
    const describedBy = item.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent('Already has a worktree (conductor/12)')

    fireEvent.click(item)
    expect(createWorktreeForAgentMock).not.toHaveBeenCalled()
  })

  it('disabled with the not-a-repo reason when inGitRepo is false', () => {
    const agent: Agent = { ...baseAgent(null), id: 13, name: 'wt-no-repo-agent', inGitRepo: false }
    stubAgentDetailFetch(agent)
    const root = renderView(agent)

    openMenu(root)
    const item = within(root).getByRole('menuitem', { name: 'Create worktree' })
    expect(item).toBeDisabled()
    expect(item).toHaveTextContent('Workdir is not inside a git repository')

    fireEvent.click(item)
    expect(createWorktreeForAgentMock).not.toHaveBeenCalled()
  })

  it('enabled when inGitRepo is undefined (unknown counts as allowed)', () => {
    const agent: Agent = { ...baseAgent(null), id: 14, name: 'wt-unknown-repo-agent' }
    expect(agent.inGitRepo).toBeUndefined()
    stubAgentDetailFetch(agent)
    const root = renderView(agent)

    openMenu(root)
    const item = within(root).getByRole('menuitem', { name: 'Create worktree' })
    expect(item).toBeEnabled()
    expect(item).not.toHaveTextContent('Workdir is not inside a git repository')
  })

  it('a rejected createWorktreeForAgent shows the error in the shared banner while the Details tab is not active', async () => {
    const agent: Agent = { ...baseAgent(null), id: 15, name: 'wt-error-agent', inGitRepo: true, windowPresent: false }
    stubAgentDetailFetch(agent)
    createWorktreeForAgentMock.mockRejectedValue(new Error('git worktree add failed: boom'))
    const root = renderView(agent)

    expect(within(root).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'false')
    openMenu(root)
    fireEvent.click(within(root).getByRole('menuitem', { name: 'Create worktree' }))

    const banner = await within(root).findByText('git worktree add failed: boom')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveClass('text-accent-red')
    // Still on the original tab: the error must not depend on the Details tab being open.
    expect(within(root).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'false')
    // The item is re-enabled so the user can retry.
    openMenu(root)
    expect(within(root).getByRole('menuitem', { name: 'Create worktree' })).toBeEnabled()
  })

  // TASK-0210: the backend now returns the real failure reason; it must surface once, in the shared
  // banner only (the Details Worktree row no longer duplicates it).
  it.each([
    'agent 7 workdir is not inside a git repository',
    "failed to create git worktree at /x/y: a branch named 'conductor/7' already exists",
    'Could not reach the host-server',
  ])('shows the real reason "%s" exactly once (banner only, no Details-row duplicate)', async (reason) => {
    const agent: Agent = { ...baseAgent(null), id: 7, name: 'wt-reason-agent', inGitRepo: true, windowPresent: false }
    stubAgentDetailFetch(agent)
    createWorktreeForAgentMock.mockRejectedValue(new Error(reason))
    const root = renderView(agent)

    openMenu(root)
    fireEvent.click(within(root).getByRole('menuitem', { name: 'Create worktree' }))
    const banner = await within(root).findByText(reason)
    expect(banner).toHaveClass('break-words')

    // Open the Details tab (which holds the Worktree row) and confirm there is still only one copy.
    fireEvent.click(within(root).getByRole('tab', { name: 'Details' }))
    expect(within(root).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
    expect(within(root).getAllByText(reason)).toHaveLength(1)
  })
})

// ── AgentDetailView worktree warn-first + Restart in worktree (TASK-0216) ────
// A worktree added to an agent whose window is live only updates the DB row (the pane keeps its
// cwd), so creation is gated behind a warning dialog and followed by a persistent notice with a
// confirmed "Restart in worktree". Agents without a window skip all of it. Both "Create worktree"
// triggers (actions menu, Details-tab button) share the same wrapper.
describe('AgentDetailView worktree warn-first + restart (TASK-0216)', () => {
  const WARNING = /A new worktree will not move the running agent/
  const NOTICE = /is still running in/

  function renderView(agent: Agent, opts: { status?: ComponentProps<typeof AgentDetailView>['status']; onClose?: () => void } = {}) {
    const onClose = opts.onClose ?? vi.fn()
    const utils = render(<AgentDetailView agent={agent} project={null} projectId={null} projectBgs={[]} status={opts.status ?? 'idle'} onClose={onClose} agentCount={1} onNavigate={vi.fn()} />)
    return { root: document.body, onClose, ...utils }
  }

  function clickMenuCreate(root: HTMLElement) {
    fireEvent.click(within(root).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(root).getByRole('menuitem', { name: 'Create worktree' }))
  }

  // The dialog is rendered after the detail content, so its confirm button is the last one named
  // "Create worktree" (the Details tab's inline button can be in the DOM too).
  function confirmCreateWorktree() {
    const buttons = screen.getAllByRole('button', { name: 'Create worktree' })
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement)
  }

  function liveAgent(id: number, name: string): Agent {
    return { ...baseAgent(null), id, name, inGitRepo: true, windowPresent: true, workdir: '/repo/main' }
  }

  function stubDetail(agent: Agent) {
    stubAgentDetailFetch(agent, (url) => (url.includes('/checkpoints') ? { ok: true, json: () => ({ checkpoints: [] }) } : null))
  }

  beforeEach(() => {
    createWorktreeForAgentMock.mockReset()
    restartAgentWindowMock.mockReset()
  })

  it('live window: the menu item opens the warning first and creates nothing until confirmed', async () => {
    const agent = liveAgent(51, 'wt-live-menu')
    stubDetail(agent)
    createWorktreeForAgentMock.mockResolvedValue({ ...agent, worktreePath: '/repo/wt/51', branch: 'conductor/51' })
    const { root } = renderView(agent)

    clickMenuCreate(root)
    expect(screen.getByText(WARNING)).toBeInTheDocument()
    expect(screen.getByText(WARNING)).toHaveTextContent('/repo/main')
    expect(createWorktreeForAgentMock).not.toHaveBeenCalled()

    // Cancelling leaves no call and closes the dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(WARNING)).toBeNull()
    expect(createWorktreeForAgentMock).not.toHaveBeenCalled()

    // Re-open and confirm: now it is created and the dialog closes.
    clickMenuCreate(root)
    confirmCreateWorktree()
    await waitFor(() => { expect(createWorktreeForAgentMock).toHaveBeenCalledTimes(1) })
    expect(createWorktreeForAgentMock).toHaveBeenCalledWith(51)
    expect(screen.queryByText(WARNING)).toBeNull()
  })

  it('confirming creation shows the persistent notice naming the workdir and worktree, with a Restart in worktree button', async () => {
    const agent = liveAgent(52, 'wt-live-notice')
    stubDetail(agent)
    createWorktreeForAgentMock.mockResolvedValue({ ...agent, worktreePath: '/repo/wt/52', branch: 'conductor/52' })
    const { root } = renderView(agent)

    expect(within(root).queryByRole('status')).toBeNull()
    clickMenuCreate(root)
    confirmCreateWorktree()

    const notice = await within(root).findByRole('status')
    expect(notice).toHaveTextContent(NOTICE)
    expect(notice).toHaveTextContent('/repo/main')
    expect(notice).toHaveTextContent('/repo/wt/52')
    expect(within(notice).getByRole('button', { name: 'Restart in worktree' })).toBeInTheDocument()
  })

  it('no window: creation is immediate, with no dialog and no notice', async () => {
    const agent: Agent = { ...liveAgent(53, 'wt-no-window'), windowPresent: false }
    stubDetail(agent)
    createWorktreeForAgentMock.mockResolvedValue({ ...agent, worktreePath: '/repo/wt/53', branch: 'conductor/53' })
    const { root } = renderView(agent)

    clickMenuCreate(root)
    expect(screen.queryByText(WARNING)).toBeNull()
    expect(createWorktreeForAgentMock).toHaveBeenCalledWith(53)
    expect(await within(root).findByText('⎇ conductor/53')).toBeInTheDocument()
    expect(within(root).queryByRole('status')).toBeNull()
  })

  it('the Details-tab button follows the same warn-first path as the menu item', async () => {
    const agent = liveAgent(54, 'wt-live-details')
    stubDetail(agent)
    createWorktreeForAgentMock.mockResolvedValue({ ...agent, worktreePath: '/repo/wt/54', branch: 'conductor/54' })
    const { root } = renderView(agent)

    fireEvent.click(within(root).getByRole('tab', { name: 'Details' }))
    fireEvent.click(within(root).getByRole('button', { name: 'Create worktree' }))
    expect(screen.getByText(WARNING)).toBeInTheDocument()
    expect(createWorktreeForAgentMock).not.toHaveBeenCalled()

    // The dialog's confirm button is rendered after the Details button; it is the last match.
    const buttons = screen.getAllByRole('button', { name: 'Create worktree' })
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement)
    await waitFor(() => { expect(createWorktreeForAgentMock).toHaveBeenCalledWith(54) })
    expect(await within(root).findByRole('status')).toHaveTextContent(NOTICE)
  })

  it('Restart in worktree: confirm dialog (with the busy warning when working) then restartAgentWindow once, notice cleared, view stays selected', async () => {
    const agent = liveAgent(55, 'wt-restart')
    stubDetail(agent)
    createWorktreeForAgentMock.mockResolvedValue({ ...agent, worktreePath: '/repo/wt/55', branch: 'conductor/55' })
    restartAgentWindowMock.mockResolvedValue(undefined)
    const onClose = vi.fn()
    const { root } = renderView(agent, { status: 'busy', onClose })

    clickMenuCreate(root)
    confirmCreateWorktree()
    fireEvent.click(await within(root).findByRole('button', { name: 'Restart in worktree' }))

    // The confirmation says plainly what is lost, plus the stronger busy sentence.
    const dialogText = screen.getByText(/stops the running agent process and relaunches it/)
    expect(dialogText).toHaveTextContent('conversation context are lost')
    expect(dialogText).toHaveTextContent('is currently busy')
    expect(restartAgentWindowMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await waitFor(() => { expect(restartAgentWindowMock).toHaveBeenCalledTimes(1) })
    expect(restartAgentWindowMock).toHaveBeenCalledWith(55)
    await waitFor(() => { expect(within(root).queryByRole('status')).toBeNull() })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Restart confirmation omits the busy sentence for an idle agent', async () => {
    const agent = liveAgent(56, 'wt-restart-idle')
    stubDetail(agent)
    createWorktreeForAgentMock.mockResolvedValue({ ...agent, worktreePath: '/repo/wt/56', branch: 'conductor/56' })
    const { root } = renderView(agent, { status: 'idle' })

    clickMenuCreate(root)
    confirmCreateWorktree()
    fireEvent.click(await within(root).findByRole('button', { name: 'Restart in worktree' }))
    expect(screen.getByText(/stops the running agent process and relaunches it/)).not.toHaveTextContent('is currently')
  })

  it('a failed restart shows the message in the banner and keeps the notice', async () => {
    const agent = liveAgent(57, 'wt-restart-fail')
    stubDetail(agent)
    createWorktreeForAgentMock.mockResolvedValue({ ...agent, worktreePath: '/repo/wt/57', branch: 'conductor/57' })
    restartAgentWindowMock.mockRejectedValue(new Error('Window stopped but relaunch failed: spawn boom'))
    const { root } = renderView(agent)

    clickMenuCreate(root)
    confirmCreateWorktree()
    fireEvent.click(await within(root).findByRole('button', { name: 'Restart in worktree' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))

    const banner = await within(root).findByText('Window stopped but relaunch failed: spawn boom')
    expect(banner).toHaveClass('text-accent-red')
    expect(within(root).getByRole('status')).toHaveTextContent(NOTICE)
  })

  it('the notice clears when the agent window disappears', async () => {
    const agent = liveAgent(58, 'wt-window-gone')
    stubDetail(agent)
    createWorktreeForAgentMock.mockResolvedValue({ ...agent, worktreePath: '/repo/wt/58', branch: 'conductor/58' })
    const { root, rerender } = renderView(agent)

    clickMenuCreate(root)
    confirmCreateWorktree()
    expect(await within(root).findByRole('status')).toBeInTheDocument()

    rerender(<AgentDetailView agent={{ ...agent, windowPresent: false }} project={null} projectId={null} projectBgs={[]} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    await waitFor(() => { expect(within(root).queryByRole('status')).toBeNull() })
  })
})

// ── AgentDetailView role switcher (TASK-167) ────────────────────────────────
// Renders AgentDetailView directly (as the TASK-157 describe block below
// does, and for the same reason its own comment gives: no EventSource stub
// is needed here because LogTail — the tree's only useSSE consumer — is
// mocked at module scope above). updateAgentRole (frontend/src/lib/api.ts)
// isn't vi.mock'd — like renameAgent, it goes through the real apiFetch over
// global fetch — so the API call is observed the same way the BgProcessRow
// inline-edit tests above observe their PATCH calls: a stubbed fetch whose
// onPatch callback records the request body.
describe('AgentDetailView role switcher (TASK-167)', () => {
  function stubRoleFetch(agent: Agent, onPatch?: (body: { name?: string; role?: string }) => { ok: boolean; json: () => Promise<unknown> }) {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes(`/agents/${agent.id.toString()}`) && init?.method === 'PATCH') {
        const body = init.body ? JSON.parse(init.body as string) as { name?: string; role?: string } : {}
        return Promise.resolve(onPatch ? onPatch(body) : { ok: true, json: () => Promise.resolve({ agent: { ...agent, ...body } }) })
      }
      if (url.includes('/queue/')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: 'x', tasks: [] }) })
      }
      if (url.includes('/skills')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: 'x', project: [], user: [] }) })
      }
      return Promise.resolve({ ok: true, json: () => ({}) })
    }))
  }

  function detailModalProps(agent: Agent, overrides: Partial<{ onRoleChanged: (agentId: number, role: string) => void }> = {}) {
    return {
      agent,
      project: null,
      projectId: null,
      projectBgs: [] as BgProcess[],
      status: 'idle' as AgentStatus,
      onClose: vi.fn(),
      agentCount: 1,
      onNavigate: vi.fn(),
      ...overrides,
    }
  }

  it('opening the role switcher shows a select pre-filled with the agent\'s current role and every ROLE_VALUES option', () => {
    const agent: Agent = { ...baseAgent(null), id: 20, name: 'role-agent', role: 'qa' }
    stubRoleFetch(agent)

    render(<AgentDetailView {...detailModalProps(agent)} />)
    const dialog = document.body

    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(dialog).getByRole('menuitem', { name: 'Change role' }))

    expect(within(dialog).queryByRole('menu')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Agent actions' })).toBeNull()

    const select = within(dialog).getByRole('combobox')
    expect((select as HTMLSelectElement).value).toBe('qa')
    const optionValues = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(optionValues).toEqual([...ROLE_VALUES])

    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('changing the selection and clicking Save calls updateAgentRole with the new role and fires onRoleChanged', async () => {
    const agent: Agent = { ...baseAgent(null), id: 21, name: 'role-save-agent', role: 'qa' }
    const onRoleChanged = vi.fn()
    const patchSpy = vi.fn()
    stubRoleFetch(agent, (body) => {
      patchSpy(body)
      return { ok: true, json: () => Promise.resolve({ agent: { ...agent, ...body } }) }
    })

    render(<AgentDetailView {...detailModalProps(agent, { onRoleChanged })} />)
    const dialog = document.body

    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(dialog).getByRole('menuitem', { name: 'Change role' }))

    const select = within(dialog).getByRole('combobox')
    fireEvent.change(select, { target: { value: 'devops' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(patchSpy).toHaveBeenCalledWith({ role: 'devops' }) })
    await waitFor(() => { expect(onRoleChanged).toHaveBeenCalledWith(21, 'devops') })
    // The switcher closes back to the actions-menu trigger once the save resolves.
    expect(within(dialog).queryByRole('combobox')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Agent actions' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('Cancel discards the role change without calling updateAgentRole or firing onRoleChanged', () => {
    const agent: Agent = { ...baseAgent(null), id: 22, name: 'role-cancel-agent', role: 'qa' }
    const onRoleChanged = vi.fn()
    const patchSpy = vi.fn()
    stubRoleFetch(agent, (body) => {
      patchSpy(body)
      return { ok: true, json: () => Promise.resolve({ agent: { ...agent, ...body } }) }
    })

    render(<AgentDetailView {...detailModalProps(agent, { onRoleChanged })} />)
    const dialog = document.body

    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(dialog).getByRole('menuitem', { name: 'Change role' }))

    const select = within(dialog).getByRole('combobox')
    fireEvent.change(select, { target: { value: 'devops' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(within(dialog).queryByRole('combobox')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Agent actions' })).toBeInTheDocument()
    expect(patchSpy).not.toHaveBeenCalled()
    expect(onRoleChanged).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})

// ── AgentDetailView tabbed info panel (TASK-157) ────────────────────────────
//
// Renders AgentDetailView directly (not through the whole AgentList board) — it's exported
// specifically for this. LogTail is mocked at module scope above (see the vi.mock('./LogTail')
// comment near the top of this file); no EventSource stub is needed here the way the actions-
// menu wiring tests above need one, because the real LogTail (the only consumer of useSSE in
// this tree) never mounts. DiffPanel/UsageBreakdown still fetch for real, same as every other
// AgentDetailView test in this file — stubAgentDetailFetch's catch-all branch covers them.
//
// Only Terminal/Skills/Diff are used as the tabs to click between below. Usage is deliberately
// left out: UsageBreakdown's `present` starts `false` on its very first render (sessions state
// initializes to `null`), so under stubAgentDetailFetch's generic (sessions-less) response shape
// it reports absent and unmounts itself before its own fetch ever resolves — real, but
// timing-sensitive, behavior that's orthogonal to what this describe block is testing.
describe('AgentDetailView tabbed info panel (TASK-157)', () => {
  beforeEach(() => {
    logTailMountSpy.mockClear()
    logTailUnmountSpy.mockClear()
  })

  function detailModalProps(overrides: Partial<{ armInteract: boolean }> = {}) {
    const agent = baseAgent(null)
    stubAgentDetailFetch(agent)
    return {
      agent,
      project: null,
      projectId: null,
      projectBgs: [] as BgProcess[],
      status: 'idle' as AgentStatus,
      onClose: vi.fn(),
      agentCount: 1,
      onNavigate: vi.fn(),
      ...overrides,
    }
  }

  it('keeps LogTail mounted — never unmounted or remounted — across repeated tab switches away from and back to Terminal', () => {
    render(<AgentDetailView {...detailModalProps()} />)
    const dialog = document.body
    expect(logTailMountSpy).toHaveBeenCalledTimes(1)

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Skills' }))
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Diff' }))
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Terminal' }))
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Skills' }))
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Terminal' }))

    expect(logTailMountSpy).toHaveBeenCalledTimes(1)
    expect(logTailUnmountSpy).not.toHaveBeenCalled()
    expect(screen.getByTestId('mock-log-tail')).toBeInTheDocument()
  })

  it('toggles only the Terminal tabpanel\'s hidden class on switch — the panel stays in the DOM, it is never removed', () => {
    render(<AgentDetailView {...detailModalProps()} />)
    const dialog = document.body
    const terminalPanel = within(dialog).getByRole('tabpanel', { name: 'Terminal' })
    expect(terminalPanel.className.split(' ')).not.toContain('hidden')

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Skills' }))
    expect(terminalPanel.className.split(' ')).toContain('hidden')
    expect(terminalPanel).toContainElement(screen.getByTestId('mock-log-tail'))

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Terminal' }))
    expect(terminalPanel.className.split(' ')).not.toContain('hidden')
  })

  it('armInteract: true forces the Terminal tab active on open, overriding a tab the user had already switched to', () => {
    const props = detailModalProps({ armInteract: false })
    const { rerender } = render(<AgentDetailView {...props} />)
    const dialog = document.body

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Skills' }))
    expect(within(dialog).getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'false')

    rerender(<AgentDetailView {...props} armInteract={true} />)

    expect(within(dialog).getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'false')
  })
})

// ── AgentDetailView Details/Queued Tasks tabs (TASK-162 Step 3) ────────────
//
// TASK-162 Step 2 moved the modal's former "Details" and "Queued tasks" <details> accordions
// into two new AgentInfoTabs entries (ids 'details' and 'queued-tasks'), landing between
// Skills and Diff in the tab strip. Renders AgentDetailView directly and reuses
// stubAgentDetailFetch, same as the TASK-157 suite above — no EventSource stub needed for the
// same reason (LogTail is mocked, so useSSE's only consumer never mounts).
describe('AgentDetailView Details/Queued Tasks tabs (TASK-162 Step 3)', () => {
  it('positions Details and Queued Tasks between Skills and Diff, with Diff/Usage/Checkpoints trailing in order', async () => {
    const agent: Agent = {
      ...baseAgent(null),
      id: 1,
      name: 'tab-order-agent',
      worktreePath: '/tmp/test-worktree',
      branch: 'feature/tab-order',
    }
    stubAgentDetailFetch(agent, (url) => {
      if (url.includes('/usage')) {
        return {
          ok: true,
          json: () => ({
            agent: 'x',
            sessions: [{
              id: 1, agentId: 1, sessionStart: '2024-01-01T00:00:00Z',
              inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
              costUsd: 0.01, updatedAt: '2024-01-01T00:00:00Z',
            }],
          }),
        }
      }
      // CheckpointList (mounted once Checkpoints is present, via agent.worktreePath above)
      // reads data.checkpoints unguarded — the generic catch-all response below has no such
      // field, which crashes the component (and, since the whole modal renders under one
      // ErrorBoundary, blanks the entire dialog) unless it's stubbed explicitly here.
      if (url.includes('/checkpoints')) {
        return { ok: true, json: () => ({ checkpoints: [] }) }
      }
      return null
    })

    render(<AgentDetailView agent={agent} project={null} projectId={null} projectBgs={[]} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    const dialog = document.body

    // Usage is deliberately excluded from this assertion, matching the established precedent
    // in the TASK-157 describe block above: usagePresent defaults to true so UsageBreakdown
    // mounts once, but its own onPresenceChange(false) fires synchronously on that very first
    // effect pass (sessions is still null before the fetch resolves) — the modal reacts by
    // unmounting it immediately, which runs the fetch effect's cleanup (`cancelled = true`)
    // before the in-flight fetch can ever call setSessions. Usage never reappears in this test
    // environment, regardless of how long a test waits. Wait for Checkpoints instead (present
    // synchronously via agent.worktreePath, no fetch-timing race) as the settle signal.
    await within(dialog).findByRole('tab', { name: 'Checkpoints' })

    const tabLabels = within(dialog).getAllByRole('tab').map((el) => el.textContent)
    expect(tabLabels).toEqual(['Terminal', 'Skills', 'Details', 'Queued tasks (0)', 'Diff', 'Checkpoints'])
  })

  it('labels the Details tab exactly "Details" when agent.windowPresent is true', () => {
    const agent: Agent = { ...baseAgent(null), id: 2, name: 'details-present-agent', windowPresent: true }
    stubAgentDetailFetch(agent)

    render(<AgentDetailView agent={agent} project={null} projectId={null} projectBgs={[]} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    const dialog = document.body

    expect(within(dialog).getByRole('tab', { name: 'Details' })).toBeInTheDocument()
  })

  it('labels the Details tab exactly "Details" even when agent.windowPresent is false', () => {
    const agent: Agent = { ...baseAgent(null), id: 3, name: 'details-absent-agent', windowPresent: false }
    stubAgentDetailFetch(agent)

    render(<AgentDetailView agent={agent} project={null} projectId={null} projectBgs={[]} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    const dialog = document.body

    expect(within(dialog).getByRole('tab', { name: 'Details' })).toBeInTheDocument()
  })

  it('shows the Create window button in the Terminal tab in place of the terminal when agent.windowPresent is false', () => {
    const agent: Agent = { ...baseAgent(null), id: 31, name: 'no-window-agent', state: 'exited', windowPresent: false }
    stubAgentDetailFetch(agent)

    render(<AgentDetailView agent={agent} project={null} projectId={null} projectBgs={[]} status="exited" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)

    expect(within(document.body).getByRole('tab', { name: 'Terminal', selected: true })).toBeInTheDocument()
    expect(within(document.body).getByRole('button', { name: 'Create window' })).toBeInTheDocument()
  })

  it('no longer offers Create window in the Details tab, which still reports "Window: missing"', () => {
    const agent: Agent = { ...baseAgent(null), id: 33, name: 'no-window-details-agent', state: 'exited', windowPresent: false }
    stubAgentDetailFetch(agent)

    render(<AgentDetailView agent={agent} project={null} projectId={null} projectBgs={[]} status="exited" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    fireEvent.click(within(document.body).getByRole('tab', { name: 'Details' }))

    const detailsPanel = within(document.body).getByRole('tabpanel', { name: 'Details' })
    expect(within(detailsPanel).queryByRole('button', { name: 'Create window' })).toBeNull()
    expect(within(detailsPanel).getByText('missing')).toBeInTheDocument()
  })

  it('omits the Create window button entirely when agent.windowPresent is true (TASK-0178)', () => {
    const agent: Agent = { ...baseAgent(null), id: 32, name: 'window-agent', windowPresent: true }
    stubAgentDetailFetch(agent)

    render(<AgentDetailView agent={agent} project={null} projectId={null} projectBgs={[]} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    fireEvent.click(within(document.body).getByRole('tab', { name: 'Details' }))

    expect(within(document.body).queryByRole('button', { name: 'Create window' })).toBeNull()
    expect(within(document.body).getByText('present')).toBeInTheDocument()
  })

  it('labels the Queued Tasks tab with the agent.queuedTasks count, including zero', () => {
    const zeroAgent: Agent = { ...baseAgent(null), id: 4, name: 'queued-zero-agent', queuedTasks: 0 }
    stubAgentDetailFetch(zeroAgent)
    const { unmount } = render(<AgentDetailView agent={zeroAgent} project={null} projectId={null} projectBgs={[]} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    const zeroDialog = document.body
    expect(within(zeroDialog).getByRole('tab', { name: 'Queued tasks (0)' })).toBeInTheDocument()
    unmount()

    const fiveAgent: Agent = { ...baseAgent(null), id: 5, name: 'queued-five-agent', queuedTasks: 5 }
    stubAgentDetailFetch(fiveAgent)
    render(<AgentDetailView agent={fiveAgent} project={null} projectId={null} projectBgs={[]} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    const fiveDialog = document.body
    expect(within(fiveDialog).getByRole('tab', { name: 'Queued tasks (5)' })).toBeInTheDocument()
  })

  it('renders the moved Details content — Command/Workdir fields and the ModeSwitcher — when the Details tab is selected', () => {
    const agent: Agent = { ...baseAgent(null), id: 6, name: 'details-content-agent', launchCmd: 'claude --resume', workdir: '/tmp/details-content' }
    stubAgentDetailFetch(agent)

    render(<AgentDetailView agent={agent} project={null} projectId={null} projectBgs={[]} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    const dialog = document.body
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Details' }))

    const panel = within(dialog).getByRole('tabpanel', { name: 'Details' })
    expect(within(panel).getByText('Command')).toBeInTheDocument()
    expect(within(panel).getByText('claude --resume')).toBeInTheDocument()
    expect(within(panel).getByText('Workdir')).toBeInTheDocument()
    expect(within(panel).getByText('/tmp/details-content')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Default' })).toBeInTheDocument()
  })

  it('renders TaskList and AddTaskForm when the Queued Tasks tab is selected', () => {
    const agent: Agent = { ...baseAgent(null), id: 7, name: 'queued-content-agent' }
    stubAgentDetailFetch(agent)

    render(<AgentDetailView agent={agent} project={null} projectId={null} projectBgs={[]} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    const dialog = document.body
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Queued tasks (0)' }))

    const panel = within(dialog).getByRole('tabpanel', { name: 'Queued tasks (0)' })
    expect(within(panel).getByText('No tasks in queue.')).toBeInTheDocument()
    expect(within(panel).getByLabelText('New task text')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Add task' })).toBeInTheDocument()
  })
})

// ── AgentDetailView (TASK-0172; overlay wrapper retired by TASK-0178) ──────
//
// AgentDetailView is mounted directly in the Agents page's main pane: no portal, backdrop or
// body scroll lock. LogTail's double-Escape is captured via mockLogTailHandlers (top of file).
describe('AgentDetailView LogTail double-Escape wiring (TASK-0172)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("wires LogTail's double-Escape onCloseModal to the view's onClose", async () => {
    const agent = baseAgent(null)
    stubAgentDetailFetch(agent)
    mockLogTailHandlers.onCloseModal = undefined
    const onViewClose = vi.fn()
    render(<AgentDetailView agent={agent} project={null} projectId={null} projectBgs={[]} status="idle" onClose={onViewClose} agentCount={1} onNavigate={vi.fn()} />)
    await screen.findByRole('tab', { name: 'Terminal' })
    act(() => { mockLogTailHandlers.onCloseModal?.() })
    expect(onViewClose).toHaveBeenCalledTimes(1)
  })
})

describe('AgentDetailView without overlay chrome (TASK-0172)', () => {
  it('has no dialog role, does not lock body scroll, and ignores Escape', () => {
    const agent = baseAgent(null)
    stubAgentDetailFetch(agent)
    const onClose = vi.fn()
    document.body.style.overflow = ''

    render(<AgentDetailView agent={agent} project={null} projectId={null} projectBgs={[]} status="idle" onClose={onClose} agentCount={1} onNavigate={vi.fn()} />)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Terminal' })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})

// The agent-cycling shortcut lives in AgentDetailView's document keydown handler and must stay
// inert while the user is typing in a text field (e.g. the inline rename input, the queue's
// add-task textarea) — Shift+Cmd+Arrow is also a native text-selection gesture there.
describe('AgentDetailView agent-cycling shortcut text-field guard (TASK-0172)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function renderView() {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')
    const agent = baseAgent(null)
    stubAgentDetailFetch(agent)
    const onNavigate = vi.fn()
    render(<AgentDetailView agent={agent} project={null} projectId={null} projectBgs={[]} status="idle" onClose={vi.fn()} agentCount={2} onNavigate={onNavigate} />)
    return onNavigate
  }

  it.each(['input', 'textarea'] as const)('ignores Shift+Cmd+Arrow fired from a focused <%s>, and still navigates from a non-text target', (tag) => {
    const onNavigate = renderView()

    const field = document.createElement(tag)
    document.body.appendChild(field)
    field.focus()
    fireEvent.keyDown(field, { key: 'ArrowRight', metaKey: true, shiftKey: true })
    fireEvent.keyDown(field, { key: 'ArrowLeft', metaKey: true, shiftKey: true })
    expect(onNavigate).not.toHaveBeenCalled()

    const nonText = document.createElement('div')
    document.body.appendChild(nonText)
    fireEvent.keyDown(nonText, { key: 'ArrowRight', metaKey: true, shiftKey: true })
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenLastCalledWith('next')
    fireEvent.keyDown(nonText, { key: 'ArrowLeft', metaKey: true, shiftKey: true })
    expect(onNavigate).toHaveBeenCalledTimes(2)
    expect(onNavigate).toHaveBeenLastCalledWith('prev')

    field.remove()
    nonText.remove()
  })
})

// ── AgentIdentityBadge (merged type + role pill, TASK-152 Step 3) ──────────
// AgentIdentityBadge is module-private (not exported) and only rendered inside
// AgentDetailModal (AgentItem's card view still renders the separate
// AgentTypeBadge/RoleBadge pair) — so, mirroring the AgentTypeBadge/RoleBadge
// pattern above, this asserts through the full AgentList render tree via the
// same stubAgentDetailFetch/MockActionsMenuEventSource helpers the actions-menu
// suite above uses to open the detail modal. The pill's `title` attribute is
// unique per case (no other dialog element shares it), so queries key off that
// rather than off visible text — the visible "Command" field in the modal also
// renders the raw launchCmd string (e.g. "claude"), which would otherwise
// collide with a plain getByText lookup.

describe('AgentIdentityBadge (merged type + role pill, TASK-152 Step 3)', () => {
  it('renders combined "type · role" text when both agent type and role resolve', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 1, name: 'identity-both', launchCmd: 'claude', role: 'frontend' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'identity-both detail' }))
    const dialog = await screen.findByRole('region', { name: 'identity-both detail' })

    const pill = within(dialog).getByTitle('Agent type: claude, Role: frontend')
    expect(pill).toHaveTextContent('claude · frontend')

    vi.unstubAllGlobals()
  })

  it('renders just the agent type when only the type resolves', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 2, name: 'identity-type-only', launchCmd: 'claude', role: null }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'identity-type-only detail' }))
    const dialog = await screen.findByRole('region', { name: 'identity-type-only detail' })

    const pill = within(dialog).getByTitle('Agent type: claude')
    expect(pill).toHaveTextContent('claude')

    vi.unstubAllGlobals()
  })

  it('renders just the role when only the role resolves', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 3, name: 'identity-role-only', launchCmd: 'aider', role: 'frontend' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'identity-role-only detail' }))
    const dialog = await screen.findByRole('region', { name: 'identity-role-only detail' })

    const pill = within(dialog).getByTitle('Role: frontend')
    expect(pill).toHaveTextContent('frontend')

    vi.unstubAllGlobals()
  })

  it('renders nothing when neither agent type nor role resolves', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 4, name: 'identity-none', launchCmd: 'aider', role: null }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'identity-none detail' }))
    const dialog = await screen.findByRole('region', { name: 'identity-none detail' })

    expect(within(dialog).queryByTitle(/^Agent type:|^Role:/)).toBeNull()

    vi.unstubAllGlobals()
  })

  it('leaves AgentItem\'s grid-card badges as two separate pills, unaffected by the header merge (TASK-152 out of scope)', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 5, name: 'grid-both', launchCmd: 'claude', role: 'frontend' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    await screen.findByText('grid-both')

    // The dialog is never opened in this test, so these titles can only come from
    // AgentItem's own AgentTypeBadge/RoleBadge pair rendered in the grid card — proving
    // the merge stayed scoped to AgentDetailModal's header, per TASK-152's Approach.
    expect(screen.getByTitle('Agent type: claude')).toHaveTextContent('claude')
    expect(screen.getByTitle('Role: frontend')).toHaveTextContent('frontend')
    expect(screen.queryByTitle(/^Agent type: claude, Role: frontend$/)).toBeNull()

    vi.unstubAllGlobals()
  })
})

// ── Modal header name/project emphasis + last-command row (TASK-154) ───────
// Reuses the stubAgentDetailFetch/MockActionsMenuEventSource helpers from the
// actions-menu suite above to open the detail modal, then asserts the header
// span classNames directly (Tailwind arbitrary-value classes double as the
// visual contract here) and the presence/absence of the activeTask row. The
// card's own ProjectBadge/agent-name renderings are scoped out via `container`
// (RTL's non-portaled render root) since AgentDetailModal renders through
// createPortal to document.body, alongside the card — both render the same
// "Unassigned"/name text, so an unscoped query would see both.

describe('AgentDetailModal header emphasis and last-command row (TASK-154)', () => {
  it('renders the agent name at 17px in the accent-blue color inside the modal header', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 1, name: 'header-emphasis-agent' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'header-emphasis-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'header-emphasis-agent detail' })

    const nameSpan = within(dialog).getByText('header-emphasis-agent')
    expect(nameSpan.className).toContain('text-[17px]')
    expect(nameSpan.className).toContain('text-accent-blue')

    vi.unstubAllGlobals()
  })

  it('renders the modal header ProjectBadge at the md (15px) size while the card badge stays at the default sm (13px) size', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 2, name: 'header-badge-agent', projectName: null }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'header-badge-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'header-badge-agent detail' })

    const modalBadge = within(dialog).getByTitle('No project assigned')
    expect(modalBadge.className).toContain('text-[15px]')
    expect(modalBadge.className).not.toContain('text-[13px]')

    // The pane now lives in the same render tree as the sidebar, so scope the card badge
    // to the sidebar rather than the whole container.
    const cardBadge = within(screen.getByRole('complementary', { name: 'Agents' })).getByTitle('No project assigned')
    expect(cardBadge.className).toContain('text-[13px]')
    expect(cardBadge.className).not.toContain('text-[15px]')

    vi.unstubAllGlobals()
  })

  it('shows the last-payload strip directly under the header when a payload is stored for the agent (TASK-0226)', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    __resetLastPayloadCacheForTests()
    const agent: Agent = { ...baseAgent(null), id: 3, name: 'active-task-agent', activeTask: null }
    saveLastPayload(3, { text: 'npm run build', ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'active-task-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'active-task-agent detail' })

    const row = within(dialog).getByTitle('npm run build')
    expect(row).toHaveTextContent('npm run build')
    expect(row.className).toContain('font-mono')
    expect(row.className).toContain('text-[11px]')

    vi.unstubAllGlobals()
  })

  it('renders no last-payload strip without a stored payload, even when agent.activeTask is set (TASK-0226)', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    __resetLastPayloadCacheForTests()
    const agent: Agent = { ...baseAgent(null), id: 4, name: 'no-active-task-agent', activeTask: 'npm run build' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'no-active-task-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'no-active-task-agent detail' })

    // activeTask alone no longer feeds the detail-pane strip (nor the sidebar card, TASK-0227).
    expect(within(dialog).queryByTitle('npm run build')).toBeNull()
    expect(within(dialog).queryByText('npm run build')).toBeNull()

    vi.unstubAllGlobals()
  })
})

// ── Detail-pane strip shows the last payload (TASK-0226) ────────────────────
//
// The strip under the detail header renders the stored last user payload for the open agent
// (useLastPayload(agent.id), lib/lastPayload.ts): first line + ' …' for multi-line, full capped text
// in `title`, nothing when empty. The real store is used; the module-level snapshot cache is reset
// per test (localStorage.clear() in the file-level beforeEach does not invalidate it). Queries are
// scoped to the detail region because the sidebar card shows the same payload text (TASK-0227).
describe('AgentDetailView last-payload strip (TASK-0226)', () => {
  beforeEach(() => {
    __resetLastPayloadCacheForTests()
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function openDetail(agent: Agent) {
    stubAgentDetailFetch(agent)
    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: `${agent.name} detail` }))
    return screen.findByRole('region', { name: `${agent.name} detail` })
  }

  it('shows the first line plus an ellipsis for a multi-line payload, with the whole text in title', async () => {
    const text = 'first line\nsecond line\nthird'
    saveLastPayload(51, { text, ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
    const dialog = await openDetail({ ...baseAgent(null), id: 51, name: 'strip-multiline-agent' })

    const strip = within(dialog).getByText('first line …')
    expect(strip.getAttribute('title')).toBe(text)
  })

  it('displays a payload seeded before mount on first render and again after a simulated reload', async () => {
    localStorage.setItem('conductor:lastPayload:52', JSON.stringify({ text: 'seeded prompt', ts: '2026-09-20T10:00:00.000Z', source: 'hook' }))
    const agent: Agent = { ...baseAgent(null), id: 52, name: 'strip-reload-agent' }
    const dialog = await openDetail(agent)
    expect(within(dialog).getByTitle('seeded prompt')).toHaveTextContent('seeded prompt')

    cleanup()
    __resetLastPayloadCacheForTests()
    const reloaded = await openDetail(agent)
    expect(within(reloaded).getByTitle('seeded prompt')).toHaveTextContent('seeded prompt')
  })

  it('updates when the store changes while mounted, and ignores a payload stored for another agent', async () => {
    saveLastPayload(53, { text: 'first prompt', ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
    const dialog = await openDetail({ ...baseAgent(null), id: 53, name: 'strip-live-agent' })
    expect(within(dialog).getByTitle('first prompt')).toBeInTheDocument()

    act(() => { saveLastPayload(53, { text: 'newer prompt', ts: '2026-09-20T11:00:00.000Z', source: 'add-task' }) })
    await waitFor(() => { expect(within(dialog).getByTitle('newer prompt')).toHaveTextContent('newer prompt') })
    expect(within(dialog).queryByTitle('first prompt')).toBeNull()

    act(() => { saveLastPayload(999, { text: 'other agent prompt', ts: '2026-09-20T12:00:00.000Z', source: 'hook' }) })
    expect(within(dialog).queryByText('other agent prompt')).toBeNull()
    expect(within(dialog).queryByTitle('other agent prompt')).toBeNull()
  })

  it('truncates a long single-line payload with CSS and keeps the full text in title', async () => {
    const text = `long-${'x'.repeat(250)}`
    saveLastPayload(54, { text, ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
    const dialog = await openDetail({ ...baseAgent(null), id: 54, name: 'strip-long-agent' })

    const strip = within(dialog).getByTitle(text)
    expect(strip.className).toContain('truncate')
    expect(strip).toHaveTextContent(text)
  })
})

// ── Sidebar card shows the last payload (TASK-0227) ─────────────────────────
//
// The compact sidebar card renders the stored last user payload (useLastPayload(agent.id)) in the
// slot that used to show agent.activeTask: single-line truncated, first line for multi-line text,
// full text in `title`, nothing when no payload is stored. Queries are scoped to the sidebar
// (role 'complementary', name 'Agents') because the detail strip shows the same text. The real
// store is used; the module-level snapshot cache is reset per test.
describe('AgentList sidebar card last payload (TASK-0227)', () => {
  beforeEach(() => {
    __resetLastPayloadCacheForTests()
    setSidebarCollapsed(false)
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setSidebarCollapsed(false)
  })

  function stubStatusWithAgents(agents: Agent[]) {
    stubAgentDetailFetch(agents[0] ?? baseAgent(null), (url) => {
      if (url.endsWith('/status')) {
        return {
          ok: true,
          json: () => ({
            session: 'test-session', sessionAlive: true, sessionExists: true,
            agents, bgProcesses: [], timestamp: new Date().toISOString(),
          }),
        }
      }
      return null
    })
  }

  async function renderSidebar(agents: Agent[]) {
    stubStatusWithAgents(agents)
    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: `${agents[0]?.name ?? ''} detail` })
    return sidebar
  }

  it('shows a stored payload on the card as a truncated mono line with the full text in title', async () => {
    const text = `card-${'y'.repeat(250)}`
    saveLastPayload(81, { text, ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
    const sidebar = await renderSidebar([{ ...baseAgent(null), id: 81, name: 'card-long-agent' }])

    const line = within(sidebar).getByTitle(text)
    expect(line).toHaveTextContent(text)
    expect(line.className).toContain('truncate')
    expect(line.className).toContain('block')
    expect(line.className).toContain('font-mono')
    expect(line.className).toContain('text-[10px]')
  })

  it('shows only the first line plus an ellipsis for a multi-line payload, whole text in title', async () => {
    const text = 'card first line\nsecond line\nthird'
    saveLastPayload(82, { text, ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
    const sidebar = await renderSidebar([{ ...baseAgent(null), id: 82, name: 'card-multiline-agent' }])

    const line = within(sidebar).getByText('card first line …')
    expect(line.getAttribute('title')).toBe(text)
    expect(within(sidebar).queryByText(/second line/)).toBeNull()
  })

  it('renders no payload line without a stored payload, even when agent.activeTask is set', async () => {
    const sidebar = await renderSidebar([
      { ...baseAgent(null), id: 83, name: 'card-empty-agent', activeTask: 'npm run build' },
    ])

    // activeTask stays in the Agent contract but is no longer displayed in the card.
    expect(within(sidebar).queryByText('npm run build')).toBeNull()
    expect(within(sidebar).queryByTitle('npm run build')).toBeNull()
  })

  it('does not show activeTask on the card when a payload is stored; the payload wins', async () => {
    saveLastPayload(84, { text: 'stored payload', ts: '2026-09-20T10:00:00.000Z', source: 'add-task' })
    const sidebar = await renderSidebar([
      { ...baseAgent(null), id: 84, name: 'card-both-agent', activeTask: 'transient task' },
    ])

    expect(within(sidebar).getByTitle('stored payload')).toHaveTextContent('stored payload')
    expect(within(sidebar).queryByText('transient task')).toBeNull()
  })

  it('keeps separate payloads per agent and updates a single card when the store changes', async () => {
    saveLastPayload(85, { text: 'payload for one', ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
    saveLastPayload(86, { text: 'payload for two', ts: '2026-09-20T10:00:00.000Z', source: 'add-task' })
    const sidebar = await renderSidebar([
      { ...baseAgent(null), id: 85, name: 'card-one' },
      { ...baseAgent(null), id: 86, name: 'card-two' },
    ])

    const cardOne = within(sidebar).getByRole('button', { name: 'card-one detail' })
    const cardTwo = within(sidebar).getByRole('button', { name: 'card-two detail' })
    expect(within(cardOne).getByTitle('payload for one')).toBeInTheDocument()
    expect(within(cardOne).queryByTitle('payload for two')).toBeNull()
    expect(within(cardTwo).getByTitle('payload for two')).toBeInTheDocument()
    expect(within(cardTwo).queryByTitle('payload for one')).toBeNull()

    act(() => { saveLastPayload(85, { text: 'newer for one', ts: '2026-09-20T11:00:00.000Z', source: 'hook' }) })
    await waitFor(() => { expect(within(cardOne).getByTitle('newer for one')).toBeInTheDocument() })
    expect(within(cardOne).queryByTitle('payload for one')).toBeNull()
    expect(within(cardTwo).getByTitle('payload for two')).toBeInTheDocument()
  })

  it('collapsed 48px rail renders dots only, with no payload text or title', async () => {
    saveLastPayload(87, { text: 'rail hidden payload', ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
    const sidebar = await renderSidebar([{ ...baseAgent(null), id: 87, name: 'rail-payload-agent' }])
    expect(within(sidebar).getByTitle('rail hidden payload')).toBeInTheDocument()

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Collapse sidebar' }))

    expect(sidebar.style.width).toBe('48px')
    expect(within(sidebar).getByRole('button', { name: 'rail-payload-agent' })).toBeInTheDocument()
    expect(within(sidebar).queryByText('rail hidden payload')).toBeNull()
    expect(within(sidebar).queryByTitle('rail hidden payload')).toBeNull()
  })
})

// UAT-0227 edge cases the six cases above do not pin: a whitespace-only stored payload renders no
// card line (the task's "empty/whitespace" rule), and a store update for one agent neither re-reads
// storage for nor replaces the DOM line of an unaffected card (snapshot stability with many cards).
describe('AgentList sidebar card last payload (TASK-0227) UAT edge cases', () => {
  beforeEach(() => {
    __resetLastPayloadCacheForTests()
    setSidebarCollapsed(false)
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    setSidebarCollapsed(false)
  })

  async function renderSidebar(agents: Agent[]) {
    stubAgentDetailFetch(agents[0] ?? baseAgent(null), (url) => {
      if (url.endsWith('/status')) {
        return {
          ok: true,
          json: () => ({
            session: 'test-session', sessionAlive: true, sessionExists: true,
            agents, bgProcesses: [], timestamp: new Date().toISOString(),
          }),
        }
      }
      return null
    })
    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: `${agents[0]?.name ?? ''} detail` })
    return sidebar
  }

  it('renders no payload line for a whitespace-only stored payload, even when activeTask is set', async () => {
    // saveLastPayload rejects blank text, so seed the raw key the way a corrupt/older write would.
    localStorage.setItem(
      'conductor:lastPayload:91',
      JSON.stringify({ text: '  \n \t ', ts: '2026-09-20T10:00:00.000Z', source: 'hook' }),
    )
    const sidebar = await renderSidebar([
      { ...baseAgent(null), id: 91, name: 'card-blank-agent', activeTask: 'npm run build' },
    ])

    const card = within(sidebar).getByRole('button', { name: 'card-blank-agent detail' })
    expect(card.querySelector('span.font-mono.truncate')).toBeNull()
    expect(within(card).queryByText('npm run build')).toBeNull()
  })

  it('a store update for one agent does not re-read storage for, or replace the line of, the other card', async () => {
    saveLastPayload(92, { text: 'stable one', ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
    saveLastPayload(93, { text: 'stable two', ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
    const sidebar = await renderSidebar([
      { ...baseAgent(null), id: 92, name: 'card-stable-one' },
      { ...baseAgent(null), id: 93, name: 'card-stable-two' },
    ])
    const cardTwo = within(sidebar).getByRole('button', { name: 'card-stable-two detail' })
    const lineTwoBefore = within(cardTwo).getByTitle('stable two')

    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    act(() => { saveLastPayload(92, { text: 'updated one', ts: '2026-09-20T11:00:00.000Z', source: 'hook' }) })
    await waitFor(() => {
      expect(within(sidebar).getByTitle('updated one')).toBeInTheDocument()
    })

    expect(within(cardTwo).getByTitle('stable two')).toBe(lineTwoBefore)
    const readKeys = getItem.mock.calls.map(([key]) => key)
    expect(readKeys).toContain('conductor:lastPayload:92')
    expect(readKeys).not.toContain('conductor:lastPayload:93')
  })
})

// ── SSE delivery stubs + agent-removed handling ─────────────────────────────
//
// AgentList reacts to `agent-update`/`agent-removed` inside its own SSE handlers. Unlike
// the no-op MockEventSource stubs used elsewhere in this file (which only need
// `new EventSource(...)` to not throw, because those tests never exercise SSE
// delivery), the tests that drive those handlers need a stub that actually captures and
// can re-invoke the listeners useSSE.ts's `attachListener` registers via
// `addEventListener`, so a test can synthesize the same MessageEvent shape the real
// `/events` stream would deliver. `capturedEventSource` is reset per-test in `beforeEach`
// in each describe that uses it (mirroring
// how useSSE.ts's own module-level `source` singleton is torn down and reopened
// between tests once the last subscriber unmounts via this file's top-level
// `afterEach(() => cleanup())`).
let capturedEventSource: CapturingEventSource | null = null

class CapturingEventSource {
  listenersByType = new Map<string, Set<(e: MessageEvent) => void>>()

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- captured for fireSSE() below to dispatch through later
    capturedEventSource = this
  }

  addEventListener(type: string, listener: (e: MessageEvent) => void) {
    let set = this.listenersByType.get(type)
    if (!set) {
      set = new Set()
      this.listenersByType.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: (e: MessageEvent) => void) {
    this.listenersByType.get(type)?.delete(listener)
  }

  close() { /* no-op */ }
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- kept explicit so call sites read as typed SSE payloads
function fireSSE<T>(type: string, payload: T) {
  const event = { data: JSON.stringify(payload) } as MessageEvent
  const listeners = capturedEventSource?.listenersByType.get(type)
  if (!listeners) return
  for (const listener of [...listeners]) listener(event)
}

// Transitioning into `awaiting`/`stalled` from a `busy`/`starting` prevStatus makes
// AgentList's own agent-update handler call `new AudioContext()` to play a doorbell
// (see needsAttention/playDoorbell in AgentList.tsx) — jsdom has no real AudioContext,
// so without a stub the very first busy→awaiting transition in a test that fires one would
// throw. Concrete no-op nodes (not a Proxy/`any`) matching exactly the calls
// playDoorbell makes (`createGain`, `createOscillator`, `.gain`/`.frequency`
// param setters, `.connect`/`.start`/`.stop`) — `state: 'running'` skips the
// resume()-then-play async branch entirely, so playback happens synchronously inside
// the `act()` wrapper below with no dangling promise.
function mockAudioParam() {
  return { setValueAtTime: () => { /* no-op */ }, linearRampToValueAtTime: () => { /* no-op */ }, exponentialRampToValueAtTime: () => { /* no-op */ } }
}
class MockAudioContext {
  state: AudioContextState = 'running'
  currentTime = 0
  destination = {}
  createGain() { return { gain: mockAudioParam(), connect: () => { /* no-op */ } } }
  createOscillator() { return { type: '', frequency: mockAudioParam(), connect: () => { /* no-op */ }, start: () => { /* no-op */ }, stop: () => { /* no-op */ } } }
  resume() { return Promise.resolve() }
  close() { return Promise.resolve() }
}

describe('AgentList agent-removed SSE handling (TASK-0173)', () => {
  beforeEach(() => {
    capturedEventSource = null
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('agent-removed for the selected agent returns the pane to the empty state (TASK-0173)', async () => {
    const agent: Agent = { ...baseAgent(null), id: 9, name: 'selected-removed-agent', state: 'busy' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'selected-removed-agent detail' }))
    await screen.findByRole('region', { name: 'selected-removed-agent detail' })

    act(() => { fireSSE('agent-removed', { id: 9 }) })

    expect(screen.queryByRole('region', { name: 'selected-removed-agent detail' })).toBeNull()
    expect(screen.getByText('Select an agent from the sidebar')).toBeInTheDocument()

    // The selection does not resurrect when an agent with the same id comes back.
    act(() => { fireSSE('agent-update', agent) })
    await screen.findByRole('button', { name: 'selected-removed-agent detail' })
    expect(screen.queryByRole('region', { name: 'selected-removed-agent detail' })).toBeNull()
  })
})

// Sound policy: the doorbell rings only when an agent switches INTO a needs-input state
// (awaiting/stalled). Completion (busy -> idle/empty) and every other transition is silent.
describe('AgentList status-change sound', () => {
  let oscillatorsCreated = 0
  class CountingAudioContext extends MockAudioContext {
    override createOscillator() {
      oscillatorsCreated += 1
      return super.createOscillator()
    }
  }

  beforeEach(() => {
    capturedEventSource = null
    oscillatorsCreated = 0
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', CountingAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function renderWithBusyAgent() {
    const agent: Agent = { ...baseAgent(null), id: 301, name: 'sound-agent', state: 'busy' }
    stubAgentDetailFetch(agent)
    render(<AgentList />)
    await screen.findByRole('button', { name: 'sound-agent detail' })
    return agent
  }

  it('rings when an agent switches to awaiting', async () => {
    const agent = await renderWithBusyAgent()
    act(() => { fireSSE('agent-update', { ...agent, state: 'awaiting' }) })
    expect(oscillatorsCreated).toBe(2)
  })

  it('rings when an agent switches to stalled', async () => {
    const agent = await renderWithBusyAgent()
    act(() => { fireSSE('agent-update', { ...agent, state: 'stalled' }) })
    expect(oscillatorsCreated).toBe(2)
  })

  it('is silent when an agent finishes (busy -> idle)', async () => {
    const agent = await renderWithBusyAgent()
    act(() => { fireSSE('agent-update', { ...agent, state: 'idle' }) })
    expect(oscillatorsCreated).toBe(0)
  })

  it('is silent on a repeat update while already awaiting', async () => {
    const agent = await renderWithBusyAgent()
    act(() => { fireSSE('agent-update', { ...agent, state: 'awaiting' }) })
    oscillatorsCreated = 0
    act(() => { fireSSE('agent-update', { ...agent, state: 'awaiting' }) })
    expect(oscillatorsCreated).toBe(0)
  })

  it('is silent for a first-seen agent that arrives already awaiting', async () => {
    await renderWithBusyAgent()
    act(() => { fireSSE('agent-update', { ...baseAgent(null), id: 302, name: 'new-agent', state: 'awaiting' }) })
    expect(oscillatorsCreated).toBe(0)
  })
})

// ── Detail-pane strip: navigation, placement and SSE mirror (TASK-0226 UAT) ──
//
// Gap-closing cases added by /uat-generate for UAT-0226: the strip is keyed per agent id while the
// pane cycles between agents (no leakage, hook order stable across payload -> none -> payload), it
// keeps the documented full-width class string directly under the header, a payload wins over a
// simultaneously set activeTask, and an SSE `agent-update` carrying `lastPrompt` (TASK-0225 mirror)
// lights the strip live. The real store is used; the snapshot cache is reset per test.
describe('AgentDetailView last-payload strip: navigation, placement and SSE mirror (TASK-0226 UAT)', () => {
  const STRIP_CLASSES = 'flex-shrink-0 border-b border-line bg-canvas/50 px-5 py-1.5 font-mono text-[11px] text-muted-2 truncate'

  beforeEach(() => {
    capturedEventSource = null
    __resetLastPayloadCacheForTests()
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function stubStatusWithAgents(agents: Agent[]) {
    stubAgentDetailFetch(agents[0] ?? baseAgent(null), (url) => {
      if (url.endsWith('/status')) {
        return {
          ok: true,
          json: () => ({
            session: 'test-session', sessionAlive: true, sessionExists: true,
            agents, bgProcesses: [], timestamp: new Date().toISOString(),
          }),
        }
      }
      return null
    })
  }

  async function openAgentNamed(name: string) {
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    fireEvent.click(await within(sidebar).findByRole('button', { name: `${name} detail` }))
    return screen.findByRole('region', { name: `${name} detail` })
  }

  it('keys the strip per agent id while cycling: no leakage between agents and no hook-order error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { /* keep output clean; asserted below */ })
    saveLastPayload(61, { text: 'payload for A', ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
    saveLastPayload(63, { text: 'c first\nc second', ts: '2026-09-20T10:00:00.000Z', source: 'add-task' })
    stubStatusWithAgents([
      { ...baseAgent(null), id: 61, name: 'nav-a-agent' },
      { ...baseAgent(null), id: 62, name: 'nav-b-agent' },
      { ...baseAgent(null), id: 63, name: 'nav-c-agent' },
    ])

    render(<AgentList />)
    const paneA = await openAgentNamed('nav-a-agent')
    expect(within(paneA).getByTitle('payload for A')).toHaveTextContent('payload for A')

    // A -> B (no payload): A's payload must not leak into B's pane; no strip at all.
    fireEvent.click(within(paneA).getByRole('button', { name: 'Next agent' }))
    const paneB = await screen.findByRole('region', { name: 'nav-b-agent detail' })
    expect(within(paneB).queryByTitle('payload for A')).toBeNull()
    expect(within(paneB).queryByText('payload for A')).toBeNull()
    expect(within(paneB).queryByText('c first …')).toBeNull()

    // B -> C: C's own multi-line payload shows, A's does not.
    fireEvent.click(within(paneB).getByRole('button', { name: 'Next agent' }))
    const paneC = await screen.findByRole('region', { name: 'nav-c-agent detail' })
    expect(within(paneC).getByText('c first …').getAttribute('title')).toBe('c first\nc second')
    expect(within(paneC).queryByTitle('payload for A')).toBeNull()

    // C -> B -> A: back to none, then A's payload returns.
    fireEvent.click(within(paneC).getByRole('button', { name: 'Previous agent' }))
    const paneB2 = await screen.findByRole('region', { name: 'nav-b-agent detail' })
    expect(within(paneB2).queryByText('c first …')).toBeNull()
    fireEvent.click(within(paneB2).getByRole('button', { name: 'Previous agent' }))
    const paneA2 = await screen.findByRole('region', { name: 'nav-a-agent detail' })
    expect(within(paneA2).getByTitle('payload for A')).toBeInTheDocument()

    // Rendering payload -> none -> payload never trips React's hook-order / hook-count error.
    const hookErrors = consoleError.mock.calls.filter((args) => /hook/i.test(args.map(String).join(' ')))
    expect(hookErrors).toEqual([])
  })

  it('renders the strip full width with the documented class string, directly under the header', async () => {
    saveLastPayload(64, { text: 'placement payload', ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
    stubStatusWithAgents([{ ...baseAgent(null), id: 64, name: 'placement-agent' }])

    render(<AgentList />)
    const pane = await openAgentNamed('placement-agent')

    const strip = within(pane).getByTitle('placement payload')
    expect(strip.className).toBe(STRIP_CLASSES)
    // Full width: a plain block child, no width constraint classes of its own.
    expect(strip.className).not.toMatch(/(^|\s)(w-|max-w-|inline)/)
    // Directly under the header: the preceding sibling is the header that holds the agent name.
    expect(strip.previousElementSibling).not.toBeNull()
    expect(strip.previousElementSibling).toHaveTextContent('placement-agent')
  })

  it('shows the stored payload, not agent.activeTask, when both are present in the detail pane', async () => {
    saveLastPayload(65, { text: 'stored last payload', ts: '2026-09-20T10:00:00.000Z', source: 'add-task' })
    stubStatusWithAgents([{ ...baseAgent(null), id: 65, name: 'both-agent', state: 'busy', activeTask: 'transient active task' }])

    render(<AgentList />)
    const pane = await openAgentNamed('both-agent')

    expect(within(pane).getByTitle('stored last payload')).toHaveTextContent('stored last payload')
    expect(within(pane).queryByText('transient active task')).toBeNull()
    expect(within(pane).queryByTitle('transient active task')).toBeNull()
  })

  it('lights the strip live when an SSE agent-update carries lastPrompt (TASK-0225 mirror), and keeps it when a later update omits it', async () => {
    const agent: Agent = { ...baseAgent(null), id: 66, name: 'sse-strip-agent' }
    stubStatusWithAgents([agent])

    render(<AgentList />)
    const pane = await openAgentNamed('sse-strip-agent')
    expect(within(pane).queryByTitle('from the hook')).toBeNull()

    act(() => { fireSSE('agent-update', { ...agent, lastPrompt: { text: 'from the hook', ts: '2026-09-20T10:00:00.000Z' } }) })
    await waitFor(() => { expect(within(pane).getByTitle('from the hook')).toHaveTextContent('from the hook') })

    // Idle transition without lastPrompt (partial update) must not clear the retained payload.
    act(() => { fireSSE('agent-update', { ...agent, state: 'busy' }) })
    act(() => { fireSSE('agent-update', { ...agent, state: 'idle' }) })
    expect(within(pane).getByTitle('from the hook')).toBeInTheDocument()
  })
})

// ── Bg processes sharing a name across projects (TASK-0196) ─────────────────
//
// `bg_processes.name` is unique per project, not globally, so two projects can each own a
// `dev` process. The addressable identity is the derived slug `<projectName>-<name>`: React
// keys, REST paths and the `bg-removed` SSE match all use it, while `name` stays the label.
describe('AgentList bg processes sharing a name across projects (TASK-0196)', () => {
  const bgAlpha: BgProcess = {
    slug: 'alpha-dev',
    name: 'dev',
    workdir: '/tmp/alpha',
    launchCmd: 'npm run dev:alpha',
    windowPresent: true,
    state: null,
    logPath: '/tmp/bg-alpha-dev.log',
    statePath: '/tmp/bg-alpha-dev.state',
    projectId: 1,
    projectName: 'alpha',
  }
  const bgBeta: BgProcess = {
    ...bgAlpha,
    slug: 'beta-dev',
    workdir: '/tmp/beta',
    launchCmd: 'npm run dev:beta',
    logPath: '/tmp/bg-beta-dev.log',
    statePath: '/tmp/bg-beta-dev.state',
    projectId: 2,
    projectName: 'beta',
  }
  const projects = [
    { id: 1, name: 'alpha', workdir: '/tmp/alpha', defaultLaunchCmd: 'claude', createdAt: new Date().toISOString() },
    { id: 2, name: 'beta', workdir: '/tmp/beta', defaultLaunchCmd: 'claude', createdAt: new Date().toISOString() },
  ]
  let bgCalls: { url: string; method: string }[] = []

  beforeEach(() => {
    capturedEventSource = null
    bgCalls = []
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/bg-processes/')) {
        bgCalls.push({ url, method: init?.method ?? 'GET' })
        if (init?.method === 'PATCH') {
          return Promise.resolve({
            ok: true,
            json: () => ({ id: 2, name: 'dev', workdir: '/tmp/beta-after', launchCmd: 'npm run dev:beta', projectId: 2 }),
          })
        }
        return Promise.resolve({ ok: true, json: () => ({ ok: true }) })
      }
      if (url.includes('/projects')) {
        return Promise.resolve({ ok: true, json: () => projects })
      }
      return Promise.resolve({
        ok: true,
        json: () => ({
          session: 'test-session', sessionAlive: true, sessionExists: true,
          agents: [{ ...baseAgent(null), id: 1, name: 'solo-agent' }],
          bgProcesses: [bgAlpha, bgBeta],
          timestamp: new Date().toISOString(),
        }),
      })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders two rows with the same name, distinguished by a slug detail', async () => {
    render(<AgentList />)
    expect(await screen.findAllByText('dev')).toHaveLength(2)
    expect(screen.getByText('alpha-dev')).toBeInTheDocument()
    expect(screen.getByText('beta-dev')).toBeInTheDocument()
  })

  it('Remove hits DELETE /bg-processes/:slug for the clicked row only', async () => {
    render(<AgentList />)
    await screen.findAllByText('dev')

    // Rows sort by project name: alpha first, beta second.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1] as HTMLElement)
    // The ConfirmDialog renders inside the row, so its confirm button is the last "Remove".
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
    fireEvent.click(removeButtons[removeButtons.length - 1] as HTMLElement)

    await waitFor(() => { expect(bgCalls).toHaveLength(1) })
    expect(bgCalls[0]?.method).toBe('DELETE')
    expect(bgCalls[0]?.url.endsWith('/bg-processes/beta-dev')).toBe(true)
  })

  it('Close window hits DELETE /bg-processes/:slug/window for the clicked row only', async () => {
    render(<AgentList />)
    await screen.findAllByText('dev')

    fireEvent.click(screen.getAllByRole('button', { name: 'Close window' })[0] as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))

    await waitFor(() => { expect(bgCalls).toHaveLength(1) })
    expect(bgCalls[0]?.method).toBe('DELETE')
    expect(bgCalls[0]?.url.endsWith('/bg-processes/alpha-dev/window')).toBe(true)
  })

  // Fold-in from the TASK-0196 handoff: a bare `dev` in a confirm dialog is ambiguous when two
  // projects each own one, so every bg confirm dialog shows the project alongside the name.
  it('Remove and Close-window confirm dialogs name the project, not just the bare process name', async () => {
    render(<AgentList />)
    await screen.findAllByText('dev')

    // Rows sort by project name: alpha first, beta second.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0] as HTMLElement)
    expect(screen.getByText(/Remove background process "dev" \(project alpha\)\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getAllByRole('button', { name: 'Close window' })[1] as HTMLElement)
    expect(screen.getByText(/Close the window of "dev" \(project beta\)\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(bgCalls).toHaveLength(0)
  })

  it('shows Restart on a tile only while its window is present, and confirms with the project named', async () => {
    render(<AgentList />)
    await screen.findAllByText('dev')
    expect(screen.getAllByRole('button', { name: 'Restart dev' })).toHaveLength(2)

    // beta loses its window: the tile falls back to "Open window", with no duplicate Start.
    act(() => { fireSSE('bg-update', { ...bgBeta, windowPresent: false }) })
    expect(screen.getAllByRole('button', { name: 'Restart dev' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Start dev' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Open window' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Restart dev' }))
    expect(screen.getByText('Restart "dev" (project alpha)?')).toBeInTheDocument()
    expect(bgCalls).toHaveLength(0)
  })

  it('confirming Restart POSTs /bg-processes/:slug/restart for that row and optimistically flips its badge to running', async () => {
    render(<AgentList />)
    await screen.findAllByText('dev')
    act(() => { fireSSE('bg-update', { ...bgAlpha, liveness: 'exited' }) })
    expect(screen.getByText('exited')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Restart dev' })[0] as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))

    await waitFor(() => { expect(bgCalls).toHaveLength(1) })
    expect(bgCalls[0]?.method).toBe('POST')
    expect(bgCalls[0]?.url.endsWith('/bg-processes/alpha-dev/restart')).toBe(true)
    await waitFor(() => { expect(screen.queryByText('exited')).toBeNull() })
    expect(screen.getAllByText('running')).toHaveLength(2)
  })

  // UAT-0206: the task places the tile's Restart between Edit and Close window.
  it('places the tile Restart button between Edit and Close window', async () => {
    render(<AgentList />)
    await screen.findAllByText('dev')

    const actions = (screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement).parentElement as HTMLElement
    const names = within(actions).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(names.slice(0, 3)).toEqual(['Edit', 'Restart dev', 'Close window'])
  })

  // UAT-0206: a failed restart must surface the mapped message and must NOT optimistically flip the badge.
  it('a failed tile Restart shows the mapped error inline and leaves the badge unchanged', async () => {
    render(<AgentList />)
    await screen.findAllByText('dev')
    act(() => { fireSSE('bg-update', { ...bgAlpha, liveness: 'exited' }) })
    expect(screen.getByText('exited')).toBeInTheDocument()

    const baseFetch = vi.mocked(fetch).getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>
    vi.mocked(fetch).mockImplementation(((url: string, init?: RequestInit) => (
      url.endsWith('/restart')
        ? Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({}) })
        : baseFetch(url, init)
    )) as typeof fetch)

    fireEvent.click(screen.getAllByRole('button', { name: 'Restart dev' })[0] as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The conductor tmux session is not running')
    expect(screen.getByText('exited')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Restart dev' })[0]).toBeEnabled()
  })

  it('saving an edit PATCHes /bg-processes/:slug and updates only that row', async () => {
    render(<AgentList />)
    await screen.findAllByText('dev')

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1] as HTMLElement)
    fireEvent.change(await screen.findByDisplayValue('/tmp/beta'), { target: { value: '/tmp/beta-after' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByTitle('npm run dev:beta (in /tmp/beta-after)')).toBeInTheDocument()
    expect(bgCalls).toHaveLength(1)
    expect(bgCalls[0]?.method).toBe('PATCH')
    expect(bgCalls[0]?.url.endsWith('/bg-processes/beta-dev')).toBe(true)
    // The other same-named row is untouched.
    expect(screen.getByTitle('npm run dev:alpha (in /tmp/alpha)')).toBeInTheDocument()
  })

  it('bg-removed removes only the row whose slug matches, not every row with that name', async () => {
    render(<AgentList />)
    expect(await screen.findAllByText('dev')).toHaveLength(2)

    act(() => { fireSSE('bg-removed', { slug: 'alpha-dev', name: 'dev' }) })

    expect(screen.getAllByText('dev')).toHaveLength(1)
    expect(screen.queryByText('alpha-dev')).toBeNull()
    expect(screen.getByText('beta-dev')).toBeInTheDocument()
  })

  it('bg-update merges by slug: it updates the matching row and does not clobber its same-named sibling', async () => {
    render(<AgentList />)
    expect(await screen.findAllByText('dev')).toHaveLength(2)

    act(() => { fireSSE('bg-update', { ...bgBeta, windowPresent: false }) })

    expect(screen.getAllByText('dev')).toHaveLength(2)
    // Only beta's window went missing. The fixture carries no `liveness`, so the badge falls
    // back to windowPresent: absent window -> 'stopped' (TASK-0205 replaced 'window missing').
    expect(screen.getAllByText('stopped')).toHaveLength(1)
    expect(screen.getAllByText('running')).toHaveLength(1)
  })
})

// ── Agent detail Background tab (TASK-0205) ─────────────────────────────────
//
// The Background tab lists the bg processes owned by the selected agent's project (from the
// live `bgs` list already in AgentList state) and is omitted when the agent has no project.
// `bgTail` is stubbed at module scope, so the tab's output polling never touches the network.
describe('AgentList Background tab (TASK-0205)', () => {
  function makeBg(overrides: Partial<BgProcess> & { slug: string; projectId: number; projectName: string }): BgProcess {
    return {
      name: overrides.slug,
      workdir: `/tmp/${overrides.projectName}`,
      launchCmd: `run ${overrides.slug}`,
      windowPresent: true,
      state: null,
      logPath: `/tmp/bg-${overrides.slug}.log`,
      statePath: `/tmp/bg-${overrides.slug}.state`,
      ...overrides,
    }
  }
  const alphaWeb = makeBg({ slug: 'alpha-web', name: 'web', projectId: 1, projectName: 'alpha', liveness: 'running' })
  const alphaApi = makeBg({ slug: 'alpha-api', name: 'api', projectId: 1, projectName: 'alpha', liveness: 'exited' })
  const betaDev = makeBg({ slug: 'beta-dev', name: 'dev', projectId: 2, projectName: 'beta', liveness: 'running' })

  const alphaAgent: Agent = { ...baseAgent(null), id: 41, name: 'alpha-agent', projectId: 1, projectName: 'alpha' }
  const loneAgent: Agent = { ...baseAgent(null), id: 42, name: 'lone-agent', projectId: null, projectName: null }

  function stubStatus(agents: Agent[], bgProcesses: BgProcess[]) {
    stubAgentDetailFetch(agents[0] ?? baseAgent(null), (url) => {
      if (url.endsWith('/status')) {
        return {
          ok: true,
          json: () => ({
            session: 'test-session', sessionAlive: true, sessionExists: true,
            agents, bgProcesses, timestamp: new Date().toISOString(),
          }),
        }
      }
      if (url.endsWith('/restart')) {
        return { ok: true, json: () => ({ ok: true, name: 'alpha-api', restartedAt: '2026-09-20T10:00:00.000Z', mechanism: 'respawn-window' }) }
      }
      return null
    })
  }

  beforeEach(() => {
    capturedEventSource = null
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', MockAudioContext)
    bgTailMock.mockReset()
    bgTailMock.mockResolvedValue({
      slug: 'alpha-api', name: 'api', lines: ['server crashed'], truncated: false,
      sizeBytes: 14, logPath: '/tmp/bg-alpha-api.log', updatedAt: new Date().toISOString(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a "Background (N)" tab counting the agent\'s project bg processes', async () => {
    stubStatus([alphaAgent], [alphaWeb, alphaApi, betaDev])

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'alpha-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'alpha-agent detail' })

    expect(within(dialog).getByRole('tab', { name: 'Background (2)' })).toBeInTheDocument()
  })

  it('lists only the selected agent\'s own project bgs (with liveness badges) when two projects have processes', async () => {
    stubStatus([alphaAgent], [alphaWeb, alphaApi, betaDev])

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'alpha-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'alpha-agent detail' })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Background (2)' }))

    const section = await within(dialog).findByRole('region', { name: 'Background processes' })
    const webRow = within(section).getByRole('button', { name: /alpha-web/ })
    const apiRow = within(section).getByRole('button', { name: /alpha-api/ })
    expect(within(webRow).getByText('running')).toBeInTheDocument()
    expect(within(apiRow).getByText('exited')).toBeInTheDocument()
    expect(within(section).queryByText('beta-dev')).toBeNull()
    // The exited process is preselected, and its output is requested once the tab is active.
    expect(apiRow).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => { expect(bgTailMock).toHaveBeenCalledWith('alpha-api', 200) })
    expect(bgTailMock).not.toHaveBeenCalledWith('beta-dev', expect.anything())
    expect(await within(section).findByText('server crashed')).toBeInTheDocument()
  })

  it('does not poll the output until the Background tab is the active one', async () => {
    stubStatus([alphaAgent], [alphaWeb, alphaApi])

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'alpha-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'alpha-agent detail' })
    expect(within(dialog).getByRole('tab', { name: 'Background (2)' })).toBeInTheDocument()
    expect(bgTailMock).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Background (2)' }))
    await waitFor(() => { expect(bgTailMock).toHaveBeenCalled() })
  })

  it('keeps the tab present with an empty state when the project has no bg processes', async () => {
    stubStatus([alphaAgent], [betaDev])

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'alpha-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'alpha-agent detail' })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Background (0)' }))

    expect(await within(dialog).findByText('No background processes in alpha. Add one from the navbar.')).toBeInTheDocument()
    expect(bgTailMock).not.toHaveBeenCalled()
  })

  it('omits the Background tab for an agent with no project, and the tablist still works', async () => {
    stubStatus([loneAgent], [alphaWeb, betaDev])

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'lone-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'lone-agent detail' })

    const tabs = within(dialog).getAllByRole('tab')
    expect(tabs.length).toBeGreaterThan(0)
    expect(tabs.some((t) => t.textContent.startsWith('Background'))).toBe(false)
    expect(within(dialog).queryByRole('tab', { name: /Background/ })).toBeNull()

    // Absence does not break tab switching: another tab still activates.
    const details = within(dialog).getByRole('tab', { name: 'Details' })
    fireEvent.click(details)
    expect(details).toHaveAttribute('aria-selected', 'true')
    expect(bgTailMock).not.toHaveBeenCalled()
  })

  it('the tile badge (BgProcessRow) shows "exited" for liveness "exited" even though the tmux window exists', async () => {
    stubStatus([loneAgent], [{ ...alphaApi, windowPresent: true, liveness: 'exited' }])

    render(<AgentList />)
    const badge = await screen.findByText('exited')
    expect(badge).toHaveAttribute('data-liveness', 'exited')
    expect(screen.queryByText('running')).toBeNull()
    expect(screen.queryByText('window missing')).toBeNull()
  })

  // TASK-0206
  it('the tab shows Restart on every row (Start for a stopped one), and a successful restart optimistically flips the badge to running', async () => {
    const alphaDb = makeBg({ slug: 'alpha-db', name: 'db', projectId: 1, projectName: 'alpha', liveness: 'stopped', windowPresent: false })
    stubStatus([alphaAgent], [alphaWeb, alphaApi, alphaDb])

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'alpha-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'alpha-agent detail' })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Background (3)' }))
    const section = await within(dialog).findByRole('region', { name: 'Background processes' })

    expect(within(section).getByRole('button', { name: 'Restart web' })).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Restart api' })).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Start db' })).toBeInTheDocument()
    const apiRow = within(section).getByRole('button', { name: /alpha-api/ })
    expect(within(apiRow).getByText('exited')).toBeInTheDocument()

    fireEvent.click(within(section).getByRole('button', { name: 'Restart api' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))

    await waitFor(() => { expect(within(apiRow).getByText('running')).toBeInTheDocument() })
    expect(within(apiRow).queryByText('exited')).toBeNull()
    const restartUrls = vi.mocked(fetch).mock.calls
      .map(([url]) => url)
      .filter((url): url is string => typeof url === 'string' && url.endsWith('/restart'))
    expect(restartUrls).toHaveLength(1)
    expect(restartUrls[0]?.endsWith('/bg-processes/alpha-api/restart')).toBe(true)
  })

  // UAT-0206: a stopped process has no other action in the tab, so Start must adapt the copy and flip it to running.
  it('Start on a stopped tab row confirms with the adapted copy and flips its badge to running', async () => {
    const alphaDb = makeBg({ slug: 'alpha-db', name: 'db', projectId: 1, projectName: 'alpha', liveness: 'stopped', windowPresent: false })
    stubStatus([alphaAgent], [alphaWeb, alphaDb])

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'alpha-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'alpha-agent detail' })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Background (2)' }))
    const section = await within(dialog).findByRole('region', { name: 'Background processes' })
    const dbRow = within(section).getByRole('button', { name: /alpha-db/ })
    expect(within(dbRow).getByText('stopped')).toBeInTheDocument()

    fireEvent.click(within(section).getByRole('button', { name: 'Start db' }))
    expect(screen.getByText('Start "db" (project alpha)?')).toBeInTheDocument()
    expect(screen.getByText('Starts db; its window is not running.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => { expect(within(dbRow).getByText('running')).toBeInTheDocument() })
    expect(within(dbRow).queryByText('stopped')).toBeNull()
  })

  // TASK-0207
  it('the tile shows the last restart line (agent caller), and "No restarts recorded" when absent', async () => {
    const at = new Date(Date.now() - 3 * 60_000).toISOString()
    stubStatus([loneAgent], [
      { ...alphaWeb, lastRestart: { at, caller: 'alpha-agent' } },
      alphaApi,
    ])

    render(<AgentList />)
    await screen.findByText('alpha-web')
    const lines = screen.getAllByTestId('bg-last-restart').map((l) => l.textContent)
    expect(lines).toContain('Restarted 3m ago by alpha-agent')
    expect(lines).toContain('No restarts recorded')
  })

  it('a bg-update SSE carrying a new lastRestart updates the tab row text', async () => {
    stubStatus([alphaAgent], [alphaWeb, alphaApi])

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'alpha-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'alpha-agent detail' })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Background (2)' }))
    const section = await within(dialog).findByRole('region', { name: 'Background processes' })
    expect(within(section).getAllByText('No restarts recorded')).toHaveLength(2)

    // 2m30s ago: the label's clock (useNow) was sampled at mount, slightly before `at` is computed.
    const at = new Date(Date.now() - 150_000).toISOString()
    act(() => { fireSSE('bg-update', { ...alphaWeb, lastRestart: { at, caller: 'alpha-other-agent' } }) })

    const lines = within(section).getAllByTestId('bg-last-restart').map((l) => l.textContent)
    expect(lines).toContain('Restarted 2m ago by alpha-other-agent')
    expect(within(section).getAllByText('No restarts recorded')).toHaveLength(1)
  })

  it('a successful dashboard restart optimistically sets the row line to "from the dashboard"', async () => {
    stubStatus([alphaAgent], [alphaWeb, alphaApi])

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'alpha-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'alpha-agent detail' })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Background (2)' }))
    const section = await within(dialog).findByRole('region', { name: 'Background processes' })
    expect(within(section).getAllByText('No restarts recorded')).toHaveLength(2)

    fireEvent.click(within(section).getByRole('button', { name: 'Restart api' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))

    await waitFor(() => {
      const lines = within(section).getAllByTestId('bg-last-restart').map((l) => l.textContent)
      expect(lines.some((l) => l.startsWith('Restarted ') && l.endsWith('from the dashboard'))).toBe(true)
    })
    expect(within(section).getAllByText('No restarts recorded')).toHaveLength(1)
  })
})

// ── Sidebar + pane selection coverage gaps (TASK-0173 UAT) ─────────────────
//
// Closes the "missing assertion" gaps UAT-0173 recorded: the sidebar's inline width, the
// selected row's highlight classes, a selected agent leaving the active set, the empty state
// returning after Stop/Destroy, and onCloned re-pointing the selection. All of it is
// jsdom-level (class lists, inline style, DOM presence) — pixel geometry stays a live-only
// concern.
describe('AgentList sidebar + pane selection gaps (TASK-0173 UAT)', () => {
  beforeEach(() => {
    capturedEventSource = null
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function stubFetchWithAgents(agents: Agent[], extra?: (url: string) => { ok: boolean; json: () => unknown } | null) {
    stubAgentDetailFetch(agents[0] ?? baseAgent(null), (url) => {
      const overridden = extra?.(url)
      if (overridden) return overridden
      if (url.endsWith('/status')) {
        return {
          ok: true,
          json: () => ({
            session: 'test-session', sessionAlive: true, sessionExists: true,
            agents, bgProcesses: [], timestamp: new Date().toISOString(),
          }),
        }
      }
      return null
    })
  }

  it('renders the sidebar with an inline width of the shared SIDEBAR_WIDTH_PX (320px)', async () => {
    stubFetchWithAgents([{ ...baseAgent(null), id: 20, name: 'width-agent', state: 'busy' }])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })

    expect(SIDEBAR_WIDTH_PX).toBe(320)
    expect(sidebar.style.width).toBe('320px')
    expect(sidebar.style.width).toBe(`${SIDEBAR_WIDTH_PX.toString()}px`)
  })

  it('gives only the selected row the ring/canvas highlight (no bg-card) and keeps its 4px status right border', async () => {
    const a: Agent = { ...baseAgent(null), id: 21, name: 'ring-a', state: 'busy' }
    const b: Agent = { ...baseAgent(null), id: 22, name: 'ring-b', state: 'busy' }
    stubFetchWithAgents([a, b])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    const rowA = await within(sidebar).findByRole('button', { name: 'ring-a detail' })
    const rowB = within(sidebar).getByRole('button', { name: 'ring-b detail' })
    const tokens = (el: HTMLElement) => el.className.split(/\s+/)

    // Nothing selected: both rows are plain cards.
    for (const row of [rowA, rowB]) {
      expect(tokens(row)).toContain('bg-card')
      expect(tokens(row)).not.toContain('ring-2')
    }

    fireEvent.click(rowA)
    await screen.findByRole('region', { name: 'ring-a detail' })
    fireEvent.click(rowB)
    await screen.findByRole('region', { name: 'ring-b detail' })

    expect(tokens(rowB)).toEqual(expect.arrayContaining(['bg-canvas', 'ring-2', 'ring-accent-blue/50']))
    expect(tokens(rowB)).not.toContain('bg-card')
    // The previously selected row is back to the plain card look.
    expect(tokens(rowA)).toContain('bg-card')
    expect(tokens(rowA)).not.toContain('ring-2')
    expect(tokens(rowA)).not.toContain('ring-accent-blue/50')
    expect(tokens(rowA)).not.toContain('bg-canvas')
    // The TASK-0171 status border survives on the selected row.
    expect(tokens(rowB)).toContain('border-r-[4px]')
    expect(rowB.style.borderRightColor).toBe(normalizedColor(STATUS_CONFIG.busy.dot))
  })

  it.each(['no-window', 'exited'] as const)('keeps the same pane mounted, minus Stop agent, when the selected agent turns %s, while the sidebar drops its row', async (nextState) => {
    const agent: Agent = { ...baseAgent(null), id: 23, name: 'vanishing-agent', state: 'busy', windowPresent: true }
    stubFetchWithAgents([agent])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    fireEvent.click(await within(sidebar).findByRole('button', { name: 'vanishing-agent detail' }))
    const pane = await screen.findByRole('region', { name: 'vanishing-agent detail' })
    expect(within(pane).getByRole('button', { name: 'Stop agent' })).toBeInTheDocument()

    act(() => { fireSSE('agent-update', { ...agent, state: nextState, windowPresent: false }) })

    await waitFor(() => { expect(within(sidebar).queryByRole('button', { name: 'vanishing-agent detail' })).toBeNull() })
    const paneAfter = screen.getByRole('region', { name: 'vanishing-agent detail' })
    // Same DOM node: updated in place, not remounted, and not replaced by the empty state.
    expect(paneAfter).toBe(pane)
    expect(screen.queryByText('Select an agent from the sidebar')).toBeNull()
    expect(within(paneAfter).queryByRole('button', { name: 'Stop agent' })).toBeNull()
    expect(within(paneAfter).getByRole('button', { name: 'Destroy agent' })).toBeInTheDocument()
    expect(within(paneAfter).getAllByText(STATUS_CONFIG[nextState].label).length).toBeGreaterThan(0)
  })

  it('returns the pane to the empty state plus BgProcessSection after confirming Stop agent', async () => {
    const agent: Agent = { ...baseAgent(null), id: 24, name: 'stop-empty-agent', state: 'busy', windowPresent: true }
    stubFetchWithAgents([agent], (url) => {
      if (url.includes('/agents/24/window')) return { ok: true, json: () => ({ ok: true }) }
      return null
    })

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'stop-empty-agent detail' }))
    const pane = await screen.findByRole('region', { name: 'stop-empty-agent detail' })

    fireEvent.click(within(pane).getByRole('button', { name: 'Stop agent' }))
    const message = within(pane).getByText(/window and close this view\?/)
    fireEvent.click(within(message.parentElement?.nextElementSibling as HTMLElement).getByRole('button', { name: 'Stop' }))

    await waitFor(() => { expect(screen.queryByRole('region', { name: 'stop-empty-agent detail' })).toBeNull() })
    expect(screen.getByText('Select an agent from the sidebar')).toBeInTheDocument()
    expect(screen.getByText('Background processes')).toBeInTheDocument()
  })

  it('returns the pane to the empty state plus BgProcessSection after confirming Destroy agent', async () => {
    const agent: Agent = { ...baseAgent(null), id: 25, name: 'destroy-empty-agent', state: 'busy', windowPresent: true }
    stubFetchWithAgents([agent], (url) => {
      if (url.endsWith('/agents/25')) return { ok: true, json: () => ({ ok: true }) }
      return null
    })

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'destroy-empty-agent detail' }))
    const pane = await screen.findByRole('region', { name: 'destroy-empty-agent detail' })

    fireEvent.click(within(pane).getByRole('button', { name: 'Destroy agent' }))
    fireEvent.click(within(pane).getByRole('button', { name: 'Destroy' }))

    await waitFor(() => { expect(screen.queryByRole('region', { name: 'destroy-empty-agent detail' })).toBeNull() })
    expect(screen.getByText('Select an agent from the sidebar')).toBeInTheDocument()
    expect(screen.getByText('Background processes')).toBeInTheDocument()
  })

  it('onCloned re-points the selection at the new agent id once its agent-update arrives', async () => {
    const source: Agent = { ...baseAgent(null), id: 26, name: 'clone-source', state: 'busy', windowPresent: true }
    const clone: Agent = { ...source, id: 60, name: 'clone-source-copy' }
    stubFetchWithAgents([source], (url) => {
      // cloneAgent() chains `.then` on res.json(), so this one must return a real Promise.
      if (url.includes('/clone')) return { ok: true, json: () => Promise.resolve({ agent: { ...clone } }) }
      return null
    })

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    fireEvent.click(await within(sidebar).findByRole('button', { name: 'clone-source detail' }))
    const pane = await screen.findByRole('region', { name: 'clone-source detail' })

    fireEvent.click(within(pane).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(pane).getByRole('menuitem', { name: 'Clone' }))

    // Selection moves to the new id immediately; until the clone is in `agents` the pane has
    // nothing to render, so the source's pane is gone.
    await waitFor(() => { expect(screen.queryByRole('region', { name: 'clone-source detail' })).toBeNull() })

    act(() => { fireSSE('agent-update', clone) })

    const clonePane = await screen.findByRole('region', { name: 'clone-source-copy detail' })
    expect(clonePane).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'clone-source detail' })).toBeNull()
    expect(within(sidebar).getByRole('button', { name: 'clone-source-copy detail' })).toHaveAttribute('aria-current', 'true')
    expect(within(sidebar).getByRole('button', { name: 'clone-source detail' })).not.toHaveAttribute('aria-current')
  })

  it('Clone into new worktree re-points the selection at the returned clone id, as plain Clone does (TASK-0214)', async () => {
    const source: Agent = { ...baseAgent(null), id: 27, name: 'cwt-source', state: 'busy', windowPresent: true, inGitRepo: true }
    const clone: Agent = { ...source, id: 70, name: 'cwt-source-copy', worktreePath: '/tmp/wt/70', branch: 'conductor/70' }
    stubFetchWithAgents([source])
    cloneAgentMock.mockClear()
    cloneAgentMock.mockImplementationOnce(() => Promise.resolve({ id: clone.id }))

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    fireEvent.click(await within(sidebar).findByRole('button', { name: 'cwt-source detail' }))
    const pane = await screen.findByRole('region', { name: 'cwt-source detail' })

    fireEvent.click(within(pane).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(pane).getByRole('menuitem', { name: 'Clone into new worktree' }))

    expect(cloneAgentMock).toHaveBeenCalledWith(27, { forceWorktree: true })
    await waitFor(() => { expect(screen.queryByRole('region', { name: 'cwt-source detail' })).toBeNull() })

    act(() => { fireSSE('agent-update', clone) })

    expect(await screen.findByRole('region', { name: 'cwt-source-copy detail' })).toBeInTheDocument()
    expect(within(sidebar).getByRole('button', { name: 'cwt-source-copy detail' })).toHaveAttribute('aria-current', 'true')
    expect(within(sidebar).getByRole('button', { name: 'cwt-source detail' })).not.toHaveAttribute('aria-current')
  })

  it('switching rows resets the active tab and drops an open rename input, and returning to the first agent does not restore either', async () => {
    const a: Agent = { ...baseAgent(null), id: 41, name: 'remount-a', state: 'busy', windowPresent: true }
    const b: Agent = { ...baseAgent(null), id: 42, name: 'remount-b', state: 'busy', windowPresent: true }
    stubFetchWithAgents([a, b])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    fireEvent.click(await within(sidebar).findByRole('button', { name: 'remount-a detail' }))
    const paneA = await screen.findByRole('region', { name: 'remount-a detail' })
    fireEvent.click(within(paneA).getByRole('tab', { name: 'Skills' }))
    expect(within(paneA).getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(within(paneA).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(paneA).getByRole('menuitem', { name: 'Rename' }))
    expect(within(paneA).getByDisplayValue('remount-a')).toBeInTheDocument()

    fireEvent.click(within(sidebar).getByRole('button', { name: 'remount-b detail' }))
    const paneB = await screen.findByRole('region', { name: 'remount-b detail' })
    expect(screen.queryByDisplayValue('remount-a')).toBeNull()
    expect(screen.queryByDisplayValue('remount-b')).toBeNull()
    expect(within(paneB).getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true')
    expect(within(paneB).getByRole('button', { name: 'Agent actions' })).toBeInTheDocument()

    fireEvent.click(within(sidebar).getByRole('button', { name: 'remount-a detail' }))
    const paneA2 = await screen.findByRole('region', { name: 'remount-a detail' })
    expect(screen.queryByDisplayValue('remount-a')).toBeNull()
    expect(within(paneA2).getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true')
    expect(within(paneA2).getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'false')
    expect(within(paneA2).getByRole('button', { name: 'Agent actions' })).toBeInTheDocument()
  })

  it('switching rows drops an open Stop agent confirmation, and returning to the first agent does not restore it', async () => {
    const a: Agent = { ...baseAgent(null), id: 43, name: 'confirm-a', state: 'busy', windowPresent: true }
    const b: Agent = { ...baseAgent(null), id: 44, name: 'confirm-b', state: 'busy', windowPresent: true }
    stubFetchWithAgents([a, b])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    fireEvent.click(await within(sidebar).findByRole('button', { name: 'confirm-a detail' }))
    const paneA = await screen.findByRole('region', { name: 'confirm-a detail' })
    fireEvent.click(within(paneA).getByRole('button', { name: 'Stop agent' }))
    expect(within(paneA).getByText(/window and close this view\?/)).toBeInTheDocument()

    fireEvent.click(within(sidebar).getByRole('button', { name: 'confirm-b detail' }))
    await screen.findByRole('region', { name: 'confirm-b detail' })
    expect(screen.queryByText(/window and close this view\?/)).toBeNull()

    fireEvent.click(within(sidebar).getByRole('button', { name: 'confirm-a detail' }))
    await screen.findByRole('region', { name: 'confirm-a detail' })
    expect(screen.queryByText(/window and close this view\?/)).toBeNull()
  })
})

// ── Collapsible sidebar (TASK-0201) ─────────────────────────────────────────
//
// The collapsed flag persists in localStorage (`conductor:sidebarCollapsed`) and is read fresh by
// AgentList on mount, so the file-level `localStorage.clear()` keeps tests independent. The
// sidebarState module also caches the flag in module state, so it is reset around each test.
describe('AgentList collapsible sidebar (TASK-0201)', () => {
  beforeEach(() => {
    capturedEventSource = null
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', MockAudioContext)
    setSidebarCollapsed(false)
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setSidebarCollapsed(false)
  })

  function stubFetchWithAgents(agents: Agent[]) {
    stubAgentDetailFetch(agents[0] ?? baseAgent(null), (url) => {
      if (url.endsWith('/status')) {
        return {
          ok: true,
          json: () => ({
            session: 'test-session', sessionAlive: true, sessionExists: true,
            agents, bgProcesses: [], timestamp: new Date().toISOString(),
          }),
        }
      }
      return null
    })
  }

  const railAgents = (): Agent[] => [
    { ...baseAgent(null), id: 71, name: 'rail-alpha', state: 'busy' },
    { ...baseAgent(null), id: 72, name: 'rail-beta', state: 'idle' },
  ]

  it('collapsing sets the inline width to 48px, hides the filter input and project headers, and shows one named dot per agent', async () => {
    stubFetchWithAgents(railAgents())

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: 'rail-alpha detail' })
    expect(within(sidebar).getByRole('textbox', { name: 'Filter agents' })).toBeInTheDocument()
    expect(within(sidebar).getAllByText('Unassigned').length).toBeGreaterThan(0)

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Collapse sidebar' }))

    expect(SIDEBAR_COLLAPSED_WIDTH_PX).toBe(48)
    expect(sidebar.style.width).toBe('48px')
    expect(within(sidebar).queryByRole('textbox', { name: 'Filter agents' })).toBeNull()
    expect(within(sidebar).queryAllByText('Unassigned')).toHaveLength(0)
    // Expanded rows are gone; each agent is a single dot button labelled with its bare name.
    expect(within(sidebar).queryByRole('button', { name: 'rail-alpha detail' })).toBeNull()
    expect(within(sidebar).getByRole('button', { name: 'rail-alpha' })).toBeInTheDocument()
    expect(within(sidebar).getByRole('button', { name: 'rail-beta' })).toBeInTheDocument()
    // The toggle plus the two dots, nothing else.
    expect(within(sidebar).getAllByRole('button')).toHaveLength(3)
  })

  it('a rail dot hover title is "<project> <agent>" (bare name when the agent has no project) while the accessible name stays the bare agent name', async () => {
    stubFetchWithAgents([
      { ...baseAgent(null), id: 73, name: 'rail-gamma', projectId: 5, projectName: 'rail-proj' },
      { ...baseAgent(null), id: 74, name: 'rail-delta', projectId: null, projectName: null },
    ])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: 'rail-gamma detail' })
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Collapse sidebar' }))

    expect(within(sidebar).getByRole('button', { name: 'rail-gamma' })).toHaveAttribute('title', 'rail-proj rail-gamma')
    expect(within(sidebar).getByRole('button', { name: 'rail-delta' })).toHaveAttribute('title', 'rail-delta')
  })

  it('clicking a rail dot selects that agent and renders its detail pane', async () => {
    stubFetchWithAgents(railAgents())

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: 'rail-alpha detail' })
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Collapse sidebar' }))

    const dotBeta = within(sidebar).getByRole('button', { name: 'rail-beta' })
    expect(dotBeta).not.toHaveAttribute('aria-current')
    fireEvent.click(dotBeta)

    expect(await screen.findByRole('region', { name: 'rail-beta detail' })).toBeInTheDocument()
    expect(within(sidebar).getByRole('button', { name: 'rail-beta' })).toHaveAttribute('aria-current', 'true')
    expect(within(sidebar).getByRole('button', { name: 'rail-alpha' })).not.toHaveAttribute('aria-current')
  })

  it('flips aria-expanded and the toggle label on each toggle', async () => {
    stubFetchWithAgents(railAgents())

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: 'rail-alpha detail' })

    const collapse = within(sidebar).getByRole('button', { name: 'Collapse sidebar' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(collapse).toHaveAttribute('aria-controls', 'agent-sidebar')
    expect(collapse).toHaveAttribute('title', 'Collapse sidebar')
    expect(sidebar).toHaveAttribute('id', 'agent-sidebar')

    fireEvent.click(collapse)
    const expand = within(sidebar).getByRole('button', { name: 'Expand sidebar' })
    expect(within(sidebar).queryByRole('button', { name: 'Collapse sidebar' })).toBeNull()
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(expand).toHaveAttribute('title', 'Expand sidebar')

    fireEvent.click(expand)
    expect(within(sidebar).getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true')
    expect(sidebar.style.width).toBe('320px')
  })

  it('persists the collapsed state across an unmount and re-render', async () => {
    stubFetchWithAgents(railAgents())

    const first = render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: 'rail-alpha detail' })
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Collapse sidebar' }))
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('true')
    expect(localStorage.getItem('conductor:sidebarCollapsed')).toBe('true')

    first.unmount()
    render(<AgentList />)

    const remounted = await screen.findByRole('complementary', { name: 'Agents' })
    expect(remounted.style.width).toBe('48px')
    expect(await within(remounted).findByRole('button', { name: 'rail-alpha' })).toBeInTheDocument()
    expect(within(remounted).getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(remounted).queryByRole('textbox', { name: 'Filter agents' })).toBeNull()
  })

  it('re-probes the terminal size on every toggle', async () => {
    stubFetchWithAgents(railAgents())

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: 'rail-alpha detail' })
    expect(reprobeTerminalSizeSpy).not.toHaveBeenCalled()

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Collapse sidebar' }))
    expect(reprobeTerminalSizeSpy).toHaveBeenCalledTimes(1)

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Expand sidebar' }))
    expect(reprobeTerminalSizeSpy).toHaveBeenCalledTimes(2)
  })

  it('expanding restores the filter input with the previously typed text preserved', async () => {
    stubFetchWithAgents(railAgents())

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: 'rail-alpha detail' })

    fireEvent.change(within(sidebar).getByRole('textbox', { name: 'Filter agents' }), { target: { value: 'alpha' } })
    expect(within(sidebar).queryByRole('button', { name: 'rail-beta detail' })).toBeNull()

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Collapse sidebar' }))
    expect(within(sidebar).queryByRole('textbox', { name: 'Filter agents' })).toBeNull()
    // The rail honours the active filter: only the matching agent keeps a dot.
    expect(within(sidebar).getByRole('button', { name: 'rail-alpha' })).toBeInTheDocument()
    expect(within(sidebar).queryByRole('button', { name: 'rail-beta' })).toBeNull()

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Expand sidebar' }))
    const filter = within(sidebar).getByRole('textbox', { name: 'Filter agents' })
    expect(filter).toHaveValue('alpha')
    expect(within(sidebar).getByRole('button', { name: 'rail-alpha detail' })).toBeInTheDocument()
    expect(within(sidebar).queryByRole('button', { name: 'rail-beta detail' })).toBeNull()
  })
})

// ── Sidebar row status right border (TASK-0171) ────────────────────────────
//
// The border color is driven by STATUS_CONFIG[status].dot (via getStatusColor). jsdom
// normalizes hex to `rgb(...)` on read-back, so expected values are normalized by
// round-tripping through a real element's style rather than string-comparing hexes.
function normalizedColor(hex: string): string {
  const el = document.createElement('div')
  el.style.borderRightColor = hex
  return el.style.borderRightColor
}

describe('AgentList sidebar row status right border (TASK-0171)', () => {
  beforeEach(() => {
    capturedEventSource = null
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const rowFor = (name: string): HTMLElement => screen.getByRole('button', { name: `${name} detail` })

  it.each<[string, AgentStatus, Partial<Agent>]>([
    ['busy', 'busy', { state: 'busy' }],
    ['idle', 'idle', { state: 'idle', queuedTasks: 2 }],
    ['awaiting', 'awaiting', { state: 'awaiting' }],
    ['error', 'error', { state: 'error' }],
    ['starting', 'starting', { state: 'starting' }],
    ['stalled', 'stalled', { state: 'stalled' }],
    ['empty', 'empty', { state: 'idle', queuedTasks: 0 }],
    ['idle-waiting', 'idle-waiting', { state: 'idle', queuedTasks: 0, agentType: 'codex', launchCmd: 'codex' }],
  ])('paints the %s row with the STATUS_CONFIG color as a 4px right border', async (_label, status, overrides) => {
    const agent: Agent = { ...baseAgent(null), id: 1, name: `border-${status}`, ...overrides }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    await screen.findByText(agent.name)

    const row = rowFor(agent.name)
    // 'empty' (ready) is deliberately transparent: a ready agent needs no attention cue.
    expect(row.style.borderRightColor).toBe(status === 'empty' ? 'transparent' : normalizedColor(STATUS_CONFIG[status].dot))
    expect(row.className).toContain('border-r-[4px]')

    // The other three sides keep the neutral border-line color: the 1px base border plus
    // border-line are present and no per-side color/width override exists in the class list.
    const tokens = row.className.split(/\s+/)
    expect(tokens).toContain('border')
    expect(tokens).toContain('border-line')
    expect(tokens.filter((t) => /^border-[lbt]-|^border-[xy]-|^border-(l|t|b)$/.test(t))).toEqual([])
    expect(row.style.borderLeftColor).toBe('')
    expect(row.style.borderTopColor).toBe('')
    expect(row.style.borderBottomColor).toBe('')

    // Color is a redundant cue (WCAG 1.4.1): the row still renders the textual status label,
    // and the accessible name is unchanged (the border adds no text or role).
    expect(within(row).getByText(STATUS_CONFIG[status].label)).toBeInTheDocument()
    expect(row.getAttribute('aria-label')).toBe(`${agent.name} detail`)
  })

  it('paints an inline inactive row (Show inactive checked) with the same 4px right border as any other sidebar row (TASK-0181)', async () => {
    const agent: Agent = { ...baseAgent(null), id: 1, name: 'inactive-exited', state: 'exited' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByLabelText('Show inactive'))

    const row = await screen.findByRole('button', { name: 'inactive-exited detail' })
    expect(row.className).toContain('border-r-[4px]')
    expect(row.style.borderRightColor).toBe(normalizedColor('#e5484d'))
    expect(row.className.split(/\s+/)).toContain('border-line')
  })

  // Every inactive status paints the one fixed red, regardless of its own STATUS_CONFIG dot
  // (no-window/unknown are grey there; exited/error are already this red).
  it.each<[string, string]>([
    ['no-window', 'no-window'],
    ['unknown', 'bogus-state'],
    ['exited', 'exited'],
  ])('paints a %s inline row with the fixed inactive red 4px right border regardless of its status dot (TASK-0181)', async (_label, state) => {
    const agent: Agent = { ...baseAgent(null), id: 1, name: 'inactive-colored', state: state as Agent['state'], windowPresent: false }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByLabelText('Show inactive'))

    const row = await screen.findByRole('button', { name: 'inactive-colored detail' })
    expect(row.className).toContain('border-r-[4px]')
    expect(row.style.borderRightColor).toBe(normalizedColor('#e5484d'))
    expect(row.className.split(/\s+/)).toContain('border-line')
    // No inline override on the other three sides.
    expect(row.style.borderLeftColor).toBe('')
    expect(row.style.borderTopColor).toBe('')
    expect(row.style.borderBottomColor).toBe('')
  })

  it('changes only the border color, not the class list, when an agent status flips', async () => {
    const agent: Agent = { ...baseAgent(null), id: 1, name: 'flip-agent', state: 'idle', queuedTasks: 1 }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    await screen.findByText('flip-agent')

    const before = rowFor('flip-agent')
    const classBefore = before.className
    const colorBefore = before.style.borderRightColor
    expect(colorBefore).toBe(normalizedColor(STATUS_CONFIG.idle.dot))

    act(() => { fireSSE('agent-update', { ...agent, state: 'busy' }) })

    await waitFor(() => {
      expect(rowFor('flip-agent').style.borderRightColor).toBe(normalizedColor(STATUS_CONFIG.busy.dot))
    })
    const after = rowFor('flip-agent')
    expect(after.style.borderRightColor).not.toBe(colorBefore)
    expect(after.className).toBe(classBefore)
  })
})

// ── Worktree/branch propagation to the sidebar and other clients (TASK-0211) ─
//
// The sidebar row's `⎇ <branch>` badge is driven by `agents` state in AgentList. That state is
// patched optimistically by AgentDetailView's `onWorktreeCreated` (acting client) and by the SSE
// `agent-update` the host-server's status diff now emits (every other client, plus the self-heal
// that clears a vanished worktree). Assertions are scoped to the sidebar (`complementary`) so they
// cannot be satisfied by the detail pane's own Worktree row.
describe('AgentList worktree/branch propagation (TASK-0211)', () => {
  beforeEach(() => {
    capturedEventSource = null
    createWorktreeForAgentMock.mockReset()
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function openAgentPane(agent: Agent) {
    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    fireEvent.click(await within(sidebar).findByRole('button', { name: `${agent.name} detail` }))
    const pane = await screen.findByRole('region', { name: `${agent.name} detail` })
    return { sidebar, pane }
  }

  it('creating a worktree from the detail view shows the branch badge on the sidebar row immediately', async () => {
    const agent: Agent = { ...baseAgent(null), id: 31, name: 'wt-sidebar-create', inGitRepo: true, windowPresent: false }
    stubAgentDetailFetch(agent, (url) => (url.includes('/checkpoints') ? { ok: true, json: () => ({ checkpoints: [] }) } : null))
    createWorktreeForAgentMock.mockResolvedValue({ ...agent, worktreePath: '/tmp/wt/31', branch: 'conductor/31' })

    const { sidebar, pane } = await openAgentPane(agent)
    expect(within(sidebar).queryByText('⎇ conductor/31')).toBeNull()

    fireEvent.click(within(pane).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(pane).getByRole('menuitem', { name: 'Create worktree' }))

    expect(await within(sidebar).findByText('⎇ conductor/31')).toBeInTheDocument()
    expect(createWorktreeForAgentMock).toHaveBeenCalledWith(31)
  })

  it('an SSE agent-update carrying worktreePath/branch updates the sidebar badge and the detail Worktree row', async () => {
    const agent: Agent = { ...baseAgent(null), id: 32, name: 'wt-sse-set', inGitRepo: true }
    stubAgentDetailFetch(agent, (url) => (url.includes('/checkpoints') ? { ok: true, json: () => ({ checkpoints: [] }) } : null))

    const { sidebar, pane } = await openAgentPane(agent)
    expect(within(sidebar).queryByText('⎇ conductor/32')).toBeNull()
    expect(within(pane).queryByText('⎇ conductor/32')).toBeNull()

    act(() => { fireSSE('agent-update', { ...agent, worktreePath: '/tmp/wt/32', branch: 'conductor/32' }) })

    expect(await within(sidebar).findByText('⎇ conductor/32')).toBeInTheDocument()
    expect(within(pane).getByText('⎇ conductor/32')).toBeInTheDocument()
  })

  it('an SSE agent-update with worktreePath/branch null removes the sidebar badge (self-heal)', async () => {
    const agent: Agent = { ...baseAgent(null), id: 33, name: 'wt-sse-clear', inGitRepo: true, worktreePath: '/tmp/wt/33', branch: 'conductor/33' }
    stubAgentDetailFetch(agent, (url) => (url.includes('/checkpoints') ? { ok: true, json: () => ({ checkpoints: [] }) } : null))

    const { sidebar, pane } = await openAgentPane(agent)
    expect(within(sidebar).getByText('⎇ conductor/33')).toBeInTheDocument()

    act(() => { fireSSE('agent-update', { ...agent, worktreePath: null, branch: null }) })

    await waitFor(() => { expect(within(sidebar).queryByText('⎇ conductor/33')).toBeNull() })
    expect(within(pane).queryByText('⎇ conductor/33')).toBeNull()
  })

  // TASK-0215: the one-shot agent-update the host-server broadcasts right after a clone/create
  // is the FIRST event for an unknown id, so it is appended verbatim and must carry the badge.
  it('an SSE agent-update for an unknown agent id appends it with its worktree badge, and a periodic-shaped follow-up keeps it', async () => {
    const existing: Agent = { ...baseAgent(null), id: 34, name: 'wt-clone-source', inGitRepo: true }
    stubAgentDetailFetch(existing, (url) => (url.includes('/checkpoints') ? { ok: true, json: () => ({ checkpoints: [] }) } : null))

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: 'wt-clone-source detail' })

    const clone: Agent = {
      ...existing,
      id: 35,
      name: 'wt-clone-copy',
      role: 'reviewer',
      worktreePath: '/tmp/wt/35',
      branch: 'conductor/35',
    }
    act(() => { fireSSE('agent-update', clone) })

    expect(await within(sidebar).findByRole('button', { name: 'wt-clone-copy detail' })).toBeInTheDocument()
    expect(within(sidebar).getByText('⎇ conductor/35')).toBeInTheDocument()

    act(() => { fireSSE('agent-update', { ...clone, state: 'busy', queuedTasks: 1 }) })

    await waitFor(() => { expect(within(sidebar).getByText('⎇ conductor/35')).toBeInTheDocument() })
  })
})

// ── lastPrompt mirrored into the per-agent store (TASK-0225) ────────────────
//
// The host-server puts `lastPrompt: { text, ts } | null` on the agent snapshot; AgentList mirrors
// every non-null value into the localStorage store from lib/lastPayload.ts (source 'hook'), keyed
// by agent id, on the initial /status load and on each SSE agent-update. Side effect only — the
// real store is used (not mocked) and no rendered text is asserted. Newest ts wins inside the store.
describe('AgentList mirrors lastPrompt into the lastPayload store (TASK-0225)', () => {
  const keyFor = (id: number) => `conductor:lastPayload:${id.toString()}`
  const stored = (id: number): unknown => {
    const raw = localStorage.getItem(keyFor(id))
    return raw === null ? null : JSON.parse(raw)
  }

  beforeEach(() => {
    capturedEventSource = null
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function mountWith(agent: Agent) {
    stubAgentDetailFetch(agent)
    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: `${agent.name} detail` })
  }

  it('(a) an agent-update carrying lastPrompt writes { text, ts, source: hook } under the agent id', async () => {
    const agent: Agent = { ...baseAgent(null), id: 41, name: 'lp-sse-write' }
    await mountWith(agent)
    expect(stored(41)).toBeNull()

    act(() => { fireSSE('agent-update', { ...agent, lastPrompt: { text: 'hello', ts: '2026-09-20T10:00:00.000Z' } }) })

    expect(stored(41)).toEqual({ text: 'hello', ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
  })

  it('(b) an older incoming lastPrompt does not overwrite a newer stored entry', async () => {
    const agent: Agent = { ...baseAgent(null), id: 42, name: 'lp-older-loses' }
    const seeded = { text: 'typed in add-task', ts: '2026-09-20T12:00:00.000Z', source: 'add-task' }
    localStorage.setItem(keyFor(42), JSON.stringify(seeded))
    await mountWith(agent)

    act(() => { fireSSE('agent-update', { ...agent, lastPrompt: { text: 'older hook prompt', ts: '2026-09-20T10:00:00.000Z' } }) })

    expect(stored(42)).toEqual(seeded)
  })

  it('(c) a newer incoming lastPrompt replaces an older stored entry', async () => {
    const agent: Agent = { ...baseAgent(null), id: 43, name: 'lp-newer-wins' }
    localStorage.setItem(keyFor(43), JSON.stringify({ text: 'old', ts: '2026-09-20T09:00:00.000Z', source: 'add-task' }))
    await mountWith(agent)

    act(() => { fireSSE('agent-update', { ...agent, lastPrompt: { text: 'newer hook prompt', ts: '2026-09-20T10:00:00.000Z' } }) })

    expect(stored(43)).toEqual({ text: 'newer hook prompt', ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
  })

  it('(d) lastPrompt null and an omitted lastPrompt write nothing and never clear an existing entry', async () => {
    const agent: Agent = { ...baseAgent(null), id: 44, name: 'lp-null-omitted' }
    await mountWith(agent)

    act(() => { fireSSE('agent-update', { ...agent, lastPrompt: null }) })
    act(() => { fireSSE('agent-update', { ...agent }) })
    expect(stored(44)).toBeNull()

    // An omitted lastPrompt means "unchanged" (partial one-shot payloads), not "clear".
    const seeded = { text: 'keep me', ts: '2026-09-20T10:00:00.000Z', source: 'hook' }
    localStorage.setItem(keyFor(44), JSON.stringify(seeded))
    act(() => { fireSSE('agent-update', { ...agent, state: 'busy' }) })
    act(() => { fireSSE('agent-update', { ...agent, lastPrompt: null }) })
    expect(stored(44)).toEqual(seeded)
  })

  it('(e) the initial GET /status response carrying lastPrompt writes the store', async () => {
    const agent: Agent = {
      ...baseAgent(null),
      id: 45,
      name: 'lp-status-load',
      lastPrompt: { text: 'from status', ts: '2026-09-20T11:00:00.000Z' },
    }
    await mountWith(agent)

    expect(stored(45)).toEqual({ text: 'from status', ts: '2026-09-20T11:00:00.000Z', source: 'hook' })
  })

  it('(f) two agents with different ids and payloads write two separate keys', async () => {
    const first: Agent = { ...baseAgent(null), id: 46, name: 'lp-key-first' }
    const second: Agent = { ...baseAgent(null), id: 47, name: 'lp-key-second' }
    await mountWith(first)

    act(() => { fireSSE('agent-update', { ...first, lastPrompt: { text: 'first prompt', ts: '2026-09-20T10:00:00.000Z' } }) })
    act(() => { fireSSE('agent-update', { ...second, lastPrompt: { text: 'second prompt', ts: '2026-09-20T10:05:00.000Z' } }) })

    expect(stored(46)).toEqual({ text: 'first prompt', ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
    expect(stored(47)).toEqual({ text: 'second prompt', ts: '2026-09-20T10:05:00.000Z', source: 'hook' })
  })
})

// ── Last payload cleared on agent deletion, clone isolation, orphan sweep (TASK-0228) ──
//
// The browser-side payload store (`conductor:lastPayload:<id>`) is dropped only on true deletion:
// the deleting tab's successful DELETE, and every tab's `agent-removed` SSE. Never on window close
// or a failed delete. A clone gets a new id, so it starts empty even though it shares the workdir.
// The initial /status load sweeps keys whose id is not live (SQLite reuses the highest id).
describe('AgentList clears the last payload on agent deletion (TASK-0228)', () => {
  const keyFor = (id: number) => `conductor:lastPayload:${id.toString()}`
  const seed = (id: number, text = `payload ${id.toString()}`) => {
    saveLastPayload(id, { text, ts: '2026-09-20T10:00:00.000Z', source: 'hook' })
  }

  beforeEach(() => {
    capturedEventSource = null
    __resetLastPayloadCacheForTests()
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function stubStatus(agents: Agent[], extra?: (url: string) => { ok: boolean; json: () => unknown } | null) {
    stubAgentDetailFetch(agents[0] ?? baseAgent(null), (url) => {
      const overridden = extra?.(url)
      if (overridden) return overridden
      if (url.endsWith('/status')) {
        return {
          ok: true,
          json: () => ({
            session: 'test-session', sessionAlive: true, sessionExists: true,
            agents, bgProcesses: [], timestamp: new Date().toISOString(),
          }),
        }
      }
      return null
    })
  }

  async function openPane(name: string) {
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    fireEvent.click(await within(sidebar).findByRole('button', { name: `${name} detail` }))
    return screen.findByRole('region', { name: `${name} detail` })
  }

  function confirmDestroy(pane: HTMLElement) {
    fireEvent.click(within(pane).getByRole('button', { name: 'Destroy agent' }))
    fireEvent.click(within(pane).getByRole('button', { name: 'Destroy' }))
  }

  // Lets the mount-time /status promise chain settle when no rendered element marks completion.
  async function flushStatusLoad() {
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0) }) })
  }

  it('a successful DELETE clears that agent\'s key', async () => {
    const agent: Agent = { ...baseAgent(null), id: 201, name: 'del-clears', state: 'busy' }
    seed(201)
    stubStatus([agent], (url) => (url.endsWith('/agents/201') ? { ok: true, json: () => ({ ok: true }) } : null))

    render(<AgentList />)
    const pane = await openPane('del-clears')
    expect(localStorage.getItem(keyFor(201))).not.toBeNull()

    confirmDestroy(pane)

    await waitFor(() => { expect(screen.queryByRole('region', { name: 'del-clears detail' })).toBeNull() })
    expect(localStorage.getItem(keyFor(201))).toBeNull()
  })

  it('a failed DELETE keeps the key and shows the error banner', async () => {
    const agent: Agent = { ...baseAgent(null), id: 202, name: 'del-fails', state: 'busy' }
    seed(202)
    stubStatus([agent], (url) => (
      url.endsWith('/agents/202') ? { ok: false, json: () => Promise.resolve({ error: 'delete boom' }) } : null
    ))

    render(<AgentList />)
    const pane = await openPane('del-fails')

    confirmDestroy(pane)

    expect(await within(pane).findByText('delete boom')).toBeInTheDocument()
    expect(localStorage.getItem(keyFor(202))).not.toBeNull()
  })

  it('an agent-removed SSE clears the key (the non-deleting tab path)', async () => {
    const agent: Agent = { ...baseAgent(null), id: 203, name: 'sse-clears', state: 'busy' }
    seed(203)
    stubStatus([agent])

    render(<AgentList />)
    await openPane('sse-clears')
    expect(localStorage.getItem(keyFor(203))).not.toBeNull()

    act(() => { fireSSE('agent-removed', { id: 203 }) })

    expect(localStorage.getItem(keyFor(203))).toBeNull()
  })

  it('an agent-removed SSE without a numeric id clears nothing', async () => {
    const agent: Agent = { ...baseAgent(null), id: 204, name: 'sse-bad-id', state: 'busy' }
    seed(204)
    stubStatus([agent])

    render(<AgentList />)
    await openPane('sse-bad-id')

    act(() => { fireSSE('agent-removed', { id: '204' }) })
    act(() => { fireSSE('agent-removed', {}) })

    expect(localStorage.getItem(keyFor(204))).not.toBeNull()
  })

  it('removing one agent (by DELETE and by SSE) leaves the other agents\' keys and values untouched', async () => {
    const a: Agent = { ...baseAgent(null), id: 205, name: 'iso-a', state: 'busy' }
    const b: Agent = { ...baseAgent(null), id: 206, name: 'iso-b', state: 'busy' }
    const c: Agent = { ...baseAgent(null), id: 207, name: 'iso-c', state: 'busy' }
    seed(205)
    seed(206, 'keep b')
    seed(207, 'keep c')
    stubStatus([a, b, c], (url) => (url.endsWith('/agents/205') ? { ok: true, json: () => ({ ok: true }) } : null))

    render(<AgentList />)
    const pane = await openPane('iso-a')
    confirmDestroy(pane)
    await waitFor(() => { expect(localStorage.getItem(keyFor(205))).toBeNull() })
    expect(JSON.parse(localStorage.getItem(keyFor(206)) ?? 'null')).toMatchObject({ text: 'keep b' })
    expect(JSON.parse(localStorage.getItem(keyFor(207)) ?? 'null')).toMatchObject({ text: 'keep c' })

    act(() => { fireSSE('agent-removed', { id: 206 }) })
    expect(localStorage.getItem(keyFor(206))).toBeNull()
    expect(JSON.parse(localStorage.getItem(keyFor(207)) ?? 'null')).toMatchObject({ text: 'keep c' })
  })

  it('closing the agent window (Stop agent) does not clear the key', async () => {
    const agent: Agent = { ...baseAgent(null), id: 208, name: 'close-keeps', state: 'busy', windowPresent: true }
    seed(208)
    stubStatus([agent], (url) => (url.includes('/agents/208/window') ? { ok: true, json: () => ({ ok: true }) } : null))

    render(<AgentList />)
    const pane = await openPane('close-keeps')

    fireEvent.click(within(pane).getByRole('button', { name: 'Stop agent' }))
    const message = within(pane).getByText(/window and close this view\?/)
    fireEvent.click(within(message.parentElement?.nextElementSibling as HTMLElement).getByRole('button', { name: 'Stop' }))

    await waitFor(() => { expect(screen.queryByRole('region', { name: 'close-keeps detail' })).toBeNull() })
    expect(localStorage.getItem(keyFor(208))).not.toBeNull()
  })

  it('a clone (new id, same workdir) starts with no payload and leaves the source\'s payload alone', async () => {
    const workdir = '/repo/shared-workdir'
    const source: Agent = { ...baseAgent(null), id: 26, name: 'payload-clone-source', state: 'busy', workdir }
    const clone: Agent = { ...source, id: 60, name: 'payload-clone-source-copy' }
    seed(26, 'source prompt')
    stubStatus([source])
    cloneAgentMock.mockClear()
    cloneAgentMock.mockImplementationOnce(() => Promise.resolve({ id: clone.id }))

    render(<AgentList />)
    const pane = await openPane('payload-clone-source')

    fireEvent.click(within(pane).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(pane).getByRole('menuitem', { name: 'Clone' }))
    await waitFor(() => { expect(cloneAgentMock).toHaveBeenCalledWith(26) })

    act(() => { fireSSE('agent-update', clone) })
    await screen.findByRole('region', { name: 'payload-clone-source-copy detail' })

    expect(localStorage.getItem(keyFor(60))).toBeNull()
    expect(loadLastPayload(60)).toBeNull()
    expect(JSON.parse(localStorage.getItem(keyFor(26)) ?? 'null')).toMatchObject({ text: 'source prompt' })
  })

  it('the initial /status load sweeps keys for ids that are not live and leaves live and foreign keys alone', async () => {
    const a: Agent = { ...baseAgent(null), id: 211, name: 'sweep-a', state: 'busy' }
    const b: Agent = { ...baseAgent(null), id: 212, name: 'sweep-b', state: 'busy' }
    seed(211)
    seed(212)
    seed(299)
    localStorage.setItem('conductor:sendDraft:211', 'draft text')
    localStorage.setItem('conductor:lastPayload:abc', 'not ours')
    stubStatus([a, b])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: 'sweep-a detail' })

    expect(localStorage.getItem(keyFor(211))).not.toBeNull()
    expect(localStorage.getItem(keyFor(212))).not.toBeNull()
    expect(localStorage.getItem(keyFor(299))).toBeNull()
    expect(localStorage.getItem('conductor:sendDraft:211')).toBe('draft text')
    expect(localStorage.getItem('conductor:lastPayload:abc')).toBe('not ours')
  })

  it('a /status body without an agents field sweeps nothing', async () => {
    seed(221)
    seed(222)
    stubAgentDetailFetch(baseAgent(null), (url) => (
      url.endsWith('/status')
        ? { ok: true, json: () => ({ session: 'test-session', sessionAlive: true, sessionExists: true, timestamp: new Date().toISOString() }) }
        : null
    ))

    render(<AgentList />)
    await flushStatusLoad()

    expect(localStorage.getItem(keyFor(221))).not.toBeNull()
    expect(localStorage.getItem(keyFor(222))).not.toBeNull()
  })

  it('a /status body with an empty agents array does sweep every stored payload', async () => {
    seed(231)
    stubStatus([], (url) => (
      url.endsWith('/status')
        ? { ok: true, json: () => ({ session: 'test-session', sessionAlive: true, sessionExists: true, agents: [], bgProcesses: [], timestamp: new Date().toISOString() }) }
        : null
    ))

    render(<AgentList />)
    await flushStatusLoad()

    expect(localStorage.getItem(keyFor(231))).toBeNull()
  })

  it('a failing /status (non-ok) sweeps nothing', async () => {
    seed(241)
    stubAgentDetailFetch(baseAgent(null), (url) => (
      url.endsWith('/status') ? { ok: false, json: () => Promise.resolve({}) } : null
    ))

    render(<AgentList />)
    await screen.findByText(/Failed to load status/)

    expect(localStorage.getItem(keyFor(241))).not.toBeNull()
  })

  it('does not sweep when SSE state has already arrived before the /status response', async () => {
    seed(251)
    let resolveStatus: (value: { ok: boolean; json: () => unknown }) => void = () => { /* replaced below */ }
    const statusPromise = new Promise<{ ok: boolean; json: () => unknown }>((resolve) => { resolveStatus = resolve })
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/status')) return statusPromise
      return Promise.resolve({ ok: true, json: () => ({ agent: 'x', tasks: [], project: [], user: [] }) })
    }))

    render(<AgentList />)
    // An agent-update lands first (the list is now SSE-authoritative and may be partial).
    act(() => { fireSSE('agent-update', { ...baseAgent(null), id: 252, name: 'sse-first' }) })
    await act(async () => {
      resolveStatus({
        ok: true,
        json: () => ({ session: 'test-session', sessionAlive: true, sessionExists: true, agents: [], bgProcesses: [], timestamp: new Date().toISOString() }),
      })
      await statusPromise
    })
    await flushStatusLoad()

    expect(localStorage.getItem(keyFor(251))).not.toBeNull()
  })
})

// ── lastPrompt mirror: malformed shapes and cross-ingest ordering (TASK-0225 UAT) ──
//
// Gap-closing cases added by /uat-generate for UAT-0225: malformed `lastPrompt` shapes are ignored
// (never written, never clear a stored value), the numeric agent id is the only key component, and
// the two ingest points (initial /status, SSE agent-update) feed the same newest-wins store.
describe('AgentList lastPrompt mirror edge cases (TASK-0225 UAT)', () => {
  const PREFIX = 'conductor:lastPayload:'
  const keyFor = (id: number) => `${PREFIX}${id.toString()}`
  const stored = (id: number): unknown => {
    const raw = localStorage.getItem(keyFor(id))
    return raw === null ? null : JSON.parse(raw)
  }
  const payloadKeys = (): string[] => Object.keys(localStorage).filter((k) => k.startsWith(PREFIX))

  beforeEach(() => {
    capturedEventSource = null
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function mountWith(agent: Agent) {
    stubAgentDetailFetch(agent)
    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: `${agent.name} detail` })
  }

  it('malformed lastPrompt shapes on an agent-update write nothing', async () => {
    const agent: Agent = { ...baseAgent(null), id: 51, name: 'lp-malformed-empty' }
    await mountWith(agent)

    const malformed: unknown[] = [
      { text: 123, ts: '2026-09-20T10:00:00.000Z' },
      { text: 'no ts' },
      { text: 'numeric ts', ts: 1789898400000 },
      { text: '', ts: '2026-09-20T10:00:00.000Z' },
      { text: null, ts: '2026-09-20T10:00:00.000Z' },
      'just a string',
      [],
      {},
    ]
    for (const lastPrompt of malformed) {
      act(() => { fireSSE('agent-update', { ...agent, lastPrompt }) })
    }

    expect(stored(51)).toBeNull()
    expect(payloadKeys()).toEqual([])
  })

  it('malformed lastPrompt shapes never overwrite or clear an existing stored entry', async () => {
    const agent: Agent = { ...baseAgent(null), id: 52, name: 'lp-malformed-keeps' }
    const seeded = { text: 'keep me', ts: '2026-09-20T10:00:00.000Z', source: 'hook' }
    localStorage.setItem(keyFor(52), JSON.stringify(seeded))
    await mountWith(agent)

    act(() => { fireSSE('agent-update', { ...agent, lastPrompt: { text: 99, ts: '2026-09-20T23:00:00.000Z' } }) })
    act(() => { fireSSE('agent-update', { ...agent, lastPrompt: { text: 'newer but no ts' } }) })

    expect(stored(52)).toEqual(seeded)
  })

  it('a null lastPrompt in the initial /status response writes nothing', async () => {
    const nullAgent: Agent = { ...baseAgent(null), id: 53, name: 'lp-status-null', lastPrompt: null }
    await mountWith(nullAgent)
    expect(stored(53)).toBeNull()
    expect(payloadKeys()).toEqual([])
  })

  it('keys the entry by the numeric agent id, not the agent name', async () => {
    const agent: Agent = { ...baseAgent(null), id: 54, name: 'lp-key-by-id' }
    await mountWith(agent)

    act(() => { fireSSE('agent-update', { ...agent, lastPrompt: { text: 'keyed', ts: '2026-09-20T10:00:00.000Z' } }) })

    expect(payloadKeys()).toEqual([`${PREFIX}54`])
    expect(localStorage.getItem(`${PREFIX}lp-key-by-id`)).toBeNull()
  })

  it('the /status ingest and the agent-update ingest share one newest-wins store', async () => {
    const agent: Agent = {
      ...baseAgent(null),
      id: 55,
      name: 'lp-both-ingest',
      lastPrompt: { text: 'from status', ts: '2026-09-20T11:00:00.000Z' },
    }
    await mountWith(agent)
    expect(stored(55)).toEqual({ text: 'from status', ts: '2026-09-20T11:00:00.000Z', source: 'hook' })

    // An older SSE value loses to the /status-loaded one; a newer one replaces it.
    act(() => { fireSSE('agent-update', { ...agent, lastPrompt: { text: 'older sse', ts: '2026-09-20T10:00:00.000Z' } }) })
    expect(stored(55)).toEqual({ text: 'from status', ts: '2026-09-20T11:00:00.000Z', source: 'hook' })

    act(() => { fireSSE('agent-update', { ...agent, lastPrompt: { text: 'newer sse', ts: '2026-09-20T12:00:00.000Z' } }) })
    expect(stored(55)).toEqual({ text: 'newer sse', ts: '2026-09-20T12:00:00.000Z', source: 'hook' })
  })
})

// ── lastPrompt mirror: storage-failure isolation (TASK-0225 UAT) ────────────
//
// TASK-0225 "Failure isolation": a localStorage write failure (private mode / quota) must never
// break agent rendering or the merge that shares the agent-update handler.
describe('AgentList lastPrompt mirror storage-failure isolation (TASK-0225 UAT)', () => {
  beforeEach(() => {
    capturedEventSource = null
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('an agent-update whose lastPrompt cannot be persisted still merges the rest of the snapshot', async () => {
    const agent: Agent = { ...baseAgent(null), id: 61, name: 'lp-storage-fails', inGitRepo: true }
    stubAgentDetailFetch(agent, (url) => (url.includes('/checkpoints') ? { ok: true, json: () => ({ checkpoints: [] }) } : null))
    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: 'lp-storage-fails detail' })
    expect(within(sidebar).queryByText('⎇ conductor/61')).toBeNull()

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    act(() => {
      fireSSE('agent-update', {
        ...agent,
        worktreePath: '/tmp/wt/61',
        branch: 'conductor/61',
        lastPrompt: { text: 'unpersistable', ts: '2026-09-20T10:00:00.000Z' },
      })
    })

    expect(await within(sidebar).findByText('⎇ conductor/61')).toBeInTheDocument()
    expect(localStorage.getItem('conductor:lastPayload:61')).toBeNull()
  })
})

// ── Interplay of the TASK-0228 clear/sweep with the TASK-0225 mirror (TASK-0228 UAT) ──
//
// TASK-0225 originally left `agent-removed` and the guarded /status block untouched; TASK-0228 now
// clears on `agent-removed` and sweeps inside that block. These cases pin the reconciled behavior:
// a hook-mirrored payload is dropped on removal, the mirror is not blocked from re-writing it for a
// later update, and the /status sweep never deletes the payload the same load just mirrored.
describe('AgentList TASK-0228 clear and sweep interplay with the TASK-0225 mirror', () => {
  const keyFor = (id: number) => `conductor:lastPayload:${id.toString()}`

  beforeEach(() => {
    capturedEventSource = null
    __resetLastPayloadCacheForTests()
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('agent-removed drops a payload the mirror wrote, and a later agent-update re-mirrors it', async () => {
    const agent: Agent = { ...baseAgent(null), id: 271, name: 'interplay-remove' }
    const lastPrompt = { text: 'hook prompt', ts: '2026-09-20T10:00:00.000Z' }
    stubAgentDetailFetch(agent)
    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: 'interplay-remove detail' })

    act(() => { fireSSE('agent-update', { ...agent, lastPrompt }) })
    expect(JSON.parse(localStorage.getItem(keyFor(271)) ?? 'null')).toEqual({ ...lastPrompt, source: 'hook' })

    act(() => { fireSSE('agent-removed', { id: 271 }) })
    expect(localStorage.getItem(keyFor(271))).toBeNull()

    // A later update for the same id (a reused id, or a stale re-broadcast) is not blocked by the clear.
    act(() => { fireSSE('agent-update', { ...agent, lastPrompt }) })
    expect(JSON.parse(localStorage.getItem(keyFor(271)) ?? 'null')).toEqual({ ...lastPrompt, source: 'hook' })
  })

  it('the initial /status load mirrors live agents before the sweep, so a live payload survives and a stale one is dropped', async () => {
    const live: Agent = { ...baseAgent(null), id: 272, name: 'interplay-live', lastPrompt: { text: 'from status', ts: '2026-09-20T11:00:00.000Z' } }
    localStorage.setItem(keyFor(273), JSON.stringify({ text: 'stale', ts: '2026-09-20T09:00:00.000Z', source: 'hook' }))
    stubAgentDetailFetch(live)
    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: 'interplay-live detail' })

    expect(JSON.parse(localStorage.getItem(keyFor(272)) ?? 'null')).toEqual({ text: 'from status', ts: '2026-09-20T11:00:00.000Z', source: 'hook' })
    expect(localStorage.getItem(keyFor(273))).toBeNull()
  })
})
