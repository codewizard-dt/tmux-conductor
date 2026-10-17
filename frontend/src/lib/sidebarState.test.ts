import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SIDEBAR_COLLAPSED_WIDTH_PX, SIDEBAR_WIDTH_PX } from './layoutConstants'
import {
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  loadSidebarCollapsed,
  saveSidebarCollapsed,
} from './sidebarState'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('sidebar collapsed persistence (TASK-0201)', () => {
  it('defaults to expanded when nothing is stored', () => {
    expect(loadSidebarCollapsed()).toBe(false)
  })

  it('round-trips true and false', () => {
    saveSidebarCollapsed(true)
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('true')
    expect(loadSidebarCollapsed()).toBe(true)

    saveSidebarCollapsed(false)
    expect(loadSidebarCollapsed()).toBe(false)
  })

  it('treats a garbage stored value as expanded', () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, 'not-a-boolean')
    expect(loadSidebarCollapsed()).toBe(false)
  })

  it('does not throw when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => loadSidebarCollapsed()).not.toThrow()
    expect(loadSidebarCollapsed()).toBe(false)
  })

  it('does not throw when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => {
      saveSidebarCollapsed(true)
    }).not.toThrow()
  })
})

describe('sidebar width (TASK-0201)', () => {
  it('starts expanded with no stored value', async () => {
    const { getSidebarWidthPx } = await import('./sidebarState')
    expect(getSidebarWidthPx()).toBe(SIDEBAR_WIDTH_PX)
  })

  it('initialises collapsed from a stored value at module load', async () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, 'true')
    const { getSidebarWidthPx } = await import('./sidebarState')
    expect(getSidebarWidthPx()).toBe(SIDEBAR_COLLAPSED_WIDTH_PX)
  })

  it('flips with setSidebarCollapsed and persists the choice', async () => {
    const { getSidebarWidthPx, setSidebarCollapsed } = await import('./sidebarState')
    setSidebarCollapsed(true)
    expect(getSidebarWidthPx()).toBe(SIDEBAR_COLLAPSED_WIDTH_PX)
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('true')

    setSidebarCollapsed(false)
    expect(getSidebarWidthPx()).toBe(SIDEBAR_WIDTH_PX)
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('false')
  })
})
