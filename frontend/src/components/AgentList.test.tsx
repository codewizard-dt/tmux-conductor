import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AgentList, {
  agentMatchesFilter,
  formatCost,
  formatSessionStart,
  formatTokens,
  isValidAgentRole,
  ProjectBadge,
  resolveRoleBadge,
  ROLE_CONFIG,
  ROLE_VALUES,
  UsageBadge,
  type Agent,
  type BgProcess,
} from './AgentList'
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

  // 'exited' (and 'no-window'/'unknown') are terminal statuses that columnFor() excludes
  // from AgentList's own kanban columns — they render in InactiveAgentsPanel.tsx instead,
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
})

describe('AgentList keyboard navigation ignores the grid filter', () => {
  it('next-agent navigation still reaches an agent hidden by the current filter (orderedAgentIds stays unfiltered)', async () => {
    class MockEventSource {
      addEventListener() { /* no-op */ }
      removeEventListener() { /* no-op */ }
      close() { /* no-op */ }
    }
    vi.stubGlobal('EventSource', MockEventSource)

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
    expect(await screen.findByRole('dialog', { name: 'node-beta detail' })).toBeInTheDocument()

    // Filter the grid down to a set that excludes the agent whose modal is currently open.
    const input = screen.getByLabelText('Filter agents')
    fireEvent.change(input, { target: { value: 'backend' } })
    expect(await screen.findByText('node-alpha')).toBeInTheDocument()
    expect(screen.getByText('node-gamma')).toBeInTheDocument()
    // The card is gone from the grid (queried by its own accessible role, not by its name
    // text — that text is still legitimately present inside the still-open modal below).
    expect(screen.queryByRole('button', { name: 'node-beta detail' })).toBeNull()
    // Filtering the grid must never silently close an in-progress detail view.
    expect(screen.getByRole('dialog', { name: 'node-beta detail' })).toBeInTheDocument()

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
    expect(screen.getByRole('dialog', { name: 'node-beta detail' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true, altKey: true })
    expect(screen.getByRole('dialog', { name: 'node-beta detail' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true, shiftKey: true })
    expect(await screen.findByRole('dialog', { name: 'node-gamma detail' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('clicking the Ctrl+Alt prev/next hint buttons calls onNavigate with the correct direction', async () => {
    class MockEventSource {
      addEventListener() { /* no-op */ }
      removeEventListener() { /* no-op */ }
      close() { /* no-op */ }
    }
    vi.stubGlobal('EventSource', MockEventSource)

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
    expect(await screen.findByRole('dialog', { name: 'node-beta detail' })).toBeInTheDocument()

    // Clicking the "next" hint button should behave exactly like the Ctrl+Alt+ArrowRight
    // keyboard shortcut it documents, calling onNavigate('next').
    fireEvent.click(screen.getByRole('button', { name: 'Next agent' }))
    expect(await screen.findByRole('dialog', { name: 'node-gamma detail' })).toBeInTheDocument()

    // Clicking the "prev" hint button should call onNavigate('prev'), navigating back.
    fireEvent.click(screen.getByRole('button', { name: 'Previous agent' }))
    expect(await screen.findByRole('dialog', { name: 'node-beta detail' })).toBeInTheDocument()

    vi.unstubAllGlobals()
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
    const dialog = await screen.findByRole('dialog', { name: 'skills-agent detail' })

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
    const dialog = await screen.findByRole('dialog', { name: 'skills-agent-small detail' })

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
// "Close agent", and Rename/Close/Remove/Clone entry points) belongs here,
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
  it('lists Rename, Close agent, Remove agent, Clone in order for a windowPresent agent', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 1, name: 'actions-agent', windowPresent: true }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    expect(await screen.findByText('actions-agent')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'actions-agent detail' }))
    const dialog = await screen.findByRole('dialog', { name: 'actions-agent detail' })

    expect(within(dialog).queryByRole('button', { name: 'Rename' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Close agent' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Remove agent' })).toBeNull()

    const trigger = within(dialog).getByRole('button', { name: 'Agent actions' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'true')
    fireEvent.click(trigger)

    const menuItems = within(dialog).getAllByRole('menuitem')
    expect(menuItems.map((el) => el.textContent)).toEqual(['Rename', 'Close agent', 'Remove agent', 'Clone'])

    vi.unstubAllGlobals()
  })

  it('omits the Close agent item entirely (not just disabled) when the agent has no live window', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 2, name: 'inactive-agent', windowPresent: false }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    const detailButton = await screen.findByRole('button', { name: 'inactive-agent detail' })
    fireEvent.click(detailButton)
    const dialog = await screen.findByRole('dialog', { name: 'inactive-agent detail' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent actions' }))
    const menuItems = within(dialog).getAllByRole('menuitem')
    expect(menuItems.map((el) => el.textContent)).toEqual(['Rename', 'Remove agent', 'Clone'])

    vi.unstubAllGlobals()
  })

  it('selecting Rename closes the menu and swaps the trigger for the pre-filled inline input', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 3, name: 'rename-agent', windowPresent: true }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'rename-agent detail' }))
    const dialog = await screen.findByRole('dialog', { name: 'rename-agent detail' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(dialog).getByRole('menuitem', { name: 'Rename' }))

    expect(within(dialog).queryByRole('menu')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Agent actions' })).toBeNull()
    expect(within(dialog).getByDisplayValue('rename-agent')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('selecting Close agent shows the ConfirmDialog message and "Close" confirm label', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 4, name: 'close-agent', windowPresent: true }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'close-agent detail' }))
    const dialog = await screen.findByRole('dialog', { name: 'close-agent detail' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(dialog).getByRole('menuitem', { name: 'Close agent' }))

    const closeMessage = within(dialog).getByText('Close agent "close-agent"\'s window and close this view? The agent stays registered and can be relaunched with "Create window".')
    const closeButtonRow = closeMessage.parentElement?.nextElementSibling as HTMLElement
    expect(within(closeButtonRow).getByRole('button', { name: 'Close' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('selecting Remove agent shows the unchanged ConfirmDialog message and "Remove" confirm label', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 5, name: 'remove-agent', windowPresent: true }
    stubAgentDetailFetch(agent)

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'remove-agent detail' }))
    const dialog = await screen.findByRole('dialog', { name: 'remove-agent detail' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(dialog).getByRole('menuitem', { name: 'Remove agent' }))

    expect(within(dialog).getByText('Remove agent "remove-agent"? This kills its tmux window, deletes it from conductor.conf, and drops its queued tasks.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeInTheDocument()

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
    const dialog = await screen.findByRole('dialog', { name: 'clone-agent detail' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(dialog).getByRole('menuitem', { name: 'Clone' }))

    await vi.waitFor(() => { expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/agents/6/clone')) })
    // Non-destructive — no ConfirmDialog text should appear.
    expect(within(dialog).queryByText(/^Remove agent|^Close agent "/)).toBeNull()

    vi.unstubAllGlobals()
  })

  it('confirming Close agent closes the modal once the window DELETE succeeds', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 7, name: 'close-confirm-agent', windowPresent: true }
    stubAgentDetailFetch(agent, (url) => {
      if (url.includes('/agents/7/window')) return { ok: true, json: () => ({ ok: true }) }
      return null
    })

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'close-confirm-agent detail' }))
    const dialog = await screen.findByRole('dialog', { name: 'close-confirm-agent detail' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(dialog).getByRole('menuitem', { name: 'Close agent' }))
    const closeMessage = within(dialog).getByText(/window and close this view\?/)
    const closeButtonRow = closeMessage.parentElement?.nextElementSibling as HTMLElement
    fireEvent.click(within(closeButtonRow).getByRole('button', { name: 'Close' }))

    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'close-confirm-agent detail' })).toBeNull() })

    vi.unstubAllGlobals()
  })

  it('confirming Remove agent closes the modal once the DELETE succeeds', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 8, name: 'remove-confirm-agent', windowPresent: true }
    stubAgentDetailFetch(agent, (url) => {
      if (url.endsWith('/agents/8')) return { ok: true, json: () => ({ ok: true }) }
      return null
    })

    render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'remove-confirm-agent detail' }))
    const dialog = await screen.findByRole('dialog', { name: 'remove-confirm-agent detail' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(within(dialog).getByRole('menuitem', { name: 'Remove agent' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'remove-confirm-agent detail' })).toBeNull() })

    vi.unstubAllGlobals()
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
    const dialog = await screen.findByRole('dialog', { name: 'identity-both detail' })

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
    const dialog = await screen.findByRole('dialog', { name: 'identity-type-only detail' })

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
    const dialog = await screen.findByRole('dialog', { name: 'identity-role-only detail' })

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
    const dialog = await screen.findByRole('dialog', { name: 'identity-none detail' })

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
    const dialog = await screen.findByRole('dialog', { name: 'header-emphasis-agent detail' })

    const nameSpan = within(dialog).getByText('header-emphasis-agent')
    expect(nameSpan.className).toContain('text-[17px]')
    expect(nameSpan.className).toContain('text-accent-blue')

    vi.unstubAllGlobals()
  })

  it('renders the modal header ProjectBadge at the md (15px) size while the card badge stays at the default sm (13px) size', async () => {
    vi.stubGlobal('EventSource', MockActionsMenuEventSource)
    const agent: Agent = { ...baseAgent(null), id: 2, name: 'header-badge-agent', projectName: null }
    stubAgentDetailFetch(agent)

    const { container } = render(<AgentList />)
    fireEvent.click(await screen.findByRole('button', { name: 'header-badge-agent detail' }))
    const dialog = await screen.findByRole('dialog', { name: 'header-badge-agent detail' })

    const modalBadge = within(dialog).getByTitle('No project assigned')
    expect(modalBadge.className).toContain('text-[15px]')
    expect(modalBadge.className).not.toContain('text-[13px]')

    const cardBadge = within(container).getByTitle('No project assigned')
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
    const dialog = await screen.findByRole('dialog', { name: 'active-task-agent detail' })

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
    const dialog = await screen.findByRole('dialog', { name: 'no-active-task-agent detail' })

    expect(within(dialog).queryByTitle('npm run build')).toBeNull()

    vi.unstubAllGlobals()
  })
})
