---
id: TASK-040
title: "Replace the static header in App.tsx with the NavBar component"
status: done
created: 2026-06-13
updated: 2026-06-13
depends_on: [TASK-039]
blocks: [TASK-041]
parallel_safe_with: []
uat: "../uat/UAT-040-replace-header-with-navbar.md"
roadmap: ROADMAP-013
tags: [frontend, nav, react]
---

# TASK-040 — Replace the static header in App.tsx with the NavBar component

## Objective

Swap the inline `<header>` element in `App.tsx` for the `<NavBar>` component created in TASK-039. After this change, the nav bar renders on every page via the layout shell.

## Approach

Edit `App.tsx`: remove the `<header>...</header>` JSX block, import `NavBar`, and render `<NavBar />` in its place.

## Steps

### 1. Read App.tsx

- [x] Use Serena `find_symbol` (include_body=true) on `App` in `app/frontend/src/App.tsx`.

### 2. Swap the header

- [x] Import `NavBar` from `./components/NavBar`
- [x] Replace the `<header>...</header>` block with `<NavBar />`
- [x] Remove the now-unused import of any header-specific components (`AuthBadge` removed)

### 3. Verify

- [x] Run `make typecheck` — zero errors
- [x] Confirm both "Agents" and "Projects" links appear in the header on every route
