---
id: UAT-130
aliases: [UAT-130]
title: "UAT: Dynamic tmux pane sizing from the browser terminal's full-width probe"
status: pending
task: TASK-130
created: 2026-08-15
updated: 2026-08-15
---

# UAT-130 — UAT: Dynamic tmux pane sizing from the browser terminal's full-width probe

implements::[[TASK-130]]

> **Source task**: [[TASK-130]]
> **Generated**: 2026-08-15

> **Why the UI cases are the primary evidence, not the API cases**: the *product* requirement this task exists to satisfy is "the browser terminal fills the panel width instead of wrapping early" — that is a rendering/geometry fact only observable in a real browser against a real tmux session, not something a curl response body can prove on its own. The `POST /api/terminal-size` contract (UAT-API-*/UAT-EDGE-*) is necessary-but-not-sufficient plumbing; UAT-UI-001–004 mirror TASK-130's own Step 5 manual-verification checklist verbatim, since a curl-based check "isn't meaningfully assertable" for this feature per the task's own note.
>
> **Safety note on UAT-API-001 (the happy-path resize)**: `applyGlobalPaneSize` (`host-server/state.ts`) issues `tmux set-option -g window-size manual` / `-g default-size ...` — both **server-wide** tmux options, not scoped to one session. There is no `-L`/`-S` socket-isolation parameter on the function. Running UAT-API-001 for real *will* resize every window of whatever tmux server the host-server's default socket points at, including the live `conductor` session if one is running there — that is the feature working as designed, not a bug, but it means this case must be run deliberately (e.g. during `/uat-walk`), never as an unattended/CI check against a shared session. For the same reason, **UAT-API-001 and UAT-EDGE-002 were not executed at generation time** — only the pure-validation cases (UAT-API-002/003, UAT-EDGE-001), which return before `applyGlobalPaneSize` is ever called, were verified live against the running dev host-server.
>
> **Repeatable unit tests created by this UAT run**: `frontend/src/lib/terminalSizeProbe.test.ts` (3 tests, vi.mock'd `@xterm/xterm`/`@xterm/addon-fit`/`./api` — jsdom lacks `window.matchMedia`, which a real xterm.js `Terminal` needs, so a real `Terminal` was out of scope for this environment without adding a jsdom shim; the guard logic under test only depends on `term.cols`/`term.rows` and the `syncTerminalSize` call, so a minimal stub is faithful to what's actually asserted). Verified: `npx vitest run src/lib/terminalSizeProbe.test.ts` → 3/3 pass; full frontend suite 57/57 pass (54 pre-existing + 3 new); `tsc --noEmit` clean.
>
> **No unit test was created for `applyGlobalPaneSize` itself** (`host-server/state.ts`) — see UAT-API-001's and UAT-EDGE-002's `Repeatable Unit Test: Blocked` notes below for why (the same server-wide `-g` option risk that gates live execution also blocks safe automated testing, and `applyGlobalPaneSize` has no session/socket parameter to sandbox it with).

---

## Prerequisites

- [ ] Host-server running on `http://127.0.0.1:8788` (`make dev` or `npm --prefix host-server run dev`) — required for all UAT-API-*/UAT-EDGE-* cases.
- [ ] Frontend dev server running on `http://localhost:4321` (`make dev`) and at least one agent spawned with a live tmux window — required for all UAT-UI-* cases.
- [ ] Browser DevTools Network tab open and filterable by `terminal-size` — required for UAT-UI-001, UAT-UI-002, UAT-UI-004.
- [ ] Before UAT-API-001: note the current window count of the target tmux session with `tmux list-windows -t conductor | wc -l` (or your `SESSION_NAME` from `conductor.conf` if not the default), since the expected `resizedWindows` value depends on it.
- [ ] Read the safety note above before running UAT-API-001 or UAT-EDGE-002 — both mutate/require a real tmux server's global options.

---

## Test Cases

### UAT-API-002: `POST /api/terminal-size` rejects `cols` outside `[20, 500]`
- **Endpoint**: `POST /api/terminal-size`
- **Description**: Validates the route's `cols` bounds check runs before `applyGlobalPaneSize` is ever called (no tmux side effect).
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/terminal-size' -H 'Content-Type: application/json' -d '{"cols":10,"rows":40}'
  ```
- **Expected Result**: `400` with body `{"error":"cols must be an integer between 20 and 500"}`.
- **Repeatable Unit Test**: Not applicable: Fastify route-level validation in `host-server/index.ts`. This project tests API routes via live curl in UAT (see prior UAT-1xx generations); `index.ts` doesn't export an app factory and no `.inject()`-based route-unit-test harness exists in `host-server` — the live curl above is this project's established repeatable evidence for route behavior.
- [x] Pass <!-- verified live at generation time: 2026-08-15, response body {"error":"cols must be an integer between 20 and 500"} -->

### UAT-API-003: `POST /api/terminal-size` rejects `rows` outside `[10, 200]`
- **Endpoint**: `POST /api/terminal-size`
- **Description**: Validates the route's `rows` bounds check, with `cols` valid so the `rows` branch is actually reached (no tmux side effect either way — the `rows` check also runs before `applyGlobalPaneSize`).
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/terminal-size' -H 'Content-Type: application/json' -d '{"cols":100,"rows":5}'
  ```
