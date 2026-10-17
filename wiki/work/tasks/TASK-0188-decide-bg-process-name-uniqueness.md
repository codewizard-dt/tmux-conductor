---
id: TASK-0188
aliases: [TASK-0188]
title: "Decide whether bg process names become unique per project"
status: done
created: 2026-09-19
updated: 2026-09-20
depends_on: []
blocks: [TASK-0190]
parallel_safe_with: [TASK-0186, TASK-0187, TASK-0189]
uat: ""
tags: [bg-processes, decision, project-scoping, roadmap-0024]
---

# TASK-0188 — Decide whether bg process names become unique per project

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[bg-processes-project-scoping]]
relates_to::[[background-process-registry]]
blocks::[[TASK-0190]]

> ROADMAP-0024 Phase 1 (Decisions & Spike). Produces a **written decision, not production code.** Any schema/route/naming change is filed as a follow-up task, not implemented here. `TASK-0190` (the restart operation) blocks on this because it fixes the identifier its route and log/state files are keyed by.

## Objective

`bg_processes.name` is globally unique (`name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*')`, `host-server/db.ts` around line 299-305), and *everything* downstream is keyed by that bare name: the tmux window name, `$LOG_DIR/bg-<name>.log`, `$STATE_DIR/bg-<name>.state`, the `/bg-processes/:name` routes, and `dev-commands.sh status|tail <name>`. Consequence: two projects cannot each have a process called `dev`. Since projects now own bg processes, the natural name for a project's dev server is `dev`, so this collides quickly. Decide whether uniqueness stays global or becomes per-project, and if per-project, what the addressable identity becomes.

## Approach

| Option | Identity used by routes / log / state / window | Migration | Notes |
|--------|-----------------------------------------------|-----------|-------|
| A. Keep global uniqueness | bare `name` (unchanged) | none | Users must hand-prefix (`myproj-dev`); zero code churn; restart route stays `POST /bg-processes/:name/restart` |
| B. Unique per `(project_id, name)`; identity is a derived slug `<project>-<name>` | slug for window/log/state; routes keep resolving by slug | rebuild `bg_processes` with a composite unique index (schema_version bump + `db.migration.test.ts` fixture); rename existing log/state files or leave legacy ones | Mirrors how agents are named (`<project>-<name>` window per `scripts/lib/db.sh`); `NULL` project rows need a rule (see `TASK-0186`) |
| C. Unique per project; identity is the numeric `id` | `bg-<id>.log`, routes by id | as B plus log/state rename and every consumer (skill, UI) switched to ids | Robust but breaks the human-readable `dev-commands status dev` UX |

