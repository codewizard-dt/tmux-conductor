import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth.js';
import { query } from '../db.js';
import { env } from '../env.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ValidateBody {
  code: string;
}

interface InviteCodeRow {
  id: string;
  usage_limit: number;
  used_count: number;
  expires_at: string | null;
}

// ---------------------------------------------------------------------------
// Admin guard
// ---------------------------------------------------------------------------

type AdminSession = { user: { id: string; email: string } };

async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AdminSession | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });

  if (!session) {
    reply.code(401).send({ error: 'unauthorized' });
    return null;
  }

  if (session.user.email !== env.BOOTSTRAP_ADMIN_EMAIL) {
    reply.code(403).send({ error: 'forbidden' });
    return null;
  }

  return session as AdminSession;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

interface CreateInviteBody {
  code: string;
  usageLimit: number;
  expiresAt?: string;
}

interface PgError extends Error {
  code?: string;
}

export async function inviteCodesRoutes(app: FastifyInstance) {
  /**
   * POST /api/invite-codes/validate
   * Public — no auth required.
   * Body: { code: string }
   * Returns: { valid: boolean, error?: 'invalid' | 'expired' | 'exhausted' }
   */
  app.post<{ Body: ValidateBody }>(
    '/invite-codes/validate',
    {
      schema: {
        body: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const { code } = req.body;

      const result = await query<InviteCodeRow>(
        'SELECT id, usage_limit, used_count, expires_at FROM invite_codes WHERE code = $1',
        [code],
      );

      if (result.rows.length === 0) {
        return reply.send({ valid: false, error: 'invalid' });
      }

      const row = result.rows[0]!;

      // Expired check
      if (row.expires_at !== null && new Date(row.expires_at) <= new Date()) {
        return reply.send({ valid: false, error: 'expired' });
      }

      // Exhausted check
      if (row.used_count >= row.usage_limit) {
        return reply.send({ valid: false, error: 'exhausted' });
      }

      return reply.send({ valid: true });
    },
  );

  /**
   * GET /api/admin/invite-codes
   * Admin only — requires BOOTSTRAP_ADMIN_EMAIL session.
   * Returns all invite codes ordered by created_at DESC.
   */
  app.get('/admin/invite-codes', async (req, reply) => {
    const session = await requireAdmin(req, reply);
    if (!session) return;

    const result = await query<InviteCodeRow>(
      'SELECT id, code, usage_limit, used_count, expires_at, created_by, created_at FROM invite_codes ORDER BY created_at DESC',
    );

    return reply.send(result.rows);
  });

  /**
   * POST /api/admin/invite-codes
   * Admin only — create a new invite code.
   * Body: { code: string (4-64 chars), usageLimit: integer >= 1, expiresAt?: ISO date string }
   */
  app.post<{ Body: CreateInviteBody }>(
    '/admin/invite-codes',
    {
      schema: {
        body: {
          type: 'object',
          required: ['code', 'usageLimit'],
          properties: {
            code: { type: 'string', minLength: 4, maxLength: 64 },
            usageLimit: { type: 'integer', minimum: 1 },
            expiresAt: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireAdmin(req, reply);
      if (!session) return;

      const { code, usageLimit, expiresAt } = req.body;
      const id = crypto.randomUUID();
      const createdBy = session.user.id;

      try {
        const result = await query<InviteCodeRow>(
          `INSERT INTO invite_codes (id, code, usage_limit, expires_at, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, code, usage_limit, used_count, expires_at, created_by, created_at`,
          [id, code, usageLimit, expiresAt ?? null, createdBy],
        );

        return reply.code(201).send(result.rows[0]);
      } catch (err) {
        const e = err as PgError;
        if (e.code === '23505') {
          return reply.code(409).send({ error: 'duplicate_code' });
        }
        throw err;
      }
    },
  );

  /**
   * DELETE /api/admin/invite-codes/:id
   * Admin only — revoke (delete) an invite code by id.
   * Returns 404 when no row was deleted.
   */
  app.delete<{ Params: { id: string } }>(
    '/admin/invite-codes/:id',
    async (req, reply) => {
      const session = await requireAdmin(req, reply);
      if (!session) return;

      const { id } = req.params;

      const result = await query<{ id: string }>(
        'DELETE FROM invite_codes WHERE id = $1 RETURNING id',
        [id],
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'not_found' });
      }

      return reply.code(200).send({ deleted: true });
    },
  );
}
