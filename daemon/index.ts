import * as path from 'path';
import * as fs from 'fs';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import { DATA_DIR, ensureDataDir, reconcileRegistry, addSession, removeSession, listSessions } from './registry.ts';
import { startSession, stopSession, isTmuxSessionAlive } from './launch.ts';

export const SOCKET_PATH = path.join(DATA_DIR, 'daemon.sock');

ensureDataDir();

if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);

reconcileRegistry();

const fastify = Fastify({ logger: false });
await fastify.register(fastifyCors, { origin: '*' });

fastify.get('/sessions', async (_req, reply) => {
  const sessions = listSessions().map(e => ({
    ...e,
    alive: isTmuxSessionAlive(e.sessionName),
  }));
  reply.send({ sessions });
});

fastify.post<{ Body: { repoPath?: string } }>('/sessions', async (req, reply) => {
  const { repoPath } = req.body;
  if (!repoPath || !path.isAbsolute(repoPath)) {
    return reply.status(400).send({ error: 'repoPath is required and must be absolute' });
  }
  if (!fs.existsSync(path.join(repoPath, 'conductor.conf'))) {
    return reply.status(400).send({ error: 'conductor.conf not found in repoPath' });
  }

  const result = await startSession(repoPath);

  if (result.status === 'started') {
    addSession({ sessionName: result.sessionName, repoPath, startedAt: new Date().toISOString() });
  }

  reply.send({
    sessionName: result.sessionName,
    status: result.status,
    attachCmd: `tmux attach-session -t ${result.sessionName}`,
  });
});

fastify.delete<{ Params: { sessionName: string } }>('/sessions/:sessionName', async (req, reply) => {
  const { sessionName } = req.params;
  const sessions = listSessions();
  const entry = sessions.find(e => e.sessionName === sessionName);
  if (!entry) return reply.status(404).send({ error: 'session not found in registry' });

  stopSession(sessionName, entry.repoPath);
  removeSession(sessionName);
  reply.send({ ok: true });
});

fastify.get('/healthz', async (_req, reply) => reply.send({ ok: true }));

await fastify.listen({ path: SOCKET_PATH });
fs.chmodSync(SOCKET_PATH, 0o600);
console.log(`Daemon listening on ${SOCKET_PATH}`);
