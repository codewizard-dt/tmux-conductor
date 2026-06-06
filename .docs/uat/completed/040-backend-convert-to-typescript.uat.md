# UAT: Convert backend JS source files to TypeScript

> **Source task**: [`.docs/tasks/040-backend-convert-to-typescript.md`](../tasks/040-backend-convert-to-typescript.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Working directory is the repo root (`/Users/davidtaylor/Repositories/tmux-conductor` or equivalent)
- [ ] Node.js >= 18 installed (`node --version`)
- [ ] `backend/node_modules` is populated — run `cd backend && npm install` if not
- [ ] Task 041 (`backend/tsconfig.json`) is present and complete — `ls backend/tsconfig.json` should succeed
- [ ] A valid `conductor.conf` exists at the repo root (used by `DEFAULT_CONF_PATH`)

---

## File Structure Tests

### UAT-FILE-001: No JS source variants remain
- **Description**: Verify that the original `.js` source files no longer exist in `backend/`. The rename must be complete — any surviving `.js` twin would shadow the `.ts` file under some runtimes.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  ls backend/index.js backend/config.js backend/state.js 2>&1
  ```
- **Expected Result**: All three paths produce "No such file or directory" — `ls` exits non-zero and prints error lines for each missing file. No output line should omit "No such file".
- [x] Pass <!-- 2026-06-06 -->

### UAT-FILE-002: TypeScript source files exist
- **Description**: Verify that `index.ts`, `config.ts`, and `state.ts` all exist in `backend/`.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  ls backend/index.ts backend/config.ts backend/state.ts
  ```
- **Expected Result**: All three paths are listed without error. Exit code 0.
- [x] Pass <!-- 2026-06-06 -->

### UAT-FILE-003: Import paths in index.ts use .js extensions
- **Description**: NodeNext module resolution requires `.js` extensions on imports even when the source is `.ts`. Verify that `index.ts` imports from `./config.js` and `./state.js`, not bare `./config` or `./config.ts`.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -E "from '\./config|from '\./state" backend/index.ts
  ```
- **Expected Result**: Both import lines end in `.js` — e.g. `from './config.js'` and `from './state.js'`. No match should show a bare `./config'` or `./config.ts'`.
- [x] Pass <!-- 2026-06-06 -->

---

## TypeScript Correctness Tests

### UAT-TS-001: tsc --noEmit exits 0
- **Description**: The TypeScript compiler must accept all three source files with the project's strict `tsconfig.json` (strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `NodeNext` module resolution). This is the primary acceptance criterion for the conversion.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  cd backend && npx tsc --noEmit 2>&1
  ```
- **Expected Result**: Command exits 0 and produces no output. Any line of output indicates a type error that must be fixed.
- [x] Pass <!-- 2026-06-06 -->

### UAT-TS-002: Exported interfaces are present in config.ts
- **Description**: The task requires `AgentEntry` and `ConductorConf` to be exported named interfaces in `config.ts`. Verify their presence structurally.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -E "^export interface (AgentEntry|ConductorConf)" backend/config.ts
  ```
- **Expected Result**: Two matching lines — one for `export interface AgentEntry` and one for `export interface ConductorConf`. Both must appear.
- [x] Pass <!-- 2026-06-06 -->

### UAT-TS-003: DEFAULT_CONF_PATH uses import.meta.url resolution
- **Description**: After the move to `backend/`, the old `'../../../conductor.conf'` relative path was wrong. The task requires `DEFAULT_CONF_PATH` to use `new URL('../conductor.conf', import.meta.url).pathname` (or the `CONDUCTOR_CONF` env var).
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep "DEFAULT_CONF_PATH" backend/config.ts
  ```
- **Expected Result**: The line contains `import.meta.url` — specifically the pattern `new URL('../conductor.conf', import.meta.url).pathname`. The old literal relative path `'../../../conductor.conf'` must not appear.
- [x] Pass <!-- 2026-06-06 -->

---

## Package.json Tests

### UAT-PKG-001: devDependencies contain typescript, tsx, @types/node
- **Description**: The task requires adding `typescript ^5`, `tsx ^4`, and `@types/node ^20` as devDependencies.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node -e "const p=JSON.parse(require('fs').readFileSync('backend/package.json','utf8')); const d=p.devDependencies||{}; console.log(JSON.stringify({typescript:d.typescript,tsx:d.tsx,'@types/node':d['@types/node']},null,2));"
  ```
- **Expected Result**: JSON output shows all three keys with non-null semver ranges — `typescript` starting with `^5`, `tsx` starting with `^4`, `@types/node` starting with `^20`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-PKG-002: start and dev scripts use tsx/esm loader
- **Description**: The `start` script must use `node --import tsx/esm index.ts` and `dev` must use `node --watch --import tsx/esm index.ts`.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node -e "const p=JSON.parse(require('fs').readFileSync('backend/package.json','utf8')); console.log(JSON.stringify(p.scripts,null,2));"
  ```
- **Expected Result**: `start` is `"node --import tsx/esm index.ts"` and `dev` is `"node --watch --import tsx/esm index.ts"`. Scripts must reference `index.ts`, not `index.js`.
- [x] Pass <!-- 2026-06-06 -->

---

## Runtime Tests

### UAT-RUN-001: npm run dev starts the server without errors
- **Description**: `npm run dev` (which uses `node --watch --import tsx/esm index.ts`) must start the Fastify server on port 8788 without crashing. This verifies the tsx runner, ESM imports, and the type-annotated source all work at runtime.
- **Steps**:
  1. From a terminal, run: `cd backend && npm run dev`
  2. Wait ~3 seconds for the server to bind
  3. In a second terminal, run the curl command below
  4. Stop the server with `Ctrl-C` when done
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/healthz'
  ```
- **Expected Result**: Server starts and prints a line containing `Dashboard server listening on http://127.0.0.1:8788`. The curl returns `{"ok":true}` with HTTP 200.
- [x] Pass <!-- 2026-06-06 -->

### UAT-RUN-002: GET /api/status responds with correct shape
- **Description**: After the TypeScript migration the `/api/status` route must still return the full status payload including typed agent entries. Verifies that `readConductorConf`, `readAgentState`, `isTmuxWindowPresent`, and `countQueuedTasks` all function correctly at runtime from their `.ts` sources.
- **Steps**:
  1. Ensure the dev server from UAT-RUN-001 is running (`cd backend && npm run dev`)
  2. Run the curl command below
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/status' | jq '{session,sessionAlive,timestamp,agentCount:.agents|length}'
  ```
- **Expected Result**: JSON with `session` (string, matches `SESSION_NAME` from `conductor.conf`), `sessionAlive` (boolean), `timestamp` (ISO 8601 string), and `agentCount` (integer >= 0). No error keys. HTTP 200.
- [x] Pass <!-- 2026-06-06 -->

### UAT-RUN-003: GET /api/queue/:agent responds correctly
- **Description**: The queue endpoint must return the correct shape after the TypeScript migration. Verifies `getAgentLines` and `readQueue` work at runtime.
- **Steps**:
  1. Ensure the dev server is running
  2. Run the curl command below (substitute a real agent name from `conductor.conf` for `general-purpose` if different)
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/queue/general-purpose' | jq '.'
  ```
- **Expected Result**: JSON with `agent` (string equal to `"general-purpose"`) and `tasks` (array of strings). HTTP 200. No crash or uncaught exception in the server terminal.
- [x] Pass <!-- 2026-06-06 -->

---

## Edge Case Tests

### UAT-EDGE-001: POST /queue/:agent validates empty task body
- **Description**: The validation added in `index.ts` rejects empty or missing `task` fields with a `400` response and a specific error message. This path exercises the TypeScript-typed request body (`Body: { task?: string }`).
- **Steps**:
  1. Ensure the dev server is running
  2. Run the curl command below
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/queue/general-purpose' -H 'Content-Type: application/json' -d '{"task":""}'
  ```
- **Expected Result**: HTTP 400 with body `{"error":"task is required and must be a non-empty string"}`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-002: tsc detects type errors on a broken edit
- **Description**: Confirm that TypeScript strictness is real — a deliberate type error in `state.ts` must cause `tsc --noEmit` to fail. This validates that the annotations are load-bearing and not just cosmetic.
- **Steps**:
  1. In `backend/state.ts`, temporarily change the return type annotation of `readAgentState` from `string` to `number` (do not change the function body — the body still returns a string)
  2. Run the tsc command below
  3. Revert the change to `string` after confirming the result
- **Command**:
  ```bash
  cd backend && npx tsc --noEmit 2>&1
  ```
- **Expected Result**: Exit code non-zero. Output contains a diagnostic error referencing `state.ts` and a type mismatch (e.g. `Type 'string' is not assignable to type 'number'`). After reverting, `tsc --noEmit` returns to exit 0.
- [x] Pass <!-- 2026-06-06 -->

---

## Gaps and Notes

- **Static UI block**: The task notes that the static file serving block was removed/commented out (the `ui/dist` path no longer applied after the move to `backend/`). No UAT test is written for this because the removal itself is not directly verifiable at runtime without a built UI dist — UAT-RUN-001/002 implicitly confirm the server starts and serves API routes without that block causing a crash.
- **`npm run start` (production script)**: The production start script (`node --import tsx/esm index.ts` without `--watch`) is not tested here because it behaves identically to dev except for the watch flag. UAT-RUN-001 covers the critical runtime path.
- **Agent management `POST /api/agents`**: This endpoint requires an active tmux session and makes tmux calls, so it cannot be exercised in a bare dev environment without a live session. It is excluded from this UAT to avoid environment-dependent failures unrelated to the TypeScript migration.
