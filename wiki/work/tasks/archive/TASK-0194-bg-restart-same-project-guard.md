---
id: TASK-0194
aliases: [TASK-0194]
title: "Resolve the calling agent's project on the server and restrict bg restart to same-project callers"
status: done
created: 2026-09-19
updated: 2026-09-20
depends_on: [TASK-0190, TASK-0193, TASK-0186]
blocks: []
parallel_safe_with: [TASK-0191, TASK-0192]
uat: "[[UAT-0194]]"
tags: [bg-processes, host-server, restart, project-scoping, roadmap-0024]
---

# TASK-0194 — Resolve the calling agent's project on the server and restrict bg restart to same-project callers

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
depends_on::[[TASK-0190]]
depends_on::[[TASK-0193]]
depends_on::[[TASK-0186]]

> ROADMAP-0024 Phase 3 (Agent Access). Read `TASK-0186`'s `## Decision` (policy for bg processes with no project) and `TASK-0193`'s caller-header convention before starting; both must be done. The Phase 3 `dev-commands list` and `restart` items build on the resolver this task exports.

## Objective

Agents have no way to learn their own project (`CONDUCTOR_AGENT_NAME` is the only identity they carry, and it is the tmux window name, `<project>-<name>` for project agents per `agentWindowName()` in `host-server/db.ts:33`, set at spawn in `host-server/index.ts:275`), so authorization cannot be done client-side, and the server currently trusts every caller. Make the server resolve the caller from the `X-Conductor-Agent` header defined by `TASK-0193` to an agent row and its `project_id`, and refuse a restart when that project does not match the target bg process's project. Resolving server-side works for agents that are already running (no respawn to gain a new env var) and keeps the guard in one place.

## Approach

- **Resolver.** New pure function `resolveCallerProject(header, agents, projects)` in `host-server/bgAccess.ts` returning a discriminated result: `{ kind: 'human' }` (header absent), `{ kind: 'agent', agentId, agentName, projectId | null }`, `{ kind: 'unknown' }` (header present, no agent matches), or `{ kind: 'ambiguous' }` (more than one agent's `agentWindowName()` equals the header, possible since `<project>-<name>` concatenation is not injective, for example project `a-b` + agent `c` versus project `a` + agent `b-c`). Match by exact string equality against `agentWindowName({ name, projectName })` for every agent; never prefix/substring match (compare `TASK-0182`'s exact-match lesson).
- **Unscoped-row policy (decided in `TASK-0186`, amended 2026-09-20):** every bg process must have a project, and `TASK-0195`/`TASK-0196` backfill and enforce `NOT NULL`. This guard keeps a fail-closed branch anyway: an agent restart against a `project_id IS NULL` bg process is denied (reason `unscoped`) if one ever slips through (for example before the migration has run); human/dashboard callers are unaffected.
- **Guard rule** (`authorizeRestart(caller, bg, policy)`, pure):
  - human/dashboard: allow (unchanged single-user semantics; still audited).
  - agent whose `projectId` is non-null: allow iff `bg.projectId === caller.projectId`.
  - agent with no project, or bg with no project: apply the policy recorded in `TASK-0186`'s Decision (visible to all / hidden / must be assigned). Encode it as one small switch so a policy change is a one-line edit; default to deny if the decision is missing.
  - `unknown` and `ambiguous`: **deny (fail closed)**; an unresolvable identity must never widen access.
  - Denied requests return `403 { error, callerProjectId, bgProjectId }`, do not touch tmux, do not arm the cooldown, and write an audit record with `outcome: 'denied'` and the reason (`project-mismatch`, `unknown-caller`, `ambiguous-caller`, `unscoped`) via the `bg-restarts.jsonl` writer from `TASK-0193`.
- **Order of checks in the route:** 404 unknown bg, then caller resolution/authorization (403), then cooldown (429), then restart. A denied caller never learns cooldown state.
- **Reads are not gated here.** `GET /status`, `/projects/:id/bg-processes`, and the tail endpoint stay open as they are today; this task only guards the mutating restart. Mutating open/close-window and PATCH/DELETE routes stay human-only in practice (the skill never calls them); note in the route comment that they remain unauthenticated by design and are out of scope, and record a follow-up suggestion in the task's Notes rather than widening scope.
- **Not a security boundary.** Header spoofing by an agent that knows another agent's name is possible; this is the same single-user, no-auth trust model as the rest of the host-server. State it plainly in the route comment and in `background-process-registry.md`. If agents ever run outside the host, the alternative from the research is a signed per-agent token.
- Expose the resolver for reuse (`GET /agents/whoami` or an internal helper) only if Phase 3's `dev-commands list` item needs it; do not add a public route in this task.

## Steps

### 1. Confirm inputs  <!-- agent: Explore -->

