// Font metrics shared between the real xterm.js terminal (LogTail.tsx) and the
// hidden full-width probe terminal (terminalSizeProbe.ts). Keeping these in one
// place guarantees the probe's FitAddon.fit() computes the same cols/rows the
// real terminal would at the same pixel width.
export const TERMINAL_FONT_OPTIONS = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  lineHeight: 1.1,
} as const
