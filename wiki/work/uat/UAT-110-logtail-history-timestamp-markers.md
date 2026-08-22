---
id: UAT-110
aliases: [UAT-110]
title: "UAT: Session boundary markers — per-chunk timestamp dividers in LogTail history view"
status: pending
task: TASK-110
created: 2026-08-15
updated: 2026-08-15
---

# UAT-110 — UAT: Session boundary markers — per-chunk timestamp dividers in LogTail history view

implements::[[TASK-110]]

> **Source task**: [[TASK-110]]
> **Generated**: 2026-08-15
> **Contract, not implementation, note**: this task's design decision is "one formatted-timestamp label per chunk, unconditionally, sourced from `entry.ts`" — no gap-detection/idle-threshold heuristic. The tests below pin that contract (a label is derived from `entry.ts`; the malformed-input fallback returns the raw string unchanged; ordering and count track the underlying data) rather than the specific `toLocaleString(...)` options `formatChunkTs` currently uses or its Tailwind classes — either could change under a future restyle/reformat without weakening what this task actually guarantees.
> **Split note**: `formatChunkTs` (`frontend/src/components/LogTail.tsx:57-61`) is a pure, deterministic function — pinned browser-free via a Node reference script (UAT-EDGE-001), same technique as UAT-074/UAT-076. `GET /api/agents/:id/log` returning `ts` on every entry, oldest-first, is live-curl checkable (UAT-API-001) — this endpoint is unchanged by TASK-110 itself, but it is the precondition the render marker consumes, and the team lead's brief for this UAT explicitly asked for it to be pinned here. Only the actual DOM rendering (dividers appearing above each chunk in the live History view) fails closed to human verification — no frontend test harness exists in this repo (no vitest/jsdom, confirmed empty `frontend/src/**/*.test.ts*`), same precedent as UAT-062/074/076.

---

## Prerequisites

- [ ] Host-server running on `http://127.0.0.1:8788` (`make dev` or `npm start` in `host-server/`) — confirmed reachable at generation time (`GET /api/status` → 200).
- [ ] `sqlite3` and `jq` installed — used to seed `agent_terminal_log` rows directly and to assert on the JSON response. No live tmux session is required for UAT-API-001: the fixture agent is inserted as a plain DB row (mirroring the UAT-070/076 precedent), since `GET /agents/:id/log` has no worktree/tmux dependency.
- [ ] `DB_PATH` resolves to `./data/conductor.db` (the `conductor.conf` default, relative to the repo root) — confirm before using the `sqlite3 ./data/conductor.db ...` commands below, or substitute the configured path.
- [ ] Frontend dev server running on `http://localhost:4321` (`make dev`) — required for UAT-UI-001/UAT-UI-002 only.
- [ ] `node` available on `PATH` — required for UAT-EDGE-001's reference script.

---

## Test Cases

