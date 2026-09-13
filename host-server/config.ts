import { execSync } from 'child_process';
import * as path from 'path';

export interface AgentEntry {
  name: string;
  workdir: string;
  launchCmd: string;
}

export type BgProcessEntry = AgentEntry;

export interface ConductorConf {
  sessionName: string;
  taskQueue: string;
  stateDir: string;
  logDir: string;
  dbPath: string;
  _confPath: string;
  idlePattern: string;
  busyPattern: string;
  awaitingPattern: string;
  pollInterval: number;
  stallTimeout: number;
  contextWindow: number;
  statusPollMs: number;
  terminalPollMs: number;
  focusedTerminalPollMs: number;
  focusedTerminalWsPollMs: number;
  terminalTailLines: number;
  focusedTerminalTailLines: number;
  terminalLogMaxRowsPerAgent: number;
  metricsSnapshotIntervalMs: number;
  // BUG-0001: staleness bound (ms) for hooks/on-notification.js's
  // pending-agents sentinel — see pendingAgents.ts and conductor.conf's
  // PENDING_AGENT_STALE_S comment.
  pendingAgentStaleMs: number;
  agents: AgentEntry[];
  bgProcesses: BgProcessEntry[];
  agentBgLinks: Record<string, string>;
}

// Single source of truth: the repo-root conductor.conf that monitor.sh and
// conductor.sh also source. Overridable via CONDUCTOR_CONF.
const confPath = {
  process: process.env['CONDUCTOR_CONF'],
  meta: new URL('../conductor.conf', import.meta.url).pathname
};
console.log('confPath:', confPath);
export const DEFAULT_CONF_PATH = confPath.process || confPath.meta;


let cache: ConductorConf | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5000;
const CONFIG_SYNC_TIMEOUT_MS = Number(process.env['CONFIG_SYNC_TIMEOUT_MS'] ?? '1000');

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

function parsePositiveIntSetting(output: string, varName: string, defaultValue: number): number {
  const parsed = parseInt(parseScalar(parseDeclare(output, varName)), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
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
  const cmd = `bash -c "source ${confPath} && declare -p BG_PROCESSES AGENT_BG_LINKS SESSION_NAME STATE_DIR LOG_DIR DB_PATH IDLE_PATTERN BUSY_PATTERN AWAITING_PATTERN POLL_INTERVAL CONTEXT_WINDOW STATUS_POLL_MS TERMINAL_POLL_MS FOCUSED_TERMINAL_POLL_MS FOCUSED_TERMINAL_WS_POLL_MS TERMINAL_TAIL_LINES FOCUSED_TERMINAL_TAIL_LINES TERMINAL_LOG_MAX_ROWS_PER_AGENT METRICS_SNAPSHOT_INTERVAL_MS PENDING_AGENT_STALE_S 2>/dev/null || true"`;
  const output = execSync(cmd, { encoding: 'utf8', timeout: CONFIG_SYNC_TIMEOUT_MS });

  // Relative paths in the conf (./logs/state, ./data/conductor.db) are relative to the
  // conf file's directory, NOT the backend process cwd — resolve them here so
  // every consumer (and every spawned agent's env) gets an absolute path.
  const confDir = path.dirname(path.resolve(confPath));
  const resolveConfPath = (p: string): string => (p ? path.resolve(confDir, p) : p);

  const sessionName = parseScalar(parseDeclare(output, 'SESSION_NAME'));
  const taskQueue = resolveConfPath(parseScalar(parseDeclare(output, 'TASK_QUEUE')));
  const stateDir = resolveConfPath(parseScalar(parseDeclare(output, 'STATE_DIR')));
  const logDir = resolveConfPath(parseScalar(parseDeclare(output, 'LOG_DIR')) || './logs');
  const dbPath = resolveConfPath(parseScalar(parseDeclare(output, 'DB_PATH')) || './data/conductor.db');
  const idlePattern = parseScalar(parseDeclare(output, 'IDLE_PATTERN'));
  const busyPattern = parseScalar(parseDeclare(output, 'BUSY_PATTERN'));
  const awaitingPattern = parseScalar(parseDeclare(output, 'AWAITING_PATTERN'));
  const pollInterval = parseInt(parseScalar(parseDeclare(output, 'POLL_INTERVAL')), 10) || 15;
  const stallTimeout = parseInt(parseScalar(parseDeclare(output, 'STALL_TIMEOUT')), 10) || 300;
  const contextWindow = parseInt(parseScalar(parseDeclare(output, 'CONTEXT_WINDOW')), 10) || 200000;
  const statusPollMs = parsePositiveIntSetting(output, 'STATUS_POLL_MS', 2000);
  const terminalPollMs = parsePositiveIntSetting(output, 'TERMINAL_POLL_MS', 2000);
  const focusedTerminalPollMs = parsePositiveIntSetting(output, 'FOCUSED_TERMINAL_POLL_MS', 250);
  const focusedTerminalWsPollMs = parsePositiveIntSetting(output, 'FOCUSED_TERMINAL_WS_POLL_MS', focusedTerminalPollMs);
  const terminalTailLines = parsePositiveIntSetting(output, 'TERMINAL_TAIL_LINES', 100);
  const focusedTerminalTailLines = parsePositiveIntSetting(output, 'FOCUSED_TERMINAL_TAIL_LINES', 300);
  const terminalLogMaxRowsPerAgent = parsePositiveIntSetting(output, 'TERMINAL_LOG_MAX_ROWS_PER_AGENT', 500);
  // TASK-119: interval between full liveUpdateMetrics snapshots persisted to
  // observability.jsonl (restart survivability — see appendObservabilityLog call site).
  const metricsSnapshotIntervalMs = parsePositiveIntSetting(output, 'METRICS_SNAPSHOT_INTERVAL_MS', 60000);
  // BUG-0001: PENDING_AGENT_STALE_S is in seconds in the conf (human-facing);
  // convert to ms here for direct comparison against Date.now()/mtimeMs.
  const pendingAgentStaleMs = parsePositiveIntSetting(output, 'PENDING_AGENT_STALE_S', 3600) * 1000;
  const agentsRaw = parseArray(parseDeclare(output, 'AGENTS'));
  const agents = agentsRaw.map(parseAgentEntry);
  const bgProcessesRaw = parseArray(parseDeclare(output, 'BG_PROCESSES'));
  const bgProcesses = bgProcessesRaw.map(parseAgentEntry);
  const bgLinksRaw = parseArray(parseDeclare(output, 'AGENT_BG_LINKS'));
  const agentBgLinks: Record<string, string> = {};
  for (const link of bgLinksRaw) {
    const colon = link.indexOf(':');
    if (colon > 0) {
      agentBgLinks[link.slice(0, colon).trim()] = link.slice(colon + 1).trim();
    }
  }

  cache = {
    sessionName,
    taskQueue,
    stateDir,
    logDir,
    dbPath,
    _confPath: path.resolve(confPath),
    idlePattern,
    busyPattern,
    awaitingPattern,
    pollInterval,
    stallTimeout,
    contextWindow,
    statusPollMs,
    terminalPollMs,
    focusedTerminalPollMs,
    focusedTerminalWsPollMs,
    terminalTailLines,
    focusedTerminalTailLines,
    terminalLogMaxRowsPerAgent,
    metricsSnapshotIntervalMs,
    pendingAgentStaleMs,
    agents,
    bgProcesses,
    agentBgLinks,
  };
  cacheTime = now;
  return cache;
}

