import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'

// Font metrics shared between the real xterm.js terminal (LogTail.tsx) and the
// hidden full-width probe terminal (terminalSizeProbe.ts). Keeping these in one
// place guarantees the probe's FitAddon.fit() computes the same cols/rows the
// real terminal would at the same pixel width.
export const TERMINAL_FONT_OPTIONS = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  lineHeight: 1.1,
} as const

// FitAddon.proposeDimensions() sizes each row to `cols * (a single measured cell
// width)`, then xterm.js's DOM renderer draws that row into a div with
// `overflow: hidden`. In practice not every glyph renders at exactly that
// measured width — box-drawing runs (────), em dashes, and other non-ASCII
// characters routinely render a fraction of a pixel wider per character than
// the plain-digit glyph FitAddon measures cell width from. Over a full-width
// row those fractions compound into real pixels (observed: 16-30px on a
// ~1080px-wide terminal), and the last several characters of the row end up
// rendered past the row's right edge — clipped by the `overflow: hidden`, not
// wrapped. Reserving a few spare columns keeps every row's actual rendered
// width safely inside what FitAddon computed, even for glyph-heavy lines.
// Applied identically to the real terminal (LogTail.tsx) and the probe
// (terminalSizeProbe.ts) so the synced tmux pane width stays in lockstep with
// what the real terminal can actually display.
const RIGHT_EDGE_COLUMN_MARGIN = 6
const MINIMUM_COLS = 2

export function fitWithRightEdgeMargin(term: Terminal, fitAddon: FitAddon): void {
  fitAddon.fit()
  const marginedCols = Math.max(MINIMUM_COLS, term.cols - RIGHT_EDGE_COLUMN_MARGIN)
  if (term.cols !== marginedCols) term.resize(marginedCols, term.rows)
}
