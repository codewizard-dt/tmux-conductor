---
id: TASK-111
aliases: [TASK-111]
title: "Role column — add `role` enum to the agents SQLite table (schema v7)"
status: done
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: [TASK-113, TASK-114, TASK-115]
parallel_safe_with: [TASK-112]
uat: "[[UAT-111]]"
tags: [backend, schema, roles, roadmap-010]
---

# TASK-111 — Role column — add `role` enum to the agents SQLite table (schema v7)

blocks::[[TASK-113]]
blocks::[[TASK-114]]
blocks::[[TASK-115]]

## Objective

Give every agent row a `role` value (`generic`, `frontend`, `backend`, `qa`, `devops`, `security`, `architect`, default `generic`) so later Phase 3 work can select a per-role CLAUDE.md fragment at spawn time (TASK-113), badge the role on the agent card (TASK-114), and let operators pick a role when spawning (TASK-115). This task is schema + API + type plumbing only — no UI, no fragment-writing logic.

## Approach

`host-server/db.ts`'s `migrate()` function is a sequence of `if (version < N)` blocks, each ending with `db.prepare(...).run()` to bump `meta.schema_version`. The current top block is `if (version < 6)` (`db.ts:389-400`, adds `agent_terminal_log`, sets version to `'6'`). This task adds `if (version < 7)`, following the exact precedent of `if (version < 3)` (`db.ts:354-358`, added `worktree_path`/`branch` via plain `ALTER TABLE agents ADD COLUMN`) — the closest match for adding a single new column to `agents`. SQLite (3.31+, well within better-sqlite3's bundled version) supports `CHECK` constraints on `ALTER TABLE ADD COLUMN` as long as the constraint only references the new column and the `DEFAULT` satisfies it, so the migration can add the enum constraint in the same statement rather than relying on application-level validation alone:

```sql
ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'generic'
  CHECK (role IN ('generic','frontend','backend','qa','devops','security','architect'));
```

