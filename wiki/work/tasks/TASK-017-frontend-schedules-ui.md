---
id: TASK-017
title: "Frontend Schedules UI — ScheduleList + ScheduleForm with live schedule-fired updates"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-008]
blocks: []
parallel_safe_with: [TASK-001, TASK-011, TASK-012]
uat: "../uat/UAT-017-frontend-schedules-ui.md"
tags: [frontend, react, schedules]
---

# TASK-017 — Frontend Schedules UI — ScheduleList + ScheduleForm with live schedule-fired updates

## Objective

Surface the backend recurring-schedules feature (ROADMAP-001 Phase 4) in the Astro+React dashboard. Add two React components under `frontend/src/components/`:

- **`ScheduleForm.tsx`** — create a recurring schedule via `POST /api/schedules` (fields: optional name, command, intervalSeconds, action `append|jump`, optional skipIfPending).
- **`ScheduleList.tsx`** — list schedules from `GET /api/schedules`, show each schedule's command/interval, **next-fire** and **last-fired** (derived from `lastEnqueuedAt` + `intervalSeconds`), allow delete via `DELETE /api/schedules/:id`, and live-flash a row when it fires.

Wire live updates: when the backend scheduler tick fires a schedule it broadcasts an SSE `schedule-fired` event (`{ scheduleId, name, command }`) on the existing `GET /api/events` stream — `ScheduleList` subscribes via the existing `useSSEEvent` hook and refetches / flashes the affected row. Add `Schedule` TypeScript types + fetch helpers (`listSchedules`, `createSchedule`, `deleteSchedule`) to `frontend/src/lib/api.ts`. Mount both components in the root layout `frontend/src/pages/index.astro`.

## Approach

Everything the backend needs already exists (TASK-008): routes are registered under the `/api` prefix in `backend/index.ts` (lines ~1072-1150), the scheduler `setInterval` tick (every 5s, `backend/index.ts:1339-1348`) calls `dueSchedules` → `fireSchedule` and broadcasts `schedule-fired` + `task-added`. This task is **frontend-only** — do NOT touch `backend/`.

Ground-truth contracts confirmed by inspection:

- **`GET /api/schedules`** → `Schedule[]`.
- **`POST /api/schedules`** body `{ name?: string; command: string; intervalSeconds: number; action?: 'append'|'jump'; agentId?: number; projectId?: number; skipIfPending?: boolean }` → `201` with the created `Schedule`. Backend rejects empty `command` (400) and `intervalSeconds < 5` (DB CHECK; also validate client-side: min 5).
- **`DELETE /api/schedules/:id`** → `204` (no body).
- **`PATCH /api/schedules/:id/toggle`** → returns updated `Schedule` (optional: wire an enable/disable toggle; not required for this task).
- **SSE fire event name is exactly `schedule-fired`**, payload `{ scheduleId: number; name: string | null; command: string }`.
- **`Schedule` shape** (mirror `backend/db.ts:45-57` — note there is NO `next_run`/`last_run` column): `{ id: number; name: string | null; command: string; intervalSeconds: number; action: 'append'|'jump'; agentId: number | null; projectId: number | null; enabled: number; skipIfPending: number; lastEnqueuedAt: number | null; createdAt: string }`. `lastEnqueuedAt` is **epoch seconds** (or `null` if never fired). Derive **last-fired** = `lastEnqueuedAt` (epoch→Date, or "never"); **next-fire** = `lastEnqueuedAt + intervalSeconds` (or "due now" when `lastEnqueuedAt` is null, since `dueSchedules` fires null-last immediately).

Patterns to reuse:

- Fetch helpers live in `frontend/src/lib/api.ts` and use `API_BASE` (`…/api`) + `fetch`, throwing on `!res.ok` (see existing `sendAgentKeys`/`uploadAgentImage`). Match that style exactly.
- SSE: subscribe with `useSSEEvent<T>(eventName, callback)` from `frontend/src/hooks/useSSE.ts` — it parses `event.data` JSON and hands the payload to the callback; registration is on mount, teardown on unmount. Do NOT open a new `EventSource`.
- Component/list/delete idioms: model styling and the delete-button affordance on the existing `frontend/src/components/TaskList.tsx`. Tailwind utility classes; design tokens like `border-line`, `bg-white`, `text-ink`, `text-muted-2`, `hover:text-accent-red` are already in the theme.
- Root layout mounts React islands in `frontend/src/pages/index.astro` with `client:load` (e.g. `<AgentList client:load />`). `frontend/src/App.tsx` exists but `index.astro` is the served entry — mount the new components there.

