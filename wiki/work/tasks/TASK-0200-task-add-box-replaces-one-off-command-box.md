---
id: TASK-0200
aliases: [TASK-0200]
title: "Replace the terminal's one-off command box with the Add Task box"
status: pending-uat
created: 2026-09-19
updated: 2026-09-19
depends_on: []
blocks: []
parallel_safe_with: []
uat: ""
tags: [frontend, agents-page, terminal, task-queue]
---

# TASK-0200 — Replace the terminal's one-off command box with the Add Task box

relates_to::[[log-tail]]

## Objective

The Terminal tab of the agent detail view ends in a bottom bar built by `frontend/src/components/LogTail.tsx`: a "Send one-off text commands to <agent>…" textarea, a `Send` button (which types the text straight into the tmux pane via `enqueue({ text, enter: true })` → `POST /agents/:id/keys`), and the `Direct Input` toggle. Replace the one-off textarea + `Send` button with the existing Add Task box (`AddTaskForm`, "New task…" / `Add`), so that section now adds a task to the queue instead of typing one-off text into the pane. The `Direct Input` toggle stays. The Add Task box moves out of the "Queued tasks" tab (it is relocated, not duplicated); that tab keeps the `TaskList`.

## Approach

**Where the pieces are today (Serena investigation):**

- One-off box: `LogTail.tsx` (~L777-819) — `<form onSubmit={handleSendSubmit}>` holding `sendTextareaRef` textarea, `Send` button and the `Direct Input` toggle, gated on `windowPresent && viewMode === 'live'`. Supporting code: `sendText` state (L181-184, draft in `localStorage` `conductor:sendDraft:<agentId>`), `sendTextareaRef` (L211), the auto-size `useEffect` (L280-287) and `handleSendSubmit` (L641-647). `sendError` / `enqueue` / `sendAgentKeys` are shared with Direct Input keystrokes and paste and MUST stay.
- Add Task box: `frontend/src/components/AddTaskForm.tsx` (props `agentId`, `onAdded`, `projectId`, `projectName`; posts via `addTask(trimmed, { agentId } | { projectId })` from `frontend/src/lib/api.ts`; draft in `conductor:taskDraft:<agentId>`; image drag/paste via `uploadImageForPath`). It is rendered in `AgentDetailView` (`frontend/src/components/AgentList.tsx` ~L969-970) inside the `queued-tasks` tab, right below `<TaskList>`. `LogTail` has one production consumer only (the Terminal tab, ~L858).
- Backend needs no change: `POST /tasks` already returns 200 + `dispatched` when the agent is idle with an empty queue (TASK-011 fast path), which preserves the "run this now" outcome the one-off box gave for idle agents.

**Design:** `LogTail` gains an optional `taskInput?: ReactNode` slot prop. It renders the slot in the position the one-off textarea + `Send` occupied, followed by the `Direct Input` toggle. `AgentDetailView` passes `<AddTaskForm …/>` (it already owns `tasks`/`setTasks`, `projectId`, `project`). The outer `<form>` in LogTail becomes a plain `<div>` (AddTaskForm has its own `<form>`; nested forms are invalid). `AddTaskForm` gets an optional `className` prop (default `mt-2`, unchanged for other callers) so the slot can pass `min-w-0 flex-1`. All one-off state/handler code in `LogTail` is deleted.

### Assumptions (no user available — review these)

