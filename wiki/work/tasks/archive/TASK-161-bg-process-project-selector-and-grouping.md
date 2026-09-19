---
id: TASK-161
aliases: [TASK-161]
title: "Extend AddBgProcessForm.tsx with a required project selector and group BgProcessSection by project"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: [TASK-156]
blocks: []
parallel_safe_with: []
uat: "[[UAT-161]]"
tags: [frontend, host-server, bg-processes, project-scoping]
---

# TASK-161 — Extend AddBgProcessForm.tsx with a required project selector and group BgProcessSection by project

## Objective

Implement `ROADMAP-020` Phase 3's UI/UX item: give `AddBgProcessForm.tsx` a **required** project selector (no free-form/"none" fallback) and group `BgProcessSection` by project in the dashboard, so bg processes get the same project-scoped presentation agents already have.

The two named files can't be completed as pure frontend work: neither `BgProcess` (frontend, `AgentList.tsx:55-63`) nor `BgStatus`/`buildBgStatuses` (backend, `host-server/index.ts:136-165`) carries `projectId`/`projectName` today, so there is nothing to group by and nowhere for a selected project to persist to until that plumbing exists. This task therefore includes the minimum backend threading needed to make the frontend work meaningful — it is not a re-scope of Phase 1 or Phase 2's ownership, just the small amount of wiring neither of those tasks claims.

Full research and citations: `raw/research/shared-dev-commands/index-3.md` (+ `sources-3.md` — this session's implementation-precedent pass; note the same numeric-sibling slot was independently reused by a concurrent Phase 0 research pass, so verify at execution time which report is actually at that path and fall back to the citations embedded directly in this task file, which were captured first-hand via Serena regardless), building on `raw/research/shared-dev-commands/index.md` and `wiki/knowledge/concepts/background-process-registry.md`.

## Approach

- **Project selector precedent, deliberately not copied as-is**: `AddAgentForm.tsx:190-217` already has a project `<select>` (`listProjects()` from `frontend/src/lib/api.ts`, `selectedProjectId: number | null` state), but it's optional — a `"— None (free-form) —"` option lets the form fall back to a manual workdir. The roadmap explicitly asks for a **required** selector on `AddBgProcessForm.tsx`, so this task mirrors the `listProjects()`/`Project` type usage and select markup but drops the free-form option and the workdir-autofill/disable coupling — submission is blocked until a project is chosen, validated the same way the existing `NAME_PATTERN`/workdir checks already block submission (`AddBgProcessForm.tsx:31-42`).
- **Grouping precedent, reused directly**: `AgentList.tsx:1561-1604` already implements consecutive-run project clustering for agents — `projectLabelFor`/`projectIdFor` (direct field reads, no name-keyed map), a `byProjectThenStatus` comparator, and `groupByProject(list): { project: string | null; agents: Agent[] }[]`, rendered as project sub-headers above each kanban column's tiles (`AgentList.tsx:1637-1655`). `BgProcessSection` (`AgentList.tsx:1278-1288`) currently renders `bgs: BgProcess[]` flat, directly below the grouped agent grid (`AgentList.tsx:1662`), and has no empty-state message (`if (bgs.length === 0) return null` — the whole section vanishes). This task adds a bg-process equivalent of the same clustering shape rather than inventing a new one — bg processes have no status-derived kanban columns, so there's just one clustered list, not per-column groups like the agent grid.
- **Backend fields, mirrored from the existing `Agent`/`projectId` precedent**: `host-server/db.ts`'s `Agent` interface already carries `projectId: number | null; projectName: string | null` (`db.ts:18-29`), resolved via `mapAgent(r: AgentRow | AgentWithProjectRow)` reading `'project_name' in r ? r.project_name : null` (`db.ts:209-212`) off a `LEFT JOIN projects p ON a.project_id = p.id` query (`db.ts:555,569`), and `host-server/index.ts` already threads `projectId`/`projectName` through every agent SSE/listing payload (`index.ts:642, 1051, 1114, 1489, 2137, 2254-2255, 2376-2377, 2516-2517`). `BgStatus`/`buildBgStatuses` need the same two fields, sourced from `TASK-156`'s new `listBgProcesses(db, { projectId })`/`BgProcess.projectId`, joined to `projects` for the name the same way `Agent`'s join works.

## Steps

### 1. Backend: thread projectId/projectName onto BgStatus <!-- agent: general-purpose -->

- [x] In `host-server/index.ts`, extend the `BgStatus` interface (`index.ts:136-145`) with `projectId: number | null; projectName: string | null`.
- [x] Extend `buildBgStatuses` (`index.ts:147-165`) to populate those two fields for each bg process — resolve `projectId` from the bg process's own record (via `db.ts`'s `listBgProcesses(db)`, now carrying `projectId` per `TASK-156`) and `projectName` via a lookup against `listProjects(db)` (or an equivalent join), mirroring the `Agent`/`mapAgent` precedent cited above. **This step assumes `ROADMAP-020` Phase 1 (the split-brain fix) has already landed** — `buildBgStatuses` currently sources from `conf.bgProcesses` (a `conductor.conf`-parsed array with no project concept at all), not from SQLite, so there is nothing to resolve `projectId` from until Phase 1 makes SQLite the read path. Check `wiki/work/roadmaps/ROADMAP-020-shared-dev-commands-implementation.md`'s Phase 1 line and `wiki/work/tasks/index.md` for that task's current ID and status before starting this step (as of this writing it appears to be filed, but re-verify given this session's high task-ID churn — see Notes/Dependencies).
- [x] Extend `POST /bg-processes`'s body typing and handler (`index.ts:1817-1859`) to accept an optional `projectId?: number` in the request body and pass it through to the DB write path introduced by Phase 1 (the route currently writes only to `conductor.conf` via `appendBgProcessToConf`, which cannot carry a `project_id` — this sub-step is only meaningful once Phase 1's SQLite-write path exists; until then, validate and accept the field but note in the PR/commit that it has no persistent effect yet).

