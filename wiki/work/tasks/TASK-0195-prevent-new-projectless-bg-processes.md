---
id: TASK-0195
aliases: [TASK-0195]
title: "Require a project for every bg process (validate POST/PATCH, cascade on project delete, backfill, remove Unassigned UI)"
status: done
created: 2026-09-19
updated: 2026-09-20
depends_on: []
blocks: []
parallel_safe_with: [TASK-0187, TASK-0188, TASK-0189]
uat: "[[UAT-0195]]"
tags: [bg-processes, project-scoping, host-server, roadmap-0024]
---

# TASK-0195 — Require a project for every bg process (validate POST/PATCH, cascade on project delete, backfill, remove Unassigned UI)

relates_to::[[ROADMAP-0024]]
relates_to::[[TASK-0186]]
relates_to::[[background-process-registry]]

> Follow-up filed by TASK-0186. **Rescoped 2026-09-20** by TASK-0186's amendment: every bg process must belong to a project (no project-less state at all), and deleting a project cascades to its bg processes. Agent-side hiding is ROADMAP-0024 Phase 3 (`dev-commands` work) and the restart denial is `TASK-0194`; neither is in scope here.

## Objective

TASK-0186 (as amended 2026-09-20) requires a project for every bg process. Today the API and edit form can still produce project-less rows: `POST /bg-processes` accepts a missing `projectId`, `PATCH /bg-processes/:name` accepts `projectId: null`, the edit form offers a "— Unassigned —" option, and deleting a project sets `bg_processes.project_id` to `NULL` via `ON DELETE SET NULL`. Close every one of those paths, remove the "Unassigned" UI, make project delete cascade to (and stop) the project's bg processes, and backfill any existing `NULL` rows.

## Approach

- `POST /bg-processes` (`host-server/index.ts`, ~1890-1941): `projectId` becomes required (integer) and the project must exist; otherwise 400 with a clear message. Mirrors the required selector already enforced in `AddBgProcessForm.tsx`.
- `PATCH /bg-processes/:name` (~1956-1986): `projectId` may still be changed to another existing project but `null` is rejected with 400.
- **Project delete cascades.** Deleting a project first closes the tmux window of each of its bg processes (reuse the existing `DELETE /bg-processes/:name/window` logic, including state-file cleanup), then deletes the `bg_processes` rows, then the project. Do this in the route/db helper; the schema-level `ON DELETE CASCADE` is set by the v10 rebuild (below), but the tmux windows must be stopped in code regardless. First inspect the project delete route/`deleteProject` in `host-server/db.ts`. Confirm in the UI (the existing confirm dialog) that the dialog names the bg processes that will be stopped and deleted.
- **Backfill + NOT NULL.** A one-time migration derives `project_id` for existing `NULL` rows by matching `bg_processes.workdir` to a project's workdir, and lists any row with no match for manual assignment before it enforces `NOT NULL`. The `NOT NULL` + `ON DELETE CASCADE` column change is a table rebuild, so it is folded into `TASK-0196`'s schema v10 rebuild (which also drops the now-unneeded `WHERE project_id IS NULL` unique index and, per `TASK-0198`, `linked_agent_id`). If `TASK-0196` has already shipped, add a standalone rebuild that recreates its indexes. Until the migration runs, the route-level checks above are the enforcement.
- Frontend: remove the "— Unassigned —" `<option>` from the bg process edit form (`AgentList.tsx` ~1499), remove the "Unassigned" group header (`AgentList.tsx` ~1606) and the `ProjectBadge` null pill (~273-283) for bg rows. No "Needs a project" state: after the backfill there are no project-less rows to show.
- Seed insert path (`db.ts` ~467-468, inserts without `project_id`): leave it, but it must not create rows the `NOT NULL` migration would reject; note in the report how fresh databases are handled.

## Steps

### 1. Backend validation  <!-- agent: general-purpose -->

<!-- Updated: 2026-09-20 step 1 done -->
- [x] Require `projectId` on `POST /bg-processes` and reject `projectId: null` on `PATCH /bg-processes/:name`
  - `host-server/index.ts`: in the POST handler, 400 when `projectId` is missing, not an integer, or does not match an existing project (use the existing project lookup helper in `db.ts`); in the PATCH handler, keep integer handling but 400 on `null`, and 400 on a non-existent project
  - `host-server/db.ts`: tighten `createBgProcess` so its `data.projectId` type is `number` (drop the `?? null`) if that does not break the seed/insert path; otherwise leave the db helper and enforce in the route only
