# UAT: Fastify Status Server

> **Source task**: [`.docs/tasks/022-fastify-status-server.md`](../../tasks/022-fastify-status-server.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Working directory is the repo root: `/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] Node.js v18 or higher: `node --version`
- [ ] `npm install` has been run inside `scripts/dashboard/server/` (or will be run in UAT-STATIC-001)
- [ ] No process is already bound to port 8788: `lsof -i :8788 | grep LISTEN || echo "port free"`

---

## Syntax & Static Checks

### UAT-STATIC-001: node --check passes on all three server files

- **Description**: `index.js`, `config.js`, and `state.js` must all parse cleanly as ES modules
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node --check scripts/dashboard/server/index.js scripts/dashboard/server/config.js scripts/dashboard/server/state.js && echo "All syntax checks passed"
  ```
- **Expected Result**: Prints `All syntax checks passed` with no errors or warnings
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-002: package.json declares correct metadata and Fastify dependency

- **Description**: `package.json` must set `"type":"module"`, name `tmux-conductor-dashboard-server`, and list `fastify` as a dependency
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node -e "const p=JSON.parse(require('fs').readFileSync('scripts/dashboard/server/package.json','utf8')); console.log(p.name, p.type, Object.keys(p.dependencies||{}).join(','))"
  ```
- **Expected Result**: Prints `tmux-conductor-dashboard-server module fastify`
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-003: index.js registers both /healthz and /status routes

- **Description**: Both route paths must appear in the entry point source
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n "'/healthz'\|'/status'" scripts/dashboard/server/index.js
  ```
- **Expected Result**: At least two matching lines — one for `/healthz` and one for `/status`
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-004: server binds to 127.0.0.1 on port 8788

- **Description**: The listen call must specify `host: '127.0.0.1'` and port `8788` (or `process.env.BACKEND_PORT`)
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n "127.0.0.1\|8788" scripts/dashboard/server/index.js
  ```
- **Expected Result**: At least two matching lines — one containing `127.0.0.1` and one containing `8788`
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-005: config.js exports readConductorConf with 5-second cache

- **Description**: The config reader must export `readConductorConf` and implement a cache TTL of 5000 ms (or 5 seconds)
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n "readConductorConf\|5000\|5 \* 1000\|cache" scripts/dashboard/server/config.js
  ```
- **Expected Result**: Matching lines showing the exported function name and a 5-second cache value
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-006: state.js exports all three required functions

- **Description**: `readAgentState`, `countQueuedTasks`, and `isTmuxWindowPresent` must all be exported
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n "export.*readAgentState\|export.*countQueuedTasks\|export.*isTmuxWindowPresent" scripts/dashboard/server/state.js
  ```
- **Expected Result**: Exactly 3 matching lines — one per exported function
- [x] Pass <!-- 2026-06-06 -->

---

## Server Startup Tests

### UAT-SERVER-001: server starts without error and logs the listen address

- **Description**: `node scripts/dashboard/server/index.js` must start, print the listen address, and remain running
- **Steps**:
  1. Start the server in the background: `node scripts/dashboard/server/index.js &`
  2. Capture its PID: `SERVER_PID=$!`
  3. Wait briefly for startup: `sleep 1`
  4. Run the command below
  5. Kill the server after the test: `kill $SERVER_PID 2>/dev/null`
- **Command**:
  ```bash
  node scripts/dashboard/server/index.js > ./tmp/uat-022-server.log 2>&1 & SERVER_PID=$! ; sleep 1 ; grep -i "listening\|127.0.0.1" ./tmp/uat-022-server.log && kill $SERVER_PID 2>/dev/null
  ```
- **Expected Result**: At least one log line containing `listening` and `127.0.0.1` (e.g. `Dashboard server listening on http://127.0.0.1:8788`). No crash or unhandled error.
- [x] Pass <!-- 2026-06-06 -->

---

## Endpoint Tests

These tests require the server to be running. Start it once before running UAT-EP-001 through UAT-EP-003, then stop it afterward.

**Setup** (run before endpoint tests):
```bash
mkdir -p ./tmp
node scripts/dashboard/server/index.js > ./tmp/uat-022-server.log 2>&1 &
UAT_SERVER_PID=$!
sleep 1
```

**Teardown** (run after endpoint tests):
```bash
kill $UAT_SERVER_PID 2>/dev/null
```

### UAT-EP-001: GET /healthz returns {"ok":true}

- **Description**: The health-check endpoint must return HTTP 200 with body `{"ok":true}`
- **Steps**:
  1. Ensure server is running (see Setup above)
  2. Run the command below
- **Command**:
  ```bash
  curl -s http://127.0.0.1:8788/healthz
  ```
- **Expected Result**: Exactly `{"ok":true}` (or equivalent JSON with `ok` set to `true`)
- [x] Pass <!-- 2026-06-06 -->

### UAT-EP-002: GET /status returns valid JSON with required top-level fields

- **Description**: `/status` must return HTTP 200 with a JSON body containing `session`, `sessionAlive`, `agents`, and `timestamp` fields
- **Steps**:
  1. Ensure server is running (see Setup above)
  2. Run the command below
- **Command**:
  ```bash
  curl -s http://127.0.0.1:8788/status | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); const keys=['session','sessionAlive','agents','timestamp']; keys.forEach(k=>{ if(!(k in d)) throw new Error('missing field: '+k); }); console.log('ok session='+d.session+' sessionAlive='+d.sessionAlive+' agents='+d.agents.length+' ts='+d.timestamp)"
  ```
- **Expected Result**: Prints a line starting with `ok session=` followed by the session name, `sessionAlive=` (true or false), `agents=` (a count ≥ 0), and a `ts=` ISO 8601 timestamp
- [x] Pass <!-- 2026-06-06 -->

### UAT-EP-003: GET /status agents array entries have required per-agent fields

- **Description**: Each entry in the `agents` array must have `name`, `state`, `windowPresent`, and `queuedTasks` fields
- **Steps**:
  1. Ensure server is running (see Setup above)
  2. Run the command below (passes even if agents array is empty — validates shape of any present entries)
- **Command**:
  ```bash
  curl -s http://127.0.0.1:8788/status | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); const required=['name','state','windowPresent','queuedTasks']; d.agents.forEach((a,i)=>{ required.forEach(k=>{ if(!(k in a)) throw new Error('agent['+i+'] missing field: '+k); }); }); console.log('agents shape ok, count='+d.agents.length)"
  ```
- **Expected Result**: Prints `agents shape ok, count=<N>` with no errors. Each agent entry must include all four fields.
- [x] Pass <!-- 2026-06-06 -->

---

## sessionAlive Behaviour Tests

### UAT-SESSION-001: sessionAlive is false when no tmux session is running

- **Description**: When there is no active tmux session named by `SESSION_NAME`, the `/status` response must return `sessionAlive: false` and all agent `windowPresent` values must be `false`
- **Steps**:
  1. Ensure no conductor tmux session is running: `tmux kill-session -t conductor 2>/dev/null || true`
  2. Start the server (or use already-running instance from endpoint tests)
  3. Run the command below
- **Command**:
  ```bash
  node scripts/dashboard/server/index.js > ./tmp/uat-022-nosession.log 2>&1 & NSP=$! ; sleep 1 ; curl -s http://127.0.0.1:8788/status | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(d.sessionAlive!==false) throw new Error('expected sessionAlive=false, got '+d.sessionAlive); d.agents.forEach((a,i)=>{ if(a.windowPresent!==false) throw new Error('agent['+i+'] windowPresent should be false'); }); console.log('sessionAlive=false verified')" ; kill $NSP 2>/dev/null
  ```
- **Expected Result**: Prints `sessionAlive=false verified` with no errors
- [x] Pass <!-- 2026-06-06 -->

---

## Cleanup

- [ ] Kill any background server processes started during these tests: `kill $UAT_SERVER_PID $NSP 2>/dev/null || true`
- [ ] Remove temporary files: `rm -f ./tmp/uat-022-server.log ./tmp/uat-022-nosession.log`
