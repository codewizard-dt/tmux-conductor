---
id: UAT-036
title: "UAT: Install react-router-dom in the Vite React frontend"
status: passed
task: "../tasks/TASK-036-install-react-router-dom.md"
created: 2026-06-13
---

# UAT-036 — UAT: Install react-router-dom in the Vite React frontend

implements::[[TASK-036]]

## Scope

Verify that `react-router-dom` (v7.x with bundled TypeScript declarations) is correctly installed in `app/frontend/`, that no separate `@types/react-router-dom` package was added, and that `make typecheck` passes cleanly after the install. Tests also confirm that the router wiring introduced alongside the package (router definition in `App.tsx`, `RouterProvider` mount, route-aware components) is type-correct and structurally sound.

---

## UAT-STATIC-001 — react-router-dom present in app/frontend/package.json dependencies

Confirm the package appears as a runtime dependency (not devDependency) with a v7.x semver range.

```sh
grep -E '"react-router-dom":\s*"\^7\.' app/frontend/package.json
```

Expected: line matches `"react-router-dom": "^7.` (currently `"^7.17.0"`).

- [x] Pass <!-- 2026-06-13 -->

---

## UAT-STATIC-002 — No @types/react-router-dom entry anywhere in app/frontend/package.json

react-router-dom v6/v7 ships its own TypeScript declarations; a separate @types package would be incorrect.

```sh
grep '@types/react-router-dom' app/frontend/package.json
```

Expected: exit code 1, no output.

- [x] Pass <!-- 2026-06-13 -->

---

## UAT-STATIC-003 — react-router-dom installed in node_modules (package-lock.json record present)

Confirm npm install was actually executed and the package landed in node_modules.

```sh
grep '"node_modules/react-router-dom"' app/frontend/package-lock.json
```

Expected: at least one matching line.

- [x] Pass <!-- 2026-06-13 -->

---

## UAT-STATIC-004 — Installed version is v7.x (not v5 or v6)

```sh
grep -A2 '"node_modules/react-router-dom"' app/frontend/package-lock.json | grep '"version"'
```

Expected: output contains `"7.` (e.g. `"version": "7.17.0"`).

- [x] Pass <!-- 2026-06-13 -->

---

## UAT-STATIC-005 — App.tsx imports createBrowserRouter and RouterProvider from react-router-dom

```sh
grep 'createBrowserRouter.*RouterProvider' app/frontend/src/App.tsx
```

Expected: matches the import line `import { createBrowserRouter, RouterProvider } from 'react-router-dom'`.

- [x] Pass <!-- 2026-06-13 -->

---

## UAT-STATIC-006 — Router is configured with the three expected routes

`App.tsx` must define a `router` constant with `/login`, `/profile`, and `/*` paths.

```sh
grep -E "path: '/(login|profile|\*\*)?" app/frontend/src/App.tsx
```

Expected: three matching lines (one each for `/login`, `/profile`, `/*`).

- [x] Pass <!-- 2026-06-13 -->

---

## UAT-STATIC-007 — RouterProvider is mounted inside AuthProvider in the App component

```sh
grep 'RouterProvider' app/frontend/src/App.tsx
```

Expected: at least one line containing `<RouterProvider router={router}`.

- [x] Pass <!-- 2026-06-13 -->

---

## UAT-STATIC-008 — AuthGuard uses useNavigate from react-router-dom

```sh
grep 'useNavigate' app/frontend/src/components/AuthGuard.tsx
```

Expected: at least one line (the import line `import { useNavigate } from 'react-router-dom'`).

- [x] Pass <!-- 2026-06-13 -->

---

## UAT-STATIC-009 — LoginPage uses useNavigate from react-router-dom

```sh
grep 'useNavigate' app/frontend/src/pages/LoginPage.tsx
```

Expected: at least one line (the import line).

- [x] Pass <!-- 2026-06-13 -->

---

## UAT-STATIC-010 — AuthBadge uses Link and useNavigate from react-router-dom

```sh
grep 'Link.*useNavigate\|useNavigate.*Link' app/frontend/src/components/AuthBadge.tsx
```

Expected: matches the import line `import { Link, useNavigate } from 'react-router-dom'`.

- [x] Pass <!-- 2026-06-13 -->

---

## UAT-STATIC-011 — ProfilePage uses Link from react-router-dom

```sh
grep "from 'react-router-dom'" app/frontend/src/pages/ProfilePage.tsx
```

Expected: at least one line (the import line).

- [x] Pass <!-- 2026-06-13 -->

---

## UAT-STATIC-012 — make typecheck-frontend passes with zero errors

This is the primary acceptance gate per the task. Runs `cd app/frontend && npx tsc --noEmit` which the Makefile wraps as `make typecheck-frontend`.

```sh
make typecheck-frontend
echo "exit: $?"
```

Expected: exit code 0, no TypeScript diagnostics printed to stdout or stderr.

- [x] Pass <!-- 2026-06-13 -->

---

## UAT-STATIC-013 — make typecheck (all packages) passes with zero errors

Full suite — host-server, app/api, and app/frontend — must all pass, confirming the frontend install did not introduce a type error that propagates across packages.

```sh
make typecheck
echo "exit: $?"
```

Expected: exit code 0 across all three `tsc --noEmit` invocations.

- [x] Pass <!-- 2026-06-13 -->

---

## UAT-EDGE-001 — No @types/react-router-dom in devDependencies

Double-check devDependencies specifically (in addition to the whole-file check in UAT-STATIC-002).

```sh
node -e "const p=JSON.parse(require('fs').readFileSync('app/frontend/package.json','utf8')); const dev=p.devDependencies||{}; if('@types/react-router-dom' in dev){process.exit(1)} else {console.log('absent')}"
```

Expected: prints `absent`, exits 0.

- [x] Pass <!-- 2026-06-13 -->

---

## UAT-EDGE-002 — react-router-dom resolves as an ES module entry (not CJS-only)

react-router-dom v7 ships proper ESM exports. Confirm the installed copy's package.json carries an `exports` field (ESM conditional exports).

```sh
node -e "const p=JSON.parse(require('fs').readFileSync('app/frontend/node_modules/react-router-dom/package.json','utf8')); if(!p.exports){process.exit(1)} else {console.log('exports present')}"
```

Expected: prints `exports present`, exits 0.

- [x] Pass <!-- 2026-06-13 -->
