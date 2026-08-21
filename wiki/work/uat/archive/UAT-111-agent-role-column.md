---
id: UAT-111
aliases: [UAT-111]
title: "UAT: Role column — add `role` enum to the agents SQLite table (schema v7)"
status: passed
task: TASK-111
created: 2026-08-15
updated: 2026-08-15
---

# UAT-111 — UAT: Role column — add `role` enum to the agents SQLite table (schema v7)

implements::[[TASK-111]]

> **Source task**: [[TASK-111]]
> **Generated**: 2026-08-15
> **Independent-eyes note**: TASK-111 was implemented by a different agent (tackle-071); this UAT was generated and executed by a separate agent with no stake in the implementation being "already right."
> **Scope note**: TASK-111 is schema + API + type plumbing only — no UI. Every acceptance criterion is machine-verifiable via HTTP/DB, so this file has no UI cases and no human-only split.

---

## Prerequisites

- [ ] Host-server running on `http://127.0.0.1:8788` (`make dev` or `npm start` in `host-server/`) — confirmed reachable at generation time.
- [ ] The conductor tmux session is running under the name configured in `conductor.conf` (`SESSION_NAME`, default `conductor`) — `POST /api/agents` returns `409 { "error": "session not running" }` otherwise. Confirmed running at generation time (`tmux has-session -t conductor` → exit 0). A bare `tmux new-session -d -s conductor` is sufficient if it isn't.
- [ ] `jq` installed.
- [ ] `node` available on `PATH` — required for the repeatable unit test backing UAT-EDGE-003.
- [ ] Cleanup after every API test that creates agents: `curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$ID"` for every throwaway agent, then **re-query `GET /api/agents` as the literal last action** and confirm zero fixture-named agents remain — do not treat a mid-run snapshot as proof of cleanup.
- [ ] **Do NOT re-run the schema migration against the live `./data/conductor.db`** — it is already at `schema_version` 7. UAT-EDGE-003 (the backfill-to-generic case) uses a from-scratch, in-memory-adjacent scratch DB via the repeatable unit test, never a copy of or the real live database.

---

## Test Cases

### UAT-API-001: POST /agents accepts and persists all 7 valid role values
- **Endpoint**: `POST /api/agents`
- **Description**: The route validates `role` against the 7-value enum (`generic`, `frontend`, `backend`, `qa`, `devops`, `security`, `architect`) declared inline as `VALID_AGENT_ROLES` (`host-server/index.ts:933`) and, when valid, passes it through to `createAgent` unconditionally spread into the payload (`index.ts:955`). Each of the 7 values must be accepted, echoed in the `201` create response, and round-trip through `GET /api/agents`.
- **Steps**:
  1. Create 7 disposable agents, one per role, each with a `./tmp/`-local nonexistent workdir (no git repo — avoids worktree creation) and `launchCmd: "sleep 300"` (no token burn):
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat111-role-generic","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat111-nonexistent-generic","launchCmd":"sleep 300","role":"generic"}'
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat111-role-frontend","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat111-nonexistent-frontend","launchCmd":"sleep 300","role":"frontend"}'
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat111-role-backend","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat111-nonexistent-backend","launchCmd":"sleep 300","role":"backend"}'
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat111-role-qa","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat111-nonexistent-qa","launchCmd":"sleep 300","role":"qa"}'
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat111-role-devops","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat111-nonexistent-devops","launchCmd":"sleep 300","role":"devops"}'
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat111-role-security","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat111-nonexistent-security","launchCmd":"sleep 300","role":"security"}'
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat111-role-architect","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat111-nonexistent-architect","launchCmd":"sleep 300","role":"architect"}'
     ```
     Each `201` response's `agent.role` should already match the requested role (e.g. the `generic` request returned `"role":"generic"` at generation time) — this is the create-response echo half of the contract; the Command below checks the persisted/round-tripped half.
  2. Run the Command below.
  3. Cleanup: `DELETE` each of the 7 agent ids returned above, then re-run `GET /api/agents` and confirm no `uat111-role-*` names remain (see Prerequisites).
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents' | jq '[.[] | select(.name | startswith("uat111-role-"))] | length==7 and (map(.role) | sort) == ["architect","backend","devops","frontend","generic","qa","security"]'
  ```
