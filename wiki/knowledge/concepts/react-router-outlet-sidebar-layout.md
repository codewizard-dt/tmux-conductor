---
id: react-router-outlet-sidebar-layout
title: React Router Sidebar + Outlet Detail-Pane Layout
updated: 2026-09-18
sources:
  - ../../../raw/research/agents-page-sidebar-layout/index.md
confidence: extracted
tags: [frontend, react-router, layout-pattern]
---

# React Router Sidebar + Outlet Detail-Pane Layout

React Router's own address-book tutorial documents the canonical shape for "a list in a sidebar, click an item to render its detail in the main content area": a parent `layout` route renders the sidebar markup plus an `<Outlet />` for the detail pane; a child `index` route fills that pane with an empty/placeholder state so it isn't blank when nothing is selected; a sibling child route with a dynamic segment (e.g. `contacts/:contactId`) renders the selected item's detail. The newer tutorial examples use loader-based `RouteConfig`/`layout()`/`route()` helpers, but the same shape is expressible with the classic `<Routes>/<Route>` API (`<Route element={<SidebarLayout/>}><Route index .../><Route path=":id" .../></Route>`) that does not require adopting loaders.

This directly informs `derived_from::[[agents-page-sidebar-layout]]`: the Agents page's Kanban-to-sidebar refactor can express "click an agent → detail renders in the main content area" either as a URL-addressable route (`/agents/:agentId`, deep-linkable, refresh-safe) or as local component state (mirroring the modal's current `expandedAgent` state, just rendered inline instead of in an overlay) — the routed version costs one new route plus replacing `useState`/`onNavigate` calls with `useParams`/`useNavigate`, and buys deep-linking/refresh-safety that the current modal-only implementation lacks.

relates_to::[[agents-page-sidebar-layout]]
relates_to::[[agent-detail-modal]]
