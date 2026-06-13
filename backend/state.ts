import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { ConductorConf } from './config.ts';

/**
 * Read the state file for a given agent.
 *
 * @param {string} stateDir - Directory containing <agentName>.state files
 * @param {string} agentName - Agent name (without extension)
 * @returns {'idle'|'busy'|'unknown'}
 */
export function readAgentState(stateDir: string, agentName: string): string {
  const filePath = path.join(stateDir, `${agentName}.state`);
  try {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    return content;
  } catch {
    return 'unknown';
  }
}

/**
 * Capture the last `n` non-blank lines of an agent's tmux pane.
 * Returns '' if the pane can't be captured (window gone, tmux error).
 */
export function capturePaneTail(sessionName: string, windowName: string, n: number): string {
  const result = spawnSync('tmux', ['capture-pane', '-t', `${sessionName}:${windowName}`, '-p'], {
    encoding: 'utf8',
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') return '';
  return result.stdout
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(-n)
    .join('\n');
}

/**
 * Capture the last `n` lines of an agent's tmux pane verbatim for a log view,
 * including scrollback (`-S -n`) so requests beyond the visible screen height
 * still work. Interior blank lines are preserved; only the trailing run of
 * blank lines (tmux pads the bottom of the visible screen) is stripped.
 * Returns '' if the pane can't be captured.
 */
export function capturePaneTailRaw(sessionName: string, windowName: string, n: number): string {
  const result = spawnSync(
    'tmux',
    ['capture-pane', '-t', `${sessionName}:${windowName}`, '-p', '-S', `-${String(n)}`],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || typeof result.stdout !== 'string') return '';
  const lines = result.stdout.split('\n');
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') {
    lines.pop();
  }
  return lines.slice(-n).join('\n');
}

/**
 * True when `pattern` (a POSIX ERE, e.g. using [[:space:]]) matches `text`.
 * Matched via `grep -qE` exactly like monitor.sh — JavaScript's RegExp does
 * not understand POSIX character classes.
 */
function grepMatches(pattern: string, text: string): boolean {
  const grep = spawnSync('grep', ['-qE', pattern], { input: text, encoding: 'utf8' });
  return grep.status === 0;
}

const SHELL_COMMANDS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh']);

/** First word of a launch command, skipping leading VAR=value env assignments. */
function launchCommandName(launchCmd: string): string {
  for (const word of launchCmd.trim().split(/\s+/)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) return word;
  }
  return '';
}

/**
 * True when the pane has fallen back to a plain shell while the agent's launch
 * command is not itself a shell — i.e. the agent process exited or crashed.
 */
