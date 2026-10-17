---
id: TASK-0224
aliases: [TASK-0224]
title: "Add a lib/lastPayload.ts per-agent localStorage store with tests"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0220]
blocks: []
parallel_safe_with: []
uat: "[[UAT-0224]]"
tags: [last-payload, localstorage, frontend, agents, dashboard]
---

# TASK-0224 — Add a lib/lastPayload.ts per-agent localStorage store with tests

relates_to::[[hook-authoritative-last-prompt]]
relates_to::[[last-user-message-capture]]
relates_to::[[terminal-typed-command-persistence]]
depends_on::[[TASK-0220]]

> **Roadmap**: ROADMAP-0027 Phase 3, item 1. Research: `raw/research/last-user-message-capture/index.md` (capture design) and `raw/research/terminal-typed-command-persistence/index.md` (store shape, `useSyncExternalStore` guidance).
> **Collision note**: creates two new files only and touches no component, so it is parallel-safe with every other ROADMAP-0027 task that edits `AgentList.tsx`, `host-server/index.ts` or `hooks/`. Its consumers (the SSE-mirror, strip, card and agent-delete tasks in Phase 3, plus TASK-0223's Add Task submit recording) import it and must be sequenced after it.

## Objective

Provide the frontend's per-agent "last user payload" store: a pure `frontend/src/lib/lastPayload.ts` module that persists `{ text, ts, source }` per agent id in `localStorage` under `conductor:lastPayload:<agentId>`, resolves conflicts between sources by newest timestamp, notifies same-tab and cross-tab subscribers, and exposes a `useLastPayload(agentId)` hook built on `useSyncExternalStore`. It also exports the pure `firstLinePreview(text)` display helper so the detail-pane strip and the sidebar card render multi-line payloads identically. This task ships the library and its tests only; wiring it into the SSE stream, Add Task submit, the strip and the card belongs to the other ROADMAP-0027 items.

## Approach

- **Model on `frontend/src/lib/agentOrder.ts`** (module-constant key, pure `load*`/`save*`/`clear*` helpers, every storage access in `try/catch` that degrades silently) and `agentOrder.test.ts` (`localStorage.clear()` + `vi.restoreAllMocks()` in `beforeEach`; `vi.spyOn(Storage.prototype, 'getItem'|'setItem')` throw-injection). Note `agentId` is a `number` in this codebase (`conductor:sendDraft:${agentId.toString()}` in `LogTail.tsx`), so the key is built with `agentId.toString()`.
- **Entry shape**: `interface LastPayloadEntry { text: string; ts: string; source: 'hook' | 'add-task' }`. `ts` is an ISO-8601 string (the hook sidecar's `last_prompt.ts` and the server's `lastPrompt.ts` are ISO strings), compared with `Date.parse`. An unparsable `ts` on a stored or incoming entry is treated as `-Infinity`/oldest (a valid one always wins over it; two unparsable ones: incoming wins so a corrupt record can still be overwritten).
- **Newest-ts-wins** (the storage rule decided in TASK-0220; if TASK-0220 records a different tie-break or cap, follow it and note the deviation here): `saveLastPayload(agentId, entry)` reads the current entry and stores the incoming one only when `Date.parse(entry.ts) >= Date.parse(current.ts)` (ties go to the incoming entry so an idempotent SSE re-delivery re-notifies nothing but a same-ts different-source write still lands). Returns `true` when it stored, `false` when it rejected (empty/whitespace text, older ts, or storage threw).
- **Sanitising on write**: ignore entries whose `text.trim()` is empty; cap `text` at `LAST_PAYLOAD_MAX_CHARS = 2000` (match the hook's cap in `hooks/lib/write-state.js`; truncate with `slice`, no ellipsis, since display truncation is CSS). Do not trim the stored text (the payload is verbatim); only the empty-check trims.
- **Validation on read**: `loadLastPayload` returns `null` for missing key, corrupt JSON, non-object JSON, or an object missing a string `text`/string `ts`; an unknown or missing `source` falls back to `'hook'`. It never throws.
- **Store for `useSyncExternalStore`**:
  - Module-level `listeners = new Set<() => void>()`; `subscribeLastPayload(listener)` adds it, lazily attaches a single `window` `storage` event handler on the first subscriber (removed when the last one leaves; guarded for `typeof window === 'undefined'`), and returns an unsubscribe function. The `storage` handler only notifies when `event.key === null` (clear-all) or starts with `LAST_PAYLOAD_KEY_PREFIX`, and drops that agent's cached snapshot first.
  - `saveLastPayload` and `clearLastPayload` call `notify()` after a successful mutation, because `localStorage` does not notify the writing tab.
  - `getLastPayloadSnapshot(agentId)` returns a cached immutable value that is referentially stable per agent id: a module `Map<number, LastPayloadEntry | null>` filled on first read (via `loadLastPayload`) and invalidated only by `save`/`clear`/the `storage` handler for that id. This satisfies React's `Object.is` snapshot contract (returning a fresh `JSON.parse` result every call would loop forever).
  - `useLastPayload(agentId: number): LastPayloadEntry | null` = `useSyncExternalStore(subscribeLastPayload, () => getLastPayloadSnapshot(agentId), () => null)`. `subscribeLastPayload` is a module-level function (declared outside any component) so its identity is stable.
  - Export a `__resetLastPayloadCacheForTests()` that clears the snapshot cache and listener set (so `localStorage.clear()` in `beforeEach` does not leave a stale cache; jsdom's `localStorage.clear()` does not fire `storage` in the same window).
- **Display helper**: `firstLinePreview(text: string): string` returns the first line of `text.split(/\r?\n/)` whose `trim()` is non-empty (trimmed), followed by `' …'` when any further non-empty line exists; returns `''` when there is no non-empty line. Pure, no React import, shared by the strip and the sidebar card.
- **Public API (exact names)**: `LAST_PAYLOAD_KEY_PREFIX` (`'conductor:lastPayload:'`), `LAST_PAYLOAD_MAX_CHARS`, `LastPayloadEntry`, `loadLastPayload(agentId)`, `saveLastPayload(agentId, entry)`, `clearLastPayload(agentId)`, `subscribeLastPayload(listener)`, `getLastPayloadSnapshot(agentId)`, `useLastPayload(agentId)`, `firstLinePreview(text)`.
- **Out of scope**: mirroring SSE `lastPrompt` into the store, Add Task submit recording, replacing `activeTask` in the strip/card, and clearing on agent delete (all separate ROADMAP-0027 items); secret redaction (decided in TASK-0220, applied by callers or a later item, not here).

## Steps

### 1. Implement the store module  <!-- agent: general-purpose -->

- [x] Create `frontend/src/lib/lastPayload.ts` (new). Use Serena `get_symbols_overview` on `frontend/src/lib/agentOrder.ts` first and match its comment density, naming and `try { ... } catch { /* comment */ }` idiom.
  - Export `LAST_PAYLOAD_KEY_PREFIX`, `LAST_PAYLOAD_MAX_CHARS` (2000) and `LastPayloadEntry` (`text`, `ts`, `source: 'hook' | 'add-task'`).
  - `loadLastPayload(agentId: number): LastPayloadEntry | null` with the read-validation rules in Approach.
  - `saveLastPayload(agentId: number, entry: LastPayloadEntry): boolean`: reject blank text, cap at 2000, compare against `loadLastPayload` (newest `ts` wins, ties to incoming), `setItem` in `try/catch` returning `false` on throw, invalidate the snapshot cache entry, `notify()`, return `true`.
  - `clearLastPayload(agentId: number): void`: `removeItem` in `try/catch`, invalidate the cache entry, `notify()`.
  - `subscribeLastPayload(listener: () => void): () => void` with the shared-`storage`-listener behaviour described above; `getLastPayloadSnapshot(agentId: number): LastPayloadEntry | null` with the per-id cache; `useLastPayload(agentId: number)` via `useSyncExternalStore` (import from `'react'`).
  - `firstLinePreview(text: string): string` and `__resetLastPayloadCacheForTests(): void`.

### 2. Unit tests  <!-- agent: general-purpose -->

- [x] Create `frontend/src/lib/lastPayload.test.ts` (new) in the `agentOrder.test.ts` style: `beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); __resetLastPayloadCacheForTests() })`. Cases:
  - **Persisted value**: `saveLastPayload(1, entry)` returns `true`, `localStorage.getItem('conductor:lastPayload:1')` parses to the entry, `loadLastPayload(1)` round-trips it.
  - **Missing key** returns `null`; **corrupt JSON**, **non-object JSON**, and **object missing `text`/`ts`** all return `null` without throwing; an unknown `source` normalises to `'hook'`.
  - **Throwing storage**: `getItem` throwing makes `loadLastPayload` return `null` (and `getLastPayloadSnapshot` return `null`); `setItem` throwing makes `saveLastPayload` return `false` and not throw (spy on `Storage.prototype`, as in `agentOrder.test.ts`); `clearLastPayload` does not throw when `removeItem` throws.
  - **Newest wins**: a later `ts` replaces an earlier one; an earlier `ts` is rejected (`false`, stored value unchanged); an equal `ts` from a different `source` replaces; an unparsable stored `ts` is overwritten by a valid one.
  - **Blank text** (`''`, `'   \n'`) is ignored (returns `false`, nothing written).
  - **Cap**: a 5000-char text is stored as exactly 2000 chars.
  - **Per-agent isolation**: saving for agent 1 leaves agent 2 `null`; `clearLastPayload(1)` leaves agent 2's entry; keys are `conductor:lastPayload:1` / `:2`.
  - **Listener notification**: a subscribed listener is called once per successful `save` and per `clear`, and is NOT called for a rejected (older/blank) save; a `window.dispatchEvent(new StorageEvent('storage', { key: 'conductor:lastPayload:1' }))` after a direct `localStorage.setItem` from "another tab" notifies the listener and `getLastPayloadSnapshot(1)` then returns the new entry; an unrelated key does not notify.
  - **Unsubscribe**: after calling the returned function the listener is no longer called; unsubscribing the last listener removes the `window` `storage` handler (assert with a `vi.spyOn(window, 'removeEventListener')`).
  - **Snapshot stability**: two consecutive `getLastPayloadSnapshot(1)` calls return the same reference (`toBe`); the reference changes only after a `save`/`clear`.
  - **`firstLinePreview`**: single line returned as-is (trimmed); leading blank lines skipped; multi-line gets `' …'`; trailing blank lines do not add `' …'`; `\r\n` handled; empty/whitespace-only returns `''`.
  - **`useLastPayload`** (uses `@testing-library/react`, already a dependency; there is no `renderHook` precedent in the repo, so either `renderHook` or a tiny probe component with `render`): re-renders with the saved entry after `act(() => { saveLastPayload(...) })`, returns `null` for an unknown agent, and switches value when the `agentId` prop changes. Put the hook cases in the same file (it is a `.test.ts`, so use `createElement` rather than JSX, or use `renderHook`).

### 3. Verify  <!-- agent: general-purpose -->

- [x] `cd frontend && npx vitest run src/lib/lastPayload.test.ts src/lib/agentOrder.test.ts`, then `npm run typecheck && npm run lint`. Confirm `git status` shows only the two new files under `frontend/src/lib/` (no component touched).

## Implementation notes

<!-- Updated: 2026-09-20 -->

Implemented 2026-09-20. Decisions and deviations from the Approach text (all follow the reconciled TASK-0220 rules):

- **Cap**: total 2000 UTF-16 code units: text over the cap becomes the first 1999 units plus a single `…` (a dangling high surrogate at the cut is dropped, giving 1998 + `…`). Text at or under 2000 is untouched, so re-capping is idempotent. This replaces the earlier "slice, no ellipsis" wording.
- **Tie-break**: exact `ts` tie goes to `hook` over `add-task` (not "always incoming"). A same-source tie replaces only when the text differs, so an identical SSE re-delivery returns `false` and notifies nobody. Both `ts` unparseable: incoming wins. Unparseable counts as oldest otherwise.
- **`agentId: number`** on every public function; key built with `agentId.toString()`.
- `saveLastPayload` normalises an unknown `source` to `'hook'` on write as well as on read.
- Structured for `sweepOrphanedLastPayloads` (TASK-0228) to be added trivially: module-private `keyFor`, `snapshotCache` and `notify` helpers exist; iterate `localStorage` keys with `LAST_PAYLOAD_KEY_PREFIX`.
- Verification (static only): `npx vitest run src/lib/lastPayload.test.ts src/lib/agentOrder.test.ts` 60/60 pass; `tsc --noEmit` clean for the whole frontend; `eslint` clean on both new files. `git status` shows only the two new files under `frontend/src/lib/` from this task.

## Files expected to be touched

- `frontend/src/lib/lastPayload.ts` (new)
- `frontend/src/lib/lastPayload.test.ts` (new)

No component, `host-server/`, `hooks/`, wiki index, log or hot-cache files (the orchestrator maintains the shared wiki files).

## Dependencies

- TASK-0220
- Downstream consumers (not declared as `blocks` here; they are ROADMAP-0027 Phase 2/3 items not yet filed): the SSE-mirror task, the Add Task submit-recording task (TASK-0223), the strip and sidebar-card display tasks, and the delete-agent cleanup task.

## Notes

Guardrails for whoever implements this task:

- Never run `install-hooks.sh` against the real `~/.claude`, and never edit `~/.claude/settings.json`.
- Never kill or restart tmux windows/sessions, or the running host-server / dev servers (other agents share this live environment; the dev servers hot-reload the new files on their own).
- Live-fleet verification (real agents, real hook round trip, reload persistence in a browser) is a documented UAT step for a human, not something an autonomous agent performs. This task's verification is static (vitest, typecheck, lint) only.
- Other agents edit this repo concurrently; re-read a file with Serena immediately before editing, and stage only the two files listed above.
- Use Serena for code exploration and editing per `wiki/guides/mcp-tools.md`; temporary files go in `./tmp/` if needed.
