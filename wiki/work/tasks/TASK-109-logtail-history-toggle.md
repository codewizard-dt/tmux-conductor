---
id: TASK-109
aliases: [TASK-109]
title: "History toggle — switch LogTail between live SSE and persisted terminal log"
status: pending-uat
created: 2026-07-06
updated: 2026-08-21
depends_on: [TASK-108]
blocks: []
parallel_safe_with: [TASK-001, TASK-011, TASK-050, TASK-061, TASK-062, TASK-063, TASK-066, TASK-069, TASK-070, TASK-071, TASK-072, TASK-074, TASK-076, TASK-106, TASK-107]
uat: "[[UAT-109]]"
tags: [frontend, terminal, logging, session-recording, observability, roadmap-010]
---

# TASK-109 — History toggle — switch `LogTail` between live SSE and persisted terminal log

## Objective

Add a "Live" / "History" toggle to the `LogTail` component (`frontend/src/components/LogTail.tsx`) so operators can switch from the live xterm.js pane mirror to a read-only view of the persisted terminal-log history exposed by [TASK-108](TASK-108-terminal-log-history-endpoint.md)'s `GET /agents/:id/log` endpoint. This is Phase 2 item 4 of ROADMAP-010 (Session Recording). **Scope is strictly frontend** — no `host-server`/`db.ts` changes — and strictly the toggle + history render path. Do not implement session-boundary/timestamp markers (Phase 2 item 5, not yet created); leave the historical render path as an obvious insertion point for it instead.

## Approach

