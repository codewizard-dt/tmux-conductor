import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { syncTerminalSize } from './api'
import { SIDEBAR_WIDTH_PX } from './layoutConstants'
import { fitWithRightEdgeMargin, TERMINAL_FONT_OPTIONS } from './terminalTheme'

// Hidden DOM node reproducing the Agents page detail pane's geometry (see
// frontend/src/components/AgentList.tsx — the pane to the right of the fixed-width
// AgentSidebar, and AgentDetailView's `p-5` body wrapper), so a throwaway xterm Terminal
// mounted inside it measures the width the steady-state terminal surface actually has.
// `visibility: hidden` (not `display: none`) keeps layout/geometry intact while remaining
// invisible and inert.
let probeMountEl: HTMLDivElement | null = null
// The probe's positioned outer node, kept so setSidebarDockedWidth can move its left edge.
let probeOuterEl: HTMLDivElement | null = null
// Docked (not hover-expanded) sidebar width the probe mirrors; changes when the sidebar is
// minimized to a rail.
let dockedSidebarWidthPx = SIDEBAR_WIDTH_PX

function getProbeMount(): HTMLDivElement {
  if (probeMountEl) return probeMountEl

  const outer = document.createElement('div')
  outer.className = 'fixed inset-y-0 right-0'
  outer.style.left = `${dockedSidebarWidthPx.toString()}px`
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

/**
 * Tells the probe the sidebar's docked width changed (minimize/restore). Hover-expanding the
 * rail is an overlay and must not call this. Re-probes only if a first probe already ran — the
 * pending first-render probe otherwise picks up the new width itself.
 */
export function setSidebarDockedWidth(px: number): void {
  if (px === dockedSidebarWidthPx) return
  dockedSidebarWidthPx = px
  if (probeOuterEl) probeOuterEl.style.left = `${px.toString()}px`
  if (hasProbedOnce) probeAndSyncTerminalSize()
}

// Single debounced window-resize listener: a genuine viewport resize always re-probes,
// regardless of how many times this is called (guarded against double-registration).
let registered = false

export function registerResizeListener(): void {
  if (registered) return
  registered = true

  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  window.addEventListener('resize', () => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      probeAndSyncTerminalSize()
    }, 400)
  })
}
