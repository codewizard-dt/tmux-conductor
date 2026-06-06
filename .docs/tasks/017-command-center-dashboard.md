# 017 — Command Center Dashboard

## Objective

Add a small web dashboard (Fastify + React) that surfaces per-agent status, provides per-agent run/stop/restart buttons, and tails conductor log streams — runnable as a tmux window inside the conductor session.

## Approach

Node 20 Fastify server under `scripts/dashboard/` exposes `/status`, per-agent action POSTs, and Server-Sent Events (SSE) for log streams + live `tmux capture-pane` output. Interactive OpenAPI docs are generated via `@fastify/swagger` + `@fastify/swagger-ui` at `/docs`. A Vite + React + TypeScript UI is built to `ui/dist/` and served statically by the same Fastify process on a single port (default `127.0.0.1:8787`). The dashboard window is spawned from `conductor.sh` / `spawn.sh` using its own config block (separate from `BG_PROCESSES`) so it torn down with the session.

## Prerequisites

- [ ] Task 015 (BG_PROCESSES) completed — spawn patterns reused for the dashboard window
- [ ] Node.js >= 20 available on the host (already required by hook scripts)
- [ ] `npm` available on the host for installing dashboard deps
- [ ] tmux session variables (`SESSION_NAME`, `STATE_DIR`, `LOG_DIR`, `TASK_QUEUE`, `CLEAR_CMD`, `AGENTS`) readable from `conductor.conf`

---

## Steps

### 1. Config + directory scaffold  <!-- agent: general-purpose -->

- [ ] Create directory `scripts/dashboard/` with subdirs `scripts/dashboard/src/` (server code) and `scripts/dashboard/ui/` (React app placeholder, populated in step 4)
- [ ] Add a `.gitignore` in `scripts/dashboard/` that ignores `node_modules/`, `ui/node_modules/`, `ui/dist/`
- [ ] Append a `# --- Dashboard ---` block to `conductor.conf` (after the `# --- Logging ---` section, before `# --- Agent state directory ---`) with these keys and comments:
  - `DASHBOARD_ENABLED=1` — set to `0` to skip spawning the dashboard window
  - `DASHBOARD_PORT=8787` — port the Fastify server listens on
  - `DASHBOARD_BIND="127.0.0.1"` — interface to bind; change to `0.0.0.0` for LAN/Tailscale access
  - `DASHBOARD_CMD="node scripts/dashboard/src/server.js"` — launch command, relative to repo root
- [ ] Verify `conductor.conf` is still syntactically valid by sourcing it in a bash subshell: `bash -c 'set -u; source ./conductor.conf; echo "$DASHBOARD_PORT"'`

### 2. Fastify server + Swagger  <!-- agent: general-purpose -->

- [ ] Create `scripts/dashboard/package.json` with:
  - `"name": "tmux-conductor-dashboard"`
  - `"private": true`
  - `"type": "module"`
  - `"engines": { "node": ">=20" }`
  - `"scripts": { "start": "node src/server.js", "build": "cd ui && npm install && npm run build" }`
  - dependencies: `"fastify": "^5.0.0"`, `"@fastify/static": "^8.0.0"`, `"@fastify/swagger": "^9.0.0"`, `"@fastify/swagger-ui": "^5.0.0"`
- [ ] Run `cd scripts/dashboard && npm install` once and commit the resulting `package-lock.json`
- [ ] Create `scripts/dashboard/src/config.js` that loads conductor.conf values by shelling out to bash (spawn `bash -c 'source ../../conductor.conf && declare -p AGENTS BG_PROCESSES SESSION_NAME STATE_DIR LOG_DIR TASK_QUEUE CLEAR_CMD DASHBOARD_PORT DASHBOARD_BIND 2>/dev/null'`) and parsing the `declare -a` / `declare --` output into a JS object. Export `loadConfig()` returning `{ sessionName, stateDir, logDir, taskQueue, clearCmd, port, bind, agents: [{name, workdir, launchCmd}] }`
  - Parse `AGENTS` by splitting each entry on `:` into at most 3 fields (name, workdir, launchCmd) so the launch command may itself contain colons
- [ ] Create `scripts/dashboard/src/tmux.js` exporting these helpers, each shelling out via `node:child_process` `execFile` with tmux args as an array (never string-concat into a shell):
  - `hasSession(sessionName)` → boolean
  - `capturePane(target, lines = 200)` → string (runs `tmux capture-pane -t <target> -p` then keeps the last N non-blank lines)
  - `sendKeys(target, literal)` → void (runs `tmux send-keys -t <target> -l <literal>` then a second `tmux send-keys -t <target> Enter`)
  - `sendSignal(target, key)` → void (e.g. `C-c`, runs `tmux send-keys -t <target> <key>`)
  - All functions reject/throw on non-zero tmux exit
