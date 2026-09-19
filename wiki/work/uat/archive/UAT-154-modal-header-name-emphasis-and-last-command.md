---
id: UAT-154
aliases: [UAT-154]
title: "UAT: Emphasize agent/project name in the modal header and surface the most recent dispatched command"
status: passed
task: TASK-154
created: 2026-09-13
updated: 2026-09-13
---

# UAT-154 — UAT: Emphasize agent/project name in the modal header and surface the most recent dispatched command

implements::[[TASK-154]]

> **Source task**: [[TASK-154]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] `frontend/` deps installed (`npm install`) so `vitest`/`tsc` are available.
- [ ] For UAT-UI-004 (manual): the dashboard running via `make dev` or `/run`, with at least one agent that can be driven from idle into `busy`/`awaiting` (dispatch a task to it) so `agent.activeTask` is actually populated (`host-server/state.ts`'s `getActiveTask()` returns `null` once the agent goes back to idle).

---

## Test Cases

### UAT-UI-001: Agent name renders larger and in the accent-blue color in the modal header
- **Component**: `AgentDetailModal` header, `frontend/src/components/AgentList.tsx` (name `<span>` at line 787 at generation time — re-locate via Serena `find_symbol`/`search_for_pattern` if it has moved; `AgentDetailModal` and `AgentActionsMenu`-related tasks TASK-148/150/152 are concurrently editing this same file per TASK-154's own Concurrency note)
- **Description**: Per TASK-154 Step 1, the agent-name span's className changed from `text-[15px] font-semibold tracking-tight text-ink leading-tight` to `text-[17px] font-semibold tracking-tight text-accent-blue leading-tight`. This verifies the rendered span carries the new size and color classes, scoped to the modal (not the agent card, which keeps its own separate, unchanged `text-[13px] text-ink` name span).
- **Steps**:
  1. Render `<AgentList />` with a stubbed `fetch`/`EventSource` and one agent, then open its detail modal (click the agent card).
  2. Within the modal dialog (`role="dialog"`, scoped via `within(dialog)`), locate the span containing the agent's name text.
  3. Assert its `className` contains `text-[17px]` and `text-accent-blue`.
- **Expected Result**: The modal header's agent-name text renders at 17px in the `text-accent-blue` color (up from the prior 15px `text-ink`). The `agent.label` secondary span, when present, is unaffected.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentDetailModal header emphasis and last-command row (TASK-154)')`, `it('renders the agent name at 17px in the accent-blue color inside the modal header')`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-002: Modal header's ProjectBadge renders at the md (15px) size while the agent-card badge stays at the default sm (13px) size
- **Component**: `ProjectBadge`, `frontend/src/components/AgentList.tsx` (component ~line 265 at generation time; modal call site ~line 792 passing `size="md"`; agent-card call site inside `AgentItem` ~line 1038 with no `size` prop, i.e. implicit `'sm'`)
- **Description**: Per TASK-154 Step 2, `ProjectBadge` gained an optional `size?: 'sm' | 'md'` prop (default `'sm'`), rendering `text-[13px]` for `'sm'` and `text-[15px]` for `'md'`. Only the modal header call site passes `size="md"`; every other call site (including the agent card) is unchanged. This verifies both call sites render the correct, distinct size class in the same page at the same time.
- **Steps**:
  1. Render `<AgentList />` with a stubbed `fetch`/`EventSource`, one agent with no project assigned, and open its detail modal.
  2. Within the modal dialog, locate the `ProjectBadge` (`title="No project assigned"`) and assert its `className` contains `text-[15px]` and not `text-[13px]`.
  3. Outside the dialog, within the RTL render root (the agent card, not the portaled modal), locate that same agent's card `ProjectBadge` and assert its `className` contains `text-[13px]` and not `text-[15px]`.
- **Expected Result**: The modal header's project pill reads visibly larger (15px) than the same project's pill on the agent card (13px, unchanged default), in the same render pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentDetailModal header emphasis and last-command row (TASK-154)')`, `it('renders the modal header ProjectBadge at the md (15px) size while the card badge stays at the default sm (13px) size')`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-003: Most-recent-dispatched-command row appears directly under the header when `agent.activeTask` is set
- **Component**: `AgentDetailModal`, `frontend/src/components/AgentList.tsx` (new conditional row ~line 866 at generation time, immediately after the header `<div>` closes and before the `renameError ?? closeError ?? removeError ?? cloneError` banner)
- **Description**: Per TASK-154 Step 3, a new row renders `agent.activeTask` (reusing the existing field exactly as-is, populated only while `busy`/`awaiting`/`stalled` per `host-server/state.ts`'s `getActiveTask()`) in a neutral/monospace style, mirroring the existing error-banner row's layout classes (`flex-shrink-0 border-b border-line ... px-5 py-1.5 text-[11px]`) but without the red error treatment.
- **Steps**:
  1. Render `<AgentList />` with a stubbed `fetch`/`EventSource` and an agent whose `activeTask` is set to a command string (e.g. `"npm run build"`), then open its detail modal.
  2. Within the dialog, locate the element with `title="npm run build"`.
  3. Assert it renders the command text and its `className` contains `font-mono` and `text-[11px]`.
- **Expected Result**: The row appears immediately below the header, showing the exact `activeTask` string, styled as informational (monospace, muted) rather than as an error.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentDetailModal header emphasis and last-command row (TASK-154)')`, `it('shows the most-recent-dispatched-command row directly under the header when agent.activeTask is set')`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-001: No most-recent-command row renders when `agent.activeTask` is null
- **Scenario**: `agent.activeTask` is `null` — the field's existing idle-nulls-it-out behavior (unchanged by this task; `getActiveTask()` returns `null` once the agent is idle). The new row must not render at all in this case, matching the agent card's existing conditional use of the same field.
- **Steps**:
  1. Render `<AgentList />` with a stubbed `fetch`/`EventSource` and an agent whose `activeTask` is `null`, then open its detail modal.
  2. Within the dialog, assert no element with `title="npm run build"` (or any command text) exists.
- **Expected Result**: The row is entirely absent from the DOM (not merely empty/hidden) when there is no active task, identical to the field's behavior on the agent card.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentDetailModal header emphasis and last-command row (TASK-154)')`, `it('renders no most-recent-command row when agent.activeTask is null')`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-004: Manual visual/interaction verification in the running dashboard
- **Page**: Dashboard `AgentDetailModal` (click any agent card in the running app to open it)
- **Description**: End-to-end confirmation, against a real running host-server and a real agent transitioning between idle and busy/awaiting, that the header emphasis and the last-command row look and behave correctly in the browser — the runtime check TASK-154 Step 4 explicitly deferred to UAT (`[DEFERRED-TO-UAT]`) rather than covering in the static-gates tackle cycle.
- **Steps**:
  1. Start the app (`make dev` or `/run`).
  2. Open an agent's detail modal. Confirm the agent name reads visibly larger and in the blue accent color compared to the rest of the header text.
  3. Confirm the project pill in the modal header reads larger than the same project's pill on that agent's card (open the modal and compare against the card behind it, or close and reopen to compare side by side).
  4. Dispatch a command to that agent (or add it to the queue while idle so it picks it up) so it becomes `busy` or `awaiting`. With the modal open, confirm a new row appears directly under the header showing the dispatched command text, in a neutral monospace style (not red/error-styled).
  5. Wait for the agent to return to `idle` (or trigger completion). Confirm the command row disappears once idle.
- **Expected Result**: All three visual/behavioral changes (name emphasis, project-pill size bump, transient command row) are confirmed in a real browser against real backend state, matching UAT-UI-001/002/003 and UAT-EDGE-001's jsdom-level assertions.
- **Repeatable Unit Test**: Not applicable: requires a real running host-server, a real tmux agent transitioning `idle` → `busy`/`awaiting` → `idle`, an actual browser render, and human visual confirmation of color/size — outside what a jsdom component test can assert; the underlying render logic is already unit-covered by UAT-UI-001/002/003 and UAT-EDGE-001.
- [x] Pass <!-- 2026-09-13: Live-verified via Playwright against a disposable clone (cryptwiz-1-copy, POST /agents/:id/clone off cryptwiz-1, deleted afterward). Header name-emphasis and ProjectBadge sizing already confirmed via UAT-UI-001/002's jsdom evidence and visually consistent in the live modal header. Dispatched a harmless no-op task ("reply with exactly \"ack\", take no other action") via the dashboard's Queued Tasks add-task form — agent went busy, a new row appeared directly under the header showing the exact dispatched command text in a neutral (non-error) style, agent replied "ack" and returned to idle within ~1s, and the command row then disappeared entirely from the modal — matching the jsdom UAT-UI-003/UAT-EDGE-001 contract live. No side effects: the dispatched instruction was explicitly a no-op and the agent complied exactly. -->

---

## Gaps

None. Every planned case was backed by the actual `AgentDetailModal`/`ProjectBadge` source in `frontend/src/components/AgentList.tsx` as it stands at generation time (name span, `ProjectBadge` size prop and both call sites, and the new `activeTask` row all located and read directly via Serena before writing these cases). Line numbers are called out as "at generation time" per TASK-154's own Concurrency note — TASK-148/150/152 are concurrently editing this same file, so re-locate via Serena rather than trusting them verbatim on a later run.
