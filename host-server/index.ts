import { spawnSync, execSync } from 'child_process';
import { existsSync, unlinkSync, renameSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync, appendFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { monitorEventLoopDelay, performance } from 'perf_hooks';
import Fastify, { type FastifyReply } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { readConductorConf, DEFAULT_CONF_PATH, type ConductorConf } from './config.ts';
import { clampTailLines, readLogTail } from './bgOutput.ts';
import { restartBgProcess, startBgWindow, defaultBgRestartDeps } from './bgRestart.ts';
import { scrubLeakyEnv } from './spawnEnv.ts';
import { resolveCallerProject, authorizeRestart, describeCaller } from './bgAccess.ts';
import { BG_CALLER_HEADER, parseCallerHeader, callerKindFor, evaluateCooldown, buildAuditRecord, defaultAuditDeps, appendAuditRecord, getRestartHistory, type BgRestartAuditInput } from './bgRestartPolicy.ts';
import type Database from 'better-sqlite3';
import { openDb, getDbPath, listAgents, getAgentById, createAgent, cloneAgentRecord, addWorktreeToAgent, clearAgentWorktree, deleteAgent, updateAgentName, updateAgentRole, updateAgentDescription, agentWindowName, addTask, deleteTask, reorderTasks, jumpTaskToHead, moveTaskToProject, listTasksForAgentId, listTasksByProject, listCompletedTasks, listProjects, createProject, updateProject, deleteProject, nextAgentName, listSchedules, createSchedule, updateSchedule, deleteSchedule, dueSchedules, fireSchedule, getAllAgentUsageTotals, listAgentUsage, listCheckpoints, insertCheckpoint, getCheckpoint, listTerminalLog, appendTerminalLogChunk, popTask, createBgProcess, deleteBgProcess, updateBgProcess, listBgProcesses, bgSlug, bgSlugCollides, getBgBySlug, listBgSlugs, type AgentUsageTotals, type Agent } from './db.ts';
import { detectAgentStatusWithBackgroundJobs, detectAgentMode, detectAgentType, readTmuxWindowInventory, isTmuxWindowPresent, bgLiveness, bgLivenessForWindow, windowTarget, windowState, getActiveTask, capturePaneTail as capturePaneTailUninstrumented, capturePaneTailRaw as capturePaneTailRawUninstrumented, sendDispatchToPane, extractPaneLabel, applyGlobalPaneSize, type AgentMode, type AgentRunState, type AgentType, type DetectionReason } from './state.ts';
import { getAgentContext, getCodexAgentContext, type AgentContext } from './context.ts';
import dotenv from 'dotenv';
import { getUserSkills, getPluginSkills, getProjectSkills } from './skills.ts';
import { buildNewAgentUpdate } from './agentUpdatePayload.ts';
import { isGitRepo, isInGitRepoCached, detectBaseBranch, agentPaneCwd, stashCheckpoint, applyStash } from './git.ts';
import { teardownAgentWorktree } from './worktreeTeardown.ts';
import { ROLE_VALUES } from './rolePresets.ts';
import { WorktreeError, worktreeErrorStatus } from './worktreeErrors.ts';
import { extractUsageDeltas, resetUsageMemo } from './usage.ts';
import { recordUsageDeltas, resetUsageStore } from './usage-store.ts';
import { hasPendingBackgroundAgents } from './pendingAgents.ts';
import { agentSnapshotChanged } from './agentDiff.ts';
import { bgStatusChanged } from './bgDiff.ts';
import { readLastPrompt, removeLastPromptSidecar, type LastPrompt } from './lastPrompt.ts';
import { LIVE_UPDATE_PERF_BUDGETS } from './perfBudgets.ts';


const envPath = new URL('../.env', import.meta.url);

dotenv.config({ path: envPath });

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection:', reason);
  console.error('Promise:', promise);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

const structuredRequestLogging =
  process.env['FASTIFY_STRUCTURED_LOGS'] === '1' ||
  process.env['FASTIFY_REQUEST_LOGS'] === '1';
const fastify = Fastify({
  logger: structuredRequestLogging
    ? { level: process.env['FASTIFY_LOG_LEVEL'] ?? 'info' }
    : false,
});


const corsOrigin = process.env['CORS_ORIGIN'] || '*';

await fastify.register(fastifyCors, {
  origin: corsOrigin,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
});
await fastify.register(fastifyWebsocket);

// Raw binary uploads (dashboard image drops) arrive as application/octet-stream
// and parse to a Buffer. The default 1 MB body limit still applies to JSON;
// the upload route raises its own limit.
fastify.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body);
});

// ── Permission-mode switching state ──────────────────────────────────────────

const VALID_MODES = ['default', 'acceptEdits', 'plan', 'bypass'] as const;
const modeSwitchInFlight = new Set<string>();

// Direct-input endpoint limits: tmux key names the dashboard may forward, and
// payload caps. Key names can never start with '-' so they are safe as
// send-keys positional args.
const TMUX_KEY_RE = /^(Enter|Escape|Tab|BTab|Space|BSpace|DC|IC|Up|Down|Left|Right|Home|End|PPage|NPage|F([1-9]|1[0-2])|C-[a-z]|M-[A-Za-z]|C-(Left|Right|Up|Down)|M-(Left|Right|Up|Down))$/;
const MAX_KEYS = 32;
const MAX_TEXT = 10_000;
const TMUX_SYNC_TIMEOUT_MS = Number(process.env['TMUX_SYNC_TIMEOUT_MS'] ?? '100');
const TMUX_LAUNCH_TIMEOUT_MS = Number(process.env['TMUX_LAUNCH_TIMEOUT_MS'] ?? '5000');
const SHELL_SYNC_TIMEOUT_MS = Number(process.env['SHELL_SYNC_TIMEOUT_MS'] ?? '2000');
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ── Session recovery ──────────────────────────────────────────────────────────

const REPO_ROOT = path.dirname(path.resolve(DEFAULT_CONF_PATH));

// Open (or create) the SQLite database. This runs schema migrations and the
// one-time legacy seed on first start. Errors surface immediately at startup
// rather than on the first request.
const db = openDb(getDbPath(readConductorConf()));

// Image-drop uploads: dropped/pasted dashboard images land here (repo-local
// tmp/, gitignored) before their path is typed into the agent's pane.
const UPLOAD_DIR = path.join(REPO_ROOT, 'tmp', 'dashboard-drops');
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FOCUSED_WS_BUFFERED_BYTES_LIMIT = 256 * 1024;
const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function pruneOldUploads(): void {
  let names: string[];
  try { names = readdirSync(UPLOAD_DIR); } catch { return; }
  const cutoff = Date.now() - UPLOAD_MAX_AGE_MS;
  for (const n of names) {
    const p = path.join(UPLOAD_DIR, n);
    try { if (statSync(p).mtimeMs < cutoff) unlinkSync(p); } catch { /* raced with another delete — fine */ }
  }
}

function tmuxSessionExists(sessionName: string): boolean {
  return spawnSync('tmux', ['has-session', '-t', sessionName], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS }).status === 0;
}

