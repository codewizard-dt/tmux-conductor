---
id: UAT-161
aliases: [UAT-161]
title: "UAT: Bg-process project selector and BgProcessSection grouping"
status: passed
task: TASK-161
created: 2026-09-13
updated: 2026-09-13
---

# UAT-161 — UAT: Bg-process project selector and BgProcessSection grouping

implements::[[TASK-161]]

> **Source task**: [[TASK-161]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Backend (`host-server`) running on port 8788: reachable at `http://localhost:8788/api` (note the `/api` prefix — confirmed live at generation time via `curl http://localhost:8788/api/status`)
- [ ] Frontend running on port 4321: `http://localhost:4321` (confirmed live at generation time)
- [ ] A tmux session named `conductor` is alive: `tmux has-session -t conductor`. This is required for **every** `POST /api/bg-processes` case below (UAT-API-001, UAT-API-003, UAT-EDGE-001) — `host-server/index.ts`'s handler checks session liveness *before* it validates `projectId`, so even the pure-validation case (UAT-API-003) 409s instead of reaching its assertion without a live session.
- [ ] `jq` available for parsing `GET /api/status` responses.
- [ ] No project named `uat161-project` and no bg process named `uat161-bg-scoped` / `uat161-bg-unscoped` / `uat161-bg-badtype` / `uat161-ui-block-test` / `uat161-e2e-check` already exist (fresh names chosen to avoid collision with real data).

---

## Test Cases

### UAT-API-001: POST /api/bg-processes — projectId round-trips in the create response
- **Endpoint**: `POST /api/bg-processes`
- **Description**: Verifies the route accepts the new optional `projectId` field (`host-server/index.ts:1826`), persists it via `createBgProcess`, and echoes it back in the 201 response.
- **Steps**:
  1. Create a dedicated test project and note its `id` (replace `PROJECT_ID` below):
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat161-project","workdir":"/tmp"}'
     ```
  2. Run the command below with `PROJECT_ID` replaced by that id.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"uat161-bg-scoped","workdir":"/tmp","launchCmd":"sleep 3600","projectId":PROJECT_ID}'
  ```
- **Expected Result**: HTTP 201. Body: `{"ok":true,"bg":{"name":"uat161-bg-scoped","workdir":"/tmp","launchCmd":"sleep 3600","linkedAgent":null,"projectId":PROJECT_ID}}` (numeric `PROJECT_ID`, not a string).
- **Repeatable Unit Test**: Not applicable: requires a live host-server process plus a real tmux session (`spawnSync('tmux', ['has-session', ...])`, `execSync('tmux new-window', ...)`); `host-server/index.ts` cannot be imported in isolation for a unit test (opens a real on-disk DB and calls `fastify.listen()` at module scope — see the note above `host-server/db.test.ts:214-219`).
- [x] Pass <!-- 2026-09-13: created project id=10, live POST returned HTTP 201 with body {"ok":true,"bg":{"name":"uat161-bg-scoped","workdir":"/tmp","launchCmd":"sleep 3600","linkedAgent":null,"projectId":10}} — exact match -->

<!-- PROJECT_ID for this run = 10 -->


---

### UAT-API-002: GET /api/status — bgProcesses[] resolves projectId + projectName for a scoped process
- **Endpoint**: `GET /api/status`
- **Description**: Verifies `buildBgStatuses` (`host-server/index.ts:149-165`) joins the bg process's `projectId` against `listProjects(db)` and exposes both `projectId` and `projectName` on the `BgStatus` entry.
- **Steps**:
  1. Reuse the bg process created in UAT-API-001 (`uat161-bg-scoped`, scoped to `PROJECT_ID` / `uat161-project`).
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '.bgProcesses[] | select(.name=="uat161-bg-scoped")'
  ```
- **Expected Result**: HTTP 200. The matched object has `"projectId": PROJECT_ID` and `"projectName": "uat161-project"`, alongside the pre-existing `BgStatus` fields (`windowPresent: true`, `workdir: "/tmp"`, `launchCmd: "sleep 3600"`, `linkedAgent: null`).
- **Repeatable Unit Test**: Not applicable: `buildBgStatuses` is not independently importable (see UAT-API-001); the exact join expression it uses (`bg.projectId !== null ? (projects.find((p) => p.id === bg.projectId)?.name ?? null) : null`) is already unit-tested at the db layer in `host-server/db.test.ts` (`TASK-161: a bg process with a project_id set resolves projectName via listProjects...`, lines 211-247).
- **Unit Test Command**: `npx vitest run --root host-server db.test.ts` is not this case's evidence — see the referenced db.test.ts case instead; run via `cd host-server && node --test db.test.ts`.
- [x] Pass <!-- 2026-09-13: live GET /api/status returned {"projectId":10,"projectName":"uat161-project","windowPresent":true,"workdir":"/tmp","launchCmd":"sleep 3600","linkedAgent":null} for uat161-bg-scoped — exact match -->

---

### UAT-API-003: POST /api/bg-processes — 400 when projectId is not an integer
- **Endpoint**: `POST /api/bg-processes`
- **Description**: Verifies the `projectId` type guard (`host-server/index.ts:1855-1857`) rejects a non-integer value with a 400 before any DB write or tmux window is created. Uses a fresh, never-before-registered name so the duplicate-name/window-present checks (which run *before* the `projectId` check) don't short-circuit the case being tested.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"uat161-bg-badtype","workdir":"/tmp","launchCmd":"sleep 3600","projectId":"not-a-number"}'
  ```
- **Expected Result**: HTTP 400. Body: `{"error":"projectId must be an integer"}`. No tmux window named `uat161-bg-badtype` is created (`tmux list-windows -t conductor | grep uat161-bg-badtype` returns nothing), and `GET /api/status`'s `bgProcesses[]` contains no entry with that name.
- **Repeatable Unit Test**: Not applicable: fastify route-level validation, not importable in isolation (see UAT-API-001).
- [x] Pass <!-- 2026-09-13: live POST returned HTTP 400, body {"error":"projectId must be an integer"} — exact match; confirmed no tmux window and no /api/status entry for uat161-bg-badtype -->

---

### UAT-EDGE-001: POST /api/bg-processes — projectId remains optional at the API layer
- **Scenario**: The roadmap requires the **frontend form** to make project selection mandatory, but the backend route itself intentionally keeps `projectId` optional (`Body: { ...; projectId?: number }`) — TASK-161's Step 1 explicitly threads it through as optional so older/other callers aren't broken. Confirms omitting the field entirely still succeeds and persists `null`.
- **Steps**:
  1. Run the command below (no `projectId` key in the body at all).
  2. Then verify the persisted value:
     ```bash
     curl -sS 'http://localhost:8788/api/status' | jq '.bgProcesses[] | select(.name=="uat161-bg-unscoped") | {projectId, projectName}'
     ```
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"uat161-bg-unscoped","workdir":"/tmp","launchCmd":"sleep 3600"}'
  ```
- **Expected Result**: HTTP 201. Body: `{"ok":true,"bg":{"name":"uat161-bg-unscoped","workdir":"/tmp","launchCmd":"sleep 3600","linkedAgent":null,"projectId":null}}`. The follow-up `GET /api/status` query returns `{"projectId": null, "projectName": null}`.
- **Repeatable Unit Test**: Not applicable: requires a live host-server + tmux session (see UAT-API-001); the `projectId: null` join-passthrough is covered at the db layer by the `unscoped` assertions in `host-server/db.test.ts`'s TASK-161 test (lines 240-243).
- [x] Pass <!-- 2026-09-13: live POST (no projectId key) returned HTTP 201, body {"ok":true,"bg":{"name":"uat161-bg-unscoped","workdir":"/tmp","launchCmd":"sleep 3600","linkedAgent":null,"projectId":null}}; follow-up GET /api/status returned {"projectId":null,"projectName":null} — exact match -->

---

### UAT-API-004: Cleanup — remove UAT-161 test fixtures
- **Endpoint**: `DELETE /api/bg-processes/:name`, `DELETE /api/projects/:id`
- **Description**: Tears down the bg processes and project created by UAT-API-001/UAT-EDGE-001 so the live dev environment (which also holds real projects — `bootstrap`, `capstone`, `cryptwiz`, `jarvis`, `portfolio`, etc.) is left clean.
- **Steps**:
  1. Delete both test bg processes (kills their tmux windows and removes the SQLite rows):
     ```bash
     curl -sS -X DELETE 'http://localhost:8788/api/bg-processes/uat161-bg-scoped'
     ```
     ```bash
     curl -sS -X DELETE 'http://localhost:8788/api/bg-processes/uat161-bg-unscoped'
     ```
     (`uat161-bg-badtype` was never created in UAT-API-003, so nothing to remove there.)
  2. Delete the test project (replace `PROJECT_ID`):
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8788/api/projects/PROJECT_ID?force=1'
  ```
