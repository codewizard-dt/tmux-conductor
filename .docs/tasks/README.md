# Tasks

**Last task:** [043-frontend-tsconfig-strict](043-frontend-tsconfig-strict.md)
**Next task number:** 044

## Active Tasks

| # | Task | Description |
|---|------|-------------|
| 008 | [Publish Base Image](active/008-publish-base-image.md) | Build + publish multi-arch `ghcr.io/codewizard-dt/tmux-conductor-base` with Chromium + Claude Code + uv preinstalled; update scaffold.sh to consume it (cuts per-project first-build from ~4min to ~15s) |
| 035 | [Move server to backend](035-move-server-to-backend.md) | Move `scripts/dashboard/server/` → `backend/` at repo root and update all references (Makefile, docker-compose files, CLAUDE.md, README.md, scripts/README.md) |
| 037 | [Create root .env](037-create-root-env.md) | Create root `.env` and `.env.example` consolidating PORT, UI_PORT, CORS_ORIGIN, PUBLIC_API_URL |
| 038 | [Backend load root env](038-backend-load-root-env.md) | Fix dotenv loading in `backend/index.js` to read from repo root; add dotenv to package.json deps |
| 039 | [Frontend root env](039-frontend-root-env.md) | Configure Astro/Vite `envDir` to read `.env` from repo root instead of `frontend/` |
| 040 | [Backend convert to TypeScript](040-backend-convert-to-typescript.md) | Rename index.js, config.js, state.js to .ts and add TypeScript type annotations throughout |
| 041 | [Backend tsconfig](041-backend-tsconfig.md) | Add `backend/tsconfig.json` with NodeNext/NodeNext module resolution and full strict flags |
| 042 | [Backend ESLint](042-backend-eslint.md) | Add `backend/eslint.config.mjs` with `strictTypeChecked` preset |
| 043 | [Frontend tsconfig strict](043-frontend-tsconfig-strict.md) | Layer additional strict flags onto `frontend/tsconfig.json` extending the Astro strict base |

## Completed Tasks

| # | Task | Description |
|---|------|-------------|
| 001 | [Initial Scaffolding](completed/001-initial-scaffolding.md) | Extract all conductor scripts from CONDUCTOR.md, create host-side container exec wrapper, and scaffold.sh for dev container setup |
| 002 | [Scoped Task Queue](completed/002-scoped-task-queue.md) | Add agent-name prefix scoping to task queue so tasks dispatch only to the matching agent |
| 003 | [Container Config Sharing](completed/003-container-config-sharing.md) | Share host Claude config + global MCPs into each conductor container via first-boot init-copy; auto-register Serena MCP |
| 004 | [Idle Detection Fix](completed/004-idle-detection-fix.md) | Replace `capture-pane` idle regex with Claude Code hooks-based state file; keep regex as fallback |
| 005 | [Host Network Access](completed/005-host-network-access.md) | Add `host.docker.internal:host-gateway` to scaffolded compose so dev containers can reach host dev servers; document `0.0.0.0` bind requirement |
| 006 | [Chromium in Dev Container](completed/006-chromium-in-dev-container.md) | Install native arm64/amd64 Chromium in scaffolded Dockerfile via xtradeb PPA + point Puppeteer at `/usr/bin/chromium` — superseded by task 008 base image (UAT skipped) |
| 009 | [Hook Model Alignment](completed/009-hook-model-alignment.md) | Collapse agent-state vocabulary to `idle`/`busy`; add `SessionStart` hook (startup/resume/clear), remove `Notification` hook, rename state values across hooks + `monitor.sh` |
| 010 | [Hooks Global Install](completed/010-hooks-global-install.md) | Refactor install-hooks.sh to copy hooks into ~/.claude/hooks/tmux-conductor/ and merge-register into settings.json with dedup (preserves foreign hook entries); container scaffolding unchanged (UAT skipped) |
| 011 | [Refactor Hooks to Node.js](completed/011-hooks-to-js.md) | Port the four per-event hooks from Bash to Node.js (stdlib only, shared `hooks/lib/write-state.js`), move `install-hooks.sh` to repo root, archive old `.sh` hooks under `hooks/.bash-backup/` (UAT skipped) |
| 012 | [Verbose Dispatch State Logging](completed/012-verbose-dispatch-logging.md) | Enrich monitor log lines with detection method + state age + queue context; emit structured `dispatch.jsonl` per dispatch and `hooks.jsonl` per hook transition so agent state at send-time is fully auditable |
| 013 | [Scripts Folder + add-task](completed/013-scripts-folder-and-add-task.md) | Move 8 orchestration scripts to scripts/, update all references, add add-task.sh utility |
| 014 | [Scripts README + Flowchart](completed/014-scripts-readme-flowchart.md) | scripts/README.md documenting each of the nine scripts, with a combined mermaid flowchart of script relationships and task lifecycle |
| 025 | [SSE Live State Stream](completed/025-sse-live-state-stream.md) | GET /events SSE stream pushing per-agent state changes to UI |
| 027 | [Agent Accordion List](completed/027-agent-accordion-list.md) | React accordion component showing all agents with live state, queued tasks, and status color coding |
| 018 | [Strip Container Mode](completed/018-strip-container-mode.md) | Remove all Docker/container wiring from conductor.sh and spawn.sh |
| 019 | [Remove scaffold.sh](completed/019-remove-scaffold-sh.md) | Archive devcontainer scaffolding script no longer needed |
| 020 | [Update conductor.conf](completed/020-update-conductor-conf.md) | Update config for local-agent model |
| 021 | [Trash Tasks 016 and 017](completed/021-trash-016-017.md) | Superseded tasks trashed |
| 022 | [Fastify Status Server](completed/022-fastify-status-server.md) | Dashboard backend with GET /status endpoint |
| 023 | [Task Queue CRUD API](completed/023-task-queue-crud-api.md) | POST/PUT/DELETE /queue/:agent endpoints |
| 024 | [Agent Management API](completed/024-agent-management-api.md) | POST /agents endpoint to spawn new agent windows |
| 026 | [Scaffold Astro + React](completed/026-scaffold-astro-react.md) | Bootstrap Astro+React project under scripts/dashboard/ui/ |
| 028 | [Add-task Form + Drag-to-Reorder](completed/028-add-task-drag-reorder.md) | Inline task-add input and drag-handle reorder inside each agent accordion |
| 029 | [Add-agent Form](completed/029-add-agent-form.md) | Form at page top to spawn new agent window |
| 030 | [Error State Detection + Red Highlight](completed/030-error-state-red-highlight.md) | Detect agent error state and surface red highlight |
| 031 | [Empty-queue Amber Highlight](completed/031-empty-queue-amber-highlight.md) | Show amber accordion header when agent has no pending tasks |
| 032 | [Awaiting-input Flash Icon](completed/032-awaiting-input-flash-icon.md) | Flashing ! icon when agent is awaiting user input |
| 033 | [Wire Dashboard into conductor.sh + teardown.sh](completed/033-wire-dashboard-conductor.md) | Spawn dashboard window on session start and C-c on teardown |
| 034 | [Docs Update: Local-agent Model](completed/034-docs-update-local-agent-model.md) | Update CLAUDE.md, root README, scripts/README.md |
