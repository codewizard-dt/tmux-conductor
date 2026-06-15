---
id: ROADMAP-013
title: Projects page, project details page, and nav bar
status: done
created: 2026-06-13
updated: 2026-06-14
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [frontend, routing, projects]
---

# Roadmap 013: Projects page, project details page, and nav bar

## Goal

The dashboard has a top nav bar linking to an Agents page and a Projects page. The Projects page lists all projects (reusing the existing `ProjectList` and `AddProjectForm` components); clicking a project opens a Project Details page showing its scoped agents, a Spawn Agent button, and a project-scoped task queue (reusing existing `AgentList` and `TaskList` components where possible). Internal nav links connect all views.

## Phase 1: Routing

- [x] [TASK-036: Install react-router-dom in the Vite React frontend](../tasks/completed/TASK-036-install-react-router-dom.md)
- [x] [TASK-037: Define route tree (/, /projects, /projects/:id) in App.tsx and create page stubs](../tasks/completed/TASK-037-define-route-tree.md)
- [x] [TASK-038: Wrap app in BrowserRouter in main.tsx](../tasks/completed/TASK-038-add-browser-router-layout-shell.md)

## Phase 2: Nav

- [x] [TASK-039: Create NavBar component with NavLink items for Agents and Projects](../tasks/completed/TASK-039-create-navbar-component.md)
- [x] [TASK-040: Replace the static header in App.tsx with the NavBar component](../tasks/completed/TASK-040-replace-header-with-navbar.md)
- [x] [TASK-041: Verify and polish active-link styling on NavBar](../tasks/completed/TASK-041-active-link-styling.md)

## Phase 3: Pages

- [x] [TASK-042: Create /projects route page wrapping ProjectList and AddProjectForm](../tasks/completed/TASK-042-projects-list-page.md)
- [x] [TASK-043: Make each project row in ProjectList a clickable link to /projects/:id](../tasks/completed/TASK-043-project-row-links.md)

## Phase 4: Details

- [x] [TASK-044: Create /projects/:id route page with project header (name, workdir, defaultLaunchCmd)](../tasks/completed/TASK-044-project-detail-page-header.md)
- [x] [TASK-045: Show agents scoped to this project with a Spawn Agent button on the detail page](../tasks/completed/TASK-045-project-detail-agents.md)
- [x] [TASK-046: Show project-scoped task queue on the project detail page](../tasks/completed/TASK-046-project-detail-task-queue.md)

## Notes

