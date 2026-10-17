---
id: UAT-0228
aliases: [UAT-0228]
title: "UAT: Clear an agent's stored last payload when the agent is deleted, and verify clones keep separate payloads"
status: pending
task: TASK-0228
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0228 — UAT: Clear an agent's stored last payload when the agent is deleted, and verify clones keep separate payloads

implements::[[TASK-0228]]

> **Source task**: [[TASK-0228]]
> **Generated**: 2026-09-20

---

## Prerequisites

- [ ] Dependencies installed in `frontend/` (`cd frontend && npm install` if `node_modules` is missing). Every unit-backed case runs under vitest/jsdom with no dev server, no host-server and no tmux.
- [ ] Always scope the vitest commands with `-t` as written. Another session is concurrently editing `AgentList.tsx` / `BackgroundProcessesTab.tsx` (bg-restart work), so a whole-file `AgentList.test.tsx` run, `tsc --noEmit` and eslint can be transiently red in code that does not belong to TASK-0228 (for example `BgRestartButton is not defined`, or failures in unrelated describes). That is NOT a TASK-0228 gap; judge these cases only by the `-t`-scoped commands.
- [ ] For the INT cases only: Serena (or any editor) to read `frontend/src/components/AgentList.tsx` and `frontend/src/lib/lastPayload.ts`.
- [ ] For UAT-UI-001 and UAT-UI-002 only (manual, deferred): the full stack running (`make dev`, conductor session up) with a disposable agent that has a stored payload, and two browser tabs on `http://localhost:4321/`. Do NOT restart dev servers or tmux windows, never run `install-hooks.sh` against the real `~/.claude`, never edit `~/.claude/settings.json`, and never delete or clone a real working agent; use a throwaway one.