// Recreate the monitor window inside an existing session, mirroring
// conductor.sh. No-op when the window is already there. Returns true if the
// window is present (or was just created), false if creation failed.
function healMonitorWindow(sessionName: string): boolean {
  if (isTmuxWindowPresent(sessionName, 'monitor')) return true;
  const monitorScript = path.join(REPO_ROOT, 'scripts', 'monitor.sh');
  const created = spawnSync('tmux', ['new-window', '-t', sessionName, '-n', 'monitor', '-c', REPO_ROOT], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
  if (created.status !== 0) return false;
  spawnSync('tmux', ['send-keys', '-t', windowTarget(sessionName, 'monitor'), monitorScript, 'Enter'], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
  return true;
}

let sessionStartInFlight = false;
let lastMonitorHealAttempt = 0;
const MONITOR_HEAL_COOLDOWN_MS = 30_000;
const CONTEXT_REFRESH_MS = 10_000;

// ── Background-process status (shared by /status and the poll loop) ──────────

/** True for a better-sqlite3 UNIQUE constraint violation (e.g. the `(project_id, name)` bg index). */
function isUniqueConstraintError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || (err instanceof Error && /UNIQUE constraint failed/.test(err.message));
}

interface BgStatus {
  /** Derived identity `<projectName>-<name>` (bare name when no project): tmux window, `bg-<slug>.log|state`, `/bg-processes/:slug`. */
  slug: string;
  /** Display name (unique per project only). */
  name: string;
  workdir: string;
  launchCmd: string;
  windowPresent: boolean;
  /** 'running' (process in pane) | 'exited' (window open but pane fell back to a shell) | 'stopped' (no window). */
  liveness: 'running' | 'exited' | 'stopped';
  state: string | null;
  logPath: string;
  statePath: string;
  projectId: number | null;
  projectName: string | null;
  /** TASK-0193: last successful restart (ISO timestamp + the `X-Conductor-Agent` caller, null = dashboard), or null. */
  lastRestart: { at: string; caller: string | null } | null;
}

function buildBgStatuses(
  conf: ReturnType<typeof readConductorConf>,
  windowInventory?: Map<string, string>,
  windowActivityMs?: Map<string, number>,
): BgStatus[] {
  const { sessionName, stateDir, logDir } = conf;
  const nowMs = Date.now();
  const bgProcesses = listBgProcesses(db);
  const projects = listProjects(db);

  return bgProcesses.map((bg) => {
    const projectName = bg.projectId !== null ? (projects.find((p) => p.id === bg.projectId)?.name ?? null) : null;
    const slug = bgSlug(bg, projectName);
    const statePath = path.join(stateDir, `bg-${slug}.state`);
    let bgState: string | null = null;
    try { bgState = readFileSync(statePath, 'utf8').trim(); } catch { /* not written yet */ }
    // Inventory path: window presence + pane command come from the one list-windows call (zero extra
    // tmux cost). Fallback path: a single display-message resolves both.
    const windowPresent = windowInventory ? windowInventory.has(slug) : isTmuxWindowPresent(sessionName, slug);
    let liveness: BgStatus['liveness'];
    if (windowInventory) {
      const activityMs = windowActivityMs?.get(slug);
      liveness = bgLiveness({
        windowPresent,
        paneCommand: windowInventory.get(slug),
        launchCmd: bg.launchCmd,
        ...(activityMs !== undefined ? { windowActivityMs: activityMs, nowMs } : {}),
      });
    } else {
      liveness = windowPresent ? bgLivenessForWindow(sessionName, slug, bg.launchCmd) : 'stopped';
    }
    return {
      slug,
      name: bg.name,
      workdir: bg.workdir,
      launchCmd: bg.launchCmd,
      windowPresent,
      liveness,
      state: bgState,
      logPath: path.join(logDir, `bg-${slug}.log`),
      statePath,
      projectId: bg.projectId,
      projectName,
      lastRestart: getRestartHistory(logDir).lastRestart(slug),
    };
  });
}

function buildQueuedTaskCounts(agents: Array<{ id: number; projectId: number | null }>): Map<number, number> {
  const rows = db.prepare(`SELECT agent_id, project_id FROM tasks WHERE status='queued'`).all() as Array<{
    agent_id: number | null;
    project_id: number | null;
  }>;
  let globalCount = 0;
  const agentCounts = new Map<number, number>();
  const projectCounts = new Map<number, number>();

  for (const row of rows) {
    if (row.agent_id !== null) {
      agentCounts.set(row.agent_id, (agentCounts.get(row.agent_id) ?? 0) + 1);
      continue;
    }
    if (row.project_id !== null) {
      projectCounts.set(row.project_id, (projectCounts.get(row.project_id) ?? 0) + 1);
      continue;
    }
    globalCount += 1;
  }

  const counts = new Map<number, number>();
  for (const agent of agents) {
    counts.set(
      agent.id,
      globalCount + (agentCounts.get(agent.id) ?? 0) + (agent.projectId !== null ? (projectCounts.get(agent.projectId) ?? 0) : 0),
    );
  }
  return counts;
}

function emptyAgentContext(conf: ReturnType<typeof readConductorConf>): AgentContext {
  return {
    model: null,
    modelId: null,
    contextTokens: null,
    contextPct: null,
    contextLimit: conf.contextWindow,
    contextLimitConfident: false,
  };
}

function getContextForAgent(
  conf: ReturnType<typeof readConductorConf>,
  agentType: AgentType,
  windowName: string,
  workdir: string,
  isBusy: boolean,
  paneTail?: string,
): AgentContext {
  if (agentType === 'codex') return getCodexAgentContext(workdir, conf.contextWindow);
  if (agentType !== 'claude') return emptyAgentContext(conf);
  return getAgentContext(windowName, workdir, conf.stateDir, conf.contextWindow, isBusy, paneTail);
}

function refreshAgentContextCache(conf: ReturnType<typeof readConductorConf>): void {
  const { sessionName } = conf;
  const inventory = readTmuxWindowInventory(sessionName);
  const agents = listAgents(db);

  for (const agent of agents) {
    const wn = agentWindowName(agent);
    const paneCurrentCommand = inventory.windows.get(wn) ?? null;
    const windowPresent = paneCurrentCommand !== null;
    const tail15 = windowPresent ? capturePaneTail(sessionName, wn, 15, 'status') : '';
    const { state } = detectAgentStatusWithBackgroundJobs(conf, wn, agent.launchCmd, agentPaneCwd(agent), tail15 || undefined, windowPresent, paneCurrentCommand);
    const isBusy = state === 'busy' || state === 'awaiting' || state === 'stalled';
    const agentType = detectAgentType(agent.launchCmd);
    const ctx = windowPresent
      ? getContextForAgent(conf, agentType, wn, agentPaneCwd(agent), isBusy, tail15 || undefined)
      : emptyAgentContext(conf);
    recordUsageDeltas(db, { id: agent.id, name: wn }, extractUsageDeltas(wn, agent.workdir, conf.stateDir));

    agentContextCache.set(agent.id, ctx);
    if (state === 'no-window') {
      agentLabelCache.set(agent.id, null);
    } else if (agentLabelCache.get(agent.id) == null && windowPresent) {
      agentLabelCache.set(agent.id, extractPaneLabel(tail15));
    }
  }
}

// ── Shared tmux helpers ───────────────────────────────────────────────────────

// The pane starts in `agentPaneCwd(agent)`: the agent's worktree when it has one
// (so the running agent edits its isolated checkout, matching what the dashboard
// diffs/stashes/checkpoints), else its `workdir`.
function spawnAgentWindow(
  agent: { name: string; workdir: string; worktreePath?: string | null; launchCmd: string; projectName?: string | null },
  conf: ReturnType<typeof readConductorConf>,
): void {
  const { sessionName, stateDir, logDir } = conf;
  const winName = agent.projectName ? `${agent.projectName}-${agent.name}` : agent.name;
  const target = windowTarget(sessionName, winName);
  const paneCwd = agentPaneCwd({ workdir: agent.workdir, worktreePath: agent.worktreePath ?? null });
  const created = spawnSync('tmux', ['new-window', '-t', sessionName, '-n', winName, '-c', paneCwd], {
    encoding: 'utf8',
    timeout: TMUX_LAUNCH_TIMEOUT_MS,
  });
  if (created.status !== 0) {
    throw new Error(`tmux new-window failed for ${target}: ${created.stderr || created.stdout || 'unknown error'}`);
  }

  const launchText = `CONDUCTOR_AGENT_NAME='${winName}' CONDUCTOR_STATE_DIR='${stateDir}' CONDUCTOR_LOG_DIR='${logDir}' ${agent.launchCmd}`;
  const sent = spawnSync('tmux', ['send-keys', '-t', target, '-l', '--', launchText], {
    encoding: 'utf8',
    timeout: TMUX_LAUNCH_TIMEOUT_MS,
  });
  if (sent.status !== 0) {
    throw new Error(`tmux send-keys failed for ${target}: ${sent.stderr || sent.stdout || 'unknown error'}`);
  }
  const entered = spawnSync('tmux', ['send-keys', '-t', target, 'Enter'], {
    encoding: 'utf8',
    timeout: TMUX_LAUNCH_TIMEOUT_MS,
  });
  if (entered.status !== 0) {
    throw new Error(`tmux send-keys Enter failed for ${target}: ${entered.stderr || entered.stdout || 'unknown error'}`);
  }
}

// ── SSE state (shared between the /api plugin and the poll loop) ─────────────

const sseClients = new Set<FastifyReply>();

type TimedMetricName =
  | 'statusTicks'
  | 'terminalTicks'
  | 'focusedTerminalTicks'
  | 'tmuxCaptureTail'
  | 'tmuxCaptureTailRaw'
  | 'sseBroadcasts'
  | 'tailRequests'
  | 'terminalWsSnapshots'
  | 'terminalWsInputAck'
  | 'terminalWsInputEcho';

interface TimingSummary {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
}

interface TmuxOperationSummary extends TimingSummary {
  errors: number;
  timeouts: number;
}

interface LiveUpdateMetrics {
  startedAt: string;
  activeSseConnections: number;
  sseConnections: {
    opened: number;
    closed: number;
  };
  sseBroadcastsByEvent: Record<string, number>;
  timings: Record<TimedMetricName, TimingSummary>;
  tmuxOperations: Record<string, TmuxOperationSummary>;
  terminalWebSocket: {
    activeConnections: number;
    opened: number;
    closed: number;
    messagesIn: number;
    inputAcks: number;
    inputEchoes: number;
    errors: number;
  };
  statusTransitions: Record<string, number>;
}

function createTimingSummary(): TimingSummary {
  return { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
}

const liveUpdateMetrics: LiveUpdateMetrics = {
  startedAt: new Date().toISOString(),
  activeSseConnections: 0,
  sseConnections: { opened: 0, closed: 0 },
  sseBroadcastsByEvent: {},
  timings: {
    statusTicks: createTimingSummary(),
    terminalTicks: createTimingSummary(),
    focusedTerminalTicks: createTimingSummary(),
    tmuxCaptureTail: createTimingSummary(),
    tmuxCaptureTailRaw: createTimingSummary(),
    sseBroadcasts: createTimingSummary(),
    tailRequests: createTimingSummary(),
    terminalWsSnapshots: createTimingSummary(),
    terminalWsInputAck: createTimingSummary(),
    terminalWsInputEcho: createTimingSummary(),
  },
  tmuxOperations: {},
  terminalWebSocket: {
    activeConnections: 0,
    opened: 0,
    closed: 0,
    messagesIn: 0,
    inputAcks: 0,
    inputEchoes: 0,
    errors: 0,
  },
  statusTransitions: {},
};

const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();
let lastEventLoopUtilization = performance.eventLoopUtilization();

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function eventLoopNsToMs(value: number): number {
  if (!Number.isFinite(value) || value > 1_000_000_000_000_000) return 0;
  return roundMs(value / 1_000_000);
}

function recordTiming(name: TimedMetricName, durationMs: number): void {
  const metric = liveUpdateMetrics.timings[name];
  metric.count += 1;
  metric.totalMs = roundMs(metric.totalMs + durationMs);
  metric.lastMs = roundMs(durationMs);
  metric.maxMs = roundMs(Math.max(metric.maxMs, durationMs));
}

function createTmuxOperationSummary(): TmuxOperationSummary {
  return { ...createTimingSummary(), errors: 0, timeouts: 0 };
}

function recordTmuxOperation(
  operation: string,
  owner: string,
  durationMs: number,
  result: { error?: boolean; timedOut?: boolean } = {},
): void {
  const key = `${owner}:${operation}`;
  const metric = liveUpdateMetrics.tmuxOperations[key] ?? createTmuxOperationSummary();
  metric.count += 1;
  metric.totalMs = roundMs(metric.totalMs + durationMs);
  metric.lastMs = roundMs(durationMs);
  metric.maxMs = roundMs(Math.max(metric.maxMs, durationMs));
  if (result.error) metric.errors += 1;
  if (result.timedOut) metric.timeouts += 1;
  liveUpdateMetrics.tmuxOperations[key] = metric;
  if (result.timedOut) {
    appendObservabilityLog('tmux_timeout', { operation, owner, durationMs: roundMs(durationMs) });
  }
}

function readEventLoopMetrics() {
  const utilization = performance.eventLoopUtilization(lastEventLoopUtilization);
  lastEventLoopUtilization = performance.eventLoopUtilization();
  return {
    delay: {
      minMs: eventLoopNsToMs(eventLoopDelay.min),
      meanMs: eventLoopNsToMs(eventLoopDelay.mean),
      maxMs: eventLoopNsToMs(eventLoopDelay.max),
      p50Ms: eventLoopNsToMs(eventLoopDelay.percentile(50)),
      p95Ms: eventLoopNsToMs(eventLoopDelay.percentile(95)),
      p99Ms: eventLoopNsToMs(eventLoopDelay.percentile(99)),
    },
    utilization: {
      activeMs: roundMs(utilization.active),
      idleMs: roundMs(utilization.idle),
      utilization: roundMs(utilization.utilization),
    },
  };
}

function appendObservabilityLog(event: string, payload: Record<string, unknown>): void {
  try {
    const { logDir } = readConductorConf();
    mkdirSync(logDir, { recursive: true });
    appendFileSync(
      path.join(logDir, 'observability.jsonl'),
      `${JSON.stringify({ ts: new Date().toISOString(), event, ...payload })}\n`,
    );
  } catch {
    /* observability logging must never break the control plane */
  }
}


function appendTransitionLog(payload: Record<string, unknown>): void {
  try {
    const { logDir } = readConductorConf();
    mkdirSync(logDir, { recursive: true });
    appendFileSync(
      path.join(logDir, 'transitions.jsonl'),
      `${JSON.stringify({ ts: new Date().toISOString(), ...payload })}\n`,
    );
  } catch {
    /* observability logging must never break the control plane */
  }
}

function timeSync<T>(name: TimedMetricName, fn: () => T): T {
  const started = performance.now();
  try {
    return fn();
  } finally {
    recordTiming(name, performance.now() - started);
  }
}

function capturePaneTail(sessionName: string, windowName: string, n: number, owner = 'unknown'): string {
  const started = performance.now();
  const text = timeSync('tmuxCaptureTail', () => capturePaneTailUninstrumented(sessionName, windowName, n));
  const durationMs = performance.now() - started;
  recordTmuxOperation('capture-pane-tail', owner, durationMs, {
    timedOut: text === '' && durationMs >= TMUX_SYNC_TIMEOUT_MS - 25,
  });
  return text;
}


/**
 * Shared dispatch sequence: pre-dispatch checkpoint, mark the agent's pane
 * busy, append a dispatch.jsonl record, optionally send /clear, then send
 * the command text to the agent's pane. Used by any code path that hands a
 * task straight to an idle agent (currently: POST /api/tasks fast-path).
 */
async function dispatchTaskToAgent(
  db: Database.Database,
  conf: ConductorConf,
  agent: Agent,
  cmdText: string,
  detection: string,
  opts?: { clearFirst?: boolean },
): Promise<void> {
  const win = agentWindowName(agent);

  // Pre-dispatch checkpoint (ROADMAP-007): snapshot the agent's worktree so
  // the task about to run can be rolled back. Best-effort — a clean worktree
  // (nothing to stash) or any git error must never block the dispatch.
  if (agent.worktreePath) {
    const ts = Date.now();
    const stashRef = stashCheckpoint(agent.worktreePath, ts);
    if (stashRef) {
      insertCheckpoint(db, agent.id, ts, stashRef);
    } else {
      console.warn(`[conductor] dispatchTaskToAgent: no checkpoint recorded for agent ${String(agent.id)} (clean worktree or git error)`);
    }
  }

  writeFileSync(
    `${conf.stateDir}/${win}.state`,
    'busy\n',
    'utf8',
  );

  const paneTail = capturePaneTail(conf.sessionName, win, 5, 'task-dispatch');
  const dispatchRecord = {
    ts: new Date().toISOString(),
    agent: win,
    command: cmdText,
    state: 'idle',
    state_age_s: 0,
    detection,
    queue: 'none',
    queue_remaining: 0,
    pane_tail: paneTail,
  };
  appendFileSync(`${conf.logDir}/dispatch.jsonl`, JSON.stringify(dispatchRecord) + '\n', 'utf8');

  await sendDispatchToPane(conf.sessionName, win, cmdText, { clearFirst: opts?.clearFirst === true });
}

function capturePaneTailRaw(sessionName: string, windowName: string, n: number, owner = 'unknown'): string {
  const started = performance.now();
  const text = timeSync('tmuxCaptureTailRaw', () => capturePaneTailRawUninstrumented(sessionName, windowName, n));
  const durationMs = performance.now() - started;
  recordTmuxOperation('capture-pane-raw', owner, durationMs, {
    timedOut: text === '' && durationMs >= TMUX_SYNC_TIMEOUT_MS - 25,
  });
  return text;
}

function broadcastSSE(eventName: string, data: unknown): void {
  timeSync('sseBroadcasts', () => {
    liveUpdateMetrics.sseBroadcastsByEvent[eventName] = (liveUpdateMetrics.sseBroadcastsByEvent[eventName] ?? 0) + 1;
    const msg = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const reply of sseClients) {
      try { reply.raw.write(msg); } catch { sseClients.delete(reply); }
    }
    liveUpdateMetrics.activeSseConnections = sseClients.size;
  });
}

function sendSSE(reply: FastifyReply, eventName: string, data: unknown): void {
  try { reply.raw.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* ignore */ }
}

interface DirectInputPayload {
  keys?: unknown;
  text?: unknown;
  enter?: unknown;
}

async function sendDirectInput(agentId: number, payload: DirectInputPayload): Promise<{ keys: number; textChars: number; enter: boolean }> {
  const { keys, text, enter } = payload;
  const conf = readConductorConf();
  const { sessionName } = conf;

  const entry = getAgentById(db, agentId);
  if (!entry) throw new Error(`agent ${String(agentId)} not found`);
  if (!isTmuxWindowPresent(sessionName, agentWindowName(entry))) throw new Error('agent window not present');

  const hasKeys = keys !== undefined;
  const hasText = text !== undefined;
  if (!hasKeys && !hasText && enter !== true) throw new Error('keys or text is required');
  if (hasKeys && hasText) throw new Error('provide keys or text, not both');

  let keyList: string[] | undefined;
  if (hasKeys) {
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > MAX_KEYS) {
      throw new Error(`keys must be an array of 1-${String(MAX_KEYS)} key names`);
    }
    const arr = keys as unknown[];
    const bad = arr.find((k) => typeof k !== 'string' || !TMUX_KEY_RE.test(k));
    if (bad !== undefined) throw new Error(`invalid key name: ${JSON.stringify(bad)}`);
    keyList = arr as string[];
  }

  let textStr: string | undefined;
  if (hasText) {
    if (typeof text !== 'string') throw new Error('text must be a string');
    const normalized = text.replace(/\r\n?/g, '\n');
    if (normalized.length < 1 || normalized.length > MAX_TEXT) {
      throw new Error(`text must be a string of 1-${String(MAX_TEXT)} characters`);
    }
    if (/[\x00-\x08\x0b-\x1f\x7f]/.test(normalized)) {
      throw new Error('text may not contain control characters other than newline and tab');
    }
    textStr = normalized;
  }
  if (enter !== undefined && typeof enter !== 'boolean') throw new Error('enter must be a boolean');

  const target = windowTarget(sessionName, agentWindowName(entry));
  const multiline = textStr !== undefined && textStr.includes('\n');
  const sends: string[][] = [];
  if (keyList) sends.push(['send-keys', '-t', target, ...keyList]);
  if (textStr !== undefined) {
    if (multiline) {
      const buf = `conductor-keys-${String(agentId)}`;
      sends.push(['set-buffer', '-b', buf, '--', textStr]);
      sends.push(['paste-buffer', '-t', target, '-b', buf, '-p', '-d']);
    } else {
      sends.push(['send-keys', '-t', target, '-l', '--', textStr]);
    }
  }
  if (enter === true) sends.push(['send-keys', '-t', target, 'Enter']);

  for (const args of sends) {
    if (multiline && args[args.length - 1] === 'Enter') await sleep(300);
    const started = performance.now();
    const r = spawnSync('tmux', args, { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
    const durationMs = performance.now() - started;
    const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
    recordTmuxOperation(args[0] ?? 'tmux', 'direct-input', durationMs, {
      error: r.status !== 0,
      timedOut,
    });
    if (r.status !== 0) throw new Error(`tmux send failed: ${r.stderr}`);
  }

  return { keys: keyList?.length ?? 0, textChars: textStr?.length ?? 0, enter: enter === true };
}

// BUG-0006: the frontend's initial-load race lets the SSE `agent-update` connect-resend
// permanently win over the REST GET /api/status fetch, so any field present here but
// missing from one of the two SSE payload builders below (search "agent-update") silently
// never reaches the dashboard. Keep every field in this per-agent shape mirrored in BOTH
// SSE builders — there is no other parity check (sseLastPromptParity.test.ts pins lastPrompt).
// The partial one-shot 'agent-update' payloads (spawn / clone / project-create / rename,
// all `...ctx` spreads) intentionally omit lastPrompt: a brand-new agent has none, and an
// omitted field means "unchanged" to the frontend's field-by-field merge.
interface Snapshot {
  sessionAlive: boolean;
  sessionExists: boolean;
  agents: Array<{ id: number; name: string; projectId: number | null; projectName: string | null; state: AgentRunState; status: AgentStatusContract; mode: AgentMode; agentType: AgentType; windowPresent: boolean; queuedTasks: number; launchCmd: string; workdir: string; worktreePath: string | null; branch: string | null; inGitRepo: boolean; role: string; description: string | null; activeTask: string | null; lastPrompt: LastPrompt | null; label: string | null; usage: AgentUsageTotals | null } & AgentContext>;
  bgProcesses: BgStatus[];
}

type AgentDisplayStatus = AgentRunState | 'empty' | 'idle-waiting';

interface AgentStatusEvidence {
  windowName: string;
  windowPresent: boolean;
  paneCurrentCommand: string | null;
  stateFile: {
    path: string;
    present: boolean;
    value: string | null;
    ageSeconds: number | null;
  };
  activeTaskRetained: boolean;
}

interface AgentStatusContract {
  state: AgentRunState;
  display: AgentDisplayStatus;
  reason: string;
  needsAttention: boolean;
  activeTask: string | null;
  evidence: AgentStatusEvidence;
}

function buildAgentStatusContract(input: {
  conf: ReturnType<typeof readConductorConf>;
  windowName: string;
  state: AgentRunState;
  agentType: AgentType;
  queuedTasks: number;
  windowPresent: boolean;
  paneCurrentCommand: string | null;
  activeTask: string | null;
}): AgentStatusContract {
  const statePath = path.join(input.conf.stateDir, `${input.windowName}.state`);
  let fileValue: string | null = null;
  let fileAgeSeconds: number | null = null;
  let filePresent = false;
  try {
    const stat = statSync(statePath);
    fileAgeSeconds = Math.max(0, (Date.now() - stat.mtimeMs) / 1000);
    fileValue = readFileSync(statePath, 'utf8').replace(/\r/g, '').split('\n')[0]?.trim() || null;
    filePresent = true;
  } catch {
    // Missing state files are expected for custom agents and pre-hook sessions.
  }

  const display: AgentDisplayStatus =
    input.state === 'idle' && input.queuedTasks === 0 ? 'empty'
      : input.state === 'idle' && input.agentType === 'codex' ? 'idle-waiting'
        : input.state;

  const reason =
    input.state === 'no-window' ? 'tmux window is absent'
      : input.state === 'exited' ? 'pane command fell back to a shell'
        : filePresent ? 'state file plus pane evidence'
          : 'pane regex fallback';

  return {
    state: input.state,
    display,
    reason,
    needsAttention: input.state === 'awaiting' || input.state === 'stalled',
    activeTask: input.activeTask,
    evidence: {
      windowName: input.windowName,
      windowPresent: input.windowPresent,
      paneCurrentCommand: input.paneCurrentCommand,
      stateFile: {
        path: statePath,
        present: filePresent,
        value: fileValue,
        ageSeconds: fileAgeSeconds,
      },
      activeTaskRetained: input.activeTask !== null && (input.state === 'busy' || input.state === 'awaiting' || input.state === 'stalled'),
    },
  };
}

let prevSnapshot: Snapshot | null = null;

// ── API routes (/api prefix) ─────────────────────────────────────────────────

await fastify.register((api) => {

  api.get('/healthz', async (_req, reply) => {
    reply.send({ ok: true });
  });

  api.get('/perf/live-updates', async (_req, reply) => {
    const conf = readConductorConf();
    reply.send({
      timestamp: new Date().toISOString(),
      settings: {
        statusPollMs: conf.statusPollMs,
        terminalPollMs: conf.terminalPollMs,
        focusedTerminalPollMs: conf.focusedTerminalPollMs,
        focusedTerminalWsPollMs: conf.focusedTerminalWsPollMs,
        terminalTailLines: conf.terminalTailLines,
        focusedTerminalTailLines: conf.focusedTerminalTailLines,
      },
      liveUpdates: liveUpdateMetrics,
      eventLoop: readEventLoopMetrics(),
    });
  });

  api.get('/skills', async (_req, reply) => {
    reply.send({ user: getUserSkills(), plugin: getPluginSkills() });
  });

  api.get('/status', async (_req, reply) => {
    const conf = readConductorConf();
    const snapshot = prevSnapshot;
    if (snapshot !== null) {
      return reply.send({
        session: conf.sessionName,
        sessionAlive: snapshot.sessionAlive,
        sessionExists: snapshot.sessionExists,
        agents: snapshot.agents,
        bgProcesses: snapshot.bgProcesses,
        timestamp: new Date().toISOString(),
      });
    }

    const agentStatuses = listAgents(db).map((agent) => {
      const agentType = detectAgentType(agent.launchCmd);
      return {
        id: agent.id,
        name: agent.name,
        projectId: agent.projectId,
        projectName: agent.projectName,
        state: 'unknown',
        status: buildAgentStatusContract({
          conf,
          windowName: agentWindowName(agent),
          state: 'unknown',
          agentType,
          queuedTasks: listTasksForAgentId(db, agent.id, agent.projectId).length,
          windowPresent: false,
          paneCurrentCommand: null,
          activeTask: null,
        }),
        mode: 'unknown',
        agentType,
        windowPresent: false,
        queuedTasks: listTasksForAgentId(db, agent.id, agent.projectId).length,
        launchCmd: agent.launchCmd,
        workdir: agent.workdir,
        ...resolveAgentWorktree(agent),
        inGitRepo: isInGitRepoCached(agent.workdir),
        activeTask: null,
        lastPrompt: null,
        label: null,
        ...emptyAgentContext(conf),
      };
    });

    return reply.send({
      session: conf.sessionName,
      sessionAlive: false,
      sessionExists: false,
      agents: agentStatuses,
      bgProcesses: [],
      timestamp: new Date().toISOString(),
    });
  });

  // Recover the conductor session. If the tmux session still exists, recreate
  // the missing monitor window in place (agents untouched). If the session is
  // gone, run conductor.sh to spawn a fresh one (CONDUCTOR_NO_ATTACH so the
  // script exits after spawning instead of attaching).
  api.post('/session/start', async (_req, reply) => {
    if (sessionStartInFlight) {
      return reply.status(409).send({ error: 'session start already in progress' });
    }
    sessionStartInFlight = true;
    try {
      const conf = readConductorConf();
      const { sessionName } = conf;

      if (tmuxSessionExists(sessionName)) {
        if (!healMonitorWindow(sessionName)) {
          return await reply.status(500).send({ error: 'failed to recreate monitor window' });
        }
        return await reply.send({ ok: true, action: 'reconnected', sessionAlive: true, sessionExists: true });
      }

      const conductorScript = path.join(REPO_ROOT, 'scripts', 'conductor.sh');
      const run = spawnSync('bash', [conductorScript], {
        encoding: 'utf8',
        cwd: REPO_ROOT,
        // TASK-0233: scrub conductor-only/leaky vars (e.g. a stale DATABASE_URL)
        // before conductor.sh's `tmux new-session` seeds the tmux server's
        // global environment with them — see spawnEnv.ts.
        env: { ...scrubLeakyEnv(process.env), CONDUCTOR_NO_ATTACH: '1' },
        timeout: 60_000,
      });
      if (run.status !== 0) {
        const stderrTail = (run.stderr || run.stdout || '').trim().split('\n').slice(-5).join('\n');
        return await reply.status(500).send({ error: `conductor.sh failed (exit ${String(run.status)})`, detail: stderrTail });
      }
      return await reply.send({ ok: true, action: 'started', sessionAlive: true, sessionExists: true });
    } finally {
      sessionStartInFlight = false;
    }
  });

  // ── Task Queue CRUD ──────────────────────────────────────────────────────

  api.get<{ Params: { id: string } }>('/queue/:id', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'invalid agent id' });
    const entry = getAgentById(db, id);
    if (!entry) return reply.status(404).send({ error: `agent ${String(id)} not found` });
    const tasks = listTasksForAgentId(db, entry.id, entry.projectId);
    reply.send({ agent: entry.name, agentId: entry.id, tasks });
  });

  // ── Task Queue CRUD (DB-backed /api/tasks) ───────────────────────────────

  api.get<{ Querystring: { projectId?: string } }>('/tasks', async (req, reply) => {
    const { projectId } = req.query;
    if (projectId !== undefined) {
      const id = parseInt(projectId, 10);
      if (isNaN(id)) return reply.status(400).send({ error: 'projectId must be an integer' });
      return reply.send(listTasksByProject(db, id));
    }
    return reply.status(400).send({ error: 'projectId query param is required' });
  });

  // TASK-126: global completed-task history (read-side companion to TASK-125's
  // soft-delete pop) for the dashboard's task history view. Optional query
  // filters scope by agent/project; `limit` caps the result count.
  api.get<{ Querystring: { agentId?: string; projectId?: string; limit?: string } }>('/tasks/history', async (req, reply) => {
    const { agentId, projectId, limit } = req.query;
    const opts: { agentId?: number; projectId?: number; limit?: number } = {};
    if (agentId !== undefined) {
      const id = parseInt(agentId, 10);
      if (isNaN(id)) return reply.status(400).send({ error: 'agentId must be an integer' });
      opts.agentId = id;
    }
    if (projectId !== undefined) {
      const id = parseInt(projectId, 10);
      if (isNaN(id)) return reply.status(400).send({ error: 'projectId must be an integer' });
      opts.projectId = id;
    }
    if (limit !== undefined) {
      const n = parseInt(limit, 10);
      if (isNaN(n) || n <= 0) return reply.status(400).send({ error: 'limit must be a positive integer' });
      opts.limit = n;
    }
    return reply.send(listCompletedTasks(db, opts));
  });

  api.post<{ Body: { command?: unknown; agentId?: unknown; projectId?: unknown; placement?: unknown } }>('/tasks', async (req, reply) => {
    const { command, agentId: agentIdRaw, projectId, placement } = req.body;

    if (typeof command !== 'string' || command.trim() === '') {
      return reply.status(400).send({ error: 'command is required and must be a non-empty string' });
    }
    if (placement !== undefined && placement !== 'tail' && placement !== 'head') {
      return reply.status(400).send({ error: "placement must be 'tail' or 'head'" });
    }
    if (projectId !== undefined && !Number.isInteger(projectId)) {
      return reply.status(400).send({ error: 'projectId must be an integer' });
    }

    let agentId: number | undefined;
    let foundAgent: ReturnType<typeof getAgentById> | undefined;
    if (agentIdRaw !== undefined) {
      if (typeof agentIdRaw !== 'number' || !Number.isInteger(agentIdRaw)) {
        return reply.status(400).send({ error: 'agentId must be an integer' });
      }
      const agentIdValue = agentIdRaw;
      const found = getAgentById(db, agentIdValue);
      if (!found) {
        return reply.status(404).send({ error: `agent ${agentIdValue.toString()} not found` });
      }
      agentId = found.id;
      foundAgent = found;
    }

    // Fast-path: agent is idle and has no pending DB tasks — dispatch immediately.
    // Key all tmux/state operations off the window name (project-scoped agents
    // live in a `${project}-${name}` window and the hooks write that state file).
    if (
      foundAgent !== undefined &&
      detectAgentStatusWithBackgroundJobs(readConductorConf(), agentWindowName(foundAgent), foundAgent.launchCmd, agentPaneCwd(foundAgent)).state === 'idle' &&
      listTasksForAgentId(db, foundAgent.id, foundAgent.projectId).length === 0
    ) {
      const conf = readConductorConf();
      const win = agentWindowName(foundAgent);
      // BUG-0001: the agent's idle/busy state file can read idle while it is
      // still genuinely occupied waiting on a background sub-agent it
      // spawned (Claude Code's Stop hook fires — and writes idle — before
      // that background work resolves). Skip the immediate dispatch in that
      // case; the task still gets queued normally below and will dispatch
      // once the sentinel clears. See host-server/pendingAgents.ts.
      if (!hasPendingBackgroundAgents(conf.stateDir, win, conf.pendingAgentStaleMs)) {
        const cmdText = command.trim();
        try {
          await dispatchTaskToAgent(db, conf, foundAgent, cmdText, 'immediate-enqueue');
        } catch (err: unknown) {
          // The busy state file was already written before the send, so do
          // not fall through to the queue-add path.
          console.error(`[conductor] dispatchTaskToAgent failed for agent ${String(foundAgent.id)}:`, err);
          return reply.status(500).send({ error: 'dispatch failed' });
        }
        broadcastSSE('snapshot', buildSnapshot());
        return reply.status(200).send({ ok: true, dispatched: true });
      }
    }

    const task = addTask(db, {
      command: command.trim(),
      ...(agentId !== undefined ? { agentId } : {}),
      ...(typeof projectId === 'number' ? { projectId } : {}),
      ...(placement !== undefined ? { placement } : {}),
    });
    broadcastSSE('task-added', task);
    return reply.status(201).send({ ...task, dispatched: false });
  });

  api.delete<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return reply.status(404).send({ error: 'invalid task id' });
    }
    deleteTask(db, id);
    broadcastSSE('task-removed', { id });
    return reply.status(204).send();
  });

  api.put<{ Body: { ids?: unknown } }>('/tasks/reorder', async (req, reply) => {
    const { ids } = req.body;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      !ids.every((i) => Number.isInteger(i))
    ) {
      return reply.status(400).send({ error: 'ids must be a non-empty array of integers' });
    }
    reorderTasks(db, ids as number[]);
    broadcastSSE('queue-reordered', { ids });
    return reply.send({ ok: true });
  });

  api.post<{ Params: { id: string } }>('/tasks/:id/jump-head', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return reply.status(404).send({ error: 'invalid task id' });
    }
    jumpTaskToHead(db, id);
    broadcastSSE('task-moved', { id });
    return reply.send({ ok: true, id });
  });

  api.post<{ Params: { id: string } }>('/tasks/:id/scope-project', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return reply.status(404).send({ error: 'invalid task id' });
    }
    const result = moveTaskToProject(db, id);
    if (!result.ok) {
      if (result.reason === 'not-found') {
        return reply.status(404).send({ error: 'task not found' });
      }
      const messages: Record<Exclude<typeof result.reason, 'not-found'>, string> = {
        'not-queued': 'task is not queued',
        'not-agent-scoped': 'task is not agent-scoped',
        'agent-has-no-project': 'agent has no project',
      };
      return reply.status(409).send({ error: messages[result.reason] });
    }
    broadcastSSE('task-moved', { id });
    return reply.send({ ok: true, task: result.task });
  });

  // ── Agent Management ──────────────────────────────────────────────────────

  api.post<{ Body: { name?: string; workdir?: string; launchCmd?: string; role?: string; description?: string; useWorktree?: boolean } }>('/agents', async (req, reply) => {
    const {
      name,
      workdir,
      launchCmd = 'claude --dangerously-skip-permissions --append-system-prompt-file ~/.claude/rules/agent-teams-preference.md',
      role,
      description,
      useWorktree,
    } = req.body;

    if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return reply.status(400).send({
        error: 'name is required and must match ^[a-zA-Z0-9_-]+$',
      });
    }

    if (!workdir || typeof workdir !== 'string' || !workdir.startsWith('/')) {
      return reply.status(400).send({
        error: 'workdir is required and must be an absolute path (starts with /)',
      });
    }

    // TASK-115: reuse rolePresets.ts's ROLE_VALUES (the same constant
    // POST /projects/:id/agents now validates against) instead of this
    // route keeping its own hand-typed copy of the enum.
    if (role !== undefined && (typeof role !== 'string' || !ROLE_VALUES.includes(role))) {
      return reply.status(400).send({
        error: `role must be one of: ${ROLE_VALUES.join(', ')}`,
      });
    }

    const conf = readConductorConf();
    const { sessionName } = conf;

    const sessionCheck = spawnSync('tmux', ['has-session', '-t', sessionName], {
      encoding: 'utf8',
      timeout: TMUX_SYNC_TIMEOUT_MS,
    });
    if (sessionCheck.status !== 0) {
      return reply.status(409).send({ error: 'session not running', sessionAlive: false });
    }

    if (isTmuxWindowPresent(sessionName, name)) {
      return reply.status(409).send({ error: 'window already exists' });
    }

    const newAgent = createAgent(db, { name, workdir, launchCmd, ...(role !== undefined ? { role } : {}), ...(typeof description === 'string' && description.trim() !== '' ? { description: description.trim() } : {}), useWorktree: useWorktree === true });
    const winName = agentWindowName(newAgent);
    spawnAgentWindow(newAgent, conf);

    // Immediately notify SSE clients — don't wait for the next poll tick.
    {
      const windowPresent = isTmuxWindowPresent(conf.sessionName, winName);
      const tail15 = windowPresent ? capturePaneTail(conf.sessionName, winName, 15, 'agent-window') : '';
      const { state } = detectAgentStatusWithBackgroundJobs(conf, winName, launchCmd, agentPaneCwd(newAgent), tail15 || undefined);
      const isBusy = state === 'busy' || state === 'awaiting' || state === 'stalled';
      const agentType = detectAgentType(launchCmd);
      const ctx = getContextForAgent(conf, agentType, winName, agentPaneCwd(newAgent), isBusy, tail15 || undefined);
      broadcastSSE('agent-update', buildNewAgentUpdate(newAgent, {
        state, mode: windowPresent ? detectAgentMode(conf, winName, launchCmd, tail15) : 'unknown',
        agentType, windowPresent, inGitRepo: isInGitRepoCached(newAgent.workdir), context: ctx,
      }));
    }

    return reply.status(201).send({ ok: true, agent: newAgent });
  });

  // Recreate the tmux window for an agent that already exists in the DB but
  // whose window has died. Unlike POST /agents this does not write to the DB.
  api.post<{ Params: { id: string } }>('/agents/:id/window', async (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const conf = readConductorConf();
    const { sessionName } = conf;

    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    const name = entry.name;

    const sessionCheck = spawnSync('tmux', ['has-session', '-t', sessionName], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
    if (sessionCheck.status !== 0) {
      return reply.status(409).send({ error: 'session not running', sessionAlive: false });
    }

    const winName = agentWindowName(entry);
    const { count, live } = windowState(sessionName, winName, entry.launchCmd);

    if (count > 1) {
      return reply.status(409).send({
        error: `ambiguous: ${String(count)} windows named '${winName}' — remove the duplicate agent`,
      });
    }
    if (count === 1 && live) {
      return reply.status(409).send({ error: 'agent already running' });
    }

    // count === 0 (cold) or count === 1 && !live (dead husk — exited agent left a
    // bare shell). Reap the husk so the name is free, then spawn fresh.
    let action: 'spawned' | 'respawned' = 'spawned';
    try {
      if (count === 1) {
        spawnSync('tmux', ['kill-window', '-t', windowTarget(sessionName, winName)], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
        action = 'respawned';
      }
      spawnAgentWindow(entry, conf);
    } catch {
      return reply.status(500).send({ error: 'failed to spawn agent window' });
    }

    // Immediately notify SSE clients — don't wait for the next poll tick.
    {
      const windowPresent = isTmuxWindowPresent(conf.sessionName, winName);
      const tail15 = windowPresent ? capturePaneTail(conf.sessionName, winName, 15, 'mode-switch') : '';
      const { state } = detectAgentStatusWithBackgroundJobs(conf, winName, entry.launchCmd, agentPaneCwd(entry), tail15 || undefined);
      const isBusy = state === 'busy' || state === 'awaiting' || state === 'stalled';
      const agentType = detectAgentType(entry.launchCmd);
      const ctx = getContextForAgent(conf, agentType, winName, agentPaneCwd(entry), isBusy, tail15 || undefined);
      broadcastSSE('agent-update', {
        id: entry.id, name, projectId: entry.projectId, projectName: entry.projectName,
        state, mode: windowPresent ? detectAgentMode(conf, winName, entry.launchCmd, tail15) : 'unknown',
        agentType,
        windowPresent, queuedTasks: listTasksForAgentId(db, entry.id, entry.projectId).length,
        launchCmd: entry.launchCmd, workdir: entry.workdir,
        activeTask: getActiveTask(conf, winName, state), ...ctx,
      });
    }

    return reply.status(201).send({
      ok: true,
      action,
      agent: { name, workdir: entry.workdir, launchCmd: entry.launchCmd },
    });
  });

  // ROADMAP-007: opt-in worktree creation for an agent that was created
  // without one (the AgentDetailModal "Create worktree" action) — the
  // retroactive counterpart to POST /agents' `useWorktree` flag.
  api.post<{ Params: { id: string } }>('/agents/:id/worktree', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    try {
      // No SSE broadcast here: every other 'agent-update' payload is a
      // full status-shaped record (state/mode/agentType/...) that
      // AgentList's own SSE handler reads directly — a partial payload with
      // just worktreePath/branch would be misread as a status change. The
      // route response updates the modal directly; for everyone else the
      // periodic pollAndDiff emits a full-shaped 'agent-update' within one
      // status tick, because worktreePath/branch are part of
      // agentSnapshotChanged (agentDiff.ts).
      const agent = addWorktreeToAgent(db, agentId);
      return reply.status(201).send({ ok: true, agent });
    } catch (err) {
      // addWorktreeToAgent throws a typed WorktreeError; its `code` picks the
      // HTTP status and its message is the real, user-facing reason.
      const status = err instanceof WorktreeError ? worktreeErrorStatus(err.code) : 500;
      const message = err instanceof Error ? err.message : 'failed to create worktree';
      return reply.status(status).send({ error: message });
    }
  });

  // Switch the agent's Claude Code permission mode by pressing shift+tab
  // (tmux key BTab) until the requested mode's footer appears in capture-pane
  // output. 409 if a full cycle returns to the starting mode without ever
  // showing the target (e.g. acceptEdits is unreachable when the agent was
  // launched with --dangerously-skip-permissions).
  api.post<{ Params: { id: string }; Body: { mode?: string } }>('/agents/:id/mode', async (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const target = req.body.mode;
    if (typeof target !== 'string' || !(VALID_MODES as readonly string[]).includes(target)) {
      return reply.status(400).send({ error: `mode must be one of ${VALID_MODES.join('|')}` });
    }

    const conf = readConductorConf();
    const { sessionName } = conf;

    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    const wn = agentWindowName(entry);
    if (!isTmuxWindowPresent(sessionName, wn)) {
      return reply.status(409).send({ error: 'agent window not present' });
    }
    if (detectAgentType(entry.launchCmd) !== 'claude') {
      return reply.status(409).send({ error: 'mode switching is only supported for Claude Code agents' });
    }
    if (modeSwitchInFlight.has(wn)) {
      return reply.status(409).send({ error: 'mode switch already in progress for this agent' });
    }

    modeSwitchInFlight.add(wn);
    try {
      const origin = detectAgentMode(conf, wn, entry.launchCmd);
      if (origin === 'unknown') {
        return await reply.status(409).send({
          error: 'cannot detect current permission mode (agent may not be Claude Code, or is showing a dialog)',
        });
      }
      if (origin === target) {
        return await reply.send({ ok: true, mode: target, presses: 0 });
      }

      const MAX_PRESSES = 6;
      const SETTLE_MS = 250;
      const seen: AgentMode[] = [origin];

      for (let press = 1; press <= MAX_PRESSES; press++) {
        spawnSync('tmux', ['send-keys', '-t', windowTarget(sessionName, wn), 'BTab'], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
        await sleep(SETTLE_MS);

        // The footer can be mid-redraw right after a press — re-detect briefly.
        let current = detectAgentMode(conf, wn, entry.launchCmd);
        for (let retry = 0; retry < 2 && current === 'unknown'; retry++) {
          await sleep(SETTLE_MS);
          current = detectAgentMode(conf, wn, entry.launchCmd);
        }

        seen.push(current);
        if (current === target) {
          return await reply.send({ ok: true, mode: target, presses: press });
        }
        if (current === origin) {
          return await reply.status(409).send({
            error: `mode '${target}' is not reachable: cycled back to '${origin}' without seeing it`,
            origin,
            modesSeen: seen,
          });
        }
      }
      return await reply.status(500).send({ error: `mode did not stabilize after ${String(MAX_PRESSES)} presses`, modesSeen: seen });
    } finally {
      modeSwitchInFlight.delete(wn);
    }
  });

  // Close an agent's tmux window without removing the agent — the inverse of
  // POST /agents/:agent/window. conductor.conf and queued tasks are untouched;
  // the state file is removed so a later window recreate starts clean. The
  // agent shows as 'no-window' until recreated.
  api.delete<{ Params: { id: string } }>('/agents/:id/window', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const conf = readConductorConf();
    const { sessionName, stateDir } = conf;

    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    const name = entry.name;
    const winName = agentWindowName(entry);
    if (!isTmuxWindowPresent(sessionName, winName)) {
      return reply.status(409).send({ error: 'agent window not present' });
    }

    const r = spawnSync('tmux', ['kill-window', '-t', windowTarget(sessionName, winName)], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
    if (r.status !== 0) {
      return reply.status(500).send({ error: 'tmux kill-window failed', stderr: r.stderr });
    }
    try { unlinkSync(path.join(stateDir, `${winName}.state`)); } catch { /* no state file — fine */ }

    return reply.send({ ok: true, closed: name });
  });

  // Send keystrokes or literal text directly to an agent's tmux pane,
  // bypassing the task queue — used by the dashboard's Interact mode and
  // direct-send field to answer dialogs (AskUserQuestion, plan approval) or
  // unstick a stalled agent. keys = whitelisted tmux key names; text = literal
  // text; enter appends a separate Enter press. Same trust model as /mode and /queue:
  // localhost bind, no auth.
  api.post<{ Params: { id: string }; Body: { keys?: unknown; text?: unknown; enter?: unknown } }>('/agents/:id/keys', async (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    let sent: { keys: number; textChars: number; enter: boolean };
    try {
      sent = await sendDirectInput(agentId, req.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'tmux send failed';
      const status = message.includes('not found') ? 404 : message.includes('window not present') || message.includes('tmux send failed') ? 409 : 400;
      return reply.status(status).send({ error: message });
    }

    return reply.send({
      ok: true,
      sent,
    });
  });

  // Save a dropped/pasted dashboard image to disk and "type" its path into the
  // agent's pane — mirrors dropping a file onto a real terminal, which inserts
  // the file's path as text. No Enter is sent; the user finishes the prompt.
  api.post<{ Params: { id: string }; Querystring: { filename?: string; type?: string; paneInsert?: string } }>(
    '/agents/:id/upload',
    { bodyLimit: UPLOAD_MAX_BYTES },
    async (req, reply) => {
      const agentId = parseInt(req.params.id, 10);
      if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
      const { filename, type, paneInsert } = req.query;
      // Default true: a dropped image gets typed into the pane (terminal drop).
      // paneInsert=false just saves the file and returns its path — used by the
      // task textarea, which inserts the path itself rather than into the pane.
      const insertIntoPane = paneInsert !== 'false';

      const conf = readConductorConf();
      const { sessionName } = conf;

      const entry = getAgentById(db, agentId);
      if (!entry) {
        return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
      }
      if (insertIntoPane && !isTmuxWindowPresent(sessionName, agentWindowName(entry))) {
        return reply.status(409).send({ error: 'agent window not present' });
      }

      const ext = IMAGE_EXT_BY_MIME[type ?? ''];
      if (ext === undefined) {
        return reply.status(400).send({ error: `type must be one of: ${Object.keys(IMAGE_EXT_BY_MIME).join(', ')}` });
      }
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return reply.status(400).send({ error: 'request body must be the raw image bytes (application/octet-stream)' });
      }

      // No spaces or shell metacharacters in the saved name: the path gets
      // typed into an agent CLI, where an unquoted space would split it.
      const base = (filename ?? 'image')
        .replace(/\.[A-Za-z0-9]+$/, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 60) || 'image';
      mkdirSync(UPLOAD_DIR, { recursive: true });
      const filePath = path.join(UPLOAD_DIR, `${String(Date.now())}-${base}.${ext}`);
      writeFileSync(filePath, body);
      pruneOldUploads();

      if (insertIntoPane) {
        const r = spawnSync('tmux', ['send-keys', '-t', windowTarget(sessionName, agentWindowName(entry)), '-l', '--', `${filePath} `], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
        if (r.status !== 0) {
          return reply.status(409).send({ error: 'tmux send-keys failed', stderr: r.stderr });
        }
      }

      return reply.send({ ok: true, path: filePath });
    },
  );

  // Remove an agent entirely: kill its tmux window (if alive), delete its entry
  // from conductor.conf, drop its scoped queue lines, and remove its state file.
  // Global (unscoped) queue lines are left untouched.
  api.delete<{ Params: { id: string } }>('/agents/:id', async (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const conf = readConductorConf();
    const { sessionName, stateDir } = conf;

    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    const name = entry.name;

    const winName = agentWindowName(entry);
    if (isTmuxWindowPresent(sessionName, winName)) {
      execSync(`tmux kill-window -t ${windowTarget(sessionName, winName)}`, { timeout: TMUX_SYNC_TIMEOUT_MS });
    }

    // TASK-063: best-effort worktree teardown. Never let a git failure block
    // the DB delete below — agents without a worktree_path (non-git workdirs)
    // are skipped silently.
    // TASK-0217: extracted into worktreeTeardown.ts so it is testable against
    // real git repos (also prunes the stale registration of a hand-deleted worktree).
    teardownAgentWorktree(entry);

    deleteAgent(db, entry.id);
    resetUsageMemo(winName);
    resetUsageStore(entry.id);

    try { unlinkSync(path.join(stateDir, `${winName}.state`)); } catch { /* no state file — fine */ }
    // TASK-0222: drop the hook sidecar too, so a re-created same-named agent doesn't inherit last_prompt.
    removeLastPromptSidecar(stateDir, winName);

    focusedAgents.delete(entry.id);
    prevTailMap.delete(entry.id);
    prevTailMapFocus.delete(entry.id);
    agentLabelCache.delete(entry.id);
    agentContextCache.delete(entry.id);

    broadcastSSE('agent-removed', { id: entry.id, name });

    return reply.send({ ok: true, removed: name });
  });

  // Update an agent: rename it, change its role, or both. Renaming updates the
  // DB, tmux window, and state file; a role change only updates the DB and
  // broadcasts the new role — no tmux/state-file work involved.
  api.patch<{ Params: { id: string }; Body: { name?: string; role?: string; description?: string | null } }>('/agents/:id', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const { name: newName, role: newRole, description: newDescription } = req.body;

    if (newName === undefined && newRole === undefined && newDescription === undefined) {
      return reply.status(400).send({ error: 'at least one of name, role or description is required' });
    }

    if (newDescription !== undefined && newDescription !== null && typeof newDescription !== 'string') {
      return reply.status(400).send({ error: 'description must be a string or null' });
    }

    if (newName !== undefined && (typeof newName !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(newName))) {
      return reply.status(400).send({ error: 'name must match ^[a-zA-Z0-9_-]+$' });
    }

    if (newRole !== undefined && (typeof newRole !== 'string' || !ROLE_VALUES.includes(newRole))) {
      return reply.status(400).send({ error: `role must be one of: ${ROLE_VALUES.join(', ')}` });
    }

    const conf = readConductorConf();
    const { sessionName, stateDir } = conf;

    const agents = listAgents(db);
    const entry = agents.find((a) => a.id === agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    const oldName = entry.name;

    let updated: Agent = entry;
    let renamed = false;

    if (newName !== undefined && newName !== oldName) {
      // Per-project name uniqueness (DB constraint)
      const nameConflict = agents.find((a) => a.name === newName && a.projectId === entry.projectId && a.id !== entry.id);
      if (nameConflict) {
        return reply.status(409).send({ error: `an agent named '${newName}' already exists in this project` });
      }

      // Global tmux window-name uniqueness: two agents from different projects with
      // the same short name produce different window names (projectName-agentName),
      // but two agents where the compound names happen to collide must be rejected.
      const oldWindowName = agentWindowName(entry);
      const newWindowName = entry.projectName ? `${entry.projectName}-${newName}` : newName;
      const windowConflict = agents.find((a) => agentWindowName(a) === newWindowName && a.id !== entry.id);
      if (windowConflict) {
        return reply.status(409).send({ error: `window name '${newWindowName}' is already in use by another agent` });
      }

      updated = updateAgentName(db, entry.id, newName);

      if (isTmuxWindowPresent(sessionName, oldWindowName)) {
        spawnSync('tmux', ['rename-window', '-t', windowTarget(sessionName, oldWindowName), newWindowName], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
      }

      try { renameSync(path.join(stateDir, `${oldWindowName}.state`), path.join(stateDir, `${newWindowName}.state`)); } catch { /* no state file — fine */ }
      resetUsageMemo(oldWindowName); // usage memo is keyed by window name — re-bootstrap under the new one

      // focusedAgents / prevTailMap* are keyed by the stable agent id, so a rename
      // needs no juggling — the streams keep flowing under the same id.

      renamed = true;
    }

    if (newRole !== undefined) {
      updated = updateAgentRole(db, entry.id, newRole);
    }

    if (newDescription !== undefined) {
      const trimmed = newDescription === null ? '' : newDescription.trim();
      updated = updateAgentDescription(db, entry.id, trimmed === '' ? null : trimmed);
    }

    if (renamed) {
      broadcastSSE('agent-renamed', { id: updated.id, oldName, newName: updated.name });
    }

    if (newRole !== undefined || newDescription !== undefined) {
      // Immediately notify SSE clients of the role change — reuses the same
      // context-gathering shape as the clone/respawn routes' 'agent-update' broadcasts.
      const winName = agentWindowName(updated);
      const windowPresent = isTmuxWindowPresent(sessionName, winName);
      const tail15 = windowPresent ? capturePaneTail(sessionName, winName, 15, 'agent-window') : '';
      const { state } = detectAgentStatusWithBackgroundJobs(conf, winName, updated.launchCmd, agentPaneCwd(updated), tail15 || undefined);
      const isBusy = state === 'busy' || state === 'awaiting' || state === 'stalled';
      const agentType = detectAgentType(updated.launchCmd);
      const ctx = getContextForAgent(conf, agentType, winName, agentPaneCwd(updated), isBusy, tail15 || undefined);
      broadcastSSE('agent-update', {
        id: updated.id, name: updated.name, projectId: updated.projectId, projectName: updated.projectName,
        state, mode: windowPresent ? detectAgentMode(conf, winName, updated.launchCmd, tail15) : 'unknown',
        agentType,
        windowPresent, queuedTasks: listTasksForAgentId(db, updated.id, updated.projectId).length,
        launchCmd: updated.launchCmd, workdir: updated.workdir,
        activeTask: getActiveTask(conf, winName, state), role: updated.role, description: updated.description, ...ctx,
      });
    }

    return reply.send({ ok: true, agent: updated });
  });

  // Clone an existing agent: same workdir/launchCmd/project/role, a derived
  // unique name (deriveCloneName), and a freshly spawned tmux window — the
  // dashboard's "Clone" action. Mirrors POST /agents' create-then-spawn flow,
  // pre-filled from the source agent instead of the request body.
  //
  // Optional body `{ forceWorktree: true }` (TASK-0213) always gives the clone
  // its own isolated worktree + branch (`<repo>-worktrees/<cloneId>`,
  // `conductor/<cloneId>`), whether or not the source has one. That worktree is
  // a FRESH branch off the repo's detected base branch — not a copy of the
  // source's branch or uncommitted work. Without the flag the clone gets a
  // worktree only when the source has one. A forced clone that cannot get its
  // worktree fails loudly (no row is left behind): 400 when the workdir is not
  // a git repo, 500 with the git reason otherwise. The clone's window starts in
  // the worktree (see `agentPaneCwd`).
  api.post<{ Params: { id: string }; Body?: { forceWorktree?: unknown } | null }>('/agents/:id/clone', async (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });

    const source = getAgentById(db, agentId);
    if (!source) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }

    const conf = readConductorConf();
    const forceWorktree = req.body?.forceWorktree === true;

    let newAgent: Agent;
    try {
      newAgent = cloneAgentRecord(db, source, { forceWorktree });
    } catch (err) {
      // WorktreeError's `code` picks the status and its message is the real
      // reason; anything else (e.g. duplicate window name) keeps bubbling to
      // Fastify's default handler exactly as before.
      if (err instanceof WorktreeError) {
        return reply.status(worktreeErrorStatus(err.code)).send({ error: err.message });
      }
      throw err;
    }
    const winName = agentWindowName(newAgent);
    spawnAgentWindow(newAgent, conf);

    // Immediately notify SSE clients — don't wait for the next poll tick.
    {
      const windowPresent = isTmuxWindowPresent(conf.sessionName, winName);
      const tail15 = windowPresent ? capturePaneTail(conf.sessionName, winName, 15, 'agent-window') : '';
      const { state } = detectAgentStatusWithBackgroundJobs(conf, winName, newAgent.launchCmd, agentPaneCwd(newAgent), tail15 || undefined);
      const isBusy = state === 'busy' || state === 'awaiting' || state === 'stalled';
      const agentType = detectAgentType(newAgent.launchCmd);
      const ctx = getContextForAgent(conf, agentType, winName, agentPaneCwd(newAgent), isBusy, tail15 || undefined);
      broadcastSSE('agent-update', buildNewAgentUpdate(newAgent, {
        state, mode: windowPresent ? detectAgentMode(conf, winName, newAgent.launchCmd, tail15) : 'unknown',
        agentType, windowPresent, inGitRepo: isInGitRepoCached(newAgent.workdir), context: ctx,
      }));
    }

    return reply.status(201).send({ ok: true, agent: newAgent });
  });

  // Read-only tail of an agent's tmux pane output (including scrollback), so
  // the dashboard can show what the agent is printing.
  api.get<{ Params: { id: string }; Querystring: { lines?: string } }>('/agents/:id/tail', (req, reply) => {
    return timeSync('tailRequests', () => {
      const agentId = parseInt(req.params.id, 10);
      if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
      const conf = readConductorConf();
      const entry = getAgentById(db, agentId);
      if (!entry) {
        return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
      }
      const name = entry.name;

      const parsed = parseInt(req.query.lines ?? '', 10);
      const lines = Number.isNaN(parsed) ? conf.terminalTailLines : Math.min(1000, Math.max(1, parsed));

      const winName = agentWindowName(entry);
      if (!isTmuxWindowPresent(conf.sessionName, winName)) {
        return reply.send({ agent: name, agentId, lines, windowPresent: false, text: '' });
      }

      const text = capturePaneTailRaw(conf.sessionName, winName, lines, 'tail-request');
      return reply.send({ agent: name, agentId, lines, windowPresent: true, text });
    });
  });


  // GET /agents/:id/diff — returns the git diff of the agent's workdir against
  // its base branch. BUG-0010: deliberately `git diff <base>` (single ref, no
  // `..HEAD`) rather than `git diff <base>..HEAD` — the two-ref form only ever
  // compares committed history and can never show uncommitted working-tree
  // changes, which is where virtually all of an in-progress agent's live edits
  // (and everything the checkpoint/rollback feature stashes/restores) actually
  // live. `git diff <base>` compares <base>'s tree against the current working
  // tree, so it captures both committed divergence AND uncommitted changes in
  // one diff — exactly what "review changes inline" needs. Base-branch
  // detection is shared via the detectBaseBranch helper in host-server/git.ts.
  api.get<{ Params: { id: string } }>('/agents/:id/diff', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }

    // Worktree-backed agents keep their live changes in worktreePath, not
    // workdir (the original repo root) — diff that directory when present.
    const workdir = entry.worktreePath || entry.workdir;

    // Not a git repo (the "no worktree" case) → { diff: null, base: null }.
    if (!isGitRepo(workdir)) {
      return reply.send({ diff: null, base: null });
    }

    const base = detectBaseBranch(workdir);

    const r = spawnSync('git', ['-C', workdir, 'diff', base], {
      encoding: 'utf8',
      timeout: SHELL_SYNC_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    if (r.status !== 0) {
      return reply.status(500).send({ error: 'git diff failed', stderr: r.stderr });
    }

    const MAX_DIFF_BYTES = 500 * 1024;
    let diff = r.stdout;
    let truncated = false;
    if (diff.length > MAX_DIFF_BYTES) {
      diff = diff.slice(0, MAX_DIFF_BYTES);
      truncated = true;
    }

    return reply.send({ diff, base, truncated });
  });

  // GET /agents/:id/base-branch — TASK-065: returns the agent workdir's base
  // branch via the shared detectBaseBranch helper ({ base: null } if not a git repo).
  api.get<{ Params: { id: string } }>('/agents/:id/base-branch', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }

    if (!isGitRepo(entry.workdir)) {
      return reply.send({ base: null });
    }

    return reply.send({ base: detectBaseBranch(entry.workdir) });
  });
  // Focus registration: modal/detail views POST on open, DELETE on close.
  // The fast tail-poll loop only runs for focused agents, skips unchanged
  // snapshots, and the slow loop skips focused agents so capture load stays
  // bounded while the modal is open.
  api.post<{ Params: { id: string } }>('/agents/:id/focus', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    focusedAgents.add(agentId);
    prevTailMapFocus.delete(agentId); // force immediate push on first fast tick
    return reply.status(204).send();
  });

  api.delete<{ Params: { id: string } }>('/agents/:id/focus', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    focusedAgents.delete(agentId);
    prevTailMapFocus.delete(agentId);
    return reply.status(204).send();
  });

  api.get<{ Params: { id: string } }>('/agents/:id/terminal/ws', { websocket: true }, (socket: WebSocket, req) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) {
      socket.close(1008, 'invalid agent id');
      return;
    }
    const entry = getAgentById(db, agentId);
    if (!entry) {
      socket.close(1008, 'agent not found');
      return;
    }

    addFocusedWebSocketOwner(agentId);
    prevTailMapFocus.delete(agentId);
    let lastText = '';
    let pendingEchoStartedAt: number | null = null;
    liveUpdateMetrics.terminalWebSocket.opened += 1;
    liveUpdateMetrics.terminalWebSocket.activeConnections += 1;
    appendObservabilityLog('terminal_ws_open', { agentId, agent: entry.name });

    const sendSnapshot = () => {
      const snapshotStarted = performance.now();
      const conf = readConductorConf();
      const current = getAgentById(db, agentId);
      if (!current) {
        socket.close(1008, 'agent not found');
        return;
      }
      const winName = agentWindowName(current);
      if (!isTmuxWindowPresent(conf.sessionName, winName)) {
        const lines = conf.focusedTerminalTailLines;
        socket.send(JSON.stringify({ type: 'output', agentId, agent: current.name, lines, windowPresent: false, text: '' }));
        return;
      }
      const lines = conf.focusedTerminalTailLines;
      const text = capturePaneTailRaw(conf.sessionName, winName, lines, 'terminal-ws');
      if (text === lastText) return;
      if (socket.bufferedAmount > FOCUSED_WS_BUFFERED_BYTES_LIMIT) return;
      lastText = text;
      recordTiming('terminalWsSnapshots', performance.now() - snapshotStarted);
      if (pendingEchoStartedAt !== null) {
        const echoMs = performance.now() - pendingEchoStartedAt;
        pendingEchoStartedAt = null;
        recordTiming('terminalWsInputEcho', echoMs);
        liveUpdateMetrics.terminalWebSocket.inputEchoes += 1;
        socket.send(JSON.stringify({ type: 'echo', latencyMs: roundMs(echoMs) }));
      }
      socket.send(JSON.stringify({ type: 'output', agentId, agent: current.name, lines, windowPresent: true, text }));
    };

    sendSnapshot();
    let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
    let socketClosed = false;
    const scheduleSnapshot = () => {
      snapshotTimer = setTimeout(() => {
        snapshotTimer = null;
        if (socketClosed) return;
        sendSnapshot();
        scheduleSnapshot();
      }, readConductorConf().focusedTerminalWsPollMs);
    };
    scheduleSnapshot();

    socket.on('message', (message: Buffer) => {
      void (async () => {
        liveUpdateMetrics.terminalWebSocket.messagesIn += 1;
        let parsed: unknown;
        try {
          parsed = JSON.parse(message.toString());
        } catch {
          liveUpdateMetrics.terminalWebSocket.errors += 1;
          socket.send(JSON.stringify({ type: 'error', error: 'invalid JSON message' }));
          return;
        }
        if (!parsed || typeof parsed !== 'object' || !('payload' in parsed)) {
          liveUpdateMetrics.terminalWebSocket.errors += 1;
          socket.send(JSON.stringify({ type: 'error', error: 'payload is required' }));
          return;
        }
        const inputId = 'inputId' in parsed && typeof parsed.inputId === 'number' ? parsed.inputId : null;
        const sentAt = 'sentAt' in parsed && typeof parsed.sentAt === 'number' ? parsed.sentAt : null;
        try {
          const ackStarted = performance.now();
          const sent = await sendDirectInput(agentId, (parsed as { payload: DirectInputPayload }).payload);
          const ackMs = performance.now() - ackStarted;
          pendingEchoStartedAt = ackStarted;
          recordTiming('terminalWsInputAck', ackMs);
          liveUpdateMetrics.terminalWebSocket.inputAcks += 1;
          socket.send(JSON.stringify({ type: 'ack', inputId, sentAt, acknowledgedAt: Date.now(), sent, latencyMs: roundMs(ackMs) }));
        } catch (err) {
          liveUpdateMetrics.terminalWebSocket.errors += 1;
          socket.send(JSON.stringify({ type: 'error', error: err instanceof Error ? err.message : 'tmux send failed' }));
        }
      })();
    });

    socket.on('close', () => {
      socketClosed = true;
      if (snapshotTimer !== null) clearTimeout(snapshotTimer);
      removeFocusedWebSocketOwner(agentId);
      prevTailMapFocus.delete(agentId);
      liveUpdateMetrics.terminalWebSocket.closed += 1;
      liveUpdateMetrics.terminalWebSocket.activeConnections = Math.max(0, liveUpdateMetrics.terminalWebSocket.activeConnections - 1);
      appendObservabilityLog('terminal_ws_close', { agentId, agent: entry.name });
    });
  });

  api.get<{ Params: { id: string } }>('/agents/:id/skills', async (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    const project = getProjectSkills(entry.workdir);
    const user = getUserSkills();
    return reply.send({ agent: entry.name, workdir: entry.workdir, project, user });
  });

  // Per-session usage breakdown (agent_usage rows) for the dashboard detail modal.
  api.get<{ Params: { id: string } }>('/agents/:id/usage', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    return reply.send({ agent: entry.name, sessions: listAgentUsage(db, agentId) });
  });

  // Persisted terminal-log history (agent_terminal_log rows) — full chronological
  // record for the dashboard's history view, backed by TASK-106's listTerminalLog.
  api.get<{ Params: { id: string } }>('/agents/:id/log', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    return reply.send({ agent: entry.name, log: listTerminalLog(db, agentId) });
  });

  // Checkpoint history (stash refs) for an agent, for the dashboard checkpoints list.
  api.get<{ Params: { id: string } }>('/agents/:id/checkpoints', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    return reply.send({ checkpoints: listCheckpoints(db, agentId) });
  });

  // Record a new checkpoint (stash ref) for an agent.
  api.post<{ Params: { id: string }; Body: { ts?: unknown; stash_ref?: unknown } }>('/agents/:id/checkpoints', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    const { ts, stash_ref: stashRef } = req.body;
    if (typeof ts !== 'number' || !Number.isFinite(ts)) {
      return reply.status(400).send({ error: 'ts is required and must be a number' });
    }
    if (typeof stashRef !== 'string' || stashRef.trim() === '') {
      return reply.status(400).send({ error: 'stash_ref is required and must be a non-empty string' });
    }
    return reply.status(201).send({ checkpoint: insertCheckpoint(db, agentId, ts, stashRef) });
  });

  // Roll an agent's worktree back to a recorded checkpoint by applying its stash.
  api.post<{ Params: { id: string }; Body: { checkpoint_id?: unknown } }>('/agents/:id/rollback', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    if (!entry.worktreePath) {
      return reply.status(400).send({ error: 'agent has no worktree' });
    }
    const { checkpoint_id: checkpointId } = req.body;
    if (typeof checkpointId !== 'number' || !Number.isFinite(checkpointId)) {
      return reply.status(400).send({ error: 'checkpoint_id is required and must be a number' });
    }
    const checkpoint = getCheckpoint(db, checkpointId);
    if (!checkpoint || checkpoint.agentId !== agentId) {
      return reply.status(404).send({ error: 'checkpoint not found' });
    }
    const result = applyStash(entry.worktreePath, checkpoint.stashRef);
    if (!result.ok) {
      return reply.status(500).send({ error: 'git stash apply failed', detail: result.detail });
    }
    return reply.send({ ok: true, stash_ref: checkpoint.stashRef });
  });

  // List all agents from the database.
  api.get('/agents', (_req, reply) => {
    const agents = listAgents(db).map((agent) => ({ ...agent, ...resolveAgentWorktree(agent) }));
    return reply.send(agents);
  });

  // TASK-0202: who is calling? Read-only; exists for the `dev-commands` skill to
  // default `list` to the caller's project. Identity is the self-declared
  // `X-Conductor-Agent` header, so this is NOT an authentication mechanism (same
  // caveat as TASK-0194). Always 200; `kind` is agent|human|unknown|ambiguous. Agent
  // rows already carry `projectName`, so no `listProjects` lookup is needed.
  // Registered as a static path; there is no `GET /agents/:id` to collide with.
  api.get('/agents/whoami', (req, reply) => {
    const caller = parseCallerHeader(req.headers[BG_CALLER_HEADER]);
    const agents = listAgents(db);
    return reply.send(describeCaller(resolveCallerProject(caller, agents), agents));
  });

  // ── Background Process Management ────────────────────────────────────────

  // A stale `linkedAgent` / `linkedAgentId` in the body from an old client is ignored (TASK-0197).
  api.post<{ Body: { name?: string; workdir?: string; launchCmd?: string; projectId?: unknown } }>('/bg-processes', async (req, reply) => {
    const { name, workdir, launchCmd = '', projectId } = req.body;

    if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return reply.status(400).send({ error: 'name is required and must match ^[a-zA-Z0-9_-]+$' });
    }
    if (!workdir || typeof workdir !== 'string' || !workdir.startsWith('/')) {
      return reply.status(400).send({ error: 'workdir is required and must be an absolute path (starts with /)' });
    }
    if (!launchCmd || typeof launchCmd !== 'string') {
      return reply.status(400).send({ error: 'launchCmd is required' });
    }
    // TASK-0195: every bg process belongs to a project — projectId is required
    // and must reference an existing project. Validated before any tmux/session
    // check so a bad request is always a 400 regardless of session state.
    if (projectId === undefined || projectId === null) {
      return reply.status(400).send({ error: 'projectId is required' });
    }
    if (typeof projectId !== 'number' || !Number.isInteger(projectId)) {
      return reply.status(400).send({ error: 'projectId must be an integer' });
    }
    if (!listProjects(db).some((p) => p.id === projectId)) {
      return reply.status(400).send({ error: `project ${String(projectId)} not found` });
    }

    const conf = readConductorConf();
    const { sessionName, logDir } = conf;

    const sessionCheck = spawnSync('tmux', ['has-session', '-t', sessionName], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
    if (sessionCheck.status !== 0) {
      return reply.status(409).send({ error: 'session not running', sessionAlive: false });
    }
    // TASK-0196: names are unique per project, and the derived slug
    // `<project>-<name>` (window / log / state identity) must not collide with
    // another bg slug or an agent window name in the shared tmux namespace.
    const projectName = listProjects(db).find((p) => p.id === projectId)?.name ?? null;
    const slug = bgSlug({ name }, projectName);
    if (listBgProcesses(db, { projectId }).some((b) => b.name === name)) {
      return reply.status(409).send({ error: `bg process '${name}' already defined in this project (slug '${slug}')` });
    }
    if (bgSlugCollides(slug, listBgSlugs(db), listAgents(db).map((a) => agentWindowName(a)))) {
      return reply.status(409).send({ error: `slug '${slug}' collides with an existing bg process or agent window` });
    }
    if (isTmuxWindowPresent(sessionName, slug)) {
      return reply.status(409).send({ error: `window '${slug}' already exists` });
    }

    // Write the definition to SQLite — conductor.sh/spawn.sh load from there
    try {
      createBgProcess(db, { name, workdir, launchCmd, projectId });
    } catch (err) {
      // (project_id, name) unique index — a concurrent create raced past the check above.
      if (isUniqueConstraintError(err)) {
        return reply.status(409).send({ error: `bg process '${name}' already defined in this project (slug '${slug}')` });
      }
      throw err;
    }

    // TASK-0190: argv-array spawn via the shared helper (launchCmd/workdir are
    // single argv elements, pipe-pane attaches before typing).
    const started = startBgWindow(defaultBgRestartDeps(), { slug, workdir, launchCmd }, { sessionName, logDir });
    if (!started.ok) {
      return reply.status(500).send({ error: 'window start failed', step: started.step, status: started.status });
    }

    return reply.status(201).send({ ok: true, bg: { slug, name, workdir, launchCmd, projectId } });
  });

  // Updates the stored bg-process definition (workdir, launchCmd, projectId).
  // name is immutable, and the `:slug` route param (`<project>-<name>`) is the
  // tmux window key, so name is never accepted in the body. Changing projectId
  // changes the slug: 409 while the window is open, or when the new slug collides.
  //
  // IMPORTANT semantics: launchCmd may already be running inside a live tmux
  // window. This route writes SQLite only and never kills/restarts that
  // window — the new values apply only the next time the window is
  // (re)created (POST /bg-processes/:name/window, or a fresh
  // conductor.sh/spawn.sh run). We deliberately do NOT auto-recreate the
  // window here: POST /bg-processes/:name/window is an explicit, separate
  // user action elsewhere in the UI, and silently killing a running process
  // out from under the user on a field edit would violate that convention.
  // The frontend surfaces a note that changes take effect on next restart.
  api.patch<{ Params: { slug: string }; Body: { workdir?: unknown; launchCmd?: unknown; projectId?: unknown } }>('/bg-processes/:slug', async (req, reply) => {
    const { slug } = req.params;
    const entry = getBgBySlug(db, slug);
    if (!entry) {
      return reply.status(404).send({ error: `bg process '${slug}' not found` });
    }

    const { workdir, launchCmd, projectId } = req.body;
    const data: Partial<{ workdir: string; launchCmd: string; projectId: number }> = {};
    if (workdir !== undefined) {
      if (typeof workdir !== 'string' || !workdir.startsWith('/')) {
        return reply.status(400).send({ error: 'workdir must be an absolute path (starts with /)' });
      }
      data.workdir = workdir;
    }
    if (launchCmd !== undefined) {
      if (typeof launchCmd !== 'string' || !launchCmd.trim()) {
        return reply.status(400).send({ error: 'launchCmd must be a non-empty string' });
      }
      data.launchCmd = launchCmd;
    }
    if (projectId !== undefined) {
      // TASK-0195: a bg process must always belong to a project — it can be
      // moved to another existing project but never unassigned.
      if (projectId === null) {
        return reply.status(400).send({ error: 'projectId cannot be null: a bg process must belong to a project' });
      }
      if (typeof projectId !== 'number' || !Number.isInteger(projectId)) {
        return reply.status(400).send({ error: 'projectId must be an integer' });
      }
      if (!listProjects(db).some((p) => p.id === projectId)) {
        return reply.status(400).send({ error: `project ${String(projectId)} not found` });
      }
      data.projectId = projectId;
    }

    // TASK-0196: a project change alters the slug (window / log / state names).
    // Refuse it while the window is live (the running window keeps the old name),
    // and refuse a target slug that collides with another bg slug or agent window.
    if (data.projectId !== undefined && data.projectId !== entry.projectId) {
      const newProjectName = listProjects(db).find((p) => p.id === data.projectId)?.name ?? null;
      const newSlug = bgSlug(entry, newProjectName);
      if (newSlug !== slug) {
        const { sessionName } = readConductorConf();
        if (isTmuxWindowPresent(sessionName, slug)) {
          return reply.status(409).send({ error: `cannot change project while window '${slug}' is open: close the window first (the slug would change to '${newSlug}')` });
        }
        if (bgSlugCollides(newSlug, listBgSlugs(db), listAgents(db).map((a) => agentWindowName(a)))) {
          return reply.status(409).send({ error: `slug '${newSlug}' collides with an existing bg process or agent window` });
        }
      }
    }

    try {
      const updated = updateBgProcess(db, entry.id, data);
      return await reply.send(updated);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return reply.status(409).send({ error: `bg process '${entry.name}' already defined in the target project` });
      }
      throw err;
    }
  });

  api.delete<{ Params: { slug: string } }>('/bg-processes/:slug', async (req, reply) => {
    const { slug } = req.params;
    const conf = readConductorConf();
    const { sessionName, stateDir } = conf;

    const entry = getBgBySlug(db, slug);
    if (!entry) {
      return reply.status(404).send({ error: `bg process '${slug}' not found` });
    }

    if (isTmuxWindowPresent(sessionName, slug)) {
      execSync(`tmux kill-window -t ${windowTarget(sessionName, slug)}`, { timeout: TMUX_SYNC_TIMEOUT_MS });
    }

    // Remove the definition from SQLite.
    deleteBgProcess(db, entry.id);

    try { unlinkSync(path.join(stateDir, `bg-${slug}.state`)); } catch { /* fine */ }

    return reply.send({ ok: true, removed: slug });
  });

  // Recreate the tmux window for a bg process that already exists in the DB but
  // whose window has died. Mirrors POST /agents/:agent/window — does not touch
  // SQLite. Re-attaches pipe-pane logging like conductor.sh does.
  api.post<{ Params: { slug: string } }>('/bg-processes/:slug/window', async (req, reply) => {
    const { slug } = req.params;
    const conf = readConductorConf();
    const { sessionName, logDir } = conf;

    const entry = getBgBySlug(db, slug);
    if (!entry) {
      return reply.status(404).send({ error: `bg process '${slug}' not found` });
    }

    if (!tmuxSessionExists(sessionName)) {
      return reply.status(409).send({ error: 'session not running', sessionAlive: false });
    }
    if (isTmuxWindowPresent(sessionName, slug)) {
      return reply.status(409).send({ error: 'window already exists' });
    }

    // TASK-0190: shared argv-array spawn (no shell re-parsing of launchCmd or
    // workdir; pipe-pane attaches before the command is typed). No restart
    // marker on a plain open.
    const started = startBgWindow(defaultBgRestartDeps(), { slug, workdir: entry.workdir, launchCmd: entry.launchCmd }, { sessionName, logDir });
    if (!started.ok) {
      return reply.status(500).send({ error: 'window start failed', step: started.step, status: started.status });
    }

    return reply.status(201).send({ ok: true, bg: { slug, name: entry.name, workdir: entry.workdir, launchCmd: entry.launchCmd } });
  });

  // TASK-0190: atomic restart. Stops the running process (respawn-window -k, then
  // SIGKILL any survivor of the old process tree), starts a fresh one, keeps (or
  // re-attaches) pipe-pane log capture and appends a `--- restart <ts> ---`
  // marker to bg-<slug>.log. A missing window behaves like "start". The handler
  // is synchronous tmux/ps work (like its siblings) and returns only after the
  // command has been typed. No SSE is emitted here: bg-update is emitted from the
  // status poll-diff (bgStatusChanged also compares lastRestart, TASK-0207), so the
  // dashboard picks the new state up on the next poll.
  api.post<{ Params: { slug: string } }>('/bg-processes/:slug/restart', async (req, reply) => {
    const { slug } = req.params;
    const conf = readConductorConf();
    const { sessionName, logDir } = conf;

    const entry = getBgBySlug(db, slug);
    if (!entry) {
      return reply.status(404).send({ error: `bg process '${slug}' not found` });
    }
    // TASK-0193: caller identification + cooldown + audit.
    // Header convention: `X-Conductor-Agent: <raw tmux window/agent name>` (trimmed,
    // capped at 128 chars); an absent/empty header means a human/dashboard caller,
    // which is exempt from the cooldown. This is a runaway-loop guardrail, NOT
    // authentication (single-user localhost, no auth): an agent that omits the
    // header bypasses the agent cooldown. Every attempt past the 404 is appended
    // to `<LOG_DIR>/bg-restarts.jsonl` (no rotation: bounded by nature, like the
    // other JSONL logs).
    const caller = parseCallerHeader(req.headers[BG_CALLER_HEADER]);
    const callerKind = callerKindFor(caller);
    const audit = (fields: Omit<BgRestartAuditInput, 'ts' | 'bg' | 'callerKind' | 'caller'>): void => {
      appendAuditRecord(defaultAuditDeps, logDir, buildAuditRecord({ ts: Date.now(), bg: slug, callerKind, caller, ...fields }));
    };

    // TASK-0194: same-project guard. Check order is 404 unknown bg -> 403 guard ->
    // 409 session -> 429 cooldown -> restart, so a denied caller learns neither
    // session nor cooldown state and a denial never touches tmux or arms the
    // cooldown. The header is resolved server-side to an agent row and its project
    // (exact window-name match, see bgAccess.ts): a same-project agent or a
    // header-less human/dashboard caller is allowed; a different-project agent, an
    // agent restarting an unscoped bg process, and an unknown or ambiguous identity
    // are denied (fail closed; an unresolvable identity never widens access).
    // NOT a security boundary: same single-user, no-auth trust model as the rest of
    // the host-server, so an agent that spoofs another agent's name (or omits the
    // header) is not stopped. Read routes and the mutating open/close-window and
    // PATCH/DELETE routes are unauthenticated by design and out of scope here.
    const authz = authorizeRestart(resolveCallerProject(caller, listAgents(db)), { projectId: entry.projectId });
    if (!authz.allowed) {
      audit({ outcome: 'denied', reason: authz.reason });
      return reply.status(403).send({
        error: `restart denied: ${authz.reason}`,
        reason: authz.reason,
        callerProjectId: authz.callerProjectId,
        bgProjectId: authz.bgProjectId,
      });
    }

    if (!tmuxSessionExists(sessionName)) {
      audit({ outcome: 'failed', step: 'session-check' });
      return reply.status(409).send({ error: 'session not running', sessionAlive: false });
    }

    const history = getRestartHistory(logDir);
    const last = history.last(slug);
    const decision = evaluateCooldown({
      now: Date.now(),
      lastRestartAt: last?.at ?? null,
      cooldownMs: conf.bgRestartCooldownMs,
      callerKind,
    });
    if (!decision.allowed) {
      audit({ outcome: 'cooldown', cooldownRemainingS: decision.cooldownRemainingS });
      reply.header('Retry-After', String(decision.retryAfterS));
      return reply.status(429).send({
        error: 'restart cooldown',
        retryAfterS: decision.retryAfterS,
        lastRestartAt: last !== null ? new Date(last.at).toISOString() : null,
        lastRestartBy: last?.caller ?? null,
      });
    }

    const result = restartBgProcess(
      defaultBgRestartDeps(),
      { slug, workdir: entry.workdir, launchCmd: entry.launchCmd },
      { sessionName, logDir },
    );
    if (!result.ok) {
      // A failed restart does not arm the cooldown.
      audit({ outcome: 'failed', step: result.step, ...(result.status !== null ? { status: result.status } : {}) });
      return reply.status(500).send({ error: 'restart failed', step: result.step, status: result.status });
    }

    const restartedAtMs = Date.parse(result.restartedAt);
    history.recordSuccess(slug, Number.isNaN(restartedAtMs) ? Date.now() : restartedAtMs, caller);
    audit({ outcome: 'restarted', mechanism: result.mechanism });

    return reply.send({ ok: true, name: slug, restartedAt: result.restartedAt, mechanism: result.mechanism });
  });

  // Close a bg process's tmux window without removing its registration — the
  // inverse of POST /bg-processes/:name/window, mirroring the agent variant
  // DELETE /agents/:agent/window. The state file is removed so a stale
  // alive/dead value doesn't linger until the next reopen.
  api.delete<{ Params: { slug: string } }>('/bg-processes/:slug/window', (req, reply) => {
    const { slug } = req.params;
    const conf = readConductorConf();
    const { sessionName, stateDir } = conf;

    const entry = getBgBySlug(db, slug);
    if (!entry) {
      return reply.status(404).send({ error: `bg process '${slug}' not found` });
    }
    if (!isTmuxWindowPresent(sessionName, slug)) {
      return reply.status(409).send({ error: 'bg window not present' });
    }

    const r = spawnSync('tmux', ['kill-window', '-t', windowTarget(sessionName, slug)], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
    if (r.status !== 0) {
      return reply.status(500).send({ error: 'tmux kill-window failed', stderr: r.stderr });
    }
    try { unlinkSync(path.join(stateDir, `bg-${slug}.state`)); } catch { /* no state file — fine */ }

    return reply.send({ ok: true, closed: slug });
  });

  // GET /bg-processes/:slug/tail — ANSI-stripped, bounded tail of the bg process's
  // pipe-pane log (`bg-<slug>.log`, same path as buildBgStatuses' logPath). `lines`
  // is parsed/clamped like /agents/:id/tail (1..1000, default 50). `?format=text`
  // returns text/plain (lines joined by "\n", trailing newline when non-empty) so
  // shell callers need no jq. A registered bg process whose log does not exist yet
  // returns 200 with empty `lines`; an unknown name is 404.
  // Security note: dev-server output may contain tokens. This route sits on the same
  // unauthenticated single-user localhost server, adding no exposure beyond the file
  // agents can already tail. No auth/project scoping here — read policy is
  // TASK-0186/TASK-0194's concern (restart-only).
  api.get<{ Params: { slug: string }; Querystring: { lines?: string; format?: string } }>('/bg-processes/:slug/tail', async (req, reply) => {
    const { slug } = req.params;
    const entry = getBgBySlug(db, slug);
    if (!entry) {
      return reply.status(404).send({ error: `bg process '${slug}' not found` });
    }

    const lines = clampTailLines(req.query.lines);
    const logPath = path.join(readConductorConf().logDir, `bg-${slug}.log`);
    const tail = await readLogTail(logPath, { lines });

    if (req.query.format === 'text') {
      const body = tail.lines.length > 0 ? `${tail.lines.join('\n')}\n` : '';
      return reply.type('text/plain; charset=utf-8').send(body);
    }
    return reply.send({
      slug,
      name: entry.name,
      lines: tail.lines,
      truncated: tail.truncated,
      sizeBytes: tail.sizeBytes,
      logPath,
      updatedAt: tail.updatedAt,
    });
  });

  // Resolve the nearest git root for a given path. Used by the frontend to
  // suggest correcting a workdir that is inside a repo but not at its root.
  api.get<{ Querystring: { path?: string } }>('/git-root', (req, reply) => {
    const p = req.query.path;
    if (!p || typeof p !== 'string' || !p.startsWith('/')) {
      return reply.status(400).send({ error: 'path query param is required and must be absolute' });
    }
    const r = spawnSync('git', ['-C', p, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: SHELL_SYNC_TIMEOUT_MS });
    if (r.status !== 0) {
      return reply.send({ isRepo: false, isInsideRepo: false, gitRoot: null });
    }
    const gitRoot = r.stdout.trim();
    return reply.send({
      isRepo: gitRoot === p,
      isInsideRepo: gitRoot !== p,
      gitRoot,
    });
  });

  // Apply a browser-probed terminal size to every window in the shared tmux
  // session (TASK-130). The headless conductor session is never attached by
  // a real terminal, so windows otherwise sit at tmux's factory default
  // (80x24), causing capture-pane output to wrap far short of the dashboard
  // panel's real width. 503 (not 400) when the session isn't up yet — that's
  // not a client error, the dashboard can legitimately be opened before any
  // agent session exists.
  api.post<{ Body: { cols?: unknown; rows?: unknown } }>('/terminal-size', (req, reply) => {
    const { cols, rows } = req.body;
    if (typeof cols !== 'number' || !Number.isInteger(cols) || cols < 20 || cols > 500) {
      return reply.status(400).send({ error: 'cols must be an integer between 20 and 500' });
    }
    if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 10 || rows > 200) {
      return reply.status(400).send({ error: 'rows must be an integer between 10 and 200' });
    }
    const conf = readConductorConf();
    const result = applyGlobalPaneSize(conf.sessionName, cols, rows);
    if (!result.ok) {
      return reply.status(503).send({ error: result.error ?? 'failed to apply terminal size' });
    }
    return reply.send({ cols, rows, resizedWindows: result.resizedWindows });
  });

  // Browse local filesystem directories. Used by the frontend folder picker.
  api.get<{ Querystring: { path?: string } }>('/browse', (req, reply) => {
    const rawPath = req.query.path ?? os.homedir();
    const resolved = rawPath.startsWith('~')
      ? path.join(os.homedir(), rawPath.slice(1))
      : path.resolve(rawPath);

    let stat;
    try {
      stat = statSync(resolved);
    } catch {
      return reply.status(400).send({ error: 'Path does not exist' });
    }
    if (!stat.isDirectory()) {
      return reply.status(400).send({ error: 'Path is not a directory' });
    }

    let entries: { name: string; path: string }[] = [];
    try {
      entries = readdirSync(resolved, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      // Permission denied — return empty list rather than an error.
    }

    const parent = resolved === '/' ? null : path.dirname(resolved);
    return reply.send({ path: resolved, parent, entries });
  });

  // ── Projects API ─────────────────────────────────────────────────────────

  api.get('/projects', (_req, reply) => {
    return reply.send(listProjects(db));
  });

  api.post<{ Body: { name?: unknown; workdir?: unknown; defaultLaunchCmd?: unknown } }>('/projects', async (req, reply) => {
    const { name, workdir, defaultLaunchCmd } = req.body;

    if (typeof name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(name)) {
      return reply.status(400).send({ error: 'name is required and must match ^[A-Za-z0-9_-]+$' });
    }
    if (typeof workdir !== 'string' || !workdir.startsWith('/')) {
      return reply.status(400).send({ error: 'workdir is required and must be an absolute path (starts with /)' });
    }
    if (defaultLaunchCmd !== undefined && typeof defaultLaunchCmd !== 'string') {
      return reply.status(400).send({ error: 'defaultLaunchCmd must be a string' });
    }

    const project = createProject(db, {
      name,
      workdir,
      ...(typeof defaultLaunchCmd === 'string' ? { defaultLaunchCmd } : {}),
    });
    return reply.status(201).send(project);
  });

  api.put<{ Params: { id: string }; Body: { name?: unknown; workdir?: unknown; defaultLaunchCmd?: unknown } }>('/projects/:id', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return reply.status(400).send({ error: 'invalid project id' });
    }

    const { name, workdir, defaultLaunchCmd } = req.body;
    const data: Partial<{ name: string; workdir: string; defaultLaunchCmd: string }> = {};
    if (name !== undefined) {
      if (typeof name !== 'string') return reply.status(400).send({ error: 'name must be a string' });
      data.name = name;
    }
    if (workdir !== undefined) {
      if (typeof workdir !== 'string') return reply.status(400).send({ error: 'workdir must be a string' });
      data.workdir = workdir;
    }
    if (defaultLaunchCmd !== undefined) {
      if (typeof defaultLaunchCmd !== 'string') return reply.status(400).send({ error: 'defaultLaunchCmd must be a string' });
      data.defaultLaunchCmd = defaultLaunchCmd;
    }

    try {
      const project = updateProject(db, id, data);
      return await reply.send(project);
    } catch {
      return reply.status(404).send({ error: `project ${String(id)} not found` });
    }
  });

  api.delete<{ Params: { id: string }; Querystring: { force?: string } }>('/projects/:id', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return reply.status(400).send({ error: 'invalid project id' });
    }
    const force = req.query.force === '1';

    // TASK-0195: deleting a project cascades to its bg processes. deleteProject
    // removes the bg rows + the project atomically (and throws before writing
    // anything when agents block a non-forced delete), then we tear down each
    // removed process's tmux window and state file, same as
    // DELETE /bg-processes/:name/window. Window teardown is best-effort: the
    // rows are already gone, so a tmux failure must not fail the request.
    // TASK-0196: window/state names are the bg slug `<project>-<name>`, so the
    // project name must be captured BEFORE deleteProject removes the row.
    const projectName = listProjects(db).find((p) => p.id === id)?.name ?? null;
    let removedBg: string[];
    let removedBgSlugs: string[];
    try {
      const removedRows = deleteProject(db, id, force);
      removedBg = removedRows.map((b) => b.name);
      removedBgSlugs = removedRows.map((b) => bgSlug(b, projectName));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(409).send({ error: msg });
    }

    if (removedBgSlugs.length > 0) {
      const { sessionName, stateDir } = readConductorConf();
      for (const slug of removedBgSlugs) {
        try {
          if (isTmuxWindowPresent(sessionName, slug)) {
            spawnSync('tmux', ['kill-window', '-t', windowTarget(sessionName, slug)], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
          }
        } catch { /* best-effort: window already gone or tmux unavailable */ }
        try { unlinkSync(path.join(stateDir, `bg-${slug}.state`)); } catch { /* no state file — fine */ }
      }
    }

    return reply.send({ ok: true, removedBgProcesses: removedBg });
  });

  api.post<{ Params: { id: string }; Body: { name?: unknown; launchCmd?: unknown; role?: unknown; description?: unknown; useWorktree?: unknown } }>('/projects/:id/agents', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return reply.status(400).send({ error: 'invalid project id' });
    }

    const project = listProjects(db).find((p) => p.id === id);
    if (!project) {
      return reply.status(404).send({ error: `project ${String(id)} not found` });
    }

    const { name: nameOverride, launchCmd: launchCmdOverride, role, description, useWorktree } = req.body;
    if (nameOverride !== undefined && (typeof nameOverride !== 'string' || !/^[A-Za-z0-9_-]+$/.test(nameOverride))) {
      return reply.status(400).send({ error: 'name must match ^[A-Za-z0-9_-]+$' });
    }
    if (launchCmdOverride !== undefined && (typeof launchCmdOverride !== 'string' || launchCmdOverride.trim() === '')) {
      return reply.status(400).send({ error: 'launchCmd must be a non-empty string' });
    }
    // TASK-115: reuse rolePresets.ts's ROLE_VALUES (already the canonical
    // enum for POST /agents' own role validation) rather than declaring a
    // third copy of this list here.
    if (role !== undefined && (typeof role !== 'string' || !ROLE_VALUES.includes(role))) {
      return reply.status(400).send({ error: `role must be one of: ${ROLE_VALUES.join(', ')}` });
    }

    const effectiveRole = typeof role === 'string' ? role : 'generic';
    const agentName = typeof nameOverride === 'string' ? nameOverride : nextAgentName(db, id, effectiveRole);
    const launchCmd = typeof launchCmdOverride === 'string' ? launchCmdOverride.trim() : project.defaultLaunchCmd;
    const newAgent = createAgent(db, {
      name: agentName,
      workdir: project.workdir,
      launchCmd,
      projectId: id,
      role: effectiveRole,
      ...(typeof description === 'string' && description.trim() !== '' ? { description: description.trim() } : {}),
      useWorktree: useWorktree === true,
    });

    const conf = readConductorConf();
    const winName = agentWindowName(newAgent);
    spawnAgentWindow(newAgent, conf);

    // Immediately notify SSE clients — don't wait for the next poll tick.
    {
      const windowPresent = isTmuxWindowPresent(conf.sessionName, winName);
      const tail15 = windowPresent ? capturePaneTail(conf.sessionName, winName, 15, 'snapshot') : '';
      const { state } = detectAgentStatusWithBackgroundJobs(conf, winName, launchCmd, agentPaneCwd(newAgent), tail15 || undefined);
      const isBusy = state === 'busy' || state === 'awaiting' || state === 'stalled';
      const agentType = detectAgentType(launchCmd);
      const ctx = getContextForAgent(conf, agentType, winName, agentPaneCwd(newAgent), isBusy, tail15 || undefined);
      broadcastSSE('agent-update', buildNewAgentUpdate(newAgent, {
        state, mode: windowPresent ? detectAgentMode(conf, winName, launchCmd, tail15) : 'unknown',
        agentType, windowPresent, inGitRepo: isInGitRepoCached(newAgent.workdir), context: ctx,
      }));
    }

    return reply.status(201).send(newAgent);
  });

  api.get<{ Params: { id: string } }>('/projects/:id/bg-processes', (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return reply.status(400).send({ error: 'invalid project id' });
    }

    const project = listProjects(db).find((p) => p.id === id);
    if (!project) {
      return reply.status(404).send({ error: `project ${String(id)} not found` });
    }

    return reply.send(listBgProcesses(db, { projectId: id }));
  });

  // ── Schedules API ─────────────────────────────────────────────────────────

  api.get('/schedules', (_req, reply) => {
    return reply.send(listSchedules(db));
  });

  api.post<{ Body: { name?: unknown; command?: unknown; intervalSeconds?: unknown; action?: unknown; agentId?: unknown; projectId?: unknown; skipIfPending?: unknown } }>('/schedules', (req, reply) => {
    const { name, command, intervalSeconds, action, agentId, projectId, skipIfPending } = req.body;

    if (typeof command !== 'string' || command.trim() === '') {
      return reply.status(400).send({ error: 'command is required and must be a non-empty string' });
    }
    if (typeof intervalSeconds !== 'number' || !Number.isInteger(intervalSeconds) || intervalSeconds < 5) {
      return reply.status(400).send({ error: 'intervalSeconds must be an integer >= 5' });
    }
    if (action !== undefined && action !== 'append' && action !== 'jump') {
      return reply.status(400).send({ error: "action must be 'append' or 'jump'" });
    }
    if (agentId !== undefined && !Number.isInteger(agentId)) {
      return reply.status(400).send({ error: 'agentId must be an integer' });
    }
    if (projectId !== undefined && !Number.isInteger(projectId)) {
      return reply.status(400).send({ error: 'projectId must be an integer' });
    }
    if (agentId !== undefined && projectId !== undefined) {
      return reply.status(409).send({ error: 'agentId and projectId cannot both be set' });
    }

    const schedule = createSchedule(db, {
      ...(typeof name === 'string' ? { name } : {}),
      command: command.trim(),
      intervalSeconds,
      ...(action !== undefined ? { action } : {}),
      ...(typeof agentId === 'number' ? { agentId } : {}),
      ...(typeof projectId === 'number' ? { projectId } : {}),
      ...(skipIfPending !== undefined ? { skipIfPending: Boolean(skipIfPending) } : {}),
    });
    return reply.status(201).send(schedule);
  });

  api.put<{ Params: { id: string }; Body: Partial<{ name: string | null; command: string; intervalSeconds: number; action: 'append' | 'jump'; agentId: number | null; projectId: number | null; enabled: number; skipIfPending: number }> }>('/schedules/:id', (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return reply.status(404).send({ error: 'invalid schedule id' });
    }
    try {
      const schedule = updateSchedule(db, id, req.body);
      return reply.send(schedule);
    } catch {
      return reply.status(404).send({ error: `schedule ${String(id)} not found` });
    }
  });

  api.delete<{ Params: { id: string } }>('/schedules/:id', (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return reply.status(404).send({ error: 'invalid schedule id' });
    }
    deleteSchedule(db, id);
    return reply.status(204).send();
  });

  api.patch<{ Params: { id: string } }>('/schedules/:id/toggle', (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return reply.status(404).send({ error: 'invalid schedule id' });
    }
    const existing = db.prepare('SELECT * FROM schedules WHERE id=?').get(id);
    if (!existing) {
      return reply.status(404).send({ error: `schedule ${String(id)} not found` });
    }
    db.prepare('UPDATE schedules SET enabled = 1 - enabled WHERE id=?').run(id);
    try {
      const updated = updateSchedule(db, id, {});
      return reply.send(updated);
    } catch {
      return reply.status(404).send({ error: `schedule ${String(id)} not found` });
    }
  });

  // ── SSE Live State Stream ─────────────────────────────────────────────────

  api.get('/events', (req, reply) => {
    reply.hijack();
    // hijack() bypasses Fastify's onSend lifecycle, so @fastify/cors never runs
    // for this route — set the CORS header on the raw response manually.
    const allowOrigin = process.env['CORS_ORIGIN'] || req.headers.origin || '*';
    reply.raw.setHeader('Access-Control-Allow-Origin', allowOrigin);
    reply.raw.setHeader('Vary', 'Origin');
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    reply.raw.write(': connected\n\n');
    sseClients.add(reply);
    liveUpdateMetrics.sseConnections.opened += 1;
    liveUpdateMetrics.activeSseConnections = sseClients.size;

    // Send the current full state to this client so reconnects and late-connecting
    // clients are immediately consistent without waiting for the next diff tick.
    if (prevSnapshot !== null) {
      sendSSE(reply, 'session-update', { sessionAlive: prevSnapshot.sessionAlive, sessionExists: prevSnapshot.sessionExists });
      for (const agent of prevSnapshot.agents) {
        sendSSE(reply, 'agent-update', {
          id: agent.id,
          projectId: agent.projectId,
          projectName: agent.projectName,
          agentType: agent.agentType,
          label: agent.label,
          name: agent.name, state: agent.state, mode: agent.mode,
          status: agent.status,
          queuedTasks: agent.queuedTasks, windowPresent: agent.windowPresent,
          launchCmd: agent.launchCmd, workdir: agent.workdir,
          worktreePath: agent.worktreePath, branch: agent.branch,
          role: agent.role, description: agent.description,
          activeTask: agent.activeTask,
          model: agent.model, modelId: agent.modelId,
          contextTokens: agent.contextTokens, contextPct: agent.contextPct, contextLimit: agent.contextLimit,
          contextLimitConfident: agent.contextLimitConfident,
          usage: agent.usage,
          inGitRepo: agent.inGitRepo,
          lastPrompt: agent.lastPrompt,
        });
      }
      for (const bg of prevSnapshot.bgProcesses) {
        sendSSE(reply, 'bg-update', bg);
      }
    }

    const heartbeat = setInterval(() => {
      try { reply.raw.write(': ping\n\n'); } catch { /* ignore */ }
    }, 15000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      if (sseClients.delete(reply)) {
        liveUpdateMetrics.sseConnections.closed += 1;
      }
      liveUpdateMetrics.activeSseConnections = sseClients.size;
    });

    // Keep connection open — never call reply.send()
  });

}, { prefix: '/api' });

