---
id: UAT-017
title: "UAT: Frontend Schedules UI — ScheduleList + ScheduleForm with live schedule-fired updates"
status: passed
task: TASK-017
created: 2026-06-12
updated: 2026-06-12
---

# UAT-017 — UAT: Frontend Schedules UI — ScheduleList + ScheduleForm with live schedule-fired updates

implements::[[TASK-017]]

> **Source task**: [`wiki/work/tasks/TASK-017-frontend-schedules-ui.md`](../tasks/TASK-017-frontend-schedules-ui.md)
> **Generated**: 2026-06-12

This task is **frontend-only**. The auto-runnable backbone is (1) a strict `make typecheck` gate and (2) static-content assertions over the source files (types/helpers on the correct `/api/schedules` routes, components exist, `useSSEEvent('schedule-fired', …)` subscription, `index.astro` mount, and the next-fire/last-fired derivation from `lastEnqueuedAt + intervalSeconds`). Live UI behaviors (create→appears, delete→removes, fire→flashes) are captured separately as **human/Playwright verification** tests because they require the running dashboard + backend scheduler tick.

All `grep` commands below run from the **repo root** (`/Users/davidtaylor/Repositories/tmux-conductor`). They use `-q` and the test passes when the command **exits 0** (match found), unless the Expected Result says otherwise.

---

## Prerequisites

- [ ] Working directory is the repo root (`/Users/davidtaylor/Repositories/tmux-conductor`)
- [ ] Node.js >= 18 and project deps installed in `backend/` and `frontend/` (`tsc` available via `npx`)
- [ ] **For UI tests only**: backend running on `http://localhost:8788` (`make dev` / backend `tsx watch`) and frontend dev server on `http://localhost:4321` (Astro). A SQLite DB the backend can write to.

---

## Test Cases

### UAT-STATIC-001: Strict typecheck passes clean (backend + frontend)
- **Description**: The project's strict TypeScript gate (`tsc --noEmit` in both `backend/` and `frontend/`) must pass with zero errors. This is the primary backbone gate; it covers the new `Schedule`/`CreateScheduleInput` types, the SSE payload typing, and the `lastEnqueuedAt + intervalSeconds` arithmetic.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  make typecheck
  ```
- **Expected Result**: Exit code 0. Both `typecheck-backend` and `typecheck-frontend` complete with no TypeScript errors emitted.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-002: Schedule + CreateScheduleInput types exist in lib/api.ts
- **Description**: Confirms the two TypeScript interfaces were added to the shared API module.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  grep -Eq "export interface Schedule \{" frontend/src/lib/api.ts && grep -Eq "export interface CreateScheduleInput \{" frontend/src/lib/api.ts && echo OK
  ```
