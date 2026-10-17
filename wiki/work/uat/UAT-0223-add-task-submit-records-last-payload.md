---
id: UAT-0223
aliases: [UAT-0223]
title: "UAT: Record Add Task box submissions in the per-agent last-payload store at submit time"
status: pending
task: TASK-0223
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0223 — UAT: Record Add Task box submissions in the per-agent last-payload store at submit time

implements::[[TASK-0223]]

> **Source task**: [[TASK-0223]]
> **Generated**: 2026-09-20

---

## Prerequisites

- [ ] Dependencies installed in `frontend/` (`cd frontend && npm install` if `node_modules` is missing). Every case except UAT-INT-002 runs under vitest/jsdom with no dev server, no host-server and no tmux.
- [ ] Concurrency caveat (do not treat as a gap): another session is concurrently editing `frontend/src/components/AgentList.tsx` and `BackgroundProcessesTab.tsx` (bg-restart work). The full frontend `tsc --noEmit` and `AgentList.test.tsx` can therefore be transiently red in files that are not part of TASK-0223. Every command below is scoped to TASK-0223's own files (`AddTaskForm.tsx`, `AddTaskForm.test.tsx`); for typecheck, filter the output to those two files.
- [ ] For UAT-INT-002 only: the dashboard is running (`make dev`, frontend `http://localhost:4321/`) and the display tasks TASK-0226 (detail strip) and TASK-0227 (sidebar card) have landed. Do NOT restart the dev servers, kill tmux windows, run `install-hooks.sh`, or edit `~/.claude/settings.json`.

Source under test:
- `frontend/src/components/AddTaskForm.tsx`: `handleSubmit` derives `projectScoped = scope === 'project' && projectId != null`, builds `opts` from it, and after `await addTask(trimmed, opts)` calls `saveLastPayload(agentId, { text: trimmed, ts: new Date().toISOString(), source: 'add-task' })` when `!projectScoped`. Never in the `catch`.
- `frontend/src/lib/lastPayload.ts` (TASK-0224, read-only here): `saveLastPayload(agentId: number, entry): boolean` guards every storage access with try/catch; newest `ts` wins.
- `frontend/src/components/AddTaskForm.test.tsx`: 10 tests. The first 6 (describe `AddTaskForm last-payload recording`, mocked store) were written by the TASK-0223 tackle; the last 4 (describe `AddTaskForm with the real last-payload store (UAT-0223)`, real store over jsdom `localStorage`) were added by this generation run.
- `frontend/src/lib/lastPayload.test.ts`: 47 tests, unchanged by this run (store-level newest-wins and storage-failure rules).

Coverage note: every case except UAT-INT-002 is unit-backed by a file-scoped command that was run at generation time (all passing: AddTaskForm 10/10, lastPayload 47/47, eslint clean, no `AddTaskForm` lines in `tsc --noEmit` output). UAT-INT-002 is `[DEFERRED-TO-UAT manual]` and was NOT performed at generation time.

Why project-scoped submits record nothing: a project-scoped task is run by whichever project agent pops it first, so it is not necessarily this agent's payload; and the form can never create a global (unscoped) task, so there is no third case to record.

---

## Test Cases

