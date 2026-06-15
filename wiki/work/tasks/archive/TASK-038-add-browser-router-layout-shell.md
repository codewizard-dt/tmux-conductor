---
id: TASK-038
title: "Wrap app in BrowserRouter in main.tsx"
status: done
created: 2026-06-13
updated: 2026-06-13
depends_on: [TASK-036]
blocks: [TASK-039, TASK-040, TASK-041, TASK-042]
parallel_safe_with: [TASK-037]
uat: "../uat/UAT-038-add-browser-router-layout-shell.md"
roadmap: ROADMAP-013
tags: [frontend, routing, react]
---

# TASK-038 — Wrap app in BrowserRouter in main.tsx

## Objective

Wrap the root `<App>` render in `main.tsx` with `<BrowserRouter>` from react-router-dom so that the `<Routes>` / `<Route>` tree defined in `App.tsx` (TASK-037) has a router context to operate within.

## Approach

`main.tsx` is the Vite entry point. Add `BrowserRouter` as the outermost wrapper around `<App>`. This is the canonical placement for Vite+React projects.

## Steps

### 1. Read main.tsx

- [x] Use Serena `find_symbol` (include_body=true) on `app/frontend/src/main.tsx` to see the current render call. <!-- Completed: 2026-06-13 -->

### 2. Add BrowserRouter

- [x] Import `BrowserRouter` from `react-router-dom` <!-- Completed: 2026-06-13 -->
- [x] Wrap `<App />` with `<BrowserRouter>`: <!-- Completed: 2026-06-13 -->
  ```tsx
  import { BrowserRouter } from 'react-router-dom'
  // ...
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  )
  ```

### 3. Verify

- [x] Run `make typecheck` — zero errors <!-- Completed: 2026-06-13 -->
- [DEFERRED-TO-UAT] Confirm the dev server still starts and `/` renders without a "No router" error in the console