- **Expected Result**: Prints `true` — exactly 7 fixture agents exist and their `role` values, sorted, are exactly the 7 canonical roles with no duplicates or omissions. Verified live at generation time (agent ids 12–18, since deleted).
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`'TASK-111: agents.role accepts all 7 valid role values'`, pre-existing — added during TASK-111's own implementation, not by this UAT-generation run). Loops all 7 `ROLE_VALUES`-equivalent strings through `createAgent` and asserts each round-trips via `listAgents`, covering the same acceptance breadth at the DB-helper layer. The HTTP-level echo/round-trip (this case's own contribution) is verified live above since `index.ts`'s route handler has no injectable test seam.
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test db.migration.test.ts`
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-002: POST /agents with role omitted defaults to 'generic'
- **Endpoint**: `POST /api/agents`
- **Description**: When `role` is absent from the body, the route's validation guard (`role !== undefined && ...`) never fires, and `createAgent` binds `data.role ?? 'generic'` (`host-server/db.ts:531`). The created agent must persist and echo `role: "generic"` without the caller ever specifying it.
- **Steps**:
  1. Create a disposable agent with no `role` key in the body at all:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat111-default-role","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat111-nonexistent-default","launchCmd":"sleep 300"}'
     ```
     Note the returned `agent.id` as `<UID>`.
  2. Run the Command below (substitute `<UID>`).
  3. Cleanup: `curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/<UID>"`, then re-query `GET /api/agents` and confirm `uat111-default-role` is gone.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents' | jq '[.[] | select(.id==<UID>)] | length==1 and .[0].role=="generic"'
  ```
- **Expected Result**: `true` — the agent's persisted `role` is exactly `"generic"`. Verified live at generation time (agent id 19, since deleted): the create response itself already carried `"role":"generic"` before any follow-up query.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`"TASK-111: agents.role defaults to 'generic' when not provided"`, pre-existing — added during TASK-111's own implementation). Calls `createAgent` with no `role` key and asserts `agent.role === 'generic'` — the exact application-level fallback this case exercises over HTTP.
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test db.migration.test.ts`
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-003: GET /api/status exposes `role` on every agent object
- **Endpoint**: `GET /api/status`
- **Description**: `buildSnapshot()` (`host-server/index.ts:2176`) includes `role: agent.role` in each per-agent object of the `agents` array, immediately after `branch: agent.branch`, satisfying the Acceptance Criterion "`GET /api/status`'s per-agent objects include a `role` field."
- **Steps**:
  1. Create a disposable agent with an explicit non-default role, so its presence in `/api/status` is unambiguous:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat111-status-role","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat111-nonexistent-status","launchCmd":"sleep 300","role":"security"}'
     ```
     Note the returned `agent.id` as `<SID>`.
  2. Run the Command below.
  3. Cleanup: `curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/<SID>"`, then re-query `GET /api/agents` and confirm `uat111-status-role` is gone.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/status' | jq '[.agents[] | select(.name=="uat111-status-role")] | length==1 and .[0].role=="security"'
  ```
- **Expected Result**: `true` — the fixture agent appears exactly once in `/api/status`'s `agents` array with `role: "security"`. Verified live at generation time (agent ids 12–19, exercised as a 7-role matrix in UAT-API-001's fixtures plus this one; all confirmed carrying `role` on `/api/status`).
- **Repeatable Unit Test**: Not applicable: `buildSnapshot`'s per-agent object construction is inline logic inside `host-server/index.ts`'s snapshot builder (a `.map()` closure with no independent exported unit), not separable from the live tmux/status-poll machinery without a live server. Note: `buildSnapshot`'s `Snapshot` interface type annotation (`index.ts:560-565`) does not itself list `role` in the `agents` array element type — the field still reaches the real JSON response because `role` rides along on the `agentStatuses` variable's wider inferred type, which is structurally assignable to the narrower declared interface (TypeScript's excess-property check only fires on fresh object literals, not on already-typed variables). This is a harmless type-annotation gap, not a runtime defect — confirmed by this case's live HTTP result — but worth a maintainer's note since a future refactor that switches to an inline literal there could silently start rejecting `role` at compile time.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-001: Invalid role value returns 400 with the clean enum message, not a raw SQLite error
- **Scenario**: `role: "manager"` is not one of the 7 valid values. The route's own `VALID_AGENT_ROLES.includes(...)` guard (`index.ts:934`) must catch this *before* any `createAgent`/SQL insert, returning a clean, human-readable 400 — never letting a raw `CHECK constraint failed` SQLite error surface to the caller as an uncaught 500. This distinction (validation layer vs. raw DB constraint) is explicitly the point of Step 3 in the task's own Approach section.
- **Steps**:
  1. Run the Command below as-is. No agent is created — the request must be rejected before any DB write.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat111-invalid-role","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat111-nonexistent-invalid","launchCmd":"sleep 300","role":"manager"}'
  ```