function isPaneDead(sessionName: string, windowName: string, launchCmd: string): boolean {
  const cmdName = launchCommandName(launchCmd);
  if (SHELL_COMMANDS.has(cmdName)) return false; // shell agents are always "alive"
  const result = spawnSync(
    'tmux',
    ['display-message', '-p', '-t', `${sessionName}:${windowName}`, '#{pane_current_command}'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || typeof result.stdout !== 'string') return false;
  return SHELL_COMMANDS.has(result.stdout.trim());
}

/**
 * Resolve an agent's effective status the same way monitor.sh's is_idle does,
 * so the dashboard never shows a bare "unknown" while the agent's window is alive.
 *
 * Precedence:
 *   1. window absent                          -> 'no-window'
 *   2. pane fell back to a plain shell        -> 'exited' (agent process died)
 *   3. hook-written state file                -> its value ('busy'|'idle'|'awaiting')
 *      State files do NOT expire by age: an idle agent's file is naturally old
 *      because nothing rewrites it while the agent waits. A file is only wrong
 *      when the agent died — which step 2 already detects. An 'idle' file is
 *      overridden to 'busy' when the pane shows the BUSY_PATTERN indicator
 *      (covers an agent relaunched without hook env on top of an old file).
 *      A 'busy' file whose pane shows no BUSY_PATTERN is refined read-only
 *      (the monitor owns the state file; the dashboard never writes it):
 *        - last non-blank line matches AWAITING_PATTERN -> 'awaiting'
 *          (an interactive dialog is open, e.g. Claude Code's AskUserQuestion
 *          "Enter to select · Esc to cancel" footer)
 *        - file older than 2×POLL_INTERVAL and IDLE_PATTERN matches -> 'idle'
 *          (Stop hook never fired; monitor recovers the file on its next poll)
 *        - file older than STALL_TIMEOUT and NO pattern matches -> 'stalled'
 *          (mid-task but in a state none of the patterns recognise)
 *      An 'awaiting' file is reverted to 'busy' when the dialog footer is gone
 *      (the agent resumed on its own; monitor rewrites the file later).
 *   4. capture-pane regex fallback            -> 'busy' if BUSY_PATTERN matches,
 *      'idle' if IDLE_PATTERN matches, 'starting' if the pane is empty, else 'busy'
 *      ('stalled' requires a busy state file — the fallback never reports it)
 *
 * @param {string} [precapturedTail] - Reuse an existing capturePaneTail() result
 *   (≥15 non-blank lines, e.g. the 15-line capture shared with detectAgentMode);
 *   the last 15 lines are used. '' is treated as "no precapture" so a transient
 *   capture failure upstream can't force 'starting'.
 *
 * @returns {'no-window'|'exited'|'idle'|'busy'|'awaiting'|'stalled'|'starting'|'unknown'}
 */
export function detectAgentStatus(conf: ConductorConf, agentName: string, precapturedTail?: string): string {
  const { sessionName, stateDir, idlePattern, busyPattern, awaitingPattern, pollInterval, stallTimeout } = conf;

  if (!isTmuxWindowPresent(sessionName, agentName)) {
    return 'no-window';
  }

  const launchCmd = conf.agents.find((a) => a.name === agentName)?.launchCmd ?? '';
  if (isPaneDead(sessionName, agentName, launchCmd)) {
    return 'exited';
  }

  // Lazy, memoized 15-line pane tail — at most one capture-pane spawn per call,
  // and zero when a precaptured tail is supplied. 15 lines keeps the "esc to
  // interrupt" footer visible even when a Workflow progress tree fills the pane.
  let cachedTail: string | null = null;
  const tail5 = (): string => {
    if (cachedTail === null) {
      cachedTail = precapturedTail !== undefined && precapturedTail !== ''
        ? precapturedTail.split('\n').slice(-15).join('\n')
        : capturePaneTail(sessionName, agentName, 15);
    }
    return cachedTail;
  };
  const lastLine = (tail: string): string => tail.split('\n').at(-1) ?? '';

  const filePath = path.join(stateDir, `${agentName}.state`);
  try {
    const state = fs.readFileSync(filePath, 'utf8').replace(/\r/g, '').split('\n')[0]?.trim() ?? '';
    if (state === 'busy') {
      const ageSeconds = (Date.now() - fs.statSync(filePath).mtimeMs) / 1000;
      const tail = tail5();
      if (tail !== '' && !(busyPattern && grepMatches(busyPattern, tail))) {
        // Dialog open? Last-non-blank-line check mirrors monitor.sh's awaiting
        // detection. Not age-gated: the dashboard's 2s poll should flag a
        // waiting agent long before the monitor's next pass.
        if (awaitingPattern !== '' && grepMatches(awaitingPattern, lastLine(tail))) {
          return 'awaiting';
        }
        // Hook-failure safety net (mirrors monitor.sh): a busy file old enough
        // to rule out the dispatch race whose pane footer reads idle means the
        // Stop hook never fired. Report idle; the monitor rewrites the file on
        // its next poll — the dashboard stays read-only.
        if (ageSeconds > pollInterval * 2) {
          if (idlePattern !== '' && grepMatches(idlePattern, tail)) {
            return 'idle';
          }
        }
        // Stall detection uses a separate, longer threshold (STALL_TIMEOUT,
        // default 300 s) so long-running Workflow runs with sub-agents don't
        // trigger a false stalled before the pane re-shows the busy footer.
        if (ageSeconds > stallTimeout) {
          // Old busy file, pane matches nothing we know — stuck in an
          // unrecognized state (crashed TUI, unexpected dialog, …).
          return 'stalled';
        }
      }
      return 'busy';
    }
    if (state === 'awaiting') {
      const tail = tail5();
      if (tail !== '' && awaitingPattern !== '' && !grepMatches(awaitingPattern, lastLine(tail))) {
        // Dialog gone — the agent resumed on its own. monitor.sh reverts the
        // state file on its next poll; report busy read-only meanwhile.
        return 'busy';
      }
      return state;
    }
    if (state === 'idle') {
      if (busyPattern) {
        const tail = tail5();
        if (tail !== '' && grepMatches(busyPattern, tail)) return 'busy';
      }
      return 'idle';
    }
  } catch {
    // no state file — fall through to the regex fallback below
  }

  const tail = tail5();
  if (tail === '') return 'starting';
  if (busyPattern && grepMatches(busyPattern, tail)) return 'busy';
  if (idlePattern && grepMatches(idlePattern, tail)) return 'idle';
  return 'busy';
}

export type AgentMode = 'default' | 'acceptEdits' | 'plan' | 'bypass' | 'unknown';

/**
 * Detect which Claude Code permission mode an agent's pane is in by matching
 * the footer line (e.g. "⏸ plan mode on (shift+tab to cycle)") against the
 * last 15 non-blank lines of capture-pane output. 15 lines (vs the 5 used for
 * idle detection) because the mode footer sits below a possibly multi-line
 * input box plus extra footer chrome.
 *
 * 'default' is only reported when recognisable Claude Code chrome is visible
 * with no mode footer; anything else (bash window, permission dialog, dead
 * pane) yields 'unknown'. No isTmuxWindowPresent check — a missing window
 * makes capture-pane fail, which reads as '' → 'unknown'.
 *
 * @param {string} [precapturedTail] - Reuse an existing capturePaneTail() result
 */
export function detectAgentMode(conf: ConductorConf, agentName: string, precapturedTail?: string): AgentMode {
  const tail = precapturedTail ?? capturePaneTail(conf.sessionName, agentName, 15);
  if (tail === '') return 'unknown';

  if (/accept edits on \(shift\+tab to cycle\)/.test(tail)) return 'acceptEdits';
  if (/plan mode on \(shift\+tab to cycle\)/.test(tail)) return 'plan';
  if (/bypass permissions on(?: \(shift\+tab to cycle\))?/.test(tail)) return 'bypass';

  // No mode footer — 'default' only if Claude Code chrome is visible at all
  // (idle footer, busy footer, or the input-box border glyphs).
  if (/\? for shortcuts|esc to interrupt|│\s*>|❯|^\s*╭─/m.test(tail)) return 'default';

  return 'unknown';
}

/**
 * Check whether a tmux window exists in the given session.
 *
 * @param {string} sessionName - tmux session name
 * @param {string} windowName - tmux window name
 * @returns {boolean}
 */
export function isTmuxWindowPresent(sessionName: string, windowName: string): boolean {
  const result = spawnSync('tmux', ['has-session', '-t', `${sessionName}:${windowName}`], {
    encoding: 'utf8',
  });
  return result.status === 0;
}

export function sendTextToPane(sessionName: string, windowName: string, text: string): void {
  const target = `${sessionName}:${windowName}`;
  spawnSync('tmux', ['send-keys', '-t', target, '-l', '--', text], { encoding: 'utf8' });
  spawnSync('tmux', ['send-keys', '-t', target, 'Enter'], { encoding: 'utf8' });
}

// ── Active task derivation ──────────────────────────────────────────────────

interface DispatchRecord {
  ts: string;
  agent: string;
  command: string;
}

// dispatch.jsonl parse cache, invalidated on mtime/size change — pollAndDiff
// calls getActiveTask every 2s for every agent, so parse at most once per write.
let dispatchCache: { path: string; mtimeMs: number; size: number; records: Map<string, DispatchRecord> } | null = null;

/**
 * Last dispatch.jsonl record per agent (records with an empty command are
 * skipped). Whole-file read: the file is local and modest (one ~1-2 KB record
 * per dispatch); a tail-bytes read is the upgrade path if it ever grows large.
 */
function readLastDispatches(logDir: string): Map<string, DispatchRecord> {
  const filePath = path.join(logDir, 'dispatch.jsonl');
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return new Map();
  }
  if (dispatchCache && dispatchCache.path === filePath && dispatchCache.mtimeMs === stat.mtimeMs && dispatchCache.size === stat.size) {
    return dispatchCache.records;
  }

  const records = new Map<string, DispatchRecord>();
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return records;
  }
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const rec = JSON.parse(line) as Partial<DispatchRecord>;
      if (typeof rec.agent === 'string' && typeof rec.command === 'string' && rec.command !== '' && typeof rec.ts === 'string') {
        records.set(rec.agent, { ts: rec.ts, agent: rec.agent, command: rec.command });
      }
    } catch {
      // skip malformed line
    }
  }
  dispatchCache = { path: filePath, mtimeMs: stat.mtimeMs, size: stat.size, records };
  return records;
}