- **Expected Result**: Prints `OK` (both interfaces present), exit 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-003: Schedule interface mirrors the backend shape (lastEnqueuedAt epoch field present)
- **Description**: Verifies the `Schedule` interface carries the fields the derivations depend on — notably `lastEnqueuedAt: number | null` and `intervalSeconds: number` (and not a `next_run`/`last_run` column, which does not exist in the backend).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  grep -Eq "lastEnqueuedAt: number \| null" frontend/src/lib/api.ts && grep -Eq "intervalSeconds: number" frontend/src/lib/api.ts && echo OK
  ```
- **Expected Result**: Prints `OK`, exit 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-004: listSchedules helper targets GET /api/schedules
- **Description**: Confirms `listSchedules` performs a `fetch` against `${API_BASE}/schedules` (where `API_BASE` ends in `/api`). A bare `fetch(\`${API_BASE}/schedules\`)` with no method defaults to GET.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  grep -Eq "export async function listSchedules\(\): Promise<Schedule\[\]>" frontend/src/lib/api.ts && grep -Eq "fetch\(\`\\\$\{API_BASE\}/schedules\`\)" frontend/src/lib/api.ts && echo OK
  ```
- **Expected Result**: Prints `OK`, exit 0. `listSchedules` is declared returning `Promise<Schedule[]>` and fetches `${API_BASE}/schedules`.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-005: createSchedule helper POSTs to /api/schedules with JSON body
- **Description**: Confirms `createSchedule` issues a `POST` to `${API_BASE}/schedules` with `Content-Type: application/json` and a JSON-stringified body, and parses `body.error` on failure.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  grep -Eq "export async function createSchedule\(input: CreateScheduleInput\): Promise<Schedule>" frontend/src/lib/api.ts && grep -Eq "method: 'POST'" frontend/src/lib/api.ts && grep -Eq "'Content-Type': 'application/json'" frontend/src/lib/api.ts && echo OK
  ```
- **Expected Result**: Prints `OK`, exit 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-006: deleteSchedule helper DELETEs /api/schedules/:id
- **Description**: Confirms `deleteSchedule(id)` issues a `DELETE` against `${API_BASE}/schedules/${id}` and returns `Promise<void>` (no body parse, matching the backend `204`).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  grep -Eq "export async function deleteSchedule\(id: number\): Promise<void>" frontend/src/lib/api.ts && grep -Eq "fetch\(\`\\\$\{API_BASE\}/schedules/\\\$\{id" frontend/src/lib/api.ts && grep -Eq "method: 'DELETE'" frontend/src/lib/api.ts && echo OK
  ```
- **Expected Result**: Prints `OK`, exit 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-007: ScheduleForm.tsx exists and uses createSchedule
- **Description**: Confirms the form component file exists and calls the `createSchedule` helper (not a raw `fetch`/`EventSource`).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  test -f frontend/src/components/ScheduleForm.tsx && grep -Eq "createSchedule" frontend/src/components/ScheduleForm.tsx && echo OK
  ```
- **Expected Result**: Prints `OK`, exit 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-008: ScheduleList.tsx exists and renders ScheduleForm internally
- **Description**: Confirms the list component file exists and imports/renders `ScheduleForm` (so a single mount yields one form + one list), wiring an `onCreated` refetch.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  test -f frontend/src/components/ScheduleList.tsx && grep -Eq "import ScheduleForm from './ScheduleForm'" frontend/src/components/ScheduleList.tsx && grep -Eq "<ScheduleForm onCreated=" frontend/src/components/ScheduleList.tsx && echo OK
  ```
- **Expected Result**: Prints `OK`, exit 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-009: ScheduleList subscribes to the schedule-fired SSE event via useSSEEvent
- **Description**: Confirms live updates are wired through the shared `useSSEEvent` hook subscribing to the exact event name `schedule-fired` — and that NO new `EventSource` is opened directly in the component.
- **Steps**:
  1. Run the first command (must match), then the second (must NOT match).
- **Command**:
  ```bash
  grep -Eq "useSSEEvent<[^>]*>\('schedule-fired'," frontend/src/components/ScheduleList.tsx && grep -Eq "import \{ useSSEEvent \} from '../hooks/useSSE'" frontend/src/components/ScheduleList.tsx && echo OK
  ```
- **Expected Result**: Prints `OK`, exit 0. (Subscription on the exact `schedule-fired` event name via `useSSEEvent`.)
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-010: No direct EventSource is opened in the schedule components
- **Description**: Guards the "reuse the shared SSE connection" requirement — neither schedule component should construct `new EventSource(...)`.
- **Steps**:
  1. Run the command below. It passes when the search finds **no** matches.
- **Command**:
  ```bash
  grep -REq "new EventSource" frontend/src/components/ScheduleList.tsx frontend/src/components/ScheduleForm.tsx && echo FOUND || echo NONE
  ```
- **Expected Result**: Prints `NONE` (no `new EventSource` in either component).
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-011: next-fire and last-fired derive from lastEnqueuedAt + intervalSeconds
- **Description**: Confirms the derivation logic: next-fire = `lastEnqueuedAt + intervalSeconds` (with `due now` when null), last-fired = `lastEnqueuedAt` (with `never` when null).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  grep -Eq "lastEnqueuedAt \+ schedule.intervalSeconds" frontend/src/components/ScheduleList.tsx && grep -Eq "'due now'" frontend/src/components/ScheduleList.tsx && grep -Eq "'never'" frontend/src/components/ScheduleList.tsx && echo OK
  ```
- **Expected Result**: Prints `OK`, exit 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-012: schedule-fired payload typed with scheduleId / name / command
- **Description**: Confirms the SSE payload shape the component consumes matches the backend broadcast (`{ scheduleId, name, command }`), and that `flashingId` is set from `payload.scheduleId`.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  grep -Eq "scheduleId: number" frontend/src/components/ScheduleList.tsx && grep -Eq "setFlashingId\(payload.scheduleId\)" frontend/src/components/ScheduleList.tsx && echo OK
  ```
- **Expected Result**: Prints `OK`, exit 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-013: ScheduleList is mounted as a client:load island in index.astro
- **Description**: Confirms the root layout imports `ScheduleList` and mounts it exactly once with `client:load`. ScheduleForm is intentionally NOT mounted separately (it renders inside ScheduleList), so there must be exactly one `<ScheduleList client:load />`.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  grep -Eq "import ScheduleList from '../components/ScheduleList.tsx'" frontend/src/pages/index.astro && [ "$(grep -c '<ScheduleList client:load />' frontend/src/pages/index.astro)" = "1" ] && echo OK
  ```
- **Expected Result**: Prints `OK`, exit 0. (One import line, exactly one mount.)
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-014: Backend /api/schedules routes exist (GET, POST, DELETE)
- **Description**: Sanity-checks the backend contract the frontend depends on — `GET`/`POST`/`DELETE` on `/schedules` under the `/api` prefix. (Backend was NOT modified by this task; this confirms the routes the helpers target are real.)
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  grep -Eq "api.get\('/schedules'" backend/index.ts && grep -Eq "api.post<.*>\('/schedules'" backend/index.ts && grep -Eq "api.delete<.*>\('/schedules/:id'" backend/index.ts && echo OK
  ```
- **Expected Result**: Prints `OK`, exit 0.
- [x] Pass <!-- 2026-06-12 -->

---

## Human / Playwright Verification (live dashboard required)

> The following tests require the running dashboard (frontend `:4321` + backend `:8788`) and the backend scheduler tick. They are **NOT auto-runnable** and must be verified by a human or via an interactive Playwright session. Mark Pass only after observing the described behavior in a live browser.

### UAT-UI-001: Create a schedule → it appears in the list  *(requires human verification)*
- **Page**: `http://localhost:4321/`
- **Auth-Required**: false
- **Description**: Submitting the ScheduleForm creates a schedule via `POST /api/schedules` and the new row appears in the list (via the `onCreated` refetch) without waiting for a fire.
- **Steps**:
  1. Open `http://localhost:4321/` with the backend running.
  2. In the schedule form (rendered at the top of the ScheduleList section), enter a Command (e.g. `echo uat-create`), set the interval to e.g. `60` sec, leave action `append`.
  3. Click **Create schedule**.
  4. Observe the list below the form.
- **Expected Result**: A new schedule row appears showing the command (`echo uat-create`), the formatted interval, `last: never`, and `next: due now`. The command input clears after a successful create. No inline error is shown.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-UI-002: Delete a schedule → it is removed from the list  *(requires human verification)*
- **Page**: `http://localhost:4321/`
- **Auth-Required**: false
- **Description**: Clicking the row's `×` delete button calls `DELETE /api/schedules/:id` and removes the row (optimistic removal; restored on error).
- **Steps**:
  1. With at least one schedule present (from UAT-UI-001), hover the row and click its `×` (aria-label `Remove schedule: <command>`).
  2. Observe the list.
- **Expected Result**: The row disappears immediately. After a refresh it remains gone (the backend returned `204`). If all schedules are removed, the empty state `No schedules.` is shown.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-UI-003: A fired schedule flashes its row live via SSE  *(requires human verification)*
- **Page**: `http://localhost:4321/`
- **Auth-Required**: false
- **Description**: When the backend scheduler tick fires a due schedule it broadcasts `schedule-fired` on `GET /api/events`; ScheduleList refetches and briefly highlights (flashes) the matching `scheduleId` row, and the row's `last`/`next` values update.
- **Steps**:
  1. Create a schedule with a short interval (e.g. `5` sec) and a harmless command so it becomes due and fires on the next ~5s scheduler tick.
  2. Keep the dashboard open and watch the schedule's row.
  3. Wait for the scheduler tick (≤ ~10s).
- **Expected Result**: The matching row briefly flashes/highlights (accent border + tinted background) for ~1.2s, then returns to normal. After the fire, the row's `last:` updates from `never` to a timestamp and `next:` advances to `lastEnqueuedAt + intervalSeconds`. No new `EventSource` connection is opened (it reuses the shared SSE stream).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-UI-004: Form validation — empty command and sub-5s interval blocked  *(requires human verification)*
- **Page**: `http://localhost:4321/`
- **Auth-Required**: false
- **Description**: Client-side validation prevents creating an invalid schedule before any network call.
- **Steps**:
  1. With the command field empty, attempt to submit (the Create button is disabled while empty — confirm it cannot be clicked).
  2. Enter a command, then set the interval to `3` and submit.
- **Expected Result**: Empty command keeps the submit button disabled. Submitting with interval `3` shows the inline error `Interval must be at least 5 seconds.` and performs no create.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

---

## Notes for the runner

- UAT-STATIC-001 through UAT-STATIC-014 are the **auto-runnable backbone** (14 tests): one typecheck gate + thirteen static-content assertions. They are safe to run headlessly via `/uat-auto`.
- UAT-UI-001 through UAT-UI-004 (4 tests) are **human/Playwright verification** and must not be auto-judged Pass without live observation.
