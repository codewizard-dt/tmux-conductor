import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { syncTerminalSize } from './api'
import { TERMINAL_FONT_OPTIONS } from './terminalTheme'

// Hidden DOM node reproducing AgentDetailModal's panel geometry (see
// frontend/src/components/AgentList.tsx — the `fixed inset-4 md:inset-8` overlay panel
// and its `p-5` body wrapper), so a throwaway xterm Terminal mounted inside it measures
// the same widest-realistic-panel width regardless of which LogTail surface (compact
// card or full modal) actually triggers the probe. `visibility: hidden` (not
// `display: none`) keeps layout/geometry intact while remaining invisible and inert.
let probeMountEl: HTMLDivElement | null = null

function getProbeMount(): HTMLDivElement {
  if (probeMountEl) return probeMountEl

  const outer = document.createElement('div')
  outer.className = 'fixed inset-4 md:inset-8'
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
  fitAddon.fit()

  const { cols, rows } = term
  term.dispose()

  void syncTerminalSize(cols, rows)
}

// One-shot guard: the shared tmux window size only needs to be computed once per
// browser session on first terminal render — recomputing on every agent card/modal
// mount would be redundant and could resize-thrash other agents' panes.
let hasProbedOnce = false

export function maybeProbeOnFirstRender(): void {
  if (hasProbedOnce) return
  hasProbedOnce = true
  probeAndSyncTerminalSize()
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
