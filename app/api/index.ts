// app/api/index.ts
// Fastify boot entrypoint for the app/api service.
//
// Mounts the better-auth web-standard handler at /api/auth/* via a Fastify catch-all.

import Fastify from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { env } from './env.ts';
import { auth } from './auth.ts';
import { runMigrations } from './migrate.ts';

const app = Fastify({ logger: true });

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