---
id: UAT-038
title: "UAT: Wrap app in BrowserRouter in main.tsx"
status: pending
task: TASK-038
created: 2026-06-13
updated: 2026-06-13
---

# UAT-038 — UAT: Wrap app in BrowserRouter in main.tsx

implements::[[TASK-038]]

> **Source task**: [`wiki/work/tasks/TASK-038-add-browser-router-layout-shell.md`](../tasks/TASK-038-add-browser-router-layout-shell.md)
> **Generated**: 2026-06-13

> **Implementation note**: After the original task was completed, `BrowserRouter` was removed from `main.tsx` because `App.tsx` already uses `createBrowserRouter` + `RouterProvider` (which provides its own router context internally). Adding `BrowserRouter` around a `RouterProvider` would be a duplicate context — a React Router v7 error. These tests verify the corrected state: no `BrowserRouter` in `main.tsx`, and the app functions correctly via `RouterProvider` alone.

---

## Prerequisites

- [ ] The Vite dev server is running: `cd app/frontend && npm run dev` (default port 4321)
- [ ] The backend server is running: `cd app && npm run dev` (default port 8788)
- [ ] A browser is available to navigate to `http://localhost:4321`

---

## Test Cases

### UAT-STATIC-001: main.tsx does not import BrowserRouter
- **Description**: Confirms that `BrowserRouter` has been removed from `main.tsx` — importing it alongside `RouterProvider` would create a nested router context error in React Router v7.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -c 'BrowserRouter' app/frontend/src/main.tsx; echo "exit:$?"
  ```
- **Expected Result**: Output is `0` (zero occurrences). Any non-zero count means `BrowserRouter` is still present and must be removed.
- [x] Pass <!-- 2026-06-13 -->

### UAT-STATIC-002: main.tsx does not use BrowserRouter as JSX
- **Description**: Confirms no `<BrowserRouter>` JSX tag appears in `main.tsx`.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -c '<BrowserRouter' app/frontend/src/main.tsx; echo "exit:$?"
  ```
- **Expected Result**: Output is `0`. Any other count is a failure.
- [x] Pass <!-- 2026-06-13 -->

### UAT-STATIC-003: App.tsx uses createBrowserRouter and RouterProvider
- **Description**: The router context must be provided by `RouterProvider` (wrapping `createBrowserRouter`) inside `App.tsx` — not by `BrowserRouter` in `main.tsx`.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -c 'createBrowserRouter\|RouterProvider' app/frontend/src/App.tsx
  ```
- **Expected Result**: Output is `2` (one match per pattern). Both `createBrowserRouter` and `RouterProvider` must be present in `App.tsx`.
- [x] Pass <!-- 2026-06-13 -->

### UAT-STATIC-004: main.tsx renders App in React.StrictMode only
- **Description**: `main.tsx` should wrap `<App />` in `<React.StrictMode>` and nothing else — no additional router wrapper.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -E 'StrictMode|createRoot|<App' app/frontend/src/main.tsx
  ```
- **Expected Result**: Output contains lines for `React.StrictMode`, `createRoot`, and `<App` with no `BrowserRouter` present in any of those lines.
- [x] Pass <!-- 2026-06-13 -->

### UAT-STATIC-005: Typecheck passes with zero errors
- **Description**: Removing `BrowserRouter` from `main.tsx` must not introduce TypeScript errors.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  cd app/frontend && npx tsc --noEmit 2>&1 | tail -5; echo "exit:$?"
  ```
- **Expected Result**: Exit code is `0` (last line shows `exit:0`). No TypeScript errors in output.
- [x] Pass <!-- 2026-06-13 -->

### UAT-UI-001: App loads at root route without router context error
- **Description**: Navigating to `http://localhost:4321/` must render the app without a "You cannot render a <Router> inside another <Router>" error or any "No router" crash in the browser console.
- **Steps**:
  1. Open a browser and navigate to `http://localhost:4321/`.
  2. Open the browser DevTools console (F12 → Console tab).
  3. Check for any React Router error messages.
- **Expected Result**: The page renders (either the login page at `/login` or the agents dashboard). The DevTools console shows zero React Router errors. No red error overlay appears.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-13 -->

### UAT-UI-002: Login page renders at /login
- **Description**: The `/login` route must be accessible — it is defined in `createBrowserRouter` in `App.tsx` and must resolve correctly.
- **Steps**:
  1. Navigate to `http://localhost:4321/login`.
  2. Observe the rendered page.
- **Expected Result**: The `LoginPage` component renders (a login form or equivalent UI). No 404, no blank screen, no unhandled router error.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-13 -->

### UAT-UI-003: Auth-guarded route redirects unauthenticated users
- **Description**: Routes other than `/login` are wrapped in `<AuthGuard>`. Unauthenticated navigation to `/*` must redirect to `/login`, confirming the router tree (defined in `App.tsx` via `createBrowserRouter`) operates correctly without a `BrowserRouter` wrapper in `main.tsx`.
- **Steps**:
  1. Ensure you are not logged in (clear localStorage if needed, or use an incognito window).
  2. Navigate to `http://localhost:4321/`.
  3. Observe the resulting URL and page content.
- **Expected Result**: The browser redirects to `/login` (URL in address bar changes to `http://localhost:4321/login`). The login page renders. No console errors about router context.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-13 -->

### UAT-EDGE-001: No nested-router runtime error with RouterProvider
- **Description**: React Router v7 throws "You cannot render a <Router> inside another <Router>" if `BrowserRouter` wraps a `RouterProvider`. This test confirms that error does NOT occur.
- **Steps**:
  1. Open browser DevTools (Console tab).
  2. Navigate to `http://localhost:4321/`.
  3. Search the console output for the text "cannot render a" or "another <Router>".
- **Expected Result**: No such error message appears in the console. The app runs without a nested-router runtime exception.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-13 -->
