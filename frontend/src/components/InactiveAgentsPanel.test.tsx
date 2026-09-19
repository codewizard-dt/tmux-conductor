import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// AgentList (imported for deriveStatus etc.) pulls in LogTail, whose effect mounts a real
// @xterm/xterm Terminal (unavailable in jsdom — see AgentList.test.tsx's own comment). The panel
// never renders it, but stub it inertly so the import stays side-effect free.
vi.mock('./LogTail', () => ({ default: () => <div data-testid="mock-log-tail" /> }))

import InactiveAgentsPanel from './InactiveAgentsPanel'
import type { Agent } from './AgentList'

// RTL's auto-cleanup needs `test.globals: true`, which this repo does not set (see the same note
// in AgentList.test.tsx), so register it explicitly.
afterEach(() => { cleanup() })

class MockEventSource {
  addEventListener() { /* no-op */ }
  removeEventListener() { /* no-op */ }
  close() { /* no-op */ }
}

function inactiveAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 1,
    name: 'sleepy-agent',
    projectId: null,
    projectName: null,
    state: 'exited',
    mode: 'default',
    windowPresent: false,
    queuedTasks: 0,
    launchCmd: 'claude',
    workdir: '/tmp/sleepy',
    linkedBg: null,
    activeTask: null,
    usage: null,
    ...overrides,
  }
}

/** Serves the /status poll useAgents() reads. */
function stubFetch(agents: Agent[]) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
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
        agents, bgProcesses: [], timestamp: new Date().toISOString(),
      }),
    })
  }))
}

