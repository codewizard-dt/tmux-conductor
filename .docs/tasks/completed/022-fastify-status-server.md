# 022 — Fastify Server with GET /status Endpoint

> **Depends on**: [018-strip-container-mode](018-strip-container-mode.md), [019-remove-scaffold-sh](019-remove-scaffold-sh.md), [020-update-conductor-conf](020-update-conductor-conf.md), [021-trash-016-017](021-trash-016-017.md)
> **Blocks**: [023-task-queue-crud-api](023-task-queue-crud-api.md), [024-agent-management-api](024-agent-management-api.md), [025-sse-live-state-stream](025-sse-live-state-stream.md)
> **Parallel-safe with**: [026-scaffold-astro-react](026-scaffold-astro-react.md)

## Objective

Create a Fastify HTTP server at `scripts/dashboard/server/` that exposes `GET /status` returning per-agent state, queue length, and session health. The server runs on plain HTTP (no SSL) on `127.0.0.1:8788` and reads live data from `conductor.conf`, `tasks.txt`, and `logs/state/`.

## Approach

Scaffold a minimal Node.js + Fastify project under `scripts/dashboard/server/`. The `/status` endpoint shells out to `tmux list-windows` to detect running agents and reads state files from `$STATE_DIR` (defaulting to `./logs/state/`). Task queue counts come from reading `tasks.txt` (or the configured `TASK_QUEUE` path). No database — all state is in files already maintained by `monitor.sh`.

Server entry point: `scripts/dashboard/server/index.js`. Start command: `node scripts/dashboard/server/index.js`.

---

## Steps

### 1. Scaffold server project  <!-- agent: general-purpose -->

- [ ] Create `scripts/dashboard/server/` directory
- [ ] Create `scripts/dashboard/server/package.json`:
  ```json
  {
    "name": "tmux-conductor-dashboard-server",
    "version": "1.0.0",
    "type": "module",
    "scripts": {
      "start": "node index.js",
      "dev": "node --watch index.js"
    },
    "dependencies": {
      "fastify": "^4.28.0"
    }
  }
  ```
- [ ] Run `npm install` inside `scripts/dashboard/server/`
- [ ] Add `scripts/dashboard/server/node_modules` to `.gitignore`

### 2. Implement config reader `scripts/dashboard/server/config.js`  <!-- agent: general-purpose -->

- [ ] Export a `readConductorConf(confPath)` function that:
  - Reads `conductor.conf` via `child_process.execSync('bash -c "source <confPath> && declare -px AGENTS BG_PROCESSES SESSION_NAME TASK_QUEUE STATE_DIR"')`
  - Parses `declare -x` output to extract:
    - `SESSION_NAME` (string)
    - `TASK_QUEUE` (string path)
    - `STATE_DIR` (string path)
    - `AGENTS` (array of `name:workdir:launch_cmd` strings)
  - Returns a plain JS object `{ sessionName, taskQueue, stateDir, agents: [{name, workdir, launchCmd}] }`
  - Cache the result for 5 seconds (re-read on stale) to avoid hammering the shell on every request
- [ ] Default `confPath` to `process.env.CONDUCTOR_CONF || path.resolve('../../../conductor.conf')`

### 3. Implement state reader `scripts/dashboard/server/state.js`  <!-- agent: general-purpose -->

- [ ] Export `readAgentState(stateDir, agentName)` → `'idle' | 'busy' | 'unknown'`
  - Reads `<stateDir>/<agentName>.state`, returns trimmed content; `'unknown'` if file missing or unreadable
- [ ] Export `countQueuedTasks(taskQueuePath, agentName)` → `number`
  - Reads `taskQueuePath`, counts non-empty lines (global or scoped to `agentName:`)
  - Returns 0 if file missing
- [ ] Export `isTmuxWindowPresent(sessionName, windowName)` → `boolean`
  - Runs `tmux has-session -t <sessionName>:<windowName>` and returns exit code 0 = true

### 4. Implement `scripts/dashboard/server/index.js`  <!-- agent: general-purpose -->

- [ ] Import Fastify, config reader, state reader
- [ ] Register `GET /status` route handler:
  ```
  Response shape:
  {
    "session": "conductor",
    "sessionAlive": true,
    "agents": [
      {
        "name": "jobfinder",
        "state": "idle",           // "idle" | "busy" | "unknown"
        "windowPresent": true,
        "queuedTasks": 3
      }
    ],
    "timestamp": "2026-06-06T12:00:00.000Z"
  }
  ```
  - Call `readConductorConf()` to get session + agents list
  - Check `isTmuxWindowPresent(sessionName, 'monitor')` for `sessionAlive`
  - For each agent, call `readAgentState` and `countQueuedTasks`
  - Return 200 JSON
- [ ] Register `GET /healthz` → `{ ok: true }`
- [ ] Start server on `process.env.BACKEND_PORT || 8788`, bind to `127.0.0.1`
- [ ] Log `Dashboard server listening on http://127.0.0.1:<port>` on startup

### 5. Verification  <!-- agent: general-purpose -->

- [ ] `node scripts/dashboard/server/index.js` starts without error
- [ ] `curl -s http://127.0.0.1:8788/healthz` returns `{"ok":true}`
- [ ] `curl -s http://127.0.0.1:8788/status` returns valid JSON with `agents` array
- [ ] With no active tmux session, `sessionAlive` is `false` and all `windowPresent` are `false`
- [ ] `node -e "import('./scripts/dashboard/server/index.js')"` exits cleanly after ctrl-C
