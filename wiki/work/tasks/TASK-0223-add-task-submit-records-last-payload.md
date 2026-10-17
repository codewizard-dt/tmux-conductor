---
id: TASK-0223
aliases: [TASK-0223]
title: "Record Add Task box submissions in the per-agent last-payload store at submit time"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0224]
blocks: []
parallel_safe_with: []
uat: "[[UAT-0223]]"
tags: [agents, dashboard, frontend, add-task, last-payload]
---

# TASK-0223 — Record Add Task box submissions in the per-agent last-payload store at submit time

relates_to::[[hook-authoritative-last-prompt]]
relates_to::[[last-user-message-capture]]
depends_on::[[TASK-0224]]

> **Roadmap**: ROADMAP-0027 Phase 2, item 3. Research: `raw/research/last-user-message-capture/index.md`, `raw/research/terminal-typed-command-persistence/index.md`.
> **Collision note**: edits `frontend/src/components/AddTaskForm.tsx`, the same file TASK-0200 (`todo`) edits (adds a `className` prop and rewrites two comments). The two hunks are in different regions (props/root `<div>` vs. the `handleSubmit` success path), but sequence them rather than running them concurrently. Does NOT touch `AgentList.tsx`.

## Objective

When the user submits the Add Task box for an agent, remember that text as the agent's "last payload" in the browser's per-agent store (`frontend/src/lib/lastPayload.ts`, built by TASK-0224) so the detail-pane strip and sidebar card can show it even before, or without, a `UserPromptSubmit` hook round-trip. This is the Add Task half of the roadmap's "inputs counted" (Direct Input via the hook, queue dispatch via the hook, Add Task box at submit time). Only successful, agent-scoped submits are recorded.

## Approach

**What `AddTaskForm` does today (verified with Serena; line numbers drift, so locate by symbol):**

- `AddTaskForm({ agentId, onAdded, projectId, projectName })` in `frontend/src/components/AddTaskForm.tsx`. `agentId` is a **required** prop (a `number`; the draft key is `conductor:taskDraft:${agentId.toString()}`), so the form always knows which agent it is mounted for.
- It has a local `scope` state, `'agent' | 'project'`. The scope pills render only when `projectId` and `projectName` are both set. In `handleSubmit`, `opts = (scope === 'project' && projectId != null) ? { projectId } : { agentId }`, then `await addTask(trimmed, opts)` (`frontend/src/lib/api.ts` `addTask`). It can never submit a global (unscoped) task.
- `addTask` resolves to `{ task: null, dispatched: true }` on HTTP 200 (idle agent, empty queue: TASK-011 fast path, typed straight into the pane) or `{ task, dispatched: false }` on 201 (queued). It throws on non-OK, which `handleSubmit` catches and shows in the inline error line.

**Decisions:**

