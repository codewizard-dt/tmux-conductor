---
id: TASK-016
title: "Make AddAgentForm project-aware and add ProjectList/AddProjectForm components"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-007]
blocks: []
parallel_safe_with: [TASK-001, TASK-011, TASK-012]
uat: "../uat/UAT-016-frontend-projects-ui.md"
tags: [frontend, react, projects]
---

# TASK-016 — Make AddAgentForm project-aware and add ProjectList/AddProjectForm components

## Objective

Surface the SQLite-backed projects layer (added in ROADMAP-001) in the Astro+React dashboard. Three concrete deliverables:

1. **Project-aware AddAgentForm** — add a project picker. When a project is selected, spawning routes through `POST /api/projects/:id/agents` (omit `name` to get backend auto-naming `${project.name}-${n}`, inheriting the project's `workdir` + `defaultLaunchCmd`); when no project is selected, keep the existing `POST /api/agents` free-form path unchanged.
2. **ProjectList** (new React component) — lists projects from `GET /api/projects`, showing `name`, `workdir`, `defaultLaunchCmd`, with a per-row "Spawn agent" action that calls `POST /api/projects/:id/agents` (auto-name).
3. **AddProjectForm** (new React component) — creates a project via `POST /api/projects` (`{ name, workdir, defaultLaunchCmd? }`).

Add `Project` TypeScript types + fetch helpers to `frontend/src/lib/api.ts`.

## Approach

Confirmed against real code:

- **Routes are under the `/api` prefix.** `frontend/src/lib/api.ts` already exports `API_BASE` ending in `/api` (`http://localhost:8788/api`). So endpoints are `${API_BASE}/projects` and `${API_BASE}/projects/${id}/agents`. The Fastify handlers register as `api.get('/projects')`, `api.post('/projects')`, `api.post('/projects/:id/agents')` (`backend/index.ts:972-1071`).
- **`POST /api/projects`** body `{ name, workdir, defaultLaunchCmd? }`. `name` must match `^[A-Za-z0-9_-]+$`, `workdir` must start with `/`, optional `defaultLaunchCmd` string. Returns **201** with the created `Project`; **400** on validation error (`{ error }`).
- **`POST /api/projects/:id/agents`** body `{ name?: string }`. Omit `name` for auto-naming via `nextAgentName` → `${project.name}-${n}`; if provided, `name` must match `^[A-Za-z0-9_-]+$`. The new agent inherits `project.workdir` and `project.defaultLaunchCmd`, is created, and its tmux window is spawned. Returns **201** with the new `Agent`; **404** if project not found; **400** on bad name.
- **`GET /api/projects`** returns `Project[]` where `Project = { id: number; name: string; workdir: string; defaultLaunchCmd: string; createdAt: string }` (mirrors `backend/db.ts` `Project` interface; `projects` table; `agents.project_id` FK).
- **No SSE event is broadcast on project create or on `POST /projects/:id/agents`.** The `broadcastSSE` events in `backend/index.ts` cover agents/tasks/bg/session/terminal/schedules — there is **no** `project-*` event. Therefore ProjectList must **refetch `GET /api/projects` after its own mutations** (and on mount) rather than rely on the SSE stream. The spawned agent itself will appear in `AgentList` via the existing monitor `agent-update` loop, so no extra wiring is needed for that.

### COLLISION NOTE (shared files — Phase 4 siblings edit these concurrently)

- **`frontend/src/lib/api.ts` is shared** with sibling Phase 4 tasks. **Confine all edits to a single clearly-delimited "Project types + helpers" section** appended at the end of the file (wrap it in `// ── Projects ──` / `// ── end Projects ──` comment markers). Do **not** touch `API_BASE`, `KeysPayload`, `sendAgentKeys`, or `uploadAgentImage`.
- **The root layout `frontend/src/pages/index.astro` is shared.** It is the live entry point (mounts `AddAgentForm`, `AddBgProcessForm`, `AgentList` via `client:load`). When registering components, **add only the project-related ones** (`AddProjectForm`, `ProjectList`) and only your import lines — do not reorder, remove, or modify other siblings' mounts. (Note: `frontend/src/App.tsx` is a secondary/legacy mount and is NOT the live page; do not rely on it.)

## Steps

### 1. Add Project types + fetch helpers to api.ts  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Use Serena `get_symbols_overview` on `frontend/src/lib/api.ts` to confirm current exports (`API_BASE`, `KeysPayload`, `sendAgentKeys`, `uploadAgentImage`).
- [x] Append a delimited section at the **end** of the file (do not edit existing exports):
  ```ts
  // ── Projects ──────────────────────────────────────────────────────────────
  export interface Project {
    id: number;
    name: string;
    workdir: string;
    defaultLaunchCmd: string;
    createdAt: string;
  }

  /** GET /api/projects */
  export async function listProjects(): Promise<Project[]> {
    const res = await fetch(`${API_BASE}/projects`);
    if (!res.ok) throw new Error(`HTTP ${res.status.toString()}`);
    return res.json() as Promise<Project[]>;
  }

  /** POST /api/projects — name must match ^[A-Za-z0-9_-]+$, workdir absolute. */
  export async function createProject(input: {
    name: string;
    workdir: string;
    defaultLaunchCmd?: string;
  }): Promise<Project> {
    const res = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
    }
    return res.json() as Promise<Project>;
  }

  /** POST /api/projects/:id/agents — omit name for auto-naming (project-N). Returns the new agent. */
  export async function spawnAgentInProject(
    projectId: number,
    name?: string,
  ): Promise<unknown> {
    const res = await fetch(`${API_BASE}/projects/${projectId.toString()}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(name !== undefined ? { name } : {}),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
    }
    return res.json();
  }
  // ── end Projects ──────────────────────────────────────────────────────────
  ```
- [x] Match the existing file's quote/semicolon/error-handling style (single quotes, trailing semicolons, `body.error ?? HTTP ${res.status.toString()}`).

### 2. Create AddProjectForm component  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Use Serena `get_symbols_overview` + Read on `frontend/src/components/AddAgentForm.tsx` to copy its visual idiom (the `fieldCls`/`labelCls`/`inputCls` Tailwind class constants, the card wrapper `rounded-card border border-line bg-white px-5 py-4 shadow-card`, the submit-button classes, success/error message styling).
- [x] Create `frontend/src/components/AddProjectForm.tsx`, default-exported React component:
  - State: `name`, `workdir`, `defaultLaunchCmd` (default to `'claude --dangerously-skip-permissions'`), `error`, `success`, `submitting`.
  - Validate `name` against `/^[A-Za-z0-9_-]+$/` and `workdir.startsWith('/')` client-side (mirror AddAgentForm), then call `createProject({ name, workdir, defaultLaunchCmd })` from `../lib/api`.
  - On success: clear fields, show a transient "Project created ✓" message (`setTimeout` 4s, same as AddAgentForm).
  - On error: show `err.message` in the red error line.
  - Reuse the git-root hint pattern from `useGitRoot` only if trivial; otherwise omit (out of scope).
- [x] Use `void`-wrapped async submit handler exactly like AddAgentForm's `onSubmit` to satisfy the repo's lint rules.

### 3. Create ProjectList component  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Create `frontend/src/components/ProjectList.tsx`, default-exported React component.
- [x] On mount, call `listProjects()` (`useEffect` + `useState<Project[]>`); store `loading`/`error` state. **There is no `project-*` SSE event**, so also re-run `listProjects()` after any mutation this component triggers (spawn) and expose a manual refetch.
- [x] Render each project as a card/row showing `name`, `workdir`, `defaultLaunchCmd` (mono/muted styling consistent with the inactive-agent rows in AddAgentForm).
- [x] Each row gets a "Spawn agent" button calling `spawnAgentInProject(project.id)` (no name → auto-named `${project.name}-${n}`). Track per-row busy + per-row error like AddAgentForm's `rowBusy`/`rowError`. The spawned agent appears in `AgentList` via the existing monitor SSE loop, so no extra refresh of the agent list is required here.
- [x] Empty state: a muted "No projects yet" line when the list is empty.

### 4. Make AddAgentForm project-aware  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Read `frontend/src/components/AddAgentForm.tsx` (already the canonical add-agent form).
- [x] Add a `Project[]` state loaded via `listProjects()` on mount, and a `selectedProjectId: number | null` state (default `null`).
- [x] Add a "Project" `<select>` at the top of the form (using `labelCls`/`inputCls`), options: `"— None (free-form) —"` (value empty → `null`) plus one `<option value={p.id}>` per project showing `p.name`.
- [x] When a project is selected (`selectedProjectId !== null`):
  - Prefill (and disable) `workdir` + `launchCmd` from the selected project's `workdir`/`defaultLaunchCmd`, and make the `name` field **optional** (placeholder e.g. `"(auto: ${project.name}-N)"`), since the backend auto-names.
  - In `handleSubmit`, branch: call `spawnAgentInProject(selectedProjectId, name.trim() || undefined)` instead of `POST ${API_URL}/agents`. Treat a thrown error as the error case; treat resolve as the success case (reuse the existing success UX).
- [x] When no project is selected, keep the **existing** `POST ${API_URL}/agents` behavior and validation **unchanged** (name required, workdir absolute).
- [x] Do not remove or restructure the existing "Inactive Agents" wake/remove section.

### 5. Register components in the root layout  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Re-read `frontend/src/pages/index.astro` immediately before editing (siblings edit it concurrently — COLLISION NOTE above).
- [x] Add only these two import lines in the frontmatter fence and only these two mounts in `<body>` (place them after `AddAgentForm`, before `AgentList`); do not touch other siblings' lines:
  ```astro
  import AddProjectForm from '../components/AddProjectForm.tsx'
  import ProjectList from '../components/ProjectList.tsx'
  ```
  ```astro
  <AddProjectForm client:load />
  <ProjectList client:load />
  ```

### 6. Verification — make typecheck  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] From the repo root run `make typecheck` and confirm it passes with zero errors (this runs the frontend strict TypeScript check; new components, `api.ts` helpers, and the AddAgentForm branch must all type-clean).
- [x] If `make typecheck` surfaces lint-style issues (floating promises, `no-base-to-string`, etc.), fix them in-place following the `void`/`.toString()` patterns already used in `AddAgentForm.tsx` and `api.ts`.
- [x] Sanity-check the wiring by reading the final `frontend/src/pages/index.astro` to confirm both new components are mounted exactly once and no sibling mount was disturbed.