- [ ] Create `scripts/dashboard/src/state.js` with:
  - `readAgentState(stateDir, name)` → `{ value: 'idle'|'busy'|'unknown', ageSeconds: number | null }` (read `<stateDir>/<name>.state`, compute age from mtime; missing file → `{value: 'unknown', ageSeconds: null}`)
  - `writeAgentState(stateDir, name, value)` → void (atomic write: write to `<name>.state.tmp` then rename)
- [ ] Create `scripts/dashboard/src/queue.js` with:
  - `readQueue(path)` → `string[]` (lines, empty if file missing)
  - `prependScoped(path, agentName, command)` → void (atomic: read existing, prepend `<agent>: <command>\n`, write via temp file + rename)
- [ ] Create `scripts/dashboard/src/dispatchLog.js` with:
  - `lastDispatchFor(logDir, agentName)` → `{ ts, command, queue, ... } | null` (reverse-scan `<logDir>/dispatch.jsonl` for the most recent record where `agent === agentName` and `command` is non-empty)
  - `tailJsonl(path, onRecord, { fromStart = false })` → returns an unsubscribe function. Uses `fs.watch` + last-read offset to emit each new JSON line as a parsed object. On file rotation (inode change), reopen from start.
- [ ] Create `scripts/dashboard/src/server.js` as the entry point. Structure:
  - `import Fastify from 'fastify'`, register `@fastify/swagger` (OpenAPI 3.1 spec metadata: title "tmux-conductor dashboard", version "0.1.0") and `@fastify/swagger-ui` mounted at `/docs`
  - Register `@fastify/static` with `root = path.join(__dirname, '..', 'ui', 'dist')`, prefix `/`
  - Define routes below with JSON schemas attached (so `/docs` renders them):
    - `GET /status` — returns `{ sessionName, sessionAlive: boolean, agents: [{ name, state: 'idle'|'busy'|'unknown', stateAgeSeconds, paneExists: boolean, lastDispatch: {ts, command} | null }], queueLength, queueLines: string[], dashboardVersion }`
    - `POST /agents/:name/run` — if the agent's pane exists and state is `idle`, send `CLEAR_CMD` via `sendKeys`; return `{ ok: true, action: 'clear-sent' }`. If state is `busy`, return 409 with `{ ok: false, reason: 'agent-busy' }`. If pane missing, 404.
    - `POST /agents/:name/stop` — `sendKeys(target, '/exit')`; return `{ ok: true, action: 'exit-sent' }`. 404 if pane missing.
    - `POST /agents/:name/restart` — look up last dispatch for that agent; if none, 404 with `{ ok: false, reason: 'no-prior-dispatch' }`. Otherwise `prependScoped(taskQueue, name, lastCmd)` then `writeAgentState(stateDir, name, 'idle')`; return `{ ok: true, action: 'requeued', command: lastCmd }`
    - `GET /logs/:stream` — SSE stream where `:stream ∈ { dispatch, hooks, monitor }`. Maps to `<logDir>/dispatch.jsonl`, `<hooksLogPath>/hooks.jsonl`, and the newest-by-mtime `<logDir>/monitor-*.log`. Uses `tailJsonl` for JSONL streams and a plain line-watcher for the monitor log. Initial `?fromStart=1` query param replays from beginning; default streams only new lines. Emits `data: <line>\n\n` frames.
    - `GET /panes/:name` — SSE stream. Every 1000ms runs `capturePane` and emits the latest 200 non-blank lines as `data: <json-string>\n\n`. Stops on client disconnect.
  - On startup, call `loadConfig()` and log `listening on http://<bind>:<port>` to stdout
  - Graceful shutdown on SIGTERM/SIGINT: close Fastify, clear all SSE intervals, exit 0
- [ ] Resolve hooks log path: add to `config.js` a `hooksLogPath` derived from env var `CONDUCTOR_LOG_DIR` (if set in conductor.conf via `export`) or fallback to `<logDir>/hooks.jsonl`. If the commented `CONDUCTOR_LOG_DIR` in `conductor.conf` is uncommented by the user, respect it.
- [ ] Make `scripts/dashboard/src/server.js` executable: `chmod +x scripts/dashboard/src/server.js` and add `#!/usr/bin/env node` shebang
- [ ] Smoke-test the server standalone: `cd scripts/dashboard && npm start` then in another terminal `curl http://127.0.0.1:8787/status | jq` — should return valid JSON even with no agents running
- [ ] Smoke-test Swagger: `curl -s http://127.0.0.1:8787/docs/json | jq '.paths | keys'` — should list all defined routes

