---
id: TASK-044
title: "Create /projects/:id route page with project header (name, workdir, defaultLaunchCmd)"
status: done
created: 2026-06-13
updated: 2026-06-14
depends_on: [TASK-043]
blocks: [TASK-045, TASK-046]
parallel_safe_with: []
uat: "../uat/UAT-044-project-detail-page-header.md"
roadmap: ROADMAP-013
tags: [frontend, projects, react]
---

# TASK-044 — Create /projects/:id route page with project header (name, workdir, defaultLaunchCmd)

## Objective

Replace the `ProjectDetailPage` stub with a real implementation that fetches the project by `:id`, shows a header card with the project's `name`, `workdir`, and `defaultLaunchCmd`, and handles loading/error/not-found states.

## Approach

Use `useParams` from react-router-dom to get the `id`. Call `listProjects()` and find the matching project (no per-project GET endpoint exists; listing all and filtering is fine given typical project counts). Render a header card using the existing card style classes (`rounded-card border border-line bg-white px-5 py-4 shadow-card`).

## Steps

### 1. Read the stub

- [ ] Use Serena `find_symbol` (include_body=true) on `ProjectDetailPage` in `app/frontend/src/pages/ProjectDetailPage.tsx`.

### 2. Read listProjects helper

- [ ] Use Serena `find_symbol` (include_body=true) on `listProjects` in `app/frontend/src/lib/api.ts` to confirm the shape of `Project`.

### 3. Implement ProjectDetailPage header

- [ ] Import `useParams` from `react-router-dom`
- [ ] Import `listProjects`, `Project` from `../lib/api`
- [ ] Fetch project on mount with `useState` + `useEffect`:
  ```tsx
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void listProjects().then((list) => {
      const p = list.find((x) => x.id === Number(id))
      if (p) setProject(p)
      else setNotFound(true)
    }).finally(() => setLoading(false))
  }, [id])
  ```
- [ ] Render:
  - Loading state: muted "Loading…" text
  - Not-found state: "Project not found" with a back link to `/projects`
  - Found: a card showing project `name` (heading), `workdir` (mono/muted), `defaultLaunchCmd` (mono/muted), and a back link `← Projects`

### 4. Verify

- [ ] Run `make typecheck` — zero errors
- [ ] Navigate to `/projects/<valid-id>` — header card renders with project data
- [ ] Navigate to `/projects/99999` — not-found state renders
