# 040 — Convert backend JS source files to TypeScript

> **Depends on**: [038-backend-load-root-env](038-backend-load-root-env.md), [041-backend-tsconfig](041-backend-tsconfig.md)
> **Blocks**: none
> **Parallel-safe with**: [043-frontend-tsconfig-strict](043-frontend-tsconfig-strict.md)

## Objective

Rename `backend/index.js`, `backend/config.js`, and `backend/state.js` to `.ts`, add TypeScript type annotations throughout, install `tsx` for running the TS source directly, and update `package.json` scripts to use it.

## Approach

- Use `git mv` to rename each file (preserves history)
- Add explicit type annotations to function signatures and variables — the files already have JSDoc which serves as a guide
- Use `tsx` (a fast TS runner for Node.js ESM) as the dev runtime so no compile step is needed in development
- Import paths within the package must use `.js` extensions (NodeNext module resolution requires this even for `.ts` source)
- Add `typescript` and `tsx` as `devDependencies`

---

## Steps

### 1. Rename source files  <!-- agent: general-purpose -->

Run from `backend/`:
- [x] `git mv index.js index.ts`
- [x] `git mv config.js config.ts`
- [x] `git mv state.js state.ts`

### 2. Install TypeScript dependencies  <!-- agent: general-purpose -->

File: `backend/package.json`

- [x] Add `"devDependencies"` block with:
  ```json
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsx": "^4.0.0",
    "@types/node": "^20.0.0"
  }
  ```
- [x] Update `"scripts"`:
  ```json
  "scripts": {
    "start": "node --import tsx/esm index.ts",
    "dev": "node --watch --import tsx/esm index.ts"
  }
  ```
- [x] Run `cd backend && npm install`

### 3. Type-annotate `backend/state.ts`  <!-- agent: general-purpose -->

File: `backend/state.ts`

- [x] Add return type to `readAgentState`: `function readAgentState(stateDir: string, agentName: string): string`
- [x] Add return type to `countQueuedTasks`: `function countQueuedTasks(taskQueuePath: string, agentName: string): number`
- [x] Add return type to `isTmuxWindowPresent`: `function isTmuxWindowPresent(sessionName: string, windowName: string): boolean`
- [x] Add return type to `readQueue`: `function readQueue(taskQueuePath: string): string[]`
- [x] Add return type to `writeQueue`: `function writeQueue(taskQueuePath: string, lines: string[]): Promise<void>`
- [x] Add return type to `getAgentLines`: 
  ```ts
  function getAgentLines(lines: string[], agentName: string): { indices: number[]; tasks: string[] }
  ```
- [x] Fix any `catch` blocks — with `useUnknownInCatchVariables` (from strict mode) catch variable is `unknown`; cast to `Error` where needed or use `catch {}` (blank catch)

### 4. Type-annotate `backend/config.ts`  <!-- agent: general-purpose -->

File: `backend/config.ts`

- [x] Define and export the config shape type:
  ```ts
  export interface AgentEntry {
    name: string;
    workdir: string;
    launchCmd: string;
  }
  
  export interface ConductorConf {
    sessionName: string;
    taskQueue: string;
    stateDir: string;
    agents: AgentEntry[];
  }
  ```
- [x] Add return type `ConductorConf` to `readConductorConf`
- [x] Add return type `string | null` to `parseDeclare`
- [x] Add return type `string` to `parseScalar`
- [x] Add return type `string[]` to `parseArray`
- [x] Add return type `AgentEntry` to `parseAgentEntry`
- [x] Add param types to `appendAgentToConf(confPath: string, name: string, workdir: string, launchCmd: string): Promise<void>`
- [x] Update `DEFAULT_CONF_PATH` path: after move to `backend/`, the path `'../../../conductor.conf'` is now wrong (backend is 1 level deep). Replace with:
  ```ts
  export const DEFAULT_CONF_PATH =
    process.env.CONDUCTOR_CONF || new URL('../conductor.conf', import.meta.url).pathname;
  ```

### 5. Type-annotate `backend/index.ts`  <!-- agent: general-purpose -->

File: `backend/index.ts`

- [x] Import `ConductorConf`, `AgentEntry` from `./config.js` where needed
- [x] Add type to `sseClients: Set<FastifyReply>` (import `FastifyReply` from `fastify`)
- [x] Type the `broadcastSSE` function: `function broadcastSSE(eventName: string, data: unknown): void`
- [x] Add type to `prevSnapshot` variable:
  ```ts
  interface Snapshot {
    sessionAlive: boolean;
    agents: Array<{ name: string; state: string; windowPresent: boolean; queuedTasks: number }>;
  }
  let prevSnapshot: Snapshot | null = null;
  ```
- [x] Fix the static UI path resolution: after the move to `backend/`, the old path `'ui', 'dist'` (relative to index.ts) no longer points to the UI dist. For now, remove or comment out the static serving block — the frontend will be served separately or wired up in a later task
- [x] Update import paths to use `.js` extensions per NodeNext: `import { ... } from './config.js'`, `import { ... } from './state.js'`

### 6. Verification  <!-- agent: general-purpose -->

- [x] `backend/index.ts`, `backend/config.ts`, `backend/state.ts` all exist; no `.js` variants of these files remain
- [x] `cd backend && npx tsc --noEmit` exits 0 (requires task 041's `tsconfig.json` to be present)
- [x] `cd backend && npm run dev` starts the server without errors

---
**UAT**: [`.docs/uat/040-backend-convert-to-typescript.uat.md`](../uat/040-backend-convert-to-typescript.uat.md)