- **Expected Result**: All three calls return success (`ok:true` / `removed` for the bg-process deletes, HTTP 204 empty body for the project delete). Confirm with `curl -sS 'http://localhost:8788/api/projects' | jq '[.[] | select(.name=="uat161-project")]'` → `[]`.
- **Repeatable Unit Test**: Not applicable: cleanup step against a live server, not new behavior introduced by this task.
- [x] Pass <!-- 2026-09-13: both bg-process deletes returned {"ok":true,"removed":"<name>"}, project delete returned HTTP 204; confirming query for name=="uat161-project" returned [] -->

---

### UAT-UI-001: AddBgProcessForm — cannot be submitted without a project selected
- **Page**: `http://localhost:4321` — "Add Background Process" panel
- **Component**: `frontend/src/components/AddBgProcessForm.tsx` — the `<select id="bg-project" required>` (no blank/`"— None —"` option), in contrast to `AddAgentForm.tsx`'s optional project selector which offers a free-form fallback.
- **Description**: Verifies the roadmap's "required" project selector actually blocks submission, both via the browser's native `required` constraint (no `<option value="">` exists, so nothing is selected until the user picks one) and the redundant `selectedProjectId === null` guard in `handleSubmit` (`AddBgProcessForm.tsx:41-44`).
- **Steps**:
  1. Open `http://localhost:4321` and locate the "Add Background Process" panel.
  2. Leave the "Project" select untouched — its initial state has no project visibly selected.
  3. Fill Name = `uat161-ui-block-test`, Working Directory = `/tmp`, Launch Command = `sleep 3600`.
  4. Click "Spawn Process" (open browser devtools Network tab first).
