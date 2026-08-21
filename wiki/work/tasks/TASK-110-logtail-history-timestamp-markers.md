---
id: TASK-110
aliases: [TASK-110]
title: "Session boundary markers — per-chunk timestamp dividers in LogTail history view"
status: pending-uat
created: 2026-07-06
updated: 2026-07-06
depends_on: [TASK-109]
blocks: []
parallel_safe_with: [TASK-001, TASK-011, TASK-050, TASK-061, TASK-062, TASK-063, TASK-066, TASK-069, TASK-070, TASK-071, TASK-072, TASK-074, TASK-076, TASK-106, TASK-107, TASK-108]
uat: "[[UAT-110]]"
tags: [frontend, terminal, logging, session-recording, observability, roadmap-010]
---

# TASK-110 — Session boundary markers — per-chunk timestamp dividers in LogTail history view

## Objective

Once [TASK-109](TASK-109-logtail-history-toggle.md)'s History toggle has landed in `frontend/src/components/LogTail.tsx`, render a formatted-timestamp divider between/above each chunk in History mode so an operator scanning historical output can see where one persisted poll-tick snapshot ends and the next begins. This is Phase 2 item 5 of ROADMAP-010 (Session Recording) — the last item in the phase. Scope is strictly the render-site insertion at the code comment TASK-109 leaves in its per-chunk `.map` call. No `host-server`/`db.ts` changes: the `ts` column has existed since TASK-106's schema and already flows through `listTerminalLog` → TASK-108's `GET /agents/:id/log` → TASK-109's local `HistoryLogEntry.ts` field, untouched and unused until now — this task only renders what is already being fetched.

## Approach

- **HARD BLOCKER, verified at task-creation time:** TASK-109 has **not landed yet**. `mcp__serena__search_for_pattern` for `viewMode|historyLog|HistoryLogEntry|session-boundary|entry\.ts` in `frontend/src/components/LogTail.tsx` returned zero matches, and `mcp__serena__get_symbols_overview` on that file shows only the pre-existing `TailResponse` interface — no `HistoryLogEntry`, no `viewMode` state, no history render branch. The most recent commit touching this file (`53152c4`, "Fix xterm terminal init timing, snapshot race, and WS connect race in LogTail") is unrelated to TASK-109's toggle work. **This is a hard stop, not a soft caution** — there is no comment-marked insertion point, no `historyLog` array, and no `HistoryLogEntry.ts` field to render from until TASK-109 is merged. Do not attempt any workaround (e.g. building the insertion point yourself) — that is TASK-109's scope, not this task's.
- **Design decision (made explicitly here, not left open):** the `agent_terminal_log` schema (TASK-106) has no session concept — each row is one independent full-pane snapshot at one poll tick, not a diff, and there is no `session_id`/`session_start` column. "Session boundary" therefore cannot mean anything more precise than "the boundary between two persisted chunks." Rather than inventing a synthetic idle-gap heuristic (e.g. only flagging boundaries where the gap between consecutive `ts` values exceeds some threshold) that the schema doesn't actually support and that would misrepresent the data, the simpler and more honest interpretation is chosen: render one timestamp label per chunk, unconditionally, reusing `entry.ts` as-is. No gap-detection/threshold logic.
- **Insertion site:** inside TASK-109's `historyLog.map(...)` call in the History-mode render branch of `LogTail`, at the exact code comment TASK-109's Step 5 leaves noting that "session-boundary timestamp markers (using `entry.ts`) will be inserted here by a future task." Add a small divider/label row immediately above each chunk's `<pre>` block, inside the same `.map` callback, showing a formatted `entry.ts`.
- **Timestamp formatting:** mirror the existing house precedent in `frontend/src/components/AgentList.tsx`'s `formatSessionStart(s: string)` helper (added for TASK-076's usage session table): `new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })`. Use the same month/day/hour/minute shape — history rows can span hours or days depending on poll frequency and TASK-106's `maxRowsPerAgent` cap, so a time-only format (like `LogTail.tsx`'s existing `new Date().toLocaleTimeString()`, used only for the live `lastOutputAt` debug field) is insufficient. Add a small **local** helper in `LogTail.tsx` (e.g. `formatChunkTs`) rather than importing `AgentList.tsx`'s private function or introducing a new shared util — this follows TASK-109's own precedent of keeping `HistoryLogEntry`/`HistoryLogResponse` local to `LogTail.tsx` instead of `frontend/src/lib/api.ts`.
- **Styling:** render the marker as a thin, visually distinct divider row — small muted text (e.g. `text-[10px] text-muted-2 uppercase tracking-wide`) — sitting directly above each chunk's `<pre>` block, inside the same dark scrollable container (`bg-[#0b0b0d]`, etc.) TASK-109 built. Do not introduce a new outer container, do not restyle the existing history view shell, and do not touch the Live-mode xterm container or the Live/History toggle UI.
- **Keys:** give each marker element a stable React key distinct from the chunk's own key (e.g. `key={`${entry.id}-ts`}`) alongside the existing `key={entry.id}` on the `<pre>` block, since both are siblings inside the same `.map` callback — React needs unique keys per top-level element returned from the callback (wrap marker + `<pre>` in a `<Fragment key={entry.id}>` or an equivalent single wrapper, whichever keeps the diff minimal against TASK-109's landed structure).
- **Hot-file discipline (re-asserting TASK-109's own warning — it applies with equal force to whatever TASK-109 actually lands):** `frontend/src/components/LogTail.tsx` has been actively edited across multiple recent tasks (the xterm timing/race fix already landed; TASK-109's toggle work is pending as of this writing). Do not trust any line numbers or exact JSX recorded in TASK-109's task file — TASK-109 itself warned that its own recorded line numbers had already drifted before landing. All edits must be Serena symbol-level operations: `mcp__serena__find_symbol` on `LogTail` with `include_body=true` to re-read the current body immediately before editing, then `mcp__serena__replace_symbol_body` or a targeted `mcp__serena__insert_after_symbol`/`mcp__serena__replace_content` for the small insertion. Never a whole-file read/rewrite.

