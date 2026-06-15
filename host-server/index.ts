import { spawnSync, execSync } from 'child_process';
import { existsSync, unlinkSync, renameSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync, appendFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Fastify, { type FastifyReply } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { readConductorConf, DEFAULT_CONF_PATH, appendBgProcessToConf, removeBgProcessFromConf, removeBgLink, addBgLink, clearConfCache } from './config.ts';
import { openDb, getDbPath, listAgents, getAgentById, createAgent, deleteAgent, updateAgentName, agentWindowName, addTask, deleteTask, reorderTasks, jumpTaskToHead, listTasksForAgentId, listTasksByProject, listProjects, createProject, updateProject, deleteProject, nextAgentName, listSchedules, createSchedule, updateSchedule, deleteSchedule, dueSchedules, fireSchedule } from './db.ts';
import { detectAgentStatus, detectAgentMode, isTmuxWindowPresent, windowState, getActiveTask, capturePaneTail, capturePaneTailRaw, sendTextToPane, extractPaneLabel, type AgentMode } from './state.ts';
import { getAgentContext, type AgentContext } from './context.ts';
import dotenv from 'dotenv';
import { getUserSkills, getPluginSkills, getProjectSkills } from './skills.ts';


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

const fastify = Fastify({ logger: false });


const corsOrigin = process.env['CORS_ORIGIN'] || '*';

await fastify.register(fastifyCors, {
  origin: corsOrigin,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
});

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
const TMUX_KEY_RE = /^(Enter|Escape|Tab|BTab|Space|BSpace|DC|IC|Up|Down|Left|Right|Home|End|PPage|NPage|F([1-9]|1[0-2])|C-[a-z]|M-[A-Za-z])$/;
const MAX_KEYS = 32;
const MAX_TEXT = 10_000;
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
  return spawnSync('tmux', ['has-session', '-t', sessionName], { encoding: 'utf8' }).status === 0;
}

// Recreate the monitor window inside an existing session, mirroring
// conductor.sh. No-op when the window is already there. Returns true if the
// window is present (or was just created), false if creation failed.
function healMonitorWindow(sessionName: string): boolean {
  if (isTmuxWindowPresent(sessionName, 'monitor')) return true;
  const monitorScript = path.join(REPO_ROOT, 'scripts', 'monitor.sh');
  const created = spawnSync('tmux', ['new-window', '-t', sessionName, '-n', 'monitor', '-c', REPO_ROOT], { encoding: 'utf8' });
  if (created.status !== 0) return false;
  spawnSync('tmux', ['send-keys', '-t', `${sessionName}:monitor`, monitorScript, 'Enter'], { encoding: 'utf8' });
  return true;
}

let sessionStartInFlight = false;
let lastMonitorHealAttempt = 0;
const MONITOR_HEAL_COOLDOWN_MS = 30_000;
const TAIL_POLL_MS = 2000;
const TAIL_POLL_FOCUS_MS = 200;
const TAIL_LINES = 100;

// ── Background-process status (shared by /status and the poll loop) ──────────

interface BgStatus {
  name: string;
  workdir: string;
  launchCmd: string;
  windowPresent: boolean;
  state: string | null;
  logPath: string;
  statePath: string;
  linkedAgent: string | null;
}

function buildBgStatuses(conf: ReturnType<typeof readConductorConf>): BgStatus[] {
  const { sessionName, stateDir, logDir, bgProcesses, agentBgLinks } = conf;
  return bgProcesses.map((bg) => {
    const linkedAgent = Object.entries(agentBgLinks).find(([, v]) => v === bg.name)?.[0] ?? null;
    const statePath = path.join(stateDir, `bg-${bg.name}.state`);
    let bgState: string | null = null;
    try { bgState = readFileSync(statePath, 'utf8').trim(); } catch { /* not written yet */ }
    return {
      name: bg.name,
      workdir: bg.workdir,
      launchCmd: bg.launchCmd,
      windowPresent: isTmuxWindowPresent(sessionName, bg.name),
      state: bgState,
      logPath: path.join(logDir, `bg-${bg.name}.log`),
      statePath,
      linkedAgent,
    };
  });
}

// ── Shared tmux helpers ───────────────────────────────────────────────────────

function spawnAgentWindow(
  agent: { name: string; workdir: string; launchCmd: string; projectName?: string | null },
  conf: ReturnType<typeof readConductorConf>,
): void {
  const { sessionName, stateDir, logDir } = conf;
  const winName = agent.projectName ? `${agent.projectName}-${agent.name}` : agent.name;
  execSync(`tmux new-window -t ${sessionName} -n ${winName} -c ${agent.workdir}`);
  execSync(
    `tmux send-keys -t ${sessionName}:${winName} ` +
    `"CONDUCTOR_AGENT_NAME='${winName}' CONDUCTOR_STATE_DIR='${stateDir}' CONDUCTOR_LOG_DIR='${logDir}' ${agent.launchCmd}" Enter`,
  );
}

