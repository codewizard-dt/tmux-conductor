import { spawnSync, execSync } from 'child_process';
import { existsSync, unlinkSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync, appendFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Fastify, { type FastifyReply } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { readConductorConf, DEFAULT_CONF_PATH, appendBgProcessToConf, removeBgProcessFromConf, removeBgLink, addBgLink, clearConfCache } from './config.ts';
import { openDb, getDbPath, listAgents, createAgent, deleteAgent, addTask, deleteTask, reorderTasks, jumpTaskToHead, listTasksForAgent, listProjects, createProject, updateProject, deleteProject, nextAgentName, listSchedules, createSchedule, updateSchedule, deleteSchedule, dueSchedules, fireSchedule } from './db.ts';
import { detectAgentStatus, detectAgentMode, isTmuxWindowPresent, getActiveTask, capturePaneTail, capturePaneTailRaw, sendTextToPane, type AgentMode } from './state.ts';
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
  agent: { name: string; workdir: string; launchCmd: string },
  conf: ReturnType<typeof readConductorConf>,
): void {
  const { sessionName, stateDir, logDir } = conf;
  execSync(`tmux new-window -t ${sessionName} -n ${agent.name} -c ${agent.workdir}`);
  execSync(
    `tmux send-keys -t ${sessionName}:${agent.name} ` +
    `"CONDUCTOR_AGENT_NAME='${agent.name}' CONDUCTOR_STATE_DIR='${stateDir}' CONDUCTOR_LOG_DIR='${logDir}' ${agent.launchCmd}" Enter`,
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
      const windowPresent = isTmuxWindowPresent(sessionName, agent.name);
      // One capture-pane per agent, shared by status (last 5 lines) and mode
      // (full 15) detection.
      const tail15 = windowPresent ? capturePaneTail(sessionName, agent.name, 15) : '';
      const state = detectAgentStatus(conf, agent.name, tail15 || undefined);
      const isBusy = state === 'busy' || state === 'awaiting' || state === 'stalled';
      const ctx = getAgentContext(agent.name, agent.workdir, conf.stateDir, conf.contextWindow, isBusy);
      return {
        name: agent.name,
        state,
        mode: windowPresent ? detectAgentMode(conf, agent.name, tail15) : 'unknown',
        windowPresent,
        queuedTasks: listTasksForAgent(db, agent.name).length,
        launchCmd: agent.launchCmd,
        workdir: agent.workdir,
        linkedBg: agentBgLinks[agent.name] ?? null,
        activeTask: getActiveTask(conf, agent.name, state),
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

  api.get<{ Params: { agent: string } }>('/queue/:agent', async (req, reply) => {
    const { agent } = req.params;
    const tasks = listTasksForAgent(db, agent);
    reply.send({ agent, tasks });
  });

  // ── Task Queue CRUD (DB-backed /api/tasks) ───────────────────────────────

  api.post<{ Body: { command?: unknown; agentName?: unknown; projectId?: unknown; placement?: unknown } }>('/tasks', async (req, reply) => {
    const { command, agentName, projectId, placement } = req.body;

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
    if (agentName !== undefined) {
      if (typeof agentName !== 'string') {
        return reply.status(400).send({ error: 'agentName must be a string' });
      }
      const agents = listAgents(db);
      const found = agents.find((a) => a.name === agentName);
      if (!found) {
        return reply.status(404).send({ error: `agent '${agentName}' not found` });
      }
      agentId = found.id;
    }

    // Fast-path: agent is idle and has no pending DB tasks — dispatch immediately.
    if (
      typeof agentName === 'string' &&
      detectAgentStatus(readConductorConf(), agentName) === 'idle' &&
      listTasksForAgent(db, agentName).length === 0
    ) {
      const conf = readConductorConf();
      const cmdText = command.trim();
      writeFileSync(
        `${conf.stateDir}/${agentName}.state`,
        'busy\n',
        'utf8',
      );
      const paneTail = capturePaneTail(conf.sessionName, agentName, 5);
      const dispatchRecord = {
        ts: new Date().toISOString(),
        agent: agentName,
        command: cmdText,
        state: 'idle',
        state_age_s: 0,
        detection: 'immediate-enqueue',
        queue: 'none',
        queue_remaining: 0,
        pane_tail: paneTail,
      };
      appendFileSync(`${conf.logDir}/dispatch.jsonl`, JSON.stringify(dispatchRecord) + '\n', 'utf8');
      sendTextToPane(conf.sessionName, agentName, cmdText);
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
    spawnAgentWindow(newAgent, conf);

    return reply.status(201).send({ ok: true, agent: newAgent });
  });

  // Recreate the tmux window for an agent that already exists in the DB but
  // whose window has died. Unlike POST /agents this does not write to the DB.
  api.post<{ Params: { agent: string } }>('/agents/:agent/window', async (req, reply) => {
    const { agent: name } = req.params;
    const conf = readConductorConf();
    const { sessionName } = conf;

    const entry = listAgents(db).find((a) => a.name === name);
    if (!entry) {
      return reply.status(404).send({ error: `agent '${name}' not found` });
    }

    const sessionCheck = spawnSync('tmux', ['has-session', '-t', sessionName], { encoding: 'utf8' });
    if (sessionCheck.status !== 0) {
      return reply.status(409).send({ error: 'session not running', sessionAlive: false });
    }

    if (isTmuxWindowPresent(sessionName, name)) {
      return reply.status(409).send({ error: 'window already exists' });
    }

    spawnAgentWindow(entry, conf);

    return reply.status(201).send({ ok: true, agent: { name, workdir: entry.workdir, launchCmd: entry.launchCmd } });
  });

  // Switch the agent's Claude Code permission mode by pressing shift+tab
  // (tmux key BTab) until the requested mode's footer appears in capture-pane
  // output. 409 if a full cycle returns to the starting mode without ever
  // showing the target (e.g. acceptEdits is unreachable when the agent was
  // launched with --dangerously-skip-permissions).
  api.post<{ Params: { agent: string }; Body: { mode?: string } }>('/agents/:agent/mode', async (req, reply) => {
    const { agent: name } = req.params;
    const target = req.body.mode;
    if (typeof target !== 'string' || !(VALID_MODES as readonly string[]).includes(target)) {
      return reply.status(400).send({ error: `mode must be one of ${VALID_MODES.join('|')}` });
    }

    const conf = readConductorConf();
    const { sessionName } = conf;

    const entry = listAgents(db).find((a) => a.name === name);
    if (!entry) {
      return reply.status(404).send({ error: `agent '${name}' not found` });
    }
    if (!isTmuxWindowPresent(sessionName, name)) {
      return reply.status(409).send({ error: 'agent window not present' });
    }
    if (modeSwitchInFlight.has(name)) {
      return reply.status(409).send({ error: 'mode switch already in progress for this agent' });
    }

    modeSwitchInFlight.add(name);
    try {
      const origin = detectAgentMode(conf, name);
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
        spawnSync('tmux', ['send-keys', '-t', `${sessionName}:${name}`, 'BTab'], { encoding: 'utf8' });
        await sleep(SETTLE_MS);

        // The footer can be mid-redraw right after a press — re-detect briefly.
        let current = detectAgentMode(conf, name);
        for (let retry = 0; retry < 2 && current === 'unknown'; retry++) {
          await sleep(SETTLE_MS);
          current = detectAgentMode(conf, name);
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
      modeSwitchInFlight.delete(name);
    }
  });

  // Close an agent's tmux window without removing the agent — the inverse of
  // POST /agents/:agent/window. conductor.conf and queued tasks are untouched;
  // the state file is removed so a later window recreate starts clean. The
  // agent shows as 'no-window' until recreated.
  api.delete<{ Params: { agent: string } }>('/agents/:agent/window', (req, reply) => {
    const { agent: name } = req.params;
    const conf = readConductorConf();
    const { sessionName, stateDir } = conf;

    const entry = listAgents(db).find((a) => a.name === name);
    if (!entry) {
      return reply.status(404).send({ error: `agent '${name}' not found` });
    }
    if (!isTmuxWindowPresent(sessionName, name)) {
      return reply.status(409).send({ error: 'agent window not present' });
    }

    const r = spawnSync('tmux', ['kill-window', '-t', `${sessionName}:${name}`], { encoding: 'utf8' });
    if (r.status !== 0) {
      return reply.status(500).send({ error: 'tmux kill-window failed', stderr: r.stderr });
    }
    try { unlinkSync(path.join(stateDir, `${name}.state`)); } catch { /* no state file — fine */ }

    return reply.send({ ok: true, closed: name });
  });

  // Send keystrokes or literal text directly to an agent's tmux pane,
  // bypassing the task queue — used by the dashboard's Interact mode and
  // direct-send field to answer dialogs (AskUserQuestion, plan approval) or
  // unstick a stalled agent. keys = whitelisted tmux key names; text = literal
  // single-line string; enter appends a separate Enter press (dispatch.sh
  // convention). Same trust model as /mode and /queue: localhost bind, no auth.
  api.post<{ Params: { agent: string }; Body: { keys?: unknown; text?: unknown; enter?: unknown } }>('/agents/:agent/keys', async (req, reply) => {
    const { agent: name } = req.params;
    const { keys, text, enter } = req.body;

    const conf = readConductorConf();
    const { sessionName } = conf;

    const entry = listAgents(db).find((a) => a.name === name);
    if (!entry) {
      return reply.status(404).send({ error: `agent '${name}' not found` });
    }
    if (!isTmuxWindowPresent(sessionName, name)) {
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
      if (typeof text !== 'string' || text.length < 1 || text.length > MAX_TEXT) {
        return reply.status(400).send({ error: `text must be a string of 1–${String(MAX_TEXT)} characters` });
      }
      if (/[\x00-\x1f\x7f]/.test(text)) {
        return reply.status(400).send({ error: 'text must be a single line without control characters; use enter:true to submit' });
      }
      textStr = text;
    }
    if (enter !== undefined && typeof enter !== 'boolean') {
      return reply.status(400).send({ error: 'enter must be a boolean' });
    }

    const target = `${sessionName}:${name}`;
    const sends: string[][] = [];
    if (keyList) sends.push(['send-keys', '-t', target, ...keyList]);
    // `--` ends option parsing so text beginning with '-' is never read as a
    // flag; the literal send and the Enter press are separate invocations,
    // exactly like scripts/dispatch.sh.
    if (textStr !== undefined) sends.push(['send-keys', '-t', target, '-l', '--', textStr]);
    if (enter === true) sends.push(['send-keys', '-t', target, 'Enter']);

    for (const args of sends) {
      const r = spawnSync('tmux', args, { encoding: 'utf8' });
      if (r.status !== 0) {
        return reply.status(409).send({ error: 'tmux send-keys failed', stderr: r.stderr });
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
  api.post<{ Params: { agent: string }; Querystring: { filename?: string; type?: string } }>(
    '/agents/:agent/upload',
    { bodyLimit: UPLOAD_MAX_BYTES },
    async (req, reply) => {
      const { agent: name } = req.params;
      const { filename, type } = req.query;

      const conf = readConductorConf();
      const { sessionName } = conf;

      const entry = listAgents(db).find((a) => a.name === name);
      if (!entry) {
        return reply.status(404).send({ error: `agent '${name}' not found` });
      }
      if (!isTmuxWindowPresent(sessionName, name)) {
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

      const r = spawnSync('tmux', ['send-keys', '-t', `${sessionName}:${name}`, '-l', '--', `${filePath} `], { encoding: 'utf8' });
      if (r.status !== 0) {
        return reply.status(409).send({ error: 'tmux send-keys failed', stderr: r.stderr });
      }

      return reply.send({ ok: true, path: filePath });
    },
  );

  // Remove an agent entirely: kill its tmux window (if alive), delete its entry
  // from conductor.conf, drop its scoped queue lines, and remove its state file.
  // Global (unscoped) queue lines are left untouched.
  api.delete<{ Params: { agent: string } }>('/agents/:agent', async (req, reply) => {
    const { agent: name } = req.params;
    const conf = readConductorConf();
    const { sessionName, stateDir } = conf;

    const agents = listAgents(db);
    const entry = agents.find((a) => a.name === name);
    if (!entry) {
      return reply.status(404).send({ error: `agent '${name}' not found` });
    }

    if (isTmuxWindowPresent(sessionName, name)) {
      execSync(`tmux kill-window -t ${sessionName}:${name}`);
    }

    deleteAgent(db, entry.id);

    try { unlinkSync(path.join(stateDir, `${name}.state`)); } catch { /* no state file — fine */ }

    return reply.send({ ok: true, removed: name });
  });

  // Read-only tail of an agent's tmux pane output (including scrollback), so
  // the dashboard can show what the agent is printing.
  api.get<{ Params: { agent: string }; Querystring: { lines?: string } }>('/agents/:agent/tail', (req, reply) => {
    const { agent: name } = req.params;
    const conf = readConductorConf();
    const entry = listAgents(db).find((a) => a.name === name);
    if (!entry) {
      return reply.status(404).send({ error: `agent '${name}' not found` });
    }

    const parsed = parseInt(req.query.lines ?? '', 10);
    const lines = Number.isNaN(parsed) ? 20 : Math.min(500, Math.max(1, parsed));

    if (!isTmuxWindowPresent(conf.sessionName, name)) {
      return reply.send({ agent: name, lines, windowPresent: false, text: '' });
    }

    const text = capturePaneTailRaw(conf.sessionName, name, lines);
    return reply.send({ agent: name, lines, windowPresent: true, text });
  });

  // Focus registration: modal/detail views POST on open, DELETE on close.
  // The fast tail-poll loop (200 ms) only runs for focused agents; the slow
  // loop (2 s) skips them, so overall capture-pane load stays constant.
  api.post<{ Params: { agent: string } }>('/agents/:agent/focus', (req, reply) => {
    const { agent: name } = req.params;
    focusedAgents.add(name);
    prevTailMapFocus.delete(name); // force immediate push on first fast tick
    return reply.status(204).send();
  });

  api.delete<{ Params: { agent: string } }>('/agents/:agent/focus', (req, reply) => {
    const { agent: name } = req.params;
    focusedAgents.delete(name);
    prevTailMapFocus.delete(name);
    return reply.status(204).send();
  });

  api.get<{ Params: { agent: string } }>('/agents/:agent/skills', async (req, reply) => {
    const { agent: name } = req.params;
    const entry = listAgents(db).find((a) => a.name === name);
    if (!entry) {
      return reply.status(404).send({ error: `agent '${name}' not found` });
    }
    const project = getProjectSkills(entry.workdir);
    const user = getUserSkills();
    return reply.send({ agent: name, workdir: entry.workdir, project, user });
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
    spawnAgentWindow(newAgent, conf);

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
  agents: Array<{ name: string; state: string; mode: AgentMode; windowPresent: boolean; queuedTasks: number; launchCmd: string; workdir: string; activeTask: string | null } & AgentContext>;
  bgProcesses: BgStatus[];
}

let prevSnapshot: Snapshot | null = null;
const prevTailMap = new Map<string, string>();
const prevTailMapFocus = new Map<string, string>();
const focusedAgents = new Set<string>();

function buildSnapshot(): Snapshot {
  const conf = readConductorConf();
  const { sessionName } = conf;
  const agents = listAgents(db);
  const sessionExists = tmuxSessionExists(sessionName);
  const sessionAlive = sessionExists && isTmuxWindowPresent(sessionName, 'monitor');
  const agentStatuses = agents.map((agent) => {
    const windowPresent = isTmuxWindowPresent(sessionName, agent.name);
    // One capture-pane per agent per tick, shared by status and mode detection.
    const tail15 = windowPresent ? capturePaneTail(sessionName, agent.name, 15) : '';
    const state = detectAgentStatus(conf, agent.name, tail15 || undefined);
    const isBusy = state === 'busy' || state === 'awaiting' || state === 'stalled';
    const ctx = getAgentContext(agent.name, agent.workdir, conf.stateDir, conf.contextWindow, isBusy);
    return {
      name: agent.name,
      state,
      mode: windowPresent ? detectAgentMode(conf, agent.name, tail15) : 'unknown',
      windowPresent,
      queuedTasks: listTasksForAgent(db, agent.name).length,
      launchCmd: agent.launchCmd,
      workdir: agent.workdir,
      activeTask: getActiveTask(conf, agent.name, state),
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
    const prev = prevSnapshot.agents.find((a) => a.name === agent.name);
    if (
      !prev ||
      prev.state !== agent.state ||
      prev.mode !== agent.mode ||
      prev.queuedTasks !== agent.queuedTasks ||
      prev.windowPresent !== agent.windowPresent ||
      prev.activeTask !== agent.activeTask ||
      prev.modelId !== agent.modelId ||
      prev.contextPct !== agent.contextPct
    ) {
      broadcastSSE('agent-update', {
        name: agent.name,
        state: agent.state,
        mode: agent.mode,
        queuedTasks: agent.queuedTasks,
        windowPresent: agent.windowPresent,
        launchCmd: agent.launchCmd,
        workdir: agent.workdir,
        activeTask: agent.activeTask,
        model: agent.model,
        modelId: agent.modelId,
        contextTokens: agent.contextTokens,
        contextPct: agent.contextPct,
        contextLimit: agent.contextLimit,
      });
    }
  }

  for (const prev of prevSnapshot.agents) {
    if (!current.agents.some((a) => a.name === prev.name)) {
      broadcastSSE('agent-removed', { name: prev.name });
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
      (a) => !focusedAgents.has(a.name) && isTmuxWindowPresent(conf.sessionName, a.name),
    );
    for (const a of agents) {
      const text = capturePaneTailRaw(conf.sessionName, a.name, TAIL_LINES);
      if (prevTailMap.get(a.name) !== text) {
        broadcastSSE('terminal-output', { agent: a.name, text, lines: TAIL_LINES });
        prevTailMap.set(a.name, text);
      }
    }
  } catch { /* tail poll is best-effort */ }
}

function tailPollLoopFocus() {
  if (focusedAgents.size === 0) return;
  try {
    const conf = readConductorConf();
    const agents = listAgents(db).filter(
      (a) => focusedAgents.has(a.name) && isTmuxWindowPresent(conf.sessionName, a.name),
    );
    for (const a of agents) {
      const text = capturePaneTailRaw(conf.sessionName, a.name, TAIL_LINES);
      if (prevTailMapFocus.get(a.name) !== text) {
        broadcastSSE('terminal-output-focus', { agent: a.name, text, lines: TAIL_LINES });
        prevTailMapFocus.set(a.name, text);
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

try {
  const host = process.env['HOST'] ?? '127.0.0.1';
  await fastify.listen({ port, host });
  console.log(`Dashboard server listening on http://${host}:${String(port)}`);

  const pollInterval = setInterval(pollAndDiff, 2000);

  setInterval(tailPollLoop, TAIL_POLL_MS);
  setInterval(tailPollLoopFocus, TAIL_POLL_FOCUS_MS);

  const schedulerInterval = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const s of dueSchedules(db, now)) {
      const task = fireSchedule(db, s, now);
      if (task) {
        broadcastSSE('schedule-fired', { scheduleId: s.id, name: s.name, command: s.command });
        broadcastSSE('task-added', task);
      }
    }
  }, 5000);

  process.on('SIGTERM', () => { clearInterval(pollInterval); clearInterval(schedulerInterval); });
} catch (err) {
  console.error('Failed to start dashboard server:', err);
  process.exit(1);
}
