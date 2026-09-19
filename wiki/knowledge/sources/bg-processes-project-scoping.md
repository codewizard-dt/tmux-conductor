---
id: bg-processes-project-scoping
title: "bg_processes Project Scoping — Migration and Endpoint Shape (ROADMAP-020 Phase 2)"
source: ../../../raw/research/bg-processes-project-scoping/index.md
updated: 2026-09-13
tags: [bg-processes, host-server, sqlite, project-scoping]
---

# bg_processes Project Scoping — Migration and Endpoint Shape (ROADMAP-020 Phase 2)

Concrete implementation research for [[Background Process Registry (bg_processes) — Mechanism and Gaps]]'s "no project scoping" gap, feeding directly into `TASK-156` (ROADMAP-020 Phase 2).

**Recommendation**: add `bg_processes.project_id` as a plain nullable `INTEGER REFERENCES projects(id) ON DELETE SET NULL` via a single `ALTER TABLE` (schema_version 9) — mirroring the *v1* shape `agents.project_id` originally had, not the later per-project-unique-index rebuild (`agents` only needed that rebuild once `POST /projects/:id/agents` required duplicate names across projects; `bg_processes` has no such creation-flow requirement yet). Add the new listing endpoint as `GET /projects/:id/bg-processes`, mirroring the existing `POST /projects/:id/agents` precedent (`host-server/index.ts:2089-2127`), backed by a new `listBgProcesses(db, { projectId })` filter.

**Key confirmation**: live-verified that `GET /status`'s bg-process data (`buildBgStatuses`, `host-server/index.ts:147-151`) and both `POST`/`DELETE /bg-processes` routes are 100% `conductor.conf`-sourced today — `listBgProcesses(db)` exists in `host-server/db.ts` but is called by nothing in `index.ts`, and no `GET /bg-processes` list route exists at all. This means the new project-scoped endpoint will be correct and independently testable, but has no live dashboard effect until ROADMAP-020 Phase 1 (the split-brain fix) lands and routes `GET /status`/the mutation routes through the DB instead of `conductor.conf`.

**Explicit scope boundary**: this task is backend-only (`host-server/db.ts` migration/interfaces/CRUD + the one new route) — it must not touch `conductor.conf`/`config.ts`, `GET /status`'s bg-process branch, or any frontend file (those belong to Phase 1 and Phase 3 respectively).

Full report: `raw/research/bg-processes-project-scoping/index.md` (sources: `raw/research/bg-processes-project-scoping/sources.md`).

relates_to::[[Background Process Registry (bg_processes) — Mechanism and Gaps]]
relates_to::[[Host Server]]