### UAT-EDGE-001: A queued agent-scoped submit records the trimmed text with source 'add-task' and a numeric agentId
- **Scenario**: `addTask` resolves `{ task, dispatched: false }` (HTTP 201, queued). The form is rendered for `agentId={7}`; the user types `'do it'` (and in a second test `'   padded text \n'`) and clicks Add.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `saveLastPayload` is called exactly once with `(7, { text: 'do it', ts: <ISO string>, source: 'add-task' })` where `7` is a number (not `'7'`); `addTask` was called with `('do it', { agentId: 7 })`; `onAdded` was called with the queued task. For the padded input the recorded text is `'padded text'` (trimmed, exactly what was sent to the server), not the raw textarea value. `Tests  2 passed`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddTaskForm.test.tsx` (tests `records the trimmed text after a queued agent-scoped submit` and `records the trimmed text, not the raw textarea value`, written by the TASK-0223 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AddTaskForm.test.tsx -t "queued agent-scoped submit|trimmed text, not the raw"` — verified: 2 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: A dispatched (fast path) submit records too, without calling onAdded
- **Scenario**: `addTask` resolves `{ task: null, dispatched: true }` (HTTP 200: idle agent, empty queue, typed straight into the pane).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `saveLastPayload` is called exactly once with `(7, { text: 'run now', ts: <ISO string>, source: 'add-task' })`; `onAdded` is NOT called (no queued task object exists). `Tests  1 passed`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddTaskForm.test.tsx` (test `records after a dispatched (fast path) submit without calling onAdded`, written by the TASK-0223 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AddTaskForm.test.tsx -t "dispatched"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: A failed submit records nothing and shows the error
- **Scenario**: `addTask` rejects with `Error('server down')`. The recording call sits after `await addTask(...)` inside the `try`, never in the `catch`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: the inline error line shows `server down`; `saveLastPayload` is never called. `Tests  1 passed`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddTaskForm.test.tsx` (test `records nothing and shows the error when the submit fails`, written by the TASK-0223 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AddTaskForm.test.tsx -t "shows the error when the submit fails"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: A project-scoped submit records nothing; switching back to agent scope records
- **Scenario**: Render with `projectId={3} projectName="proj"`, click the `proj (project)` pill, submit `'project task'`; then click `this agent (local)` and submit `'agent task'`. Project-scoped tasks are not bound to this agent (whichever project agent pops it first runs it), and the form cannot create global tasks, so nothing is attributable to this agent.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: the first submit calls `addTask('project task', { projectId: 3 })` and `saveLastPayload` is NOT called; the second calls `addTask('agent task', { agentId: 7 })` and `saveLastPayload` is called exactly once with `(7, { text: 'agent task', ts: <ISO string>, source: 'add-task' })`. `Tests  1 passed`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddTaskForm.test.tsx` (test `records only for the agent scope when a project scope is available`, written by the TASK-0223 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AddTaskForm.test.tsx -t "records only for the agent scope"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-005: Empty or whitespace-only input records nothing
- **Scenario**: Fresh form (empty textarea), then a textarea containing only `'   '`. The Add button is disabled in both states; clicking it is a no-op; `handleSubmit` also returns early on an empty trimmed value.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: the `Add task` button is disabled in both states; neither `addTask` nor `saveLastPayload` is called. `Tests  1 passed`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddTaskForm.test.tsx` (test `disables Add and records nothing for empty or whitespace-only input`, written by the TASK-0223 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AddTaskForm.test.tsx -t "disables Add and records nothing"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-006: The persisted record has the {text, ts, source} shape, an ISO-8601 ts, and a numeric-agentId key
- **Scenario**: Exercise the REAL store (no mock) through the form: submit `'  persisted text \n'` for `agentId={7}` and read `localStorage` directly.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `localStorage['conductor:lastPayload:7']` parses to `{ text: 'persisted text', ts, source: 'add-task' }`; `new Date(ts).toISOString() === ts` (canonical ISO-8601 UTC, so the comparison with the hook's `new Date().toISOString()` sidecar value is apples to apples); `loadLastPayload(7)?.text === 'persisted text'`. `Tests  1 passed`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddTaskForm.test.tsx` (test `persists {text, ts, source} under conductor:lastPayload:<numeric agentId> with an ISO ts`, added by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AddTaskForm.test.tsx -t "persists"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-007: Newest timestamp wins between an Add Task record and a later hook value
- **Scenario**: The form records `'typed in box'` (`source: 'add-task'`, ts `T`). Then the store receives a hook entry with ts `T - 60s` (stale) and afterwards one with ts `T + 60s` (the hook's re-delivery when the queue dispatches the same text). No special casing exists in `AddTaskForm`; reconciliation is the store's newest-ts-wins rule (TASK-0224 / TASK-0220 rule a).
- **Steps**:
  1. Run the unit test command below (form-level interplay plus the store-level newest-wins suite).
- **Expected Result**: the stale hook save returns `false` and the stored text stays `'typed in box'`; the newer hook save returns `true` and `loadLastPayload(7)` equals `{ text: 'hook echo', ts: <T+60s>, source: 'hook' }`. Store-level: `replaces an earlier entry with a later one`, `rejects an earlier ts and leaves the stored value unchanged`, `compares parsed epoch ms, not strings` pass. `Tests  1 passed` in the first command, `Tests  3 passed` in the second.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddTaskForm.test.tsx` (test `a later hook value replaces the add-task value; an older hook value does not`, added by this generation run) and `frontend/src/lib/lastPayload.test.ts` (describe `newest ts wins`, written by TASK-0224; unchanged)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AddTaskForm.test.tsx src/lib/lastPayload.test.ts -t "a later hook value replaces|replaces an earlier entry|rejects an earlier ts|compares parsed epoch ms"` — verified: 4 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-001: Recording is independent of where AddTaskForm is mounted (TASK-0200 may relocate it)
- **Scenario**: TASK-0200 (`todo`) may move `AddTaskForm` from the Queued tasks tab into `LogTail`'s bottom bar or a no-window fallback. The recording lives entirely in `AddTaskForm.handleSubmit` and keys off the `agentId` prop only. Mount the form under arbitrary wrapper elements for `agentId={12}` while agent 7 has no payload.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: submitting `'from a relocated mount'` calls `addTask('from a relocated mount', { agentId: 12 })`; `loadLastPayload(12)?.text === 'from a relocated mount'`; `loadLastPayload(7)` is `null` (no cross-agent leakage; no `AgentList`, `LogTail` or tab context needed). `Tests  1 passed`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddTaskForm.test.tsx` (test `records only under the submitting form agentId regardless of what else is mounted`, added by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AddTaskForm.test.tsx -t "regardless of what else is mounted"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-008: A storage failure adds no console noise and does not turn a successful submit into an error
- **Scenario**: `Storage.prototype.setItem` throws `Error('quota')` after the text is typed (so the draft write has already happened) and before Add is clicked. `saveLastPayload` guards storage, so `AddTaskForm` has no second try/catch. Console `error` and `warn` are spied.
- **Steps**:
  1. Run the unit test command below (form-level plus store-level storage-failure tests).
- **Expected Result**: `onAdded` is still called with the queued task; no `quota` text is rendered in the form; `console.error` and `console.warn` are never called; `loadLastPayload(7)` is `null` (nothing persisted). Store-level: `degrades silently when storage throws` and `returns false and does not throw when setItem throws` pass. `Tests  1 passed` in the form test, `Tests  2 passed` in the store tests (3 total).
- **Repeatable Unit Test**: Created: `frontend/src/components/AddTaskForm.test.tsx` (test `a storage failure adds no console noise and does not turn a successful submit into an error`, added by this generation run) and `frontend/src/lib/lastPayload.test.ts` (unchanged)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AddTaskForm.test.tsx src/lib/lastPayload.test.ts -t "a storage failure adds no console noise|degrades silently when storage throws|returns false and does not throw when setItem throws"` — verified: 3 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-009: Static gates scoped to TASK-0223's own files are clean and the whole test file passes
- **Scenario**: The implementation touched only `AddTaskForm.tsx` and the new `AddTaskForm.test.tsx`; lint, typecheck (filtered to these two files, see the concurrency caveat in Prerequisites) and the full test file must be clean.
- **Steps**:
  1. Run the unit test command below (the whole file).
  2. Run `cd frontend && npx eslint src/components/AddTaskForm.tsx src/components/AddTaskForm.test.tsx`.
  3. Run `cd frontend && npx tsc --noEmit 2>&1 | grep AddTaskForm`.
- **Expected Result**: vitest reports `Tests  10 passed (10)`; eslint prints nothing and exits 0; the tsc-plus-grep pipeline prints nothing (errors elsewhere, for example in `AgentList.tsx` or `BackgroundProcessesTab.tsx`, are out of scope for this task).
- **Repeatable Unit Test**: Created: `frontend/src/components/AddTaskForm.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AddTaskForm.test.tsx` — verified: 10 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-002: [DEFERRED-TO-UAT manual] Live dashboard: submit a real task, reload, see it in the strip and card
- **Page**: `http://localhost:4321/` (agents page)
- **Description**: Live-fleet verification of the Add Task half of ROADMAP-0027's "inputs counted". NOT performed at generation time and must not be performed by an autonomous agent. Requires TASK-0226 (detail-pane strip) and TASK-0227 (sidebar card) to have landed; until then only step 3's storage check is possible.
- **Steps**:
  1. With the dashboard running, open an agent's detail pane and submit a real task from its Add Task box (for example `echo uat-0223-marker`).
  2. Observe the detail-pane last-payload strip and the sidebar card for that agent.
  3. In devtools, Application > Local Storage, inspect `conductor:lastPayload:<agent id>`.
  4. Reload the page.
  5. If the agent's row offers a project scope, switch to the `<project> (project)` pill and submit a different task; observe the strip and card again.
- **Expected Result**: after step 1 the strip and card show `echo uat-0223-marker`; the storage value is `{"text":"echo uat-0223-marker","ts":"<ISO>","source":"add-task"}` (or a later `hook` value once the hook echo lands); after the reload (step 4) the same text is still shown; after the project-scoped submit (step 5) the shown payload does NOT change.
- **Repeatable Unit Test**: Not applicable: live browser, real host-server and hook round trip; the recording logic itself is covered by UAT-EDGE-001 through UAT-EDGE-008.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (live dashboard, real host-server and hook round trip; no browser automation in headless mode)] <!-- 2026-09-20 -->

---
