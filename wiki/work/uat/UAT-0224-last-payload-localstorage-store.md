---
id: UAT-0224
aliases: [UAT-0224]
title: "UAT: Add a lib/lastPayload.ts per-agent localStorage store with tests"
status: pending
task: TASK-0224
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0224 — UAT: Add a lib/lastPayload.ts per-agent localStorage store with tests

implements::[[TASK-0224]]

> **Source task**: [[TASK-0224]]
> **Generated**: 2026-09-20

---

## Prerequisites

- [ ] Dependencies installed in `frontend/` (`cd frontend && npm install` if `node_modules` is missing). EDGE and INT-002 cases need nothing else: they run under vitest/jsdom with no dev server.
- [ ] For UAT-INT-001 only: the frontend dev server is running (`make dev`, frontend on `http://localhost:4321/`). Do NOT restart it; Vite hot-serves `/src/lib/lastPayload.ts` on its own.

Source under test (pure library, no component wiring yet; consumers are the other ROADMAP-0027 tasks):
- `frontend/src/lib/lastPayload.ts`: `LAST_PAYLOAD_KEY_PREFIX` (`'conductor:lastPayload:'`), `LAST_PAYLOAD_MAX_CHARS` (2000), `LastPayloadEntry`, `loadLastPayload`, `saveLastPayload`, `clearLastPayload`, `subscribeLastPayload`, `getLastPayloadSnapshot`, `useLastPayload`, `firstLinePreview`, `__resetLastPayloadCacheForTests`.
- `frontend/src/lib/lastPayload.test.ts`: 47 tests (the TASK-0224 tackle wrote 41; this generation run added 6 gap-closing tests, listed under the cases below).

Coverage note: every EDGE case is unit-backed by a file-scoped command that was run at generation time (all passing). The store has no UI yet, so the only manual case is UAT-INT-001 (two real browser tabs against the real Vite-served module), which was NOT run at generation time. Live-fleet verification (real hook round trip, SSE mirror, strip/card rendering) belongs to the downstream ROADMAP-0027 tasks' UATs, not this one.

Rule provenance: newest-ts-wins, tie-break, and the 2000-char cap with ellipsis are the TASK-0220 rules as reconciled in the TASK-0224 Implementation notes. Where the task's Approach text says "slice, no ellipsis" and "ties to incoming", the Implementation notes supersede it (1999 chars plus `…`; tie goes to `hook` over `add-task`). These cases assert the superseding rules.

---

## Test Cases