// ── Poll-and-diff loop ────────────────────────────────────────────────────────

// Keyed by the stable agent id (names are only unique per project, so name keys
// would conflate two same-named agents' tail streams / focus registrations).
const prevTailMap = new Map<number, string>();
const prevTailMapFocus = new Map<number, string>();
const focusedAgents = new Set<number>();
const focusedWebSocketAgents = new Map<number, number>();
const agentLabelCache = new Map<number, string | null>();
const agentContextCache = new Map<number, AgentContext>();
// Side-channel for per-tick detection detail that must NOT leak into the public
// agentStatuses[] SSE contract (raw pane tail text, internal detection reason).
// Populated fresh in buildSnapshot() every tick; read by pollAndDiff() for
// transition-log purposes (TASK-143 step 2/3), not part of the JSON-serialized snapshot.
const lastDetectionByAgentId = new Map<number, { reason: DetectionReason; matchedPattern: 'busy' | 'idle' | 'awaiting' | undefined; tail15: string }>();

function addFocusedWebSocketOwner(agentId: number): void {
  focusedWebSocketAgents.set(agentId, (focusedWebSocketAgents.get(agentId) ?? 0) + 1);
}

function removeFocusedWebSocketOwner(agentId: number): void {
  const next = (focusedWebSocketAgents.get(agentId) ?? 0) - 1;
  if (next > 0) {
    focusedWebSocketAgents.set(agentId, next);
    return;
  }
  focusedWebSocketAgents.delete(agentId);
  prevTailMapFocus.delete(agentId);
}

