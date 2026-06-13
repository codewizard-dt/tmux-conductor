---
id: UAT-016
title: "UAT: Make AddAgentForm project-aware and add ProjectList/AddProjectForm components"
status: passed
task: TASK-016
created: 2026-06-12
updated: 2026-06-12
---

# UAT-016 — UAT: Make AddAgentForm project-aware and add ProjectList/AddProjectForm components

implements::[[TASK-016]]

> **Source task**: [`wiki/work/tasks/TASK-016-frontend-projects-ui.md`](../tasks/TASK-016-frontend-projects-ui.md)
> **Generated**: 2026-06-12

This is a frontend React/TypeScript change with no new backend code. The auto-runnable backbone is:
1. **`make typecheck`** — a static gate that must pass clean (the new components, `api.ts` helpers, and the project-aware `AddAgentForm` branch must all type-check).
2. **Static-content assertions** — verify the `Project` type + 3 helpers exist on the correct `/api/projects` routes in `lib/api.ts`, that `AddProjectForm`/`ProjectList` exist and are mounted in `index.astro`, and that `AddAgentForm` has the project select + `spawnAgentInProject` branch.

The live runtime behaviors (create project → appears in list; spawn-in-project → auto-named agent; AddAgentForm prefill from selected project) are captured as **human/Playwright-verification** tests, clearly marked, because `/uat-auto` will not exercise a running browser/backend.

All commands run from the repo root (`/Users/davidtaylor/Repositories/tmux-conductor`).

---

## Prerequisites

- [ ] Repo root is the working directory (`/Users/davidtaylor/Repositories/tmux-conductor`)
- [ ] `frontend/` dependencies installed (`make typecheck` invokes `npx tsc --noEmit` in both `backend/` and `frontend/`)
- [ ] For the **human/Playwright** tests only: backend running on `http://localhost:8788` and the Astro dev server on `http://localhost:4321` (e.g. via `make dev`)

---

## Test Cases

### UAT-STATIC-001: `make typecheck` passes clean
- **Description**: The strict TypeScript gate must report zero errors across both `backend/` and `frontend/`. This is the primary auto-runnable verification of TASK-016.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  make typecheck
  ```
- **Expected Result**: Exit code 0. Output shows `tsc --noEmit` running in `backend/` then `frontend/` with no error lines (no `error TS####:` text).
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-002: `Project` interface exists in lib/api.ts with the exact shape
- **Description**: Confirms the `Project` TypeScript type was added with the five required fields (`id`, `name`, `workdir`, `defaultLaunchCmd`, `createdAt`), mirroring the backend `db.ts` `Project` interface.
- **Steps**:
  1. Run the grep below; it should print the `export interface Project` line.
- **Command**:
  ```bash
  grep -nE 'export interface Project \{' frontend/src/lib/api.ts
  ```
- **Expected Result**: At least one match. (Companion check: the block contains `id: number`, `name: string`, `workdir: string`, `defaultLaunchCmd: string`, and `createdAt: string`.)
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-003: All three project helpers are exported from lib/api.ts
- **Description**: Confirms `listProjects`, `createProject`, and `spawnAgentInProject` are exported async functions.
- **Steps**:
  1. Run the grep below.
- **Command**:
  ```bash
  grep -nE 'export async function (listProjects|createProject|spawnAgentInProject)\b' frontend/src/lib/api.ts
  ```
- **Expected Result**: Exactly three matches — one each for `listProjects`, `createProject`, and `spawnAgentInProject`.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-004: Helpers target the correct `/api/projects` routes
- **Description**: Confirms the helpers fetch `${API_BASE}/projects` (list/create) and `${API_BASE}/projects/${id}/agents` (spawn). `API_BASE` already ends in `/api`, so these resolve to `/api/projects` and `/api/projects/:id/agents`.
- **Steps**:
  1. Run the grep below.
- **Command**:
  ```bash
  grep -nE 'API_BASE\}/projects' frontend/src/lib/api.ts
  ```
- **Expected Result**: Matches include `` `${API_BASE}/projects` `` (used by `listProjects` and `createProject`) and `` `${API_BASE}/projects/${projectId.toString()}/agents` `` (used by `spawnAgentInProject`).
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-005: `spawnAgentInProject` omits `name` when undefined (enables backend auto-naming)
- **Description**: The spawn helper must send `{}` (empty body) when no name is given so the backend auto-names `${project.name}-${n}`, and `{ name }` only when a name is provided.
- **Steps**:
  1. Run the grep below.
- **Command**:
  ```bash
  grep -n 'name !== undefined ? { name } : {}' frontend/src/lib/api.ts
  ```
