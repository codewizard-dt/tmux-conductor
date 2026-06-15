---
id: TASK-042
title: "Create /projects route page wrapping ProjectList and AddProjectForm"
status: done
created: 2026-06-13
updated: 2026-06-14
depends_on: [TASK-037, TASK-038, TASK-041]
blocks: [TASK-043]
parallel_safe_with: []
uat: "../uat/UAT-042-projects-list-page.md"
roadmap: ROADMAP-013
tags: [frontend, projects, react]
---

# TASK-042 — Create /projects route page wrapping ProjectList and AddProjectForm

## Objective

Replace the `ProjectsPage` stub (created in TASK-037) with a real implementation that renders the existing `AddProjectForm` and `ProjectList` components. The page should match the Agents page layout (max-width container, vertical gap between sections).

## Approach

Edit `src/pages/ProjectsPage.tsx` to import and render `AddProjectForm` and `ProjectList`. Both components already exist and are fully functional (built in TASK-016). No new API calls or state management are needed — those components are self-contained.

## Steps

### 1. Read the ProjectsPage stub

- [ ] Use Serena `find_symbol` (include_body=true) on `ProjectsPage` in `app/frontend/src/pages/ProjectsPage.tsx`.

### 2. Read existing components to confirm they're self-contained

- [ ] Use Serena `get_symbols_overview` on `app/frontend/src/components/AddProjectForm.tsx`
- [ ] Use Serena `get_symbols_overview` on `app/frontend/src/components/ProjectList.tsx`

### 3. Implement ProjectsPage

- [ ] Replace the `ProjectsPage.tsx` stub with:
  ```tsx
  import AddProjectForm from '../components/AddProjectForm'
  import ProjectList from '../components/ProjectList'

  export default function ProjectsPage() {
    return (
      <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-8">
        <AddProjectForm />
        <ProjectList />
      </main>
    )
  }
  ```

### 4. Verify

- [ ] Run `make typecheck` — zero errors
- [ ] Navigate to `/projects` — `AddProjectForm` and `ProjectList` render correctly
- [ ] Create a project via the form and confirm it appears in the list without a page refresh