- **Expected Result**: HTTP 400. JSON exactly `{"error":"role must be one of: generic, frontend, backend, qa, devops, security, architect"}` — not a SQLite-shaped error (no `"CHECK constraint failed"`, no `SqliteError`, no 500). Verified live at generation time; also confirmed no `uat111-invalid-role` agent was created afterward (`GET /api/agents` showed 0 matches).
- **Repeatable Unit Test**: Not applicable: the HTTP-level 400 guard is inline route validation in the non-injectable `index.ts` entrypoint (no exported Fastify app builder for `.inject()`-style testing). A related but distinct scenario — the raw DB `CHECK` constraint itself rejecting an invalid value when the application-level guard is bypassed — is already covered by the pre-existing `host-server/db.migration.test.ts` case `'TASK-111: agents.role CHECK constraint rejects an invalid role value'`; that test is evidence the DB-level backstop this case is designed to never expose actually works, not evidence for this case's own HTTP-message contract.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-002: Empty-string role returns the same 400 as an unrecognized value
- **Scenario**: `role: ""` is a defined value (`!== undefined`) that fails `VALID_AGENT_ROLES.includes('')`, exercising the same guard as UAT-EDGE-001 but proving the check isn't merely `if (role) { ... }` (which would silently treat `""` as "not provided" and default to `generic` instead of rejecting it).
- **Steps**:
  1. Run the Command below as-is. No agent is created.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat111-empty-role","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat111-nonexistent-empty","launchCmd":"sleep 300","role":""}'
  ```
- **Expected Result**: HTTP 400. JSON exactly `{"error":"role must be one of: generic, frontend, backend, qa, devops, security, architect"}` — identical message to UAT-EDGE-001. Verified live at generation time; confirmed no `uat111-empty-role` agent was created afterward.
- **Repeatable Unit Test**: Not applicable: same inline-route-guard reasoning as UAT-EDGE-001.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-003: A pre-existing (pre-v7) agent row backfills `role` to 'generic' on migration
- **Scenario**: An agent row created before this migration (no `role` column existed yet) must, after migrating, read back with `role = 'generic'` via the `ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'generic' ...` DDL's `DEFAULT` clause — not via any application-level fallback, since this row was never touched by `createAgent`. Per the explicit instruction for this UAT run, this is verified against a **from-scratch scratch database file**, never a copy of or the real `./data/conductor.db` (already at `schema_version` 7 — re-running the migration against it is out of bounds).
- **Steps**:
  1. Run the unit suite below (uses a fresh scratch DB file under `host-server/../tmp/`, cleaned up in the test's own `finally` block; never touches `./data/conductor.db`):
     ```bash
     cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && node --import tsx/esm --test db.migration.test.ts
     ```
  2. Locate the `"TASK-111: an existing pre-v7 agent row backfills role to 'generic' on migration"` result in the output.
- **Expected Result**: Test passes. It builds a scratch SQLite file by hand with the exact pre-v7 `agents` table shape (`id`, `name`, `workdir`, `launch_cmd`, `project_id`, `created_at`, `worktree_path`, `branch` — no `role` column) plus a `bg_processes` table (required by `openDb`'s `seedFromLegacy` path), inserts one row directly (bypassing `createAgent` entirely) with `schema_version` pinned at `'6'`, then calls the real `openDb()` against that file. Asserts: the migrated `agents` table gains a `role` column, the pre-existing row survives by name, and its `role` reads back as exactly `'generic'`.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`"TASK-111: an existing pre-v7 agent row backfills role to 'generic' on migration"`, added by this UAT-generation run — the task's own implementation verified this manually against a copy of the real production DB backup and then discarded the scratch copy, per its Step 5 notes, leaving no repeatable, re-runnable check behind; this closes that gap with a from-scratch fixture instead of ever touching a live-DB-derived copy).
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test db.migration.test.ts`
- [x] Pass <!-- 2026-08-15 -->