- **Expected Result**: No `POST /api/bg-processes` request is sent — the browser's native required-field validation intercepts the click and flags the "Project" select. `GET /api/status` afterward shows no `uat161-ui-block-test` entry in `bgProcesses`.
- **Repeatable Unit Test**: Not applicable: native browser `required`-attribute constraint validation cannot be exercised by jsdom the same way a real browser enforces it (jsdom does not block form submission on `required` the way Chrome/Firefox/Safari do), so this is genuinely a real-browser-only check.
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-UI-002: A project-scoped bg process spawned via the form renders under its project's sub-header
- **Page**: `http://localhost:4321`
- **Component**: `frontend/src/components/AddBgProcessForm.tsx` (submission) → `frontend/src/components/AgentList.tsx`'s `BgProcessSection`/`groupBgsByProject` (rendering)
- **Description**: End-to-end check that a real POST → real GET /status → real render pipeline groups the new process correctly, complementing the mocked-data unit test (`AgentList.test.tsx`, "groups background processes under per-project sub-headers... (TASK-161)").
- **Steps**:
  1. Open `http://localhost:4321`.
  2. In "Add Background Process": select "bootstrap" from the "Project" dropdown, Name = `uat161-e2e-check`, Working Directory = `/tmp`, Launch Command = `sleep 3600`.
  3. Click "Spawn Process" and wait for the "Process spawned ✓" confirmation.
  4. Scroll to the "Background processes" section.
  5. Locate the sub-header "bootstrap" and confirm a row named `uat161-e2e-check` renders beneath it (not in a flat, ungrouped list).
  6. Cleanup: click "Remove" (or "Remove definition") on the `uat161-e2e-check` row and confirm in the dialog.
- **Expected Result**: A "bootstrap" sub-header is visible above the `uat161-e2e-check` row in `BgProcessSection`. After cleanup, the row disappears (and the "bootstrap" sub-header disappears too if `uat161-e2e-check` was the only bg process under it).
- **Repeatable Unit Test**: Not applicable: real end-to-end network + render flow; the grouping/sub-header/ordering logic itself is already unit-tested with mocked data in `frontend/src/components/AgentList.test.tsx` (`describe`/`it` block referencing TASK-161, asserting header order `['alpha-project', 'zeta-project', 'Unassigned']` and per-header row clustering).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx`
- [x] Pass <!-- 2026-09-13 -->