// Live check on read: an agent's worktree_path/branch columns are set once
// when a worktree is created (opt-in worktree spawn) and normally cleared by
// the delete-agent flow's `git worktree remove --force`. If the user removes
// the worktree directory some other way, the columns go stale and the
// dashboard would keep showing a branch badge for an agent that's actually
// back on the primary branch. Checked once per agent per response body
// (not on a background sweep) so a stale reference self-heals the moment it's
// observed, without adding a poll loop.
function resolveAgentWorktree(agent: Agent): { worktreePath: string | null; branch: string | null } {
  if (!agent.worktreePath) {
    return { worktreePath: null, branch: agent.branch };
  }
  if (existsSync(agent.worktreePath)) {
    return { worktreePath: agent.worktreePath, branch: agent.branch };
  }
  clearAgentWorktree(db, agent.id);
  return { worktreePath: null, branch: null };
}

function buildSnapshot(): Snapshot {
  const conf = readConductorConf();
  const { sessionName } = conf;
  const agents = listAgents(db);
  const inventory = readTmuxWindowInventory(sessionName);
  if (inventory.timedOut && prevSnapshot !== null) {
    return prevSnapshot;
  }
  const sessionExists = inventory.sessionExists;
  const sessionAlive = sessionExists && inventory.windows.has('monitor');
  const queuedTaskCounts = buildQueuedTaskCounts(agents);
  let usageByAgent = new Map<number, AgentUsageTotals>();
  try {
    usageByAgent = new Map(getAllAgentUsageTotals(db).map((t) => [t.agentId, t]));
  } catch { /* pre-migration DB — snapshot must never break on missing usage table */ }
  const agentStatuses = agents.map((agent) => {
    const wn = agentWindowName(agent);
    const paneCurrentCommand = inventory.windows.get(wn) ?? null;
    const windowPresent = paneCurrentCommand !== null;
    // One capture-pane per agent per tick, shared by status and mode detection.
    const tail15 = windowPresent ? capturePaneTail(sessionName, wn, 15, 'snapshot') : '';
    const { state, reason, matchedPattern } = detectAgentStatusWithBackgroundJobs(conf, wn, agent.launchCmd, agentPaneCwd(agent), tail15 || undefined, windowPresent, paneCurrentCommand);
    lastDetectionByAgentId.set(agent.id, { reason, matchedPattern, tail15 });
    // Clear label when window is gone; re-seed whenever cache is null (covers server restart + no-window reopen).
    if (state === 'no-window') {
      agentLabelCache.set(agent.id, null);
    } else if (agentLabelCache.get(agent.id) == null && windowPresent) {
      agentLabelCache.set(agent.id, extractPaneLabel(tail15));
    }
    const label = agentLabelCache.get(agent.id) ?? null;
    const activeTask = getActiveTask(conf, wn, state);
    const lastPrompt = readLastPrompt(conf.stateDir, wn);
    return {
      id: agent.id,
      name: agent.name,
      projectId: agent.projectId,
      projectName: agent.projectName,
      state,
      status: buildAgentStatusContract({
        conf,
        windowName: wn,
        state,
        agentType: detectAgentType(agent.launchCmd),
        queuedTasks: queuedTaskCounts.get(agent.id) ?? 0,
        windowPresent,
        paneCurrentCommand,
        activeTask,
      }),
      mode: windowPresent ? detectAgentMode(conf, wn, agent.launchCmd, tail15) : 'unknown',
      agentType: detectAgentType(agent.launchCmd),
      windowPresent,
      queuedTasks: queuedTaskCounts.get(agent.id) ?? 0,
      launchCmd: agent.launchCmd,
      workdir: agent.workdir,
      ...resolveAgentWorktree(agent),
      inGitRepo: isInGitRepoCached(agent.workdir),
      role: agent.role, description: agent.description,
      activeTask,
      label,
      usage: usageByAgent.get(agent.id) ?? null,
      lastPrompt,
      ...(agentContextCache.get(agent.id) ?? emptyAgentContext(conf)),
    };
  });
  return { sessionAlive, sessionExists, agents: agentStatuses, bgProcesses: buildBgStatuses(conf, inventory.windows, inventory.windowActivityMs) };
}

