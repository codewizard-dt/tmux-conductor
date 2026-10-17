// Width of the Agents page sidebar (AgentSidebar in components/AgentList.tsx). Shared with
// terminalSizeProbe.ts, whose hidden measuring node mirrors the detail pane that sits to the
// right of the sidebar. Lives in its own module so the probe never has to import AgentList
// (which imports LogTail, which imports the probe — a cycle).
export const SIDEBAR_WIDTH_PX = 320

// Docked width of the sidebar when minimized to a rail. Hover-expanding the rail overlays the
// full-width sidebar without changing this docked width, so the terminal is never resized by hover.
export const SIDEBAR_RAIL_WIDTH_PX = 56

// localStorage key persisting the sidebar's minimized state across reloads.
export const SIDEBAR_MINIMIZED_STORAGE_KEY = 'conductor:sidebarMinimized'

// Hover-flyout timing for the minimized rail. The open delay is longer while the user is typing
// so a stray pointer crossing the rail doesn't steal focus from the terminal.
export const HOVER_OPEN_DELAY_MS = 100
export const HOVER_OPEN_DELAY_TYPING_MS = 450
export const HOVER_CLOSE_DELAY_MS = 250
