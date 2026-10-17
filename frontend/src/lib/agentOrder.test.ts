import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_ORDER_STORAGE_KEY,
  clearOrder,
  loadOrder,
  orderAgents,
  reorderGroup,
  saveOrder,
} from './agentOrder'

const agent = (id: number, name: string) => ({ id, name })
const ids = (agents: { id: number }[]) => agents.map((a) => a.id)

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('orderAgents (TASK-0183)', () => {
  it('sorts A-Z case-insensitively when there is no saved order', () => {
    const agents = [agent(1, 'charlie'), agent(2, 'alpha'), agent(3, 'Beta')]
    expect(orderAgents(agents, []).map((a) => a.name)).toEqual(['alpha', 'Beta', 'charlie'])
  })

  it('lets the saved order win over alphabetical', () => {
    const agents = [agent(1, 'alpha'), agent(2, 'beta'), agent(3, 'charlie')]
    expect(ids(orderAgents(agents, [3, 1, 2]))).toEqual([3, 1, 2])
  })

  it('appends agents missing from the saved list alphabetically after the ordered ones', () => {
    const agents = [agent(1, 'zulu'), agent(2, 'alpha'), agent(3, 'mike'), agent(4, 'bravo')]
    expect(ids(orderAgents(agents, [3, 1]))).toEqual([3, 1, 2, 4])
  })

  it('ignores saved ids that have no matching agent', () => {
    const agents = [agent(1, 'alpha'), agent(2, 'beta')]
    expect(ids(orderAgents(agents, [99, 2, 42, 1]))).toEqual([2, 1])
  })

  it('does not mutate its inputs', () => {
    const agents = [agent(1, 'charlie'), agent(2, 'alpha'), agent(3, 'beta')]
    const saved = [3, 1]
    const agentsBefore = [...agents]
    const savedBefore = [...saved]
    orderAgents(agents, saved)
    expect(agents).toEqual(agentsBefore)
    expect(saved).toEqual(savedBefore)
  })
})

describe('reorderGroup (TASK-0183)', () => {
  it('moves an item down', () => {
    expect(reorderGroup([1, 2, 3], 1, 3, [])).toEqual([2, 3, 1])
  })

  it('moves an item up', () => {
    expect(reorderGroup([1, 2, 3], 3, 1, [])).toEqual([3, 1, 2])
  })

  it('no-ops for equal ids and returns saved unchanged', () => {
    expect(reorderGroup([1, 2, 3], 2, 2, [7, 8])).toEqual([7, 8])
  })

  it('no-ops when either id is missing from the group', () => {
    expect(reorderGroup([1, 2, 3], 9, 1, [7])).toEqual([7])
    expect(reorderGroup([1, 2, 3], 1, 9, [7])).toEqual([7])
  })

  it('keeps hidden group members in their relative positions', () => {
    // Group order 1,2,3,4 where 2 is hidden by a filter; dragging 1 over 3 moves it past 3 only.
    expect(reorderGroup([1, 2, 3, 4], 1, 3, [])).toEqual([2, 3, 1, 4])
  })

  it("preserves other groups' ids already in saved", () => {
    const next = reorderGroup([1, 2, 3], 1, 2, [20, 10, 3, 1])
    expect(next).toEqual([20, 10, 2, 1, 3])
  })
})

describe('loadOrder / saveOrder / clearOrder (TASK-0183)', () => {
  it('returns [] when the key is missing', () => {
    expect(loadOrder()).toEqual([])
  })

  it('returns [] for malformed JSON', () => {
    localStorage.setItem(AGENT_ORDER_STORAGE_KEY, '{not json')
    expect(loadOrder()).toEqual([])
  })

  it('returns [] for non-array JSON', () => {
    localStorage.setItem(AGENT_ORDER_STORAGE_KEY, '{"a":1}')
    expect(loadOrder()).toEqual([])
  })

  it('drops non-integers and duplicates, keeping the first occurrence', () => {
    localStorage.setItem(AGENT_ORDER_STORAGE_KEY, JSON.stringify([3, 'x', 1.5, 3, null, 2, 1, true]))
    expect(loadOrder()).toEqual([3, 2, 1])
  })

  it('round-trips through saveOrder and loadOrder', () => {
    saveOrder([5, 2, 9])
    expect(localStorage.getItem(AGENT_ORDER_STORAGE_KEY)).toBe('[5,2,9]')
    expect(loadOrder()).toEqual([5, 2, 9])
  })

  it('does not throw when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => {
      saveOrder([1, 2])
    }).not.toThrow()
  })

  it('does not throw when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadOrder()).toEqual([])
  })

  it('clearOrder removes the key', () => {
    saveOrder([1, 2])
    clearOrder()
    expect(localStorage.getItem(AGENT_ORDER_STORAGE_KEY)).toBeNull()
  })
})