// Auto-heal: a live session whose monitor window died gets the monitor
// recreated. A fully missing session is NEVER auto-started — that requires an
// explicit POST /session/start, so a deliberate teardown stays torn down.
function maybeHealMonitor(current: Snapshot): void {
  if (!current.sessionExists || current.sessionAlive) return;
  const now = Date.now();
  if (now - lastMonitorHealAttempt < MONITOR_HEAL_COOLDOWN_MS) return;
  lastMonitorHealAttempt = now;
  const { sessionName } = readConductorConf();
  console.log(`monitor window missing in live session '${sessionName}' — recreating`);
  if (!healMonitorWindow(sessionName)) {
    console.error('failed to recreate monitor window');
  }
}

function pollAndDiff() {
  let current;
  try { current = buildSnapshot(); } catch { return; }

  try { maybeHealMonitor(current); } catch { /* heal is best-effort */ }

  if (prevSnapshot === null) {
    prevSnapshot = current;
    return;
  }

  if (current.sessionAlive !== prevSnapshot.sessionAlive || current.sessionExists !== prevSnapshot.sessionExists) {
    broadcastSSE('session-update', { sessionAlive: current.sessionAlive, sessionExists: current.sessionExists });
  }

  const conf = readConductorConf();

  for (const agent of current.agents) {
    const prev = prevSnapshot.agents.find((a) => a.id === agent.id);
    if (agentSnapshotChanged(prev, agent)) {
      if (prev && prev.state !== agent.state) {
        const key = `${prev.state}->${agent.state}`;
        liveUpdateMetrics.statusTransitions[key] = (liveUpdateMetrics.statusTransitions[key] ?? 0) + 1;
        appendObservabilityLog('status_transition', {
          agentId: agent.id,
          agent: agent.name,
          previousState: prev.state,
          nextState: agent.state,
        });
        const detection = lastDetectionByAgentId.get(agent.id);
        appendTransitionLog({
          agentId: agent.id,
          agent: agent.name,
          from: prev.state,
          to: agent.state,
          reason: detection?.reason ?? 'state-file',
          matchedPattern: detection?.matchedPattern,
          stateFileAgeS: agent.status.evidence.stateFile.ageSeconds,
          windowPresent: agent.windowPresent,
          queuedTasks: agent.queuedTasks,
          paneTail: detection?.tail15 ? detection.tail15.split('\n') : [],
        });
      }

      // TASK-120 step 3: on an idle-transition with queued work, dispatch the
      // next task immediately instead of waiting for the next scheduled poll.
      // Skipped when the fleet-wide usage-limited marker is present (Step 2)
      // or when the agent's tmux window is gone (nothing to dispatch into).
      if (
        prev &&
        prev.state !== 'idle' &&
        agent.state === 'idle' &&
        agent.queuedTasks > 0 &&
        agent.windowPresent &&
        !existsSync(path.join(conf.stateDir, 'usage-limited'))
      ) {
        const dbAgent = getAgentById(db, agent.id);
        if (dbAgent) {
          const win = agentWindowName(dbAgent);
          // BUG-0001: an idle-transition here can be a false idle — Claude
          // Code's Stop hook legitimately fires (and writes idle) while a
          // background sub-agent the turn spawned (e.g. /power-mode's
          // UAT-auto agents) is still running. hooks/on-notification.js
          // tracks that outstanding work as a sentinel under
          // `<window>.pending-agents/`; hold dispatch while one is fresh so
          // the next queued task doesn't interleave into a pane that is
          // still genuinely busy. See host-server/pendingAgents.ts.
          if (!hasPendingBackgroundAgents(conf.stateDir, win, conf.pendingAgentStaleMs)) {
            const task = popTask(db, agent.name);
            if (task) {
              void dispatchTaskToAgent(db, conf, dbAgent, task.command, 'idle-transition-poll', { clearFirst: task.kind === 'project' }).catch((err: unknown) => {
                console.error(`[conductor] dispatchTaskToAgent failed for agent ${String(dbAgent.id)}:`, err);
              });
            }
          }
        }
      }

      broadcastSSE('agent-update', {
        id: agent.id,
        name: agent.name,
        projectId: agent.projectId,
        projectName: agent.projectName,
        agentType: agent.agentType,
        state: agent.state,
        status: agent.status,
        mode: agent.mode,
        queuedTasks: agent.queuedTasks,
        windowPresent: agent.windowPresent,
        launchCmd: agent.launchCmd,
        workdir: agent.workdir,
        worktreePath: agent.worktreePath,
        branch: agent.branch,
        role: agent.role, description: agent.description,
        activeTask: agent.activeTask,
        label: agent.label,
        model: agent.model,
        modelId: agent.modelId,
        contextTokens: agent.contextTokens,
        contextPct: agent.contextPct,
        contextLimit: agent.contextLimit,
        contextLimitConfident: agent.contextLimitConfident,
        usage: agent.usage,
        inGitRepo: agent.inGitRepo,
        lastPrompt: agent.lastPrompt,
      });
    }
  }

  for (const prev of prevSnapshot.agents) {
    if (!current.agents.some((a) => a.id === prev.id)) {
      broadcastSSE('agent-removed', { id: prev.id, name: prev.name });
    }
  }

  for (const bg of current.bgProcesses) {
    const prev = prevSnapshot.bgProcesses.find((b) => b.slug === bg.slug);
    if (bgStatusChanged(prev, bg)) {
      broadcastSSE('bg-update', bg);
    }
  }

  for (const prev of prevSnapshot.bgProcesses) {
    if (!current.bgProcesses.some((b) => b.slug === prev.slug)) {
      broadcastSSE('bg-removed', { slug: prev.slug, name: prev.name });
    }
  }

  prevSnapshot = current;
}

