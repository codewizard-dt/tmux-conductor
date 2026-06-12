import { execSync } from 'child_process';
import * as fs from 'fs/promises';

export interface AgentEntry {
  name: string;
  workdir: string;
  launchCmd: string;
}

export interface ConductorConf {
  sessionName: string;
  taskQueue: string;
  stateDir: string;
  idlePattern: string;
  awaitingPattern: string;
  pollInterval: number;
  agents: AgentEntry[];
}

const confPath = {
  process: process.env['CONDUCTOR_CONF'],
  meta: new URL('./conductor.conf', import.meta.url).pathname
};
console.log('confPath:', confPath);
export const DEFAULT_CONF_PATH = confPath.process || confPath.meta;


let cache: ConductorConf | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5000;

/**
 * Drop the cached conf so the next readConductorConf() re-reads the file.
 * Call after any mutation of conductor.conf (agent add/remove) so /status and
 * the SSE poll loop reflect the change immediately instead of after the TTL.
 */
export function clearConfCache(): void {
  cache = null;
  cacheTime = 0;
}

/**
 * Parse the `declare -px` output from bash for a given variable name.
 * Returns the raw value string (with surrounding quotes stripped for scalars,
 * or the parenthesised body for arrays).
 */
function parseDeclare(output: string, varName: string): string | null {
  // Match: declare -x VARNAME="value"  OR  declare -ax VARNAME=([0]="v" ...)
  const re = new RegExp(
    `declare\\s+-[a-z-]*\\s+${varName}=(.+)`,
    'm'
  );
  const m = output.match(re);
  if (!m || m[1] === undefined) return null;
  return m[1].trim();
}

/**
 * Parse a bash scalar value (strips outer double-quotes, handles escapes).
 */