Source under test:
- `frontend/src/lib/lastPayload.ts`: `clearLastPayload(agentId: number): void` (TASK-0224) and the new `sweepOrphanedLastPayloads(liveAgentIds: Iterable<number>): number`; key `conductor:lastPayload:<agentId>` (constant `LAST_PAYLOAD_KEY_PREFIX`).
- `frontend/src/components/AgentList.tsx`: `AgentDetailView.doRemove` (`clearLastPayload(agent.id)` after the `!res.ok` throw, before `onClose()`), the `useSSEEvent('agent-removed')` handler (`clearLastPayload(id)` inside the `typeof data.id === 'number'` branch), and the initial `/status` load effect (`if (Array.isArray(data.agents)) sweepOrphanedLastPayloads(...)` inside the `!hasReceivedSSEStateRef.current` block).
- Tests (sibling layout, the repo's convention; the legacy `uatGenerate.promoteTests` value would map to `dedicated`, but the repo keeps unit tests beside the code so the sibling layout wins, as in UAT-0209):
  - `frontend/src/components/AgentList.test.tsx`: `describe('AgentList clears the last payload on agent deletion (TASK-0228)')` (12 tests, written by the TASK-0228 tackle) and `describe('AgentList TASK-0228 clear and sweep interplay with the TASK-0225 mirror')` (2 tests, added by this run). All 14 are matched by `-t "TASK-0228"`.
  - `frontend/src/lib/lastPayload.test.ts`: `describe('sweepOrphanedLastPayloads (TASK-0228)')` (8 tests, written by the TASK-0228 tackle).

Coverage notes:
- The real store is used (`../lib/lastPayload` is NOT mocked), so every assertion reads `localStorage` after real saves/clears, not a spy call.
- Interplay with UAT-0225: TASK-0225's UAT-INT-001 (step 4) and UAT-INT-002 (step 3) were written before TASK-0228 and now auto-judge as FAIL because the `agent-removed` handler calls `clearLastPayload(id)` and the guarded `/status` block calls `sweepOrphanedLastPayloads(...)`. Those are stale expectations, not TASK-0225 defects; UAT-INT-004 below records the reconciled expectation (the mirror is still not called from `agent-removed`, the mirror loop still runs before the SSE guard, and the only additions are the TASK-0228 clear and sweep lines).
- The live flow (real delete, real clone, two browser tabs) is NOT run at generation time; it is UAT-UI-001 and UAT-UI-002, marked `[DEFERRED-TO-UAT manual]`.

---

## Test Cases

### UAT-EDGE-001: A successful delete clears that agent's key
- **Scenario**: Agent 201 (`del-clears`) has a stored payload. The user selects it, opens the destroy flow (`Destroy agent` then the `Destroy` confirm), and `DELETE /agents/201` returns `{ ok: true }`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: after the detail pane closes, `localStorage['conductor:lastPayload:201']` is `null`. Test `a successful DELETE clears that agent's key` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentList clears the last payload on agent deletion (TASK-0228)')`, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "a successful DELETE clears"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-002: A failed delete keeps the key and shows the error
- **Scenario**: Agent 202 (`del-fails`) has a stored payload; `DELETE /agents/202` returns a non-ok response with body `{ "error": "delete boom" }`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: the detail pane shows the `delete boom` error banner, and `localStorage['conductor:lastPayload:202']` is still present (the clear lives only on the success path, never in the `catch`). Test `a failed DELETE keeps the key and shows the error banner` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "a failed DELETE keeps the key"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-003: The agent-removed SSE event clears the key (the non-deleting tab path)
- **Scenario**: Agent 203 has a stored payload; the tab did not perform the delete. An SSE `agent-removed` event with `{ id: 203 }` (numeric) arrives.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `localStorage['conductor:lastPayload:203']` is `null` immediately after the event. Test `an agent-removed SSE clears the key (the non-deleting tab path)` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "an agent-removed SSE clears the key"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-004: An agent-removed event with a non-numeric or missing id clears nothing
- **Scenario**: Agent 204 has a stored payload. `agent-removed` arrives with `{ id: '204' }` (a string) and then with `{}` (no id). The handler only acts when `typeof data.id === 'number'`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `localStorage['conductor:lastPayload:204']` is still present after both events (the string id must not be coerced into a match). Test `an agent-removed SSE without a numeric id clears nothing` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "without a numeric id clears nothing"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-005: Removing one agent leaves other agents' keys and values untouched
- **Scenario**: Agents 205, 206 and 207 each have a stored payload (`payload 205`, `keep b`, `keep c`). Agent 205 is removed by the DELETE flow; then agent 206 is removed by an `agent-removed` SSE.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: after the DELETE of 205, key 205 is gone and keys 206/207 still hold `keep b` / `keep c`; after the SSE for 206, key 206 is gone and key 207 still holds `keep c`. Test `removing one agent (by DELETE and by SSE) leaves the other agents' keys and values untouched` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "leaves the other agents"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-006: Closing the agent window (Stop agent) keeps the key
- **Scenario**: Agent 208 (`close-keeps`, `windowPresent: true`) has a stored payload. The user clicks `Stop agent` and confirms `Stop`; `DELETE /agents/208/window` returns `{ ok: true }`. The agent row still exists, and "retained until replaced" is the point of the feature; only true deletion clears.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: after the detail pane closes, `localStorage['conductor:lastPayload:208']` is still present. Test `closing the agent window (Stop agent) does not clear the key` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "closing the agent window"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-007: A clone (new id, same workdir) starts empty and the source keeps its key
- **Scenario**: Source agent 26 (`payload-clone-source`, workdir `/repo/shared-workdir`) has a stored payload `source prompt`. The user opens the actions menu and clicks `Clone`; the mocked `cloneAgent(26)` returns `{ id: 60 }`; an `agent-update` for the clone (id 60, name `payload-clone-source-copy`, the same workdir) arrives. The store is keyed by numeric agent id, never by workdir.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `cloneAgent` was called with `26`; `localStorage['conductor:lastPayload:60']` is `null` and `loadLastPayload(60)` is `null`; key 26 still holds `source prompt`. Test `a clone (new id, same workdir) starts with no payload and leaves the source's payload alone` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "starts with no payload and leaves the source"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-008: The initial /status load sweeps orphaned keys and keeps live and foreign keys
- **Scenario**: Stored: payload keys for ids 211, 212 and 299, plus `conductor:sendDraft:211` (`draft text`) and `conductor:lastPayload:abc` (`not ours`). `/status` returns agents 211 and 212 only.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: after load, keys 211 and 212 remain, key 299 is `null`, `conductor:sendDraft:211` is still `draft text`, and `conductor:lastPayload:abc` is still `not ours`. Test `the initial /status load sweeps keys for ids that are not live and leaves live and foreign keys alone` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "the initial /status load sweeps keys"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-009: A /status body without an agents field sweeps nothing
- **Scenario**: A stale host-server omits `agents` from `/status`; the surrounding code coerces it to `[]`, and sweeping against that coerced list would wipe every stored payload. Keys for ids 221 and 222 are stored.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: after the load settles, keys 221 and 222 are both still present (the `Array.isArray(data.agents)` guard holds). Test `a /status body without an agents field sweeps nothing` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "without an agents field sweeps nothing"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-010: A /status body with an empty agents array does sweep every stored payload
- **Scenario**: `/status` returns `agents: []` (a real, authoritative empty list). Key 231 is stored.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: after the load settles, key 231 is `null` (an empty but present list is a valid authoritative set, unlike a missing field). Test `a /status body with an empty agents array does sweep every stored payload` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "empty agents array does sweep"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-011: A failing /status (non-ok) sweeps nothing
- **Scenario**: `GET /status` returns a non-ok response; the load path goes to the error branch (`Failed to load status`). Key 241 is stored.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: the `Failed to load status` message renders and key 241 is still present (never sweep on the error path). Test `a failing /status (non-ok) sweeps nothing` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "a failing /status"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-012: No sweep once SSE state has already arrived before the /status response
- **Scenario**: Key 251 is stored. An `agent-update` (agent 252) lands first, so the list is SSE-authoritative and may be partial; then `/status` resolves with `agents: []`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: key 251 is still present (the sweep sits inside the `!hasReceivedSSEStateRef.current` block). Test `does not sweep when SSE state has already arrived before the /status response` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "does not sweep when SSE state has already arrived"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-013: sweepOrphanedLastPayloads removes only non-live numeric ids and returns the count
- **Scenario**: Payloads stored for ids 1, 2, 99 and 100; `sweepOrphanedLastPayloads([1, 2])`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: the return value is `2`; keys 1 and 2 remain; keys 99 and 100 are `null`, and `loadLastPayload(99)` is `null` (the in-memory snapshot cache is refreshed too). Test `removes only numeric ids that are not live and returns the count cleared` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (`describe('sweepOrphanedLastPayloads (TASK-0228)')`, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "sweepOrphanedLastPayloads.*removes only numeric"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-014: sweepOrphanedLastPayloads accepts any iterable of live ids and returns 0 when nothing is orphaned
- **Scenario**: (a) A `Set([3])` as the live ids with payloads for 3 and 4; (b) payload for 1 only and live ids `[1]`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: (a) returns `1`, key 3 remains, key 4 is `null`; (b) returns `0` and `loadLastPayload(1)?.text` is still `one`. Both tests pass (`Tests  2 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "sweepOrphanedLastPayloads.*accepts any iterable|sweepOrphanedLastPayloads.*returns 0 and touches"` — verified: 2 passed
- [ ] Pass

---

### UAT-EDGE-015: sweepOrphanedLastPayloads leaves non-integer suffixes and foreign-prefix keys alone
- **Scenario**: Stored keys `conductor:lastPayload:abc`, `conductor:lastPayload:1.5`, `conductor:lastPayload:-2`, the bare prefix `conductor:lastPayload:`, `conductor:sendDraft:7` and `unrelated`; `sweepOrphanedLastPayloads([])`. Only a strict `/^\d+$/` suffix is judged.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: the return value is `0` and `localStorage.length` is still `6`. Test `leaves non-integer suffixes and foreign-prefix keys alone` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "sweepOrphanedLastPayloads.*leaves non-integer"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-016: An empty live set clears every numeric payload key, including adjacent ones
- **Scenario**: Payloads for ids 1..5 stored back to back; `sweepOrphanedLastPayloads([])`. Keys are collected before removal so index shifting cannot skip entries.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: the return value is `5` and `localStorage.length` is `0`. Test `an empty live set clears every numeric payload key, including when several are adjacent` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "sweepOrphanedLastPayloads.*empty live set"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-017: sweepOrphanedLastPayloads notifies subscribers once per cleared key
- **Scenario**: Payloads for ids 1, 8 and 9; a `subscribeLastPayload` listener is registered; `sweepOrphanedLastPayloads([1])` clears 8 and 9 through `clearLastPayload`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: the listener is called exactly `2` times (so a mounted `useLastPayload` consumer updates). Test `notifies subscribers once per cleared key` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "sweepOrphanedLastPayloads.*notifies subscribers once per cleared key"` — verified: 1 passed
- [ ] Pass

---

### UAT-EDGE-018: sweepOrphanedLastPayloads degrades silently when storage throws
- **Scenario**: (a) `Storage.prototype.key` throws `denied` while a payload for 9 is stored; (b) `Storage.prototype.removeItem` throws `denied`. Both call `sweepOrphanedLastPayloads([])`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: neither call throws; in (a) the returned count is `0` (nothing cleared before the failure). Both tests pass (`Tests  2 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/lastPayload.test.ts` (TASK-0228 describe, written by the TASK-0228 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/lastPayload.test.ts -t "sweepOrphanedLastPayloads.*does not throw"` — verified: 2 passed
- [ ] Pass

---

### UAT-INT-001: Reconciled interplay with the TASK-0225 mirror at runtime
- **Scenario**: TASK-0225's mirror writes `lastPrompt` into the store from `agent-update` and the initial `/status`; TASK-0228 now clears on `agent-removed` and sweeps inside the guarded `/status` block. (a) A hook-mirrored payload for agent 271 is written, dropped by `agent-removed`, and re-mirrored by a later `agent-update` for the same id (the clear must not block later mirroring). (b) The initial `/status` for a live agent 272 carrying `lastPrompt` mirrors it, and the sweep in the same load must not delete it, while an orphan key 273 is dropped.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: (a) after the update key 271 equals `{ text: 'hook prompt', ts: '2026-09-20T10:00:00.000Z', source: 'hook' }`, after `agent-removed` it is `null`, after the second update it equals the same value again; (b) key 272 equals `{ text: 'from status', ts: '2026-09-20T11:00:00.000Z', source: 'hook' }` and key 273 is `null`. Both tests pass (`Tests  2 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (new `describe('AgentList TASK-0228 clear and sweep interplay with the TASK-0225 mirror')` added by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0228 clear and sweep interplay"` — verified: 2 passed
- [ ] Pass

---

### UAT-INT-002: clearLastPayload is called with the numeric agent id at both call sites (no String())
- **Scenario**: The store builds the key internally (`agentId.toString()`), so both call sites must pass the number. A `String(id)` or template-string argument would be a type error against `clearLastPayload(agentId: number)`, but a cast could hide it, so verify by reading the code.
- **Steps**:
  1. With Serena, `search_for_pattern` for `clearLastPayload` in `frontend/src/components/AgentList.tsx`.
  2. Confirm exactly two call sites: `clearLastPayload(agent.id)` in `AgentDetailView.doRemove`, and `clearLastPayload(id)` in the `useSSEEvent('agent-removed')` handler where `const id = data.id` is inside the `typeof data.id === 'number'` branch; the third occurrence is the import.
  3. Confirm neither argument is wrapped in `String(...)`, `.toString()`, `` `${...}` `` or a cast (`as`).
  4. With Serena, read `clearLastPayload` in `frontend/src/lib/lastPayload.ts` and confirm the signature is `clearLastPayload(agentId: number): void`, and that `agent.id` is declared `number` on the `Agent` type.
- **Expected Result**: all four confirmations hold. (As of generation: import at line ~10, `doRemove` call at ~810, handler call at ~2238; line numbers drift, count and shape are what matter.)
- **Repeatable Unit Test**: Not applicable: a static wiring check; the runtime effect of both call sites is unit-backed by UAT-EDGE-001 and UAT-EDGE-003 (a wrong-typed argument would leave the key in place and fail those tests).
- [ ] Pass

---

### UAT-INT-003: Call-site placement matches the task (success path only, guarded sweep, window close and bg handlers untouched)
- **Scenario**: TASK-0228 puts the clear after a successful DELETE only, sweeps only against a real `/status` list in the non-SSE-first branch, and leaves window close, bg-process removal and `useAgents.ts` alone. Behavior is unit-backed by UAT-EDGE-002, -006, -009, -011 and -012; this case verifies the code structure.
- **Steps**:
  1. With Serena, read `AgentDetailView/doRemove` in `frontend/src/components/AgentList.tsx`. Confirm `clearLastPayload(agent.id)` is after the `if (!res.ok) { ... throw ... }` block and immediately before `onClose()`, and that the `catch` branch does not call it.
  2. Read the initial `/status` load effect. Confirm `sweepOrphanedLastPayloads(agentList.map((a) => a.id))` sits inside `if (!hasReceivedSSEStateRef.current) { ... }` right after `setAgents(agentList)`, guarded by `if (Array.isArray(data.agents))`, and that the `.catch` error branch does not call it.
  3. Read `doCloseWindow` and the bg-process removal handlers in the same file. Confirm neither references `clearLastPayload` or `sweepOrphanedLastPayloads`.
  4. With Serena, `search_for_pattern` for `lastPayload|clearLastPayload` in `frontend/src/lib/useAgents.ts`. Confirm no match (its own `agent-removed` subscription carries no store dependency).
  5. Confirm the `agent-update` SSE handler does not call `sweepOrphanedLastPayloads`.
- **Expected Result**: all five confirmations hold.
- **Repeatable Unit Test**: Not applicable: a static structural check; each placement rule has a runtime counterpart in the EDGE cases named above.
- [ ] Pass

---

### UAT-INT-004: Reconcile UAT-0225's stale INT-001 / INT-002 expectations with TASK-0228's additions
- **Scenario**: `UAT-0225` INT-001 (step 4: "the `agent-removed` handler does not call ... any `lastPayload` function") and INT-002 (step 3: "the guarded `/status` block is unchanged") auto-judged FAIL after TASK-0228 landed. This case documents the reconciled expectation so TASK-0225's verdict can be re-judged as intentional drift, not a TASK-0225 defect.
- **Steps**:
  1. Read the `agent-removed` handler in `frontend/src/components/AgentList.tsx`. Confirm it calls `clearLastPayload(id)` and does NOT call `mirrorLastPrompt` or `saveLastPayload`.
  2. Read the initial `/status` `.then` branch. Confirm `for (const agent of agentList) mirrorLastPrompt(agent)` still sits BEFORE the `if (!hasReceivedSSEStateRef.current)` guard, and that the only TASK-0228 addition inside the guarded block is the single `if (Array.isArray(data.agents)) sweepOrphanedLastPayloads(...)` line (plus its comment); the `prevStatusRef` / `setBgs` / `setSessionAlive` / `setSessionExists` lines are unchanged.
  3. Confirm `mirrorLastPrompt` still has exactly two call sites (the `/status` loop and the top of the `agent-update` handler), unchanged from UAT-0225 INT-001.
  4. Run the UAT-INT-001 unit test command: the mirror and the clear/sweep coexist (re-mirror after removal works; the same-load sweep does not delete the freshly mirrored live payload).
- **Expected Result**: all four confirmations hold. Consequence for UAT-0225: INT-001 step 4 and INT-002 step 3 should be re-read as "except for the TASK-0228 clear/sweep lines" and their FAIL verdicts re-judged (or their text updated) by whoever owns that file; TASK-0225's own behavior is intact.
- **Repeatable Unit Test**: Not applicable: a static reconciliation check; the runtime interplay is unit-backed by UAT-INT-001.
- [ ] Pass

---

### UAT-UI-001: [DEFERRED-TO-UAT manual] Live delete clears the payload in every tab, and a re-created agent shows no stale message
- **Page**: `http://localhost:4321/` (Agents page), two browser tabs (A and B), with a throwaway agent that has a stored payload (send it a distinctive prompt through the Add Task form or type one in its terminal so `conductor:lastPayload:<id>` exists). Deliberately NOT run at generation time and not to be run by an autonomous agent; never delete a real working agent.
- **Description**: End-to-end proof that a true delete removes the stored payload in the deleting tab and (via `agent-removed` SSE) in the other tab, and that an agent later created with the same id or name starts with no stale message.
- **Steps**:
  1. In both tabs open DevTools > Application > Local Storage > `http://localhost:4321` and note the target agent's `conductor:lastPayload:<id>` value. Confirm both tabs show the payload in the agent's sidebar card and detail-pane strip.
  2. In tab A, open the agent, choose `Destroy agent`, and confirm `Destroy`.
  3. Without reloading tab B, watch its sidebar and its Local Storage.
  4. Reload tab B and re-inspect Local Storage.
  5. Create a new agent (same name and project as the deleted one; if it is the highest-id agent SQLite may reuse the same id, so note the new id) and wait for it to appear.
  6. Optionally: while tab B is closed (offline case), delete a second throwaway agent from tab A, then open tab B fresh and check that the orphan key for the deleted id is gone after the initial `/status` load.
- **Expected Result**: after step 2, `conductor:lastPayload:<id>` is gone in tab A; after step 3, it is gone in tab B without a reload and the card/strip no longer shows the payload; step 4 shows it still absent. The re-created agent in step 5 shows no last message until it receives its own prompt (no leaked text from the deleted agent, even if it reused the id). In step 6 the orphan key is removed on load.
- **Repeatable Unit Test**: Not applicable: needs the running host-server, real SQLite id reuse, real SSE across two tabs and a browser; the unit-backed equivalents are UAT-EDGE-001, -003, -008 and UAT-INT-001.
- [ ] Pass

---

### UAT-UI-002: [DEFERRED-TO-UAT manual] A live clone starts with no payload while the source keeps its own
- **Page**: `http://localhost:4321/` (Agents page), with a throwaway source agent that has a stored payload (`conductor:lastPayload:<sourceId>`). Deliberately NOT run at generation time and not to be run by an autonomous agent. Per project memory a clone shares the source's workdir verbatim, so never dispatch tasks to a clone without checking its `worktreePath` first.
- **Description**: Confirms in a real browser that keying the store by agent id, not workdir, keeps a clone's strip and card empty.
- **Steps**:
  1. Confirm the source agent shows its payload in the sidebar card and detail strip, and note its Local Storage key.
  2. Open the source's actions menu and click `Clone`; wait for the clone (`<name>-copy`) to appear in the sidebar.
  3. Open the clone's detail pane and inspect its sidebar card and strip, and Local Storage.
  4. Re-check the source's card, strip and key.
- **Expected Result**: the clone (new id) shows no last-payload message and has no `conductor:lastPayload:<cloneId>` key until it receives its own prompt; the source's payload and key are unchanged.
- **Repeatable Unit Test**: Not applicable: needs a real clone (host-server `POST /agents/:id/clone`, tmux window) and a browser; the unit-backed equivalent is UAT-EDGE-007.
- [ ] Pass

---
