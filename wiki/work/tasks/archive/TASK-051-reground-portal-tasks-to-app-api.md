---
id: TASK-051
title: "Reground ROADMAP-002 portal tasks to app/api paths and better-auth user() FK"
status: done
created: 2026-06-14
updated: 2026-06-14
depends_on: []
blocks: []
parallel_safe_with: []
uat: "wiki/work/uat/UAT-047-reground-portal-tasks-to-app-api.md"
tags: [portal, docs, refactor, tasks, roadmap-002]
---

# TASK-051 — Reground ROADMAP-002 portal tasks to app/api paths and better-auth user() FK

## Objective

Documentation-only update of the four existing ROADMAP-002 task files — **TASK-031**, **TASK-032**, **TASK-033**, **TASK-035** — and any UAT files that reference them, to align with the current `app/api` architecture established by the `simplify-architecture` restructure (commit `b4cfd41`, per the roadmap's 2026-06-13 architecture-update note). Two substantive corrections: (1) replace all pre-restructure `portal/` paths with `app/api/`, and (2) re-base the planned `devices` and `pairing_codes` tables on better-auth's `"user"(id)` table instead of the now-superseded hand-rolled `users` table. No code is written or executed — this task **edits existing task/UAT files only** and lists each file it touches.

## Approach

The pre-`simplify-architecture` tasks describe a `portal/` directory and a custom `users` table with a hand-rolled `tc_session` cookie (using `jose` + `openid-client` + `@fastify/cookie`). The current architecture lives under `app/api/` and uses **better-auth** for sessions and the canonical `"user"` table. This task is a find-and-replace plus a schema/auth-model re-grounding across the four task files, keeping every logic step, acceptance criterion, and ordering otherwise intact. Then sweep `wiki/work/uat/` for any UAT files referencing these tasks and apply the same corrections.

**Path rewrites** (apply throughout each file):
- `portal/` → `app/api/`
- `portal/index.ts` → `app/api/index.ts`
- `portal/package.json` → `app/api/package.json`
- `portal/routes/` → `app/api/routes/`
- `portal/relay/registry.ts` → `app/api/relay/registry.ts`
- `portal/relay/mux.ts` → `app/api/relay/mux.ts`
- any other `portal/<path>` → `app/api/<path>`

**Schema / FK re-grounding**:
- `devices.user_id` references better-auth `"user"(id)` (not the custom `users` table).
- `pairing_codes.user_id` references better-auth `"user"(id)` (not the custom `users` table).
- Update DDL notes / `REFERENCES` clauses accordingly; note that the `"user"` table is created by the better-auth schema migration (`@better-auth/cli migrate`), not by an app migration.

**Auth-model re-grounding**:
- Replace any hand-rolled `tc_session` cookie / `jose` / `openid-client` session references with **better-auth session middleware** (`auth.api.getSession`).
- Update dependency notes that listed `@fastify/cookie` + `jose` (for hand-rolled sessions) to reference better-auth instead. Keep `@fastify/websocket` and other non-session deps intact.

Preserve all task logic, step ordering, acceptance criteria, and roadmap backlinks otherwise.

## Steps

### 1. Read the four task files  <!-- agent: general-purpose -->

- [ ] Read `wiki/work/tasks/TASK-031-*.md`, `wiki/work/tasks/TASK-032-*.md`, `wiki/work/tasks/TASK-033-*.md`, and `wiki/work/tasks/TASK-035-portal-ws-relay-endpoint-registry-mux.md`.
- [ ] Note every `portal/` path reference, every `users`-table FK reference, and every `tc_session` / `jose` / `openid-client` / `@fastify/cookie` session reference in each file.

### 2. Rewrite paths to app/api  <!-- agent: general-purpose -->

- [ ] In each of TASK-031/032/033/035, replace `portal/` path references with `app/api/` per the mapping in the Approach (paths in prose, Steps, Acceptance Criteria, Dependencies, and Approach sections).
- [ ] Leave `shared/relay-protocol.ts` (repo-root) references unchanged — that file did not move.

### 3. Re-base device/pairing tables on better-auth user()  <!-- agent: general-purpose -->

- [ ] Update `devices.user_id` FK references to point at better-auth `"user"(id)` instead of the custom `users` table.
- [ ] Update `pairing_codes.user_id` FK references to point at better-auth `"user"(id)`.
- [ ] Update any DDL / `REFERENCES users(...)` notes to `REFERENCES "user"(id)`, and note the `"user"` table comes from the better-auth schema migration.

### 4. Re-ground session auth to better-auth  <!-- agent: general-purpose -->

- [ ] Replace `tc_session` cookie / `jose` / `openid-client` session references with better-auth session middleware (`auth.api.getSession`).
- [ ] Update dependency notes that listed `@fastify/cookie` + `jose` (for sessions) to reference better-auth.
- [ ] Keep all other dependency notes (e.g. `@fastify/websocket`) and all task logic/steps intact.

### 5. Sweep and update UAT files  <!-- agent: general-purpose -->

- [ ] List `wiki/work/uat/` and identify any UAT files referencing TASK-031/032/033/035 (or containing `portal/` paths / `users`-table / `tc_session` references tied to these tasks).
- [ ] Apply the same path, FK, and auth-model corrections to those UAT files so they stay consistent.
- [ ] If no UAT files reference these tasks, record that explicitly (nothing to change).

### 6. Record touched files  <!-- agent: general-purpose -->

- [ ] Produce the explicit list of every file edited (each task file + each UAT file), to surface in the final report.

## Acceptance Criteria

- [ ] No `portal/` path references remain in TASK-031, TASK-032, TASK-033, or TASK-035 (all rewritten to `app/api/`).
- [ ] `devices.user_id` and `pairing_codes.user_id` reference better-auth `"user"(id)` in all four files (no references to the custom `users` table for these FKs).
- [ ] Session auth is described as better-auth (`auth.api.getSession`); no `tc_session` cookie / `jose` / `openid-client` hand-rolled session references remain.
- [ ] Any UAT files referencing these tasks are updated consistently (or it is recorded that none exist).
- [ ] All task logic, step ordering, acceptance criteria, and roadmap backlinks otherwise unchanged.
- [ ] The final report lists every file touched.

## Dependencies

- None. This is a documentation-only re-grounding of existing task/UAT files and can run independently.

### Roadmap

Supports ROADMAP-002 Phase 3/4 by aligning the existing portal tasks (TASK-031/032/033/035) with the current `app/api` architecture, per the roadmap's 2026-06-13 architecture-update note — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