### UAT-EDGE-001: Entries persist under conductor:lastPayload:<agentId> with a numeric agentId and round-trip
- **Scenario**: `saveLastPayload(1, entry)` returns `true`; `localStorage['conductor:lastPayload:1']` parses to exactly `{ text, ts, source }`; `loadLastPayload(1)` returns the same value; the exported prefix is `'conductor:lastPayload:'`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `persists under conductor:lastPayload:<agentId> and round-trips` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (written by the TASK-0224 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "persists under conductor"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: Newest timestamp wins, compared as epoch milliseconds
- **Scenario**: A later `ts` replaces an earlier one; an earlier `ts` is rejected (`false`) and leaves the stored value unchanged; comparison is by parsed epoch, not lexical (`10:00:00.000+02:00` is two hours EARLIER than `10:00:00.000Z` even though it sorts later as a string).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `replaces an earlier entry with a later one`, `rejects an earlier ts and leaves the stored value unchanged` and `compares parsed epoch ms, not strings` pass (`Tests  3 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (written by the TASK-0224 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "replaces an earlier entry|rejects an earlier ts|compares parsed epoch ms"` — verified: 3 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: An exact timestamp tie goes to hook over add-task; an identical re-delivery is a silent no-op
- **Scenario**: Stored `add-task` entry then incoming `hook` entry with the same `ts`: replaced. Stored `hook` then incoming `add-task` at the same `ts`: rejected (`false`), `source` stays `hook`. Re-saving an identical entry (same ts, source, text) returns `false` and notifies no subscriber (so an SSE re-delivery cannot cause a re-render).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `on an exact tie, hook replaces add-task`, `on an exact tie, add-task does not replace hook` and `an identical re-delivery is a no-op that does not notify` pass (`Tests  3 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (written by the TASK-0224 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "on an exact tie|identical re-delivery"` — verified: 3 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: An unparseable ts counts as oldest; two unparseable ts let the incoming entry win
- **Scenario**: A valid incoming `ts` overwrites a stored entry whose `ts` is `not-a-date`; an unparseable incoming `ts` loses to a valid stored one; when both are unparseable the incoming entry wins so a corrupt record can be repaired.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `a valid ts overwrites an unparseable stored ts`, `an unparseable incoming ts loses to a valid stored ts` and `two unparseable ts values let the incoming entry win` pass (`Tests  3 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (written by the TASK-0224 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "unparseable"` — verified: 3 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-005: Text over 2000 chars is stored as exactly 2000 chars ending in an ellipsis; text within the cap is untouched and re-capping is idempotent
- **Scenario**: A 5000-char text is stored as 1999 chars plus one `…` (length exactly 2000, `LAST_PAYLOAD_MAX_CHARS`); text of exactly 2000 chars is stored verbatim; re-saving an already-capped value (newer ts) does not truncate it again.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `leaves text at exactly the cap untouched`, `stores a 5000-char text as exactly 2000 chars: 1999 plus one ellipsis` and `is idempotent: an already-capped value is not re-truncated` pass (`Tests  3 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (written by the TASK-0224 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "leaves text at exactly|5000-char|is idempotent"` — verified: 3 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-006: The cap never splits a surrogate pair
- **Scenario**: Text whose 2000-unit cut would fall between the two code units of an astral character (`'a'*1998 + '😀' + 'b'*100`) is stored as `'a'*1998 + '…'` (the dangling high surrogate is dropped, length 1999), never as a lone surrogate.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `does not split a surrogate pair at the cut` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (written by the TASK-0224 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "surrogate pair"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-007: Blank or whitespace-only text is never stored and never overwrites a real payload; stored text is not trimmed
- **Scenario**: `''` and `'   \n'` return `false` and write nothing; a blank save with a NEWER ts still leaves the previous real payload intact; non-blank text with padding (`'  padded\n'`) is stored verbatim (only the emptiness check trims).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `ignores blank text without writing`, `never overwrites a stored payload with blank text` and `does not trim stored text` pass (`Tests  3 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (written by the TASK-0224 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "ignores blank|never overwrites a stored payload with blank|does not trim"` — verified: 3 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-008: Missing key, corrupt JSON, non-object JSON, missing text/ts all load as null; unknown source normalises to hook
- **Scenario**: `loadLastPayload` returns `null` (never throws) for a missing key, `{not json`, `"a string"`, `null`, objects lacking `text` or `ts`, and a non-string `text`. An unknown or missing `source` reads back as `'hook'`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `returns null for a missing key`, `returns null for corrupt JSON, non-object JSON and objects missing text/ts` and `normalises an unknown or missing source to 'hook'` pass (`Tests  3 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (written by the TASK-0224 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "returns null for a missing key|corrupt JSON|normalises an unknown or missing source"` — verified: 3 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-009: A throwing localStorage degrades silently on every entry point
- **Scenario**: With `Storage.prototype.getItem` throwing, `loadLastPayload` and `getLastPayloadSnapshot` return `null` and `saveLastPayload` does not throw; with `setItem` throwing, `saveLastPayload` returns `false` without throwing; with `removeItem` throwing, `clearLastPayload` does not throw.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `degrades silently when storage throws`, `returns false and does not throw when setItem throws`, `clearLastPayload does not throw when removeItem throws` and `a throwing getItem does not stop a save from being attempted` pass (`Tests  4 passed`). The last one was added by this generation run to cover `saveLastPayload` under a throwing `getItem`.
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (3 written by the TASK-0224 tackle; `a throwing getItem does not stop a save from being attempted` added by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "degrades silently|setItem throws|removeItem throws|throwing getItem"` — verified: 4 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-010: Per-agent isolation
- **Scenario**: Saving for agent 1 leaves agent 2 `null`; entries live under distinct keys `conductor:lastPayload:1` and `:2`; `clearLastPayload(1)` removes only agent 1's entry.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `saving for one agent leaves another null and clear only affects its own key` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (written by the TASK-0224 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "per-agent isolation"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-011: Same-tab listeners fire once per successful save/clear and never for rejected saves
- **Scenario**: A subscribed listener is called once after a successful save, NOT called for an older-ts save or a blank save, and called once more for a clear (localStorage does not notify the writing tab, so the store must).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `notifies once per successful save and per clear, not for rejected saves` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (written by the TASK-0224 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "notifies once per successful save"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-012: Cross-tab `storage` events notify subscribers, refresh the snapshot, and ignore unrelated keys
- **Scenario**: A `storage` event for `conductor:lastPayload:1` after a direct `localStorage.setItem` (simulating another tab) notifies the listener once and `getLastPayloadSnapshot(1)` then returns the new entry; a `null` key (clear-all) notifies; an unrelated key (`conductor:agentOrder`) does not; a prefixed key with a non-numeric suffix notifies and invalidates cached snapshots; a mounted `useLastPayload(1)` re-renders with the cross-tab value.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Five tests pass (`Tests  5 passed`): `a storage event from another tab notifies and refreshes the snapshot`, `a storage event with a null key (clear-all) notifies`, `a storage event for an unrelated key does not notify`, `a storage event with a non-numeric agent suffix still notifies and refreshes every snapshot` (added by this run), `re-renders on a cross-tab storage event` (added by this run).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (3 by the TASK-0224 tackle; 2 added by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "storage event"` — verified: 5 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-013: Unsubscribe stops notifications and removes the shared window handler with the last listener
- **Scenario**: Two subscribers share exactly one `window` `storage` handler; after the first unsubscribes only the second is notified and the handler is still attached; after the last unsubscribes `removeEventListener('storage', …)` is called once. Unmounting a component using `useLastPayload` also detaches the handler, and a later save does not throw.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `stops calling a listener after unsubscribe and removes the window handler with the last one` and `unsubscribes on unmount so later saves do not touch a dead component` pass (`Tests  2 passed`). The second was added by this generation run.
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (1 by the TASK-0224 tackle; 1 added by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "stops calling a listener after unsubscribe|unsubscribes on unmount"` — verified: 2 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-014: getLastPayloadSnapshot is referentially stable until a save/clear (no render loop)
- **Scenario**: Two consecutive `getLastPayloadSnapshot(1)` calls return the same reference (`toBe`); the reference changes only after a save or clear; an agent with no payload returns a stable `null`. A mounted `useLastPayload` renders a bounded number of times (at most 2 on mount and at most 2 more per change), which would blow up if the snapshot were a fresh `JSON.parse` object each call.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `returns a referentially stable value until a save or clear`, `keeps a stable null for an agent with no payload` and `renders a bounded number of times per change (stable snapshot, no render loop)` pass (`Tests  3 passed`). The last was added by this generation run.
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (2 by the TASK-0224 tackle; 1 added by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "getLastPayloadSnapshot|bounded number of times"` — verified: 3 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-015: firstLinePreview behaviours
- **Scenario**: A single line is returned trimmed; leading blank lines are skipped; a payload with further non-empty lines gets a trailing `' …'` (`'first\nsecond'` becomes `'first …'`); trailing blank lines add no `' …'`; `\r\n` is handled; empty or whitespace-only text returns `''`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: All six `firstLinePreview` tests pass (`Tests  6 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (written by the TASK-0224 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "firstLinePreview"` — verified: 6 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-016: useLastPayload hook returns the saved entry, null for unknown agents, ignores other agents, and follows the agentId prop
- **Scenario**: `renderHook(() => useLastPayload(id))` returns `null` for an agent with no payload; re-renders with the entry after `act(() => saveLastPayload(...))` and back to `null` after `clearLastPayload`; a save for a different agent does not change the result; changing the `agentId` prop switches the returned value.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: All `useLastPayload` tests pass (`Tests  7 passed`: the 4 original hook tests plus the 3 added by this run: cross-tab re-render, bounded render count, unmount unsubscribe, which are also counted under EDGE-012/013/014).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (4 by the TASK-0224 tackle; 3 added by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "useLastPayload"` — verified: 7 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-017: An unknown source is normalised to hook on write as well as on read
- **Scenario**: `saveLastPayload` with a `source` outside `'hook' | 'add-task'` (cast through `unknown`) stores `source: 'hook'`, so localStorage never holds an invalid source even before the read-side normalisation applies.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `normalises an unknown source to 'hook' on write` passes (`Tests  1 passed`). Added by this generation run.
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (added by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "normalises an unknown source to 'hook' on write"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-001: Real browser, two tabs: persistence across reload and cross-tab sync against the Vite-served module
- **Scenario**: The unit tests use jsdom, whose `storage` event is synthetic. This case confirms the real behaviour: a payload written in tab A survives a reload, and tab B (subscribed) is notified by the browser's genuine cross-tab `storage` event. The store has no UI consumer yet, so it is driven from the DevTools console via the Vite dev server's module URL. NOT run at generation time.
- **Steps**:
  1. Open `http://localhost:4321/` in two tabs, A and B, in the same browser profile (not private mode).
  2. In tab B's console, subscribe: `const m = await import('/src/lib/lastPayload.ts'); m.subscribeLastPayload(() => console.log('B notified', m.getLastPayloadSnapshot(9)))`
  3. In tab A's console: `const a = await import('/src/lib/lastPayload.ts'); a.saveLastPayload(9, { text: 'hello\nworld', ts: new Date().toISOString(), source: 'add-task' })` and note it returns `true`.
  4. Look at tab B's console.
  5. In tab A's Application panel (Local Storage), find `conductor:lastPayload:9`.
  6. Reload tab A, then in its console run `(await import('/src/lib/lastPayload.ts')).loadLastPayload(9)`.
  7. In tab A: `a.saveLastPayload(9, { text: 'stale', ts: '2000-01-01T00:00:00.000Z', source: 'hook' })` (older ts).
  8. Cleanup in tab A: `a.clearLastPayload(9)` (this also notifies tab B).
- **Expected Result**:
  - Step 3: returns `true`.
  - Step 4: tab B logs `B notified` with an object whose `text` is `hello\nworld` and `source` is `add-task` (the writing tab's own listener is not needed; B gets the browser's cross-tab event).
  - Step 5: key `conductor:lastPayload:9` holds JSON `{"text":"hello\nworld","ts":"…","source":"add-task"}`.
  - Step 6: returns the same entry (persisted across reload).
  - Step 7: returns `false` and the stored value is unchanged (older ts rejected).
  - Step 8: the key disappears and tab B logs `B notified` with `null`.
- **Repeatable Unit Test**: Not applicable: requires a real browser, two tabs and the genuine cross-tab `storage` event; the logic is unit-backed by UAT-EDGE-002, UAT-EDGE-011 and UAT-EDGE-012
- [FAIL: auto-judge: real-browser two-tab check requires human verification — use /uat-walk] <!-- 2026-09-20 -->

---

### UAT-INT-002: Static gates are clean and only the two new library files were added
- **Scenario**: TASK-0224 Step 3 acceptance: the frontend typechecks and lints cleanly with the store and its tests in place, and the task touched no component (it is a library-only change).
- **Steps**:
  1. Run the command below.
  2. Run `git status --short frontend/src/lib/` and confirm `lastPayload.ts` and `lastPayload.test.ts` are the `lastPayload` entries and that no `frontend/src/components/` file was modified BY THIS TASK (other in-flight ROADMAP-0027 tasks may have modified components; judge by the two lastPayload files being self-contained: `grep -L "components/" frontend/src/lib/lastPayload.ts` should list the file, i.e. it imports nothing from components).
- **Command**:
  ```bash
  cd frontend && npx tsc --noEmit && npx eslint src/lib/lastPayload.ts src/lib/lastPayload.test.ts
  ```
- **Expected Result**: Both commands exit 0 with no output. `lastPayload.ts` imports only `useSyncExternalStore` from `react`.
- **Repeatable Unit Test**: Not applicable: a static typecheck/lint gate, not a behavioural assertion
- [x] Pass <!-- 2026-09-20 -->