function tailPollLoop() {
  try {
    const conf = readConductorConf();
    const inventory = readTmuxWindowInventory(conf.sessionName);
    if (inventory.timedOut) return;
    if (!inventory.sessionExists) return;
    const lines = conf.terminalTailLines;
    const agents: Agent[] = [];
    for (const a of listAgents(db)) {
      if (focusedAgents.has(a.id)) continue;
      if (inventory.windows.has(agentWindowName(a))) {
        agents.push(a);
        continue;
      }
      // Windowless agent: never capture (a prefix-matching target could hit a
      // sibling's window). Clear the stale terminal once, then stay quiet.
      if ((prevTailMap.get(a.id) ?? '') !== '') {
        broadcastSSE('terminal-output', { agentId: a.id, agent: a.name, text: '', lines });
        prevTailMap.set(a.id, '');
      }
    }
    for (const a of agents) {
      const wn = agentWindowName(a);
      const text = capturePaneTail(conf.sessionName, wn, lines, 'terminal-loop');
      if (prevTailMap.get(a.id) !== text) {
        broadcastSSE('terminal-output', { agentId: a.id, agent: a.name, text, lines });
        prevTailMap.set(a.id, text);
        const found = extractPaneLabel(text);
        if (found !== null) agentLabelCache.set(a.id, found);
        try {
          appendTerminalLogChunk(db, a.id, text, conf.terminalLogMaxRowsPerAgent);
        } catch (err) {
          console.error('[tailPollLoop] appendTerminalLogChunk failed', err);
        }
      }
    }
  } catch { /* tail poll is best-effort */ }
}