## Steps

### 1. Confirm TASK-109 has landed — hard stop otherwise  <!-- agent: Explore -->

- [x] `mcp__serena__search_for_pattern` for `viewMode|historyLog|HistoryLogEntry` in `frontend/src/components/LogTail.tsx`. **If this still returns zero matches, STOP — do not proceed with any further step in this task.** Report back that TASK-109 remains unmerged.
- [x] If matches are found, `mcp__serena__find_symbol` on `LogTail` with `include_body=true` to re-read the actual landed History-mode render branch, the `historyLog.map(...)` call, and the code comment marking the timestamp-marker insertion point. Note the current line range — do not trust anything recorded in TASK-109's task file or in this task's Approach section.
- [x] Confirm the exact shape of `HistoryLogEntry` (should include `ts: string` per TASK-109's spec) and the chunk `<pre>` block's current `key`/`className` so the new marker matches its surrounding structure exactly.

<!-- Updated: 2026-08-15 — Hard-stop gate PASSED: viewMode/historyLog/HistoryLogEntry all present (TASK-109 landed). History render branch lines 670-687; insertion comment at line 679: "{/* Session-boundary timestamp markers (using entry.ts) will be inserted here by a future task. */}" immediately before `historyLog?.map(...)` at line 680. HistoryLogEntry (lines 21-26) has ts: string. Chunk <pre> (line 681): key={entry.id}, className="whitespace-pre-wrap break-all font-mono text-[11px] text-[#e7e8ea] px-2 py-1". React import (line 1) has no Fragment yet: `import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FocusEvent, type KeyboardEvent } from 'react'`. -->

### 2. Add a local timestamp-formatting helper  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/LogTail.tsx`, add a small local helper near the top of the file (module scope, alongside other free functions like `isExpandShortcut`/`mapKey`):
  ```ts
  function formatChunkTs(ts: string): string {
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return ts
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  ```
- [x] Do not import or reuse `AgentList.tsx`'s `formatSessionStart` — keep this local to `LogTail.tsx`.

<!-- Updated: 2026-08-15 — formatChunkTs inserted verbatim immediately after the existing mapKey helper (lines 57-61) via insert_after_symbol; AgentList.tsx untouched. tsc --noEmit: single expected TS6133 "declared but never read" error, will clear once Step 3 consumes it. -->

### 3. Insert the per-chunk timestamp marker at TASK-109's comment-marked site  <!-- agent: general-purpose -->

- [x] **Hot file — re-read the current `historyLog.map(...)` callback immediately before this edit** (per Step 1). At the code comment TASK-109 leaves, replace the bare `<pre key={entry.id} ...>{entry.chunk}</pre>` return value with a wrapper that renders the timestamp marker above the chunk, e.g.:
  ```tsx
  <Fragment key={entry.id}>
    <div className="px-2 pt-1 text-[10px] uppercase tracking-wide text-muted-2">
      {formatChunkTs(entry.ts)}
    </div>
    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-[#e7e8ea] px-2 py-1">
      {entry.chunk}
    </pre>
  </Fragment>
  ```
  - Import `Fragment` from `react` if not already imported in this file (check the existing `import` line at the top of `LogTail.tsx` first — append to the existing `react` import rather than adding a new import statement).
  - Match whatever `className`/exact JSX TASK-109 actually landed with rather than the string above verbatim if it has drifted (per Step 1's re-read).
- [x] Confirm no other part of the History render branch (loading/error/empty states, the outer scrollable container, the Live/History toggle, the Direct Input form) is touched.

<!-- Updated: 2026-08-15 — `Fragment` appended to the existing react import. historyLog.map now returns <Fragment key={entry.id}> wrapping a text-[10px] uppercase tracking-wide text-muted-2 timestamp div (formatChunkTs(entry.ts)) above the unchanged <pre> chunk block; obsolete insertion-point comment removed (fulfilled). Live-edit matched the pre-recorded snapshot exactly, no drift. Loading/error/empty states, outer container, toggle, and Direct Input form all verified untouched. tsc --noEmit: zero errors. -->

### 4. Typecheck and build  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` in `frontend/` — zero errors.
- [x] Run `npm run build` in `frontend/` — clean build.

<!-- Updated: 2026-08-15 — both clean: tsc --noEmit exit 0 no output; npm run build (tsc && vite build) exit 0, 71 modules transformed, only the pre-existing >500kB chunk-size advisory (not an error). -->

### 5. Manual smoke test  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] With an agent that has multiple persisted `agent_terminal_log` rows, open the agent detail modal, switch to History mode — confirm each chunk shows a distinct formatted timestamp directly above it, in chronological (oldest-first) order matching the chunk order.
- [DEFERRED-TO-UAT] Confirm Live mode is unaffected: switch back to Live, verify the xterm terminal and Direct Input form still behave exactly as TASK-109 left them (no re-fetch, no blank flash).
- [DEFERRED-TO-UAT] With an agent that has zero persisted rows, confirm the existing "No persisted history yet." empty state is unchanged (no stray timestamp marker rendered).

<!-- Updated: 2026-08-15 — runtime/UI smoke test deferred to UAT phase per tackle's static-gates-only rule (matches the TASK-109 precedent in this repo); Steps 1-4 (implementation + tsc + build) are all complete and clean. -->

## Acceptance Criteria

- [ ] Each rendered history chunk in `LogTail`'s History mode shows a formatted timestamp marker sourced from `entry.ts`, positioned directly above its chunk.
- [ ] No gap-detection/idle-threshold logic — every chunk gets a marker unconditionally.
- [ ] Live mode, the Live/History toggle, the fetch behavior, and the Direct Input form TASK-109 built are all untouched.
- [ ] No `host-server/` or `frontend/src/lib/api.ts` changes.
- [ ] `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/`.

## Dependencies

- **DEPENDS ON [TASK-109](TASK-109-logtail-history-toggle.md) — HARD BLOCKER, not yet merged as of this task's creation.** Verified via `mcp__serena__search_for_pattern` for `viewMode|historyLog|HistoryLogEntry` in `frontend/src/components/LogTail.tsx` returning zero matches at task-creation time. This task has nothing to attach to — no `historyLog` array, no `HistoryLogEntry.ts` field consumed anywhere, no comment-marked insertion point — until TASK-109 lands. Step 1 re-verifies this and is a hard stop if still absent.
- **Hot-file coordination:** `frontend/src/components/LogTail.tsx` is the same actively-edited file TASK-109 itself flagged (xterm init-timing/snapshot-race/WS-connect-race fix landed most recently). Re-read via `find_symbol` immediately before every edit, per the Approach section's Hot-file discipline note — do not trust line numbers recorded in TASK-109's file or in this one.
- **Does not depend on TASK-106/107/108 directly** — those are already transitively required by TASK-109 (which depends on TASK-108, which depends on TASK-106; TASK-107 is independent of this render path). This task only needs TASK-109's landed frontend code.

### Roadmap

Implements ROADMAP-010 Phase 2, item "Display session boundary markers (timestamps) when rendering the historical log" — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`. This is the fifth and final Phase 2 item; once linked, Phase 2 is fully materialized into task files (TASK-106 through TASK-110).
