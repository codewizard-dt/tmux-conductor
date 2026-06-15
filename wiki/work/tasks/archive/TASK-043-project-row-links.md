---
id: TASK-043
title: "Make each project row in ProjectList a clickable link to /projects/:id"
status: done
created: 2026-06-13
updated: 2026-06-13
depends_on: [TASK-042]
blocks: [TASK-044]
parallel_safe_with: []
uat: "../uat/UAT-043-project-row-links.md"
roadmap: ROADMAP-013
tags: [frontend, projects, react, routing]
---

# TASK-043 — Make each project row in ProjectList a clickable link to /projects/:id

## Objective

Wrap the project name (or the whole row) in `ProjectList.tsx` with a `<Link to={/projects/${project.id}>` so users can navigate to the Project Details page. The existing "Spawn agent" button remains as-is — clicking it should NOT navigate.

## Approach

Edit `ProjectList.tsx`. Import `Link` from react-router-dom. Wrap the project name/title span with a `<Link>`. Keep the spawn button outside the link so its click action is independent.

## Steps

### 1. Read ProjectList.tsx

- [x] Use Serena `find_symbol` (include_body=true) on `ProjectList` in `app/frontend/src/components/ProjectList.tsx`. <!-- Completed: 2026-06-14 -->

### 2. Add Link import and wrap project name

- [x] Import `Link` from `react-router-dom` at the top of `ProjectList.tsx`
- [x] Wrap the project name `<span>` with:
  ```tsx
  <Link
    to={`/projects/${project.id.toString()}`}
    className="block truncate font-mono text-[12px] font-semibold text-ink hover:underline"
  >
    {project.name}
  </Link>
  ```
- [x] Remove the `block truncate font-mono text-[12px] font-semibold text-ink` classes from the inner `<span>` since they move to the `<Link>`

### 3. Verify

- [x] Run `make typecheck` — zero errors <!-- Completed: 2026-06-14 -->
- [ ] Navigate to `/projects` and click a project name — browser navigates to `/projects/<id>` [DEFERRED-TO-UAT]
- [ ] Clicking "Spawn agent" button does NOT navigate away from the list [DEFERRED-TO-UAT]