### UAT-STATIC-001: `npx tsc --noEmit` and the full `host-server/` test suite pass cleanly
- **Scenario**: The task's Acceptance Criteria require a clean typecheck in both `host-server/` and `frontend/` after adding the `role` column, CRUD plumbing, and API validation.
- **Steps**:
  1. Run the commands below.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && npx tsc --noEmit
  ```
- **Expected Result**: Exits with no output and status 0 (zero type errors). Verified passing at generation time. `npm test` in `host-server/` was also run and verified clean at generation time (78 tests, 0 failures — the suite count is a moving target under concurrent multi-agent development in this repo, so re-running may show a different total; what matters is 0 failures). `frontend/`'s `role?: string | null` type-only addition was verified clean by the task's own Step 4/5 (no runtime behavior added there for this UAT to separately re-verify).
- **Repeatable Unit Test**: Not applicable: this command *is* the static gate itself, re-run verbatim; wrapping it in a unit test would just re-invoke the same compiler check.
- [x] Pass <!-- 2026-08-15 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| A fresh DB migrates cleanly from schema v6 to v7 (or v0 straight to v7) | Pre-existing `db.migration.test.ts` case `'TASK-111: fresh DB ends at schema_version 7 after migration'` (not re-verified here — no new runtime behavior beyond what `/tackle`'s own Step 5 already confirmed, same precedent as UAT-063's typecheck line) |
| An existing `agents` row backfills to `role = 'generic'` after migrating | UAT-EDGE-003 |
| `POST /agents` with an invalid `role` value returns 400; a valid value persists and round-trips through `GET /agents` / `GET /api/status` | UAT-API-001 (valid, all 7), UAT-EDGE-001 (invalid), UAT-EDGE-002 (empty string), UAT-API-003 (`/api/status` round-trip) |
| `GET /api/status`'s per-agent objects include a `role` field | UAT-API-003 |
| `npx tsc --noEmit` passes cleanly in both `host-server/` and `frontend/` | UAT-STATIC-001 (host-server); frontend's type-only change already gated by TASK-111's own Step 4/5, no separate runtime behavior to re-verify here |

**Split summary**: 7 of 7 cases (100%) execute a genuine machine-checkable verdict — either a live curl/jq assertion against the running host-server, or a verified `node --test` run. TASK-111 ships no UI, so there are no human-only cases in this file, unlike its sibling UATs this session (UAT-109/110/070 etc.) which all had a DOM-rendering component.

**Note on `uatGenerate.promoteTests`**: the stored preference (`true`, legacy grammar) maps to `dedicated` for this run, but the repo's own layout overrides it — every `host-server/` test lives as a sibling next to (or in the same file as) the module it tests, with no dedicated `test/` directory anywhere. The one new promoted case (UAT-EDGE-003) was added directly to the existing `host-server/db.migration.test.ts`, following that established local pattern, matching the same override already applied for UAT-076/UAT-062 this session.

## Notes

- Fixture agents (ids 12–19 at generation time) were all created with `./tmp/`-local nonexistent, non-git workdirs and `launchCmd: "sleep 300"` — no worktree creation, no token burn, no real tmux CLI process beyond a disposable `sleep`. All were deleted, and `GET /api/agents` was re-queried as the literal last action of the generation session to confirm zero `uat111-*` agents remain live.
- `db.migration.test.ts` gained one new case during this generation run (`"TASK-111: an existing pre-v7 agent row backfills role to 'generic' on migration"`); the full file was re-run and confirmed 24/24 passing (20 pre-existing + 4 TASK-111 + this 1 new case) before this UAT was written.
