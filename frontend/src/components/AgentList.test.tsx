import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

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
import InactiveAgentsPanel from './InactiveAgentsPanel'
import AgentsPage from '../pages/AgentsPage'
import { SIDEBAR_WIDTH_PX } from '../lib/layoutConstants'
// RTL's auto-cleanup registration relies on vitest's `test.globals: true`, which this repo
// does not set (see vitest.setup.ts's own comment on the same constraint for jest-dom) — so
// without this, render() output from one test leaks into the next test's DOM within this
// file, causing "multiple elements found" failures the moment more than one render()-based
// test exists here. Explicit, not implicit.
afterEach(() => { cleanup() })

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
    linkedBg: null,
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
  // from AgentList's own board — they render in InactiveAgentsPanel.tsx instead,
  // a separate component this file does not cover — so STATUS_CONFIG.exited's deliberately
  // partial tokenization (bg tokenized, text/dot kept as the literal #e5484d per the TASK-150
  // Step 4 note) is not reachable/assertable through AgentList's own render tree. Flagged as
  // a gap in UAT-150 rather than asserted against a component that doesn't render it.
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

  it('docks a collapsed "Inactive Agents" section between the filter and the first project group (TASK-0177)', async () => {
    stubSidebarFetch([...groupedAgents(), { ...baseAgent(null), id: 9, name: 'sleepy-one', state: 'exited' }])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByText('alpha-ui')
    const toggle = await within(sidebar).findByRole('button', { name: /Inactive Agents \(1\)/ })

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // Collapsed: the inactive row is not rendered yet.
    expect(within(sidebar).queryByText('sleepy-one')).toBeNull()

    const filter = within(sidebar).getByLabelText('Filter agents')
    const firstGroupHeader = sidebar.querySelector('p') as HTMLElement
    expect(firstGroupHeader.textContent).toBe('Alpha2')
    expect(filter.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toggle.compareDocumentPosition(firstGroupHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(toggle)
    expect(await within(sidebar).findByText('sleepy-one')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('shows "No active agents." with the inactive section still visible when every registered agent is inactive (TASK-0177)', async () => {
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

    const toggle = await within(sidebar).findByRole('button', { name: /Inactive Agents \(2\)/ })
    fireEvent.click(toggle)
    expect(await within(sidebar).findByText('sleepy-one')).toBeInTheDocument()
    expect(within(sidebar).getByText('sleepy-two')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('keeps the inactive section count and rows unchanged while the sidebar filter narrows the project groups (TASK-0177 UAT-EDGE-006a)', async () => {
    stubSidebarFetch([
      ...groupedAgents(),
      { ...baseAgent(null), id: 8, name: 'sleepy-one', state: 'exited' },
      { ...baseAgent(null), id: 9, name: 'sleepy-two', windowPresent: false, state: 'no-window' },
    ])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByText('alpha-ui')
    const toggle = await within(sidebar).findByRole('button', { name: /Inactive Agents \(2\)/ })
    fireEvent.click(toggle)
    expect(await within(sidebar).findByText('sleepy-one')).toBeInTheDocument()

    const filter = within(sidebar).getByLabelText('Filter agents')

    // A filter matching only the Alpha agents narrows the groups but not the inactive section.
    fireEvent.change(filter, { target: { value: 'alpha' } })
    expect(within(sidebar).getByText('alpha-ui')).toBeInTheDocument()
    expect(within(sidebar).queryByText('beta-api')).toBeNull()
    expect(within(sidebar).queryByText('zeta-loose')).toBeNull()
    expect(within(sidebar).getByRole('button', { name: /Inactive Agents \(2\)/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(sidebar).getByText('sleepy-one')).toBeInTheDocument()
    expect(within(sidebar).getByText('sleepy-two')).toBeInTheDocument()

    // A filter matching nothing empties the groups; the section is still there with the same count and rows.
    fireEvent.change(filter, { target: { value: 'zzz-no-such-agent' } })
    expect(within(sidebar).getByText('No agents match your filter.')).toBeInTheDocument()
    expect(within(sidebar).getByRole('button', { name: /Inactive Agents \(2\)/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(sidebar).getByText('sleepy-one')).toBeInTheDocument()
    expect(within(sidebar).getByText('sleepy-two')).toBeInTheDocument()

    // Clearing the filter returns the full grouped list with the section untouched.
    fireEvent.change(filter, { target: { value: '' } })
    expect(Array.from(sidebar.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['Alpha2', 'Beta1', 'Unassigned1'])
    expect(within(sidebar).getByRole('button', { name: /Inactive Agents \(2\)/ })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('lists an error-status agent both in its project group and in the expanded inactive section (TASK-0177 UAT-EDGE-006b)', async () => {
    stubSidebarFetch([
      ...groupedAgents(),
      { ...baseAgent(null), id: 9, name: 'errored-one', projectId: 20, projectName: 'Beta', state: 'error' },
    ])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    const activeRow = await within(sidebar).findByRole('button', { name: 'errored-one detail' })

    // Active side: a row inside the Beta group (count 2), painted with the error right border.
    expect(Array.from(sidebar.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['Alpha2', 'Beta2', 'Unassigned1'])
    expect(activeRow.style.borderRightColor).toBe(normalizedColor('#e5484d'))

    // Inactive side: the same agent counts toward the section and lists once expanded, labelled "error".
    const toggle = within(sidebar).getByRole('button', { name: /Inactive Agents \(1\)/ })
    fireEvent.click(toggle)
    const matches = await within(sidebar).findAllByText('errored-one')
    expect(matches).toHaveLength(2)
    const inactiveRow = matches
      .map((m) => m.closest('li'))
      .find((li): li is HTMLLIElement => li !== null && li.title === '/tmp/test')
    expect(inactiveRow).toBeDefined()
    expect(within(inactiveRow as HTMLElement).getByText('error')).toBeInTheDocument()
    expect((inactiveRow as HTMLElement).style.borderRightColor).toBe(normalizedColor('#e5484d'))
    // Two distinct DOM rows: one in the group list, one in the inactive section.
    expect(sidebar.contains(activeRow)).toBe(true)
    expect((inactiveRow as HTMLElement).contains(activeRow)).toBe(false)

    vi.unstubAllGlobals()
  })

  it('AgentsPage renders no Inactive Agents control or card wrapper outside the sidebar (TASK-0177 UAT-UI-001)', async () => {
    stubSidebarFetch([...groupedAgents(), { ...baseAgent(null), id: 9, name: 'sleepy-one', state: 'exited' }])

    const { container } = render(<AgentsPage />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    await within(sidebar).findByRole('button', { name: /Inactive Agents \(1\)/ })

    // Exactly one control, and it lives inside the sidebar.
    const controls = screen.getAllByRole('button', { name: /Inactive Agents/ })
    expect(controls).toHaveLength(1)
    const control = controls[0] as HTMLElement
    expect(sidebar.contains(control)).toBe(true)
    expect(control).toHaveAttribute('aria-expanded', 'false')

    // No panel text outside the sidebar, and the section carries no card chrome.
    const main = container.querySelector('main') as HTMLElement
    expect(main).not.toBeNull()
    const occurrences = (text: string | null): number => (text?.match(/Inactive Agents/g) ?? []).length
    expect(occurrences(sidebar.textContent)).toBe(1)
    expect(occurrences(main.textContent)).toBe(1)
    expect(occurrences(document.body.textContent)).toBe(1)
    const section = control.closest('div.animate-riseIn') as HTMLElement
    expect(section).not.toBeNull()
    const sectionClasses = section.className.split(/\s+/)
    expect(sectionClasses).toContain('border-b')
    expect(sectionClasses).not.toContain('shadow-card')
    expect(sectionClasses).not.toContain('rounded-card')

    vi.unstubAllGlobals()
  })

  it('orders rows within a project group by status urgency, then by name case-insensitively', async () => {
    // Names are chosen so alphabetical order is the REVERSE of urgency order.
    stubSidebarFetch([
      { ...baseAgent(null), id: 1, name: 'a-idle', projectId: 10, projectName: 'Alpha', state: 'idle' },
      { ...baseAgent(null), id: 2, name: 'b-busy', projectId: 10, projectName: 'Alpha', state: 'busy' },
      { ...baseAgent(null), id: 3, name: 'c-await', projectId: 10, projectName: 'Alpha', state: 'awaiting' },
      // Same status (busy): case-insensitive name order puts 'apple' before 'Banana'
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

    expect(precedes('c-await', 'b-busy')).toBe(true)
    expect(precedes('b-busy', 'a-idle')).toBe(true)
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
      name: 'my-bg-process',
      workdir: '/tmp/bg',
      launchCmd: 'npm run watch',
      windowPresent: true,
      state: null,
      logPath: '/tmp/bg.log',
      statePath: '/tmp/bg.state',
      linkedAgent: null,
      projectId: null,
      projectName: null,
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

    const input = screen.getByLabelText('Filter agents')
    fireEvent.change(input, { target: { value: 'zzz-no-such-agent' } })

    expect(await screen.findByText('No agents match your filter.')).toBeInTheDocument()
    expect(screen.queryByText('alpha-backend')).toBeNull()
    // Background-process cards are a separate section (BgProcessSection, driven by its own
    // `bgs` state) — the agent filter must never reach into it.
    expect(screen.getByText('my-bg-process')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('groups background processes under per-project sub-headers, ordered like the agent grouping, with unassigned last (TASK-161)', async () => {
    const agentAlpha: Agent = { ...baseAgent(null), id: 1, name: 'solo-agent' }
    const bgZ1: BgProcess = {
      name: 'zeta-watcher',
      workdir: '/tmp/zeta',
      launchCmd: 'npm run watch',
      windowPresent: true,
      state: null,
      logPath: '/tmp/zeta.log',
      statePath: '/tmp/zeta.state',
      linkedAgent: null,
      projectId: 10,
      projectName: 'zeta-project',
    }
    const bgZ2: BgProcess = { ...bgZ1, name: 'zeta-builder' }
    const bgA1: BgProcess = {
      name: 'alpha-runner',
      workdir: '/tmp/alpha',
      launchCmd: 'npm run dev',
      windowPresent: true,
      state: null,
      logPath: '/tmp/alpha.log',
      statePath: '/tmp/alpha.state',
      linkedAgent: null,
      projectId: 20,
      projectName: 'alpha-project',
    }
    const bgUnassigned: BgProcess = {
      name: 'stray-process',
      workdir: '/tmp/stray',
      launchCmd: 'npm run stray',
      windowPresent: true,
      state: null,
      logPath: '/tmp/stray.log',
      statePath: '/tmp/stray.state',
      linkedAgent: null,
      projectId: null,
      projectName: null,
    }

    stubEventSourceAndFetch({
      session: 'test-session',
      sessionAlive: true,
      sessionExists: true,
      agents: [agentAlpha],
      bgProcesses: [bgZ1, bgZ2, bgA1, bgUnassigned],
      timestamp: new Date().toISOString(),
    })

    render(<AgentList />)
    expect(await screen.findByText('solo-agent')).toBeInTheDocument()

    // Sub-headers: project name (case-insensitive alpha order), unassigned last —
    // the same ordering convention BgProcessSection borrows from the agent
    // list's byProjectThenStatus/groupByProject grouping.
    const heading = screen.getByText('Background processes')
    const section = heading.parentElement as HTMLElement
    const headerEls = Array.from(section.querySelectorAll('p'))
    const headerTexts = headerEls.map((el) => el.textContent)
    expect(headerTexts).toEqual(['alpha-project', 'zeta-project', 'Unassigned'])

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
    expect(rowNamesFor(headerAt(2))).toEqual(['stray-process'])

    vi.unstubAllGlobals()
  })
})

// TASK-161-uat-fix: the inline Edit affordance added to each BgProcessSection
// row — editing workdir/launchCmd/project and saving calls the new
// PATCH /bg-processes/:name route, then applies the response to local state
// directly (see AgentList.tsx's handleBgUpdated comment: the poll loop's
// bg-update SSE broadcast only fires on windowPresent/state/linkedAgent
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

  it('editing workdir/launchCmd/project and saving PATCHes /bg-processes/:name and renders the new values', async () => {
    const agent: Agent = { ...baseAgent(null), id: 1, name: 'solo-agent' }
    const bg: BgProcess = {
      name: 'editable-bg',
      workdir: '/tmp/before',
      launchCmd: 'npm run before',
      windowPresent: true,
      state: null,
      logPath: '/tmp/before.log',
      statePath: '/tmp/before.state',
      linkedAgent: null,
      projectId: null,
      projectName: null,
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
        expect(name).toBe('editable-bg')
        expect(body).toEqual({ workdir: '/tmp/after', launchCmd: 'npm run after', projectId: 2 })
        return {
          ok: true,
          json: () => ({ id: 1, name: 'editable-bg', workdir: '/tmp/after', launchCmd: 'npm run after', linkedAgentId: null, projectId: 2 }),
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
      name: 'cancel-bg',
      workdir: '/tmp/orig',
      launchCmd: 'npm run orig',
      windowPresent: true,
      state: null,
      logPath: '/tmp/orig.log',
      statePath: '/tmp/orig.state',
      linkedAgent: null,
      projectId: null,
      projectName: null,
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
// Cycling follows the sidebar's flat order (project, then status urgency, then name), not a
// global name sort, and stays independent of the sidebar's text filter. The toast / row-CTA
// paths select the agent with Direct Input armed (LogTail interactSignal 1); a plain row click
// leaves it 0.
describe('AgentList cycling order and arm-interact against the pane selection (TASK-0174)', () => {
  const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
  const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'

  // Sidebar order: Project A -> charlie (busy) , alpha (idle), delta (idle); Project B -> bravo.
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

  it('Shift+Cmd+Right walks the sidebar order (status urgency within a project, then the next project) and wraps at the end; Left wraps backwards', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
    stubFetchWithAgents(fixture)

    render(<AgentList />)
    await openAgent('charlie')

    for (const next of ['alpha', 'delta', 'bravo', 'charlie']) {
      fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
      expect(await screen.findByRole('region', { name: `${next} detail` })).toBeInTheDocument()
    }

    // Left from the first sidebar row wraps to the last one (bravo, Project B).
    fireEvent.keyDown(document, { key: 'ArrowLeft', metaKey: true, shiftKey: true })
    expect(await screen.findByRole('region', { name: 'bravo detail' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'ArrowLeft', metaKey: true, shiftKey: true })
    expect(await screen.findByRole('region', { name: 'delta detail' })).toBeInTheDocument()
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
    // Next from the last row wraps to charlie, which the filter hides from the sidebar.
    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
    expect(await screen.findByRole('region', { name: 'charlie detail' })).toBeInTheDocument()
    expect(within(sidebar).queryByRole('button', { name: 'charlie detail' })).toBeNull()
  })

  it('the shortcut is OS-aware: Shift+Ctrl cycles off-Mac and Shift+Cmd does not', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(LINUX_UA)
    stubFetchWithAgents(fixture)

    render(<AgentList />)
    await openAgent('charlie')

    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
    expect(screen.getByRole('region', { name: 'charlie detail' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true, shiftKey: true })
    expect(await screen.findByRole('region', { name: 'alpha detail' })).toBeInTheDocument()
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

  it('a toast click selects the agent, shows the Terminal tab and arms Direct Input (interactSignal 1), even while a different agent is selected', async () => {
    const a: Agent = { ...baseAgent(null), id: 51, name: 'arm-a', state: 'busy' }
    const b: Agent = { ...baseAgent(null), id: 52, name: 'arm-b', state: 'busy' }
    stubFetchWithAgents([a, b])

    render(<AgentList />)
    await openAgent('arm-a')
    expect(within(screen.getByRole('region', { name: 'arm-a detail' })).getByTestId('mock-log-tail')).toHaveAttribute('data-interact-signal', '0')

    vi.useFakeTimers()
    act(() => { fireSSE('agent-update', { ...b, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })
    const toast = screen.getByRole('button', { name: `arm-b ${STATUS_CONFIG.awaiting.label}` })
    vi.useRealTimers()

    fireEvent.click(toast)

    const paneB = await screen.findByRole('region', { name: 'arm-b detail' })
    expect(within(paneB).getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true')
    expect(within(paneB).getByTestId('mock-log-tail')).toHaveAttribute('data-interact-signal', '1')
  })

  it('a toast is suppressed at fire time for the currently selected agent, but not for one that was selected only after the transition', async () => {
    const a: Agent = { ...baseAgent(null), id: 61, name: 'sup-a', state: 'busy' }
    const b: Agent = { ...baseAgent(null), id: 62, name: 'sup-b', state: 'busy' }
    stubFetchWithAgents([a, b])

    render(<AgentList />)
    await openAgent('sup-a')

    // Selected agent A enters awaiting: no toast.
    vi.useFakeTimers()
    act(() => { fireSSE('agent-update', { ...a, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })
    expect(screen.queryByRole('button', { name: `sup-a ${STATUS_CONFIG.awaiting.label}` })).toBeNull()

    // B enters awaiting while A is selected: the toast fires for B.
    act(() => { fireSSE('agent-update', { ...b, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })
    expect(screen.getByRole('button', { name: `sup-b ${STATUS_CONFIG.awaiting.label}` })).toBeInTheDocument()
  })

  it('suppresses a toast already scheduled for an agent that is selected during the grace period (checked at fire time, not schedule time)', async () => {
    const a: Agent = { ...baseAgent(null), id: 71, name: 'grace-a', state: 'busy' }
    const b: Agent = { ...baseAgent(null), id: 72, name: 'grace-b', state: 'busy' }
    const c: Agent = { ...baseAgent(null), id: 73, name: 'grace-c', state: 'busy' }
    stubFetchWithAgents([a, b, c])

    render(<AgentList />)
    await openAgent('grace-a')

    vi.useFakeTimers()
    // B enters awaiting while A is selected: its toast is scheduled, not yet fired.
    act(() => { fireSSE('agent-update', { ...b, state: 'awaiting' }) })
    expect(screen.queryByRole('button', { name: `grace-b ${STATUS_CONFIG.awaiting.label}` })).toBeNull()

    // The user selects B before the grace period elapses.
    const sidebar = screen.getByRole('complementary', { name: 'Agents' })
    fireEvent.click(within(sidebar).getByRole('button', { name: 'grace-b detail' }))
    expect(screen.getByRole('region', { name: 'grace-b detail' })).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })
    expect(screen.queryByRole('button', { name: `grace-b ${STATUS_CONFIG.awaiting.label}` })).toBeNull()

    // Control: an agent that is not selected still gets its toast.
    act(() => { fireSSE('agent-update', { ...c, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })
    expect(screen.getByRole('button', { name: `grace-c ${STATUS_CONFIG.awaiting.label}` })).toBeInTheDocument()
  })

  it.each(['no-window', 'exited'] as const)('is a no-op for Shift+Cmd+Arrow when the selected agent turns %s and is the only inactive agent (TASK-0178): the pane stays mounted, the prev/next buttons hide, and no active agent is selected', async (nextState) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
    const gone: Agent = { ...baseAgent(null), id: 81, name: 'noop-gone', state: 'busy', windowPresent: true }
    const x: Agent = { ...baseAgent(null), id: 82, name: 'noop-x', state: 'idle' }
    const y: Agent = { ...baseAgent(null), id: 83, name: 'noop-y', state: 'idle' }
    stubFetchWithAgents([gone, x, y])

    render(<AgentList />)
    await openAgent('noop-gone')
    const pane = screen.getByRole('region', { name: 'noop-gone detail' })
    expect(within(pane).getByRole('button', { name: 'Next agent' })).toBeInTheDocument()

    act(() => { fireSSE('agent-update', { ...gone, state: nextState, windowPresent: false }) })
    const sidebar = screen.getByRole('complementary', { name: 'Agents' })
    await waitFor(() => { expect(within(sidebar).queryByRole('button', { name: 'noop-gone detail' })).toBeNull() })
    expect(screen.getByRole('region', { name: 'noop-gone detail' })).toBe(pane)
    // The view now cycles within the inactive set, which holds only this agent.
    await waitFor(() => { expect(within(pane).queryByRole('button', { name: 'Next agent' })).toBeNull() })
    expect(within(pane).queryByRole('button', { name: 'Previous agent' })).toBeNull()

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

  describe('inactive selection via InactiveAgentsPanel (TASK-0178)', () => {
    const inactiveFixture = (): Agent[] => [
      { ...baseAgent(null), id: 101, name: 'live-one', state: 'idle', windowPresent: true },
      { ...baseAgent(null), id: 102, name: 'live-two', state: 'busy', windowPresent: true },
      { ...baseAgent(null), id: 103, name: 'sleep-a', state: 'exited', windowPresent: false },
      { ...baseAgent(null), id: 104, name: 'sleep-b', state: 'no-window', windowPresent: false },
    ]

    async function openInactive(name: string) {
      const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
      fireEvent.click(await within(sidebar).findByRole('button', { name: /Inactive Agents/ }))
      fireEvent.click((await within(sidebar).findByText(name)).closest('li') as HTMLElement)
      return { sidebar, pane: await screen.findByRole('region', { name: `${name} detail` }) }
    }

    it('clicking an inactive row selects it into the main pane (no dialog), marks the row aria-current, and shows the windowless Details marker', async () => {
      stubFetchWithAgents(inactiveFixture())

      render(<AgentList />)
      const { sidebar, pane } = await openInactive('sleep-a')

      expect(screen.queryByRole('dialog')).toBeNull()
      const row = within(sidebar).getByText('sleep-a').closest('li') as HTMLElement
      expect(row).toHaveAttribute('aria-current', 'true')
      expect(within(sidebar).getByText('sleep-b').closest('li')).not.toHaveAttribute('aria-current')
      expect(within(pane).getByRole('tab', { name: 'Terminal' })).toBeInTheDocument()
      // No tmux window: the Details tab carries the missing-window marker.
      expect(within(pane).getByRole('tab', { name: /^Details •/ })).toBeInTheDocument()
    })

    it('does not collapse the inactive section when a row is clicked', async () => {
      stubFetchWithAgents(inactiveFixture())

      render(<AgentList />)
      const { sidebar } = await openInactive('sleep-a')

      expect(within(sidebar).getByRole('button', { name: /Inactive Agents/ })).toHaveAttribute('aria-expanded', 'true')
    })

    it('Shift+Cmd+Right from an inactive agent moves to the next inactive agent and stops at the end; Left stops at the start', async () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
      stubFetchWithAgents(inactiveFixture())

      render(<AgentList />)
      await openInactive('sleep-a')

      fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
      expect(await screen.findByRole('region', { name: 'sleep-b detail' })).toBeInTheDocument()

      // Non-wrapping: Right from the last inactive agent stays put (never jumps into the active set).
      fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
      await act(async () => { await Promise.resolve() })
      expect(screen.getByRole('region', { name: 'sleep-b detail' })).toBeInTheDocument()

      fireEvent.keyDown(document, { key: 'ArrowLeft', metaKey: true, shiftKey: true })
      expect(await screen.findByRole('region', { name: 'sleep-a detail' })).toBeInTheDocument()
      fireEvent.keyDown(document, { key: 'ArrowLeft', metaKey: true, shiftKey: true })
      await act(async () => { await Promise.resolve() })
      expect(screen.getByRole('region', { name: 'sleep-a detail' })).toBeInTheDocument()
    })

    it('the view counter follows the selection: two inactive agents show the prev/next buttons, and from an active agent the active list still wraps', async () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
      stubFetchWithAgents(inactiveFixture())

      render(<AgentList />)
      const { sidebar, pane } = await openInactive('sleep-a')
      expect(within(pane).getByRole('button', { name: 'Next agent' })).toBeInTheDocument()

      fireEvent.click(within(sidebar).getByRole('button', { name: 'live-one detail' }))
      await screen.findByRole('region', { name: 'live-one detail' })
      // Two active agents: Right goes to the other one and the next Right wraps back,
      // never into the inactive set.
      fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
      expect(await screen.findByRole('region', { name: 'live-two detail' })).toBeInTheDocument()
      fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
      expect(await screen.findByRole('region', { name: 'live-one detail' })).toBeInTheDocument()
    })
  })

  // UAT-0178 UAT-EDGE-009: `error` is in both ACTIVE_STATUSES and INACTIVE_STATUSES. The active list
  // is authoritative for handleNavigate, even when the agent was selected from the inactive panel.
  it('cycles the active list (wrapping) when an error agent is selected from the inactive panel', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
    stubFetchWithAgents([
      { ...baseAgent(null), id: 101, name: 'live-one', state: 'idle', windowPresent: true },
      { ...baseAgent(null), id: 102, name: 'live-two', state: 'busy', windowPresent: true },
      { ...baseAgent(null), id: 103, name: 'err-one', state: 'error', windowPresent: false },
      { ...baseAgent(null), id: 104, name: 'sleep-a', state: 'exited', windowPresent: false },
    ])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    const toggle = await within(sidebar).findByRole('button', { name: /Inactive Agents/ })
    fireEvent.click(toggle)
    // err-one also renders as an active sidebar row, so scope the click to the inactive panel.
    const panel = toggle.parentElement as HTMLElement
    fireEvent.click((await within(panel).findByText('err-one')).closest('li') as HTMLElement)
    await screen.findByRole('region', { name: 'err-one detail' })

    // Active sidebar order is live-two (busy), live-one (idle), err-one (error): Right from the
    // last active agent wraps to the first, rather than moving to the next inactive agent (sleep-a).
    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
    expect(await screen.findByRole('region', { name: 'live-two detail' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'sleep-a detail' })).toBeNull()
  })

  it('the view counter for an error agent selected from the inactive panel is the active count, not the inactive count', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
    // err-one is the ONLY inactive-set agent, so an inactive-list counter would be 1 and hide the
    // prev/next buttons; the active list (3 agents) keeps them visible.
    stubFetchWithAgents([
      { ...baseAgent(null), id: 101, name: 'live-one', state: 'idle', windowPresent: true },
      { ...baseAgent(null), id: 102, name: 'live-two', state: 'busy', windowPresent: true },
      { ...baseAgent(null), id: 103, name: 'err-one', state: 'error', windowPresent: false },
    ])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    const toggle = await within(sidebar).findByRole('button', { name: /Inactive Agents/ })
    fireEvent.click(toggle)
    fireEvent.click((await within(toggle.parentElement as HTMLElement).findByText('err-one')).closest('li') as HTMLElement)
    const pane = await screen.findByRole('region', { name: 'err-one detail' })

    expect(within(pane).getByRole('button', { name: 'Next agent' })).toBeInTheDocument()
    expect(within(pane).getByRole('button', { name: 'Previous agent' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
    expect(await screen.findByRole('region', { name: 'live-two detail' })).toBeInTheDocument()
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
  it('shows Stop/Destroy as icon buttons beside the menu, which lists only Rename, Change role, Clone', async () => {
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
    expect(menuItems.map((el) => el.textContent)).toEqual(['Rename', 'Change role', 'Clone'])

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
    expect(menuItems.map((el) => el.textContent)).toEqual(['Rename', 'Change role', 'Clone'])

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

    render(<AgentDetailView agent={agent} project={null} projectId={null} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
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

    render(<AgentDetailView agent={agent} project={null} projectId={null} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    const dialog = document.body

    expect(within(dialog).getByRole('tab', { name: 'Details' })).toBeInTheDocument()
  })

  it('labels the Details tab "Details •" when agent.windowPresent is false', () => {
    const agent: Agent = { ...baseAgent(null), id: 3, name: 'details-absent-agent', windowPresent: false }
    stubAgentDetailFetch(agent)

    render(<AgentDetailView agent={agent} project={null} projectId={null} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    const dialog = document.body

    expect(within(dialog).getByRole('tab', { name: 'Details •' })).toBeInTheDocument()
  })

  it('shows the Create window button and "Window: missing" in the Details tab when agent.windowPresent is false (TASK-0178)', () => {
    const agent: Agent = { ...baseAgent(null), id: 31, name: 'no-window-agent', state: 'exited', windowPresent: false }
    stubAgentDetailFetch(agent)

    render(<AgentDetailView agent={agent} project={null} projectId={null} status="exited" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    fireEvent.click(within(document.body).getByRole('tab', { name: 'Details •' }))

    expect(within(document.body).getByRole('button', { name: 'Create window' })).toBeInTheDocument()
    expect(within(document.body).getByText('missing')).toBeInTheDocument()
  })

  it('omits the Create window button from the Details tab when agent.windowPresent is true (TASK-0178)', () => {
    const agent: Agent = { ...baseAgent(null), id: 32, name: 'window-agent', windowPresent: true }
    stubAgentDetailFetch(agent)

    render(<AgentDetailView agent={agent} project={null} projectId={null} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    fireEvent.click(within(document.body).getByRole('tab', { name: 'Details' }))

    expect(within(document.body).queryByRole('button', { name: 'Create window' })).toBeNull()
    expect(within(document.body).getByText('present')).toBeInTheDocument()
  })

  it('labels the Queued Tasks tab with the agent.queuedTasks count, including zero', () => {
    const zeroAgent: Agent = { ...baseAgent(null), id: 4, name: 'queued-zero-agent', queuedTasks: 0 }
    stubAgentDetailFetch(zeroAgent)
    const { unmount } = render(<AgentDetailView agent={zeroAgent} project={null} projectId={null} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    const zeroDialog = document.body
    expect(within(zeroDialog).getByRole('tab', { name: 'Queued tasks (0)' })).toBeInTheDocument()
    unmount()

    const fiveAgent: Agent = { ...baseAgent(null), id: 5, name: 'queued-five-agent', queuedTasks: 5 }
    stubAgentDetailFetch(fiveAgent)
    render(<AgentDetailView agent={fiveAgent} project={null} projectId={null} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
    const fiveDialog = document.body
    expect(within(fiveDialog).getByRole('tab', { name: 'Queued tasks (5)' })).toBeInTheDocument()
  })

  it('renders the moved Details content — Command/Workdir fields and the ModeSwitcher — when the Details tab is selected', () => {
    const agent: Agent = { ...baseAgent(null), id: 6, name: 'details-content-agent', launchCmd: 'claude --resume', workdir: '/tmp/details-content' }
    stubAgentDetailFetch(agent)

    render(<AgentDetailView agent={agent} project={null} projectId={null} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
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

    render(<AgentDetailView agent={agent} project={null} projectId={null} status="idle" onClose={vi.fn()} agentCount={1} onNavigate={vi.fn()} />)
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
    render(<AgentDetailView agent={agent} project={null} projectId={null} status="idle" onClose={onViewClose} agentCount={1} onNavigate={vi.fn()} />)
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

    render(<AgentDetailView agent={agent} project={null} projectId={null} status="idle" onClose={onClose} agentCount={1} onNavigate={vi.fn()} />)

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
    render(<AgentDetailView agent={agent} project={null} projectId={null} status="idle" onClose={vi.fn()} agentCount={2} onNavigate={onNavigate} />)
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

  it('shows the most-recent-dispatched-command row directly under the header when agent.activeTask is set', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 3, name: 'active-task-agent', activeTask: 'npm run build' }
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

  it('renders no most-recent-command row when agent.activeTask is null', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 4, name: 'no-active-task-agent', activeTask: null }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'no-active-task-agent detail' }))
    const dialog = await screen.findByRole('region', { name: 'no-active-task-agent detail' })

    expect(within(dialog).queryByTitle('npm run build')).toBeNull()

    vi.unstubAllGlobals()
  })
})

// ── NotificationStack grace-period toasts (TASK-146 Step 3) ────────────────
//
// The grace-period bookkeeping (pendingNotifyTimersRef, the `notifications` map,
// the "modal already open" suppression) all lives inside AgentList's own
// `agent-update`/`agent-removed` SSE handlers — NotificationStack itself is a dumb
// renderer of whatever `notifications` it's given. So, unlike the no-op
// MockEventSource stubs used elsewhere in this file (which only need
// `new EventSource(...)` to not throw, because those tests never exercise SSE
// delivery), these tests need a stub that actually captures and can re-invoke the
// listeners useSSE.ts's `attachListener` registers via `addEventListener`, so a
// test can synthesize the same MessageEvent shape the real `/events` stream would
// deliver. `capturedEventSource` is reset per-test in `beforeEach` below (mirroring
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
// so without a stub the very first busy→awaiting transition in each test below would
// throw. Concrete no-op nodes (not a Proxy/`any`) matching exactly the calls
// playDoorbell/playChime make (`createGain`, `createOscillator`, `.gain`/`.frequency`
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

// Mirrors AgentList.tsx's own (module-private, unexported) NOTIFICATION_GRACE_MS.
const NOTIFICATION_GRACE_MS = 3000

describe('NotificationStack grace-period toasts (TASK-146 Step 3)', () => {
  beforeEach(() => {
    capturedEventSource = null
    vi.stubGlobal('EventSource', CapturingEventSource)
    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not show a toast before NOTIFICATION_GRACE_MS elapses on an awaiting transition, and shows it after with the agent name and "waiting" label', async () => {
    const agent: Agent = { ...baseAgent(null), id: 1, name: 'grace-agent', state: 'busy' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    await screen.findByText('grace-agent')

    vi.useFakeTimers()
    act(() => { fireSSE('agent-update', { ...agent, state: 'awaiting' }) })

    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS - 1) })
    expect(screen.queryByRole('button', { name: `grace-agent ${STATUS_CONFIG.awaiting.label}` })).toBeNull()

    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('button', { name: `grace-agent ${STATUS_CONFIG.awaiting.label}` })).toBeInTheDocument()
  })

  it('never shows a toast when an awaiting transition reverts to busy before the grace period elapses', async () => {
    const agent: Agent = { ...baseAgent(null), id: 2, name: 'revert-agent', state: 'busy' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    await screen.findByText('revert-agent')

    vi.useFakeTimers()
    act(() => { fireSSE('agent-update', { ...agent, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS - 500) })
    act(() => { fireSSE('agent-update', { ...agent, state: 'busy' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })

    expect(screen.queryByRole('button', { name: `revert-agent ${STATUS_CONFIG.awaiting.label}` })).toBeNull()
  })

  it('removes a shown toast immediately (no grace period on the way out) once the agent leaves awaiting/empty', async () => {
    const agent: Agent = { ...baseAgent(null), id: 3, name: 'leave-agent', state: 'busy' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    await screen.findByText('leave-agent')

    vi.useFakeTimers()
    act(() => { fireSSE('agent-update', { ...agent, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })
    expect(screen.getByRole('button', { name: `leave-agent ${STATUS_CONFIG.awaiting.label}` })).toBeInTheDocument()

    act(() => { fireSSE('agent-update', { ...agent, state: 'busy' }) })
    expect(screen.queryByRole('button', { name: `leave-agent ${STATUS_CONFIG.awaiting.label}` })).toBeNull()
  })

  it('dismissing a toast via its ✕ button removes it and does not open the agent detail modal', async () => {
    const agent: Agent = { ...baseAgent(null), id: 4, name: 'dismiss-agent', state: 'busy' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    await screen.findByText('dismiss-agent')

    vi.useFakeTimers()
    act(() => { fireSSE('agent-update', { ...agent, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })
    expect(screen.getByRole('button', { name: `dismiss-agent ${STATUS_CONFIG.awaiting.label}` })).toBeInTheDocument()
    vi.useRealTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss dismiss-agent notification' }))

    expect(screen.queryByRole('button', { name: `dismiss-agent ${STATUS_CONFIG.awaiting.label}` })).toBeNull()
    expect(screen.queryByRole('region', { name: 'dismiss-agent detail' })).toBeNull()
  })

  it("clicking a toast's body opens the agent detail modal (armed for Direct Input) and removes the toast", async () => {
    const agent: Agent = { ...baseAgent(null), id: 5, name: 'open-agent', state: 'busy' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    await screen.findByText('open-agent')

    vi.useFakeTimers()
    act(() => { fireSSE('agent-update', { ...agent, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })
    const toast = screen.getByRole('button', { name: `open-agent ${STATUS_CONFIG.awaiting.label}` })
    vi.useRealTimers()

    fireEvent.click(toast)

    // setExpandedAgent({ id: agent.id, armInteract: true }) selects the agent, rendering
    // AgentDetailView in the main pane — asserted via the pane region's aria-label appearing.
    expect(await screen.findByRole('region', { name: 'open-agent detail' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `open-agent ${STATUS_CONFIG.awaiting.label}` })).toBeNull()
  })

  it('creates no toast for an agent whose detail modal is already open when its status enters awaiting', async () => {
    const agent: Agent = { ...baseAgent(null), id: 6, name: 'open-modal-agent', state: 'busy' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'open-modal-agent detail' }))
    await screen.findByRole('region', { name: 'open-modal-agent detail' })

    vi.useFakeTimers()
    act(() => { fireSSE('agent-update', { ...agent, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })

    expect(screen.queryByRole('button', { name: `open-modal-agent ${STATUS_CONFIG.awaiting.label}` })).toBeNull()
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

  it('agent-removed clears both a pending grace-period timer and an already-visible toast, without error', async () => {
    const pendingAgent: Agent = { ...baseAgent(null), id: 7, name: 'pending-removed-agent', state: 'busy' }
    const visibleAgent: Agent = { ...baseAgent(null), id: 8, name: 'visible-removed-agent', state: 'busy' }
    // Only pendingAgent needs to be in the initial /status payload — visibleAgent is
    // introduced purely via its own SSE agent-update below (AgentList's handler upserts
    // unknown ids into `agents`), matching how a freshly-spawned agent would arrive.
    stubAgentDetailFetch(pendingAgent)

    render(<AgentList />)
    await screen.findByText('pending-removed-agent')

    vi.useFakeTimers()

    // Pending-timer branch: enter awaiting, then remove before the grace period elapses.
    act(() => { fireSSE('agent-update', { ...pendingAgent, state: 'awaiting' }) })
    act(() => { fireSSE('agent-removed', { id: pendingAgent.id }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })
    expect(screen.queryByRole('button', { name: `pending-removed-agent ${STATUS_CONFIG.awaiting.label}` })).toBeNull()

    // Visible-toast branch: enter awaiting, let the toast show, then remove the agent.
    act(() => { fireSSE('agent-update', { ...visibleAgent, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })
    expect(screen.getByRole('button', { name: `visible-removed-agent ${STATUS_CONFIG.awaiting.label}` })).toBeInTheDocument()

    act(() => { fireSSE('agent-removed', { id: visibleAgent.id }) })
    expect(screen.queryByRole('button', { name: `visible-removed-agent ${STATUS_CONFIG.awaiting.label}` })).toBeNull()
  })

  // UAT-146 gap coverage: the existing suite above only ever drives the `awaiting`
  // branch of isNotifiable. `empty` is reached via a DIFFERENT source signal
  // (state: 'idle' with queuedTasks === 0 — see deriveStatus in AgentList.tsx),
  // not a literal `state: 'empty'`, so it needs its own transition to exercise.
  it('shows a toast for an `empty` transition (idle with zero queued tasks), with the "no tasks" label', async () => {
    const agent: Agent = { ...baseAgent(null), id: 9, name: 'empty-agent', state: 'busy' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    await screen.findByText('empty-agent')

    vi.useFakeTimers()
    act(() => { fireSSE('agent-update', { ...agent, state: 'idle', queuedTasks: 0 }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })

    expect(screen.getByRole('button', { name: `empty-agent ${STATUS_CONFIG.empty.label}` })).toBeInTheDocument()
  })

  it('the sr-only announcer mirrors the latest toast\'s text, and is present-but-empty before any toast shows', async () => {
    const agent: Agent = { ...baseAgent(null), id: 10, name: 'announce-agent', state: 'busy' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    await screen.findByText('announce-agent')

    // The persistent live-region must exist even with zero notifications — it is
    // never conditionally rendered per-toast (see NotificationStack.tsx comment).
    expect(screen.getByRole('status')).toHaveTextContent('')

    vi.useFakeTimers()
    act(() => { fireSSE('agent-update', { ...agent, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })

    expect(screen.getByRole('status')).toHaveTextContent(`announce-agent is ${STATUS_CONFIG.awaiting.label}`)
  })

  it('stacks multiple simultaneous toasts, and the announcer reflects only the most recently added', async () => {
    const agentA: Agent = { ...baseAgent(null), id: 11, name: 'stack-agent-a', state: 'busy' }
    const agentB: Agent = { ...baseAgent(null), id: 12, name: 'stack-agent-b', state: 'busy' }
    stubAgentDetailFetch(agentA)

    render(<AgentList />)
    await screen.findByText('stack-agent-a')

    vi.useFakeTimers()
    act(() => { fireSSE('agent-update', { ...agentA, state: 'awaiting' }) })
    act(() => { fireSSE('agent-update', { ...agentB, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })

    expect(screen.getByRole('button', { name: `stack-agent-a ${STATUS_CONFIG.awaiting.label}` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `stack-agent-b ${STATUS_CONFIG.awaiting.label}` })).toBeInTheDocument()
    // agentB was scheduled second, so it is the "latest" entry in the notifications
    // Map and the sole one mirrored into the announcer.
    expect(screen.getByRole('status')).toHaveTextContent(`stack-agent-b is ${STATUS_CONFIG.awaiting.label}`)
  })

  it('pressing Enter on a toast opens the modal (armed for Direct Input) and removes the toast, matching click behavior', async () => {
    const agent: Agent = { ...baseAgent(null), id: 13, name: 'keyboard-agent', state: 'busy' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    await screen.findByText('keyboard-agent')

    vi.useFakeTimers()
    act(() => { fireSSE('agent-update', { ...agent, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })
    const toast = screen.getByRole('button', { name: `keyboard-agent ${STATUS_CONFIG.awaiting.label}` })
    vi.useRealTimers()

    fireEvent.keyDown(toast, { key: 'Enter' })

    expect(await screen.findByRole('region', { name: 'keyboard-agent detail' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `keyboard-agent ${STATUS_CONFIG.awaiting.label}` })).toBeNull()
  })

  it('a toast never receives focus automatically when it mounts', async () => {
    const agent: Agent = { ...baseAgent(null), id: 14, name: 'no-autofocus-agent', state: 'busy' }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    await screen.findByText('no-autofocus-agent')

    vi.useFakeTimers()
    act(() => { fireSSE('agent-update', { ...agent, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })

    const toast = screen.getByRole('button', { name: `no-autofocus-agent ${STATUS_CONFIG.awaiting.label}` })
    expect(document.activeElement).not.toBe(toast)
  })
})

// ── Sidebar + pane selection coverage gaps (TASK-0173 UAT) ─────────────────
//
// Closes the "missing assertion" gaps UAT-0173 recorded: the sidebar's inline width, the
// selected row's highlight classes, a selected agent leaving the active set, the empty state
// returning after Stop/Destroy, onCloned re-pointing the selection, and a toast click driving
// all the way through AgentList to an active Terminal tab. All of it is jsdom-level (class
// lists, inline style, DOM presence) — pixel geometry stays a live-only concern.
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

  it('a toast click drives through AgentList to the target agent pane with its Terminal tab active, replacing another agent\'s pane and tab', async () => {
    const a: Agent = { ...baseAgent(null), id: 31, name: 'toast-pane-a', state: 'busy' }
    const b: Agent = { ...baseAgent(null), id: 32, name: 'toast-pane-b', state: 'busy' }
    stubFetchWithAgents([a, b])

    render(<AgentList />)
    const sidebar = await screen.findByRole('complementary', { name: 'Agents' })
    fireEvent.click(await within(sidebar).findByRole('button', { name: 'toast-pane-a detail' }))
    const paneA = await screen.findByRole('region', { name: 'toast-pane-a detail' })
    // Leave A on a non-Terminal tab so a passing Terminal assertion on B is not just the default.
    fireEvent.click(within(paneA).getByRole('tab', { name: 'Skills' }))
    expect(within(paneA).getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true')

    vi.useFakeTimers()
    act(() => { fireSSE('agent-update', { ...b, state: 'awaiting' }) })
    act(() => { vi.advanceTimersByTime(NOTIFICATION_GRACE_MS) })
    const toast = screen.getByRole('button', { name: `toast-pane-b ${STATUS_CONFIG.awaiting.label}` })
    vi.useRealTimers()

    fireEvent.click(toast)

    const paneB = await screen.findByRole('region', { name: 'toast-pane-b detail' })
    expect(screen.queryByRole('region', { name: 'toast-pane-a detail' })).toBeNull()
    expect(screen.queryByRole('button', { name: `toast-pane-b ${STATUS_CONFIG.awaiting.label}` })).toBeNull()
    expect(within(paneB).getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true')
    expect(within(paneB).getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'false')
    const terminalPanel = within(paneB).getByRole('tabpanel', { name: 'Terminal' })
    expect(terminalPanel.className.split(' ')).not.toContain('hidden')
    expect(within(terminalPanel).getByTestId('mock-log-tail')).toHaveAttribute('data-agent-id', '32')
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
    expect(row.style.borderRightColor).toBe(normalizedColor(STATUS_CONFIG[status].dot))
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

  it('paints InactiveAgentsPanel rows with the same 4px status right border (TASK-0177)', async () => {
    const agent: Agent = { ...baseAgent(null), id: 1, name: 'inactive-exited', state: 'exited' }
    stubAgentDetailFetch(agent)

    render(<InactiveAgentsPanel onOpenDetail={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Inactive Agents/ }))

    const item = (await screen.findByText('inactive-exited')).closest('li')
    expect(item).not.toBeNull()
    expect(item?.className).toContain('border-r-[4px]')
    expect(item?.style.borderRightColor).toBe(normalizedColor(STATUS_CONFIG.exited.dot))
    expect(item?.className.split(/\s+/)).toContain('border-line')
  })

  it.each<[string, string, string]>([
    ['no-window', 'no-window', '#9a9da5'],
    ['unknown', 'bogus-state', '#9a9da5'],
    ['exited', 'exited', '#e5484d'],
    ['error', 'error', '#e5484d'],
  ])('paints a %s InactiveAgentsPanel row with a 4px %s-state right border of %s (TASK-0177 UAT-UI-003)', async (_label, state, hex) => {
    const agent: Agent = { ...baseAgent(null), id: 1, name: 'inactive-colored', state: state as Agent['state'], windowPresent: false }
    stubAgentDetailFetch(agent)

    render(<InactiveAgentsPanel onOpenDetail={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Inactive Agents/ }))

    const item = (await screen.findByText('inactive-colored')).closest('li')
    expect(item).not.toBeNull()
    expect(item?.className).toContain('border-r-[4px]')
    expect(item?.style.borderRightColor).toBe(normalizedColor(hex))
    expect(item?.className.split(/\s+/)).toContain('border-line')
    // No inline override on the other three sides.
    expect(item?.style.borderLeftColor).toBe('')
    expect(item?.style.borderTopColor).toBe('')
    expect(item?.style.borderBottomColor).toBe('')
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
