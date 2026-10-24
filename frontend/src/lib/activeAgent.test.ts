import { afterEach, describe, expect, it, vi } from 'vitest'
import { getActiveAgentProjectId, setActiveAgentProjectId, subscribeActiveAgent } from './activeAgent'

afterEach(() => {
  setActiveAgentProjectId(null)
})

describe('activeAgent store', () => {
  it('defaults to null', () => {
    expect(getActiveAgentProjectId()).toBeNull()
  })

  it('returns the value that was set', () => {
    setActiveAgentProjectId(7)
    expect(getActiveAgentProjectId()).toBe(7)
  })

  it('notifies subscribers on change', () => {
    const cb = vi.fn()
    const unsub = subscribeActiveAgent(cb)
    setActiveAgentProjectId(3)
    expect(cb).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('does not notify when the value is unchanged', () => {
    setActiveAgentProjectId(3)
    const cb = vi.fn()
    const unsub = subscribeActiveAgent(cb)
    setActiveAgentProjectId(3)
    expect(cb).not.toHaveBeenCalled()
    unsub()
  })

  it('stops notifying after unsubscribe', () => {
    const cb = vi.fn()
    const unsub = subscribeActiveAgent(cb)
    unsub()
    setActiveAgentProjectId(5)
    expect(cb).not.toHaveBeenCalled()
  })

  it('notifies when set back to null', () => {
    setActiveAgentProjectId(5)
    const cb = vi.fn()
    const unsub = subscribeActiveAgent(cb)
    setActiveAgentProjectId(null)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(getActiveAgentProjectId()).toBeNull()
    unsub()
  })
})
