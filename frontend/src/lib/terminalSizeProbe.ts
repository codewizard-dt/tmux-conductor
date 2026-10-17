import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { syncTerminalSize } from './api'
import { getSidebarWidthPx } from './sidebarState'
import { fitWithRightEdgeMargin, TERMINAL_FONT_OPTIONS } from './terminalTheme'

// Hidden DOM node reproducing the Agents page detail pane's geometry (see
// frontend/src/components/AgentList.tsx — the pane to the right of the collapsible
// AgentSidebar, and AgentDetailView's `p-5` body wrapper), so a throwaway xterm Terminal
// mounted inside it measures the width the steady-state terminal surface actually has.
// The sidebar is expanded or collapsed, so the node's left edge is re-synced to the live
// sidebar width on every probe (the node itself is only created once).
// `visibility: hidden` (not `display: none`) keeps layout/geometry intact while remaining
// invisible and inert.
let probeMountEl: HTMLDivElement | null = null
let probeOuterEl: HTMLDivElement | null = null

function getProbeMount(): HTMLDivElement {
  if (probeMountEl) return probeMountEl

  const outer = document.createElement('div')
  outer.className = 'fixed inset-y-0 right-0'
  outer.style.visibility = 'hidden'
  outer.style.pointerEvents = 'none'
  outer.style.zIndex = '-1'

  const inner = document.createElement('div')
  inner.className = 'p-5'

  // Mirrors LogTail's `captureRef` wrapper (`relative border bg-[#0b0b0d] rounded-[10px]
  // border-line`, applied unconditionally across all interaction states) — its 1px border
  // shaves 2px off the width available to `xtermContainerRef` below it, which is where the
  // real terminal actually mounts. FitAddon.fit() reads the *mount point's* computed width
  // (term.element.parentElement), so without this wrapper the probe measured 2px more than
  // the real terminal ever has room for — enough to compute one extra column at this font
  // size, which is what caused lines to wrap (and the cursor to draw) one column early.
  const capture = document.createElement('div')
  capture.className = 'border border-line'

  const mount = document.createElement('div')
  mount.className = 'overflow-hidden'

  capture.appendChild(mount)
  inner.appendChild(capture)
  outer.appendChild(inner)
  document.body.appendChild(outer)

  probeOuterEl = outer
  probeMountEl = mount
  return mount
}

/**
 * Mounts a throwaway xterm Terminal + FitAddon into the hidden probe DOM node,
 * measures the resulting cols/rows, disposes the throwaway Terminal immediately,
 * and background-syncs the measured size to the backend.
 */
export function probeAndSyncTerminalSize(): void {
  const mount = getProbeMount()
  if (probeOuterEl) probeOuterEl.style.left = `${getSidebarWidthPx().toString()}px`

  const term = new Terminal({
    fontFamily: TERMINAL_FONT_OPTIONS.fontFamily,
    fontSize: TERMINAL_FONT_OPTIONS.fontSize,
    lineHeight: TERMINAL_FONT_OPTIONS.lineHeight,
  })
  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(mount)
  fitWithRightEdgeMargin(term, fitAddon)

  const { cols, rows } = term
  term.dispose()

  void syncTerminalSize(cols, rows)
}

// One-shot guard: the shared tmux window size only needs to be computed once per
// browser session on first terminal render — recomputing on every agent detail pane
// mount would be redundant and could resize-thrash other agents' panes.
let hasProbedOnce = false

export function maybeProbeOnFirstRender(): void {
  if (hasProbedOnce) return
  hasProbedOnce = true
  probeAndSyncTerminalSize()
}

// Shared trailing debounce (400ms, single timer) for every re-probe trigger — window resizes and
// sidebar collapse/expand toggles — so rapid bursts of either coalesce into one sync.
let reprobeTimer: ReturnType<typeof setTimeout> | undefined

function scheduleReprobe(): void {
  if (reprobeTimer !== undefined) clearTimeout(reprobeTimer)
  reprobeTimer = setTimeout(() => {
    probeAndSyncTerminalSize()
  }, 400)
}

/** Debounced re-probe for callers whose layout change (e.g. the sidebar toggling) resizes the terminal pane. */
export function reprobeTerminalSize(): void {
  scheduleReprobe()
}

// Single debounced window-resize listener: a genuine viewport resize always re-probes,
// regardless of how many times this is called (guarded against double-registration).
let registered = false

export function registerResizeListener(): void {
  if (registered) return
  registered = true

  window.addEventListener('resize', scheduleReprobe)
}
