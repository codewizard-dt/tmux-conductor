import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';

/**
 * Read the state file for a given agent.
 *
 * @param {string} stateDir - Directory containing <agentName>.state files
 * @param {string} agentName - Agent name (without extension)
 * @returns {'idle'|'busy'|'unknown'}
 */
export function readAgentState(stateDir, agentName) {
  const filePath = path.join(stateDir, `${agentName}.state`);
  try {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    return content;
  } catch {
    return 'unknown';
  }
}

/**
 * Count queued tasks for a given agent (including global/unscoped tasks).
 *
 * @param {string} taskQueuePath - Path to the task queue file (tasks.txt)
 * @param {string} agentName - Agent name used for scoped task matching
 * @returns {number}
 */
export function countQueuedTasks(taskQueuePath, agentName) {
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
export function isTmuxWindowPresent(sessionName, windowName) {
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
export function readQueue(taskQueuePath) {
  try {
    const content = fs.readFileSync(taskQueuePath, 'utf8');
    return content.split('\n').filter((l) => l.trim() !== '');
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
export function writeQueue(taskQueuePath, lines) {
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
export function getAgentLines(lines, agentName) {
  const indices = [];
  const tasks = [];
  const scopePrefix = `${agentName}: `;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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
