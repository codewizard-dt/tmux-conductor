---
topic: "Add project_id to bg_processes (migration + BgProcess/BgProcessRow/mapBgProcess) and a project-filtered listing endpoint, per ROADMAP-020 Phase 2"
slug: bg-processes-project-scoping
researched: 2026-09-13
---

# Primary Sources — bg_processes project scoping (ROADMAP-020 Phase 2)

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/db.ts` — `runMigrations` (lines 278-446), `Agent`/`AgentRow`/`mapAgent` (lines 18-29, ~127-129, 209-210), `POST /projects/:id/agents` in `host-server/index.ts` (2089-2127) | 2026-09-13 | Two-stage evolution of `agents.project_id` (v1 plain nullable column + global unique name at lines 291-298; v2 per-project unique-index rebuild at lines 336-359, driven by the project-scoped-creation route's need for cross-project name duplication) — the precedent for recommending a v1-only shape for `bg_processes.project_id` |
| S2 | codebase | `host-server/index.ts` — `buildBgStatuses` (147-151), its call site (2404), `POST /bg-processes` (1816-1859), `DELETE /bg-processes/:name` (1861-1889), `host-server/config.ts` — `appendBgProcessToConf`/`removeBgProcessFromConf` (234, 254); `host-server/db.ts` — `listBgProcesses`/`createBgProcess`/`deleteBgProcess` (674-687), `seedFromLegacy` (448-481) | 2026-09-13 | Confirms the live split-brain: `GET /status` and both bg-process mutation routes are 100% `conductor.conf`-sourced; `listBgProcesses(db)` exists but is called by nothing in `index.ts`; no `GET /bg-processes` list route exists at all today |
| S3 | codebase | `host-server/db.migration.test.ts` — bg_processes fixtures (lines 125-130, 811-813) | 2026-09-13 | Established fixture-per-schema-version test pattern already covering `bg_processes`, to be extended for the new v9 migration |
| S4 | codebase | `frontend/src/components/AgentList.tsx` (1349-1421, 1487-1488, 1661), `frontend/src/components/AddBgProcessForm.tsx` (24-25) | 2026-09-13 | Confirms the frontend's only bg-process data sources are `GET /status`'s `bgProcesses` field and `bg-update`/`bg-removed` SSE events, both `conf`-derived; no frontend code currently calls any DB-backed bg-process endpoint — supports scoping this task to backend-only |
