import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { BgTail } from '../lib/api'
import type { BgProcess } from './AgentList'

const { bgTailMock, restartBgProcessMock } = vi.hoisted(() => ({ bgTailMock: vi.fn(), restartBgProcessMock: vi.fn() }))

vi.mock('../lib/api', () => ({ bgTail: bgTailMock, restartBgProcess: restartBgProcessMock }))

import { BackgroundProcessesTab } from './BackgroundProcessesTab'

// vitest.config doesn't set `test.globals`, so RTL's auto-cleanup never registers.
afterEach(() => { cleanup() })

function makeBg(overrides: Partial<BgProcess> & { slug: string }): BgProcess {
  return {
    name: overrides.slug,
    workdir: '/tmp/work',
    launchCmd: `run ${overrides.slug}`,
    windowPresent: true,
    liveness: 'running',
    state: null,
    logPath: `/tmp/bg-${overrides.slug}.log`,
    statePath: `/tmp/bg-${overrides.slug}.state`,
    projectId: 1,
    projectName: 'proj',
    ...overrides,
  }
}

function makeTail(overrides: Partial<BgTail> = {}): BgTail {
  return {
    slug: 'proj-web',
    name: 'web',
    lines: ['line one', 'line two'],
    truncated: false,
    sizeBytes: 100,
    logPath: '/tmp/bg-proj-web.log',
    updatedAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  }
}

const web = makeBg({ slug: 'proj-web', name: 'web', launchCmd: 'npm run dev' })
const api = makeBg({ slug: 'proj-api', name: 'api', launchCmd: 'node server.js' })

