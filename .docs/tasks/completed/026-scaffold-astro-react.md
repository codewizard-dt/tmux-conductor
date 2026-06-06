# 026 — Scaffold Astro + React Project under scripts/dashboard/ui/

> **Depends on**: none
> **Blocks**: [027-agent-accordion-list](027-agent-accordion-list.md), [028-add-task-drag-reorder](028-add-task-drag-reorder.md), [029-add-agent-form](029-add-agent-form.md)
> **Parallel-safe with**: [018-strip-container-mode](018-strip-container-mode.md), [019-remove-scaffold-sh](019-remove-scaffold-sh.md), [020-update-conductor-conf](020-update-conductor-conf.md), [021-trash-016-017](021-trash-016-017.md), [022-fastify-status-server](022-fastify-status-server.md)

## Objective

Bootstrap an Astro + React project at `scripts/dashboard/ui/` that will become the single-page dashboard. The scaffold should produce a working dev server and a production build, with React integration wired up.

## Approach

Use `npm create astro@latest` with `--template minimal` and then add `@astrojs/react` via `astro add react`. Configure the integration in `astro.config.mjs`. The final project should have a single `src/pages/index.astro` page that renders a placeholder React component, confirming the React integration works.

Backend URL is configured via an env var `PUBLIC_API_URL` (defaults to `http://127.0.0.1:8788`).

---

## Steps

### 1. Scaffold the project  <!-- agent: general-purpose -->

- [ ] Create `scripts/dashboard/ui/` if it doesn't exist
- [ ] From `scripts/dashboard/ui/`, run:
  ```bash
  npm create astro@latest . -- --template minimal --no-install --no-git
  ```
  (The `.` target creates in-place; `--no-git` avoids nested git init)
- [ ] Run `npm install` in `scripts/dashboard/ui/`
- [ ] Add `@astrojs/react` and React packages:
  ```bash
  npm install @astrojs/react react react-dom
  npm install --save-dev @types/react @types/react-dom
  ```
- [ ] Add `scripts/dashboard/ui/node_modules` to root `.gitignore`

### 2. Configure Astro  <!-- agent: general-purpose -->

- [ ] Edit `scripts/dashboard/ui/astro.config.mjs` to add the React integration:
  ```js
  import { defineConfig } from 'astro/config'
  import react from '@astrojs/react'

  export default defineConfig({
    integrations: [react()],
    server: { port: 4321 },
  })
  ```
- [ ] Create `scripts/dashboard/ui/.env` (gitignored) with:
  ```
  PUBLIC_API_URL=http://127.0.0.1:8788
  ```
- [ ] Add `scripts/dashboard/ui/.env` to `.gitignore`
- [ ] Create `scripts/dashboard/ui/.env.example` committed to repo:
  ```
  PUBLIC_API_URL=http://127.0.0.1:8788
  ```

### 3. Add placeholder index page  <!-- agent: general-purpose -->

- [ ] Replace `scripts/dashboard/ui/src/pages/index.astro` with:
  ```astro
  ---
  import Placeholder from '../components/Placeholder.tsx'
  ---
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width" />
      <title>tmux Conductor Dashboard</title>
    </head>
    <body>
      <Placeholder client:load />
    </body>
  </html>
  ```
- [ ] Create `scripts/dashboard/ui/src/components/Placeholder.tsx`:
  ```tsx
  export default function Placeholder() {
    return (
      <div>
        <h1>tmux Conductor Dashboard</h1>
        <p>Dashboard coming soon.</p>
      </div>
    )
  }
  ```

### 4. Verification  <!-- agent: general-purpose -->

- [ ] `npm run dev` (in `scripts/dashboard/ui/`) starts without error on port 4321
- [ ] `curl -s http://localhost:4321/` returns HTML containing "tmux Conductor Dashboard"
- [ ] `npm run build` in `scripts/dashboard/ui/` completes without error
- [ ] `dist/` directory is created with static output
- [ ] Add `scripts/dashboard/ui/dist` to `.gitignore`

---
**UAT**: [`.docs/uat/026-scaffold-astro-react.uat.md`](../uat/026-scaffold-astro-react.uat.md)
