// app/api/index.ts
// Fastify boot entrypoint for the app/api service.
//
// Mounts the better-auth web-standard handler at /api/auth/* via a Fastify catch-all.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { fromNodeHeaders } from 'better-auth/node';
import { env } from './env.ts';
import { auth } from './auth.ts';
import { runMigrations } from './migrate.ts';
import pairRoutes from './routes/pair.ts';
import devicesRoutes from './routes/devices.ts';
import { inviteCodesRoutes } from './routes/invite-codes.js';
import relayRoutes from './routes/relay.ts';

const app = Fastify({ logger: true });

// Raw-body parser for binary/relayed bodies. Without this, Fastify has no parser
// for application/octet-stream and req.body is left undefined, so relayed request
// bodies (image uploads, POST inserts forwarded via the mux) are silently dropped.
// Mirrors host-server/index.ts. The default JSON/text parsers remain in place for
// the /api/auth/* routes, and mux.ts handles Buffer | string | object bodies.
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body);
});

app.register(cors, {
  origin: process.env['CORS_ORIGIN'] ?? `http://localhost:${process.env['FRONTEND_PORT'] ?? '4321'}`,
  credentials: true,
});

// Rate-limiter registered with global:false so it only applies where a route
// opts in via config.rateLimit (e.g. the unauthenticated POST /api/pair/redeem).
app.register(rateLimit, { global: false });

app.register(pairRoutes);
app.register(devicesRoutes);

// GET /healthz — liveness only — DB readiness deferred to a future /readyz.
// Returns { ok: true } without touching the DB so health checks stay green
// even under DB latency. DB reachability is enforced at boot via runMigrations().
app.get('/healthz', async (_request, _reply) => {
  return { ok: true };
});

// /api/auth/* — better-auth catch-all. better-auth exposes a web-standard handler
// (auth.handler(request: Request): Promise<Response>), so we adapt the Fastify
// request to a Fetch API Request and stream the Response back onto the reply.
app.route({
  method: ['GET', 'POST'],
  url: '/api/auth/*',
  async handler(request, reply) {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = fromNodeHeaders(request.headers);
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });

      const response = await auth.handler(req);

      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body ? await response.text() : null);
    } catch (err) {
      app.log.error({ err }, 'better-auth handler error');
      return reply.status(500).send({ error: 'Internal authentication error', code: 'AUTH_FAILURE' });
    }
  },
});

app.register(inviteCodesRoutes);
app.register(relayRoutes);

async function start(): Promise<void> {
  // Run migrations first — this validates DB connectivity at boot.
  // A missing or unreachable DATABASE_URL surfaces a clear error and exits non-zero.
  try {
    await runMigrations();
  } catch (err) {
    console.error(
      '[app/api] failed to run migrations — is DATABASE_URL reachable?\n',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }

  await app.listen({ host: '0.0.0.0', port: env.API_PORT });
}

start();