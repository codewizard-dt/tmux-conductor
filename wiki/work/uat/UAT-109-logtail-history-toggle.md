---
id: UAT-109
aliases: [UAT-109]
title: "UAT: History toggle — switch LogTail between live SSE and persisted terminal log"
status: pending
task: TASK-109
created: 2026-08-15
updated: 2026-08-21
---

# UAT-109 — UAT: History toggle — switch `LogTail` between live SSE and persisted terminal log

implements::[[TASK-109]]

> **Source task**: [[TASK-109]]
> **Generated**: 2026-08-15
> **Note**: Frontend-only task (`frontend/src/components/LogTail.tsx`). Confirmed via `find_symbol`/`get_symbols_overview` at generation time: `viewMode` state, `HistoryLogEntry`/`HistoryLogResponse` interfaces (lines 21-31, next to `TailResponse`), the segmented Live/History toggle in the header row, the `[viewMode, agentId]`-keyed fetch effect, the always-mounted `captureRef` xterm wrapper (gains only a trailing `' hidden'` class suffix — the Terminal-creation effect's dependency array is `[loaded, windowPresent, agentId]`, so `viewMode` never triggers its cleanup/`term.dispose()`), the History render branch (loading/error/empty/populated), and the Direct-Input form's `windowPresent && viewMode === 'live'` gate all match the task's Approach section exactly and are unaffected by anything below. `frontend/src/components/AgentList.tsx`'s `<LogTail .../>` call site (line 748) carries the same 9 props as before this task — confirmed unchanged via `search_for_pattern`. TASK-108's `GET /agents/:id/log` contract (`host-server/index.ts:1572`, `host-server/db.ts`'s `listTerminalLog`/`mapAgentTerminalLog`) already has repeatable coverage in `host-server/db.migration.test.ts` and its own archived UAT-108 — this file scopes its API tests to what `LogTail` actually consumes (shape + ordering + the two error paths) rather than re-testing the endpoint from scratch. **Concurrent-edit note**: TASK-109's own scope explicitly excluded rendering `entry.ts` ("leave the historical render path as an obvious insertion point" for the future session-boundary task). Mid-generation of this file, [TASK-110](TASK-110-logtail-history-timestamp-markers.md) (the downstream timestamp-marker task) landed concurrently in the same live file — `entry.ts` is now rendered via `formatChunkTs(entry.ts)` inside a `<Fragment>` preceding each chunk's `<pre>`. This is expected, correct progress on a separate, already-generated task ([UAT-110](UAT-110-logtail-history-timestamp-markers.md) owns verifying it) — not a defect in TASK-109's own work — so this file tests TASK-109's own scope (toggle, fetch, live/history structure, xterm persistence, Direct Input gating) without asserting anything about whether a timestamp is or isn't shown.

---

## Prerequisites

- [ ] Host-server running on `http://localhost:8788` (`make dev` or `npm start` in `host-server/`)
- [ ] Frontend dev server running on `http://localhost:4321` (`make dev`)
- [ ] `jq`, `node`, and `sqlite3` installed
- [ ] At least one agent with real persisted `agent_terminal_log` rows (agent id `10` / `bootstrap-1` had 13 rows spanning two days at generation time — confirm with `curl -sS 'http://localhost:8788/api/agents/10/log' | jq '.log | length'`; substitute any agent with `length > 1` if that has changed)
- [ ] Leave agent id `12` untouched — it is a live fixture belonging to a separate, still-running UAT run
- [ ] Any throwaway fixture agent this file's own steps create (UAT-UI-001's empty-state sub-case) must be deleted by that same test's own teardown step — this file otherwise creates no agents and deletes none

---

## Test Cases