- [x] Read `TASK-0186` `## Decision` and `TASK-0193`'s finished header/audit code (`host-server/bgRestartPolicy.ts`, the restart route) and record the unscoped-row policy and header name in this task's Approach (already recorded in the Approach: policy C `must-assign`, header `X-Conductor-Agent`)
- [x] Read `host-server/db.ts` `agentWindowName`, `listAgents`, `listProjects`, and confirm `Agent.projectName`/`projectId` shapes with Serena `find_symbol` (`Agent` carries `projectId`/`projectName`, so `listProjects` is not needed)

### 2. Resolver and guard  <!-- agent: general-purpose -->

- [x] Create `host-server/bgAccess.ts` exporting `resolveCallerProject` and `authorizeRestart` (both pure, no I/O), with the result/reason types described above (`resolveCallerProject(header, agents)`; the `projects` parameter was dropped because agent rows already carry `projectId`/`projectName`)
- [x] Extend the audit-record builder from `TASK-0193` to accept `outcome: 'denied'` and a `reason` field (backwards-compatible)

### 3. Wire into the route  <!-- agent: general-purpose -->

- [x] In `POST /bg-processes/:name/restart` (`host-server/index.ts`): after the 404 check, load `listAgents(db)`/`listProjects(db)`, call `resolveCallerProject` then `authorizeRestart`, return `403` and audit on denial, otherwise continue to the cooldown check and restart (the guard sits before the 409 session check as well, so a denied caller learns no session state)
- [x] Add a route comment stating the guard order, the fail-closed rule, and the not-a-security-boundary caveat

### 4. Tests  <!-- agent: general-purpose -->

- [x] Add `host-server/bgAccess.test.ts` (node:test) covering: header absent -> human allowed; same-project agent allowed; different-project agent denied; agent with no project against a scoped bg; scoped agent against an unscoped bg under each policy branch (visible/hidden/must-assign, driven by the recorded decision); unknown header denied; **ambiguous** header (project `a-b` + agent `c` versus project `a` + agent `b-c`) denied; near-miss/prefix/case-different header does not match; a `foo` caller does not match `foo-copy`
- [x] Add a test that a denied request would produce an audit record with `outcome: 'denied'` and the right `reason` (use the injectable appender)
- [x] Run `cd host-server && npx tsc --noEmit && npm test` and lint the new files (tsc clean, eslint clean on the new/changed files, `bgAccess.test.ts` 21/21 and `bgRestartPolicy.test.ts` 36/36 pass; full `npm test` not run, file-scoped only because other agents are editing `db.ts`)

### 5. Docs and live smoke  <!-- agent: general-purpose -->

- [x] Document the guard (rule table, fail-closed behaviour, caveat) in `wiki/knowledge/concepts/background-process-registry.md` and the routes row in `CLAUDE.md`
- [x] [DEFERRED-TO-UAT] Add a smoke recipe marked `[DEFERRED-TO-UAT]`: with two projects and a throwaway bg process, `curl -X POST -H 'X-Conductor-Agent: <window name of an agent in the other project>' .../bg-processes/<slug>/restart` returns 403 and a `denied` line in `logs/bg-restarts.jsonl`; the same call with a same-project agent name returns 200 (recipe recorded in Notes below; not run)

## Notes

<!-- Updated: 2026-09-20 -->

- **Smoke recipe [DEFERRED-TO-UAT]** (private stack only, never the live session): with two projects A and B, one agent in each and a throwaway bg process `<slug>` in project A, `curl -i -X POST -H 'X-Conductor-Agent: <window name of the project-B agent>' http://localhost:<port>/api/bg-processes/<slug>/restart` returns `403` with `reason: "project-mismatch"` and a `denied` line in `logs/bg-restarts.jsonl`, and no tmux change. The same call with the project-A agent's window name returns `200`; with no header returns `200`; with an unregistered name returns `403 unknown-caller`.
- **Deviation:** `resolveCallerProject(header, agents)` has no `projects` parameter; `listAgents()` rows already carry `projectId` and `projectName`. The 403 body also carries `reason` alongside `error`, `callerProjectId`, `bgProjectId`.
- **Ordering:** the guard runs before the 409 session-not-running check (task text: 404, 403, 429), so the `TASK-0194` marker that sat after the session check was moved up.
- **Follow-up suggestion (out of scope):** `POST/DELETE /bg-processes/:slug/window`, `PATCH`, `DELETE` and the read routes remain unauthenticated; consider the same guard for the window and delete routes if agents are ever told they may call them. `GET /agents/whoami` was not added here (left for TASK-0202).

## Dependencies

- Depends on: `TASK-0190` (restart route), `TASK-0193` (caller header convention, audit writer, cooldown ordering), `TASK-0186` (policy for bg processes with no project).
- Blocks: nothing hard; Phase 3's `dev-commands restart` subcommand and Phase 4's Restart buttons rely on this guard being in place before agents are told they can restart.
- Parallel-safe with `TASK-0191` and `TASK-0192`.
