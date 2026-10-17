---
id: UAT-0185
aliases: [UAT-0185]
title: "UAT: Fix dispatched task text never submitting: add render-settle delays to sendTextToPane and the /clear chain"
status: pending
task: TASK-0185
created: 2026-09-19
updated: 2026-09-19
---

# UAT-0185 — UAT: Fix dispatched task text never submitting: add render-settle delays to sendTextToPane and the /clear chain

implements::[[TASK-0185]]

> **Source task**: [[TASK-0185]]
> **Generated**: 2026-09-19

---

## Prerequisites

- [ ] The host-server is running code **from after the TASK-0185 edits**. A `make dev` session (`tsx watch`) picks them up on its own. A long-lived `npm run start` process (no `--watch`) does NOT, so restart it first.
- [ ] Frontend/dashboard not required; everything below uses the host-server API on `:8788`, `tmux`, and `logs/`.
- [ ] A running conductor tmux session with a **disposable** Claude Code agent that belongs to a **project** (`GET /api/agents` → its `projectId` is non-null). It gets `/clear`ed during UAT-API-002 and UAT-EDGE-001, so do not use an agent with context you care about.
- [ ] Note for that agent: `<ID>` (agent id from `GET /api/agents`), `<PROJECT_ID>`, and `<WINDOW>` (its tmux window name, which is also the `agent` value in `logs/hooks.jsonl` and `logs/dispatch.jsonl`). The hooks must be installed (`./install-hooks.sh`) so `logs/hooks.jsonl` receives `session-start` / `prompt-submit` / `stop` records.
- [ ] `jq` installed.
- [ ] Delay env overrides (`DISPATCH_SUBMIT_DELAY_MS`, `DISPATCH_POST_CLEAR_DELAY_MS`) are NOT set, so the defaults (300ms / 1000ms) apply.

---

## Test Cases

### UAT-API-001: Immediate-enqueue dispatch is actually submitted, not left typed in the input box

- **Endpoint**: `POST /api/tasks`
- **Description**: Fast-path dispatch (agent idle, empty queue) types the command, waits the 300ms settle, then sends `Enter`. Before the fix the text could sit unsent in the prompt. Proof of submission is that Claude Code's `UserPromptSubmit` hook fires (`prompt-submit` record) — a typed-but-unsent prompt never triggers it.
- **Steps**:
  1. Confirm the agent is idle with an empty queue: `curl -sS 'http://localhost:8788/api/queue/<WINDOW>' | jq '.tasks'` → `[]`, and `logs/state/<WINDOW>.state` reads `idle`.
  2. Note the current tail of the hook log: `tail -n 3 logs/hooks.jsonl`.
  3. Run the command below.
  4. Within ~5 seconds run `tail -n 5 logs/hooks.jsonl | jq -c 'select(.agent=="<WINDOW>")'` and `curl -sS 'http://localhost:8788/api/agents/<ID>/tail?lines=15' | jq -r '.tail // .'`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"Reply with exactly the word: settle-ok","agentId":<ID>}'
  ```
- **Expected Result**:
  - HTTP 200, body `{"ok":true,"dispatched":true}` (no task row created)
  - A new `logs/hooks.jsonl` record for `<WINDOW>` with `"event":"prompt-submit"` and `"new_state":"busy"`, timestamped after the POST
  - The pane tail shows the prompt as a submitted turn (agent responding / `esc to interrupt`), NOT the text sitting in an empty-input box
  - The agent later returns to idle (`stop` record)
  - `logs/dispatch.jsonl` gains exactly one record for `<WINDOW>` with `"detection":"immediate-enqueue"`
- **Repeatable Unit Test**: Not applicable: end-to-end tmux + Claude Code behaviour; the send order itself is unit-tested under UAT-EDGE-003
- [ ] Pass

---

### UAT-API-002: Project-scoped task runs `/clear` first, and both `/clear` and the task are submitted

- **Endpoint**: `POST /api/tasks` (queue a project task) → poll-driven dispatch on the busy→idle transition
- **Description**: This is the reported incident. A popped `kind === 'project'` task sets `clearFirst`, so the chain is `/clear` → Enter → 1000ms settle → task text → 300ms → Enter. Before the fix `/clear` and the task text ended up concatenated on one line and **neither** Enter registered. Success means the session was actually cleared (`session-start` hook) and the task was then actually submitted (`prompt-submit` hook), in that order.
- **Steps**:
  1. Make the agent busy with a long-ish prompt so the project task queues instead of fast-pathing: `curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"Count slowly from 1 to 20, one number per line, then stop.","agentId":<ID>}'` (expect `dispatched:true`).
  2. Immediately run the command below to queue the project-scoped task (expect HTTP 201, `"dispatched":false`, `"projectId":<PROJECT_ID>`).
  3. Wait for the agent to finish (goes idle); the host-server pops the project task on that transition.
  4. Within ~10 seconds after the agent goes idle, run `tail -n 12 logs/hooks.jsonl | jq -c 'select(.agent=="<WINDOW>")'` and `tmux capture-pane -p -t '<SESSION>:=<WINDOW>' -S -30`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"Reply with exactly the word: clear-then-task-ok","projectId":<PROJECT_ID>}'
  ```
- **Expected Result**:
  - After the idle transition, `hooks.jsonl` shows, in this order for `<WINDOW>`: a `session-start` record (the `/clear` was submitted and reset the session), then a `prompt-submit` record roughly 1–2 seconds later (the task text was submitted)
  - The pane history never shows `/clear` and the task text concatenated on one input line
  - The agent answers `clear-then-task-ok`, then returns to idle
  - The queue no longer contains the project task (`curl -sS 'http://localhost:8788/api/tasks?projectId=<PROJECT_ID>' | jq 'length'` decreased by one)
  - `logs/dispatch.jsonl` has exactly one new record for `<WINDOW>` with `"detection":"idle-transition-poll"`
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (chain order and gaps; the live tmux/Claude behaviour cannot be a unit test)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [ ] Pass

---

### UAT-EDGE-001: No double dispatch during the settle gap

- **Scenario**: While the ~1.6s `/clear` → task chain is in flight, further ticks must not dispatch a second task into the same pane. `dispatchTaskToAgent` writes `busy` and `popTask` removes the row before any send, so the next 2s poll and a fast-path enqueue must both see `busy`.
- **Steps**:
  1. Make the agent busy (as in UAT-API-002 step 1) and queue **two** project tasks, `A` then `B`: run the UAT-API-002 command twice with different `command` text (`...: task-A` / `...: task-B`).
  2. Wait for the agent to go idle, then watch for ~10 seconds: `tail -n 15 logs/dispatch.jsonl | jq -c 'select(.agent=="<WINDOW>")'`.
  3. While the chain is in flight (first ~2s after idle), also fire an immediate enqueue for the same agent: `curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"Reply: interloper","agentId":<ID>}'`.
