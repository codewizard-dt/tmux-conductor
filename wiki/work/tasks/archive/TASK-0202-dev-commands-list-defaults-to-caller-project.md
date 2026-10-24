---
id: TASK-0202
aliases: [TASK-0202]
title: "Make `dev-commands list` default to the caller's project, with an all-projects option"
status: done
created: 2026-09-20
updated: 2026-10-17
depends_on: [TASK-0194, TASK-0195, TASK-0196]
blocks: [TASK-0203, TASK-0204]
parallel_safe_with: [TASK-0191, TASK-0192, TASK-0190, TASK-0193]
uat: "[[UAT-0202]]"
tags: [bg-processes, skills, dev-commands, host-server, project-scoping, roadmap-0024]
---

# TASK-0202 — Make `dev-commands list` default to the caller's project, with an all-projects option

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
relates_to::[[shared-dev-commands]]
depends_on::[[TASK-0194]]
depends_on::[[TASK-0195]]
depends_on::[[TASK-0196]]
blocks::[[TASK-0203]]
blocks::[[TASK-0204]]

> ROADMAP-0024 Phase 3 (Agent Access). Starts after `TASK-0194` (exports `resolveCallerProject`), `TASK-0195` (every bg process has a project) and `TASK-0196` (slug identity; it already rewrites `list`/`status`/`tail` to print and match slugs, so this task builds on that version of `skills/dev-commands/scripts/dev-commands.sh`). It is the first of three Phase 3 tasks that edit the same skill script and `SKILL.md`; run them in order `TASK-0202` -> `TASK-0203` -> `TASK-0204`, never in parallel.

## Objective

`dev-commands.sh list` reads `GET /api/status` and prints **every** bg process on the machine, so an agent working in project A sees (and may act on) project B's dev servers. An agent has no env var for its project (`CONDUCTOR_AGENT_NAME`, the tmux window name `<project>-<name>`, is the only identity it carries, set at spawn in `host-server/index.ts`). Make `list` default to the calling agent's own project and add `--all` for the machine-wide view, resolving the project **on the server** so it works for agents that are already running (no respawn to pick up a new env var).

## Approach