### 3. React + Vite UI  <!-- agent: general-purpose -->

- [ ] Scaffold `scripts/dashboard/ui/` with Vite React-TS template. Create `scripts/dashboard/ui/package.json` manually with:
  - `"name": "tmux-conductor-dashboard-ui"`, `"private": true`, `"type": "module"`
  - scripts: `"dev": "vite"`, `"build": "tsc -b && vite build"`, `"preview": "vite preview"`
  - devDeps: `"vite": "^5.4.0"`, `"@vitejs/plugin-react": "^4.3.0"`, `"typescript": "^5.5.0"`, `"@types/react": "^18.3.0"`, `"@types/react-dom": "^18.3.0"`
  - deps: `"react": "^18.3.0"`, `"react-dom": "^18.3.0"`
- [ ] Create `scripts/dashboard/ui/vite.config.ts` with `@vitejs/plugin-react` and `build.outDir: 'dist'`
- [ ] Create `scripts/dashboard/ui/tsconfig.json` and `tsconfig.node.json` matching the Vite React-TS template defaults (ES2022, bundler module resolution, strict)
- [ ] Create `scripts/dashboard/ui/index.html` with root div and `<script type="module" src="/src/main.tsx">`
- [ ] Create `scripts/dashboard/ui/src/main.tsx` bootstrapping `<App />` into `#root`
- [ ] Create `scripts/dashboard/ui/src/api.ts` with typed fetch wrappers for each backend route (`getStatus`, `runAgent`, `stopAgent`, `restartAgent`) plus `openSse(path)` returning an `EventSource`
- [ ] Create `scripts/dashboard/ui/src/App.tsx`:
  - Polls `GET /status` every 2000ms using a `useEffect` + `setInterval`
  - Renders session header (`sessionName`, alive indicator dot) and a grid of `<AgentRow />` per agent
  - Renders a `<LogViewer />` below the grid with a tab switcher for `dispatch | hooks | monitor`
- [ ] Create `scripts/dashboard/ui/src/AgentRow.tsx`:
  - Props: `{ agent: StatusAgent }`
  - Shows `name`, colored state badge (idle=green, busy=amber, unknown=gray), `stateAgeSeconds`, and `lastDispatch.command` truncated to 80 chars
  - Three buttons: Run / Stop / Restart — each disabled while in-flight; posts to the matching backend route; on error shows a toast (simple inline error text for now)
  - "Peek pane" toggle that mounts `<PaneTail name={agent.name} />` below the row
- [ ] Create `scripts/dashboard/ui/src/PaneTail.tsx`:
  - Opens `GET /panes/:name` SSE on mount, closes on unmount
  - Renders the received lines in a `<pre>` with `overflow-y: auto`, max-height 320px, auto-scroll to bottom on new data
- [ ] Create `scripts/dashboard/ui/src/LogViewer.tsx`:
  - Tabs for `dispatch`, `hooks`, `monitor`
  - Opens `GET /logs/:stream?fromStart=1` on tab switch (close previous EventSource)
  - Pretty-prints JSONL records (parse each line, show `ts` + short summary; raw JSON behind an "expand" click). Falls back to raw text for the `monitor` stream.
  - Keeps only the last 500 lines in state
- [ ] Create `scripts/dashboard/ui/src/styles.css` with a minimal dark theme (CSS custom properties, no framework). Import from `main.tsx`.
- [ ] Build the UI: `cd scripts/dashboard/ui && npm install && npm run build` — confirm `dist/index.html` + assets are produced
- [ ] Verify the Fastify server serves the built UI at `/`: restart `npm start`, visit `http://127.0.0.1:8787/` in a browser, confirm the dashboard loads and polls `/status`

### 4. Conductor spawn wiring  <!-- agent: general-purpose -->

- [ ] Edit `scripts/conductor.sh` to spawn the dashboard window after agents but before the monitor window when `DASHBOARD_ENABLED=1`:
  - Create a new tmux window named `dashboard` with working directory at the repo root
  - Send `send-keys -l "$DASHBOARD_CMD"` then `Enter`
  - Do NOT wrap in `agent_exec.sh` — the dashboard always runs on the host