function tailPollLoopFocus() {
  if (focusedAgents.size === 0) return;
  try {
    const conf = readConductorConf();
    const inventory = readTmuxWindowInventory(conf.sessionName);
    if (inventory.timedOut) return;
    if (!inventory.sessionExists) return;
    const lines = conf.focusedTerminalTailLines;
    const agents: Agent[] = [];
    for (const a of listAgents(db)) {
      if (!focusedAgents.has(a.id) || focusedWebSocketAgents.has(a.id)) continue;
      if (inventory.windows.has(agentWindowName(a))) {
        agents.push(a);
        continue;
      }
      // Windowless agent: skip capture/label update; clear the stale terminal once.
      if ((prevTailMapFocus.get(a.id) ?? '') !== '') {
        broadcastSSE('terminal-output-focus', { agentId: a.id, agent: a.name, text: '', lines });
        prevTailMapFocus.set(a.id, '');
      }
    }
    for (const a of agents) {
      const wn = agentWindowName(a);
      const text = capturePaneTailRaw(conf.sessionName, wn, lines, 'focused-terminal-loop');
      if (prevTailMapFocus.get(a.id) !== text) {
        broadcastSSE('terminal-output-focus', { agentId: a.id, agent: a.name, text, lines });
        prevTailMapFocus.set(a.id, text);
        const found = extractPaneLabel(text);
        if (found !== null) agentLabelCache.set(a.id, found);
      }
    }
  } catch { /* tail poll is best-effort */ }
}

