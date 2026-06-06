import { spawnSync, execSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Fastify, { type FastifyReply } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { readConductorConf, appendAgentToConf, DEFAULT_CONF_PATH } from './config.ts';
import { readAgentState, countQueuedTasks, isTmuxWindowPresent, readQueue, writeQueue, getAgentLines } from './state.ts';
import dotenv from 'dotenv';


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
});

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

  api.get('/status', async (_req, reply) => {
    const conf = readConductorConf();
    const { sessionName, taskQueue, stateDir, agents } = conf;

    const sessionAlive = isTmuxWindowPresent(sessionName, 'monitor');

    const agentStatuses = agents.map((agent) => ({
      name: agent.name,
      state: readAgentState(stateDir, agent.name),
      windowPresent: isTmuxWindowPresent(sessionName, agent.name),
      queuedTasks: countQueuedTasks(taskQueue, agent.name),
    }));

    reply.send({
      session: sessionName,
      sessionAlive,
      agents: agentStatuses,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Task Queue CRUD ──────────────────────────────────────────────────────

  api.get<{ Params: { agent: string } }>('/queue/:agent', async (req, reply) => {
    const { agent } = req.params;
    const conf = readConductorConf();
    const lines = readQueue(conf.taskQueue);
    const { tasks } = getAgentLines(lines, agent);
    reply.send({ agent, tasks });
  });

  api.post<{ Params: { agent: string }; Body: { task?: string } }>('/queue/:agent', async (req, reply) => {
    const { agent } = req.params;
    const { task } = req.body;
    if (!task || typeof task !== 'string' || task.trim() === '') {
      return reply.status(400).send({ error: 'task is required and must be a non-empty string' });
    }
    const conf = readConductorConf();
    const lines = readQueue(conf.taskQueue);
    const newLine = `${agent}: ${task.trim()}`;
    lines.push(newLine);
    await writeQueue(conf.taskQueue, lines);
    reply.send({ ok: true, line: newLine });
  });

  api.put<{ Params: { agent: string }; Body: { order?: unknown } }>('/queue/:agent/reorder', async (req, reply) => {
    const { agent } = req.params;
    const { order } = req.body;
    const conf = readConductorConf();
    const lines = readQueue(conf.taskQueue);
    const { indices } = getAgentLines(lines, agent);

    if (
      !Array.isArray(order) ||
      order.length !== indices.length ||
      !order.every((i) => Number.isInteger(i) && i >= 0 && i < indices.length)
    ) {
      return reply.status(400).send({
        error: `order must be an array of ${String(indices.length)} valid indices (0–${String(indices.length - 1)})`,
      });
    }

    const agentLines: (string | undefined)[] = indices.map((gi) => lines[gi]);
    const reordered: (string | undefined)[] = (order as number[]).map((i) => agentLines[i]);
    for (let i = 0; i < indices.length; i++) {
      const r = reordered[i];
      const idx = indices[i];
      if (r !== undefined && idx !== undefined) {
        lines[idx] = r;
      }
    }
    await writeQueue(conf.taskQueue, lines);
    reply.send({ ok: true });
  });

  api.delete<{ Params: { agent: string; index: string } }>('/queue/:agent/:index', async (req, reply) => {
    const { agent } = req.params;
    const idx = parseInt(req.params.index, 10);
    const conf = readConductorConf();
    const lines = readQueue(conf.taskQueue);
    const { indices } = getAgentLines(lines, agent);

    if (isNaN(idx) || idx < 0 || idx >= indices.length) {
      return reply.status(404).send({ error: `index ${String(idx)} out of range (agent has ${String(indices.length)} tasks)` });
    }

    const globalIdx = indices[idx];
    if (globalIdx !== undefined) {
      lines.splice(globalIdx, 1);
    }
    await writeQueue(conf.taskQueue, lines);
    reply.send({ ok: true });
  });

  // ── Agent Management ──────────────────────────────────────────────────────

  api.post<{ Body: { name?: string; workdir?: string; launchCmd?: string } }>('/agents', async (req, reply) => {
    const {
      name,
      workdir,
      launchCmd = 'claude --dangerously-skip-permissions',
    } = req.body;

    if (!name || typeof name !== 'string' || !/^[a-z0-9_-]+$/.test(name)) {
      return reply.status(400).send({
        error: 'name is required and must match ^[a-z0-9_-]+$',
      });
    }

    if (!workdir || typeof workdir !== 'string' || !workdir.startsWith('/')) {
      return reply.status(400).send({
        error: 'workdir is required and must be an absolute path (starts with /)',
      });
    }

    const conf = readConductorConf();
    const { sessionName, stateDir } = conf;

    const sessionCheck = spawnSync('tmux', ['has-session', '-t', sessionName], {
      encoding: 'utf8',
    });
    if (sessionCheck.status !== 0) {
      return reply.status(409).send({ error: 'session not running', sessionAlive: false });
    }

    if (isTmuxWindowPresent(sessionName, name)) {
      return reply.status(409).send({ error: 'window already exists' });
    }

    await appendAgentToConf(DEFAULT_CONF_PATH, name, workdir, launchCmd);

    execSync(`tmux new-window -t ${sessionName} -n ${name} -c ${workdir}`);
    execSync(
      `tmux send-keys -t ${sessionName}:${name} ` +
      `"CONDUCTOR_AGENT_NAME='${name}' CONDUCTOR_STATE_DIR='${stateDir}' ${launchCmd}" Enter`,
    );

    return reply.status(201).send({ ok: true, agent: { name, workdir, launchCmd } });
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
  agents: Array<{ name: string; state: string; windowPresent: boolean; queuedTasks: number }>;
}

let prevSnapshot: Snapshot | null = null;

function buildSnapshot() {
  const conf = readConductorConf();
  const { sessionName, taskQueue, stateDir, agents } = conf;
  // console.log(conf);
  const sessionAlive = isTmuxWindowPresent(sessionName, 'monitor');
  const agentStatuses = agents.map((agent) => ({
    name: agent.name,
    state: readAgentState(stateDir, agent.name),
    windowPresent: isTmuxWindowPresent(sessionName, agent.name),
    queuedTasks: countQueuedTasks(taskQueue, agent.name),
  }));
  return { sessionAlive, agents: agentStatuses };
}

function pollAndDiff() {
  let current;
  try { current = buildSnapshot(); } catch { return; }

  if (prevSnapshot === null) {
    prevSnapshot = current;
    return;
  }

  if (current.sessionAlive !== prevSnapshot.sessionAlive) {
    broadcastSSE('session-update', { sessionAlive: current.sessionAlive });
  }

  for (const agent of current.agents) {
    const prev = prevSnapshot.agents.find((a) => a.name === agent.name);
    if (
      !prev ||
      prev.state !== agent.state ||
      prev.queuedTasks !== agent.queuedTasks ||
      prev.windowPresent !== agent.windowPresent
    ) {
      broadcastSSE('agent-update', {
        name: agent.name,
        state: agent.state,
        queuedTasks: agent.queuedTasks,
        windowPresent: agent.windowPresent,
      });
    }
  }

  prevSnapshot = current;
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
  process.on('SIGTERM', () => { clearInterval(pollInterval); });
} catch (err) {
  console.error('Failed to start dashboard server:', err);
  process.exit(1);
}
