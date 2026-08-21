import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AgentList, {
  agentMatchesFilter,
  formatCost,
  formatSessionStart,
  formatTokens,
  isValidAgentRole,
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
      className: 'bg-cyan-100 text-cyan-700',
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
    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true })
    expect(await screen.findByRole('dialog', { name: 'node-gamma detail' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })
})
