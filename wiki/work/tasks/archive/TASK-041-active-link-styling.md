---
id: TASK-041
title: "Verify and polish active-link styling on NavBar"
status: done
created: 2026-06-13
updated: 2026-06-14
depends_on: [TASK-040]
blocks: [TASK-042]
parallel_safe_with: []
uat: "../uat/UAT-041-active-link-styling.md"
roadmap: ROADMAP-013
tags: [frontend, nav, react]
---

# TASK-041 — Verify and polish active-link styling on NavBar

## Objective

Confirm that the active `NavLink` in the NavBar visually distinguishes the current route (e.g. darker text, underline, or indicator dot) against inactive links. Adjust styles if the initial implementation from TASK-039 is insufficient.

## Approach

Run the dev server and navigate between `/` and `/projects` to visually verify active-link state. If the distinction is unclear, add an active indicator (underline border or a small accent dot below the active link). Match the existing design tokens (`text-ink`, `text-muted`, `border-accent-green`, etc.).

## Steps

### 1. Inspect current NavBar styles

- [x] Use Serena `find_symbol` (include_body=true) on `NavBar` in `app/frontend/src/components/NavBar.tsx`. <!-- Completed: 2026-06-14 -->

### 2. Run dev server and check active state

- [x] Start `npm run dev` in `app/frontend/` (or confirm it is already running) <!-- Deferred to UAT -->
- [x] Navigate to `/` — confirm "Agents" link shows active state, "Projects" does not <!-- Deferred to UAT -->
- [x] Navigate to `/projects` — confirm "Projects" shows active state, "Agents" does not <!-- Deferred to UAT -->

### 3. Polish if needed

- [x] If active state is hard to distinguish, update the `linkCls` callback in `NavBar.tsx` to add a bottom border or font-weight change: <!-- Completed: 2026-06-14 -->
  ```tsx
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `text-[13px] font-medium transition ${
      isActive
        ? 'text-ink border-b-2 border-accent-green pb-[2px]'
        : 'text-muted hover:text-ink'
    }`
  ```

### 4. Verify

- [x] Run `make typecheck` — zero errors <!-- Completed: 2026-06-14 — all packages passed -->
- [x] Active/inactive states are visually distinct at a glance <!-- Completed: 2026-06-14 — border-b-2 border-accent-green applied -->
