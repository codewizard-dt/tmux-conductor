---
id: UAT-0233
aliases: [UAT-0233]
title: "UAT: Stop stale .env vars (DATABASE_URL etc.) leaking into every tmux agent window"
status: pending
task: TASK-0233
created: 2026-10-17
updated: 2026-10-17
---

# UAT-0233 — UAT: Stop stale .env vars (DATABASE_URL etc.) leaking into every tmux agent window

implements::[[TASK-0233]]

> **Source task**: [[TASK-0233]]
> **Generated**: 2026-10-17

---

## Prerequisites

- [x] Repo at `/Users/davidtaylor/Repositories/tmux-conductor`, working tree includes TASK-0233's changes (`Makefile`, `host-server/spawnEnv.ts`, `host-server/index.ts`, `scripts/lib/db.sh`, `scripts/conductor.sh`, `scripts/spawn.sh`, `.env.example`, `CLAUDE.md`)
- [x] `tmux` installed (any test using `tmux -L uat-0233-test ...` uses an isolated scratch socket/server — never the real `conductor` session)
- [x] All commands run from the repo root

---

## Test Cases

### UAT-GATE-001: host-server and frontend typecheck clean
- **Scenario**: TASK-0233 touched `host-server/index.ts`, `host-server/spawnEnv.ts` — confirm no type regressions.
- **Steps**: run the typecheck target
- **Command**:
  ```bash
  make typecheck
  ```
- **Expected Result**: both `host-server` and `ui` workspaces exit 0 with no TypeScript errors
- **Repeatable Unit Test**: Not applicable: typecheck is already the repeatable gate itself
- [x] Pass — already run during `/tackle`; `make typecheck` exited 0 for both workspaces (2026-10-17)

### UAT-UNIT-001: scrubLeakyEnv strips exactly the known-leaky keys from a spawn env
- **Scenario**: `host-server/spawnEnv.ts`'s `scrubLeakyEnv()` is the function `index.ts`'s `POST /session/start` handler uses to build the env handed to `conductor.sh`. It must drop `DATABASE_URL`, `HOST_SERVER_URL`, `PUBLIC_API_URL`, `PUBLIC_BASE_URL` and leave everything else untouched, without mutating its input.
- **Steps**: run the existing unit test suite for `scrubLeakyEnv`
- **Command**:
  ```bash
  cd host-server && npx tsx --test spawnEnv.test.ts
  ```
- **Expected Result**: 4/4 tests pass — leaky keys stripped; non-leaky keys (`BACKEND_PORT`, `PROXY_TARGET`, `PATH`, `FRONTEND_PORT`) pass through unchanged; input env object not mutated; a mixed env keeps only the non-leaky keys
- **Repeatable Unit Test**: Created: `host-server/spawnEnv.test.ts` (written during `/tackle` step 3)
- **Unit Test Command**: `cd host-server && npx tsx --test spawnEnv.test.ts`
- [x] Pass — ran 2026-10-17, 4/4 pass

### UAT-EDGE-001: the committed Makefile exports exactly the allowlisted keys
- **Scenario**: `Makefile` line 2 must read exactly the explicit allowlist, not the old bare `export`.
- **Steps**: print line 2 of the real `Makefile`
- **Command**:
  ```bash
  sed -n '2p' Makefile
  ```
- **Expected Result**: `export BACKEND_PORT FRONTEND_PORT PROXY_TARGET VITE_API_URL FASTIFY_STRUCTURED_LOGS FASTIFY_LOG_LEVEL`
- **Repeatable Unit Test**: Not applicable: Makefile content, no test runner covers Makefiles in this repo
- [x] Pass — ran 2026-10-17, output matched exactly

