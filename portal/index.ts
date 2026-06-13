// portal/index.ts
// Fastify boot entrypoint for the portal service.
//
// Out-of-scope downstream registrations (do NOT implement here):
//   - portal/auth/* (TASK-025) — Google OAuth + session middleware
//   - portal/relay/* (Phase 4) — relay routes
//   - routes/devices + routes/pairing — device/pairing endpoints
//   - Dockerfile.portal (TASK-026)
//   - do-app.yaml (ROADMAP-006)
//   - 001_init.sql DDL (TASK-024)

import Fastify from 'fastify';
import { env } from './env.ts';
import { runMigrations } from './migrate.ts';

const app = Fastify({ logger: true });

// GET /healthz — liveness only — DB readiness deferred to a future /readyz (ROADMAP-002).
// Returns { ok: true } without touching the DB so App Platform health checks stay green
// even under DB latency. DB reachability is enforced at boot via runMigrations().
app.get('/healthz', async (_request, _reply) => {
  return { ok: true };
});

async function start(): Promise<void> {
  // Run migrations first — this validates DB connectivity at boot.
  // A missing or unreachable DATABASE_URL surfaces a clear error and exits non-zero.
  try {
    await runMigrations();
  } catch (err) {
    console.error(
      '[portal] failed to run migrations — is DATABASE_URL reachable?\n',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }

  await app.listen({ host: '0.0.0.0', port: env.PORT });
}

start();