- **Current live-rendering mechanism (confirmed via `find_symbol` on `LogTail`, body lines 115-659 at task-creation time — re-read before editing):** live updates arrive from either a focused WebSocket client (`connectTerminalWebSocket`) or `useSSEEvent<{...}>('terminal-output'|'terminal-output-focus', ...)`, and both funnel into `applySnapshot(text)`, which does a single `term.write('\x1bc' + text, cb)` — a full-buffer reset+repaint of the xterm.js terminal, never an incremental diff. The `Terminal` instance itself is created once in a `useEffect` gated on `loaded && windowPresent && xtermContainerRef.current` and is expensive to recreate (loses scrollback, cursor-mirroring setup, WS/SSE wiring). **The History toggle must never dispose/recreate this terminal** — hide its container, don't unmount it, so switching back to Live is instant with no re-fetch or blank flash.
- **Why History mode is NOT rendered through xterm:** `capturePaneTail` (`host-server/state.ts` / `host-server/index.ts`) uses `tmux capture-pane -p` with no `-e` escape flag, so the persisted `chunk` text (and the live `text` snapshot, which shares the same source) is plain rendered text, not raw ANSI. Each row in `agent_terminal_log` is an independent full-pane snapshot at that poll tick, not a diff — feeding successive chunks through `applySnapshot`'s reset-and-repaint would just flash through each snapshot and land on the last one, not produce a scrollable history. Render History mode as a **separate, simple scrollable plain-text view** — stacked monospace blocks, one per chunk, oldest-first — entirely outside the xterm terminal.
- **Endpoint contract (owned by TASK-108, already landed as a dependency):** `GET ${API_BASE}/agents/:id/log` → `{ agent: string, log: AgentTerminalLog[] }`, `AgentTerminalLog = { id: number, agentId: number, ts: string, chunk: string }`, chronological oldest-first. 400 for a non-numeric id, 404 for an unknown id, `{ agent, log: [] }` for an agent with zero persisted rows. Declare local `HistoryLogEntry`/`HistoryLogResponse` interfaces in `LogTail.tsx` next to the existing `TailResponse` interface (same file, same precedent) — do not add these types to `frontend/src/lib/api.ts`.
- **Toggle UI:** small two-button segmented control ("Live" / "History") in the header row (`<div className="mb-1.5 flex items-center gap-2...">`, currently holding the "Log output" label and, when `onToggleExpand` is provided, the expand/collapse icon button). Place the toggle between the label and the expand-button block. Style as a scaled-down version of `ModeSwitcher.tsx`'s segmented-button pattern: active = `bg-accent-blue text-white`, inactive = `border border-line bg-white text-ink-2 hover:bg-canvas`, sized to `h-5`/10-11px text to match the rest of this header row (the expand button and its `kbd` hint are `h-5`/`text-[11px]`).
- **Fetch behavior:** on switching `viewMode` to `'history'`, fetch `${API_BASE}/agents/${agentId}/log`. Refetch every time the user switches into History mode (not once-and-cache) and whenever `agentId` changes while already in History mode — this is a detail/debug view, staleness would be misleading. Track `historyLog: HistoryLogEntry[] | null`, `historyLoading: boolean`, `historyError: boolean`, mirroring the existing `loaded`/`failed` pattern used for the initial tail fetch.
- **Render tree:** inside the existing `!loaded ? ... : !windowPresent ? ... : (...)` branch, keep the live `<div ref={captureRef} ...>` xterm wrapper **always mounted**; add a `hidden` Tailwind class to it when `viewMode === 'history'` instead of conditionally unmounting it. Render a sibling container when `viewMode === 'history'` reusing the live container's dark theme (`bg-[#0b0b0d]`, `rounded-[10px]`, `border-line`, and the same `fillContainer`/`maxHeightClass` sizing behavior) with four states: loading, error, empty (`log.length === 0` → "No persisted history yet."), and populated — each chunk rendered oldest-first as `<pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-[#e7e8ea] px-2 py-1">{entry.chunk}</pre>` inside a scrollable wrapper. **Do not render `entry.ts` or any timestamp/separator** — leave a code comment at the per-chunk render site noting that session-boundary timestamp markers (Phase 2 item 5) will be inserted there.
- **Direct Input / send-keys form:** hide the bottom `<form>` (send-text box + "Direct Input" toggle button) while `viewMode === 'history'` — sending keystrokes only makes sense against the live pane. Restore it on switching back to `'live'`. If `interacting` is currently `true` when the user switches to History, turn it off (`setInteracting(false)`) so a stale Direct-Input banner can't linger over the history view.
- **No new props, no `AgentList.tsx` changes expected:** `viewMode` is local state; the component's existing prop surface (`agentId`, `agentName`, `focused`, `fillContainer`, `interactSignal`, `onInteractChange`, `onCloseModal`, `expanded`, `onToggleExpand`) is sufficient. `LogTail`'s only call site is `frontend/src/components/AgentList.tsx:745` inside the agent-detail modal (`focused fillContainer onToggleExpand=...`) — this task should not need to touch that file at all.
- **Hot-file discipline (CRITICAL):** `frontend/src/components/LogTail.tsx` was recently touched by a commit fixing xterm init timing, snapshot race, and WS-connect race — treat it as actively live, not stable. All edits must be Serena symbol-level operations only: `mcp__serena__find_symbol` on `LogTail` with `include_body=true` to re-read the current body **immediately before editing** (do not trust the line numbers recorded above — this file has drifted before and will drift again), then `mcp__serena__replace_symbol_body` for the whole-function rewrite, or targeted `mcp__serena__insert_after_symbol`/`mcp__serena__replace_content` for smaller insertions (e.g. the new local interfaces near `TailResponse`). Never a whole-file read/rewrite. `frontend/src/components/AgentList.tsx` (LogTail's only call site) is concurrently edited by other orchestrators (TASK-062 branch badge, TASK-074/076 usage badges + session table, TASK-066 diff panel, TASK-071 checkpoint UI) — this task should not touch it, but if some unforeseen prop change turns out to be necessary, re-read the `<LogTail .../>` call site via `find_symbol`/`search_for_pattern` immediately before editing, never assume the recorded line number (745) still holds.

## Steps

### 1. Confirm current state  <!-- agent: Explore -->

- [x] `mcp__serena__find_symbol` on `LogTail` in `frontend/src/components/LogTail.tsx` with `include_body=true` — confirm the header row, the `applySnapshot`/SSE/WebSocket live-update wiring, and the `<div ref={captureRef} ...>` xterm wrapper still match the shape recorded in this task's Approach section; note the current line range (the file has drifted before).
- [x] Confirm [TASK-108](TASK-108-terminal-log-history-endpoint.md) has landed: `mcp__serena__search_for_pattern` for `/agents/:id/log` or `listTerminalLog` usage in `host-server/index.ts`. **Hard stop if the endpoint doesn't exist yet** — this task has nothing to fetch from without it.
- [x] Confirm `TailResponse`'s exact declaration site (for placing the new `HistoryLogEntry`/`HistoryLogResponse` interfaces next to it) via `mcp__serena__find_symbol`.

<!-- Updated: 2026-08-15 — Component body lines 115-659 (outer bound unchanged). useState block 137-173. Header row div 518-548. captureRef xterm wrapper 571-612 (branch 566-613). Bottom form block 614-656. applySnapshot ~183, Terminal-creation useEffect ~227. TASK-108 confirmed landed: host-server/index.ts:1572 registers GET /agents/:id/log, returns {agent, log: listTerminalLog(db, agentId)}, 400 invalid id / 404 unknown agent. TailResponse at LogTail.tsx:14-19 ({agent, lines, windowPresent, text}). -->

### 2. Add local response types  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/LogTail.tsx`, next to the existing `TailResponse` interface, add:
  ```ts
  interface HistoryLogEntry {
    id: number
    agentId: number
    ts: string
    chunk: string
  }

  interface HistoryLogResponse {
    agent: string
    log: HistoryLogEntry[]
  }
  ```
- [x] Do not add these types to `frontend/src/lib/api.ts`.

<!-- Updated: 2026-08-15 — Inserted at LogTail.tsx:21-31 via mcp__serena__insert_after_symbol, immediately after TailResponse. frontend/src/lib/api.ts untouched. tsc --noEmit reports one expected transient error (TS6196: HistoryLogResponse declared but never used) — will clear once Step 4 wires up the history fetch/consumer. -->

### 3. Add `viewMode` state and the Live/History toggle UI  <!-- agent: general-purpose -->

- [x] **Hot file — re-read `LogTail`'s body immediately before this edit.** Add `const [viewMode, setViewMode] = useState<'live' | 'history'>('live')` alongside the component's other `useState` declarations.
- [x] Add `historyLog: HistoryLogEntry[] | null`, `historyLoading: boolean`, `historyError: boolean` state, initialized to `null`/`false`/`false`.
- [x] In the header row (`<div className="mb-1.5 flex items-center gap-2...">`), insert a small two-button segmented toggle between the "Log output" label `<p>` and the `onToggleExpand` block: `Live` and `History` buttons, active state `bg-accent-blue text-white`, inactive `border border-line bg-white text-ink-2 hover:bg-canvas`, `h-5` height / `text-[11px]` to match the row's existing scale. Clicking a button calls `setViewMode('live' | 'history')`; when switching to `'history'`, also reset `historyError` to `false`. When switching to `'live'`, if `interacting` is `true`, call `setInteracting(false)`.

<!-- Updated: 2026-08-15 — viewMode/historyLog/historyLoading/historyError state added alongside existing useState declarations. Segmented Live/History toggle inserted between the "Log output" label and the onToggleExpand block (h-5/text-[11px]/rounded-[5px], bg-accent-blue active / border-line+bg-white inactive), onClick resets historyError on ->history and calls setInteracting(false) on ->live when interacting. tsc --noEmit shows the expected pre-existing TS6196 plus 5 new TS6133 unused-var errors for historyLog/setHistoryLog/historyLoading/setHistoryLoading/historyError — all expected to clear once Steps 4-5 consume them. -->

### 4. Fetch persisted history on entering History mode  <!-- agent: general-purpose -->

- [x] Add a `useEffect` keyed on `[viewMode, agentId]` that, when `viewMode === 'history'`, sets `historyLoading(true)`, fetches `${API_BASE}/agents/${agentId.toString()}/log`, parses as `HistoryLogResponse`, sets `historyLog(data.log)` on success and `historyError(true)` on any non-ok response or thrown error, and always clears `historyLoading` in a `finally`. Use the same `cancelled` guard pattern as the existing tail-fetch `useEffect` (a `let cancelled = false` + cleanup function) to avoid a stale response overwriting state after an agent switch or an unmount.
- [x] Do not fetch when `viewMode === 'live'` — no wasted requests while the toggle sits on Live.

<!-- Updated: 2026-08-15 — useEffect keyed [viewMode, agentId] added right after the existing tail-fetch effect, mirroring its cancelled-guard/.then/.catch/.finally idiom against `${API_BASE}/agents/${agentId.toString()}/log`; early-returns when viewMode !== 'history'. tsc --noEmit: HistoryLogResponse/setHistoryLog/setHistoryLoading/setHistoryError errors all cleared; historyLog/historyLoading/historyError (read-side) still flagged unused as expected until Step 5's render consumes them. No new/unexpected errors. -->

### 5. Hide the live xterm container (don't unmount) and render the History view  <!-- agent: general-purpose -->

- [x] **Hot file — re-read the render tree immediately before this edit.** In the `<div ref={captureRef} ...>` wrapper's `className` template string (inside the `!loaded ? ... : !windowPresent ? ... : (...)` branch), append `${viewMode === 'history' ? ' hidden' : ''}` — do not conditionally unmount this element; it must stay mounted so the xterm `Terminal`/WebSocket/SSE state survives toggling.
- [x] Immediately after that wrapper (as a sibling, still inside the same branch), add: `{viewMode === 'history' && ( ... )}` rendering:
  - `historyLoading` → a loading message matching the existing `!loaded` loading copy style (`<p className="text-[12px] italic text-muted-2">Loading…</p>`).
  - `historyError` → `<p className="text-[12px] italic text-muted-2">Could not load history.</p>`.
  - `historyLog !== null && historyLog.length === 0` → `<p className="text-[12px] italic text-muted-2">No persisted history yet.</p>`.
  - Otherwise, a scrollable dark container (`bg-[#0b0b0d] rounded-[10px] border border-line overflow-y-auto`, sized via the same `fillContainer`/`maxHeightClass` logic the live container uses) mapping `historyLog` oldest-first to `<pre key={entry.id} className="whitespace-pre-wrap break-all font-mono text-[11px] text-[#e7e8ea] px-2 py-1">{entry.chunk}</pre>` blocks. Add a code comment immediately above the `.map` call noting that session-boundary timestamp markers (using `entry.ts`) will be inserted here by a future task — do not render `entry.ts` in this task.

<!-- Updated: 2026-08-15 — captureRef wrapper's className gained a trailing `hidden` when viewMode==='history'; div itself stays unconditionally mounted (wrapped only in a Fragment alongside the new sibling, never in an {cond && ...} block) — xterm Terminal instance/mount effect untouched. New sibling renders loading/error/empty/populated states, populated case reuses the identical fillContainer/maxHeightClass sizing expression as the live container and maps historyLog oldest-first (no re-sort) into <pre> blocks, with a comment marking the entry.ts insertion point for the future session-boundary task. tsc --noEmit: zero errors — all previously-transient unused-state errors cleared. -->

### 6. Hide Direct Input / send-keys form in History mode  <!-- agent: general-purpose -->

- [x] Wrap the existing bottom `{windowPresent && (<form>...</form>)}` block's render condition with `viewMode === 'live'` (i.e. `{windowPresent && viewMode === 'live' && (<form>...)}`) so it disappears while viewing history and reappears immediately on switching back to Live.

<!-- Updated: 2026-08-15 — guard changed from `{windowPresent && (` to `{windowPresent && viewMode === 'live' && (`; form internals untouched. tsc --noEmit: zero errors. -->

### 7. Typecheck and build  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` in `frontend/` — zero errors.
- [x] Run `npm run build` in `frontend/` — clean build.

<!-- Updated: 2026-08-15 — both clean: tsc --noEmit exit 0 no output; npm run build (tsc && vite build) exit 0, 71 modules transformed, only a pre-existing >500kB chunk-size advisory (not an error). -->

### 8. Manual smoke test  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] With a real agent that has persisted `agent_terminal_log` rows (seed via TASK-106's `appendTerminalLogChunk` in a `tsx` snippet in `./tmp/`, or wait for TASK-107's poll-loop writer if already landed), open the agent detail modal, click "History" — confirm chunks render oldest-first, no timestamps shown, and the Direct Input form disappears.
- [DEFERRED-TO-UAT] Click "Live" — confirm the xterm terminal reappears instantly showing the current live pane state (no blank flash, no re-fetch of `/tail`), and the send-form/Direct Input button reappear.
- [DEFERRED-TO-UAT] Toggle back and forth a few times — confirm the live terminal's scrollback/cursor state is never reset (i.e. it was never disposed) and each History switch refetches fresh rows (add a row via the seeding snippet between toggles and confirm it appears on the next History switch).
- [DEFERRED-TO-UAT] With an agent that has zero persisted rows, confirm History mode shows "No persisted history yet." and not an error or a blank screen.

<!-- Updated: 2026-08-15 — runtime/UI smoke test deferred to UAT phase per tackle's static-gates-only rule (matches the TASK-070 precedent in this repo); Steps 1-7 (implementation + tsc + build) are all complete and clean. -->

## Acceptance Criteria

- [ ] A "Live"/"History" segmented toggle renders in `LogTail`'s header row, styled consistently with the row's existing 10-11px scale.
- [ ] Switching to History fetches `GET ${API_BASE}/agents/:id/log` fresh each time (on toggle-in and on `agentId` change while in History mode) and renders persisted chunks oldest-first as plain monospace blocks, with distinct loading/error/empty states.
- [ ] No `entry.ts`/timestamp/session-boundary UI is rendered — a code comment marks the insertion point for the future session-boundary-marker task.
- [ ] The live xterm `Terminal` instance is never disposed/recreated by toggling — its container is hidden via a CSS class, not unmounted; switching back to Live is instant with no re-fetch and no blank flash.
- [ ] The Direct Input / send-keys form is hidden while `viewMode === 'history'` and reappears immediately on switching back to Live; any active Direct Input session is turned off when switching to History.
- [ ] No changes to `host-server/` or `frontend/src/lib/api.ts`; new response types are local to `LogTail.tsx`.
- [ ] `frontend/src/components/AgentList.tsx` is untouched (no new props required).
- [ ] `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/`.

## Dependencies

- **DEPENDS ON [TASK-108](TASK-108-terminal-log-history-endpoint.md)** — `GET /agents/:id/log` endpoint this task fetches from. Do not start until it is merged (verify via Step 1's `search_for_pattern` check).
- **Does not depend on [TASK-106](TASK-106-agent-terminal-log-table.md) or [TASK-107](TASK-107-terminal-log-poll-append.md) directly** — TASK-108 already gates on TASK-106 for its own data; this task only calls the HTTP endpoint and never touches `host-server/db.ts` or the poll loop.
- **Hot-file coordination:** `frontend/src/components/LogTail.tsx` is the same file recently touched by a commit fixing xterm init timing/snapshot race/WS-connect race — re-read via `find_symbol` immediately before every edit, per the Approach section's Hot-file discipline note. `frontend/src/components/AgentList.tsx` (LogTail's only call site) is concurrently edited by TASK-062/066/071/074/076 — this task is not expected to touch it.

**Downstream dependent (ROADMAP-010 Phase 2, not yet created as a task file — its eventual `depends_on` will include this task):**

1. Display session boundary markers (timestamps) when rendering the historical log — consumes `entry.ts` from this task's `HistoryLogEntry` and inserts a separator at the code-comment marker left in Step 5's `.map` call.

### Roadmap

Implements ROADMAP-010 Phase 2, item `Add "History" toggle to the LogTail component to switch between live SSE and persisted log` — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`.