function parseScalar(raw: string | null): string {
  if (!raw) return '';
  // Remove surrounding double-quotes if present.
  // `declare -p` double-quotes scalars and backslash-escapes ", \, $ and `
  // so the value round-trips through `source`; undo exactly those escapes.
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\([$`"\\])/g, '$1');
  }
  // Single-quoted scalars (bash uses these for values it can't double-quote
  // cleanly) are emitted verbatim between the quotes — strip the quotes only.
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * Parse a bash indexed-array declaration body like:
 *   ([0]="entry1" [1]="entry2")
 * Returns an array of string values.
 */
function parseArray(raw: string | null): string[] {
  if (!raw) return [];
  // Strip outer parens
  const inner = raw.replace(/^\(|\)$/g, '').trim();
  const entries: string[] = [];
  // Match [N]="value" — value may contain escaped quotes
  const entryRe = /\[\d+\]="((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(inner)) !== null) {
    const val = m[1];
    if (val !== undefined) {
      entries.push(val.replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    }
  }
  return entries;
}

/**
 * Parse an AGENTS entry string: "name:workdir:launch_cmd"
 * The launch_cmd may itself contain colons, so we only split on the first two.
 */
function parseAgentEntry(entry: string): AgentEntry {
  const parts = entry.split(':');
  const name = (parts[0] ?? '').trim();
  const workdir = (parts[1] ?? '').trim();
  const launchCmd = parts.slice(2).join(':').trim();
  return { name, workdir, launchCmd };
}

/**
 * Read and parse conductor.conf, returning structured config.
 * Results are cached for CACHE_TTL_MS milliseconds.
 *
 * @param {string} [confPath] - Path to conductor.conf (defaults to env/relative)
 * @returns {{ sessionName: string, taskQueue: string, stateDir: string, agents: Array<{name:string,workdir:string,launchCmd:string}> }}
 */
export function readConductorConf(confPath: string = DEFAULT_CONF_PATH): ConductorConf {
  const now = Date.now();
  if (cache !== null && now - cacheTime < CACHE_TTL_MS) {
    return cache;
  }

  // `2>/dev/null || true` keeps this resilient when a conf predates the
  // IDLE_PATTERN/AWAITING_PATTERN/POLL_INTERVAL settings: declare -p still
  // prints the variables that exist, and missing ones simply parse as empty
  // (pollInterval then falls back to 15, idlePattern to '' → regex skipped).
  const cmd = `bash -c "source ${confPath} && declare -p AGENTS SESSION_NAME TASK_QUEUE STATE_DIR IDLE_PATTERN AWAITING_PATTERN POLL_INTERVAL 2>/dev/null || true"`;
  const output = execSync(cmd, { encoding: 'utf8' });

  const sessionName = parseScalar(parseDeclare(output, 'SESSION_NAME'));
  const taskQueue = parseScalar(parseDeclare(output, 'TASK_QUEUE'));
  const stateDir = parseScalar(parseDeclare(output, 'STATE_DIR'));
  const idlePattern = parseScalar(parseDeclare(output, 'IDLE_PATTERN'));
  const awaitingPattern = parseScalar(parseDeclare(output, 'AWAITING_PATTERN'));
  const pollInterval = parseInt(parseScalar(parseDeclare(output, 'POLL_INTERVAL')), 10) || 15;
  const agentsRaw = parseArray(parseDeclare(output, 'AGENTS'));
  const agents = agentsRaw.map(parseAgentEntry);

  cache = { sessionName, taskQueue, stateDir, idlePattern, awaitingPattern, pollInterval, agents };
  cacheTime = now;
  return cache;
}

/**
 * Append a new agent entry to the AGENTS=(...) array in conductor.conf.
 * Reads the file as text, finds the closing `)` of the AGENTS block, inserts
 * the new entry line before it, and writes the file back.
 *
 * @param {string} confPath - Absolute path to conductor.conf
 * @param {string} name - Agent name (used as tmux window name)
 * @param {string} workdir - Absolute working directory path
 * @param {string} launchCmd - Shell command to start the agent
 * @returns {Promise<void>}
 * @throws {Error} If the AGENTS=( block is not found
 */
export async function appendAgentToConf(confPath: string, name: string, workdir: string, launchCmd: string): Promise<void> {
  const text = await fs.readFile(confPath, 'utf8');
  const lines = text.split('\n');

  // Find the start of the AGENTS=( block
  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^AGENTS=\(/.test(lines[i] ?? '')) {
      blockStart = i;
      break;
    }
  }
  if (blockStart === -1) {
    throw new Error(`AGENTS=( block not found in ${confPath}`);
  }

  // Find the closing ) of the AGENTS block (first line that is just ")")
  let blockEnd = -1;
  for (let i = blockStart + 1; i < lines.length; i++) {
    if (/^\)/.test(lines[i] ?? '')) {
      blockEnd = i;
      break;
    }
  }
  if (blockEnd === -1) {
    throw new Error(`Closing ) of AGENTS block not found in ${confPath}`);
  }

  // Insert the new entry before the closing )
  const newEntry = `  "${name}:${workdir}:${launchCmd}"`;
  lines.splice(blockEnd, 0, newEntry);

  await fs.writeFile(confPath, lines.join('\n'), 'utf8');
}

/**
 * Remove an agent entry from the AGENTS=(...) array in conductor.conf.
 * Matches the entry line by its `"name:` prefix inside the AGENTS block.
 *
 * @param {string} confPath - Absolute path to conductor.conf
 * @param {string} name - Agent name to remove
 * @returns {Promise<void>}
 * @throws {Error} If the AGENTS=( block or the agent's entry is not found
 */
export async function removeAgentFromConf(confPath: string, name: string): Promise<void> {
  const text = await fs.readFile(confPath, 'utf8');
  const lines = text.split('\n');

  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^AGENTS=\(/.test(lines[i] ?? '')) {
      blockStart = i;
      break;
    }
  }
  if (blockStart === -1) {
    throw new Error(`AGENTS=( block not found in ${confPath}`);
  }

  let blockEnd = -1;
  for (let i = blockStart + 1; i < lines.length; i++) {
    if (/^\)/.test(lines[i] ?? '')) {
      blockEnd = i;
      break;
    }
  }
  if (blockEnd === -1) {
    throw new Error(`Closing ) of AGENTS block not found in ${confPath}`);
  }

  const entryRe = new RegExp(`^\\s*"${name}:`);
  const entryIdx = lines.findIndex(
    (line, i) => i > blockStart && i < blockEnd && entryRe.test(line),
  );
  if (entryIdx === -1) {
    throw new Error(`Agent '${name}' not found in AGENTS block of ${confPath}`);
  }

  lines.splice(entryIdx, 1);
  await fs.writeFile(confPath, lines.join('\n'), 'utf8');
}