// ── SSE state (shared between the /api plugin and the poll loop) ─────────────

const sseClients = new Set<FastifyReply>();

function broadcastSSE(eventName: string, data: unknown): void {
  const msg = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const reply of sseClients) {
    try { reply.raw.write(msg); } catch { sseClients.delete(reply); }
  }
}

function sendSSE(reply: FastifyReply, eventName: string, data: unknown): void {
  try { reply.raw.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* ignore */ }
}

// ── API routes (/api prefix) ─────────────────────────────────────────────────

await fastify.register((api) => {

  api.get('/healthz', async (_req, reply) => {
    reply.send({ ok: true });
  });

  api.get('/skills', async (_req, reply) => {
    reply.send({ user: getUserSkills(), plugin: getPluginSkills() });
  });

  api.get('/status', async (_req, reply) => {
    const conf = readConductorConf();
    const { sessionName, agentBgLinks } = conf;
    const agents = listAgents(db);

    const sessionExists = tmuxSessionExists(sessionName);
    const sessionAlive = sessionExists && isTmuxWindowPresent(sessionName, 'monitor');

    const agentStatuses = agents.map((agent) => {
      // Project-scoped agents live in a `${project}-${name}` window, and their
      // hooks write the state file under that same window name — so every tmux
      // and state lookup must key off the window name, not the short agent name.
      const win = agentWindowName(agent);
      const windowPresent = isTmuxWindowPresent(sessionName, win);
      // One capture-pane per agent, shared by status (last 5 lines) and mode
      // (full 15) detection.
      const tail15 = windowPresent ? capturePaneTail(sessionName, win, 15) : '';
      const state = detectAgentStatus(conf, win, agent.launchCmd, tail15 || undefined);
      const isBusy = state === 'busy' || state === 'awaiting' || state === 'stalled';
      const ctx = getAgentContext(win, agent.workdir, conf.stateDir, conf.contextWindow, isBusy, tail15 || undefined);
      return {
        id: agent.id,
        name: agent.name,
        projectId: agent.projectId,
        projectName: agent.projectName,
        state,
        mode: windowPresent ? detectAgentMode(conf, win, tail15) : 'unknown',
        windowPresent,
        queuedTasks: listTasksForAgentId(db, agent.id, agent.projectId).length,
        launchCmd: agent.launchCmd,
        workdir: agent.workdir,
        linkedBg: agentBgLinks[agent.name] ?? null,
        activeTask: getActiveTask(conf, win, state),
        ...ctx,
      };
    });

    const bgStatuses = buildBgStatuses(conf);

    reply.send({
      session: sessionName,
      sessionAlive,
      sessionExists,
      agents: agentStatuses,
      bgProcesses: bgStatuses,
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
        env: { ...process.env, CONDUCTOR_NO_ATTACH: '1' },
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
      if (!Number.isInteger(agentIdRaw)) {
        return reply.status(400).send({ error: 'agentId must be an integer' });
      }
      const found = getAgentById(db, agentIdRaw as number);
      if (!found) {
        return reply.status(404).send({ error: `agent ${String(agentIdRaw)} not found` });
      }
      agentId = found.id;
      foundAgent = found;
    }

    // Fast-path: agent is idle and has no pending DB tasks — dispatch immediately.
    // Key all tmux/state operations off the window name (project-scoped agents
    // live in a `${project}-${name}` window and the hooks write that state file).
    if (
      foundAgent !== undefined &&
      detectAgentStatus(readConductorConf(), agentWindowName(foundAgent), foundAgent.launchCmd) === 'idle' &&
      listTasksForAgentId(db, foundAgent.id, foundAgent.projectId).length === 0
    ) {
      const conf = readConductorConf();
      const win = agentWindowName(foundAgent);
      const cmdText = command.trim();
      writeFileSync(
        `${conf.stateDir}/${win}.state`,
        'busy\n',
        'utf8',
      );
      const paneTail = capturePaneTail(conf.sessionName, win, 5);
      const dispatchRecord = {
        ts: new Date().toISOString(),
        agent: win,
        command: cmdText,
        state: 'idle',
        state_age_s: 0,
        detection: 'immediate-enqueue',
        queue: 'none',
        queue_remaining: 0,
        pane_tail: paneTail,
      };
      appendFileSync(`${conf.logDir}/dispatch.jsonl`, JSON.stringify(dispatchRecord) + '\n', 'utf8');
      sendTextToPane(conf.sessionName, win, cmdText);
      broadcastSSE('snapshot', buildSnapshot());
      return reply.status(200).send({ ok: true, dispatched: true });
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

  // ── Agent Management ──────────────────────────────────────────────────────

  api.post<{ Body: { name?: string; workdir?: string; launchCmd?: string } }>('/agents', async (req, reply) => {
    const {
      name,
      workdir,
      launchCmd = 'claude --dangerously-skip-permissions',
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

    const conf = readConductorConf();
    const { sessionName } = conf;

    const sessionCheck = spawnSync('tmux', ['has-session', '-t', sessionName], {
      encoding: 'utf8',
    });
    if (sessionCheck.status !== 0) {
      return reply.status(409).send({ error: 'session not running', sessionAlive: false });
    }

    if (isTmuxWindowPresent(sessionName, name)) {
      return reply.status(409).send({ error: 'window already exists' });
    }

    const newAgent = createAgent(db, { name, workdir, launchCmd });
    const winName = agentWindowName(newAgent);
    spawnAgentWindow(newAgent, conf);

    // Immediately notify SSE clients — don't wait for the next poll tick.
    {
      const windowPresent = isTmuxWindowPresent(conf.sessionName, winName);
      const tail15 = windowPresent ? capturePaneTail(conf.sessionName, winName, 15) : '';
      const state = detectAgentStatus(conf, winName, launchCmd, tail15 || undefined);
      const isBusy = state === 'busy' || state === 'awaiting' || state === 'stalled';
      const ctx = getAgentContext(winName, workdir, conf.stateDir, conf.contextWindow, isBusy, tail15 || undefined);
      broadcastSSE('agent-update', {
        id: newAgent.id, name, projectId: newAgent.projectId, projectName: newAgent.projectName,
        state, mode: windowPresent ? detectAgentMode(conf, winName, tail15) : 'unknown',
        windowPresent, queuedTasks: 0, launchCmd, workdir, linkedBg: null, activeTask: null, ...ctx,
      });
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

    const sessionCheck = spawnSync('tmux', ['has-session', '-t', sessionName], { encoding: 'utf8' });
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
        spawnSync('tmux', ['kill-window', '-t', `${sessionName}:${winName}`], { encoding: 'utf8' });
        action = 'respawned';
      }
      spawnAgentWindow(entry, conf);
    } catch {
      return reply.status(500).send({ error: 'failed to spawn agent window' });
    }

    return reply.status(201).send({
      ok: true,
      action,
      agent: { name, workdir: entry.workdir, launchCmd: entry.launchCmd },
    });
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
    if (modeSwitchInFlight.has(wn)) {
      return reply.status(409).send({ error: 'mode switch already in progress for this agent' });
    }

    modeSwitchInFlight.add(wn);
    try {
      const origin = detectAgentMode(conf, wn);
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
        spawnSync('tmux', ['send-keys', '-t', `${sessionName}:${wn}`, 'BTab'], { encoding: 'utf8' });
        await sleep(SETTLE_MS);

        // The footer can be mid-redraw right after a press — re-detect briefly.
        let current = detectAgentMode(conf, wn);
        for (let retry = 0; retry < 2 && current === 'unknown'; retry++) {
          await sleep(SETTLE_MS);
          current = detectAgentMode(conf, wn);
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

    const r = spawnSync('tmux', ['kill-window', '-t', `${sessionName}:${winName}`], { encoding: 'utf8' });
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
  // single-line string; enter appends a separate Enter press (dispatch.sh
  // convention). Same trust model as /mode and /queue: localhost bind, no auth.
  api.post<{ Params: { id: string }; Body: { keys?: unknown; text?: unknown; enter?: unknown } }>('/agents/:id/keys', async (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const { keys, text, enter } = req.body;

    const conf = readConductorConf();
    const { sessionName } = conf;

    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    if (!isTmuxWindowPresent(sessionName, agentWindowName(entry))) {
      return reply.status(409).send({ error: 'agent window not present' });
    }

    const hasKeys = keys !== undefined;
    const hasText = text !== undefined;
    if (!hasKeys && !hasText && enter !== true) {
      return reply.status(400).send({ error: 'keys or text is required' });
    }
    if (hasKeys && hasText) {
      return reply.status(400).send({ error: 'provide keys or text, not both' });
    }
    let keyList: string[] | undefined;
    if (hasKeys) {
      if (!Array.isArray(keys) || keys.length < 1 || keys.length > MAX_KEYS) {
        return reply.status(400).send({ error: `keys must be an array of 1–${String(MAX_KEYS)} key names` });
      }
      const arr = keys as unknown[];
      const bad = arr.find((k) => typeof k !== 'string' || !TMUX_KEY_RE.test(k));
      if (bad !== undefined) {
        return reply.status(400).send({ error: `invalid key name: ${JSON.stringify(bad)}` });
      }
      keyList = arr as string[];
    }
    let textStr: string | undefined;
    if (hasText) {
      if (typeof text !== 'string') {
        return reply.status(400).send({ error: 'text must be a string' });
      }
      // Normalize CRLF/CR to LF so pasted, multi-line content sends as plain newlines.
      const normalized = text.replace(/\r\n?/g, '\n');
      if (normalized.length < 1 || normalized.length > MAX_TEXT) {
        return reply.status(400).send({ error: `text must be a string of 1–${String(MAX_TEXT)} characters` });
      }
      // Newlines and tabs are allowed — multi-line prompts and indented snippets
      // are first-class. Other control characters (NUL, ESC, …) are rejected
      // because they would inject raw terminal escape sequences, not literal text.
      if (/[\x00-\x08\x0b-\x1f\x7f]/.test(normalized)) {
        return reply.status(400).send({ error: 'text may not contain control characters other than newline and tab' });
      }
      textStr = normalized;
    }
    if (enter !== undefined && typeof enter !== 'boolean') {
      return reply.status(400).send({ error: 'enter must be a boolean' });
    }

    const target = `${sessionName}:${agentWindowName(entry)}`;
    const multiline = textStr !== undefined && textStr.includes('\n');
    const sends: string[][] = [];
    if (keyList) sends.push(['send-keys', '-t', target, ...keyList]);
    if (textStr !== undefined) {
      if (multiline) {
        // Multi-line text is delivered via tmux bracketed paste so the receiving
        // TUI (e.g. Claude Code) inserts the newlines into its prompt buffer
        // instead of treating each one as a submit. A per-agent named buffer
        // avoids clobbering unrelated paste activity; -p = bracketed paste,
        // -d = delete the buffer afterwards.
        const buf = `conductor-keys-${String(agentId)}`;
        sends.push(['set-buffer', '-b', buf, '--', textStr]);
        sends.push(['paste-buffer', '-t', target, '-b', buf, '-p', '-d']);
      } else {
        // `--` ends option parsing so text beginning with '-' is never read as a
        // flag; the literal send and the Enter press are separate invocations,
        // exactly like scripts/dispatch.sh.
        sends.push(['send-keys', '-t', target, '-l', '--', textStr]);
      }
    }
    if (enter === true) sends.push(['send-keys', '-t', target, 'Enter']);

    for (const args of sends) {
      // Let the TUI absorb a bracketed paste before the submit Enter, mirroring
      // scripts/dispatch.sh's pre-Enter settle delay.
      if (multiline && args[args.length - 1] === 'Enter') {
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
      }
      const r = spawnSync('tmux', args, { encoding: 'utf8' });
      if (r.status !== 0) {
        return reply.status(409).send({ error: 'tmux send failed', stderr: r.stderr });
      }
    }

    return reply.send({
      ok: true,
      sent: {
        keys: keyList?.length ?? 0,
        textChars: textStr?.length ?? 0,
        enter: enter === true,
      },
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
        const r = spawnSync('tmux', ['send-keys', '-t', `${sessionName}:${agentWindowName(entry)}`, '-l', '--', `${filePath} `], { encoding: 'utf8' });
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
      execSync(`tmux kill-window -t ${sessionName}:${winName}`);
    }

    deleteAgent(db, entry.id);

    try { unlinkSync(path.join(stateDir, `${winName}.state`)); } catch { /* no state file — fine */ }

    broadcastSSE('agent-removed', { id: entry.id, name });

    return reply.send({ ok: true, removed: name });
  });

  // Rename an agent: updates the DB, renames the tmux window and state file.
  api.patch<{ Params: { id: string }; Body: { name?: string } }>('/agents/:id', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const { name: newName } = req.body;

    if (typeof newName !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(newName)) {
      return reply.status(400).send({ error: 'name must match ^[a-zA-Z0-9_-]+$' });
    }

    const conf = readConductorConf();
    const { sessionName, stateDir } = conf;

    const agents = listAgents(db);
    const entry = agents.find((a) => a.id === agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    const oldName = entry.name;

    if (newName === oldName) {
      return reply.send({ ok: true, agent: entry });
    }

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

    const updated = updateAgentName(db, entry.id, newName);

    if (isTmuxWindowPresent(sessionName, oldWindowName)) {
      spawnSync('tmux', ['rename-window', '-t', `${sessionName}:${oldWindowName}`, newWindowName], { encoding: 'utf8' });
    }

    try { renameSync(path.join(stateDir, `${oldWindowName}.state`), path.join(stateDir, `${newWindowName}.state`)); } catch { /* no state file — fine */ }

    // focusedAgents / prevTailMap* are keyed by the stable agent id, so a rename
    // needs no juggling — the streams keep flowing under the same id.

    broadcastSSE('agent-renamed', { id: updated.id, oldName, newName });

    return reply.send({ ok: true, agent: updated });
  });

  // Read-only tail of an agent's tmux pane output (including scrollback), so
  // the dashboard can show what the agent is printing.
  api.get<{ Params: { id: string }; Querystring: { lines?: string } }>('/agents/:id/tail', (req, reply) => {
    const agentId = parseInt(req.params.id, 10);
    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
    const conf = readConductorConf();
    const entry = getAgentById(db, agentId);
    if (!entry) {
      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
    }
    const name = entry.name;

    const parsed = parseInt(req.query.lines ?? '', 10);
    const lines = Number.isNaN(parsed) ? 100 : Math.min(1000, Math.max(1, parsed));

    const winName = agentWindowName(entry);
    if (!isTmuxWindowPresent(conf.sessionName, winName)) {
      return reply.send({ agent: name, agentId, lines, windowPresent: false, text: '' });
    }

    const text = capturePaneTailRaw(conf.sessionName, winName, lines);
    return reply.send({ agent: name, agentId, lines, windowPresent: true, text });
  });

  // Focus registration: modal/detail views POST on open, DELETE on close.
  // The fast tail-poll loop (200 ms) only runs for focused agents; the slow
  // loop (2 s) skips them, so overall capture-pane load stays constant.
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

  // List all agents from the database.
  api.get('/agents', (_req, reply) => {
    return reply.send(listAgents(db));
  });

  // ── Background Process Management ────────────────────────────────────────

  api.post<{ Body: { name?: string; workdir?: string; launchCmd?: string; linkedAgent?: string } }>('/bg-processes', async (req, reply) => {
    const { name, workdir, launchCmd = '', linkedAgent } = req.body;

    if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return reply.status(400).send({ error: 'name is required and must match ^[a-zA-Z0-9_-]+$' });
    }
    if (!workdir || typeof workdir !== 'string' || !workdir.startsWith('/')) {
      return reply.status(400).send({ error: 'workdir is required and must be an absolute path (starts with /)' });
    }
    if (!launchCmd || typeof launchCmd !== 'string') {
      return reply.status(400).send({ error: 'launchCmd is required' });
    }

    const conf = readConductorConf();
    const { sessionName, logDir } = conf;

    const sessionCheck = spawnSync('tmux', ['has-session', '-t', sessionName], { encoding: 'utf8' });
    if (sessionCheck.status !== 0) {
      return reply.status(409).send({ error: 'session not running', sessionAlive: false });
    }
    if (isTmuxWindowPresent(sessionName, name)) {
      return reply.status(409).send({ error: 'window already exists' });
    }
    if (conf.bgProcesses.some((b) => b.name === name)) {
      return reply.status(409).send({ error: `bg process '${name}' already defined` });
    }
    if (linkedAgent !== undefined && typeof linkedAgent !== 'string') {
      return reply.status(400).send({ error: 'linkedAgent must be a string' });
    }

    // conductor.conf is authoritative for bg processes (what conductor.sh spawns
    // and teardown.sh kills) — write the definition there, not the DB.
    await appendBgProcessToConf(conf._confPath, name, workdir, launchCmd);
    if (linkedAgent) {
      await addBgLink(conf._confPath, linkedAgent, name);
    }
    clearConfCache();

    execSync(`tmux new-window -t ${sessionName} -n ${name} -c ${workdir}`);
    execSync(`tmux send-keys -t ${sessionName}:${name} "${launchCmd}" Enter`);
    execSync(`tmux pipe-pane -t ${sessionName}:${name} -o "cat >> '${logDir}/bg-${name}.log'"`);

    return reply.status(201).send({ ok: true, bg: { name, workdir, launchCmd, linkedAgent: linkedAgent ?? null } });
  });

  api.delete<{ Params: { name: string } }>('/bg-processes/:name', async (req, reply) => {
    const { name } = req.params;
    const conf = readConductorConf();
    const { sessionName, stateDir, agentBgLinks } = conf;

    const entry = conf.bgProcesses.find((b) => b.name === name);
    if (!entry) {
      return reply.status(404).send({ error: `bg process '${name}' not found` });
    }

    if (isTmuxWindowPresent(sessionName, name)) {
      execSync(`tmux kill-window -t ${sessionName}:${name}`);
    }

    // Remove the definition from conductor.conf (the authoritative source) plus
    // any owning agent link, so conductor.sh won't respawn it and the next poll
    // snapshot drops the row via the bg-removed SSE event.
    await removeBgProcessFromConf(conf._confPath, name);
    const owningAgent = Object.entries(agentBgLinks).find(([, v]) => v === name)?.[0];
    if (owningAgent) {
      await removeBgLink(conf._confPath, owningAgent);
    }
    clearConfCache();

    try { unlinkSync(path.join(stateDir, `bg-${name}.state`)); } catch { /* fine */ }

    return reply.send({ ok: true, removed: name });
  });

  // Recreate the tmux window for a bg process that already exists in conf but
  // whose window has died. Mirrors POST /agents/:agent/window — does not touch
  // conductor.conf. Re-attaches pipe-pane logging like conductor.sh does.
  api.post<{ Params: { name: string } }>('/bg-processes/:name/window', async (req, reply) => {
    const { name } = req.params;
    const conf = readConductorConf();
    const { sessionName, logDir } = conf;

    const entry = conf.bgProcesses.find((b) => b.name === name);
    if (!entry) {
      return reply.status(404).send({ error: `bg process '${name}' not found` });
    }

    if (!tmuxSessionExists(sessionName)) {
      return reply.status(409).send({ error: 'session not running', sessionAlive: false });
    }
    if (isTmuxWindowPresent(sessionName, name)) {
      return reply.status(409).send({ error: 'window already exists' });
    }

    execSync(`tmux new-window -t ${sessionName} -n ${name} -c ${entry.workdir}`);
    execSync(`tmux send-keys -t ${sessionName}:${name} "${entry.launchCmd}" Enter`);
    execSync(`tmux pipe-pane -t ${sessionName}:${name} -o "cat >> '${logDir}/bg-${name}.log'"`);

    return reply.status(201).send({ ok: true, bg: { name, workdir: entry.workdir, launchCmd: entry.launchCmd } });
  });

  // Close a bg process's tmux window without removing its registration — the
  // inverse of POST /bg-processes/:name/window, mirroring the agent variant
  // DELETE /agents/:agent/window. The state file is removed so a stale
  // alive/dead value doesn't linger until the next reopen.
  api.delete<{ Params: { name: string } }>('/bg-processes/:name/window', (req, reply) => {
    const { name } = req.params;
    const conf = readConductorConf();
    const { sessionName, stateDir } = conf;

    const entry = conf.bgProcesses.find((b) => b.name === name);
    if (!entry) {
      return reply.status(404).send({ error: `bg process '${name}' not found` });
    }
    if (!isTmuxWindowPresent(sessionName, name)) {
      return reply.status(409).send({ error: 'bg window not present' });
    }

    const r = spawnSync('tmux', ['kill-window', '-t', `${sessionName}:${name}`], { encoding: 'utf8' });
    if (r.status !== 0) {
      return reply.status(500).send({ error: 'tmux kill-window failed', stderr: r.stderr });
    }
    try { unlinkSync(path.join(stateDir, `bg-${name}.state`)); } catch { /* no state file — fine */ }

    return reply.send({ ok: true, closed: name });
  });

  // Resolve the nearest git root for a given path. Used by the frontend to
  // suggest correcting a workdir that is inside a repo but not at its root.
  api.get<{ Querystring: { path?: string } }>('/git-root', (req, reply) => {
    const p = req.query.path;
    if (!p || typeof p !== 'string' || !p.startsWith('/')) {
      return reply.status(400).send({ error: 'path query param is required and must be absolute' });
    }
    const r = spawnSync('git', ['-C', p, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
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

    try {
      deleteProject(db, id, force);
      return await reply.status(204).send();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(409).send({ error: msg });
    }
  });

  api.post<{ Params: { id: string }; Body: { name?: unknown } }>('/projects/:id/agents', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return reply.status(400).send({ error: 'invalid project id' });
    }

    const project = listProjects(db).find((p) => p.id === id);
    if (!project) {
      return reply.status(404).send({ error: `project ${String(id)} not found` });
    }

    const { name: nameOverride } = req.body;
    if (nameOverride !== undefined && (typeof nameOverride !== 'string' || !/^[A-Za-z0-9_-]+$/.test(nameOverride))) {
      return reply.status(400).send({ error: 'name must match ^[A-Za-z0-9_-]+$' });
    }

    const agentName = typeof nameOverride === 'string' ? nameOverride : nextAgentName(db, id);
    const newAgent = createAgent(db, {
      name: agentName,
      workdir: project.workdir,
      launchCmd: project.defaultLaunchCmd,
      projectId: id,
    });

    const conf = readConductorConf();
    const winName = agentWindowName(newAgent);
    spawnAgentWindow(newAgent, conf);

    // Immediately notify SSE clients — don't wait for the next poll tick.
    {
      const windowPresent = isTmuxWindowPresent(conf.sessionName, winName);
      const tail15 = windowPresent ? capturePaneTail(conf.sessionName, winName, 15) : '';
      const state = detectAgentStatus(conf, winName, project.defaultLaunchCmd, tail15 || undefined);
      const isBusy = state === 'busy' || state === 'awaiting' || state === 'stalled';
      const ctx = getAgentContext(winName, project.workdir, conf.stateDir, conf.contextWindow, isBusy, tail15 || undefined);
      broadcastSSE('agent-update', {
        id: newAgent.id, name: agentName, projectId: newAgent.projectId, projectName: newAgent.projectName,
        state, mode: windowPresent ? detectAgentMode(conf, winName, tail15) : 'unknown',
        windowPresent, queuedTasks: 0, launchCmd: project.defaultLaunchCmd, workdir: project.workdir,
        linkedBg: null, activeTask: null, ...ctx,
      });
    }

    return reply.status(201).send(newAgent);
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

    // Send the current full state to this client so reconnects and late-connecting
    // clients are immediately consistent without waiting for the next diff tick.
    if (prevSnapshot !== null) {
      sendSSE(reply, 'session-update', { sessionAlive: prevSnapshot.sessionAlive, sessionExists: prevSnapshot.sessionExists });
      for (const agent of prevSnapshot.agents) {
        sendSSE(reply, 'agent-update', {
          name: agent.name, state: agent.state, mode: agent.mode,
          queuedTasks: agent.queuedTasks, windowPresent: agent.windowPresent,
          launchCmd: agent.launchCmd, workdir: agent.workdir, activeTask: agent.activeTask,
          model: agent.model, modelId: agent.modelId,
          contextTokens: agent.contextTokens, contextPct: agent.contextPct, contextLimit: agent.contextLimit,
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
      sseClients.delete(reply);
    });

    // Keep connection open — never call reply.send()
  });

}, { prefix: '/api' });

// ── Poll-and-diff loop ────────────────────────────────────────────────────────

interface Snapshot {
  sessionAlive: boolean;
  sessionExists: boolean;
  agents: Array<{ id: number; name: string; projectId: number | null; projectName: string | null; state: string; mode: AgentMode; windowPresent: boolean; queuedTasks: number; launchCmd: string; workdir: string; activeTask: string | null; label: string | null } & AgentContext>;
  bgProcesses: BgStatus[];
}

let prevSnapshot: Snapshot | null = null;
// Keyed by the stable agent id (names are only unique per project, so name keys
// would conflate two same-named agents' tail streams / focus registrations).
const prevTailMap = new Map<number, string>();
const prevTailMapFocus = new Map<number, string>();
const focusedAgents = new Set<number>();
const agentLabelCache = new Map<number, string | null>();

function buildSnapshot(): Snapshot {
  const conf = readConductorConf();
  const { sessionName } = conf;
  const agents = listAgents(db);
  const sessionExists = tmuxSessionExists(sessionName);
  const sessionAlive = sessionExists && isTmuxWindowPresent(sessionName, 'monitor');
  const agentStatuses = agents.map((agent) => {
    const wn = agentWindowName(agent);
    const windowPresent = isTmuxWindowPresent(sessionName, wn);
    // One capture-pane per agent per tick, shared by status and mode detection.
    const tail15 = windowPresent ? capturePaneTail(sessionName, wn, 15) : '';
    const state = detectAgentStatus(conf, wn, agent.launchCmd, tail15 || undefined);
    const isBusy = state === 'busy' || state === 'awaiting' || state === 'stalled';
    const ctx = getAgentContext(wn, agent.workdir, conf.stateDir, conf.contextWindow, isBusy, tail15 || undefined);
    // Clear label when window is gone; re-seed whenever cache is null (covers server restart + no-window reopen).
    if (state === 'no-window') {
      agentLabelCache.set(agent.id, null);
    } else if (agentLabelCache.get(agent.id) == null && windowPresent) {
      const rawSeed = capturePaneTailRaw(sessionName, wn, TAIL_LINES);
      agentLabelCache.set(agent.id, extractPaneLabel(rawSeed));
    }
    const label = agentLabelCache.get(agent.id) ?? null;
    return {
      id: agent.id,
      name: agent.name,
      projectId: agent.projectId,
      projectName: agent.projectName,
      state,
      mode: windowPresent ? detectAgentMode(conf, wn, tail15) : 'unknown',
      windowPresent,
      queuedTasks: listTasksForAgentId(db, agent.id, agent.projectId).length,
      launchCmd: agent.launchCmd,
      workdir: agent.workdir,
      activeTask: getActiveTask(conf, wn, state),
      label,
      ...ctx,
    };
  });
  return { sessionAlive, sessionExists, agents: agentStatuses, bgProcesses: buildBgStatuses(conf) };
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

  for (const agent of current.agents) {
    const prev = prevSnapshot.agents.find((a) => a.id === agent.id);
    if (
      !prev ||
      prev.state !== agent.state ||
      prev.mode !== agent.mode ||
      prev.queuedTasks !== agent.queuedTasks ||
      prev.windowPresent !== agent.windowPresent ||
      prev.activeTask !== agent.activeTask ||
      prev.modelId !== agent.modelId ||
      prev.contextPct !== agent.contextPct ||
      prev.label !== agent.label
    ) {
      broadcastSSE('agent-update', {
        id: agent.id,
        name: agent.name,
        projectId: agent.projectId,
        projectName: agent.projectName,
        state: agent.state,
        mode: agent.mode,
        queuedTasks: agent.queuedTasks,
        windowPresent: agent.windowPresent,
        launchCmd: agent.launchCmd,
        workdir: agent.workdir,
        activeTask: agent.activeTask,
        label: agent.label,
        model: agent.model,
        modelId: agent.modelId,
        contextTokens: agent.contextTokens,
        contextPct: agent.contextPct,
        contextLimit: agent.contextLimit,
      });
    }
  }

  for (const prev of prevSnapshot.agents) {
    if (!current.agents.some((a) => a.id === prev.id)) {
      broadcastSSE('agent-removed', { id: prev.id, name: prev.name });
    }
  }

  for (const bg of current.bgProcesses) {
    const prev = prevSnapshot.bgProcesses.find((b) => b.name === bg.name);
    if (!prev || prev.windowPresent !== bg.windowPresent || prev.state !== bg.state || prev.linkedAgent !== bg.linkedAgent) {
      broadcastSSE('bg-update', bg);
    }
  }

  for (const prev of prevSnapshot.bgProcesses) {
    if (!current.bgProcesses.some((b) => b.name === prev.name)) {
      broadcastSSE('bg-removed', { name: prev.name });
    }
  }

  prevSnapshot = current;
}

function tailPollLoop() {
  try {
    const conf = readConductorConf();
    const agents = listAgents(db).filter(
      (a) => !focusedAgents.has(a.id) && isTmuxWindowPresent(conf.sessionName, agentWindowName(a)),
    );
    for (const a of agents) {
      const wn = agentWindowName(a);
      const text = capturePaneTailRaw(conf.sessionName, wn, TAIL_LINES);
      if (prevTailMap.get(a.id) !== text) {
        broadcastSSE('terminal-output', { agentId: a.id, agent: a.name, text, lines: TAIL_LINES });
        prevTailMap.set(a.id, text);
        const found = extractPaneLabel(text);
        if (found !== null) agentLabelCache.set(a.id, found);
      }
    }
  } catch { /* tail poll is best-effort */ }
}

function tailPollLoopFocus() {
  if (focusedAgents.size === 0) return;
  try {
    const conf = readConductorConf();
    const agents = listAgents(db).filter(
      (a) => focusedAgents.has(a.id) && isTmuxWindowPresent(conf.sessionName, agentWindowName(a)),
    );
    for (const a of agents) {
      const wn = agentWindowName(a);
      const text = capturePaneTailRaw(conf.sessionName, wn, TAIL_LINES);
      if (prevTailMapFocus.get(a.id) !== text) {
        broadcastSSE('terminal-output-focus', { agentId: a.id, agent: a.name, text, lines: TAIL_LINES });
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

const port = parseInt(process.env['PORT'] || '8788', 10);
const host = process.env['HOST'] ?? '127.0.0.1';

// Background interval handles — hoisted so gracefulShutdown can clear them.
const intervals: NodeJS.Timeout[] = [];

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
/**
 * Release the port and other resources on exit so we never orphan a listener
 * that blocks the next start. tsx watch sends SIGTERM on reload, so this also
 * makes hot-reload clean. Idempotent.
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal} — shutting down host-server…`);
  for (const i of intervals) clearInterval(i);
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

intervals.push(setInterval(pollAndDiff, 2000));
intervals.push(setInterval(tailPollLoop, TAIL_POLL_MS));
intervals.push(setInterval(tailPollLoopFocus, TAIL_POLL_FOCUS_MS));
intervals.push(
  setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const s of dueSchedules(db, now)) {
      const task = fireSchedule(db, s, now);
      if (task) {
        broadcastSSE('schedule-fired', { scheduleId: s.id, name: s.name, command: s.command });
        broadcastSSE('task-added', task);
      }
    }
  }, 5000),
);