- **Expected Result**:
  - Only task `A` is dispatched on that idle transition; `dispatch.jsonl` gains exactly one record. Task `B` stays queued until the agent goes idle again
  - The interloper POST returns HTTP 201 with `"dispatched":false` (agent reads `busy`, so it queues instead of fast-pathing) and its text never appears in the pane during the chain
  - Pane shows no interleaved or concatenated input
- **Repeatable Unit Test**: Not applicable: depends on the interaction of the live state file, the poll loop and tmux timing
- [ ] Pass

---

### UAT-EDGE-002: The host-server stays responsive during a dispatch (delay is non-blocking)

- **Scenario**: A blocking wait (`Atomics.wait` style) was explicitly rejected; the settle delays must use `setTimeout`, so the event loop keeps serving requests during the 1s–1.6s chain.
- **Steps**:
  1. Prepare a project task that will dispatch on the next idle transition (as in UAT-API-002 steps 1–2), and have a second terminal ready.
  2. In the first terminal, watch `curl -sS 'http://localhost:8788/api/events'` (SSE) or the dashboard; the moment the agent flips idle and the chain starts, run in the second terminal: `curl -sS 'http://localhost:8788/api/status'`.
- **Expected Result**:
  - `/api/status` returns immediately (well under a second) while the `/clear` → task chain is still running, and the SSE stream keeps emitting `agent-update` events without a ~1s+ stall
- **Repeatable Unit Test**: Not applicable: event-loop responsiveness under real timers and a live server
- [ ] Pass

---

### UAT-EDGE-003: Send order, gaps, verbatim text and failure handling are unit-backed

- **Scenario**: The deterministic part of the fix — argv order, `Enter` as its own argument, the 300ms text→Enter gap, the 1000ms post-`/clear` settle, verbatim pass-through of shell-special characters (`"`, `$`, `\`, `;`), and no `Enter` after a failed text send — is covered by five node:test cases added by the tackle in `host-server/state.test.ts` (`describe('sendTextToPane / sendDispatchToPane (TASK-0185)')`).
- **Steps**:
  1. Run the unit test command below.
  2. Confirm all five `sendTextToPane / sendDispatchToPane (TASK-0185)` cases pass.
- **Expected Result**: the file passes with 0 failures; the five TASK-0185 cases are among them.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts`
- [ ] Pass

---

## Known gaps (not testable)

- The `POST /tasks` `500 { error: 'dispatch failed' }` branch is effectively unreachable in a live run: the default runner `runTmux` ignores `spawnSync` results (as the pre-fix code did), so a failed tmux send does not throw. It only fires if a runner throws (covered at the unit level by UAT-EDGE-003 case (e) for `sendTextToPane`, not at the route level). No route-level test harness exists for `/tasks`, per TASK-0180's finding.
- `scripts/dispatch.sh` (the shell path) already had the 0.3s delay and was intentionally left untouched.
