// Expanded width of the Agents page sidebar (AgentSidebar in components/AgentList.tsx). Shared with
// terminalSizeProbe.ts, whose hidden measuring node mirrors the detail pane that sits to the
// right of the sidebar. Lives in its own module so the probe never has to import AgentList
// (which imports LogTail, which imports the probe — a cycle).
export const SIDEBAR_WIDTH_PX = 320
// Width of the sidebar when collapsed to its icon rail.
export const SIDEBAR_COLLAPSED_WIDTH_PX = 48
