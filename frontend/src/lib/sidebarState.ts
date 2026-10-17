// Collapsed/expanded state + localStorage persistence for the Agents page sidebar (TASK-0201).
// The current width is also exposed synchronously so non-React code (terminalSizeProbe) can size
// its hidden measuring node to match the sidebar without subscribing to component state.
import { SIDEBAR_COLLAPSED_WIDTH_PX, SIDEBAR_WIDTH_PX } from './layoutConstants'

export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'conductor:sidebarCollapsed'

export function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed))
  } catch {
    // storage unavailable (private mode / quota) — the in-memory state still works for this session
  }
}

let currentCollapsed = loadSidebarCollapsed()

export function getSidebarWidthPx(): number {
  return currentCollapsed ? SIDEBAR_COLLAPSED_WIDTH_PX : SIDEBAR_WIDTH_PX
}

export function setSidebarCollapsed(collapsed: boolean): void {
  currentCollapsed = collapsed
  saveSidebarCollapsed(collapsed)
}