### UAT-API-001: GET /agents/:id/log returns the well-shaped, chronologically-ordered contract `LogTail` depends on
- **Endpoint**: `GET /api/agents/:id/log`
- **Description**: `LogTail`'s history fetch (the `[viewMode, agentId]`-keyed `useEffect`) parses the response as `HistoryLogResponse` and renders `historyLog` directly via `.map()` with **no re-sort** — the component's oldest-first rendering claim depends entirely on the backend already returning ascending order. Verifies both the response shape (`{agent: string, log: [{id, agentId, ts, chunk}]}`) and that `log` is sorted ascending by `ts` on a real multi-row agent.
- **Steps**:
  1. Confirm agent `10` (or the Prerequisites-selected substitute) has more than one persisted row.
  2. Run the command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/agents/10/log' | jq '(.agent|type)=="string" and (.log|type)=="array" and (.log|length)>1 and (.log|all(has("id") and has("agentId") and has("ts") and has("chunk") and .agentId==10)) and ([.log[].ts] as $t | [range(0;($t|length)-1)] | all($t[.] <= $t[.+1]))'
  ```
- **Expected Result**: Prints `true` (verified live at generation time against agent 10's 13 real rows spanning 2026-07-06 through 2026-08-15).
- **Repeatable Unit Test**: Not applicable: the endpoint's shape and `ORDER BY ts ASC, id ASC` ordering (`host-server/db.ts`'s `listTerminalLog`) already have repeatable coverage from TASK-106/108 (`host-server/db.migration.test.ts`'s `appendTerminalLogChunk`/`listTerminalLog` round-trip and cascade-delete cases) and TASK-108's own archived UAT-108. This case verifies only that the contract survives onto the live route the frontend actually fetches from, which needs the live route.
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-002: GET /agents/:id/log — 400 for a non-numeric id
- **Endpoint**: `GET /api/agents/:id/log`
- **Description**: The route's `parseInt(req.params.id, 10)` guard (`host-server/index.ts:1573-1574`) rejects a non-numeric id before touching the DB.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' 'http://localhost:8788/api/agents/abc/log'
  ```