Existing rows backfill to `'generic'` automatically via `DEFAULT`. From there, thread `role` through the same places `worktree_path`/`branch` already flow: `mapAgent()` (row → `Agent`, `db.ts` around line 205), `createAgent()` (`db.ts:510-547`, accept an optional `role` on the `data` param, defaulting to `'generic'` when omitted so existing callers keep working), the `POST /agents` route (`host-server/index.ts`, validate against the same 7-value enum server-side and return 400 on an invalid value — don't rely on the SQLite CHECK alone, since a raw constraint violation surfaces as an ugly 500), and `buildSnapshot()`'s per-agent object (`index.ts:2130-2168`, alongside the existing `worktreePath: agent.worktreePath` / `branch: agent.branch` lines) so `GET /api/status` carries it to the frontend. Add the type-only field to the frontend `Agent` interface in `frontend/src/components/AgentList.tsx` (currently has `branch?: string | null` / `worktreePath?: string | null` around line 32-34) — declare it as `role?: string | null` and leave rendering to TASK-114/115.

## Steps

### 1. Add the schema v7 migration  <!-- agent: general-purpose -->

- [x] In `host-server/db.ts`, added an `if (version < 7)` block immediately after the existing `if (version < 6)` block (now `db.ts:401-404`), matching that block's exact structure. Re-verified live before writing that v6 was still the top block (no collision from concurrent sibling edits).
- [x] DDL used verbatim with the inline `CHECK` constraint: `ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'generic' CHECK (role IN ('generic','frontend','backend','qa','devops','security','architect'))`. Verified against a throwaway scratch DB (never the live one) that better-sqlite3's bundled SQLite supports `CHECK` on `ADD COLUMN` — valid role inserts succeed, invalid ones (`'bogus'`) throw `CHECK constraint failed`. No fallback needed; the CHECK is a real DB-level backstop in addition to the API-layer validation Step 3 will add. `npx tsc --noEmit` in `host-server/` passed clean.

### 2. Thread `role` through the Agent CRUD helpers  <!-- agent: general-purpose -->

- [x] `mapAgent()` (`host-server/db.ts:205-208`) now includes `role: r.role` alongside `branch`/`worktreePath`.
- [x] `AgentRow` and `Agent` interfaces both updated with `role: string`; `AgentWithProjectRow extends AgentRow`, so it inherits the field automatically (verified — no separate edit needed there).
- [x] `createAgent()` (`db.ts:514-551`) takes optional `role?: string` on `data`; `INSERT INTO agents (...)` includes `role` unconditionally in the column list, binding `data.role ?? 'generic'` — matching the existing `project_id`-style unconditional-column/`?? null`-fallback pattern rather than conditional inclusion. `npx tsc --noEmit` in `host-server/` passed clean (including `index.ts` callers, since `role` is optional).

### 3. Expose and validate `role` on the API surface  <!-- agent: general-purpose -->

- [x] `POST /agents` handler in `host-server/index.ts` (around line 913) now accepts optional `role` on the body, validates against the 7-value `VALID_AGENT_ROLES` enum, and returns `400 { error: 'role must be one of: generic, frontend, backend, qa, devops, security, architect' }` for anything invalid (including `""`). Validated value passed through to `createAgent()` via a conditional spread (avoids an `exactOptionalPropertyTypes` conflict).
- [x] `buildSnapshot()` (`index.ts`, around line 2122) now includes `role: agent.role` in the per-agent object, immediately after `branch: agent.branch`, so `GET /api/status` carries it. `npx tsc --noEmit` in `host-server/` passed clean after fixing one `exactOptionalPropertyTypes` error.

### 4. Add the frontend type (no UI yet)  <!-- agent: general-purpose -->

- [x] `role?: string | null` added to the `Agent` interface in `frontend/src/components/AgentList.tsx`, directly after `worktreePath?: string | null`. No rendering/badge/selector logic touched — that's TASK-114 and TASK-115. `npx tsc --noEmit` in `frontend/` passed clean.

### 5. Typecheck + verify migration  <!-- agent: general-purpose -->

- [x] `npx tsc --noEmit` passes with zero errors in both `host-server/` and `frontend/` (one transient `host-server/` error from a concurrent sibling edit to `config.ts` resolved on re-run — not a TASK-111 regression).
- [x] Added 4 new cases to `host-server/db.migration.test.ts`: fresh DB reaches `schema_version = '7'`; all 7 valid role values accepted; an 8th invalid value (`'manager'`) rejected by the CHECK constraint; an agent inserted without an explicit `role` reads back as `'generic'`. Scoped run: 23/23 pass (4 new + 19 pre-existing). Full `host-server/` suite (`npm test`): **61/61 pass**.
- [x] **Live-shape verification (beyond the outline's original scope, added per team-lead directive):** copied the pre-task backup (`tmp/conductor.db.bak-tackle111-20260815-124115`) to a scratch path, ran the real `openDb`/migrate function against it — migrated cleanly to `schema_version = '7'`, all 3 pre-existing real agent rows (`bootstrap-1`, `general`, `uat068-mon-dirty`) came out `role = 'generic'`. Scratch copy deleted afterward; the backup and the live `./data/conductor.db` were never touched.

## Acceptance Criteria

- [x] A fresh DB migrates cleanly from schema v6 to v7 (or v0 straight to v7 for a brand-new DB). Verified by db.migration.test.ts AND against a copy of the real live database.
- [x] An existing `agents` row (created before this migration) backfills to `role = 'generic'` after migrating. Verified against real production agent rows (bootstrap-1, general, uat068-mon-dirty).
- [x] `POST /agents` with an invalid `role` value returns 400; a valid value persists and round-trips through `GET /agents` / `GET /api/status`.
- [x] `GET /api/status`'s per-agent objects include a `role` field (via `buildSnapshot()`).
- [x] `npx tsc --noEmit` passes cleanly in both `host-server/` and `frontend/`.

## Dependencies

None — foundational task, independent of TASK-112 (presets.json) and safe to build in parallel with it (disjoint files: this task touches `host-server/db.ts`, `host-server/index.ts`, and the `Agent` type in `frontend/src/components/AgentList.tsx`; TASK-112 only adds a new standalone config file).

### Roadmap

Implements ROADMAP-010 Phase 3, item 1 ("Add a `role` enum column to the `agents` SQLite table") — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`.