### UAT-API-001: GET /agents/:id/log returns `ts` on every entry, oldest-first
- **Endpoint**: `GET /api/agents/:id/log`
- **Description**: The per-chunk timestamp marker this task renders is sourced entirely from `entry.ts` on each `HistoryLogEntry`, and TASK-110's "no gap-detection, one label per chunk" design depends on the underlying rows already being chronological. This pins both preconditions together: every returned log entry carries a non-empty `ts` string, and the array is ordered oldest-first (`listTerminalLog`'s `ORDER BY ts ASC, id ASC`, `host-server/db.ts:925-929`) — verified here by seeding three rows in a deliberately *non*-chronological insertion order and confirming the response re-sorts them.
- **Steps**:
  1. Create a disposable fixture agent directly in the DB (no live tmux session needed — this endpoint has no worktree/window dependency):
     ```bash
     sqlite3 /Users/davidtaylor/Repositories/tmux-conductor/data/conductor.db "INSERT INTO agents (name, workdir, launch_cmd) VALUES ('uat110-fixture', '/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat110-nonexistent', 'true') RETURNING id;"
     ```
     Note the printed id as `<UID>`.
  2. Seed three `agent_terminal_log` rows out of chronological insertion order (substitute `<UID>`):
     ```bash
     sqlite3 /Users/davidtaylor/Repositories/tmux-conductor/data/conductor.db "INSERT INTO agent_terminal_log (agent_id, ts, chunk) VALUES (<UID>, '2026-08-15T10:00:00Z', 'chunk-mid'), (<UID>, '2026-08-15T09:00:00Z', 'chunk-first'), (<UID>, '2026-08-15T11:00:00Z', 'chunk-last')"
     ```
  3. Run the command below (substitute `<UID>`).
  4. Cleanup: `curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/<UID>"` — cascades the seeded `agent_terminal_log` rows via its `ON DELETE CASCADE` FK.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents/<UID>/log' | jq '(.log|length==3) and (.log|map(.chunk))==["chunk-first","chunk-mid","chunk-last"] and (.log|all(has("ts") and (.ts|type=="string") and (.ts|length>0)))'
  ```
- **Expected Result**: Prints `true` — 3 entries, `chunk` values reordered to `["chunk-first","chunk-mid","chunk-last"]` (oldest `ts` first, despite being inserted second), and every entry has a non-empty string `ts` field for the marker to render from. Verified live at generation time against fixture agent id 17 (since deleted).
- **Repeatable Unit Test**: Not applicable: `listTerminalLog`'s `ORDER BY ts ASC, id ASC` is pre-existing behaviour from TASK-106/108, unchanged by TASK-110 — this case pins it as a render precondition rather than owning its own coverage; the route itself is a two-line Fastify handler with no independent logic to isolate from the HTTP/DB layer.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-001: `formatChunkTs` — valid-timestamp transformation and the invalid-input fallback
- **Scenario**: `formatChunkTs` (`frontend/src/components/LogTail.tsx:57-61`) is a pure, deterministic function: `const d = new Date(ts); if (Number.isNaN(d.getTime())) return ts; return d.toLocaleString(...)`. The contract under test is (a) a valid timestamp is transformed into a distinct, non-empty label, and (b) any string `new Date()` cannot parse falls back to the *original, unmodified* `ts` string — this fallback path is genuine edge-case behaviour worth pinning independent of the exact formatting options chosen. The source is reproduced verbatim below; no DOM, no fetch.
- **Steps**:
  1. Write the reference script (byte-for-byte copy of `formatChunkTs` from `LogTail.tsx:57-61`, plus a valid/invalid/empty/malformed matrix):
     ```bash
     mkdir -p /Users/davidtaylor/Repositories/tmux-conductor/tmp
     cat > /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat110-formatters.mjs <<'EOF'
     function formatChunkTs(ts) {
       const d = new Date(ts)
       if (Number.isNaN(d.getTime())) return ts
       return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
     }
     let ok = true
     const validIso = '2026-07-06T10:00:00Z'
     const validResult = formatChunkTs(validIso)
     if (validResult === validIso || validResult.length === 0) {
       ok = false
       console.log('MISMATCH valid-iso', JSON.stringify(validResult), 'should be a non-empty, transformed label distinct from the raw ts')
     }
     const invalidStr = 'not-a-date'
     const invalidResult = formatChunkTs(invalidStr)
     if (invalidResult !== invalidStr) {
       ok = false
       console.log('MISMATCH invalid-string', JSON.stringify(invalidResult), '!==', JSON.stringify(invalidStr))
     }
     const emptyStr = ''
     const emptyResult = formatChunkTs(emptyStr)
     if (emptyResult !== emptyStr) {
       ok = false
       console.log('MISMATCH empty-string', JSON.stringify(emptyResult), '!==', JSON.stringify(emptyStr))
     }
     const malformed = '2026-99-99T99:99:99Z'
     const malformedResult = formatChunkTs(malformed)
     if (malformedResult !== malformed) {
       ok = false
       console.log('MISMATCH malformed', JSON.stringify(malformedResult), '!==', JSON.stringify(malformed))
     }
     console.log(ok ? 'ALL PASS' : 'FAIL')
     EOF
     ```
  2. Run the command below as-is.
- **Command**:
  ```bash
  node /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat110-formatters.mjs
  ```
- **Expected Result**: Prints `ALL PASS` with no `MISMATCH` lines (verified by running this exact script before writing this file). Deliberately does **not** assert the specific `toLocaleString` output string — only that a valid timestamp produces a transformed, non-empty label, and that every unparseable input (a non-date string, an empty string, and an out-of-range malformed date-shaped string) falls back to the raw `ts` unchanged. Cleanup: `rm /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat110-formatters.mjs`.
- **Repeatable Unit Test**: Blocked: `formatChunkTs` is promotable in principle (pure, deterministic, no I/O) but `frontend/` has no configured test runner (no vitest/jest, no `*.test.tsx` anywhere in `frontend/`) — adding one would be new test infrastructure, out of scope for this run. The reference script above pins the exact logic read from source as a browser-free, re-runnable check in lieu of a promoted file, matching the UAT-074/UAT-076 precedent for this same file's other pure formatters.
- [x] Pass <!-- 2026-08-15 -->

### UAT-STATIC-001: `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/`
- **Scenario**: TASK-110's Acceptance Criteria require a clean typecheck and build after adding `formatChunkTs`, the `Fragment` import, and the per-chunk marker JSX.
- **Steps**:
  1. Run the commands below.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/frontend && npx tsc --noEmit
  ```
