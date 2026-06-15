---
id: TASK-036
title: "Install react-router-dom in the Vite React frontend"
status: done
created: 2026-06-13
updated: 2026-06-13
depends_on: []
blocks: [TASK-037, TASK-038]
parallel_safe_with: []
uat: "../uat/UAT-036-install-react-router-dom.md"
roadmap: ROADMAP-013
tags: [frontend, routing, dependencies]
---

# TASK-036 — Install react-router-dom in the Vite React frontend

## Objective

Add `react-router-dom` (v6) to `app/frontend/` so subsequent tasks can wire client-side routing for the Agents page (`/`), Projects page (`/projects`), and Project Details page (`/projects/:id`). react-router-dom v6 ships its own TypeScript declarations — no separate `@types/` package is needed.

## Approach

Run `npm install react-router-dom` inside `app/frontend/`. Confirm the version installed is v6.x. Run `make typecheck` to verify the install doesn't break TypeScript compilation.

## Steps

### 1. Install the package

- [x] Run `npm install react-router-dom` in `app/frontend/` <!-- Completed: 2026-06-13 -->
- [x] Read `app/frontend/package.json` and confirm `react-router-dom` appears in `dependencies` — found ^7.17.0 (v7, types bundled) <!-- Completed: 2026-06-13 -->
- [x] Confirm no `@types/react-router-dom` entry was added (v6/v7 types are bundled) <!-- Completed: 2026-06-13 -->

### 2. Verify TypeScript compilation

- [x] Run `make typecheck` from the repo root — passed with zero errors (fixed pre-existing TS2532 in app/frontend/src/lib/auth.ts) <!-- Completed: 2026-06-13 -->