> **COLLISION NOTE (concurrent Phase 4 siblings):** `frontend/src/lib/api.ts` and the root layout `frontend/src/pages/index.astro` are **shared** with sibling Phase 4 tasks (TASK-012 also touches the frontend). To avoid clobbering concurrent edits: (1) confine all `lib/api.ts` changes to a single appended **`// ── Schedules ──`** section at the end of the file (types + the three helpers together) — do not reorder or rewrite existing exports; (2) in `index.astro`, **only add** the two schedule import lines and the two `<ScheduleForm client:load />` / `<ScheduleList client:load />` mount lines — do not remove or reorder existing imports/mounts. Use `Edit` with tight, unique anchors (append-only) rather than `Write` to keep edits non-destructive.

## Steps

### 1. Add Schedule types + fetch helpers to lib/api.ts  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Use Serena `get_symbols_overview` on `frontend/src/lib/api.ts` to confirm current exports before editing.
- [x] **Append** (do not rewrite the file) a `// ── Schedules ──────────────` section at the end containing:
  - `export interface Schedule { id: number; name: string | null; command: string; intervalSeconds: number; action: 'append' | 'jump'; agentId: number | null; projectId: number | null; enabled: number; skipIfPending: number; lastEnqueuedAt: number | null; createdAt: string }`
  - `export interface CreateScheduleInput { name?: string; command: string; intervalSeconds: number; action?: 'append' | 'jump'; skipIfPending?: boolean }`
  - `export async function listSchedules(): Promise<Schedule[]>` — `GET ${API_BASE}/schedules`, throw on `!res.ok`, return `res.json()`.
  - `export async function createSchedule(input: CreateScheduleInput): Promise<Schedule>` — `POST ${API_BASE}/schedules` with JSON body + `Content-Type: application/json`; throw with `body.error` on `!res.ok` (mirror `sendAgentKeys`); return the created schedule.
  - `export async function deleteSchedule(id: number): Promise<void>` — `DELETE ${API_BASE}/schedules/${id}`; throw on `!res.ok`; no body parse (204).
- [x] Mirror the existing error-handling idiom (`const body = await res.json().catch(() => ({})) as { error?: string }`).

### 2. Create ScheduleForm.tsx  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] New file `frontend/src/components/ScheduleForm.tsx`. Controlled inputs: `name` (text, optional), `command` (text, required), `intervalSeconds` (number, min 5, default 60), `action` (`append`/`jump` select, default `append`), `skipIfPending` (checkbox, default checked).
- [x] On submit: validate `command` non-empty and `intervalSeconds >= 5` client-side; call `createSchedule(...)` from `lib/api.ts`; on success reset the command field and surface success (the SSE/refetch in ScheduleList will reflect the new row — optionally expose an `onCreated?` callback prop so a parent can trigger an immediate refetch).
- [x] Show inline error text on a thrown helper error. Match `TaskList.tsx` / `AddTaskForm.tsx` styling (Tailwind tokens).

### 3. Create ScheduleList.tsx with live schedule-fired updates  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] New file `frontend/src/components/ScheduleList.tsx`. On mount, fetch via `listSchedules()` into state; render each schedule: command (mono), interval (`every Ns` / format minutes/hours), **last-fired** (`lastEnqueuedAt` epoch→relative/absolute, or "never"), **next-fire** (`lastEnqueuedAt + intervalSeconds`, or "due now" when null), and a delete button (calls `deleteSchedule(id)` then drops the row from state — mirror `TaskList.tsx` delete affordance).
- [x] Subscribe to live fires: `useSSEEvent<{ scheduleId: number; name: string | null; command: string }>('schedule-fired', (payload) => { … })`. On event, **refetch** `listSchedules()` (so `lastEnqueuedAt`/next-fire update) and briefly **flash/highlight** the matching `scheduleId` row (e.g. a transient CSS class cleared via `setTimeout`).
- [x] Empty state when no schedules. Render `ScheduleForm` above the list (or accept a refetch handler so a create immediately updates the list without waiting for a fire).

### 4. Mount components in the root layout  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Use Serena/`Read` to view `frontend/src/pages/index.astro`.
- [x] **Add only** (append-only, do not reorder existing): import line for `ScheduleList.tsx` in the frontmatter fence, and `<ScheduleList client:load />` mount line in `<body>` after the existing islands. (ScheduleList renders ScheduleForm internally via its `onCreated` refetch prop, so mounting ScheduleForm separately too would duplicate the form — mounted only ScheduleList to yield exactly one form + one list.) Respect the collision note — no destructive rewrites of `index.astro`.

### 5. Typecheck verification  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Run `make typecheck` from the repo root — must pass with zero errors (this is the project's strict gate covering backend + frontend TypeScript). Fix any type errors introduced (e.g. SSE payload typing, `Schedule` field access, `epoch number` arithmetic) before considering the task done. <!-- PASS: both backend & frontend tsc --noEmit exited 0 -->
- [x] Confirm no `EventSource` was opened directly and no `backend/` file was modified. <!-- Confirmed: no EventSource in Schedule*.tsx (useSSEEvent hook only); backend changes in tree are from sibling tasks, not this one -->