- **Expected Result**: Exits with no output and status 0 (zero type errors). Verified passing at generation time. (`npm run build` was also verified clean during this task's `/tackle` run — 71 modules transformed, only the pre-existing >500kB chunk-size advisory, not an error — and is not a separate machine-checkable assertion beyond re-running the same build.)
- **Repeatable Unit Test**: Not applicable: this command *is* the static gate itself, re-run verbatim; wrapping it in a unit test would just re-invoke the same compiler check.
- [x] Pass <!-- 2026-08-15 -->

### UAT-UI-001: History view renders a distinct formatted timestamp above each chunk, oldest-first
- **Page**: `http://localhost:4321/`
- **Description**: For an agent with multiple persisted `agent_terminal_log` rows, switching `LogTail` to History mode renders one timestamp marker per chunk, positioned directly above it, in the same oldest-first order as the underlying rows (`historyLog.map` → `<Fragment key={entry.id}>` wrapping a `formatChunkTs(entry.ts)` label above the `<pre>` chunk). The marker count must equal the chunk count — no chunk is left unlabeled, no stray extra marker appears.
- **Auth-Required**: false
- **Steps**:
  1. Create a fixture agent and seed three rows exactly as in UAT-API-001 Steps 1–2, using a distinct name (e.g. `uat110uihappy`) so it doesn't collide with a concurrently running API test.
  2. Open the dashboard at `http://localhost:4321/`.
  3. Click the `uat110uihappy` agent's card to open its detail modal.
  4. In the log panel's header row, click the "History" toggle button.
  5. Observe the history list: 3 entries, each preceded immediately by a small muted timestamp label; the order top-to-bottom matches oldest-first (the `09:00` row first, `10:00` second, `11:00` last — matching the `ts` values seeded in UAT-API-001).
  6. Count the visible timestamp labels: exactly 3, one per chunk (matches `log.length` from `GET /api/agents/:id/log` for this agent).
  7. Cleanup: close the modal, then `curl -sS -X DELETE "http://localhost:8788/api/agents/$UID"` for this fixture's id.
- **Expected Result**: Exactly 3 chunk blocks are visible in History mode, each with its own timestamp label directly above it, in oldest-first order. No chunk renders without a label; no label renders without a corresponding chunk. No `entry.ts` raw ISO string is shown verbatim (it is always passed through `formatChunkTs`, never rendered raw) unless the fixture's seeded timestamp happens to be unparseable (not the case here).
- **Repeatable Unit Test**: Not applicable: verifies browser rendering, DOM ordering, and count of a React component's output; the frontend has no component test harness (no vitest/jsdom present in this repo). The underlying label-derivation and ordering/count *data* are pinned browser-free in UAT-EDGE-001 and UAT-API-001 respectively — this case confirms they actually reach the screen.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-22 -->

### UAT-UI-002: Zero-row history shows the existing empty state with no stray marker; Live mode is unaffected
- **Page**: `http://localhost:4321/`
- **Description**: TASK-110 must not disturb TASK-109's empty-state branch (`historyLog !== null && historyLog.length === 0` → "No persisted history yet.") or Live mode — the marker only renders inside the populated branch's `.map`, so a zero-row agent must show no timestamp UI at all, and switching back to Live must behave exactly as TASK-109 left it (xterm terminal reappears instantly, no re-fetch, no blank flash).
- **Auth-Required**: false
- **Steps**:
  1. Create a fixture agent with no history seeded (skip the `agent_terminal_log` insert step), using a distinct name (e.g. `uat110uizero`).
  2. Open the dashboard, click the `uat110uizero` agent's card, click "History".
  3. Confirm the panel shows only "No persisted history yet." — no timestamp label, no empty `<pre>` block, no stray divider.
  4. Click "Live" — confirm the xterm terminal reappears instantly (no blank flash, no re-fetch of `/tail`) and the Direct Input form reappears.
  5. Cleanup: close the modal, then `curl -sS -X DELETE "http://localhost:8788/api/agents/$ZID"` for this fixture's id.
- **Expected Result**: History mode shows exactly the "No persisted history yet." message and nothing else; Live mode toggling behaves identically to TASK-109's landed behaviour (unaffected by this task).
- **Repeatable Unit Test**: Not applicable: verifies absence of a rendered DOM element and Live-mode toggle timing in the actual browser; no frontend component test harness exists.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-22 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| Each rendered history chunk shows a formatted timestamp marker sourced from `entry.ts`, positioned directly above its chunk | UAT-UI-001 (rendering), UAT-EDGE-001 (label-derivation contract), UAT-API-001 (every entry carries `ts`) |
| No gap-detection/idle-threshold logic — every chunk gets a marker unconditionally | UAT-UI-001 (marker count == chunk count) |
| Live mode, the Live/History toggle, the fetch behavior, and the Direct Input form TASK-109 built are all untouched | UAT-UI-002 |
| No `host-server/` or `frontend/src/lib/api.ts` changes | Static/code-review concern already gated by [[TASK-110]]'s own steps — not a new runtime behavior, no separate UAT case (same precedent as UAT-063/076's typecheck line) |
| `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/` | UAT-STATIC-001 |

**Note on `uatGenerate.promoteTests`**: the stored preference (`true`, legacy grammar) maps to `dedicated` for this run, but no new promotable unit test exists to place anywhere — `formatChunkTs` is frontend-only logic and `frontend/` has no test runner at all (no vitest/jest, no existing test files), so it is pinned as a machine-verifiable, browser-free reference script inside UAT-EDGE-001 instead (same approach as UAT-074/UAT-076, both generated in this same session for sibling `frontend/` formatters). UAT-API-001's supporting DB precondition is pre-existing (`db.ts`) behaviour, not introduced by this task, so no new backend test was added either.

**Split summary**: 3 of 5 cases execute a real, machine-checkable verdict with no human in the loop (UAT-API-001 via live curl, UAT-EDGE-001 via a verified Node reference script, UAT-STATIC-001 via the typecheck command); the remaining 2 (UAT-UI-001, UAT-UI-002) are DOM-rendering-only and fail-close to human verification via `/uat-walk`, per UAT-CORE's UI rule.
