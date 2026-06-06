# 023 — Task Queue CRUD API

> **Depends on**: [022-fastify-status-server](022-fastify-status-server.md)
> **Blocks**: none
> **Parallel-safe with**: [024-agent-management-api](024-agent-management-api.md)

## Objective

Add task queue CRUD routes to the Fastify server:
- `POST /queue/:agent` — append a task line to `tasks.txt` (scoped to agent)
- `PUT /queue/:agent/reorder` — reorder the queue for a specific agent
- `DELETE /queue/:agent/:index` — remove a task at a given zero-based index

## Approach

All operations read/write `tasks.txt` (the `TASK_QUEUE` path from `conductor.conf`). File operations are protected by a simple async mutex (one write at a time) to avoid concurrent corruption. Line format matches the existing convention: `agentname: task text` for scoped tasks, bare text for global. The `:index` parameter refers to the zero-based position among lines scoped to that agent.

---

## Steps

### 1. Add queue helpers to `scripts/dashboard/server/state.js`  <!-- agent: general-purpose -->

- [x] Export `readQueue(taskQueuePath)` → `string[]`
  - Reads file, splits on newlines, filters empty lines, returns array
  - Returns `[]` if file missing
- [x] Export `writeQueue(taskQueuePath, lines)` → `void`
  - Writes the array of lines back to the file (one per line, trailing newline)
  - Uses a simple in-process mutex (a single `Promise` chain) to serialize writes:
    ```js
    let writeChain = Promise.resolve()
    export function writeQueue(path, lines) {
      writeChain = writeChain.then(() => fs.writeFile(path, lines.join('\n') + '\n'))
      return writeChain
    }
    ```
- [x] Export `getAgentLines(lines, agentName)` → `{ indices: number[], tasks: string[] }`
  - Returns the global-array indices and the task text (without the `agentname: ` prefix) for all lines belonging to `agentName` or global (no prefix)
  - Scoped match: line starts with `<agentName>: ` (case-sensitive)
  - Global match: line does not contain `: ` after trimming

### 2. Register queue routes in `scripts/dashboard/server/index.js`  <!-- agent: general-purpose -->

- [x] `POST /queue/:agent`
  - Body: `{ "task": "string" }` (JSON)
  - Appends `<agent>: <task>` to `tasks.txt`
  - Returns `{ "ok": true, "line": "<agent>: <task>" }`
  - 400 if `task` is missing or empty

- [x] `GET /queue/:agent`
  - Returns `{ "agent": "<name>", "tasks": ["task1", "task2"] }` — the tasks scoped to that agent (or global)
  - 200 always (empty array if no tasks)

- [x] `PUT /queue/:agent/reorder`
  - Body: `{ "order": [2, 0, 1] }` — new index order for this agent's tasks (indices within the agent's own sub-list)
  - Reads the full queue, reorders only the agent's lines in-place, writes back
  - Returns `{ "ok": true }`
  - 400 if `order` doesn't contain same indices as current agent task count

- [x] `DELETE /queue/:agent/:index`
  - Removes the task at zero-based `index` within the agent's task list
  - Reads queue, finds the `index`-th line belonging to agent, removes it, writes back
  - Returns `{ "ok": true }`
  - 404 if index out of range

### 3. Verification  <!-- agent: general-purpose -->

- [x] `POST /queue/jobfinder` with `{"task":"do the thing"}` → appends `jobfinder: do the thing` to tasks.txt
- [x] `GET /queue/jobfinder` → returns the just-added task
- [x] `DELETE /queue/jobfinder/0` → removes it; `GET /queue/jobfinder` returns empty array
- [x] `PUT /queue/jobfinder/reorder` with wrong index count → 400 response
- [x] Concurrent `POST` requests do not corrupt tasks.txt (run two rapid posts and confirm both lines present)