### UAT-EDGE-002: a Makefile variable set only via `-include <env-file>` is not exported to recipe children unless allowlisted
- **Scenario**: Behavioral proof of the actual bug/fix mechanism — a key present only in an included env-style file (standing in for `.env`, never touching the real `.env`) must NOT reach a recipe's child-process environment now that the bare `export` is gone, replicating the exact two-line shape of the real `Makefile`.
- **Steps**: build an isolated scratch copy (never the real `Makefile`/`.env`) with the same two lines, include a stub env-style file defining `DATABASE_URL`, and confirm a recipe's environment does not contain it
- **Command**:
  ```bash
  mkdir -p ./tmp/uat-0233-makefile
  cat > ./tmp/uat-0233-makefile/stub.env <<'EOF'
  DATABASE_URL = uat-leak-marker
  EOF
  cat > ./tmp/uat-0233-makefile/Makefile <<'EOF'
  -include stub.env
  export BACKEND_PORT FRONTEND_PORT PROXY_TARGET VITE_API_URL FASTIFY_STRUCTURED_LOGS FASTIFY_LOG_LEVEL

  BACKEND_PORT ?= 8788
  FRONTEND_PORT ?= 4321

  diag:
  	@env | grep -c "^DATABASE_URL=" || true
  EOF
  make -C ./tmp/uat-0233-makefile diag
  rm -rf ./tmp/uat-0233-makefile
  ```