/** Flush pending promise continuations (and any timers due at the current time). */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  bgTailMock.mockReset()
  bgTailMock.mockResolvedValue(makeTail())
  restartBgProcessMock.mockReset()
  restartBgProcessMock.mockResolvedValue({ ok: true, name: 'proj-web', restartedAt: '2026-09-20T10:00:00.000Z', mechanism: 'respawn-window' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BackgroundProcessesTab (TASK-0205)', () => {
  it('lists only the passed bgs, each with a liveness badge and its launch command', () => {
    const exitedApi = makeBg({ slug: 'proj-api', name: 'api', liveness: 'exited', launchCmd: 'node server.js' })
    render(<BackgroundProcessesTab bgs={[web, exitedApi]} projectName="proj" active={false} />)

    const rows = screen.getAllByRole('button', { name: /proj-/ })
    expect(rows).toHaveLength(2)
    const [webRow, apiRow] = rows as [HTMLElement, HTMLElement]
    expect(within(webRow).getByText('proj-web')).toBeTruthy()
    expect(within(webRow).getByText('running')).toBeTruthy()
    expect(within(webRow).getByText('npm run dev').getAttribute('title')).toBe('npm run dev')
    expect(within(apiRow).getByText('proj-api')).toBeTruthy()
    expect(within(apiRow).getByText('exited')).toBeTruthy()
    expect(screen.queryByText('proj-other')).toBeNull()
  })

  it('selects the first process by default', () => {
    render(<BackgroundProcessesTab bgs={[web, api]} projectName="proj" active={false} />)
    expect(screen.getByRole('button', { name: /proj-web/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /proj-api/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('prefers an exited process for the default selection', async () => {
    const exitedApi = makeBg({ slug: 'proj-api', name: 'api', liveness: 'exited' })
    render(<BackgroundProcessesTab bgs={[web, exitedApi]} projectName="proj" active />)

    expect(screen.getByRole('button', { name: /proj-api/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /proj-web/ }).getAttribute('aria-pressed')).toBe('false')
    await flush()
    expect(bgTailMock).toHaveBeenCalledWith('proj-api', 200)
  })

  it('does not poll while inactive, and starts immediately when flipped active', async () => {
    const { rerender } = render(<BackgroundProcessesTab bgs={[web]} projectName="proj" active={false} />)
    await advance(10_000)
    expect(bgTailMock).not.toHaveBeenCalled()

    rerender(<BackgroundProcessesTab bgs={[web]} projectName="proj" active />)
    await flush()
    expect(bgTailMock).toHaveBeenCalledTimes(1)
    expect(bgTailMock).toHaveBeenCalledWith('proj-web', 200)
    expect(screen.getByText('line one')).toBeTruthy()
  })

  it('polls again every 2 seconds', async () => {
    render(<BackgroundProcessesTab bgs={[web]} projectName="proj" active />)
    await flush()
    expect(bgTailMock).toHaveBeenCalledTimes(1)

    await advance(1900)
    expect(bgTailMock).toHaveBeenCalledTimes(1)
    await advance(100)
    expect(bgTailMock).toHaveBeenCalledTimes(2)
    await advance(2000)
    expect(bgTailMock).toHaveBeenCalledTimes(3)
  })

  it('does not issue a second request while one is still in flight', async () => {
    let resolveFirst: (t: BgTail) => void = () => undefined
    bgTailMock.mockReset()
    bgTailMock.mockImplementationOnce(
      () => new Promise<BgTail>((resolve) => { resolveFirst = resolve }),
    )
    bgTailMock.mockResolvedValue(makeTail())

    render(<BackgroundProcessesTab bgs={[web]} projectName="proj" active />)
    await flush()
    expect(bgTailMock).toHaveBeenCalledTimes(1)

    // Two poll ticks elapse while the first request is unresolved: both are skipped.
    await advance(4000)
    expect(bgTailMock).toHaveBeenCalledTimes(1)

    act(() => { resolveFirst(makeTail()) })
    await flush()
    await advance(2000)
    expect(bgTailMock).toHaveBeenCalledTimes(2)
  })

  it('stops polling on unmount', async () => {
    const { unmount } = render(<BackgroundProcessesTab bgs={[web]} projectName="proj" active />)
    await flush()
    expect(bgTailMock).toHaveBeenCalledTimes(1)

    unmount()
    await advance(10_000)
    expect(bgTailMock).toHaveBeenCalledTimes(1)
  })

  it('stops polling when the tab is deactivated', async () => {
    const { rerender } = render(<BackgroundProcessesTab bgs={[web]} projectName="proj" active />)
    await flush()
    await advance(2000)
    expect(bgTailMock).toHaveBeenCalledTimes(2)

    rerender(<BackgroundProcessesTab bgs={[web]} projectName="proj" active={false} />)
    await advance(10_000)
    expect(bgTailMock).toHaveBeenCalledTimes(2)
  })

  it('ignores a late result that resolves after the tab was deactivated', async () => {
    let resolveLate: (t: BgTail) => void = () => undefined
    bgTailMock.mockReset()
    bgTailMock.mockImplementationOnce(
      () => new Promise<BgTail>((resolve) => { resolveLate = resolve }),
    )

    const { rerender } = render(<BackgroundProcessesTab bgs={[web]} projectName="proj" active />)
    await flush()
    rerender(<BackgroundProcessesTab bgs={[web]} projectName="proj" active={false} />)
    act(() => { resolveLate(makeTail({ lines: ['late output'] })) })
    await flush()
    expect(screen.queryByText('late output')).toBeNull()
  })

  it('switches the requested slug when another row is clicked', async () => {
    render(<BackgroundProcessesTab bgs={[web, api]} projectName="proj" active />)
    await flush()
    expect(bgTailMock).toHaveBeenLastCalledWith('proj-web', 200)

    bgTailMock.mockResolvedValue(makeTail({ slug: 'proj-api', name: 'api', lines: ['api output'] }))
    fireEvent.click(screen.getByRole('button', { name: /proj-api/ }))
    await flush()

    expect(bgTailMock).toHaveBeenLastCalledWith('proj-api', 200)
    expect(screen.getByRole('button', { name: /proj-api/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('api output')).toBeTruthy()
    expect(screen.queryByText('line one')).toBeNull()
  })

  it('styles restart marker lines distinctly from normal output', async () => {
    bgTailMock.mockResolvedValue(
      makeTail({ lines: ['before', '--- restart 2026-09-20T10:00:00Z ---', 'after'] }),
    )
    render(<BackgroundProcessesTab bgs={[web]} projectName="proj" active />)
    await flush()

    const marker = screen.getByText('--- restart 2026-09-20T10:00:00Z ---')
    expect(marker.getAttribute('data-restart-marker')).toBe('true')
    expect(screen.getByText('before').getAttribute('data-restart-marker')).toBeNull()
    expect(screen.getByText('after').getAttribute('data-restart-marker')).toBeNull()
  })

  it('shows the truncation hint only when the tail is truncated', async () => {
    bgTailMock.mockResolvedValue(makeTail({ truncated: true, lines: ['a', 'b', 'c'] }))
    const { unmount } = render(<BackgroundProcessesTab bgs={[web]} projectName="proj" active />)
    await flush()
    expect(screen.getByText('Output truncated to last 3 lines')).toBeTruthy()
    unmount()

    bgTailMock.mockResolvedValue(makeTail({ truncated: false }))
    render(<BackgroundProcessesTab bgs={[web]} projectName="proj" active />)
    await flush()
    expect(screen.queryByText(/Output truncated/)).toBeNull()
  })

  it('shows the empty state and never polls when the project has no bg processes', async () => {
    render(<BackgroundProcessesTab bgs={[]} projectName="Acme" active />)
    expect(screen.getByText('No background processes in Acme. Add one from the navbar.')).toBeTruthy()
    await advance(10_000)
    expect(bgTailMock).not.toHaveBeenCalled()
  })

  it('does not poll while the document is hidden, and resumes when it becomes visible', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    try {
      render(<BackgroundProcessesTab bgs={[web]} projectName="proj" active />)
      await flush()
      await advance(10_000)
      expect(bgTailMock).not.toHaveBeenCalled()

      hidden.mockReturnValue(false)
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      await flush()
      expect(bgTailMock).toHaveBeenCalledTimes(1)
      expect(bgTailMock).toHaveBeenCalledWith('proj-web', 200)
    } finally {
      hidden.mockRestore()
    }
  })

  it('keeps the selection by slug across live updates to the bgs list', async () => {
    const { rerender } = render(<BackgroundProcessesTab bgs={[web, api]} projectName="proj" active />)
    fireEvent.click(screen.getByRole('button', { name: /proj-api/ }))
    await flush()

    // Live update: the selected process flips to exited and list order changes.
    const exitedApi = makeBg({ slug: 'proj-api', name: 'api', liveness: 'exited' })
    rerender(<BackgroundProcessesTab bgs={[web, exitedApi]} projectName="proj" active />)
    await flush()

    expect(screen.getByRole('button', { name: /proj-api/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /proj-web/ }).getAttribute('aria-pressed')).toBe('false')
    expect(bgTailMock).toHaveBeenLastCalledWith('proj-api', 200)
  })

  it('resets the selection to the default when the selected process disappears', async () => {
    const { rerender } = render(<BackgroundProcessesTab bgs={[web, api]} projectName="proj" active />)
    fireEvent.click(screen.getByRole('button', { name: /proj-api/ }))
    await flush()
    expect(bgTailMock).toHaveBeenLastCalledWith('proj-api', 200)

    rerender(<BackgroundProcessesTab bgs={[web]} projectName="proj" active />)
    await flush()

    expect(screen.queryByRole('button', { name: /proj-api/ })).toBeNull()
    expect(screen.getByRole('button', { name: /proj-web/ }).getAttribute('aria-pressed')).toBe('true')
    expect(bgTailMock).toHaveBeenLastCalledWith('proj-web', 200)
  })

  it('shows an error with Retry, and Retry triggers another request', async () => {
    bgTailMock.mockReset()
    bgTailMock.mockRejectedValueOnce(new Error('HTTP 500'))
    bgTailMock.mockResolvedValue(makeTail({ lines: ['recovered output'] }))

    render(<BackgroundProcessesTab bgs={[web]} projectName="proj" active />)
    await flush()
    expect(screen.getByText('Could not load output')).toBeTruthy()
    expect(bgTailMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await flush()

    expect(bgTailMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Could not load output')).toBeNull()
    expect(screen.getByText('recovered output')).toBeTruthy()
  })
})

describe('BackgroundProcessesTab restart action (TASK-0206)', () => {
  it('renders a Restart button on every row, and a Start button for a stopped process', () => {
    const stopped = makeBg({ slug: 'proj-db', name: 'db', liveness: 'stopped', windowPresent: false })
    render(<BackgroundProcessesTab bgs={[web, api, stopped]} projectName="proj" active={false} />)

    expect(screen.getByRole('button', { name: 'Restart web' }).textContent).toBe('Restart')
    expect(screen.getByRole('button', { name: 'Restart api' }).textContent).toBe('Restart')
    expect(screen.getByRole('button', { name: 'Start db' }).textContent).toBe('Start')
    expect(screen.queryByRole('button', { name: 'Restart db' })).toBeNull()
  })

  it('does not nest the restart button inside the row-select button', () => {
    render(<BackgroundProcessesTab bgs={[web]} projectName="proj" active={false} />)
    const selectRow = screen.getByRole('button', { name: /proj-web/ })
    expect(within(selectRow).queryByRole('button')).toBeNull()
  })

  it('clicking Restart does not change the selected row', () => {
    render(<BackgroundProcessesTab bgs={[web, api]} projectName="proj" active={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Restart api' }))
    expect(screen.getByRole('button', { name: /proj-web/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /proj-api/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('confirming a restart of the selected process refreshes its tail immediately and reports the slug', async () => {
    const onBgRestarted = vi.fn()
    render(<BackgroundProcessesTab bgs={[web]} projectName="proj" active onBgRestarted={onBgRestarted} />)
    await flush()
    expect(bgTailMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Restart web' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await flush()

    expect(restartBgProcessMock).toHaveBeenCalledWith('proj-web')
    expect(onBgRestarted).toHaveBeenCalledWith('proj-web', expect.objectContaining({ restartedAt: '2026-09-20T10:00:00.000Z' }))
    // Well under the 2s poll interval: the extra fetch is the immediate refresh.
    expect(bgTailMock).toHaveBeenCalledTimes(2)
  })

  it('restarting a non-selected process reports the slug without refreshing the selected tail', async () => {
    const onBgRestarted = vi.fn()
    render(<BackgroundProcessesTab bgs={[web, api]} projectName="proj" active onBgRestarted={onBgRestarted} />)
    await flush()
    expect(bgTailMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Restart api' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await flush()

    expect(restartBgProcessMock).toHaveBeenCalledWith('proj-api')
    expect(onBgRestarted).toHaveBeenCalledWith('proj-api', expect.objectContaining({ restartedAt: '2026-09-20T10:00:00.000Z' }))
    expect(bgTailMock).toHaveBeenCalledTimes(1)
  })
})

describe('BackgroundProcessesTab last restart line (TASK-0207)', () => {
  it("shows each row's last restart line, outside the select button", () => {
    vi.setSystemTime(new Date('2026-09-20T10:03:00.000Z'))
    const restarted = makeBg({
      slug: 'proj-web', name: 'web', launchCmd: 'npm run dev',
      lastRestart: { at: '2026-09-20T10:00:00.000Z', caller: 'proj-cool-agent' },
    })
    render(<BackgroundProcessesTab bgs={[restarted, api]} projectName="proj" active={false} />)

    const lines = screen.getAllByTestId('bg-last-restart')
    expect(lines).toHaveLength(2)
    expect(lines[0]?.textContent).toBe('Restarted 3m ago by proj-cool-agent')
    expect(lines[1]?.textContent).toBe('No restarts recorded')
    const selectRow = screen.getByRole('button', { name: /proj-web/ })
    expect(within(selectRow).queryByTestId('bg-last-restart')).toBeNull()
  })

  it('re-renders the line when a row receives a new lastRestart', () => {
    vi.setSystemTime(new Date('2026-09-20T10:03:00.000Z'))
    const { rerender } = render(<BackgroundProcessesTab bgs={[web]} projectName="proj" active={false} />)
    expect(screen.getByTestId('bg-last-restart').textContent).toBe('No restarts recorded')

    rerender(
      <BackgroundProcessesTab
        bgs={[{ ...web, lastRestart: { at: '2026-09-20T10:02:00.000Z', caller: null } }]}
        projectName="proj"
        active={false}
      />,
    )
    expect(screen.getByTestId('bg-last-restart').textContent).toBe('Restarted 1m ago from the dashboard')
  })
})