// ── Static UI (prod only — ui/dist is absent in dev) ─────────────────────────

const uiDist = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui', 'dist');
if (existsSync(uiDist)) {
  await fastify.register(fastifyStatic, { root: uiDist, prefix: '/' });
}

// ── Start ─────────────────────────────────────────────────────────────────────

const port = parseInt(process.env['PORT'] || process.env['BACKEND_PORT'] || '8788', 10);
const host = process.env['HOST'] ?? '127.0.0.1';

// Background timer handles — hoisted so gracefulShutdown can clear them.
const timers = new Set<NodeJS.Timeout>();
const loopWarnedAt = new Map<string, number>();

type ManagedLoopMs = number | (() => number);

function resolveLoopMs(value: ManagedLoopMs): number {
  const ms = typeof value === 'function' ? value() : value;
  return Number.isFinite(ms) && ms > 0 ? ms : 1;
}

/**
 * Bind the listen port, retrying on EADDRINUSE. A stale host-server from a
 * prior `make dev` (or one mid-reload) can briefly hold the port; rather than
 * crashing into a wedged `tsx watch` (which only relaunches on file change),
 * we back off and retry so we bind automatically once it releases the port.
 * Total budget ~30s, then exit cleanly. Non-EADDRINUSE errors fail fast.
 */
async function listenWithRetry(): Promise<void> {
  const delays = [2000, 4000, 8000, 8000, 8000]; // ~30s total
  for (let attempt = 0; ; attempt++) {
    try {
      await fastify.listen({ port, host });
      console.log(`Dashboard server listening on http://${host}:${String(port)}`);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE' && attempt < delays.length) {
        const delay = delays[attempt] ?? 8000;
        console.warn(
          `Port ${String(port)} in use — likely a stale host-server still shutting down. ` +
            `Retrying in ${String(delay / 1000)}s (attempt ${String(attempt + 1)}/${String(delays.length)})…`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (code === 'EADDRINUSE') {
        console.error(
          `Port ${String(port)} still in use after retries. Another host-server is holding it — ` +
            `stop it (e.g. \`kill\` the stale process) and restart.`,
        );
      } else {
        console.error('Failed to start dashboard server:', err);
      }
      process.exit(1);
    }
  }
}

let shuttingDown = false;

function startManagedLoop(
  name: string,
  delayMs: ManagedLoopMs,
  fn: () => void | Promise<void>,
  opts: { warnAfterMs?: ManagedLoopMs; backoffMs?: ManagedLoopMs } = {},
): void {
  const schedule = (ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (shuttingDown) return;
      void (async () => {
        const started = Date.now();
        try {
          await fn();
        } catch (err) {
          console.error(`${name} loop failed:`, err);
        }
        const elapsed = Date.now() - started;
        const currentDelayMs = resolveLoopMs(delayMs);
        const warnAfterMs = resolveLoopMs(opts.warnAfterMs ?? currentDelayMs);
        const slow = elapsed > warnAfterMs;
        if (slow) {
          const lastWarn = loopWarnedAt.get(name) ?? 0;
          if (Date.now() - lastWarn > 15_000) {
            console.warn(`${name} loop took ${String(elapsed)}ms; backing off polling to keep HTTP responsive`);
            appendObservabilityLog('slow_loop', {
              loop: name,
              elapsedMs: elapsed,
              warnAfterMs,
              nextDelayMs: Math.max(currentDelayMs, resolveLoopMs(opts.backoffMs ?? currentDelayMs)),
            });
            loopWarnedAt.set(name, Date.now());
          }
        }
        const nextDelay = slow ? Math.max(currentDelayMs, resolveLoopMs(opts.backoffMs ?? currentDelayMs)) : currentDelayMs;
        schedule(nextDelay);
      })();
    }, ms);
    timers.add(timer);
  };
  schedule(resolveLoopMs(delayMs));
}

/**
 * Release the port and other resources on exit so we never orphan a listener
 * that blocks the next start. tsx watch sends SIGTERM on reload, so this also
 * makes hot-reload clean. Idempotent.
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal} — shutting down host-server…`);
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  try {
    await fastify.close(); // drains SSE clients and frees the port
  } catch (err) {
    console.error('Error closing Fastify:', err);
  }
  try {
    db.close();
  } catch {
    /* db may already be closed */
  }
  process.exit(0);
}

process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

await listenWithRetry();

refreshAgentContextCache(readConductorConf());
startManagedLoop('context refresh', CONTEXT_REFRESH_MS, () => { refreshAgentContextCache(readConductorConf()); }, { warnAfterMs: 4000, backoffMs: 15_000 });
startManagedLoop('status poll', () => readConductorConf().statusPollMs, () => { timeSync('statusTicks', pollAndDiff); }, { warnAfterMs: LIVE_UPDATE_PERF_BUDGETS.maxStatusTickMs, backoffMs: 5000 });
startManagedLoop('tail poll', () => readConductorConf().terminalPollMs, () => { timeSync('terminalTicks', tailPollLoop); }, { warnAfterMs: LIVE_UPDATE_PERF_BUDGETS.maxTerminalTickMs, backoffMs: 5000 });
startManagedLoop('focused tail poll', () => readConductorConf().focusedTerminalPollMs, () => { timeSync('focusedTerminalTicks', tailPollLoopFocus); }, { warnAfterMs: LIVE_UPDATE_PERF_BUDGETS.maxFocusedTerminalTickMs, backoffMs: 1000 });
// TASK-119: liveUpdateMetrics resets to zero on every host-server restart —
// periodically snapshot the full object (plus event-loop metrics) to
// observability.jsonl so historical metrics survive a restart. Each line's
// top-level `ts` (added by appendObservabilityLog) plus the embedded
// `liveUpdateMetrics.startedAt` together let a consumer compute deltas
// between consecutive same-process snapshots and detect a restart (a
// `startedAt` change resets the cumulative counters and breaks the delta
// baseline) — see TASK-117/118, which calibrate perfBudgets.ts from this data.
startManagedLoop('metrics snapshot', () => readConductorConf().metricsSnapshotIntervalMs, () => { appendObservabilityLog('metrics_snapshot', { liveUpdateMetrics, eventLoop: readEventLoopMetrics() }); }, { warnAfterMs: 1000, backoffMs: 5000 });
startManagedLoop(
  'schedule poll',
  5000,
  () => {
    const now = Math.floor(Date.now() / 1000);
    for (const s of dueSchedules(db, now)) {
      const task = fireSchedule(db, s, now);
      if (task) {
        broadcastSSE('schedule-fired', { scheduleId: s.id, name: s.name, command: s.command });
        broadcastSSE('task-added', task);
      }
    }
  },
  { warnAfterMs: 1000, backoffMs: 5000 },
);