1. **Record only when `scope !== 'project'` (i.e. the request went out with `{ agentId }`).** A project-scoped task is not bound to this agent: whichever project agent pops it first runs it, so attributing it to the agent whose form was open would show a payload that agent may never receive. Global tasks cannot be created from this form at all, so there is nothing to record for them. Both cases are documented with a code comment at the call site.
2. **Record on both success shapes** (`dispatched: true` and queued): the roadmap's contract is "Add Task box submissions in the same per-agent store at submit time". For the queued case the agent has not received the text yet; the hook will later deliver the same text with a newer `ts` when the queue dispatches it, and the store's newest-`ts`-wins rule (TASK-0224) reconciles the two with no special casing here.
3. **Record after `await addTask(...)` resolves and before/independent of the `dispatched` branching, never in the `catch`.** A failed submit records nothing. The text recorded is `trimmed` (exactly what was sent to the server), not the raw textarea value.
4. **Use TASK-0224's API as designed; do not edit `lastPayload.ts`.** Call `saveLastPayload(agentId, { text: trimmed, ts: new Date().toISOString(), source: 'add-task' })`. `ts` is an ISO-8601 string to match the hook's `new Date().toISOString()` sidecar value, so the newest-timestamp comparison is apples to apples. Length cap and secret handling are storage rules owned by the Phase 1 decision task and by `saveLastPayload` itself; this task passes the trimmed text through verbatim. `saveLastPayload` is specified to wrap every `localStorage` access in try/catch, so a storage failure cannot surface as a submit error (do not add a second try/catch around it unless TASK-0224 ships it able to throw; check its final signature, including the `agentId` type, before wiring).
5. **Independent of where the form is mounted.** TASK-0200 (`todo`) relocates `AddTaskForm` from the Queued tasks tab into `LogTail`'s bottom bar through a new `taskInput` slot (and adds a no-window fallback instance under `Create window`). The recording lives inside `AddTaskForm.handleSubmit` and keys off the `agentId` prop only: it does not depend on `AgentList.tsx`, `LogTail`, tab visibility or the slot, and it needs no prop threading. Whichever mount (Queued tab today, terminal bar or no-window fallback after TASK-0200) submits, the same code path records. This task neither depends on nor blocks TASK-0200.
6. **No test file exists for `AddTaskForm` today** (only `AgentList.test.tsx` asserts on its rendering), so the tests are a new `frontend/src/components/AddTaskForm.test.tsx`, modelled on `TaskList.test.tsx` (vitest + `@testing-library/react`, `vi.mock('../lib/api', ...)`).

## Steps

### 1. Wire the recording into handleSubmit  <!-- agent: general-purpose -->

- [x] Confirm TASK-0224 has landed: `frontend/src/lib/lastPayload.ts` exists and exports `saveLastPayload` (check its parameter types, especially `agentId` and the payload shape `{ text, ts, source }`). If it has not landed, stop and report; do not create or edit that file here.
- [x] `frontend/src/components/AddTaskForm.tsx`: add `import { saveLastPayload } from '../lib/lastPayload'` next to the existing `../lib/api` import.
- [x] In `AddTaskForm`'s `handleSubmit`, inside the `try` block immediately after `const result = await addTask(trimmed, opts)` (the line before `setValue('')`), add:
  ```ts
  // Agent-scoped submits only. A project-scoped task is run by whichever project
  // agent pops it first, so it is not this agent's payload; the form cannot create
  // global tasks. The hook later re-delivers the same text with a newer ts, and the
  // store's newest-ts-wins rule reconciles the two.
  if (!('projectId' in opts)) {
    saveLastPayload(agentId, { text: trimmed, ts: new Date().toISOString(), source: 'add-task' })
  }
  ```
  Use whatever discriminator reads cleanest against the existing `opts` expression (for example a local `const agentScoped = !(scope === 'project' && projectId != null)` reused to build `opts`), keeping behaviour identical for the request itself.
- [x] Do not add the call to the `catch` block or before `await addTask`, and do not change the draft-clearing, `dispatched` or `onAdded` logic.

### 2. Tests  <!-- agent: general-purpose -->

- [x] Create `frontend/src/components/AddTaskForm.test.tsx` (`afterEach(cleanup)`, `vi.mock('../lib/api', () => ({ addTask: vi.fn(), uploadImageForPath: vi.fn() }))`, and `vi.mock('../lib/lastPayload', () => ({ saveLastPayload: vi.fn() }))`; reset mocks between tests). Render `<AddTaskForm agentId={7} onAdded={vi.fn()} />` and drive it with `fireEvent.change` on `getByLabelText('New task text')` then `fireEvent.click(getByRole('button', { name: 'Add task' }))` (use `waitFor` for the async submit). Cases:
  - (a) queued success (`addTask` resolves `{ task: {...}, dispatched: false }`): `saveLastPayload` called once with `(7, { text: <trimmed input>, ts: <ISO string>, source: 'add-task' })` (assert `ts` with `expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)` or `vi.useFakeTimers`/`setSystemTime` for an exact value) and `onAdded` called.
  - (b) dispatched success (`{ task: null, dispatched: true }`): `saveLastPayload` called once with the same shape; `onAdded` not called.
  - (c) surrounding whitespace is trimmed in the recorded text.
  - (d) failed submit (`addTask` rejects): `saveLastPayload` NOT called and the error text is shown.
  - (e) project scope: render with `projectId={3} projectName="proj"`, click the `proj (project)` pill, submit: `addTask` called with `{ projectId: 3 }` and `saveLastPayload` NOT called; then click `this agent (local)` and submit: `addTask` called with `{ agentId: 7 }` and `saveLastPayload` called.
  - (f) empty/whitespace-only input: the `Add` button is disabled and neither `addTask` nor `saveLastPayload` is called.