1. **Literal reading chosen.** "The 'one-off' command text box should be replaced by the task add text box" = the Terminal tab's bottom bar textarea is swapped for `AddTaskForm`. "Adding a task should replace the bottom section with the one-off commands" is read as the same statement restated: that bottom section (previously one-off commands) is now task-add. **Alternative reading not implemented:** a mode toggle in the bottom bar that switches between one-off and task-add, or task-add appearing in addition to the one-off box.
2. **Relocate, do not duplicate.** `AddTaskForm` is removed from the "Queued tasks" tab (which keeps `TaskList`) so there is a single instance. Alternative: keep it in both places.
3. **Immediate one-off typing is intentionally dropped.** After this task the only way to type text straight into a busy agent's pane is Direct Input itself (or the TASK-011 fast path when the agent is idle with an empty queue). No replacement "send now" control is added.
4. **Visibility parity.** The slot shows under the same condition the one-off box did: `windowPresent && viewMode === 'live'` (hidden in History view). The AddTaskForm draft survives the unmount via its `localStorage` key.
5. **No-window agents keep a way to queue.** Because the Queued tab loses its form, the "This agent has no tmux window" fallback in the Terminal tab (`AgentList.tsx` ~L870-881) renders an `AddTaskForm` under the `Create window` button, so an agent without a window can still be queued to.
6. **Placeholder/copy unchanged** ("New task…", `Add`, aria-label "New task text"); project/agent scope pills (`this agent (local)` / `<project> (project)`) render above the input as today.
7. **Orphaned drafts left alone.** Existing `conductor:sendDraft:*` localStorage keys become unused and are not migrated or purged.
8. **Dependencies.** Overlapping active tasks (TASK-0164 LogTail border, TASK-162 tabs, TASK-0180 TaskList/`AddTaskForm` test, TASK-0173/0174/0178 detail pane) are all implemented (`pending-uat`) and already in the tree, so none is a `depends_on`. TASK-0199 (`todo`) also edits `AgentList.tsx`/`AgentList.test.tsx` (role/description menu region, different from the tab content edited here); left out of `parallel_safe_with` to be conservative, so sequence the two rather than running them concurrently. Nothing blocks or is blocked; not attached to a roadmap (ROADMAP-0023 is complete).
9. **UAT wording goes stale.** UAT-162 UI-001 step 4 (and possibly UAT-011 ~L180) describe `AddTaskForm` in the Queued tab; Step 5 below re-words them rather than failing them.

## Steps

### 1. Add the `className` prop to AddTaskForm  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AddTaskForm.tsx`, add `className?: string` to `AddTaskFormProps` and use it for the root `<div>` (`className={className ?? 'mt-2'}`); keep every other behaviour identical.
  - Update the two comments (~L28-37, ~L45-50) that say the textarea can mount inside a hidden Queued Tasks tab: it now mounts in the Terminal tab (and the no-window fallback), while `AgentInfoTabs` still keeps inactive panels mounted `hidden`, so the zero-`scrollHeight` guard and `ResizeObserver` stay as they are.

### 2. Swap the one-off box for a slot in LogTail  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/LogTail.tsx`, add `taskInput?: ReactNode | undefined` to the props object (import `ReactNode` from `react` alongside the existing `KeyboardEvent` import) with a doc comment ("Rendered in the bottom bar in place of the old one-off text box; supplied by AgentDetailView as the Add Task box").
- [x] Replace the bottom `<form onSubmit=… className="mt-1.5 flex items-end gap-1.5">` (~L778-818) with `<div className="mt-1.5 flex items-end gap-1.5">` containing `{taskInput}` followed by the existing `Direct Input` toggle button (unchanged: `onMouseDown` preventDefault, `aria-pressed`, styles). Keep the `windowPresent && viewMode === 'live'` gate.
- [x] Delete the one-off-only code: the `<textarea ref={sendTextareaRef} …>` and `Send` `<button type="submit">`; `handleSendSubmit` (~L641-647); the `sendText`/`setSendText` state (~L181-184); `sendTextareaRef` (~L211); the auto-size `useEffect` (~L280-287). Verify with `find_referencing_symbols`/`search_for_pattern` that nothing else uses `sendText`, `sendTextareaRef` or `conductor:sendDraft`.
- [x] Keep `sendError`, `setSendError`, `enqueue`, `enqueueImageUploads` and the `{sendError && …}` line (~L819): Direct Input keystrokes and paste/drop still use them. Confirm `agentName` is still used (Direct Input banner); do not remove the prop.

