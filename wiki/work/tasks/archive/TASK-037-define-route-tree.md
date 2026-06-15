---
id: TASK-037
title: "Define route tree (/, /projects, /projects/:id) in App.tsx and create page stubs"
status: done
created: 2026-06-13
updated: 2026-06-13
depends_on: [TASK-036]
blocks: [TASK-039, TASK-040, TASK-041, TASK-042]
parallel_safe_with: [TASK-038]
uat: "../uat/UAT-037-define-route-tree.md"
roadmap: ROADMAP-013
tags: [frontend, routing, react]
---

# TASK-037 — Define route tree (/, /projects, /projects/:id) in App.tsx and create page stubs

## Objective

Replace the static `<main>` content in `App.tsx` with a `<Routes>` / `<Route>` tree covering `/`, `/projects`, and `/projects/:id`. The persistent `<header>` stays outside `<Routes>` so it renders on every page. Create thin page-wrapper components for each route; `ProjectsPage` and `ProjectDetailPage` are stubs at this stage.

## Approach

- Move the existing `<AddAgentForm>` + `<AgentList>` content from `App.tsx` into a new `src/pages/AgentsPage.tsx`.
- Create stub files `src/pages/ProjectsPage.tsx` and `src/pages/ProjectDetailPage.tsx` using the existing `Placeholder` component.
- Rewrite `App.tsx` to render `<Routes>` with three `<Route>` entries; keep the `<header>` above `<Routes>` in the layout shell.

## Steps

### 1. Read current App.tsx

- [x] Use Serena `get_symbols_overview` on `app/frontend/src/App.tsx` to confirm current structure. <!-- Completed: 2026-06-13 -->
- [x] Use Serena `find_symbol` (include_body=true) to read the full `App` function body. <!-- Completed: 2026-06-13 -->

### 2. Create AgentsPage

- [x] Create `app/frontend/src/pages/AgentsPage.tsx`: <!-- Completed: 2026-06-13 -->
  ```tsx
  import AddAgentForm from '../components/AddAgentForm'
  import AgentList from '../components/AgentList'

  export default function AgentsPage() {
    return (
      <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-8">
        <AddAgentForm />
        <AgentList />
      </main>
    )
  }
  ```

### 3. Create page stubs

- [x] Create `app/frontend/src/pages/ProjectsPage.tsx` — renders `<Placeholder label="Projects" />` (import from `../components/Placeholder`) <!-- Completed: 2026-06-13 -->
- [x] Create `app/frontend/src/pages/ProjectDetailPage.tsx` — renders `<Placeholder label="Project Detail" />` <!-- Completed: 2026-06-13 -->

### 4. Rewrite App.tsx

- [x] Import `Routes`, `Route` from `react-router-dom` <!-- Completed: 2026-06-13 -->
- [x] Import `AgentsPage`, `ProjectsPage`, `ProjectDetailPage` from `./pages/` <!-- Completed: 2026-06-13 -->
- [x] Replace the `<main>` block with: <!-- Completed: 2026-06-13 -->
  ```tsx
  <Routes>
    <Route path="/" element={<AgentsPage />} />
    <Route path="/projects" element={<ProjectsPage />} />
    <Route path="/projects/:id" element={<ProjectDetailPage />} />
  </Routes>
  ```
- [x] Keep the `<header>` above `<Routes>` in the outer `<div>` (persistent layout shell) <!-- Completed: 2026-06-13 -->
- [x] Remove the now-unused `AddAgentForm` and `AgentList` imports from `App.tsx` <!-- Completed: 2026-06-13 -->

### 5. Verify

- [x] Run `make typecheck` — zero errors <!-- Completed: 2026-06-13 -->
- [DEFERRED-TO-UAT] Start the frontend dev server (`npm run dev` in `app/frontend/`) and confirm `/` loads the agents view, `/projects` shows the placeholder, `/projects/1` shows the placeholder
