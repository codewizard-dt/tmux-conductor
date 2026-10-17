import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { BgLastRestart } from './BgLastRestart'

// vitest.config doesn't set `test.globals`, so RTL's auto-cleanup never registers.
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const AT = '2026-09-20T10:00:00.000Z'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-20T10:03:00.000Z'))
})

describe('BgLastRestart (TASK-0207)', () => {
  it('renders the agent caller verbatim in mono, with a "reported by the caller" tooltip', () => {
    render(<BgLastRestart lastRestart={{ at: AT, caller: 'proj-cool-agent' }} />)
    const line = screen.getByTestId('bg-last-restart')
    expect(line.textContent).toBe('Restarted 3m ago by proj-cool-agent')
    expect(screen.getByText('proj-cool-agent').className).toContain('font-mono')
    const title = line.getAttribute('title') ?? ''
    expect(title).toContain(AT)
    expect(title).toContain('proj-cool-agent')
    expect(title).toContain('reported by the caller')
  })

  it('renders "from the dashboard" for a null caller', () => {
    render(<BgLastRestart lastRestart={{ at: AT, caller: null }} />)
    const line = screen.getByTestId('bg-last-restart')
    expect(line.textContent).toBe('Restarted 3m ago from the dashboard')
    expect(line.getAttribute('title')).toContain('dashboard')
  })

  it('renders "No restarts recorded" for null or absent lastRestart', () => {
    const { rerender } = render(<BgLastRestart lastRestart={null} />)
    expect(screen.getByTestId('bg-last-restart').textContent).toBe('No restarts recorded')
    rerender(<BgLastRestart />)
    expect(screen.getByTestId('bg-last-restart').textContent).toBe('No restarts recorded')
  })

  it('uses a semantic <time> with dateTime set to the ISO timestamp', () => {
    const { container } = render(<BgLastRestart lastRestart={{ at: AT, caller: null }} />)
    const time = container.querySelector('time')
    expect(time?.getAttribute('datetime')).toBe(AT)
    expect(time?.textContent).toBe('3m ago')
  })

  it('applies the passed className', () => {
    render(<BgLastRestart lastRestart={null} className="truncate" />)
    expect(screen.getByTestId('bg-last-restart').className).toContain('truncate')
  })

  it('ages the label when the useNow tick fires', async () => {
    render(<BgLastRestart lastRestart={{ at: AT, caller: null }} />)
    expect(screen.getByTestId('bg-last-restart').textContent).toBe('Restarted 3m ago from the dashboard')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000)
    })
    expect(screen.getByTestId('bg-last-restart').textContent).toBe('Restarted 5m ago from the dashboard')
  })

  // TASK-0207 requirement: a restart just performed reads "just now" immediately, not an absolute
  // timestamp. useNow only ticks every 30 s, so its sample can lag a fresh `lastRestart.at` (the
  // dashboard's optimistic patch, or a bg-update SSE) by up to 30 s; that lag must not be mistaken
  // for a future timestamp.
  it('reads "just now" for a restart that lands between useNow ticks', () => {
    const { rerender } = render(<BgLastRestart lastRestart={null} />)
    act(() => { vi.advanceTimersByTime(20_000) })
    rerender(<BgLastRestart lastRestart={{ at: new Date().toISOString(), caller: null }} />)
    expect(screen.getByTestId('bg-last-restart').textContent).toBe('Restarted just now from the dashboard')
  })
})