- **Confirmed inputs (2026-09-20).** `resolveCallerProject(header: string | null, agents: readonly CallerAgent[]): CallerResolution` in `host-server/bgAccess.ts:64` takes **no `projects` param** (TASK-0194 dropped it: agent rows from `listAgents(db)` already carry `projectId`/`projectName`). `CallerResolution` = `{kind:'human'} | {kind:'agent'; agentId:number; agentName:string; projectId:number|null} | {kind:'unknown'} | {kind:'ambiguous'}` (no `projectName`, so whoami looks it up from the matched agent row). `parseCallerHeader(raw: unknown): string | null` and `BG_CALLER_HEADER = 'x-conductor-agent'` live in `host-server/bgRestartPolicy.ts`; the restart route calls `resolveCallerProject(parseCallerHeader(req.headers[BG_CALLER_HEADER]), listAgents(db))`. `BgStatus` (`host-server/index.ts:152`) carries `slug`, `windowPresent`, `projectId`, `projectName`; `GET /api/status` returns them under `bgProcesses[]`.
- **Server-side caller lookup.** Add a small read-only route `GET /agents/whoami` (mounted under the `/api` prefix like every other route) in `host-server/index.ts`. It reads the `X-Conductor-Agent` header (convention defined by `TASK-0193`, parsed with `parseCallerHeader`) and answers with the result of `resolveCallerProject(header, agents, projects)` from `host-server/bgAccess.ts` (`TASK-0194`; `TASK-0194`'s Approach explicitly reserves this route for the Phase 3 `list` item): `200 { kind: 'agent', agentId, agentName, projectId, projectName }`, or `200 { kind: 'human' | 'unknown' | 'ambiguous' }` (never 4xx, so the script can branch on `kind` without parsing status codes). No new authorization logic: this is a read, and reads stay open as they are today. It is a static path segment, so it does not collide with the parametric `/agents/:id/...` routes (there is no `GET /agents/:id`); confirm with a route-table check before merging.
- **Client-side filter, not a new server list route.** `GET /projects/:id/bg-processes` returns raw DB rows (`listBgProcesses(db, { projectId })`), without `slug`, `windowPresent`, `liveness` or `lastRestart`. `GET /status` already returns `BgStatus` entries carrying `projectId`/`projectName`. So the script fetches `/api/status` as today and filters `.bgProcesses[]` with `jq --argjson pid <projectId> 'select(.projectId == $pid)'`. One extra cheap `curl` (whoami) and no change to the payload other tasks consume.
- **Script behavior** (`skills/dev-commands/scripts/dev-commands.sh`, `cmd_list`):
  - `list` (default): if `CONDUCTOR_AGENT_NAME` is set and whoami returns `kind: agent` with a non-null `projectId`, print a header `Background processes for project <projectName> (use --all for every project):` followed by only that project's processes, in the existing line format (slug, state, window).
  - `list --all`: today's behavior (every project), header `Background processes (all projects):`, and add the project name to each line so the grouping is visible.
  - **Fallbacks always show more, never less, and say so** (reads are open by design; hiding a process from an agent that needs to restart it would be worse than over-listing): no `CONDUCTOR_AGENT_NAME`, whoami `human`/`unknown`/`ambiguous`, agent with `projectId: null` (legacy row before `TASK-0195`'s backfill), whoami unreachable, or `jq` missing all print an explicit note on stderr (`Note: could not resolve your project (<reason>); showing all projects.`) and behave as `--all`. Exit code stays 0.
  - **Offline path** (`cmd_list_offline`, host-server unreachable): the `bg-*.state` glob cannot be filtered by project (a state file name is a slug with no project field, and splitting `<project>-<name>` is not injective), so keep listing everything with the existing "using offline state files" note, extended with "cannot filter by project offline".
  - Unknown flag on `list` -> usage error, exit 1. `--all` is the only flag added; no `--project <name>` (YAGNI; `--all` plus reading the header suffices).
- The request must carry the header on both whoami and `/status`: `curl -sf -H "X-Conductor-Agent: ${CONDUCTOR_AGENT_NAME}"`. Factor the curl into one `api_get` helper reused by later Phase 3 tasks (`TASK-0203`, `TASK-0204`), sending the header only when `CONDUCTOR_AGENT_NAME` is non-empty. Escape/validate nothing beyond that: header values come from our own spawn env.
- Keep the script self-contained (env vars + `curl`/optional `jq`), per the shared-dev-commands constraint.
- Output line format for each process stays `<slug> — state: <state>, window: <bool>` so `TASK-0204` can extend it with liveness; do not add the liveness column here.

## Steps

### 1. Confirm inputs  <!-- agent: Explore -->

- [x] Read the finished `TASK-0194` (`host-server/bgAccess.ts` `resolveCallerProject` result type) and `TASK-0193` (`parseCallerHeader`, header name) code with Serena `find_symbol`; record the exact result shape at the top of this task's Approach
- [x] Read the finished `TASK-0196` version of `skills/dev-commands/scripts/dev-commands.sh` (`list` prints slugs, `.bgProcesses[].slug`) and confirm `BgStatus` in `host-server/index.ts` carries `projectId`/`projectName`/`slug` (`buildBgStatuses`)
<!-- Updated: 2026-09-20 -->
- Step 1 discovery: `resolveCallerProject` takes `(header, agents)` only (no `projects`); result lacks `projectName`, so whoami must resolve it from the agent row. `GET /agents/whoami` goes right after `GET /agents` (index.ts ~1938); no `GET /agents/:id` exists, so no collision.

### 2. Server: `GET /agents/whoami`  <!-- agent: general-purpose -->

- [x] Add the route in `host-server/index.ts` beside the other read-only `/agents` routes: parse the header, load `listAgents(db)`/`listProjects(db)`, return the resolver result as specified (always 200)
- [x] Add a short route comment: read-only, exists for the `dev-commands` skill, not an authentication mechanism (same caveat as `TASK-0194`)
- [x] Add resolver-reuse cases to `host-server/bgAccess.test.ts` only if the response mapping is extracted as a pure `describeCaller(result)` helper; otherwise the mapping is a direct pass-through and needs no new test (do not duplicate `TASK-0194`'s resolver tests)
- [x] Add the route to the `host-server/index.ts` routes row
<!-- Updated: 2026-09-20 -->
- Step 2 done: pure `describeCaller(resolution, agents)` + `WhoamiResponse` in `host-server/bgAccess.ts` (adds `projectName` from the agent row; `listProjects` not needed); `GET /agents/whoami` after `GET /agents` in index.ts, always 200; 4 new tests in `bgAccess.test.ts` (node:test; 25/25 pass); host-server `tsc --noEmit` clean. in `CLAUDE.md`'s Core Scripts table

### 3. Skill script  <!-- agent: general-purpose -->

- [x] In `skills/dev-commands/scripts/dev-commands.sh` add `api_get <path>` (curl with `-sf`, optional `X-Conductor-Agent` header) and migrate `fetch_api_status` to it
- [x] Add `resolve_caller_project` (calls `/agents/whoami`, sets `CALLER_PROJECT_ID`/`CALLER_PROJECT_NAME` or a reason string) and rework `cmd_list` per Approach (default project filter, `--all`, fallbacks with stderr notes, per-line project name under `--all`)
- [x] Update the usage text (`list [--all]`) and the header comment block of the script
- [x] `bash -n` the script
<!-- Updated: 2026-09-20 -->
- Step 3 done: `api_get`, `resolve_caller_project` (globals `CALLER_PROJECT_ID`/`CALLER_PROJECT_NAME`/`CALLER_UNRESOLVED_REASON`), `cmd_list [--all]`. Old header `Background processes (from host-server):` was replaced, so Step 4's verify script must not depend on it. Offline notes end with `(cannot filter by project offline)` when `--all` is absent.

### 4. Docs and tests  <!-- agent: general-purpose -->

- [x] Update `skills/dev-commands/SKILL.md`: `argument-hint` (`{list|status|tail} [options]` stays; document `list [--all]`), the "List all registered processes" section (project default, `--all`, the fallback notes), the "When to use" bullets, and the "Offline resilience" bullet for `list`
- [x] Append offline-path checks to `scripts/verify-dev-commands.sh` (append-only, before the Summary block): `list --all` offline works; `list --bogus` exits non-zero with usage; `list` with no `CONDUCTOR_AGENT_NAME` and host-server unreachable prints the "cannot filter by project offline" note and still lists. The live project-filtering round trip is `[DEFERRED-TO-UAT]` and consolidated by `TASK-0208`
- [x] Run `cd host-server && npx tsc --noEmit && npm test`, `bash scripts/verify-dev-commands.sh`, and lint touched files
- [x] Record a live smoke recipe marked `[DEFERRED-TO-UAT]`: two projects each with a bg process, run `CONDUCTOR_AGENT_NAME=<project A agent window> dev-commands.sh list` (only A's processes), `... list --all` (both, with project names), `curl -s -H 'X-Conductor-Agent: <window>' localhost:8788/api/agents/whoami` (matches), and an unknown header value (falls back to all with the note)

<!-- Updated: 2026-09-20 -->
**Step 4 results:** `tsc --noEmit` clean; `bgAccess.test.ts` 25/25; `bash scripts/verify-dev-commands.sh` PASS (19 checks incl. 5 new offline `list` checks); `bash -n` clean on both scripts; shellcheck not installed. Full `npm test`: 488/489, the one failure is `transitionsLog.test.ts` ("buildSnapshot captures reason/matchedPattern/tail15...", a source-regex assertion on `index.ts`'s `detectAgentStatusWithBackgroundJobs(conf, wn, agent.launchCmd, agent.workdir, tail15 ...)` call shape) — caused by another in-flight session's `buildSnapshot` edit, not by the whoami route; left untouched. Smoke recipe lives as a `[DEFERRED-TO-UAT]` comment block at the end of the new section in `scripts/verify-dev-commands.sh` (consolidated by TASK-0208).

## Files touched

- `host-server/index.ts` (one new route), optionally `host-server/bgAccess.ts`/`bgAccess.test.ts`
- `skills/dev-commands/scripts/dev-commands.sh`, `skills/dev-commands/SKILL.md`
- `scripts/verify-dev-commands.sh` (append-only), `CLAUDE.md` (routes row)
- Collision notes: `host-server/index.ts` is hot (other agents edit bg routes); this task adds one isolated route. The skill script and `SKILL.md` are shared with `TASK-0196`, `TASK-0203`, `TASK-0204`: strictly sequential.

## Dependencies

- Depends on: `TASK-0194` (resolver), `TASK-0195` (every bg process has a project, so a project-scoped default never hides a projectless row), `TASK-0196` (slug-based output; same script).
- Blocks: `TASK-0203` (restart subcommand reuses `api_get`/caller header) and `TASK-0204` (same file). Restart and status changes wait on this task to avoid conflicting edits.
- Parallel-safe with `TASK-0190`, `TASK-0191`, `TASK-0192`, `TASK-0193` (disjoint files, apart from the `host-server/index.ts` overlap noted above).