- [ ] Mirror the same logic in `scripts/spawn.sh` (split-pane variant): create a new pane for the dashboard, also on the host
- [ ] Edit `scripts/teardown.sh` to also send `C-c` to the dashboard window/pane before killing the session (graceful Fastify shutdown)
- [ ] Ensure the dashboard window is NOT added to `AGENT_NAMES` in `monitor.sh` — it must not be polled for idle. The dashboard name is fixed (`dashboard`) and distinct from any user-chosen agent name; document this constraint as a comment near the new config block in `conductor.conf` ("reserved window name, cannot be used for an AGENTS entry")
- [ ] If `DASHBOARD_ENABLED=0`, skip spawning entirely in both `conductor.sh` and `spawn.sh`
- [ ] Add a bash syntax check step: `bash -n scripts/conductor.sh && bash -n scripts/spawn.sh && bash -n scripts/teardown.sh`

### 5. Docs update  <!-- agent: general-purpose -->

- [ ] Update `scripts/README.md`:
  - Add a `dashboard/` row to the script table with purpose "Fastify + React command center exposing per-agent run/stop/restart + log streams at http://127.0.0.1:8787"
  - Add a new section "Dashboard" with: how to enable/disable via `conductor.conf`, the four `DASHBOARD_*` knobs, a note about LAN access (`DASHBOARD_BIND=0.0.0.0`), and a list of API routes (link to `/docs`)
  - Extend the mermaid flowchart to include the dashboard node: `conductor.sh -> dashboard window -> Fastify(:8787) -> {tmux capture-pane, dispatch.jsonl, tasks.txt}` with bidirectional arrows where appropriate
- [ ] Update root `README.md`: add a "Dashboard" subsection under the features list that mentions the URL and three action buttons
- [ ] Update `CLAUDE.md`:
  - Add a `scripts/dashboard/src/server.js` row to the script table: "Fastify server: `/status`, `/agents/:name/{run,stop,restart}`, SSE `/logs/:stream` + `/panes/:name`, Swagger at `/docs`"
  - Add a Key Design Decisions bullet: "Dashboard window is spawned on the HOST (never through `agent_exec.sh`), bound to 127.0.0.1 by default, and not polled for idle. Window name `dashboard` is reserved."

### 6. Task index + status  <!-- agent: general-purpose -->

- [ ] Add a row for task 017 to the "Active Tasks" table in `.docs/tasks/README.md` with a one-line description
- [ ] No `PROJECT_STATUS.md` exists in this repo (confirmed via `list_dir`) — skip that update

### 7. Verification  <!-- agent: general-purpose -->

- [ ] Run `cd scripts/dashboard/ui && npm run build` — succeeds, produces `dist/`
- [ ] Start the full system: `./scripts/conductor.sh` (or use an existing session). Confirm a `dashboard` window appears and the Fastify banner `listening on http://127.0.0.1:8787` prints
- [ ] `curl -s http://127.0.0.1:8787/status | jq` returns a valid payload with one entry per agent in `conductor.conf`
- [ ] `curl -s http://127.0.0.1:8787/docs/json | jq '.paths | keys'` lists all six route paths (`/status`, `/agents/{name}/run`, `.../stop`, `.../restart`, `/logs/{stream}`, `/panes/{name}`)
- [ ] Open `http://127.0.0.1:8787/` in a browser via Puppeteer (`mcp__puppeteer-mcp-claude__puppeteer_navigate`), screenshot the dashboard. Confirm each agent row appears and state badges render.
- [ ] Exercise Restart: with one agent idle and a prior dispatch in `dispatch.jsonl`, click Restart; confirm `tasks.txt` gains a scoped line at top, the agent's `.state` file reads `idle`, and within one `POLL_INTERVAL` the monitor re-dispatches
- [ ] Exercise Stop: click Stop on one agent; confirm `/exit` was sent (tmux pane shows the command echoed); agent CLI exits; other agents unaffected
- [ ] Exercise Run on an already-idle agent with empty queue: confirm `CLEAR_CMD` is sent to the pane
- [ ] Open the Logs tab, cycle through `dispatch`/`hooks`/`monitor`: confirm each stream emits data (generate a dispatch by pushing a task) and that historical lines load when the tab is first opened
- [ ] Open "Peek pane" for one agent: confirm a live tail of that agent's tmux pane renders and updates ~1s
- [ ] Tear down: run `./scripts/teardown.sh` — confirm Fastify logs graceful shutdown and the tmux session is gone
- [ ] Run `bash -n` against all edited shell scripts; run `tsc -b --noEmit` inside `scripts/dashboard/ui/` to confirm TypeScript compiles
