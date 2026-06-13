---
id: UAT-012
title: "UAT: Replace tail polling with SSE push for terminal output"
status: pending
task: TASK-012
created: 2026-06-12
updated: 2026-06-12
---

# UAT-012 — UAT: Replace tail polling with SSE push for terminal output

implements::[[TASK-012]]

> **Source task**: [`wiki/work/tasks/TASK-012-sse-tail-stream.md`](../tasks/TASK-012-sse-tail-stream.md)
> **Generated**: 2026-06-12

---

## Prerequisites

- [ ] Backend running on `http://localhost:8788` (`cd backend && npm run dev`)
- [ ] Frontend running on `http://localhost:4321` (`cd frontend && npm run dev`)
- [ ] A live tmux session named `conductor` (from `SESSION_NAME` in `conductor.conf`) with at least one agent window present — start via `scripts/conductor.sh`. The agent name used in the curl tests below is referred to as `$AGENT`; substitute a real agent name from `GET /agents`.
- [ ] `curl` and `jq` available on PATH

---

## Test Cases

### UAT-API-001: One-shot tail backfill returns current pane text
- **Endpoint**: `GET /api/agents/:agent/tail`
- **Description**: Verifies the on-mount backfill endpoint (the single non-SSE fetch `LogTail.tsx` still performs) returns the agent's visible pane output. SSE replaces the *repeated* polling, but this one-shot call must still work.
- **Steps**:
  1. Ensure the `conductor` session has a live agent window; note its name as `$AGENT`.
  2. Run the curl command below (replace `AGENT_NAME` with the real agent name).
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/agents/AGENT_NAME/tail?lines=20' | jq '{agent, lines, windowPresent, hasText: (.text | length > 0)}'
  ```
- **Expected Result**: HTTP 200. JSON body shape `{ agent: "AGENT_NAME", lines: 20, windowPresent: true, text: "<pane output>" }`. `windowPresent` is `true` and `text` is a string of the captured pane content.
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-002: Tail endpoint 404s for an unknown agent
- **Endpoint**: `GET /api/agents/:agent/tail`
- **Description**: The backfill endpoint must reject agents not present in the DB so the frontend surfaces an error rather than a blank stream.
- **Steps**:
  1. Run the curl command with a deliberately nonexistent agent name.
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' 'http://localhost:8788/api/agents/__nope__/tail'
  ```
