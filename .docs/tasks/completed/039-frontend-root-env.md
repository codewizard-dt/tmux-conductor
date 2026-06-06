# 039 — Update frontend to read `.env` from repo root

> **Depends on**: [036-move-ui-to-frontend](036-move-ui-to-frontend.md), [037-create-root-env](037-create-root-env.md)
> **Blocks**: none
> **Parallel-safe with**: [038-backend-load-root-env](038-backend-load-root-env.md)

## Objective

Configure Astro/Vite in `frontend/` to read environment variables from the repo root `.env` instead of `frontend/.env`, so `PUBLIC_API_URL` and other shared vars are sourced from one place.

## Approach

Astro uses Vite under the hood. Vite's `envDir` config option sets where it looks for `.env` files — by default it is the project root (i.e. `frontend/`). Setting `envDir` to `'..'` (one level up, the repo root) makes Vite load from the repo root `.env`. This is done in `frontend/astro.config.mjs`.

---

## Steps

### 1. Update `frontend/astro.config.mjs`  <!-- agent: general-purpose -->

File: `frontend/astro.config.mjs`

Current content:
```js
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'

export default defineConfig({
  integrations: [react()],
  server: { port: 4321 },
  vite: {
    server: {
      proxy: {
        '/api': 'http://localhost:8788',
      },
    },
  },
})
```

- [x] Add `envDir: '..'` to the top-level `defineConfig` object (Vite option passed through Astro):
  ```js
  export default defineConfig({
    integrations: [react()],
    server: { port: 4321 },
    vite: {
      envDir: '..',
      server: {
        proxy: {
          '/api': 'http://localhost:8788',
        },
      },
    },
  })
  ```

### 2. Verify `PUBLIC_API_URL` is accessible  <!-- agent: general-purpose -->

- [x] Confirm root `.env` contains `PUBLIC_API_URL=http://localhost:8788/api`
- [x] Search `frontend/src/` for any hardcoded `localhost:8788` references — if found, replace with `import.meta.env.PUBLIC_API_URL`
- [x] Confirm no `frontend/.env` file exists (removed in task 037)

### 3. Update `frontend/astro.config.mjs` port from env  <!-- agent: general-purpose -->

The `server.port` is currently hardcoded to `4321`. Optionally read from env:

- [x] If `FRONTEND_PORT` is available via `process.env.FRONTEND_PORT` in the config file, update:
  ```js
  server: { port: parseInt(process.env.FRONTEND_PORT || '4321', 10) },
  ```
  Note: `astro.config.mjs` runs in a Node.js context, so `process.env` is available even before Vite loads `.env`. This uses the env var if the shell has exported it (e.g. via `make`), otherwise falls back to `4321`.

### 4. Verification  <!-- agent: general-purpose -->

- [x] `frontend/astro.config.mjs` contains `envDir: '..'` inside the `vite` block
- [x] `cd frontend && npm run build` completes without env-related errors (if build is feasible in the dev environment)
- [x] No `frontend/.env` file exists

---
**UAT**: [`.docs/uat/039-frontend-root-env.uat.md`](../uat/039-frontend-root-env.uat.md)
