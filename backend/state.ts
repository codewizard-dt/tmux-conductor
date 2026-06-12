import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
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
function capturePaneTail(sessionName: string, windowName: string, n: number): string {
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
 * Resolve an agent's effective status the same way monitor.sh's is_idle does,
 * so the dashboard never shows a bare "unknown" while the agent's window is alive.
 *
 * Precedence:
 *   1. window absent                       -> 'no-window'
 *   2. fresh hook-written state file       -> its value ('busy'|'idle'|'awaiting')
 *      ('busy' is always trusted; 'idle'/'awaiting' only when age <= 2*POLL_INTERVAL)
 *   3. capture-pane regex fallback         -> 'idle' if IDLE_PATTERN matches,
 *      'starting' if the pane is empty, else 'busy'
 *
 * @returns {'no-window'|'idle'|'busy'|'awaiting'|'starting'|'unknown'}
 */
export function detectAgentStatus(conf: ConductorConf, agentName: string): string {
  const { sessionName, stateDir, idlePattern, pollInterval } = conf;

  if (!isTmuxWindowPresent(sessionName, agentName)) {
    return 'no-window';
  }

  const filePath = path.join(stateDir, `${agentName}.state`);
  try {
    const state = fs.readFileSync(filePath, 'utf8').replace(/\r/g, '').split('\n')[0]?.trim() ?? '';
    if (state === 'busy' || state === 'awaiting') {
      return state;
    }
    if (state === 'idle') {
      const ageSeconds = (Date.now() - fs.statSync(filePath).mtimeMs) / 1000;
      if (ageSeconds <= pollInterval * 2) {
        return 'idle';
      }
      // stale idle — fall through to the regex fallback below
    }
  } catch {
    // no state file — fall through to the regex fallback below
  }

  const tail = capturePaneTail(sessionName, agentName, 5);
  if (tail === '') return 'starting';
  if (idlePattern) {
    // Match via `grep -qE` exactly like monitor.sh — IDLE_PATTERN is a POSIX ERE
    // (e.g. it uses [[:space:]]) that JavaScript's RegExp does not understand.
    const grep = spawnSync('grep', ['-qE', idlePattern], { input: tail, encoding: 'utf8' });
    if (grep.status === 0) return 'idle';
  }
  return 'busy';
}

/**
 * Count queued tasks for a given agent (including global/unscoped tasks).
 *
 * @param {string} taskQueuePath - Path to the task queue file (tasks.txt)
 * @param {string} agentName - Agent name used for scoped task matching
 * @returns {number}
 */
export function countQueuedTasks(taskQueuePath: string, agentName: string): number {
  try {
    const content = fs.readFileSync(taskQueuePath, 'utf8');
    const lines = content.split('\n');
    let count = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Count global (unscoped) tasks and tasks scoped to this agent
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) {
        // No prefix — global task
        count++;
      } else {
        const prefix = trimmed.slice(0, colonIdx).trim();
        if (prefix === agentName) {
          // Scoped to this agent
          count++;
        } else {
          // Check if prefix looks like an agent name (no spaces)
          // If it has spaces it's likely part of a command, not a scope prefix
          if (!prefix.includes(' ')) {
            // It's scoped to a different agent — skip
          } else {
            // Treat as global (the colon is inside a command)
            count++;
          }
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
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

/**
 * Read all non-empty lines from the task queue file.
 *
 * @param {string} taskQueuePath - Path to tasks.txt
 * @returns {string[]}
 */
export function readQueue(taskQueuePath: string): string[] {
  try {
    const content = fs.readFileSync(taskQueuePath, 'utf8');
    return content.split('\n').filter((l: string) => l.trim() !== '');
  } catch {
    return [];
  }
}

// Serialize concurrent writes via a simple promise chain
let writeChain = Promise.resolve();

/**
 * Write an array of lines back to the task queue file (one per line, trailing newline).
 *
 * @param {string} taskQueuePath - Path to tasks.txt
 * @param {string[]} lines
 * @returns {Promise<void>}
 */
export function writeQueue(taskQueuePath: string, lines: string[]): Promise<void> {
  writeChain = writeChain.then(() =>
    fsPromises.writeFile(taskQueuePath, lines.join('\n') + '\n'),
  );
  return writeChain;
}

/**
 * Return the global-array indices and display text for lines belonging to agentName.
 *
 * Scoped match:  line starts with "<agentName>: "
 * Global match:  trimmed line does not contain ": " (no scope prefix)
 *
 * @param {string[]} lines - Full queue array from readQueue()
 * @param {string} agentName
 * @returns {{ indices: number[], tasks: string[] }}
 */
export function getAgentLines(lines: string[], agentName: string): { indices: number[]; tasks: string[] } {
  const indices: number[] = [];
  const tasks: string[] = [];
  const scopePrefix = `${agentName}: `;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.startsWith(scopePrefix)) {
      indices.push(i);
      tasks.push(line.slice(scopePrefix.length));
    } else if (!line.includes(': ')) {
      // Global / unscoped task — visible to all agents
      indices.push(i);
      tasks.push(line.trim());
    }
  }
  return { indices, tasks };
}
