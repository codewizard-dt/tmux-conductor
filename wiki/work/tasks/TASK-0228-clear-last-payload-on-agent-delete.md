---
id: TASK-0228
aliases: [TASK-0228]
title: "Clear an agent's stored last payload when the agent is deleted, and verify clones keep separate payloads"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0227]
blocks: []
parallel_safe_with: []
uat: "[[UAT-0228]]"
tags: [last-payload, localstorage, frontend, agents, dashboard, cleanup]
---

# TASK-0228 — Clear an agent's stored last payload when the agent is deleted, and verify clones keep separate payloads

relates_to::[[hook-authoritative-last-prompt]]
relates_to::[[last-user-message-capture]]
relates_to::[[terminal-typed-command-persistence]]
depends_on::[[TASK-0227]]

> **Roadmap**: ROADMAP-0027 Phase 3 (frontend), the agent-delete cleanup item. Research: `raw/research/last-user-message-capture/index.md` and `raw/research/terminal-typed-command-persistence/index.md`.
> **Collision note**: edits `frontend/src/components/AgentList.tsx` (the `doRemove` function inside `AgentDetailView`, the `agent-removed` SSE handler and the initial `/status` load effect inside `AgentList`) and `AgentList.test.tsx`, the same files the strip/card tasks (TASK-0226, TASK-0227) and the SSE-mirror task (TASK-0225) edit, so it must run after them. It also adds one helper to `frontend/src/lib/lastPayload.ts` (created by TASK-0224), so it runs after that too (TASK-0224 is upstream of TASK-0225..0227, so declaring TASK-0227 covers it transitively).

## Objective

Make the browser-side last-payload store (`localStorage` key `conductor:lastPayload:<agentId>`, owned by `frontend/src/lib/lastPayload.ts`) forget an agent when, and only when, the agent is truly deleted, so a stale prompt can never appear on a different agent that later receives the same id. Also prove, with tests, that a cloned agent (`POST /agents/:id/clone`) starts with an empty payload because the store is keyed by agent id, never by workdir.

## Approach

- **Why this matters (verified, not hypothetical).** The `agents` table is `id INTEGER PRIMARY KEY` **without** `AUTOINCREMENT` (`host-server/db.ts` ~339), so SQLite reuses the id of the highest-numbered row after it is deleted. Without a clear, a brand-new agent or clone that is handed a reused id would show the deleted agent's last payload from `localStorage`. The same hazard applies to a tab that was offline (or had its `EventSource` disconnected) when the delete happened, which is why the initial-load sweep below is worth having.
- **Two clear points, both idempotent** (`clearLastPayload` is a `removeItem` + notify; calling it twice is harmless):
  1. The successful delete path: `AgentDetailView.doRemove` (`AgentList.tsx` ~736) after `res.ok` and before `onClose()`. This covers the deleting tab even if its SSE stream is down.
  2. The `agent-removed` SSE handler in `AgentList` (`useSSEEvent('agent-removed')`, ~2101, guarded by `typeof data.id === 'number'`) so every other tab and client drops it too. Call it beside the existing `prevStatusRef.current.delete(id)` / `setAgents` / `setExpandedAgent` lines. Note `frontend/src/lib/useAgents.ts` also subscribes to `agent-removed`; it is a data hook with no store dependency, so leave it alone (one clear point in `AgentList` is enough, and adding a second subscriber elsewhere would only duplicate work).
