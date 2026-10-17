---
id: TASK-0186
aliases: [TASK-0186]
title: "Decide how bg processes with no project are treated (visible to all, hidden, or must be assigned)"
status: done
created: 2026-09-19
updated: 2026-09-19
depends_on: []
blocks: [TASK-0194]
parallel_safe_with: [TASK-0187, TASK-0188, TASK-0189]
uat: ""
tags: [bg-processes, decision, project-scoping, roadmap-0024]
---

# TASK-0186 — Decide how bg processes with no project are treated (visible to all, hidden, or must be assigned)

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
blocks::[[TASK-0194]]

> ROADMAP-0024 Phase 1 (Decisions & Spike). This task produces a **written decision, not production code.** The decision unblocks the same-project restart guard (`TASK-0194`) and the project-defaulting `dev-commands list` (ROADMAP-0024 Phase 3).

## Objective

`bg_processes.project_id` is nullable (added by TASK-156 as `project_id INTEGER NULL`). Rows created before ROADMAP-020, and any row whose project was later removed, have `project_id = NULL`. The dashboard's create form now requires a project (TASK-161), so *new* rows are always scoped, but the legacy `NULL` rows still exist and every agent-facing path has to decide what an agent in project P may do with them. Pick exactly one policy and record it so `TASK-0194` and the `dev-commands` changes implement one rule instead of guessing.

## Approach

Evaluate three candidate policies against the current code and pick one:

| Policy | Agent `list`/`status`/`tail` | Agent `restart` | Cost |
|--------|------------------------------|-----------------|------|
| A. Visible to all | every agent sees unscoped rows | any agent may restart them (no project to compare) | zero migration; weakest guard; unscoped shared dev server can be restart-looped by anyone |
| B. Hidden | agents never see unscoped rows | denied | orphaned rows become unreachable from agents; dashboard-only |
| C. Must be assigned | unscoped rows are surfaced in the dashboard as "needs a project"; agents see nothing until assigned | denied until assigned | needs a one-time backfill/assign UX; strictest and most consistent with TASK-161's required selector |

Evidence to gather first (read-only): how many `NULL` rows exist in the live DB, and whether the existing rows are agent-linked (`linked_agent_id`) — a linked row whose agent has a project could be auto-assigned that project, which shrinks the problem for option C.

Decision output must state, for unscoped rows: (1) agent list/status/tail visibility, (2) restart permission, (3) dashboard treatment, (4) whether a one-time backfill is required and how it is derived.

## Decision

**Chosen policy: C, must be assigned.** A bg process with `project_id IS NULL` is a dashboard-only orphan that needs a project before any agent can see or restart it.

**Evidence.** The live DB (`./data/conductor.db`) has 2 `bg_processes` rows (dev-stack in project 3, dev in project 10), 0 with `NULL project_id`, and neither has a `linked_agent_id`, so nothing needs backfilling today. `NULL` rows can still be produced by `bg_processes.project_id ... ON DELETE SET NULL` (`host-server/db.ts` ~300, on project delete), `POST /bg-processes` accepting a missing `projectId` (`host-server/index.ts` ~1890-1941), `PATCH` accepting `projectId: null` (~1956-1986), and the edit form's "— Unassigned —" option (`AgentList.tsx` ~1499). Today every read path (`GET /status`, `dev-commands` `list`/`status`/`tail`, the UI) treats `NULL` rows exactly like scoped ones; only `GET /projects/:id/bg-processes` excludes them. The dashboard already renders them under an "Unassigned" group (`AgentList.tsx` ~1606, TASK-161).