- [x] Run `cd frontend && npx vitest run src/components/AddTaskForm.test.tsx src/components/AgentList.test.tsx`, then the frontend typecheck and lint (`global/typecheck-command` Serena memory; `npm run lint`). `AgentList.test.tsx` must still pass unmodified (it renders the real `AddTaskForm`; if it does not mock `lastPayload`, `saveLastPayload` runs against jsdom `localStorage`, which is fine).

### 3. Verify  <!-- agent: general-purpose -->

- [x] Automated checks from Step 2 are green.
- [ ] [DEFERRED-TO-UAT] Live-fleet check, performed by a human: with the dashboard running, submit a task from an agent's Add Task box and confirm the strip and sidebar card show that text (once the display tasks in ROADMAP-0027 Phase 3 have landed), that it survives a page reload, and that a project-scoped submit does not change the shown payload. An autonomous agent must not perform this step (see Notes).

## Files expected to be touched

- `frontend/src/components/AddTaskForm.tsx` (edit)
- `frontend/src/components/AddTaskForm.test.tsx` (new)

Must NOT touch: `frontend/src/lib/lastPayload.ts` (TASK-0224), `frontend/src/components/AgentList.tsx`, `frontend/src/components/LogTail.tsx`.

## Dependencies

- **depends_on** TASK-0224 (builds `frontend/src/lib/lastPayload.ts` with `saveLastPayload`; this task uses its API as designed and cannot compile without it).
- Not blocking anything. **Not parallel-safe with TASK-0200** (same file, `AddTaskForm.tsx`; different regions, but sequence to avoid edit races). No overlap with the host-server/hook tasks (TASK-0221, TASK-0222).

## Notes

Guardrails for whoever implements this:

- Never run `install-hooks.sh` against the real `~/.claude` and never edit `~/.claude/settings.json`.
- Never kill or restart tmux windows/sessions or the running host-server/dev servers; the dev servers hot-reload, and other agents edit this repo concurrently.
- Live-fleet verification is a documented UAT step for a human (Step 3), not something an autonomous agent performs.
- Other agents edit the repo concurrently: re-read `AddTaskForm.tsx` immediately before editing, since TASK-0200 may have changed the props and root element.

## Implementation notes (2026-09-20)

<!-- Updated: 2026-09-20 -->

- `saveLastPayload(agentId: number, entry)` from TASK-0224 exists (returns boolean; wraps storage in try/catch, so no extra try/catch at the call site).
- `AddTaskForm.handleSubmit` now derives `const projectScoped = scope === 'project' && projectId != null`, builds `opts` from it (request unchanged), and calls `saveLastPayload(agentId, { text: trimmed, ts: new Date().toISOString(), source: 'add-task' })` right after `await addTask(...)` when `!projectScoped`. Never in the `catch`. Project-scoped submits are skipped because whichever project agent pops the task runs it, so it is not this agent's payload; the form cannot create global tasks.
- New `frontend/src/components/AddTaskForm.test.tsx` (6 cases a-f) passes; eslint clean on both files; `AgentList.test.tsx` passed unmodified (202/202 together) on the first run.
- Caveat: later `tsc --noEmit` and `AgentList.test.tsx` runs failed only in `AgentList.tsx` / `BackgroundProcessesTab.tsx` (another agent's in-flight bg-restart edits, e.g. `BgRestartButton` undefined); neither file was touched by this task. No AddTaskForm errors.
- Step 3 live-fleet check remains [DEFERRED-TO-UAT] (human).
