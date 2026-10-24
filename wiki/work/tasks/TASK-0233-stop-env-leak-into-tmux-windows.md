---
id: TASK-0233
aliases: [TASK-0233]
title: "Stop stale .env vars (DATABASE_URL etc.) leaking into every tmux agent window"
status: pending-uat
created: 2026-10-17
updated: 2026-10-17
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-0233]]"
tags: [env, tmux, makefile, host-server, security]
---

# TASK-0233 — Stop stale .env vars (DATABASE_URL etc.) leaking into every tmux agent window

## Objective

Agent windows (and other Claude sessions launched from them) see `DATABASE_URL` pointing at the old DigitalOcean Postgres, breaking their own projects. Remove the leak at its source so conductor-only `.env` keys never reach the tmux server's global environment, and document the allowlist convention.

## Approach

Root cause (verified live with `tmux show-environment -g` and the tmux server process env; nothing in the repo or `~/.zshrc` sets it):

- `Makefile:1-2` does `-include .env` + a bare `export`, so **every** `.env` variable is exported to `make dev`'s children. `.env.example` only needs ports/proxy vars, but the local `.env` still carries leftovers from the reverted App Platform deploy: `DATABASE_URL`, `HOST_SERVER_URL=http://host.docker.internal:8788`, `PUBLIC_API_URL`, `PUBLIC_BASE_URL`.
- host-server (a `make dev` child) spawns `conductor.sh` with `env: { ...process.env, CONDUCTOR_NO_ATTACH: '1' }` (`host-server/index.ts` ~894). The `tmux new-session` in `scripts/conductor.sh:58` creates the tmux server, whose **global environment** then holds those vars, and every new window/pane inherits them.

Fix in two layers: (a) `Makefile` exports an explicit allowlist instead of everything; (b) defence in depth — the env handed to `conductor.sh` is scrubbed, and the scripts unset known-leaky names in the tmux global environment after session creation. Full plan: `/Users/davidtaylor/.claude/plans/this-is-causing-problems-eventual-aho.md`.

**Hard constraint:** never read or write any `.env` file (only `.env.example`). Step 1 is user-run.

## Steps

### 1. Immediate cleanup (user-run, no repo change)  <!-- agent: general-purpose -->

- [PRESENTED-AWAITING-USER] Present these commands to the user and wait for confirmation; do not edit `.env` ourselves
  - `tmux set-environment -g -u DATABASE_URL` (repeat for `HOST_SERVER_URL`, `PUBLIC_API_URL`, `PUBLIC_BASE_URL`)
  - Delete the stale lines from the local `.env`
  - Already-running window shells keep their copy: `unset DATABASE_URL` in them, or restart those agents
  - Rotate the leaked DigitalOcean DB password (the connection string, including its password, was printed during diagnosis)

### 2. Makefile allowlist  <!-- agent: general-purpose -->

- [x] In `Makefile`, keep `-include .env` (line 1) and replace the bare `export` (line 2) with `export BACKEND_PORT FRONTEND_PORT PROXY_TARGET VITE_API_URL FASTIFY_STRUCTURED_LOGS FASTIFY_LOG_LEVEL` — exactly the keys in `.env.example`
  - [x] Confirm `BACKEND_PORT ?=` / `FRONTEND_PORT ?=` defaults (lines 4-5) still behave and that `make ports` / `make dev` / `make start` still see the ports

### 3. Scrub the env handed to conductor.sh  <!-- agent: general-purpose -->

- [x] In `host-server/index.ts` (~line 894, the `spawnSync`/`spawn` of `conductor.sh` with `env: { ...process.env, CONDUCTOR_NO_ATTACH: '1' }`), build the env via a small helper that drops conductor-only/leaky vars (`DATABASE_URL`, `HOST_SERVER_URL`, `PUBLIC_API_URL`, `PUBLIC_BASE_URL`) before spawning; put the helper in a testable module and add a unit test (e.g. `host-server/spawnEnv.test.ts`)
- [x] Inspect the other session-creating sites for the same pattern: `scripts/conductor.sh:58` and `scripts/spawn.sh:49`; after `tmux new-session`, run `tmux set-environment -g -u <name>` for the same known-leaky names (shared list, keep the two scripts in sync)
- [x] Check any other host-server `tmux new-session` / `new-window` spawn sites pass a scrubbed env

### 4. Docs  <!-- agent: general-purpose -->

- [x] `.env.example`: one comment noting that `make` exports only the listed keys; extra `.env` keys are ignored
- [x] `CLAUDE.md` Config bullet (Code layout): same one-line note
<!-- Updated: 2026-10-17 -->

### 5. Verify  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] With a stale `DATABASE_URL` still present in the local `.env` (user-confirmed), start a *fresh* tmux server via `make dev`, then `tmux show-environment -g | grep -E 'DATABASE_URL|HOST_SERVER_URL|PUBLIC_'` returns nothing (use `./tmp/` for any scratch files; never read `.env`; sourcing it on the command line is allowed)
- [DEFERRED-TO-UAT] Open a new agent window: `env | grep DATABASE_URL` is empty; `BACKEND_PORT`/`PROXY_TARGET` still reach host-server and the dashboard loads (`make ports`)
- [x] `npm run typecheck --workspace host-server` and the new spawn-env test plus `host-server/state.test.ts` pass