/**
 * The task an agent is currently running, derived from its last dispatch.jsonl
 * record — or null when the agent isn't working on a monitor-dispatched task.
 *
 * @param state - the already-computed detectAgentStatus() result (not re-detected)
 *
 * Returns null when:
 *   - state is not 'busy'/'awaiting'/'stalled' (Stop flips the file to idle,
 *     which naturally clears the task on completion; a stalled agent is
 *     mid-task by definition, so its task stays visible)
 *   - the agent has no dispatch record
 *   - the agent has no state file: mark_busy always creates one at dispatch
 *     time, so a regex-detected busy without a file was never monitor-dispatched
 *   - staleness guard (file content 'busy' only): the state file's mtime is
 *     more than 30s after the dispatch ts. For a dispatched task, mark_busy
 *     fires within the same second as the JSONL emit and the agent's own
 *     UserPromptSubmit hook rewrites 'busy' seconds later; nothing touches the
 *     file again until Stop, so the mtime stays pinned near the dispatch ts.
 *     A manual prompt rewrites 'busy' long after the last dispatch. The guard
 *     is skipped for 'awaiting' content — a permission dialog mid-task updates
 *     the mtime and would wrongly blank a genuinely dispatched task.
 */
export function getActiveTask(conf: ConductorConf, agentName: string, state: string): string | null {
  if (state !== 'busy' && state !== 'awaiting' && state !== 'stalled') return null;

  const record = readLastDispatches(conf.logDir).get(agentName);
  if (!record) return null;

  const stateFilePath = path.join(conf.stateDir, `${agentName}.state`);
  let fileState = '';
  let mtimeMs = 0;
  try {
    fileState = fs.readFileSync(stateFilePath, 'utf8').replace(/\r/g, '').split('\n')[0]?.trim() ?? '';
    mtimeMs = fs.statSync(stateFilePath).mtimeMs;
  } catch {
    return null;
  }

  if (fileState === 'busy' && mtimeMs - Date.parse(record.ts) > 30_000) {
    return null;
  }
  return record.command;
}