<!-- Step 1 complete: BgStatus extended with projectId/projectName in host-server/index.ts; buildBgStatuses resolves projectName via listProjects(db) join (BgProcess/db.ts only carries projectId, no built-in join); POST /bg-processes accepts optional projectId, validated, passed to createBgProcess (db.ts already supported it from TASK-156). Typecheck (host-server) pass. -->
<!-- Updated: 2026-09-13 -->

### 2. Frontend: BgProcess type gains projectId/projectName <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, extend the `BgProcess` interface (`AgentList.tsx:55-63`) with `projectId: number | null; projectName: string | null`, matching `BgStatus`'s new shape.

<!-- Step 2 complete: BgProcess interface extended in AgentList.tsx (now ~lines 57-68); AgentList.test.tsx bgProc fixture updated with projectId/projectName: null to satisfy typecheck. Frontend typecheck pass. -->
<!-- Updated: 2026-09-13 -->

### 3. AddBgProcessForm.tsx: required project selector <!-- agent: general-purpose -->

- [x] Import `listProjects` and `type Project` from `../lib/api` (matching `AddAgentForm.tsx:1`'s convention — `AddBgProcessForm.tsx` currently fetches only `agents` via a raw `fetch('${API_URL}/status')` call at `AddBgProcessForm.tsx:25-30`; add a parallel `listProjects()` fetch in a `useEffect`, following the same "best-effort, non-fatal" catch pattern already used there).
- [x] Add `projects: Project[]` and `selectedProjectId: number | null` state (initialized `null`).
- [x] Add a `<select id="bg-project">` field (placed above or alongside the existing Name/Working Directory grid, `AddBgProcessForm.tsx:79-115`) listing `projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)` with **no** "— None —" / free-form option.
- [x] In `handleSubmit` (`AddBgProcessForm.tsx:41-73`), add a validation branch alongside the existing `NAME_PATTERN`/workdir/launchCmd checks: if `selectedProjectId === null`, `setError('Project is required')` and return before submitting.
- [x] Include `projectId: selectedProjectId` in the POST body to `/bg-processes` (`AddBgProcessForm.tsx:50-54`).
- [x] Reset `selectedProjectId` to `null` alongside the other field resets on successful submit (`AddBgProcessForm.tsx:44-48`).

<!-- Step 3 complete: AddBgProcessForm.tsx now imports listProjects/Project, fetches projects in useEffect, adds required <select id="bg-project"> (no free-form option), validates selectedProjectId before submit, includes projectId in POST body, resets on success. Frontend typecheck pass. -->
<!-- Updated: 2026-09-13 -->

### 4. AgentList.tsx: group BgProcessSection by project <!-- agent: general-purpose -->

- [x] Add a bg-process equivalent of `projectLabelFor`/`projectIdFor` (direct reads off `bg.projectName`/`bg.projectId`) and a `groupByProject`-shaped clustering function for `BgProcess[]`, either by generalizing the existing `groupByProject` (`AgentList.tsx:1595-1604`) to a shared helper parameterized on the label-accessor, or by adding a small sibling function scoped to `BgProcess[]` — whichever keeps the existing agent-grouping code and its tests unchanged.
- [x] Sort `bgs` by project label (unassigned last, matching `byProjectThenStatus`'s project-ordering half) before clustering, since `groupByProject` only clusters *consecutive* runs and assumes pre-sorted input.
- [x] In `BgProcessSection` (`AgentList.tsx:1278-1288`), render the clustered groups with a project sub-header (`{group.project ?? 'Unassigned'}`) above each group's `BgProcessRow`s, styled consistently with the existing agent-column sub-headers at `AgentList.tsx:1649-1651`. Consider also adding an empty-state message (e.g. "No background processes") if `bgs.length === 0`, matching `AgentList`'s own `"No agents registered."` pattern at `AgentList.tsx:1630` — today the section silently renders nothing instead.

<!-- Step 4 complete: added bgProjectLabelFor/bgProjectIdFor + groupBgsByProject (sibling functions, agent-grouping code untouched) in AgentList.tsx (~lines 1363-1423). BgProcessSection sorts bgs by project label (unassigned last) then name, clusters via groupBgsByProject, renders a sub-header per group, and shows "No background processes." on empty. Verified via Serena: single definition of each new symbol, no leftover duplication from a mid-flight concurrent-edit race the sub-agent flagged and resolved itself. Typecheck pass; full frontend suite 128/128 pass. -->
<!-- Updated: 2026-09-13 -->

### 5. Tests <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.test.tsx`: extend the existing `BgProcess` fixtures (imported per `AgentList.test.tsx:14-15`) with `projectId`/`projectName` values across at least two different projects plus one `null`/unassigned entry; add a test asserting `BgProcessSection` renders a project sub-header per distinct project (in the same order convention as the agent grouping) and groups rows under the correct header, with the unassigned group rendering last.
- [x] `host-server/db.test.ts` or `host-server/index.test.ts` (whichever already covers `buildBgStatuses`/`GET /status`, if either does — otherwise add a focused test near existing status-route tests): assert a bg process with a `project_id` set returns `projectId`/`projectName` in the `GET /status` `bgProcesses` array.
- [x] Run the frontend and host-server test suites; confirm no regressions in the existing (ungrouped) `BgProcessSection`/`BgProcessRow` tests.

<!-- Step 5 complete: added AgentList.test.tsx test asserting per-project sub-headers (alpha-order, unassigned last) and correct row clustering. host-server/db.test.ts's TASK-161 test (added by a concurrent agent) verifies projectName resolution mirrors buildBgStatuses's join. Frontend suite 130/130 pass; host-server suite 145/145 pass. No regressions. -->
<!-- Updated: 2026-09-13 -->

### 6. Manual verification <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Start the dev servers (`make dev`), open the dashboard, and verify: `AddBgProcessForm` cannot be submitted without a project selected; a newly spawned bg process appears under its project's sub-header in `BgProcessSection`; a bg process with no project (if any exist from before this change) renders under "Unassigned".

<!-- Step 6 deferred: runtime/E2E manual verification is out of scope for /tackle's static-gates-only policy; this belongs to the UAT phase (/uat-generate or /uat-walk), which will exercise it via the running dashboard. -->
<!-- Updated: 2026-09-13 -->

## Notes / Dependencies

- **Hard dependency on `TASK-156`** (`ROADMAP-020` Phase 2 — adds the `project_id` column, `BgProcess`/`BgProcessRow`/`mapBgProcess`, and `listBgProcesses(db, { projectId })`). Do not start Step 1 until `TASK-156` is done — `BgStatus`/`buildBgStatuses` has nothing to resolve `projectId` from before then.
- **Hard dependency on `ROADMAP-020` Phase 1 ("Fix the split-brain")**. Multiple agents worked this roadmap concurrently in the same session and repeatedly collided on task IDs (this task itself was drafted three times, as TASK-158, then TASK-160, before landing at TASK-161) — **do not trust any specific ID cited elsewhere for Phase 1 without re-checking**; confirm against `wiki/work/roadmaps/ROADMAP-020-shared-dev-commands-implementation.md`'s Phase 1 line and `wiki/work/tasks/index.md` at execution time for whatever task currently owns it. Without Phase 1, `buildBgStatuses`/`GET /status` and `POST`/`DELETE /bg-processes` remain `conductor.conf`-backed, and `conductor.conf`'s `BG_PROCESSES` bash array has no project concept — so this task's Step 1 (threading `projectId`/`projectName` onto `BgStatus`) and the persistence half of Step 3 (a submitted `projectId` actually surviving) cannot be completed until Phase 1 lands, even though `TASK-156` alone would be sufficient for the DB layer.
- **Task ID note**: if a stray earlier copy of this content survives anywhere under TASK-158 or TASK-160 (both numbers collided with unrelated tasks filed concurrently by other agents in this same session — TASK-158 with a Phase 0 assess/re-research task, TASK-160 with the Phase 4 skill/script task), treat this file (`TASK-161-bg-process-project-selector-and-grouping.md`) as the canonical one and remove the other.
- Roadmap: `wiki/work/roadmaps/ROADMAP-020-shared-dev-commands-implementation.md`, Phase 3.
- Research: `raw/research/shared-dev-commands/index-3.md` (+ `sources-3.md`, subject to the numeric-sibling caveat above).