describe('InactiveAgentsPanel sidebar section (TASK-0177)', () => {
  const mixedAgents = (): Agent[] => [
    inactiveAgent({ id: 1, name: 'closed-agent', state: 'no-window' }),
    inactiveAgent({ id: 2, name: 'exited-agent', state: 'exited', windowPresent: true }),
    inactiveAgent({ id: 3, name: 'errored-agent', state: 'error' }),
    inactiveAgent({ id: 4, name: 'busy-agent', state: 'busy', windowPresent: true }),
    inactiveAgent({ id: 5, name: 'ready-agent', state: 'idle', queuedTasks: 1, windowPresent: true }),
  ]

  /** Like stubFetch, but returns the mock so tests can assert on the wake/remove requests. */
  function stubRecordingFetch(agents: Agent[]) {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/window') || /\/agents\/\d+$/.test(url)) {
        return Promise.resolve({ ok: true, json: () => ({}) })
      }
      return Promise.resolve({
        ok: true,
        json: () => ({
          session: 'test-session', sessionAlive: true, sessionExists: true,
          agents, bgProcesses: [], timestamp: new Date().toISOString(),
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  const mutationCalls = (fetchMock: ReturnType<typeof vi.fn>): [string, string][] =>
    fetchMock.mock.calls
      .map(([url, init]) => [String(url), (init as { method?: string } | undefined)?.method ?? 'GET'] as [string, string])
      .filter(([, method]) => method !== 'GET')

  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is collapsed by default, showing only the inactive count', async () => {
    stubRecordingFetch(mixedAgents())
    render(<InactiveAgentsPanel onOpenDetail={vi.fn()} />)

    // The header renders as "(0)" until the first /status poll resolves.
    // (The accessible name also carries the ▸ glyph, hence the regex.)
    await waitFor(() => { expect(screen.getByRole('button', { name: /Inactive Agents \(3\)/ })).toBeInTheDocument() })
    const toggle = screen.getByRole('button', { name: /Inactive Agents \(3\)/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('closed-agent')).toBeNull()
  })

  it('lists only no-window/exited/error/unknown agents when expanded', async () => {
    stubRecordingFetch(mixedAgents())
    render(<InactiveAgentsPanel onOpenDetail={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /Inactive Agents/ }))

    expect(await screen.findByText('closed-agent')).toBeInTheDocument()
    expect(screen.getByText('exited-agent')).toBeInTheDocument()
    expect(screen.getByText('errored-agent')).toBeInTheDocument()
    expect(screen.queryByText('busy-agent')).toBeNull()
    expect(screen.queryByText('ready-agent')).toBeNull()
    // 'no-window' reads as "closed"; the workdir moves to the row's title tooltip.
    expect(screen.getByText('closed')).toBeInTheDocument()
    expect((screen.getByText('closed-agent').closest('li') as HTMLElement).title).toBe('/tmp/sleepy')
  })

  it('lists an agent whose derived status is unknown, labelled "unknown" (UAT-0177 EDGE-002)', async () => {
    stubRecordingFetch([
      // A state string outside every known AgentRunState falls through deriveStatus to 'unknown'.
      inactiveAgent({ id: 6, name: 'mystery-agent', state: 'bogus' as Agent['state'], windowPresent: true }),
      inactiveAgent({ id: 4, name: 'busy-agent', state: 'busy', windowPresent: true }),
    ])
    render(<InactiveAgentsPanel onOpenDetail={vi.fn()} />)

    await waitFor(() => { expect(screen.getByRole('button', { name: /Inactive Agents \(1\)/ })).toBeInTheDocument() })
    fireEvent.click(screen.getByRole('button', { name: /Inactive Agents/ }))

    const row = (await screen.findByText('mystery-agent')).closest('li') as HTMLElement
    expect(within(row).getByText('unknown')).toBeInTheDocument()
    expect(screen.queryByText('busy-agent')).toBeNull()
  })

  it('Wake on a window-less agent POSTs to /agents/:id/window without a DELETE', async () => {
    const fetchMock = stubRecordingFetch(mixedAgents())
    render(<InactiveAgentsPanel onOpenDetail={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Inactive Agents/ }))

    fireEvent.click(await screen.findByRole('button', { name: 'Wake agent closed-agent' }))

    await waitFor(() => { expect(mutationCalls(fetchMock)).toHaveLength(1) })
    expect(mutationCalls(fetchMock)).toEqual([[expect.stringMatching(/\/agents\/1\/window$/), 'POST']])
  })

  it('Wake on an agent whose window is still present DELETEs then POSTs /agents/:id/window', async () => {
    const fetchMock = stubRecordingFetch(mixedAgents())
    render(<InactiveAgentsPanel onOpenDetail={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Inactive Agents/ }))

    fireEvent.click(await screen.findByRole('button', { name: 'Wake agent exited-agent' }))

    await waitFor(() => { expect(mutationCalls(fetchMock)).toHaveLength(2) })
    expect(mutationCalls(fetchMock)).toEqual([
      [expect.stringMatching(/\/agents\/2\/window$/), 'DELETE'],
      [expect.stringMatching(/\/agents\/2\/window$/), 'POST'],
    ])
  })

  it('Wake on a failing request shows the server error under the list and re-enables the button', async () => {
    const statusPayload = () => ({
      session: 'test-session', sessionAlive: true, sessionExists: true,
      agents: mixedAgents(), bgProcesses: [], timestamp: new Date().toISOString(),
    })
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/window')) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'tmux exploded' }) })
      }
      return Promise.resolve({ ok: true, json: () => statusPayload() })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<InactiveAgentsPanel onOpenDetail={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Inactive Agents/ }))

    const wake = await screen.findByRole('button', { name: 'Wake agent closed-agent' })
    fireEvent.click(wake)

    // The server's `error` message renders in the paragraph directly after the row list.
    const errorText = await screen.findByText('tmux exploded')
    expect(errorText.previousElementSibling?.tagName).toBe('UL')
    // Busy state is cleared: the button is enabled again and shows "Wake", not the "…" busy glyph.
    await waitFor(() => { expect(wake).not.toBeDisabled() })
    expect(wake).toHaveTextContent('Wake')
    expect(wake).not.toHaveTextContent('…')
    // The POST that failed is the only mutation (window-less agent: no DELETE first).
    expect(mutationCalls(fetchMock)).toEqual([[expect.stringMatching(/\/agents\/1\/window$/), 'POST']])
  })

  it('Remove opens the confirm dialog and only DELETEs the agent after confirming', async () => {
    const fetchMock = stubRecordingFetch(mixedAgents())
    render(<InactiveAgentsPanel onOpenDetail={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Inactive Agents/ }))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove agent closed-agent' }))

    // ConfirmDialog has no dialog role; its confirm button is the exact-name "Remove"
    // (the row's trash button is named "Remove agent <name>").
    expect(await screen.findByText(/Remove agent "closed-agent"\?/)).toBeInTheDocument()
    expect(mutationCalls(fetchMock)).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => { expect(mutationCalls(fetchMock)).toHaveLength(1) })
    expect(mutationCalls(fetchMock)).toEqual([[expect.stringMatching(/\/agents\/1$/), 'DELETE']])
  })

  it('cancelling the confirm dialog issues no request', async () => {
    const fetchMock = stubRecordingFetch(mixedAgents())
    render(<InactiveAgentsPanel onOpenDetail={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Inactive Agents/ }))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove agent closed-agent' }))
    expect(await screen.findByText(/Remove agent "closed-agent"\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText(/Remove agent "closed-agent"\?/)).toBeNull()
    expect(mutationCalls(fetchMock)).toEqual([])
  })
})
describe('InactiveAgentsPanel open-detail action (TASK-0178)', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource)
    stubFetch([inactiveAgent(), inactiveAgent({ id: 2, name: 'dozing-agent', state: 'no-window' })])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function expandPanel(props: { onOpenDetail?: (id: number) => void; selectedId?: number | null } = {}) {
    const onOpenDetail = props.onOpenDetail ?? vi.fn()
    render(<InactiveAgentsPanel onOpenDetail={onOpenDetail} selectedId={props.selectedId ?? null} />)
    const toggle = await screen.findByRole('button', { name: /Inactive Agents/ })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    return { toggle, onOpenDetail }
  }

  it('clicking a row calls onOpenDetail with that agent id, opens no dialog, and leaves the panel expanded', async () => {
    const { toggle, onOpenDetail } = await expandPanel()

    fireEvent.click((await screen.findByText('sleepy-agent')).closest('li') as HTMLElement)

    expect(onOpenDetail).toHaveBeenCalledTimes(1)
    expect(onOpenDetail).toHaveBeenCalledWith(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('sleepy-agent')).toBeInTheDocument()
  })

  it('Wake and Remove clicks do not trigger onOpenDetail', async () => {
    const { onOpenDetail } = await expandPanel()

    // Different rows, so neither click lands on a button disabled by the other's busy state
    // (jsdom would bubble a click on a disabled button; a real browser does not).
    fireEvent.click(await screen.findByRole('button', { name: 'Wake agent sleepy-agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove agent dozing-agent' }))

    expect(onOpenDetail).not.toHaveBeenCalled()
  })

  it('marks only the row matching selectedId with aria-current', async () => {
    await expandPanel({ selectedId: 2 })

    const selected = (await screen.findByText('dozing-agent')).closest('li') as HTMLElement
    const other = screen.getByText('sleepy-agent').closest('li') as HTMLElement
    expect(selected).toHaveAttribute('aria-current', 'true')
    expect(other).not.toHaveAttribute('aria-current')
  })
})

