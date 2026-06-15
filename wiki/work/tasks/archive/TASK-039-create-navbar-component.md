---
id: TASK-039
title: "Create NavBar component with NavLink items for Agents and Projects"
status: done
created: 2026-06-13
updated: 2026-06-13
depends_on: [TASK-036, TASK-037, TASK-038]
blocks: [TASK-040, TASK-041]
parallel_safe_with: []
uat: "../uat/UAT-039-navbar-component.md"
roadmap: ROADMAP-013
tags: [frontend, nav, react]
---

# TASK-039 — Create NavBar component with NavLink items for Agents and Projects

## Objective

Create a `NavBar` React component that renders two navigation links — **Agents** (`/`) and **Projects** (`/projects`) — using react-router-dom's `NavLink` so that the active route is distinguishable. This component will replace the static `<header>` in `App.tsx` (TASK-040).

## Approach

Use `NavLink` from react-router-dom. `NavLink` automatically receives an `isActive` boolean via its `className` callback, which can be used to apply an active-state style (e.g. `text-ink font-semibold` vs `text-muted`). Match the existing header styles from `App.tsx` (`h-12 items-center border-b border-line bg-canvas/80 px-6 backdrop-blur-sm sticky top-0 z-10`).

## Steps

### 1. Study existing header styles

- [x] Use Serena `find_symbol` (include_body=true) on `App` in `app/frontend/src/App.tsx` to read the exact Tailwind classes on the `<header>` element. <!-- Completed: 2026-06-13 -->

### 2. Create NavBar component

- [x] Create `app/frontend/src/components/NavBar.tsx`: <!-- Completed: 2026-06-13 -->
  ```tsx
  import { NavLink } from 'react-router-dom'

  export default function NavBar() {
    const linkCls = ({ isActive }: { isActive: boolean }) =>
      `text-[13px] font-medium transition ${isActive ? 'text-ink' : 'text-muted hover:text-ink'}`

    return (
      <header className="sticky top-0 z-10 flex h-12 items-center gap-6 border-b border-line bg-canvas/80 px-6 backdrop-blur-sm">
        <span className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-ink">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-green" />
          conductor
        </span>
        <nav className="flex items-center gap-4">
          <NavLink to="/" end className={linkCls}>Agents</NavLink>
          <NavLink to="/projects" className={linkCls}>Projects</NavLink>
        </nav>
      </header>
    )
  }
  ```
- [x] Use `end` prop on the `/` NavLink so it only matches exactly `/` (not `/projects`) <!-- Completed: 2026-06-13 -->

### 3. Verify

- [x] Run `make typecheck` — zero errors <!-- Completed: 2026-06-13 -->
