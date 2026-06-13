---
id: TASK-018
title: "Group AgentList by project and react to the new ID-based task SSE events"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-005, TASK-006]
blocks: []
parallel_safe_with: [TASK-001, TASK-012]
uat: "../uat/UAT-018-frontend-agentlist-grouping.md"
tags: [frontend, react, agents]
---

# TASK-018 — Group AgentList by project and react to the new ID-based task SSE events

## Objective

Update the existing dashboard `AgentList` component so that:

1. **Agents are grouped by project.** Render one section/accordion per project, with a default "Unassigned" group for agents whose `projectId` is `null`. Today `AgentList` groups purely by status (`BOARD_COLUMNS`). After this task the top-level grouping is by **project**; the existing status columns may be retained *within* each project group or simplified — keep the status-derived board behavior but nest it under project sections.
2. **It reacts to the new ID-based task SSE events** introduced by the ROADMAP-001 SQLite queue migration, so an agent's active-task display and queued-task count update live without a full reload.

The backend already migrated to SQLite: agents now carry `projectId` (`agents.project_id`) and the task queue emits ID-based SSE events. This task is frontend-only.

## Approach

### What the real code looks like (verified against the current tree)

- **Frontend `Agent` type lives in `frontend/src/components/AgentList.tsx`** (lines ~24–39), NOT in `lib/api.ts`. It currently has **no `projectId`** field:
  `{ name, state, mode, windowPresent, queuedTasks, launchCmd, workdir, linkedBg, activeTask, model?, modelId?, contextTokens?, contextPct?, contextLimit? }`.
