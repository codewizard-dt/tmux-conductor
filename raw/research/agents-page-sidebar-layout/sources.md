---
topic: Refactor the Agents page layout — remove the Kanban board entirely; list agents in a sidebar grouped by project with a colored right border for status; clicking an agent renders its detail (currently a modal) in the main content area instead of a popup, i.e. a sidebar-navigation layout
slug: agents-page-sidebar-layout
researched: 2026-09-18
---

# Primary Sources — Agents Page Sidebar Layout Refactor

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `frontend/src/components/AgentList.tsx` (COLUMNS `:1280`, columnFor `:1290`, STATUS_CONFIG `:89`, getStatusColor `:103`, AgentDetailModal `:588`, expandedAgent state `:1714`, handleNavigate `:1730`, projectLabelFor/projectIdFor `:2000-2001`, byProjectThenStatus `:2005`) | 2026-09-18 | Kanban column structure, existing status-color mapping, modal prop surface and internal effects, project-grouping sort logic, open/navigate state ownership |
| S2 | context7 | `/remix-run/react-router` — "nested route with sidebar list and Outlet showing detail panel selected by URL param, index route for no-selection state" | 2026-09-18 | Canonical `layout + index + :id route` pattern for sidebar-nav + detail-pane layouts; confirms an index route is needed to avoid a blank detail pane |
| S3 | codebase | `frontend/src/pages/AgentsPage.tsx` (full file) | 2026-09-18 | Confirms AgentsPage is a thin wrapper; all Kanban/detail logic lives in AgentList.tsx |
| S4 | codebase | `frontend/src/App.tsx` (routes list) | 2026-09-18 | Confirms `react-router-dom` v7 is already in use with a conventional `<Routes>/<Route>` tree (`/`, `/projects`, `/projects/:id`, `/history`), no existing `/agents/:id` route |
| S5 | codebase | `frontend/package.json` (`react-router-dom": "^7.17.0"`) | 2026-09-18 | Confirms installed react-router-dom major version |
| S6 | codebase | `frontend/src/components/AgentList.test.tsx` (`:426`, `:691`) | 2026-09-18 | Confirms existing tests directly encode Kanban/grouping assumptions in comments, flagging test-rewrite scope |
| S7 | codebase | `frontend/src/components/NavBar.tsx:9-54` | 2026-09-18 | Confirms an existing top bar with nav links and a right-aligned (`ml-auto`) button slot, ready to host Add Agent/Add Background Process triggers |
| S8 | codebase | `frontend/src/components/AddBgProcessForm.tsx:24-234` | 2026-09-18 | Confirms the form is an always-rendered inline card today (no `open`/`onClose` props), unlike `AddAgentForm` |
| S9 | codebase | `frontend/src/components/InactiveAgentsPanel.tsx:12-167` | 2026-09-18 | Confirms existing collapsed/disclosure pattern and per-row detail-open behavior, reusable for a sidebar-docked collapsible inactive section |

## Excerpts

### S1 — `AgentList.tsx` COLUMNS / columnFor
```
const COLUMNS: Column[] = [
  { key: 'attention', label: 'Waiting / Stalled', statuses: ['awaiting', 'stalled', 'error'] },
  { key: 'busy', label: 'Busy', statuses: ['busy', 'starting'] },
  { key: 'ready', label: 'Ready / No tasks', statuses: ['idle', 'idle-waiting', 'empty'] },
]
```

### S1 — `AgentList.tsx` STATUS_CONFIG / getStatusColor
```
export const STATUS_CONFIG: Record<AgentStatus, { bg: string; color: string; dot: string; label: string }> = {
  busy: { bg: 'var(--color-status-busy-bg)', color: 'var(--color-status-busy-text)', dot: '#3b6ef6', label: 'busy' },
  ...
}
export function getStatusColor(status: AgentStatus): string {
  return STATUS_CONFIG[status].dot
}
```

### S2 — React Router address-book tutorial (Outlet + sidebar layout)
https://github.com/remix-run/react-router/blob/main/docs/tutorials/address-book.md
> When a route has children, and you're at the parent route's path, the `<Outlet>` has nothing to render because no children match. You can think of index routes as the default child route to fill in that space.

```tsx
export default [
  layout("layouts/sidebar.tsx", [
    index("routes/home.tsx"),
    route("contacts/:contactId", "routes/contact.tsx"),
    route("contacts/:contactId/edit", "routes/edit-contact.tsx"),
  ]),
  route("about", "routes/about.tsx"),
] satisfies RouteConfig;
```

### S4 — `App.tsx` routes
```
<Routes>
  <Route path="/" element={<AgentsPage />} />
  <Route path="/projects" element={<ProjectsPage />} />
  <Route path="/projects/:id" element={<ProjectDetailPage />} />
  <Route path="/history" element={<TaskHistoryPage />} />
```

### S6 — `AgentList.test.tsx` Kanban-coupling comments
```
// from AgentList's own kanban columns — they render in InactiveAgentsPanel.tsx instead,
...
// kanban's byProjectThenStatus/groupByProject grouping.
```