### 3. Render AddTaskForm in the terminal bar; remove it from the Queued tab  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx` `AgentDetailView` (`tabs` array), pass `taskInput={<AddTaskForm className="min-w-0 flex-1" agentId={agent.id} onAdded={(task) => { setTasks((prev) => [...prev, task]) }} projectId={projectId} projectName={project} />}` to `<LogTail>` (~L858-867).
- [x] In the same `tabs` array, in the `agent.windowPresent` false fallback (~L870-881), render the same `<AddTaskForm agentId=… />` (default `mt-2` class) below the `Create window` button/`windowError`.
- [x] In the `queued-tasks` tab content (~L965-973), delete the `<AddTaskForm …/>` line; keep `<TaskList agentName={agent.name} tasks={tasks} onReorder={setTasks} projectId={projectId} />` and its wrapper. `AddTaskForm` import stays (still used).

### 4. Update and add tests  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.test.tsx`: extend `MockLogTail` (~L26-37) to accept `taskInput?: ReactNode` and render `{props.taskInput}` inside its `<div data-testid="mock-log-tail">`.
- [x] Rewrite the test `'renders TaskList and AddTaskForm when the Queued Tasks tab is selected'` (~L2687-2699): the Queued tasks tabpanel shows `No tasks in queue.` and contains no `New task text` textbox (`queryByLabelText` null, no `Add task` button).
- [x] Add tests in the same `describe('AgentDetailView tabbed info panel (TASK-157)')` block: (a) the Terminal tabpanel (agent with `windowPresent: true`) contains `getByLabelText('New task text')` and `getByRole('button', { name: 'Add task' })`, and `queryByLabelText(/one-off/i)` is null; (b) with `windowPresent: false` the Terminal tabpanel shows the `Create window` button AND the `New task text` textbox; (c) submitting text through the Terminal-panel box calls `POST /tasks` (assert via the `stubAgentDetailFetch` fetch mock) and the new row appears in the Queued tasks tab list (`fireEvent.change` + click `Add task`, then switch tab).
- [x] `frontend/src/components/LogTail.test.tsx`: add `describe('LogTail task-input slot (TASK-0200)')` reusing the file's `stubFetch()` pattern: rendering `<LogTail agentId agentName taskInput={<textarea aria-label="slot" />} />` shows the slot and the `Direct Input`/`Stop Direct Input` toggle, has no `Send` button and no textbox labelled `Send one-off text commands to …`; clicking the `History` view toggle hides the slot (and `Live` restores it); without `taskInput` the bar renders only the toggle.
- [x] Run `npm test --workspace frontend -- AgentList LogTail TaskList` (or the repo's vitest invocation from `.serena` `suggested_commands`) and the frontend typecheck (`global/typecheck-command` memory); fix any failures.

### 5. Wiki and UAT bookkeeping for the moved control  <!-- agent: general-purpose -->

- [x] `wiki/knowledge/entities/components/log-tail.md` (~L88): revise in place — the send box (`handleSendSubmit`, `conductor:sendDraft`) no longer exists; the bottom bar now hosts the Add Task box via the `taskInput` slot, and `enqueue` is fed only by Direct Input key/paste/image paths.
- [x] `wiki/knowledge/sources/terminal-typed-command-persistence.md` (~L18, L20, L22) and `wiki/knowledge/concepts/keystroke-stream-command-reconstruction.md` (~L20): add a dated note that the "send box records an exact `{text, enter:true}` line" path was removed by TASK-0200 (flag it with a `> **Contradiction:**`-style callout rather than silently rewriting the original claim).
- [x] `wiki/work/uat/UAT-162-details-queued-tasks-into-tabs.md` UI-001 step 4 (~L36): the Queued tasks panel is now `TaskList` only; the Add Task box lives in the Terminal tab bottom bar. Check `wiki/work/uat/UAT-011-immediate-dispatch.md` (~L180) and `UAT-0180-…md` for the same placement wording and adjust.

### 6. Verify in the running dashboard  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] With `make dev` running, open an agent with a live window at `http://localhost:4321`: the Terminal tab's bottom bar shows the "New task…" box + `Add` + `Direct Input`, with no "Send one-off text commands" box; typing a task and pressing Enter/`Add` queues it (visible in the Queued tasks tab, or dispatches immediately for an idle agent with an empty queue); Direct Input typing/paste/image-drop still work; History view hides the bar; an agent with no window can still queue via the fallback box. Record the outcome in the task file.