- **`frontend/src/lib/api.ts` is thin** — only `API_BASE`, `KeysPayload`, `sendAgentKeys`, `uploadAgentImage`. There is **no `Project` type and no SSE-subscription helper** there. SSE is opened **inline** in `AgentList` via `new EventSource(\`${apiUrl}/events\`)`.
- **`AgentList` (default export, ~line 889)** fetches `GET /status` once, seeds `agents`/`bgs`, then subscribes to these SSE events only: `agent-update`, `agent-removed`, `bg-update`, `bg-removed`, `session-update`. It renders by mapping `BOARD_COLUMNS` and filtering agents per column via `deriveStatus(a)`.
- **Backend SSE task events** (`backend/index.ts`, via `broadcastSSE`): `task-added` (full task object), `task-removed` (`{ id }`), `queue-reordered` (`{ ids }`), `task-moved` (`{ id }`). (Also `snapshot`, `schedule-fired`.) **The AgentList does not currently listen for any of these.**
- **CRITICAL — project info is NOT in the SSE/status payload.** The `agent-update` SSE payload and the `/status` snapshot agent shape carry only runtime fields (state, mode, queuedTasks, activeTask, model/context) — **no `projectId`**. `projectId` lives only in the DB rows returned by **`GET /api/agents`** → `Agent { id, name, workdir, launchCmd, projectId: number|null, createdAt }` and project names come from **`GET /api/projects`** → `Project { id, name, workdir, defaultLaunchCmd, createdAt }`. Therefore grouping requires an **extra one-time fetch** of `/api/agents` + `/api/projects` to build `name → projectId` and `projectId → projectName` maps. The live SSE `agent-update` stream keeps updating runtime fields but does not change project membership (membership only changes on add/remove, already covered by `agent-update`/`agent-removed`).
- **Task SSE events are ID-based and do not name the agent.** `task-added` carries a full task object (which includes its agent association); `task-removed`/`task-moved` carry only `{ id }`. Because the per-agent `queuedTasks` count and `activeTask` string are already recomputed server-side and pushed via `agent-update` on the poll loop, the simplest correct reaction to the task events is to treat them as a **trigger to refresh** (the simplest being: rely on the subsequent `agent-update`, OR re-fetch the affected agent's queue). Prefer the lightweight approach: subscribe to the task events and, on receipt, **do not maintain a separate task store** — instead re-fetch `/api/agents` (cheap) only if the event implies a membership-relevant change, otherwise let the existing `agent-update` stream carry `queuedTasks`/`activeTask`. Document this decision inline.

### COLLISION NOTE (record and obey)

This task **primarily edits `frontend/src/components/AgentList.tsx`**. It may need a **`Project` type** (and possibly a `projectId` addition to the shared `Agent` shape) in `frontend/src/lib/api.ts`, which a **sibling task (projects UI, TASK-005/TASK-006)** also adds. Treat that as a **soft dependency**:

- **Run after** the sibling projects-UI task when possible.
- Before adding any `Project` type or `fetchProjects`/`fetchAgents` helper to `lib/api.ts`, **re-read `lib/api.ts` with Serena first** — if the sibling already added it, **import and reuse it; do not duplicate**.
- Confine edits to `AgentList.tsx` plus **minimal** `lib/api.ts` additions, and only if not already present. Do not refactor unrelated parts of `lib/api.ts`.

## Steps

### 1. Re-read current state of both files (collision guard)  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Use Serena `get_symbols_overview` on `frontend/src/lib/api.ts` and `frontend/src/components/AgentList.tsx`. <!-- Completed: 2026-06-12 -->
- [x] Use Serena `find_symbol` to read the bodies of the `Agent` interface (in AgentList.tsx) and the full `AgentList` default-export function. <!-- Completed: 2026-06-12 -->
- [x] Check whether `lib/api.ts` **already** exports a `Project` type and/or `fetchProjects`/`fetchAgents` helper (added by the sibling projects-UI task). Record what exists so later steps reuse rather than duplicate. <!-- Completed: 2026-06-12 -->

<!-- FINDINGS (step 1): `Project` interface EXISTS in lib/api.ts ({id,name,workdir,defaultLaunchCmd,createdAt}) — REUSE. `listProjects()` (GET /projects) EXISTS — REUSE (do NOT add fetchProjects). NO `ApiAgent` type, NO `fetchAgents` helper — must add per step 2. Client `Agent` shape in AgentList.tsx has NO projectId field (only workdir). API_BASE already includes `/api`. lib/api.ts Projects block uses semicolons; AgentList.tsx uses NO semicolons — match local style. openByColumn is keyed by col.key only — project grouping needs a composite key to avoid cross-group accordion bleed. -->
<!-- Updated: 2026-06-12 -->


### 2. Ensure a `Project` type + project/agent fetch helpers exist in lib/api.ts (only if missing)  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

<!-- DONE: `Project` + `listProjects` already existed (reused). Added ONLY `ApiAgent` interface + `fetchAgents()` (GET /agents) after `listProjects`. Frontend typecheck clean. -->

- [x] If `lib/api.ts` does NOT already define them, add minimal additions mirroring the backend shapes: <!-- Completed: 2026-06-12 - added ApiAgent + fetchAgents; reused existing Project + listProjects -->
  ```ts
  export interface Project { id: number; name: string; workdir: string; defaultLaunchCmd: string; createdAt: string }
  export interface ApiAgent { id: number; name: string; workdir: string; launchCmd: string; projectId: number | null; createdAt: string }
  export async function fetchProjects(): Promise<Project[]> { /* GET `${API_BASE}/projects` */ }
  export async function fetchAgents(): Promise<ApiAgent[]> { /* GET `${API_BASE}/agents` */ }
  ```
- [x] If the sibling task already added equivalents, **import those instead** and skip this step. Do NOT create a second `Project` type. <!-- Completed: 2026-06-12 - reused existing Project + listProjects, no duplication -->

### 3. Fetch project membership in AgentList and build lookup maps  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] In the existing `useEffect` of `AgentList` (alongside the `GET /status` fetch), also fetch `fetchAgents()` and `fetchProjects()` once. <!-- Completed: 2026-06-12 - used fetchAgents() + listProjects() via loadMembership() helper -->
- [x] Build two maps in state/refs: `agentProjectId: Map<agentName, number|null>` (from `/api/agents`) and `projectName: Map<number, string>` (from `/api/projects`). <!-- Completed: 2026-06-12 - both added as useState Maps; membership fetches each have own .catch (no setError) so status/SSE path is unaffected on failure -->
- [x] Default group: agents with `projectId === null` (or no map entry) go into an "Unassigned" group rendered last. <!-- Completed: 2026-06-12 -->
- [x] These maps only need refreshing when membership changes — refresh them on `agent-update` for a previously-unseen agent name and on the task events per step 5. Keep the runtime `agents` state (SSE-driven) as the source of truth for status/activeTask/queuedTasks. <!-- Completed: 2026-06-12 - loadMembership() called in agent-update new-agent branch + on task-added; runtime agents state untouched -->


### 4. Render agents grouped by project (sections/accordions)  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Replace the top-level `BOARD_COLUMNS.map(...)` grouping with a **project grouping**: iterate the projects (sorted by name, "Unassigned" last), and within each project render the agents belonging to it. <!-- Completed: 2026-06-12 - project sections are outer layer; BOARD_COLUMNS status grid nested inside, filtered per project -->
- [x] Preserve the existing per-agent rendering (`AgentItem`), the modal lifecycle (`expandedAgent`, `expandedModalAgent`), and the doorbell/attention logic — only the *outer* grouping changes. The existing status board may be nested inside each project section, or each project section can list its agents directly; keep it consistent and simple. <!-- Completed: 2026-06-12 - AgentItem/modal/doorbell/deriveStatus all unchanged; openByColumn now composite-keyed `${group.key}:${col.key}` to avoid cross-group accordion bleed -->
- [x] Each project section is a labelled section/accordion with the project name and an agent count badge (mirror the existing `<section>`/count-badge styling already used for columns). <!-- Completed: 2026-06-12 - project <h2> + rounded-pill count badge; inner column headers downgraded h2->h3 -->
- [x] Empty projects (a project with zero current agents) may be omitted from the render. <!-- Completed: 2026-06-12 -->


### 5. Subscribe to the new ID-based task SSE events  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Add `es.addEventListener` handlers in the same `EventSource` block for: `task-added`, `task-removed`, `queue-reordered`, `task-moved`. <!-- Completed: 2026-06-12 -->
- [x] Payload shapes (from backend): `task-added` = full task object (includes agent association); `task-removed` = `{ id }`; `queue-reordered` = `{ ids }`; `task-moved` = `{ id }`. <!-- Completed: 2026-06-12 -->
- [x] Reaction policy (record inline as a comment): the per-agent `queuedTasks` count and `activeTask` string are recomputed server-side and already pushed via `agent-update`, so these task events are treated as **lightweight triggers**. On any of them, do NOT maintain a parallel task store — instead either (a) rely on the subsequent `agent-update` to carry the new `queuedTasks`/`activeTask`, or (b) for `task-added` whose payload names a not-yet-known agent, re-fetch `/api/agents` to refresh project membership. Wrap all handlers in try/catch like the existing ones and ignore malformed events. <!-- Completed: 2026-06-12 - only task-added calls loadMembership(); {id}-only events parse-and-ignore; all wrapped in try/catch; inline policy comment added -->
- [x] Ensure the new listeners are removed in the effect cleanup (the existing `es.close()` already covers this since they share the one `EventSource`). <!-- Completed: 2026-06-12 - shared es, existing es.close() cleanup untouched -->


### 6. Verification — `make typecheck`  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Run `make typecheck` from the repo root (runs `tsc --noEmit` in both `backend/` and `frontend/`). Must pass clean. <!-- Completed: 2026-06-12 - exit 0, zero diagnostics in both backend/ and frontend/ -->
- [x] Optionally run `make typecheck-frontend` alone for a faster inner loop, but the final gate is `make typecheck`. <!-- Completed: 2026-06-12 -->
- [x] If `make lint` is cheap, run `make strict-typecheck` (typecheck + lint) as an extra gate; otherwise `make typecheck` is the required gate. <!-- Completed: 2026-06-12 - make typecheck used as the required gate -->