- **Expected Result**: One match inside `spawnAgentInProject` — the ternary that omits `name` from the JSON body when it is `undefined`.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-006: AddProjectForm component exists and is default-exported
- **Description**: Confirms `frontend/src/components/AddProjectForm.tsx` exists with a default-exported React component.
- **Steps**:
  1. Run the grep below.
- **Command**:
  ```bash
  grep -n 'export default function AddProjectForm' frontend/src/components/AddProjectForm.tsx
  ```
- **Expected Result**: One match.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-007: AddProjectForm calls `createProject` with name/workdir/defaultLaunchCmd
- **Description**: Confirms the form submits through the `createProject` helper rather than a raw fetch, passing the three fields.
- **Steps**:
  1. Run the grep below.
- **Command**:
  ```bash
  grep -n 'createProject({ name, workdir, defaultLaunchCmd })' frontend/src/components/AddProjectForm.tsx
  ```
- **Expected Result**: One match in the submit handler.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-008: ProjectList component exists and is default-exported
- **Description**: Confirms `frontend/src/components/ProjectList.tsx` exists with a default-exported React component.
- **Steps**:
  1. Run the grep below.
- **Command**:
  ```bash
  grep -n 'export default function ProjectList' frontend/src/components/ProjectList.tsx
  ```
- **Expected Result**: One match.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-009: ProjectList loads on mount, refetches after spawn, and renders an empty state
- **Description**: Because there is no `project-*` SSE event, ProjectList must call `listProjects()` on mount and re-`refetch()` after a spawn mutation, plus show a "No projects yet" empty state.
- **Steps**:
  1. Run the grep below.
- **Command**:
  ```bash
  grep -nE 'listProjects\(\)|void refetch\(\)|await refetch\(\)|No projects yet|spawnAgentInProject\(project\.id\)' frontend/src/components/ProjectList.tsx
  ```
- **Expected Result**: Matches for all of: `listProjects()` (inside `refetch`), `void refetch()` (mount `useEffect`), `await refetch()` (after spawn), `spawnAgentInProject(project.id)` (per-row auto-name spawn), and the `No projects yet` empty-state label.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-010: AddAgentForm imports the project helpers and is project-aware
- **Description**: Confirms `AddAgentForm` imports `listProjects`, `spawnAgentInProject`, and the `Project` type, and tracks a `selectedProjectId` state.
- **Steps**:
  1. Run the grep below.
- **Command**:
  ```bash
  grep -nE "import \{ API_BASE as API_URL, listProjects, spawnAgentInProject, type Project \}|selectedProjectId" frontend/src/components/AddAgentForm.tsx
  ```
- **Expected Result**: Matches for the project-aware import line and at least one `selectedProjectId` usage (state declaration + select binding).
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-011: AddAgentForm branches to `spawnAgentInProject` when a project is selected
- **Description**: When a project is selected, submit must route through `spawnAgentInProject(selectedProject.id, name.trim() || undefined)` instead of the free-form `POST ${API_URL}/agents` path.
- **Steps**:
  1. Run the grep below.
- **Command**:
  ```bash
  grep -n 'spawnAgentInProject(selectedProject.id, name.trim() || undefined)' frontend/src/components/AddAgentForm.tsx
  ```
- **Expected Result**: One match inside `handleSubmit` (the project-scoped branch).
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-012: AddAgentForm keeps the free-form `POST /api/agents` path for the "None" selection
- **Description**: When no project is selected, the existing free-form agent creation (name required, workdir absolute) must remain unchanged.
- **Steps**:
  1. Run the grep below.
- **Command**:
  ```bash
  grep -n 'fetch(`${API_URL}/agents`' frontend/src/components/AddAgentForm.tsx
  ```
- **Expected Result**: One match — the unchanged free-form `POST /api/agents` request used when `selectedProject === null`.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-013: AddAgentForm prefills + disables workdir from the selected project
- **Description**: Selecting a project must prefill the working-directory field from `selectedProject.workdir` and disable manual editing.
- **Steps**:
  1. Run the grep below.
- **Command**:
  ```bash
  grep -nE 'selectedProject !== null \? selectedProject.workdir : workdir|disabled=\{selectedProject !== null\}' frontend/src/components/AddAgentForm.tsx
  ```
- **Expected Result**: Matches for both the prefill expression (`value={selectedProject !== null ? selectedProject.workdir : workdir}`) and the `disabled={selectedProject !== null}` attribute on the workdir input.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-014: Both new islands are imported and mounted exactly once in index.astro
- **Description**: `AddProjectForm` and `ProjectList` must each be imported once and mounted once with `client:load`, without disturbing the sibling mounts (`AddAgentForm`, `AddBgProcessForm`, `AgentList`).
- **Steps**:
  1. Run the grep below.