- **Expected Result**: HTTP `404`. (Body, if inspected, is `{ "error": "agent '__nope__' not found" }`.)
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-003: Tail endpoint reports windowPresent:false for a known agent with no tmux window
- **Endpoint**: `GET /api/agents/:agent/tail`
- **Description**: A registered agent whose tmux window is absent must return `windowPresent: false` and empty text (never error), so the UI shows "Window not present."
- **Steps**:
  1. Identify an agent registered in the DB whose tmux window is NOT currently present (e.g. kill one agent window with `tmux kill-window -t conductor:AGENT_NAME` but keep it in the DB), or use an agent that has exited.
  2. Run the curl command for that agent.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/agents/AGENT_NAME/tail' | jq '{windowPresent, text, lines}'
  ```
- **Expected Result**: HTTP 200. `windowPresent` is `false`, `text` is `""`, `lines` defaults to `20`.
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-004: GET /events stream emits terminal-output events on pane change
- **Endpoint**: `GET /api/events` (SSE)
- **Description**: Core of the task — the backend `tailPollLoop` (200 ms) must broadcast `terminal-output` SSE events carrying the full tail snapshot when a live agent's pane output changes. This is the push that replaces client polling.
- **Steps**:
  1. Ensure at least one live agent is actively producing output (e.g. running a command that prints periodically). If the pane is static, trigger output via `POST /api/agents/AGENT_NAME/keys` or by typing in the pane.
  2. Open the SSE stream with the curl command below; it will print events for ~8 seconds then exit.
- **Command**:
  ```bash
  curl -sS --max-time 8 -H 'Accept: text/event-stream' 'http://localhost:8788/api/events' | grep -E '^(event: terminal-output|data: \{"agent")'
  ```
- **Expected Result**: At least one `event: terminal-output` line appears, each followed by a `data: {"agent":"...","text":"...","lines":100}` line. The `lines` field is `100` (the backend `TAIL_LINES` constant). When the chosen agent's pane is changing, multiple events arrive within the 8 s window (one per change, throttled by the 200 ms loop).
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-005: terminal-output payload carries the full snapshot with the correct agent and 100 lines
- **Endpoint**: `GET /api/events` (SSE)
- **Description**: Verifies the event payload contract: each `terminal-output` event carries a full-snapshot `text` (not a delta), an `agent` field, and `lines: 100`. The frontend replaces its display buffer wholesale on each event, so the payload must be the complete current tail.
- **Steps**:
  1. With a live, output-producing agent present, capture one event payload and inspect its keys.
- **Command**:
  ```bash
  curl -sS --max-time 8 'http://localhost:8788/api/events' | grep -m1 '^data: {"agent"' | sed 's/^data: //' | jq '{agent, lines, textIsString: (.text|type=="string")}'
  ```
- **Expected Result**: JSON object with `agent` (a string naming a live agent), `lines: 100`, and `textIsString: true`. The presence of all three keys confirms the `{ agent, text, lines }` payload shape.
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-006: Identical pane output does not re-broadcast (diff suppression)
- **Endpoint**: `GET /api/events` (SSE)
- **Description**: `tailPollLoop` diffs each capture against `prevTailMap` and only broadcasts on change. A fully static pane must NOT flood the stream every 200 ms — this is the load-reduction guarantee of the task.
- **Steps**:
  1. Ensure the target agent's pane is idle and producing NO new output (e.g. an idle agent waiting at a prompt). Do not interact with it during the test.
  2. Open the SSE stream for ~6 seconds and count `terminal-output` events for that agent.
- **Command**:
  ```bash
  curl -sS --max-time 6 'http://localhost:8788/api/events' | grep -c '^event: terminal-output'
  ```
- **Expected Result**: The count is small and bounded (typically `0` for a fully static pane during the window, not ~30 which 200 ms-per-event without diffing would produce). A truly idle pane yields `0`; if any other agent changes, only those changes appear. The key assertion: the static agent does not emit an event every cycle.
- [x] Pass <!-- 2026-06-12 -->

### UAT-UI-001: Card-view terminal output renders without repeated tail polling
- **Page**: `http://localhost:4321`
- **Description**: With SSE in place, the dashboard must render agent terminal output and update it live, while making NO repeated `GET /agents/:agent/tail` requests (only the one-shot backfill on mount).
- **Steps**:
  1. Open `http://localhost:4321` in a browser with DevTools open on the Network tab.
  2. Clear the Network log, then wait ~15 seconds while a live agent produces output.
  3. Observe the agent card's `<pre>` terminal output region and the Network tab.
- **Expected Result**: The terminal `<pre>` shows the agent's output and updates live as the pane changes. The Network tab shows exactly ONE `GET .../agents/<agent>/tail?lines=...` request per LogTail mount (the backfill) and NO recurring `tail` requests thereafter. The `events` request remains open (pending) for the page lifetime.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-UI-002: terminal-output events drive live updates via the EventSource stream
- **Page**: `http://localhost:4321`
- **Description**: Confirms the `<pre>` updates are driven by SSE `terminal-output` events, not polling.
- **Steps**:
  1. Open `http://localhost:4321` with DevTools → Network → select the `events` request → EventStream / Response tab.
  2. Cause a live agent to print new output (run a command in its pane, or use Direct Input to type).
  3. Watch the EventStream view and the corresponding card's `<pre>`.