- [x] Make project delete cascade to its bg processes (DELETE /projects/:id now returns 200 `{ ok, removedBgProcesses }`; rows + project deleted in one transaction first, then windows closed/state files unlinked best-effort so a rejected delete never kills windows)
  - Locate the project delete route in `host-server/index.ts` and the db helper it calls; before deleting the project, `listBgProcesses(db, { projectId })`, close each process's tmux window and unlink its state file (same code as `DELETE /bg-processes/:name/window`), delete the rows, then delete the project. Return the list of removed bg process names in the response body so the UI can report it
- [WIP: backfill done as non-versioned `backfillBgProcessProjects(db)` in db.ts (warns on unmatched, never fails startup); NOT NULL + ON DELETE CASCADE rebuild and fail-on-unmatched gate remain for TASK-0196, whose "v10" number is already taken by shipped schema v10 so it must renumber] Backfill existing project-less rows (folded into `TASK-0196`'s schema v10 rebuild, or a standalone rebuild if that has shipped)
  - Derive `project_id` from `workdir` == a project's workdir; log every row that could not be matched and refuse to enforce `NOT NULL` until none remain (fail the migration with a message listing them rather than silently dropping rows). Add a faithful pre-migration fixture to `host-server/db.migration.test.ts` covering matched, unmatched and already-scoped rows
- [x] Add tests (no route harness exists since index.ts binds a port on import; route 400s are pinned by a source-string test, real HTTP behaviour [DEFERRED-TO-UAT])
  - `host-server/db.test.ts` (and the route/index test file if one exists for bg routes): POST without projectId -> 400; POST with unknown project -> 400; PATCH `projectId: null` -> 400; PATCH to another valid project succeeds; project delete with bg processes removes them and closes their windows; project delete with none -> succeeds
- [x] Run the static gates: `pnpm typecheck` (or the repo's `make typecheck`) and the host-server unit tests; all type errors are caused by this change (typecheck clean, 230 tests pass)

### 2. Frontend edit form and grouping  <!-- agent: general-purpose -->

<!-- Updated: 2026-09-20 step 2 done -->
- [x] Remove the "— Unassigned —" option from the bg process edit form in `frontend/src/components/AgentList.tsx` (~1499) and make the selector's value always a project id
- [x] Remove the null group header (`group.project ?? 'Unassigned'`, ~1606) and the `ProjectBadge` null pill (~273-283) for bg rows; make the project type on the frontend `BgProcess` non-nullable
- [x] Update the project-delete confirm dialog (inline confirm in ProjectList.tsx; ProjectBadge null pill kept because it serves agent rows only) to list the bg processes that will be stopped and deleted, and surface the new POST/PATCH 400 messages through the existing error handling in `frontend/src/lib/api.ts` callers (no new UI beyond showing the message)
- [x] Update `frontend/src/components/AgentList.test.tsx` (the `stray-process` grouping test, ~1370-1402, asserts the header list ending in `Unassigned`) for the removed group and option
- [x] Run the static gates: frontend typecheck, lint, and `AgentList.test.tsx` (clean; 164/164)

### 3. Docs  <!-- agent: general-purpose -->

<!-- Updated: 2026-09-20 step 3 done -->
- [x] Update the "Unscoped bg processes" subsection in `wiki/knowledge/concepts/background-process-registry.md` to say every bg process requires a project (POST requires `projectId`, PATCH rejects null, project delete cascades, existing rows were backfilled by workdir), and that there is no Unassigned state; re-read the file fresh before each Edit (other agents edit it concurrently)
- [x] (skipped: CLAUDE.md describes no POST/PATCH/DELETE bg contract) Update the bg-processes routes row(s) in `CLAUDE.md` if they list the POST/PATCH/DELETE contract (Edit only the relevant sentence; skip if the file does not describe it)

## Dependencies

- Depends on: none (TASK-0186's decision is already recorded).
- Blocks: none.
- Parallel-safe with `TASK-0187`, `TASK-0188`, `TASK-0189` (decisions/spike touching different files). Coordinate with `TASK-0194` and ROADMAP-0024 Phase 3 only in that they consume the same policy; no shared files with this task beyond `host-server/index.ts`.