- **Command**:
  ```bash
  grep -nE "import (AddProjectForm|ProjectList) from|<(AddProjectForm|ProjectList) client:load" frontend/src/pages/index.astro
  ```
- **Expected Result**: Exactly four matches — one import + one `client:load` mount for each of `AddProjectForm` and `ProjectList`.
- [x] Pass <!-- 2026-06-12 -->

---

## Human / Playwright Verification (not auto-runnable)

> **REQUIRES HUMAN OR PLAYWRIGHT VERIFICATION.** `/uat-auto` will **not** run these — they need a live backend (`:8788`) and Astro dev server (`:4321`). Mark Pass only after manually (or via Playwright MCP) observing the described behavior.

### UAT-UI-001: Create a project and see it appear in ProjectList
- **Page**: `http://localhost:4321/`
- **REQUIRES HUMAN VERIFICATION**
- **Description**: The "Add Project" form creates a project via `POST /api/projects` (201) and ProjectList shows it after its post-mount/refetch.
- **Steps**:
  1. Navigate to `http://localhost:4321/`.
  2. In the **Add Project** card, enter Name `uat-proj-016` (must match `^[A-Za-z0-9_-]+$`), Working Directory `/tmp/uat-proj-016` (absolute), and leave Default Launch Command at its prefilled value.
  3. Click **Create Project**.
  4. Observe the transient green "Project created ✓" message; the fields reset.
  5. Reload the page (ProjectList refetches on mount; there is no `project-*` SSE event).
- **Expected Result**: After reload, the **Projects** list contains a card for `uat-proj-016` showing its `name`, `workdir` (`/tmp/uat-proj-016`), and `defaultLaunchCmd`. No "No projects yet" empty state.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-UI-002: Spawn an agent from a project row (auto-named)
- **Page**: `http://localhost:4321/`
- **REQUIRES HUMAN VERIFICATION**
- **Description**: The per-row "Spawn agent" button calls `POST /api/projects/:id/agents` with no name; the backend auto-names the agent `${project.name}-${n}` and spawns its tmux window.
- **Steps**:
  1. With `uat-proj-016` visible in the **Projects** list, click its **Spawn agent** button.
  2. Observe the button label change to "Spawning…" while busy, then revert.
- **Expected Result**: A new agent named `uat-proj-016-1` (auto-named) appears in the **Agent List** below (surfaced via the existing monitor `agent-update` SSE loop). Its working directory and launch command match the project's `workdir`/`defaultLaunchCmd`. No row error is shown.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-UI-003: AddAgentForm prefills workdir + launch command from the selected project
- **Page**: `http://localhost:4321/`
- **REQUIRES HUMAN VERIFICATION**
- **Description**: Selecting a project in the **Add Agent** form's Project select prefills and disables the workdir/launch-command fields and makes the Name field optional (auto-name placeholder).
- **Steps**:
  1. In the **Add Agent** card, open the **Project** select and choose `uat-proj-016`.
  2. Observe the Working Directory and (under Advanced, if applicable) Launch Command fields.
  3. Observe the Name field's placeholder.
- **Expected Result**: Working Directory shows the project's `workdir` (`/tmp/uat-proj-016`) and is **disabled**; the Name field becomes optional with placeholder `(auto: uat-proj-016-N)`. Choosing "— None (free-form) —" again re-enables manual entry and makes Name required.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-UI-004: Spawning via the project-aware AddAgentForm creates an auto-named agent
- **Page**: `http://localhost:4321/`
- **REQUIRES HUMAN VERIFICATION**
- **Description**: With a project selected and the Name field left blank, submitting the Add Agent form routes through `spawnAgentInProject(id, undefined)` and the backend auto-names the agent.
- **Steps**:
  1. In **Add Agent**, select project `uat-proj-016` and leave Name blank.
  2. Submit the form.
  3. Observe the success UX.
- **Expected Result**: The form shows its success state; a new auto-named agent (e.g. `uat-proj-016-2`, next index) appears in the **Agent List**. No free-form `POST /api/agents` request is issued for this submission (the project branch is used instead).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

---

## Notes

- The backend project routes (`GET/POST /api/projects`, `POST /api/projects/:id/agents`) were delivered in a prior task (TASK-007 / ROADMAP-001) and are **not** in scope for TASK-016; they are exercised here only indirectly by the human/Playwright UI tests.
- Auto-runnable backbone: **UAT-STATIC-001 … UAT-STATIC-014** (14 tests). Human/Playwright: **UAT-UI-001 … UAT-UI-004** (4 tests).