- **Not cleared on window close or stop.** `doCloseWindow` / `DELETE /agents/:id/window` keeps the agent row, and the "retained until replaced" semantics of the last payload are the point of the feature; only true deletion clears. Add an explicit test that closing the window does not clear.
- **Signature.** `clearLastPayload` is defined by TASK-0224 as `clearLastPayload(agentId: number): void` and `agent.id` is a `number`, so call `clearLastPayload(agent.id)` / `clearLastPayload(id)`. (The shared design note wrote `clearLastPayload(String(id))`; the key is built inside the store with `agentId.toString()`, so passing the number is the correct call. If TASK-0224 shipped a different signature, follow the shipped one and note the deviation here.)
- **Clone isolation is by construction, verified by test.** `POST /agents/:id/clone` (`host-server/index.ts` ~1567) calls `createAgent` and gets a fresh id and a fresh name (`deriveCloneName` -> `<name>-copy[-N]`), so the clone's key is a different `conductor:lastPayload:<newId>` and its server sidecar is a different `<windowName>.meta.json`. Nothing copies the source's payload. Per project memory ("agents can share a workdir", "clone agent shares workdir"), the clone shares the workdir verbatim, so the store must key by id, never by workdir; the test locks that in. No production code change is expected for the clone item; if the test reveals any leakage, fix it at the source and record it in this task.
- **Orphan sweep: decision = include it.** A tab that missed an `agent-removed` (offline, reloaded after a server-side delete, deleted from another browser profile's session) leaves `conductor:lastPayload:<id>` behind, and with id reuse that key is not merely garbage but wrong data for the next agent to receive that id. The sweep is cheap and can be made safe:
  - New pure helper in `frontend/src/lib/lastPayload.ts`: `sweepOrphanedLastPayloads(liveAgentIds: Iterable<number>): number` — iterates `localStorage` keys (whole body in `try/catch`, degrade silently, collect keys first and remove after so index shifting cannot skip entries), and for each key starting with `LAST_PAYLOAD_KEY_PREFIX` whose suffix parses (strict `/^\d+$/`) to an id not in the live set, calls `clearLastPayload(id)`; keys whose suffix is not a plain integer are left alone (they are not ours to judge). Returns the number cleared.
  - Call site: the initial `/status` load in `AgentList` (~2034-2054), inside the `.then((data) => { if (!hasReceivedSSEStateRef.current) { ... } })` branch, and **only when `Array.isArray(data.agents)`** (the surrounding code coerces a missing `agents` to `[]` for stale servers; sweeping against that coerced empty list would wipe every stored payload). Never sweep on the error path, on an SSE `agent-update` list, or when `hasReceivedSSEStateRef.current` is already true (the list may then be partial).
  - Risk stated plainly: the sweep trusts one successful `/status` response as the authoritative agent set. That is the same trust the sidebar already places in it, and a false positive only loses a convenience value (the hook re-mirrors `lastPrompt` on the next SSE update via TASK-0225).
- **Known gap, deliberately out of scope (report, do not fix here).** `DELETE /agents/:id` (`host-server/index.ts` ~1416-1465) unlinks `<winName>.state` but **not** the hook sidecar `<winName>.meta.json`, which is where the server-side `last_prompt` lives (TASK-0221/0222). Because the sidecar is keyed by tmux window name (`agentWindowName`: `<projectName>-<name>` or `<name>`), an agent later re-created with the same name and project would inherit the deleted agent's server-side `lastPrompt` and the SSE mirror would write it back into `localStorage` after this task cleared it. Fixing it means editing `host-server/index.ts` (a hot file) and a server test, so it needs its own task; this task only records it. The clone path is unaffected because a clone always gets a new name.
- **Out of scope**: the store itself (TASK-0224), SSE mirroring (TASK-0225), strip and card display (TASK-0226, TASK-0227), and clearing when a project (not an agent) is deleted (project deletion sets `agents.project_id` to NULL rather than deleting agents, so no agent-delete event fires).

## Steps

### 1. Clear on delete and on the agent-removed event  <!-- agent: general-purpose -->

- [x] Re-locate everything with Serena first (`find_symbol` `AgentDetailView/doRemove` and `AgentList/useSSEEvent('agent-removed') callback` in `frontend/src/components/AgentList.tsx`; other agents edit this file concurrently, line numbers drift).
- [x] `frontend/src/components/AgentList.tsx`: add `clearLastPayload` (and, after step 2, `sweepOrphanedLastPayloads`) to the import from `'../lib/lastPayload'` (the strip/card tasks already import `useLastPayload`/`firstLinePreview` from there; extend that import instead of adding a second one).
- [x] In `AgentDetailView.doRemove`, after the `!res.ok` check throws and before `onClose()`, call `clearLastPayload(agent.id)`. Do not call it in the `catch` branch (a failed delete keeps the payload).
- [x] In the `agent-removed` handler, inside the `typeof data.id === 'number'` branch next to `prevStatusRef.current.delete(id)`, call `clearLastPayload(id)`.
- [x] Confirm `doCloseWindow` (and the bg-process removal handlers, which use a slug not an agent id) are untouched.

### 2. Orphan sweep on initial load  <!-- agent: general-purpose -->

- [x] `frontend/src/lib/lastPayload.ts`: add `sweepOrphanedLastPayloads(liveAgentIds: Iterable<number>): number` per the Approach (prefix scan of `localStorage`, strict integer suffix, keys collected before removal, entire body in `try/catch` returning the count cleared so far on failure, uses `clearLastPayload` so subscribers are notified). Match the file's existing comment density and `try { ... } catch { /* comment */ }` idiom.
- [x] `frontend/src/components/AgentList.tsx`: in the initial-load effect, inside the `!hasReceivedSSEStateRef.current` block, after `setAgents(agentList)`, add `if (Array.isArray(data.agents)) sweepOrphanedLastPayloads(agentList.map((a) => a.id))` with a one-line comment explaining why the `Array.isArray` guard matters (stale server omitting `agents` must not wipe the store).

### 3. Tests  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.test.tsx`: add a `describe('AgentList clears the last payload on agent deletion (TASK-0228)')` block reusing the file's existing helpers (`baseAgent`, `stubAgentDetailFetch`, `fireSSE`, `CapturingEventSource`/`MockAudioContext` stubs as in the `agent-removed SSE handling (TASK-0173)` describe, and the `localStorage.clear()` + `__resetLastPayloadCacheForTests()` reset in `beforeEach`). Seed `saveLastPayload(<id>, { text, ts, source: 'hook' })` directly. Cases:
  - **Delete clears the key**: select the agent, open the actions menu, choose the destroy/remove item, confirm the dialog (find the existing removal-confirm tests by searching for `Destroy agent`), stub `DELETE /agents/:id` as `{ ok: true }`; assert `localStorage.getItem('conductor:lastPayload:<id>')` is `null`.
  - **Failed delete keeps the key**: same flow with a non-ok `DELETE` response; the key is still present and the error banner shows.
  - **`agent-removed` SSE clears the key**: seed, render, `act(() => { fireSSE('agent-removed', { id }) })`, assert the key is gone (covers the non-deleting-tab path).
  - **Other agents untouched**: seed ids 1 and 2, remove agent 1 (both by delete and by SSE), assert agent 2's key and value are unchanged.
  - **Window close does not clear**: closing the agent's window (the existing close-window confirm flow) leaves the key in place.
  - **Clone starts empty**: seed agent 26 (`clone-source`) with a payload, click Clone (stub `POST .../clone` returning id 60 as in the existing clone test near `clone-source`), fire `agent-update` for the clone, then assert `localStorage.getItem('conductor:lastPayload:60')` is `null`, `loadLastPayload(60)` is `null`, and the source's key is unchanged; give both agents the same `workdir` in the fixture to lock in "keyed by id, never by workdir".
  - **Initial-load sweep**: seed keys for ids 1, 2 and 99 plus an unrelated `conductor:sendDraft:1` key and a `conductor:lastPayload:abc` key; stub `/status` to return agents 1 and 2; after load, ids 1 and 2 remain, 99 is gone, and the two unrelated keys remain. A second case: `/status` returning a body **without** an `agents` field leaves every key in place. A third: a failing `/status` (non-ok) sweeps nothing.
- [x] `frontend/src/lib/lastPayload.test.ts`: add unit tests for `sweepOrphanedLastPayloads` (removes only non-live numeric ids, ignores non-numeric and foreign-prefix keys, returns the count, notifies subscribers once per cleared key, does not throw when `Storage.prototype.removeItem`/`key` throws).

### 4. Verify  <!-- agent: general-purpose -->

- [x] `cd frontend && npx vitest run src/components/AgentList.test.tsx src/lib/lastPayload.test.ts`, then `npm run typecheck && npm run lint`. Static gates only.
- [ ] `[DEFERRED-TO-UAT]` For a human in a browser (UAT step, not for the implementing agent): with two tabs open, delete an agent that has a stored payload in tab A and confirm tab B's strip/card no longer shows it and `localStorage` has no `conductor:lastPayload:<id>` key in either tab; clone an agent that has a payload and confirm the clone shows none until it receives its own prompt.

## Files expected to be touched

- `frontend/src/components/AgentList.tsx`
- `frontend/src/components/AgentList.test.tsx`
- `frontend/src/lib/lastPayload.ts` (adds `sweepOrphanedLastPayloads` only)
- `frontend/src/lib/lastPayload.test.ts` (adds the sweep tests only)

No `host-server/`, `hooks/`, wiki index, log or hot-cache files (the orchestrator maintains the shared wiki files).

## Dependencies

- TASK-0227

## Notes

Guardrails for whoever implements this task:

- Never run `install-hooks.sh` against the real `~/.claude`, and never edit `~/.claude/settings.json`.
- Never kill or restart tmux windows/sessions, or the running host-server / dev servers (other agents share this live environment; the dev servers hot-reload edited files on their own). Do not actually delete or clone a real agent to "try it out".
- Live-fleet verification (real agent delete, real clone, two browser tabs) is a documented UAT step for a human, not something an autonomous agent performs. This task's verification is static (vitest, typecheck, lint) only.
- Other agents edit this repo concurrently; re-read each file with Serena immediately before editing and stage only the four files listed above.
- Use Serena for code exploration and editing per `wiki/guides/mcp-tools.md`; temporary files go in `./tmp/` if needed.
- Follow-up to file separately (found while writing this task): `DELETE /agents/:id` does not remove `<winName>.meta.json`, so a same-named re-created agent inherits the deleted agent's server-side `last_prompt`. See the last bullet of Approach. **Update (2026-09-20):** TASK-0222 has since shipped the server half (`DELETE /agents/:id` now unlinks `<winName>.meta.json`), so this gap is closed; no follow-up needed.

## Implementation notes (2026-09-20)

<!-- Updated: 2026-09-20 -->

- `frontend/src/lib/lastPayload.ts`: added `sweepOrphanedLastPayloads(liveAgentIds: Iterable<number>): number` after `clearLastPayload` (no existing export or behaviour changed).
- `frontend/src/components/AgentList.tsx`: import extended with `clearLastPayload` and `sweepOrphanedLastPayloads`; `clearLastPayload(agent.id)` in `AgentDetailView.doRemove` after the `!res.ok` throw and before `onClose()` (not in `catch`); `clearLastPayload(id)` in the `agent-removed` handler beside `prevStatusRef.current.delete(id)`; `sweepOrphanedLastPayloads(agentList.map((a) => a.id))` in the initial `/status` load inside the `!hasReceivedSSEStateRef.current` block after `setAgents(agentList)`, guarded by `Array.isArray(data.agents)`. `doCloseWindow`, the bg-process handlers and `useAgents.ts` are untouched.
- Clone isolation needed no production change: the store is keyed by numeric agent id, and the test gives source and clone the same `workdir` to lock that in.
- Signature: shipped `clearLastPayload(agentId: number)` matches the task; called with the numeric id.
- Tests: new `describe('AgentList clears the last payload on agent deletion (TASK-0228)')` (12 cases) in `AgentList.test.tsx` and `describe('sweepOrphanedLastPayloads (TASK-0228)')` (8 cases) in `lastPayload.test.ts`. Beyond the task's list I added: SSE with non-numeric/missing id clears nothing, empty `agents: []` does sweep, and no sweep when SSE state arrived before `/status`.
- Verification (static): `npx vitest run src/components/AgentList.test.tsx src/lib/lastPayload.test.ts` 309 passed; `npx tsc --noEmit -p .` and `npx eslint` on the four touched files both clean at the time of the run. Caveat: another session was concurrently editing `AgentList.tsx` / `BackgroundProcessesTab.tsx`, so full-file diagnostics can be transiently red on lines that are not this task's.