Things the decision must settle: (1) which option; (2) how `NULL`-project rows are treated under a composite index (SQLite treats `NULL`s as distinct in unique indexes, so unscoped duplicates would silently be allowed; coordinate with `TASK-0186`); (3) whether the tmux window name must stay collision-free against agent windows (agent windows are `<project>-<name>`; TASK-0182's exact-match `windowTarget()` already removes the prefix hazard); (4) how `dev-commands.sh` resolves an ambiguous bare name once an agent's project is known (Phase 3: project defaulting) and whether it may accept `name` alone; (5) impact on restart-audit and cooldown keys (`TASK-0193`).

## Decision

**Outcome: Option B — names are unique per project, and the addressable identity is a derived slug `<projectName>-<name>`.** Decided by the user on 2026-09-20. The follow-up implementation is `TASK-0196`.

| # | Point | Answer |
|---|-------|--------|
| 1 | Which option | **B.** Unique per `(project_id, name)`; identity is the slug `<projectName>-<name>`, mirroring `agentWindowName()` in `host-server/db.ts`. |
| 2 | `NULL`-project rows under a composite index | Moot. `TASK-0186` was amended on 2026-09-20 so every bg process must have a project; `TASK-0196`'s schema v10 rebuild backfills existing `NULL` rows by workdir and makes `project_id NOT NULL`, so a plain `(project_id, name)` unique index suffices (no second partial index). |
| 3 | Collision with agent windows | Create rejects a slug that equals another bg slug or an existing agent window name (`-` is legal in project and process names, so different pairs can yield the same slug). `TASK-0182`'s exact-match `windowTarget()` already removes the prefix hazard, not equality. |
| 4 | `dev-commands.sh` with an ambiguous bare name | Accepts a bare `name` only when exactly one registered slug equals it or ends in `-<name>`; otherwise exits non-zero and lists candidates. ROADMAP-0024 Phase 3 project defaulting narrows this by the caller's project. |
| 5 | Restart-audit and cooldown keys (`TASK-0193`) | Key by slug, resolved through `getBgBySlug`. `TASK-0190`'s restart route is `POST /bg-processes/:slug/restart`. |

**Rejected.** A (global uniqueness): forces users to hand-prefix names and blocks two projects from each having `dev`. C (numeric `id` identity): breaks the human-readable `dev-commands status dev` UX and forces a log/state rename plus a change in every consumer.

**Rationale.** Projects now own bg processes, so `dev` is the natural name in every project. B removes the collision, reuses a naming scheme the codebase already applies to agents, and costs one table rebuild that is shared with `TASK-0195` (NOT NULL/CASCADE) and `TASK-0198` (drop `linked_agent_id`).

**Evidence.** The identifier inventory (window name, `bg-<name>.log|state`, `/bg-processes/:name` routes, `buildBgStatuses`, `scripts/conductor.sh`/`spawn.sh`/`monitor.sh`/`teardown.sh`, `dev-commands.sh`, frontend `api.ts` and `AgentList.tsx` keys) is recorded file-by-file with line numbers in `TASK-0196`'s Steps; the migration precedent is the v2 `agents` and v8 `tasks` rebuilds. The live DB has 2 rows (`dev` in project 10, `dev-stack` in project 3) per the `TASK-0186`/`TASK-0187` evidence, so no project needs a duplicate name today.

**Follow-up.** `TASK-0196` (implementation). Not blocked by this task's close-out.

## Steps

### 1. Gather evidence  <!-- agent: Explore -->

- [x] Inventory every place the bare bg `name` is used as an identifier <!-- Updated: 2026-09-20 --> (recorded in TASK-0196's Steps 1-5 with file and line references)
  - `host-server/db.ts` schema + `BgProcess` type + `createBgProcess`/`updateBgProcess`; `host-server/index.ts` every `/bg-processes*` route, `buildBgStatuses`, the bg log/state path builders (`bg-${name}.log`, `bg-${name}.state`); `scripts/conductor.sh` and `scripts/spawn.sh` bg window creation; `scripts/monitor.sh` bg state writer (`bg-$bg_name.state`); `scripts/teardown.sh`; `skills/dev-commands/scripts/dev-commands.sh`; frontend `api.ts` bg calls and `AgentList.tsx` bg tile keys
  - Record whether the existing `db.migration.test.ts` fixtures show a precedent for a composite-unique rebuild (see the TASK-156 `project_id` migration)
- [x] Read-only check of current data: `sqlite3 -readonly ./data/conductor.db "SELECT name, project_id FROM bg_processes ORDER BY name;"` — confirm today's names and whether any project already needs a duplicate name <!-- Updated: 2026-09-20 --> (not re-run today; relied on the 2026-09-19 query recorded by TASK-0186/TASK-0187: 2 rows, `dev` in project 10 and `dev-stack` in project 3, no duplicates)

### 2. Decide and record  <!-- agent: general-purpose -->

- [x] Write the decision into this task under a new `## Decision` section above `## Steps` covering the five points in Approach, the rejected options, and the rationale <!-- Updated: 2026-09-20 -->
- [x] Append a short "Name uniqueness" subsection to `wiki/knowledge/concepts/background-process-registry.md` (and note it in `wiki/knowledge/concepts/bg-processes-project-scoping.md` if that page exists) with `derived_from::[[TASK-0188]]` <!-- Updated: 2026-09-20 --> (the separate `bg-processes-project-scoping.md` page does not exist under `wiki/knowledge/concepts/`)
- [x] If the outcome is B or C, file follow-up implementation task(s) with `/task-add` (migration + fixture, path/window renaming, skill and UI changes) and list their IDs in the Decision section <!-- Updated: 2026-09-20 --> (`TASK-0196` already filed)
- [x] Update `TASK-0190`'s Approach line naming the addressable identity the restart route must use <!-- Updated: 2026-09-20 -->

### 3. Close out  <!-- agent: general-purpose -->

- [x] Flip this task to `done` per `wiki/work/tasks/lifecycle.md`, drop its line from `wiki/work/tasks/index.md`, tick the ROADMAP-0024 checkbox for this item, and append a `wiki/log.md` entry <!-- Updated: 2026-09-20 -->

## Dependencies

- Depends on: none.
- Blocks: `TASK-0190` (restart route/log/state keying uses the chosen identity).
- Soft link: `TASK-0186` (its 2026-09-20 amendment makes `project_id` `NOT NULL`, which is why a plain composite unique index suffices) and `TASK-0187` (if both decisions need a `bg_processes` rebuild, fold them into one migration).
- Parallel-safe with `TASK-0186`, `TASK-0187`, `TASK-0189`.