- **Expected Result**: Prints `400` (verified live at generation time; body is `{"error":"invalid agent id"}`).
- **Repeatable Unit Test**: Not applicable: inline route-guard logic in `host-server/index.ts` shared verbatim with the sibling `/agents/:id/checkpoints` route; not independently unit-testable without spinning up the real HTTP server, which this live check already does directly.
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-003: GET /agents/:id/log — 404 for an unknown (but numeric) agent id
- **Endpoint**: `GET /api/agents/:id/log`
- **Description**: `getAgentById(db, agentId)` returning nothing yields a 404 before the log query runs.
- **Steps**:
  1. Run the command below as-is (using an id guaranteed not to exist).
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' 'http://localhost:8788/api/agents/999999/log'
  ```
- **Expected Result**: Prints `404` (verified live at generation time; body is `{"error":"agent 999999 not found"}`).
- **Repeatable Unit Test**: Not applicable: same reasoning as UAT-API-002 — a live-route guard clause, verified directly against the running server.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-001: `LogTail`'s History-mode decision logic — render-branch selection, hidden-class gate, form-visibility gate, and the toggle's state transition
- **Scenario**: Four small, pure decision points in `LogTail.tsx` (read verbatim at generation time) govern History mode: (1) which of loading/error/empty/populated renders, keyed on `historyLoading`/`historyError`/`historyLog`; (2) the `captureRef` xterm wrapper's trailing `' hidden'` class suffix, appended only in History mode and never used to unmount the element; (3) the Direct Input form's `windowPresent && viewMode === 'live'` visibility gate; (4) the Live/History toggle button's `onClick` handler, which clears `historyError` on switching to History and turns off an active Direct Input session on switching to Live. These are pure given explicit state, no DOM/fetch — reproduced byte-for-byte below.
- **Steps**:
  1. Write the reference script (byte-for-byte copy of the four decision points):
     ```bash
     mkdir -p /Users/davidtaylor/Repositories/tmux-conductor/tmp
     cat > /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat109-logtail-logic.mjs <<'EOF'
     function renderBranch(historyLoading, historyError, historyLog) {
       if (historyLoading) return 'loading'
       if (historyError) return 'error'
       if (historyLog !== null && historyLog.length === 0) return 'empty'
       return 'populated'
     }
     function capturedClassSuffix(viewMode) {
       return viewMode === 'history' ? ' hidden' : ''
     }
     function formVisible(windowPresent, viewMode) {
       return windowPresent && viewMode === 'live'
     }
     function toggleClick(key, state) {
       const next = { ...state }
       if (key === 'history') next.historyError = false
       if (key === 'live' && state.interacting) next.interacting = false
       next.viewMode = key
       return next
     }
     const cases = [
       [renderBranch(true, false, null), 'loading'],
       [renderBranch(false, true, null), 'error'],
       [renderBranch(false, false, []), 'empty'],
       [renderBranch(false, false, [{ id: 1, agentId: 10, ts: '2026-08-15T00:00:00Z', chunk: 'x' }]), 'populated'],
       [capturedClassSuffix('live'), ''],
       [capturedClassSuffix('history'), ' hidden'],
       [formVisible(true, 'live'), true],
       [formVisible(true, 'history'), false],
       [formVisible(false, 'live'), false],
       [formVisible(false, 'history'), false],
       [JSON.stringify(toggleClick('history', { viewMode: 'live', historyError: true, interacting: false })),
         JSON.stringify({ viewMode: 'history', historyError: false, interacting: false })],
       [JSON.stringify(toggleClick('live', { viewMode: 'history', historyError: false, interacting: true })),
         JSON.stringify({ viewMode: 'live', historyError: false, interacting: false })],
       [JSON.stringify(toggleClick('live', { viewMode: 'history', historyError: false, interacting: false })),
         JSON.stringify({ viewMode: 'live', historyError: false, interacting: false })],
     ]
     let ok = true
     for (const [actual, expected] of cases) {
       if (actual !== expected) { ok = false; console.log('MISMATCH', JSON.stringify(actual), '!==', JSON.stringify(expected)) }
     }
     console.log(ok ? 'ALL PASS' : 'FAIL')
     EOF
     ```
  2. Run the command below as-is.
- **Command**:
  ```bash
  node /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat109-logtail-logic.mjs
  ```
- **Expected Result**: Prints `ALL PASS` with no `MISMATCH` lines (verified by running this exact script before writing this file). Note: the `renderBranch(false, false, null)` state (historyLog still `null` but neither loading nor errored) is deliberately excluded from the matrix — it falls into `'populated'` per the source's own ternary, but is unreachable in practice because `historyLoading` is set synchronously before the fetch and only cleared in `.finally()` after it resolves, so `historyLog` can never be non-null-neither-loading-nor-errored at the same time in the real effect flow.
- **Repeatable Unit Test**: Blocked: this logic is promotable in principle (pure, deterministic, no I/O) but `frontend/` has no configured test runner (no vitest/jest in `frontend/package.json`, no existing test files anywhere under `frontend/` — confirmed at generation time, same constraint as UAT-074/UAT-076). The reference script above pins the exact logic read from source as a browser-free, re-runnable check in lieu of a promoted file.
- [x] Pass <!-- 2026-08-15 -->

### UAT-UI-001: Live/History toggle renders in the header row; switching to History shows the correct loading/empty/populated state
- **Page**: `http://localhost:4321/`
- **Description**: A small two-button segmented "Live"/"History" toggle must appear in `LogTail`'s header row (between the "Log output" label and the expand-button block). Clicking "History" must fetch fresh (not once-and-cache) and render persisted chunks oldest-first as plain monospace `<pre>` blocks with no `entry.ts`/timestamp shown, or the appropriate loading/empty message.
- **Auth-Required**: false
- **Steps**:
  1. Open the dashboard at `http://localhost:4321/`, open the detail modal for agent `10`/`bootstrap-1` (or the Prerequisites-selected substitute with real history).
  2. Observe the header row above the log pane: confirm a "Live"/"History" segmented toggle appears between the "Log output" label and the expand-button icon, with "Live" shown active (blue background).
  3. Click "History". Briefly observe a loading state, then confirm chunks render oldest-first as plain monospace blocks with no ANSI/color codes (plain rendered pane text). (Per-chunk timestamp dividers are TASK-110's concern, not this task's — see UAT-110 for that verification; this step is about ordering and content, not the presence/format of any timestamp.)
  4. **Empty-state sub-case** — create a disposable fixture to observe the true zero-rows state deterministically (the poll loop writes a row within ~2s of any agent's tmux window existing, so a freshly-created agent cannot reliably be caught empty by chance alone):
     ```bash
     mkdir -p /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat109-fixture-empty
     ```
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/agents' -H 'Content-Type: application/json' -d "{\"name\":\"uat109-empty\",\"workdir\":\"$(pwd)/tmp/uat109-fixture-empty\",\"launchCmd\":\"sleep 300\"}"
     ```
     Note the returned `agent.id` (call it `<FID>`), then immediately clear any row(s) the poll loop already wrote for it (scoped strictly to this one fixture agent's own rows):
     ```bash
     sqlite3 /Users/davidtaylor/Repositories/tmux-conductor/data/conductor.db "DELETE FROM agent_terminal_log WHERE agent_id = <FID>"
     ```
     Open the `uat109-empty` agent's detail modal, click "History" — confirm it shows "No persisted history yet." (not an error, not a blank screen).
  5. Teardown: `curl -sS -X DELETE "http://localhost:8788/api/agents/<FID>"` (cascades any `agent_terminal_log` rows automatically).
- **Expected Result**: Toggle present and correctly styled; populated case renders real chunks oldest-first, no timestamps; empty case (after the DB-clear technique above) shows exactly "No persisted history yet." with no error and no blank panel.
- **Repeatable Unit Test**: Not applicable: verifies browser rendering / fetch-triggered DOM updates; `frontend/` has no component test harness. The render-branch selection logic itself is pinned browser-free in UAT-EDGE-001.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-21 -->

### UAT-UI-002: The live xterm terminal is never disposed by toggling — switching back to Live is instant with scrollback/cursor state intact
- **Page**: `http://localhost:4321/`
- **Description**: **This is the subtle regression risk to watch for** — a correct-looking implementation could still accidentally recreate the `Terminal` instance on toggle (losing scrollback, cursor-mirroring, and WS/SSE wiring) without any obviously broken rendering. Source confirms the Terminal-creation `useEffect`'s dependency array is `[loaded, windowPresent, agentId]` — `viewMode` is not a dependency, so toggling can never re-run (and thus never dispose via its cleanup, which calls `term.dispose()`) this effect. The `captureRef` wrapper is also never conditionally unmounted — only gains a trailing `hidden` class. Confirm this holds visually, since a future edit could add `viewMode` to that dependency array or wrap the wrapper in a conditional without breaking anything the naked eye would notice on a single toggle.
- **Auth-Required**: false
- **Steps**:
  1. Open the dashboard, open the detail modal for a **focused, currently-active** agent (one that is actually running and producing live pane output).
  2. In the live pane, scroll up a few lines so you're not pinned to the bottom (or note the current cursor position / visible scrollback content).
  3. Click "History", then immediately click "Live" again.
  4. Observe: does the terminal reappear instantly (same frame, no blank flash, no visible re-fetch of `/tail`)? Is your scroll position / the prior scrollback content still exactly as you left it (not reset to a fresh single-snapshot repaint)?
  5. Toggle back and forth 3-4 more times in quick succession. Confirm the terminal never flashes blank and scrollback is never wiped between toggles.
- **Expected Result**: Every switch back to Live is instant with no blank flash and no `/tail` re-fetch (check the Network tab if in doubt — no new `GET .../tail` request should fire on a toggle, only on the initial mount). Scrollback position and content survive every toggle, confirming the `Terminal` instance was never disposed/recreated.
- **Repeatable Unit Test**: Not applicable: verifies that a specific React `useEffect`'s dependency array excludes `viewMode` in a running browser DOM, and that no `xterm.js` `Terminal.dispose()` call fires — there is no frontend component test harness to assert against a live `Terminal` instance, and authoring a headless script whose pass condition requires introspecting the xterm instance is out of scope for this run. The static fact (dependency array shape) was confirmed by source inspection at generation time; only the resulting browser behavior needs a human eye.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-21 -->

### UAT-UI-003: Direct Input form hides in History mode and reappears in Live mode; an active session is turned off on switching away
- **Page**: `http://localhost:4321/`
- **Description**: The bottom send-text form (`windowPresent && viewMode === 'live'` gate) must disappear entirely while `viewMode === 'history'` and reappear immediately on switching back — sending keystrokes only makes sense against the live pane. If Direct Input is active when the user switches to History, it must be turned off so no stale "Direct Input" banner lingers over the history view.
- **Auth-Required**: false
- **Steps**:
  1. Open the dashboard, open the detail modal for a windowed agent (Live mode by default). Confirm the bottom send-text box + "Direct Input" button are visible.
  2. Click into the terminal to enable Direct Input (orange "Direct Input — keys go to …" banner appears).
  3. Click "History". Confirm: the send-text form disappears entirely (not just disabled/greyed), and the orange Direct Input banner is gone (no stale banner floating over the history view).
  4. Click "Live". Confirm the send-text box and "Direct Input" button reappear immediately, and Direct Input is off (not auto-re-enabled).
- **Expected Result**: Form and banner both vanish on switching to History; form reappears (Direct Input off, not auto-restored) on switching back to Live.
- **Repeatable Unit Test**: Not applicable: verifies DOM presence/absence of a conditionally-rendered form and banner in the browser. The underlying `windowPresent && viewMode === 'live'` gate and the toggle's `interacting`-clearing side effect are both pinned browser-free in UAT-EDGE-001.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-21 -->

### UAT-STATIC-001: `tsc --noEmit` and `npm run build` pass cleanly in `frontend/`
- **Description**: The task's static-gate acceptance criterion, re-verified independently of `/tackle`'s own run.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  npm --prefix frontend run typecheck
  ```
- **Expected Result**: Exit code 0, no TypeScript errors printed (verified live at generation time; `npm run build` was also run at generation time and completed cleanly — 71 modules transformed, only the pre-existing >500kB chunk-size advisory, not an error).
- **Repeatable Unit Test**: Not applicable: this test *is* the static gate (`tsc --noEmit`), already run as part of `/tackle`'s own verification and re-checked here as a UAT sanity gate, not additional new test code.
- [x] Pass <!-- 2026-08-15 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| A "Live"/"History" segmented toggle renders in `LogTail`'s header row, styled consistently | UAT-UI-001 |
| Switching to History fetches `GET /agents/:id/log` fresh each time and renders persisted chunks oldest-first as plain monospace blocks, with distinct loading/error/empty states | UAT-UI-001, endpoint contract + ordering pinned by UAT-API-001, render-branch selection pinned by UAT-EDGE-001 |
| No `entry.ts`/timestamp/session-boundary UI is rendered — comment marks the insertion point | Superseded: [TASK-110](TASK-110-logtail-history-timestamp-markers.md) (the task this insertion point was left for) landed concurrently with this file's own generation and now renders `entry.ts` via `formatChunkTs` — see [UAT-110](UAT-110-logtail-history-timestamp-markers.md), not this file, for that verification. See the file's opening note. |
| The live xterm `Terminal` instance is never disposed/recreated by toggling; container is hidden via CSS, not unmounted; switching back to Live is instant | UAT-UI-002 (the explicit regression-risk case), hidden-class gate pinned by UAT-EDGE-001 |
| The Direct Input form is hidden while `viewMode === 'history'` and reappears on switching back; an active session is turned off when switching to History | UAT-UI-003, gate + toggle side-effect pinned by UAT-EDGE-001 |
| No changes to `host-server/` or `frontend/src/lib/api.ts`; new types are local to `LogTail.tsx` | Verified by source inspection at generation time (not a runtime case) — `HistoryLogEntry`/`HistoryLogResponse` live at `LogTail.tsx:21-31`, `api.ts` untouched |
| `frontend/src/components/AgentList.tsx` is untouched (no new props required) | Verified by source inspection at generation time — `<LogTail .../>` call site (line 748) carries the same 9 props as before |
| `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/` | UAT-STATIC-001 |

**Note on `uatGenerate.promoteTests`**: the stored preference (`true`) uses the legacy true/false grammar and maps to `dedicated` for this run. No test files were created under it — `frontend/` has no configured test runner at all (no vitest/jest, no existing test files), so promoting UAT-EDGE-001's decision logic into a real test file would mean introducing new frontend test infrastructure, out of scope for this generation. Its logic is instead pinned as a machine-verifiable, browser-free reference script, following the same pattern used for UAT-074's `formatTokens`/`formatCost`/`UsageBadge` and UAT-076.