- **Expected Result**: `0` (the recipe's environment contains zero `DATABASE_URL=` lines)
- **Repeatable Unit Test**: Not applicable: exercises GNU Make's own export semantics via a scratch Makefile, not project source; no project test runner covers Make behavior
- [x] Pass — ran 2026-10-17, output `0`

### UAT-EDGE-003: host-server's conductor.sh spawn site is wired to scrub the env, not just the helper in isolation
- **Scenario**: It's not enough for `scrubLeakyEnv` to exist and pass its own unit tests — the `POST /session/start` handler must actually call it when building the env for the `conductor.sh` spawn.
- **Steps**: confirm the import and the call site both exist in `host-server/index.ts`
- **Command**:
  ```bash
  grep -n "scrubLeakyEnv" host-server/index.ts
  ```
- **Expected Result**: two matches — one `import { scrubLeakyEnv } from './spawnEnv.ts';` line, and one `env: { ...scrubLeakyEnv(process.env), CONDUCTOR_NO_ATTACH: '1' },` line inside the `conductorScript` `spawnSync` call in the `/session/start` route
- **Repeatable Unit Test**: Not applicable: wiring/import-site check, not a behavior a unit test isolates from the real spawnSync call without starting a real tmux session
- [x] Pass — ran 2026-10-17, both lines present (`host-server/index.ts:14` and `:899`)

### UAT-EDGE-004: scripts/conductor.sh and scripts/spawn.sh unset the same leaky names right after tmux new-session, kept in sync with spawnEnv.ts
- **Scenario**: Defense-in-depth layer two — both tmux-session-creating scripts must call `unset_leaky_tmux_env` immediately after their `tmux new-session`, and the leaky-name list in `scripts/lib/db.sh` must be identical to `LEAKY_ENV_VARS` in `host-server/spawnEnv.ts`.
- **Steps**: confirm both call sites and both lists
- **Command**:
  ```bash
  grep -n -B1 "unset_leaky_tmux_env$" scripts/conductor.sh scripts/spawn.sh
  grep -n "LEAKY_TMUX_ENV_VARS=" scripts/lib/db.sh
  ```
- **Expected Result**: `conductor.sh` and `spawn.sh` each show `tmux new-session ...` on the line immediately before their `unset_leaky_tmux_env` call; `scripts/lib/db.sh` defines `LEAKY_TMUX_ENV_VARS=(DATABASE_URL HOST_SERVER_URL PUBLIC_API_URL PUBLIC_BASE_URL)` — the same four names, same order, as `host-server/spawnEnv.ts`'s `LEAKY_ENV_VARS`
- **Repeatable Unit Test**: Not applicable: cross-file shell/TS list-parity check, no shared test harness spans both languages in this repo
- [x] Pass — ran 2026-10-17: `conductor.sh:59-60` (`tmux new-session` then `unset_leaky_tmux_env`), `spawn.sh:50` then `:54`; both lists match exactly

### UAT-EDGE-005: unset_leaky_tmux_env actually removes the leaky names from a tmux server's global environment
- **Scenario**: The function itself must work, not just be called in the right place — proven against a fully isolated scratch tmux server so the real `conductor` session is never touched.
- **Steps**: start a private-socket tmux server, seed its global environment with a leaky and a non-leaky var, source `scripts/lib/db.sh` and call `unset_leaky_tmux_env` against that socket, then inspect the global environment
- **Command**:
  ```bash
  tmux -L uat-0233-test kill-server 2>/dev/null
  tmux -L uat-0233-test new-session -d -s scratch
  tmux -L uat-0233-test set-environment -g DATABASE_URL uat-leak-marker
  tmux -L uat-0233-test set-environment -g BACKEND_PORT 8788
  bash -c 'source scripts/lib/db.sh >/dev/null 2>&1; tmux() { command tmux -L uat-0233-test "$@"; }; unset_leaky_tmux_env'
  tmux -L uat-0233-test show-environment -g | grep -E "^(DATABASE_URL=|BACKEND_PORT=)"
  tmux -L uat-0233-test kill-server
  ```
- **Expected Result**: the filtered output shows only `BACKEND_PORT=8788` — no `DATABASE_URL=` line
- **Repeatable Unit Test**: Not applicable: requires a real tmux server process; no host-server/JS equivalent exists for this pure-bash function
- [x] Pass — ran 2026-10-17 against the isolated `uat-0233-test` socket (never the real `conductor` session): `DATABASE_URL` absent, `BACKEND_PORT=8788` present

### UAT-DOC-001: .env.example documents the allowlist convention
- **Scenario**: a developer adding a new key to their local `.env` should learn from `.env.example` that it won't reach `make dev`'s children unless also added to the Makefile's `export` line.
- **Steps**: confirm the comment is present
- **Command**:
  ```bash
  grep -c "only exports" .env.example
  ```
- **Expected Result**: `1`
- **Repeatable Unit Test**: Not applicable: doc comment check
- [x] Pass — ran 2026-10-17, output `1`

### UAT-DOC-002: CLAUDE.md documents the allowlist convention
- **Scenario**: same convention documented in the Code layout → Config bullet for anyone reading the project overview instead of `.env.example`.
- **Steps**: confirm the note is present in the Config bullet
- **Command**:
  ```bash
  grep -c "exports the listed keys" CLAUDE.md
  ```
- **Expected Result**: `1`
- **Repeatable Unit Test**: Not applicable: doc comment check
- [x] Pass — ran 2026-10-17, output `1`

### UAT-MANUAL-001: a fresh real conductor tmux server does not carry DATABASE_URL/HOST_SERVER_URL/PUBLIC_* in its global environment
- **Scenario**: the task's own end-to-end acceptance bar — with a stale `DATABASE_URL` still present in the user's real local `.env`, starting the real conductor session (via `make dev` → host-server → `POST /session/start` → `scripts/conductor.sh`) must not leak it into the tmux server's global environment.
- **Why manual, not auto-run**: this starts a real tmux server and spawns real agent windows/processes in the user's actual environment — an irreversible, disruptive side effect that `/uat-auto` must not trigger unattended.
- **Steps**:
  1. Confirm a stale `DATABASE_URL` (or similar) is still present in the real local `.env` (user-confirmed, never read by this agent)
  2. From the repo root, run `make dev` (or trigger `POST /session/start` against the host-server) to start a fresh conductor tmux session
  3. In a separate terminal: `tmux show-environment -g | grep -E 'DATABASE_URL|HOST_SERVER_URL|PUBLIC_API_URL|PUBLIC_BASE_URL'`
- **Expected Result**: no output (grep matches nothing)
- **Repeatable Unit Test**: Not applicable: requires the user's real `.env` state and a real tmux server/agent spawn
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-10-17 -->

### UAT-MANUAL-002: a new agent window does not inherit the leaky vars, and ports still resolve correctly
- **Scenario**: confirms the fix doesn't just hide the leak from `show-environment -g` but that an actual agent pane's shell environment is clean, while the ports the dashboard needs still work.
- **Why manual, not auto-run**: requires a live agent window in the real conductor session.
- **Steps**:
  1. With the conductor session from UAT-MANUAL-001 running, open a new agent window (or inspect an existing freshly-spawned one)
  2. In that window's shell, run `env | grep DATABASE_URL`
  3. Run `make ports` and confirm the dashboard at the printed frontend URL loads normally
- **Expected Result**: `env | grep DATABASE_URL` prints nothing; `make ports` prints the expected `BACKEND_PORT`/`FRONTEND_PORT` URLs and the dashboard loads
- **Repeatable Unit Test**: Not applicable: requires a live tmux agent window
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-10-17 -->