- **Expected Result**: `400` with body `{"error":"rows must be an integer between 10 and 200"}`.
- **Repeatable Unit Test**: Not applicable: same reasoning as UAT-API-002 (Fastify route-level validation, no `.inject()` harness in this repo).
- [x] Pass <!-- verified live at generation time: 2026-08-15, response body {"error":"rows must be an integer between 10 and 200"} -->

### UAT-EDGE-001: `POST /api/terminal-size` rejects missing/non-integer fields
- **Scenario**: An empty body, and a non-integer `cols` (e.g. a float), must both fail the same `cols` validation branch — `typeof cols !== 'number' || !Number.isInteger(cols) || cols < 20 || cols > 500` covers `undefined` and non-integers identically to out-of-range integers.
- **Steps**:
  1. Run each curl command below as-is.
- **Command** (missing fields):
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/terminal-size' -H 'Content-Type: application/json' -d '{}'
  ```
- **Command** (non-integer `cols`):
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/terminal-size' -H 'Content-Type: application/json' -d '{"cols":100.5,"rows":40}'
  ```
- **Expected Result**: Both return `400` with body `{"error":"cols must be an integer between 20 and 500"}`.
- **Repeatable Unit Test**: Not applicable: same reasoning as UAT-API-002/003.
- [x] Pass <!-- verified live at generation time: 2026-08-15, both commands returned {"error":"cols must be an integer between 20 and 500"} -->

### UAT-API-001: `POST /api/terminal-size` happy path — resizes every window of the live tmux session
- **Endpoint**: `POST /api/terminal-size`
- **Description**: Proves the end-to-end success path: valid `cols`/`rows` → `200` with `{cols, rows, resizedWindows}` → every window of the target tmux session is actually resized. **Read the safety note at the top of this file first — this mutates the real tmux session's window sizes and its server-wide `window-size`/`default-size` options.**
- **Steps**:
  1. Note the current window count: `tmux list-windows -t conductor | wc -l` (adjust the session name if your `conductor.conf` overrides `SESSION_NAME`).
  2. Run the curl command below.
  3. Confirm the response body's `resizedWindows` matches the count from step 1.
  4. Run `tmux list-windows -a -F '#{session_name}:#{window_name} #{window_width}x#{window_height}'` and confirm every window in the target session now reports `180x45`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/terminal-size' -H 'Content-Type: application/json' -d '{"cols":180,"rows":45}'
  ```
- **Expected Result**: `200` with body `{"cols":180,"rows":45,"resizedWindows":<N>}` where `<N>` matches step 1's window count, and every window in the session is now `180x45` per step 4.
- **Repeatable Unit Test**: Blocked: `applyGlobalPaneSize` (`host-server/state.ts`) calls `tmux set-option -g window-size manual` / `-g default-size ...` — server-wide options with no `-L`/`-S` socket-isolation parameter on the function. Any real invocation, even against a disposable throwaway session name, would also mutate the tmux server hosting this repo's live `conductor` session. Safely sandboxing this would require adding a socket parameter to `applyGlobalPaneSize` itself, which is out of TASK-130's scope.
- [ ] Pass

### UAT-EDGE-002: `POST /api/terminal-size` returns `503` (not `400`) when the target tmux session isn't up yet
- **Scenario**: `applyGlobalPaneSize` returns `{ok: false, resizedWindows: 0, error}` when `tmux set-option -g window-size manual` or `tmux list-windows -t <session>` fails (session doesn't exist) — the route maps this to `503`, not `400`, since a not-yet-started session is not a client error. Verified by source read (`host-server/index.ts`: `if (!result.ok) return reply.status(503).send({ error: result.error ?? '...' })`).
- **Steps** (run only against an isolated second host-server instance, never the live dev one):
  1. Start a second host-server instance on a different `BACKEND_PORT`, pointed at a scratch `conductor.conf` whose `SESSION_NAME` names a tmux session that does not exist (do not create it).
  2. `curl -sS -X POST 'http://127.0.0.1:<scratch-port>/api/terminal-size' -H 'Content-Type: application/json' -d '{"cols":100,"rows":40}'`
  3. Confirm the response is `503` with a JSON `error` field, not `400` and not a crash/hang.
- **Expected Result**: `503` with a JSON body containing an `error` string; the process does not crash.
- **Repeatable Unit Test**: Blocked: same server-wide `-g` option risk as UAT-API-001 — even a "session does not exist" test still calls `tmux set-option -g window-size manual` as its *first* step (which fails only because the session doesn't exist, but still targets the shared default tmux server first). No socket-isolation parameter exists to sandbox this safely.
- [ ] Pass

### UAT-UI-001: Opening the first agent terminal anywhere in the app posts the probed size and resizes tmux windows
- **Page**: `http://localhost:4321` — any agent card or the agent detail modal (`frontend/src/components/LogTail.tsx`'s terminal-creation effect).
- **Description**: On a fresh page load, the very first `LogTail` terminal to render (card or modal, whichever the user opens first) must trigger exactly one `POST /api/terminal-size`, sized from the hidden full-width probe (not the specific card/modal that happened to open it), and the target tmux session's windows must actually resize as a result.
- **Steps**:
  1. Do a hard refresh of the dashboard (fresh page load — the module-level `hasProbedOnce` guard is per page load).
  2. With the Network tab open and filtered to `terminal-size`, open any single agent's terminal (a card or the detail modal — either counts as "first").
  3. Confirm exactly one `POST /api/terminal-size` request appears.
  4. Run `tmux list-windows -a -F '#{window_width}x#{window_height}'` on the host and confirm every window now reports a width well above 80 (matching the browser viewport at the time of step 2, not the tmux factory default `80x24`).
