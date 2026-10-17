import * as fsp from 'node:fs/promises';

// TASK-0192: bg-process log reading + terminal-escape cleaning.
//
// Background-process logs (`$LOG_DIR/bg-<slug>.log`) are written by
// `tmux pipe-pane -o "cat >> ..."`, so they hold the raw byte stream of the
// pane: ANSI escapes, `\r` progress redraws, and unbounded growth. This module
// turns the tail of such a log into plain-text lines a browser can render, and
// never reads the whole file.

/** Upper bound on how many trailing bytes of a log are ever read (256 KiB). */
export const TAIL_MAX_BYTES = 256 * 1024;

const TAIL_LINES_MIN = 1;
const TAIL_LINES_MAX = 1000;
const TAIL_LINES_DEFAULT = 50;

/**
 * Parse a `lines` query value the same way `GET /agents/:id/tail` does:
 * parseInt, NaN -> default, then clamp to 1..1000.
 */
export function clampTailLines(raw: unknown, def: number = TAIL_LINES_DEFAULT): number {
  const parsed = typeof raw === 'number' ? Math.trunc(raw) : parseInt(typeof raw === 'string' ? raw : '', 10);
  if (Number.isNaN(parsed)) return def;
  return Math.min(TAIL_LINES_MAX, Math.max(TAIL_LINES_MIN, parsed));
}

// OSC: ESC ] ... terminated by BEL, ST (ESC \), or - when the sequence was cut
// off by the read window or is otherwise unterminated - end of line/input.
// The terminator is consumed except for a newline, which must survive.
const OSC_RE = /\x1b\][^\x07\x1b\n]*(?:\x07|\x1b\\|(?=\n)|$)/g;
// CSI: ESC [ <parameter bytes 0x30-0x3F>* <intermediate bytes 0x20-0x2F>* <final 0x40-0x7E>
// (covers SGR colours and cursor moves alike).
const CSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
// Charset designation and similar: ESC <intermediate 0x20-0x2F>+ <final 0x30-0x7E>, e.g. ESC ( B.
const ESC_INTERMEDIATE_RE = /\x1b[ -/]+[0-~]/g;
// Any remaining two-byte escape: ESC <0x30-0x7E>, e.g. ESC 7, ESC 8, ESC =, ESC M.
const ESC_TWO_BYTE_RE = /\x1b[0-~]/g;
// Every control byte except \t (0x09) and \n (0x0a). \r (0x0d) has already been
// consumed by the redraw collapsing below; a stray ESC also ends up here.
const CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f]/g;

/**
 * Strip terminal escapes from raw pane output.
 *
 * - CSI, OSC and other two-byte escapes are removed.
 * - `\r\n` line endings are normalised to `\n` first, so the trailing `\r` of
 *   a CRLF pair never wipes its line; then, within each line, only the text
 *   after the last `\r` is kept (a progress bar redrawn N times collapses to
 *   its final frame).
 * - A stray backspace (0x08) is dropped like any other control byte; it is NOT
 *   applied (the preceding character is not erased). Logs from pipe-pane rarely
 *   contain meaningful backspaces and dropping is the simplest safe choice.
 * - All remaining control bytes except `\n` and `\t` are dropped.
 */
export function cleanTerminalOutput(raw: string): string {
  const noEscapes = raw
    .replace(OSC_RE, '')
    .replace(CSI_RE, '')
    .replace(ESC_INTERMEDIATE_RE, '')
    .replace(ESC_TWO_BYTE_RE, '');
  const collapsed = noEscapes
    .replace(/\r+\n/g, '\n')
    .split('\n')
    .map((line) => {
      const i = line.lastIndexOf('\r');
      return i === -1 ? line : line.slice(i + 1);
    })
    .join('\n');
  return collapsed.replace(CONTROL_RE, '');
}

export interface LogTail {
  lines: string[];
  /** True when the file was larger than the window that was read. */
  truncated: boolean;
  /** Current file size in bytes (0 when the file is missing). */
  sizeBytes: number;
  /** File mtime as an ISO string, or null when the file is missing. */
  updatedAt: string | null;
}

export interface ReadLogTailOptions {
  /** Number of trailing lines to return; clamped to 1..1000. */
  lines: number;
  /** Max trailing bytes to read; defaults to TAIL_MAX_BYTES. */
  maxBytes?: number;
}

/**
 * Read the last `lines` cleaned lines of a log file, reading at most
 * `maxBytes` from its end. A missing file yields an empty result.
 *
 * When the window starts mid-file its first line is (potentially) partial and
 * is dropped. The window is decoded as UTF-8 before the drop, so a multibyte
 * character split at the window boundary can only garble that dropped line.
 * We read one extra byte before the window so a boundary that falls exactly on
 * a line start keeps that line. If the window holds no newline at all (a single
 * line longer than the window) the result is empty with `truncated: true`.
 */
export async function readLogTail(filePath: string, opts: ReadLogTailOptions): Promise<LogTail> {
  const lineCount = clampTailLines(opts.lines);
  const maxBytes = Math.max(1, Math.floor(opts.maxBytes ?? TAIL_MAX_BYTES));

  let fh: fsp.FileHandle;
  try {
    fh = await fsp.open(filePath, 'r');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { lines: [], truncated: false, sizeBytes: 0, updatedAt: null };
    }
    throw err;
  }

  try {
    const st = await fh.stat();
    const size = st.size;
    const updatedAt = st.mtime.toISOString();
    if (size === 0) return { lines: [], truncated: false, sizeBytes: 0, updatedAt };

    const windowStart = Math.max(0, size - maxBytes);
    const midFile = windowStart > 0;
    const readStart = midFile ? windowStart - 1 : 0; // extra leading byte to detect a line-aligned boundary
    const length = size - readStart;
    const buf = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const { bytesRead } = await fh.read(buf, got, length - got, readStart + got);
      if (bytesRead === 0) break;
      got += bytesRead;
    }

    let text = buf.subarray(0, got).toString('utf8');
    if (midFile) {
      // First byte is the lookback byte. If it is a newline, the window began
      // on a line boundary; otherwise drop the partial first line.
      if (text.charCodeAt(0) === 0x0a) {
        text = text.slice(1);
      } else {
        const nl = text.indexOf('\n');
        text = nl === -1 ? '' : text.slice(nl + 1);
      }
    }

    const all = cleanTerminalOutput(text).split('\n');
    if (all.length > 0 && all[all.length - 1] === '') all.pop();
    return { lines: all.slice(-lineCount), truncated: midFile, sizeBytes: size, updatedAt };
  } finally {
    await fh.close();
  }
}