| # | Point | Rule for unscoped rows |
|---|-------|------------------------|
| 1 | Agent `list`/`status`/`tail` visibility | Agents see nothing. `dev-commands list` defaults to the caller's project and never shows `NULL` rows; `status`/`tail` on a `NULL` row's name are refused as not found in the caller's project. Implemented by ROADMAP-0024 Phase 3 (`dev-commands` work). |
| 2 | Restart permission | Denied for every agent caller until the row is assigned a project (fail closed, same as an unknown/ambiguous caller in `TASK-0194`'s `authorizeRestart`). Dashboard/human callers with no `X-Conductor-Agent` header are unaffected. |
| 3 | Dashboard treatment | Keep the existing "Unassigned" group but treat it as a "needs a project" state: visible, and editable through the existing edit form's project selector. No new page. |
| 4 | Backfill | None required now (0 `NULL` rows). If `NULL` rows appear, derive by `linked_agent_id` -> that agent's `project_id` when set, otherwise assign manually in the dashboard. Prevent new orphans at the source rather than backfilling: require `projectId` on `POST /bg-processes`, reject `projectId: null` on `PATCH`, and decide project-delete behaviour (block deleting a project that owns bg processes, or keep `ON DELETE SET NULL` and rely on the Unassigned group). |

**Rejected.**

| Policy | Why not |
|--------|---------|
| A. Visible to all | Weakest guard. An unscoped shared server could be restart-looped by any agent, and it defeats the project boundary `TASK-0194` enforces. |
| B. Hidden | Same agent-side denial as C, but orphans become permanently unreachable from agents with no visible path back. C keeps the denial and keeps a way to repair them. |

**Reason.** C is consistent with TASK-161's required project selector, is the strictest guard, and costs almost nothing because the live data has no `NULL` rows.

**Follow-up.** Source-side enforcement (required `projectId` on POST, reject null on PATCH, project-delete behaviour, "needs a project" dashboard wording) is filed as `TASK-0195`. Agent-side hiding is already covered by ROADMAP-0024 Phase 3, and the restart denial by `TASK-0194`.

### Amendment 2026-09-20 — a project is required for every bg process (supersedes policy C's orphan state)

The user tightened this decision: **every bg process must belong to a project; there is no project-less state.** Policy C's "dashboard-only orphan that must be assigned" is removed rather than tolerated.

| # | Point | Rule after the amendment |
|---|-------|--------------------------|
| 1 | Agent `list`/`status`/`tail` visibility | Unchanged in effect: agents see only their project's processes. There are no unscoped rows to hide once the migration below has run. |
| 2 | Restart permission | Same-project callers only (`TASK-0194`). The `unscoped` denial reason stays as a fail-closed guard for any row that slips through, but should never trigger. |
| 3 | Dashboard treatment | No "Unassigned" / "Needs a project" group and no "— Unassigned —" option in the edit form. |
| 4 | Backfill | One-time migration derives `project_id` for existing `NULL` rows by matching each row's `workdir` to a project's workdir. A row with no match is listed for manual assignment before `project_id` can be made `NOT NULL`. |
| 5 | Project delete | **Cascade**: deleting a project stops and deletes its bg processes (close each tmux window first, then remove the row). This replaces the earlier "block with 409" idea. |

The live DB had 0 `NULL` rows on 2026-09-19, so the backfill is expected to be a no-op here; it exists for other installs.

**Consequences for other tasks.** `TASK-0195` is rescoped to this rule (required `projectId`, no null on PATCH, cascade on project delete, remove the Unassigned UI, `NOT NULL` enforcement). The `NOT NULL` + `ON DELETE CASCADE` schema change and the workdir backfill ride in the schema v10 rebuild of `TASK-0196`, so `TASK-0196`'s second partial unique index (`WHERE project_id IS NULL`) is no longer needed. `TASK-0194` keeps its fail-closed `unscoped` branch.

## Steps

### 1. Gather evidence  <!-- agent: Explore -->

- [x] Count and characterise `NULL project_id` rows without mutating anything <!-- Updated: 2026-09-19 --> (live DB: 2 bg rows, 0 NULL; NULL rows still reachable via ON DELETE SET NULL, API POST without projectId, PATCH projectId:null, and the edit form's "Unassigned" option)
  - Run a read-only query against `./data/conductor.db` (never edit): `SELECT id, name, project_id, linked_agent_id FROM bg_processes WHERE project_id IS NULL;` — use `sqlite3 -readonly` from the repo root; record the count and whether each row has a `linked_agent_id` whose agent has a `project_id`
  - Read `host-server/db.ts` `listBgProcesses`/`createBgProcess`/`updateBgProcess` and `host-server/index.ts` `buildBgStatuses` + `GET /projects/:id/bg-processes` to record exactly how `NULL` rows are filtered today (does the project-filtered endpoint exclude them? does `GET /status` include them?)
  - Read `skills/dev-commands/scripts/dev-commands.sh` `list` to record what an agent sees today
  - Read the TASK-161 archived task (`wiki/work/tasks/archive/TASK-161-bg-process-project-selector-and-grouping.md`) to record how the UI treats unscoped rows

### 2. Decide and record  <!-- agent: general-purpose -->

- [x] Write the decision into this task under a new `## Decision` section (immediately above `## Steps`), covering all four points from the Approach, the rejected options, and the reason
- [x] Append a short "Unscoped bg processes" subsection to `wiki/knowledge/concepts/background-process-registry.md` stating the chosen policy, linking back with `derived_from::[[TASK-0186]]`
- [x] If the chosen policy needs code or a migration (for example a backfill or a "needs a project" dashboard state), do NOT implement it here; file it as a follow-up with `/task-add` and reference the new ID in the Decision section
- [x] Update `TASK-0194`'s Approach paragraph to cite the chosen policy (one-line edit; leave its steps to `/task-update` if the decision changes them materially)

### 3. Close out  <!-- agent: general-purpose -->

- [x] Flip this task to `done` per `wiki/work/tasks/lifecycle.md`, drop its line from `wiki/work/tasks/index.md`, tick the ROADMAP-0024 checkbox for this item, and append a `wiki/log.md` entry

## Dependencies

- Depends on: none.
- Blocks: `TASK-0194` (same-project restart restriction consumes the policy for `NULL` rows).
- Parallel-safe with `TASK-0187`, `TASK-0188`, `TASK-0189` (all Phase 1 decisions/spike; they touch different files).