- **Expected Result**: Exactly one `POST /api/terminal-size` fires; tmux window geometry updates to match.
- **Repeatable Unit Test**: Created: `frontend/src/lib/terminalSizeProbe.test.ts` — the test `"probes once on the first call to maybeProbeOnFirstRender"` proves the guard/call-count half of this behavior (the DOM/network/tmux-geometry half remains genuinely manual, browser-only).
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/terminalSizeProbe.test.ts`
- [ ] Pass

### UAT-UI-002: Resizing the browser window re-syncs the tmux pane size
- **Page**: `http://localhost:4321`, any agent's terminal already open.
- **Description**: A genuine browser window resize (not merely re-opening a terminal) must re-probe and re-POST after the ~400ms debounce, and tmux's window geometry must update to match the new size.
- **Steps**:
  1. With an agent terminal already open (from UAT-UI-001 or a fresh open) and the Network tab filtered to `terminal-size`, resize the browser window (or, for the expanded/focused modal, toggle Alt+F to expand it to a different effective width).
  2. Wait at least 1 second (covers the 400ms debounce).
  3. Confirm a new `POST /api/terminal-size` request appears with different `cols`/`rows` than the first.
  4. Re-run `tmux list-windows -a -F '#{window_width}x#{window_height}'` and confirm the size changed to match.
- **Expected Result**: A new `POST /api/terminal-size` fires after the resize (debounced), and tmux window geometry updates accordingly.
- **Repeatable Unit Test**: Created: `frontend/src/lib/terminalSizeProbe.test.ts` — the test `"registerResizeListener attaches only one resize listener, and a resize always re-probes"` proves a dispatched `resize` event always triggers exactly one additional probe+sync call after the debounce, and that calling `registerResizeListener()` twice does not double-fire it.
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/terminalSizeProbe.test.ts`
- [ ] Pass

### UAT-UI-003: Long command output now fills the terminal panel width instead of wrapping at ~80 columns
- **Page**: `http://localhost:4321`, any agent's terminal, ideally the expanded/focused modal for maximum width.
- **Description**: This is the actual product symptom TASK-130 exists to fix — visual confirmation that terminal text now wraps at the panel's real width, not tmux's old `80x24` factory default.
- **Steps**:
  1. With the pane already resized (UAT-UI-001 has run), send a command to the agent's pane that produces a long single line — e.g. `ls -la` in a directory with long filenames, or ask the agent to print a ~150-character line.
  2. Observe where the line wraps in the browser terminal panel.
- **Expected Result**: The line wraps at (or near) the panel's actual right edge, not at ~80 characters with a large empty margin to the right (compare against the original bug screenshot referenced in `raw/research/terminal-width-early-wrap/index.md`).
- **Repeatable Unit Test**: Not applicable: purely visual/rendering behavior — no deterministic pure-logic slice to isolate (this is exactly the kind of case Step 2.5 excludes: browser rendering/visual layout).
- [ ] Pass

### UAT-UI-004: Opening a second agent's terminal after the first does NOT re-trigger the probe
- **Page**: `http://localhost:4321`, two or more agents available.
- **Description**: The module-level `hasProbedOnce` guard must prevent redundant probing — a second (or third, etc.) agent's terminal opening for the first time in a page session must not fire another `POST /api/terminal-size`, since the shared tmux window size is already correct.
- **Steps**:
  1. Continuing from a page load where UAT-UI-001 already fired one `POST /api/terminal-size`, clear the Network tab's request log (keep the filter on `terminal-size`).
  2. Open a **different** agent's terminal (card or modal) for the first time this page load.
  3. Confirm no new `POST /api/terminal-size` request appears.
- **Expected Result**: Zero additional `POST /api/terminal-size` requests from opening a second (or later) agent's terminal, as long as no browser resize occurred in between.
- **Repeatable Unit Test**: Created: `frontend/src/lib/terminalSizeProbe.test.ts` — the test `"does not probe again on subsequent maybeProbeOnFirstRender calls (e.g. opening a second agent terminal)"` proves this exact guard behavior at the call-count level.
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/terminalSizeProbe.test.ts`
- [ ] Pass
