import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BgLivenessBadge } from './BgLivenessBadge'

// vitest.config doesn't set `test.globals`, so RTL's auto-cleanup never registers.
afterEach(() => { cleanup() })

describe('BgLivenessBadge (TASK-0205)', () => {
  it.each(['running', 'exited', 'stopped'] as const)(
    'renders the %s label as visible text with data-liveness',
    (liveness) => {
      // windowPresent deliberately contradicts the label for 'exited'/'stopped' to prove the
      // explicit liveness wins over the window heuristic.
      render(<BgLivenessBadge liveness={liveness} windowPresent />)
      const badge = screen.getByText(liveness)
      expect(badge.getAttribute('data-liveness')).toBe(liveness)
    },
  )

  it('lets an explicit liveness override windowPresent=false', () => {
    render(<BgLivenessBadge liveness="running" windowPresent={false} />)
    expect(screen.getByText('running').getAttribute('data-liveness')).toBe('running')
    expect(screen.queryByText('stopped')).toBeNull()
  })

  it('falls back to "running" when liveness is undefined and the window is present', () => {
    render(<BgLivenessBadge windowPresent />)
    expect(screen.getByText('running').getAttribute('data-liveness')).toBe('running')
  })

  it('falls back to "stopped" when liveness is undefined and the window is absent', () => {
    render(<BgLivenessBadge windowPresent={false} />)
    expect(screen.getByText('stopped').getAttribute('data-liveness')).toBe('stopped')
  })
})