- **Expected Result**: `terminal-output` events appear in the EventStream view (~every 200 ms while output changes), and the matching agent card's `<pre>` content updates in lockstep. Events for other agents do not alter this card's output (agent-name filtering works).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-UI-003: Modal detail view updates live with no polling
- **Page**: `http://localhost:4321` → agent detail modal
- **Description**: The modal LogTail (previously polling at 100 ms via `pollMs={100}`) must now update via SSE with the `pollMs` prop removed.
- **Steps**:
  1. On the dashboard, open an agent's detail modal.
  2. With DevTools Network open and filtered to `tail`, watch for ~15 seconds while the agent produces output.
  3. Observe the modal's `<pre>` terminal region.
- **Expected Result**: The modal `<pre>` updates in real time. Exactly one `tail` backfill request fires when the modal mounts; no recurring 100 ms `tail` requests appear. (Source check: `AgentList.tsx` no longer passes `pollMs` to `LogTail`.)
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-UI-004: Direct Input (interact mode) still updates output live via SSE
- **Page**: `http://localhost:4321`
- **Description**: Interact mode is no longer special-cased on the client; keystrokes change pane output, which the 200 ms server loop captures and pushes. Verifies the input path (`POST /agents/:agent/keys`) plus SSE-driven echo still work together.
- **Steps**:
  1. On an agent card or modal, click "Direct Input" to enter interact mode (the orange "Direct Input — keys go to <agent>" banner appears).
  2. Type some visible characters into the agent pane.
  3. Observe the `<pre>` output region.
- **Expected Result**: Typed keystrokes reach the pane (visible in the agent's terminal) and the `<pre>` reflects the new pane content within ~one 200 ms cycle, delivered via a `terminal-output` SSE event (no `tail` polling request is made for the update).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-EDGE-001: Single shared EventSource connection regardless of LogTail count
- **Page**: `http://localhost:4321`
- **Description**: The `useSSE` hook opens ONE module-level, ref-counted EventSource shared by all `terminal-output` subscribers. Many LogTail instances must not open many `/events` connections.
- **Steps**:
  1. Open `http://localhost:4321` with multiple agent cards visible (multiple LogTail instances mounted).
  2. In DevTools → Network, filter to `events` and count requests originating from the shared `useSSE` hook.
- **Expected Result**: There is a single shared `/events` EventSource connection serving all `terminal-output` LogTail subscribers (one connection, not one-per-card). Note: `useAgents.ts` and `AgentList.tsx` retain their own separate legacy EventSource connections — those are out of scope; the assertion is that adding LogTail instances does not add `terminal-output` connections.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-EDGE-002: SSE connection survives idle via heartbeat
- **Endpoint**: `GET /api/events` (SSE)
- **Description**: The existing 15 s heartbeat (`: ping`) keeps the connection alive across idle periods (no `terminal-output` activity), which the task relies on rather than adding new keepalive logic.
- **Steps**:
  1. Open the SSE stream and hold it open for ~20 seconds with no agent activity, capturing comment/heartbeat lines.
- **Command**:
  ```bash
  curl -sS --max-time 20 'http://localhost:8788/api/events' | grep -c '^: ping'
  ```
- **Expected Result**: At least one `: ping` heartbeat line appears within the 20 s window, confirming the connection is held open without depending on `terminal-output` traffic.
- [x] Pass <!-- 2026-06-12 -->

### UAT-EDGE-003: Type-check gate is green (backend + frontend)
- **Scenario**: Static confirmation that the SSE refactor compiles cleanly — the one gate `/tackle` already ran, re-verified here.
- **Steps**: Run both type-checks.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/backend && npx tsc --noEmit && cd ../frontend && npx tsc --noEmit && echo TYPECHECK_OK
  ```
- **Expected Result**: Both type-checks complete with no errors; the command prints `TYPECHECK_OK`.
- [FAIL: auto-judge: frontend tsc failed — 6 errors in AgentList.tsx (Task[] vs string[] mismatch at lines 408-409, 664-665, from concurrent SQLite task-migration work, not the SSE refactor); backend tsc passed; TYPECHECK_OK not printed] <!-- 2026-06-12 -->

---