describe('InactiveAgentsPanel selection highlight (TASK-0178 / UAT-0178 UAT-EDGE-003)', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource)
    stubFetch([inactiveAgent(), inactiveAgent({ id: 2, name: 'dozing-agent', state: 'no-window' })])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('gives the selected inactive row the ring highlight and no other row', async () => {
    render(<InactiveAgentsPanel onOpenDetail={vi.fn()} selectedId={2} />)
    fireEvent.click(await screen.findByRole('button', { name: /Inactive Agents/ }))

    const selected = (await screen.findByText('dozing-agent')).closest('li') as HTMLElement
    const other = screen.getByText('sleepy-agent').closest('li') as HTMLElement
    expect(selected).toHaveClass('ring-2', 'ring-accent-blue/50')
    expect(other).not.toHaveClass('ring-2')
    expect(other).not.toHaveClass('ring-accent-blue/50')
  })

  it('clears aria-current and the ring from the inactive row when selection moves to an id outside the panel (an active agent)', async () => {
    const { rerender } = render(<InactiveAgentsPanel onOpenDetail={vi.fn()} selectedId={2} />)
    fireEvent.click(await screen.findByRole('button', { name: /Inactive Agents/ }))
    const row = (await screen.findByText('dozing-agent')).closest('li') as HTMLElement
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(row).toHaveClass('ring-2', 'ring-accent-blue/50')

    // 999 is an active agent's id: no inactive row matches it.
    rerender(<InactiveAgentsPanel onOpenDetail={vi.fn()} selectedId={999} />)

    const after = screen.getByText('dozing-agent').closest('li') as HTMLElement
    expect(after).not.toHaveAttribute('aria-current')
    expect(after).not.toHaveClass('ring-2')
    expect(after).not.toHaveClass('ring-accent-blue/50')
    expect(screen.getByText('sleepy-agent').closest('li')).not.toHaveAttribute('aria-current')
  })
})
