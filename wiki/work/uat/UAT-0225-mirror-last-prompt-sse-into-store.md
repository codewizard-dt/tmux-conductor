---
id: UAT-0225
aliases: [UAT-0225]
title: "UAT: Mirror incoming lastPrompt SSE values into the per-agent store, newest timestamp wins"
status: pending
task: TASK-0225
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0225 — UAT: Mirror incoming lastPrompt SSE values into the per-agent store, newest timestamp wins

implements::[[TASK-0225]]

> **Source task**: [[TASK-0225]]
> **Generated**: 2026-09-20

---

## Prerequisites

- [ ] Dependencies installed in `frontend/` (`cd frontend && npm install` if `node_modules` is missing). Every EDGE case runs under vitest/jsdom with no dev server, no host-server and no tmux.
- [ ] Always scope the vitest commands with `-t` as written. Another session is concurrently editing `AgentList.tsx` / `BackgroundProcessesTab.tsx` (bg-restart and worktree work), so the whole-file `AgentList.test.tsx` run, `tsc --noEmit` and eslint are transiently red in code that does not belong to TASK-0225 (for example `BgRestartButton is not defined`, TS2375 at BackgroundProcessesTab sites, failures in the TASK-0209/0211 describes). That is NOT a TASK-0225 gap; judge these cases only by the `-t`-scoped commands.
- [ ] For UAT-INT-001 and UAT-INT-002 only: Serena (or any editor) to read `frontend/src/components/AgentList.tsx`.
- [ ] For UAT-UI-001 only (manual, deferred): the full stack running with a hook-installed Claude agent (`make dev`, conductor session up). Do NOT restart dev servers or tmux windows, never run `install-hooks.sh` against the real `~/.claude`, never edit `~/.claude/settings.json`.

Source under test:
- `frontend/src/components/AgentList.tsx`: the local `Agent.lastPrompt?: { text: string; ts: string } | null` field, the module-level `mirrorLastPrompt(agent)` helper, and its two call sites (the initial `fetch(`${apiUrl}/status`)` `.then` branch, and the top of the `useSSEEvent<Agent>('agent-update', ...)` handler).
- `frontend/src/lib/lastPayload.ts` (owned by TASK-0224, not edited here): `saveLastPayload`, key `conductor:lastPayload:<agentId>`, newest-`ts`-wins.
- `frontend/src/components/AgentList.test.tsx`: three describe blocks carry all TASK-0225 tests (12 tests, all matched by `-t "TASK-0225"`):
  - `AgentList mirrors lastPrompt into the lastPayload store (TASK-0225)` — 6 tests (a)-(f), written by the TASK-0225 tackle.
  - `AgentList lastPrompt mirror edge cases (TASK-0225 UAT)` — 5 tests (malformed shapes, `/status` null, numeric id key, cross-ingest ordering), added by an earlier /uat-generate attempt and REUSED here after being re-run and inspected.
  - `AgentList lastPrompt mirror storage-failure isolation (TASK-0225 UAT)` — 1 test, added by this run to close the one remaining gap (the task's "Failure isolation" rule was previously only covered inside the store's own tests).

Coverage notes:
- The real store is used (`../lib/lastPayload` is NOT mocked), so every assertion reads `localStorage` after a real `saveLastPayload`, not a spy call. The tests were run and pass; each assertion would fail if the mirror were removed, if the source were not `'hook'`, or if the stored value were cleared.
- "Nothing renders differently" was true when TASK-0225 landed. TASK-0226 (detail-pane strip) and TASK-0227 (sidebar card) now read this same store and DO render it, so a runtime "nothing renders" assertion is no longer valid. The side-effect-only property is instead verified structurally in UAT-INT-002.
- The live round trip (real prompt, real hook, real SSE, page reload) is NOT run at generation time; it is UAT-UI-001 below, marked `[DEFERRED-TO-UAT manual]`.

---

## Test Cases

### UAT-EDGE-001: An SSE agent-update carrying lastPrompt writes the store with source hook
- **Scenario**: `fireSSE('agent-update', { ...agent, lastPrompt: { text: 'hello', ts: '2026-09-20T10:00:00.000Z' } })` for agent id 41 (nothing stored beforehand).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `localStorage['conductor:lastPayload:41']` parses to exactly `{ text: 'hello', ts: '2026-09-20T10:00:00.000Z', source: 'hook' }`. Test `(a) an agent-update carrying lastPrompt writes ...` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0225 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "an agent-update carrying lastPrompt writes"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: An older incoming lastPrompt does not overwrite a newer stored entry
- **Scenario**: Stored `{ text: 'typed in add-task', ts: '2026-09-20T12:00:00.000Z', source: 'add-task' }` for agent 42; an `agent-update` arrives with `lastPrompt.ts = 2026-09-20T10:00:00.000Z`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: the stored value is byte-for-byte the seeded entry (text, ts, and `source: 'add-task'` all unchanged). Test `(b) an older incoming lastPrompt does not overwrite ...` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0225 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "an older incoming lastPrompt does not overwrite"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: A newer incoming lastPrompt replaces an older stored entry
- **Scenario**: Stored `{ text: 'old', ts: '2026-09-20T09:00:00.000Z', source: 'add-task' }` for agent 43; an `agent-update` arrives with `lastPrompt = { text: 'newer hook prompt', ts: '2026-09-20T10:00:00.000Z' }`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: the stored value becomes `{ text: 'newer hook prompt', ts: '2026-09-20T10:00:00.000Z', source: 'hook' }`. Test `(c) a newer incoming lastPrompt replaces ...` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0225 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "a newer incoming lastPrompt replaces"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: lastPrompt null and an omitted lastPrompt write nothing and never clear a stored value
- **Scenario**: The five one-shot partial `agent-update` payloads omit `lastPrompt`, and the server sends `null` before any prompt is captured; both mean "unchanged", never "clear". Agent 44 is updated with `lastPrompt: null`, with no `lastPrompt` key, and with `state: 'busy'` (no `lastPrompt`), first with an empty store and then with a seeded `hook` entry.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: with an empty store, `getItem` stays `null` after both updates; with the seeded entry, the entry is unchanged after an omitted-`lastPrompt` update and after a `null` one. Test `(d) lastPrompt null and an omitted lastPrompt write nothing ...` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0225 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "lastPrompt null and an omitted lastPrompt write nothing"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-005: The initial GET /status response carrying lastPrompt writes the store
- **Scenario**: The mocked `/status` response lists agent 45 with `lastPrompt: { text: 'from status', ts: '2026-09-20T11:00:00.000Z' }`; no SSE event is fired.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: after mount, `localStorage['conductor:lastPayload:45']` parses to `{ text: 'from status', ts: '2026-09-20T11:00:00.000Z', source: 'hook' }`. Test `(e) the initial GET /status response carrying lastPrompt writes the store` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0225 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "the initial GET /status response carrying lastPrompt writes the store"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-006: Two agents with different ids and payloads write two separate keys
- **Scenario**: `agent-update` for agent 46 (`first prompt`, 10:00) and for agent 47 (`second prompt`, 10:05).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `conductor:lastPayload:46` holds only the first payload and `conductor:lastPayload:47` holds only the second, each with `source: 'hook'`; neither write disturbs the other. Test `(f) two agents with different ids ...` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0225 tackle; no change by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "two agents with different ids and payloads write two separate keys"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-007: The key is built from the numeric agent id, never the agent name
- **Scenario**: Agent id 54 named `lp-key-by-id` receives an `agent-update` with a valid `lastPrompt`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: the only key under the `conductor:lastPayload:` prefix is `conductor:lastPayload:54`; `conductor:lastPayload:lp-key-by-id` is absent. Test `keys the entry by the numeric agent id, not the agent name` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (added by an earlier /uat-generate attempt; re-run and confirmed by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "keys the entry by the numeric agent id"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-008: Malformed lastPrompt shapes write nothing and never overwrite or clear a stored entry
- **Scenario**: `lastPrompt` values that are not `{ text: non-empty string, ts: string }` arrive over SSE: non-string `text` (`123`, `null`), missing `ts`, numeric `ts`, empty `text`, a bare string, `[]`, `{}`. Test 1 uses an empty store (agent 51); test 2 seeds a `hook` entry for agent 52 and sends `{ text: 99, ts: <newer> }` and `{ text: 'newer but no ts' }`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: test 1 leaves `localStorage` with no `conductor:lastPayload:` key at all; test 2 leaves the seeded entry unchanged even though the malformed payload's `ts` is newer. Both tests pass (`Tests  2 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (added by an earlier /uat-generate attempt; re-run and confirmed by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "malformed lastPrompt shapes"` — verified: 2 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-009: A null lastPrompt in the initial /status response writes nothing
- **Scenario**: The `/status` agent 53 carries `lastPrompt: null` (older host-server build, or no prompt captured yet).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: after mount there is no `conductor:lastPayload:` key in `localStorage`. Test `a null lastPrompt in the initial /status response writes nothing` passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (added by an earlier /uat-generate attempt; re-run and confirmed by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "a null lastPrompt in the initial /status response"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-010: The /status ingest and the agent-update ingest feed one shared newest-wins store
- **Scenario**: Agent 55 loads from `/status` with `lastPrompt.ts = 11:00`. An SSE `agent-update` with an older `ts` (10:00) then arrives, then one with a newer `ts` (12:00).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: after mount the store holds the 11:00 `from status` entry; the 10:00 SSE value does not replace it; the 12:00 value replaces it (`newer sse`, `source: 'hook'`). Test `the /status ingest and the agent-update ingest share one newest-wins store` passes (`Tests  1 passed`). Together with UAT-EDGE-001 and UAT-EDGE-005 this also proves the mirror runs at both ingest points.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (added by an earlier /uat-generate attempt; re-run and confirmed by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "share one newest-wins store"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-011: A storage write failure never breaks the agent-update merge
- **Scenario**: `Storage.prototype.setItem` is made to throw (`quota`) after mount. An `agent-update` for agent 61 carries both a new worktree/branch (`conductor/61`) and a valid `lastPrompt`. TASK-0225's "Failure isolation" rule: a storage failure must never break agent rendering or the status/attention logic sharing the handler.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: the sidebar shows the `⎇ conductor/61` badge from the same update (the `{ ...next[idx], ...updated }` merge still ran), no exception escapes the handler, and `localStorage['conductor:lastPayload:61']` is `null` (nothing persisted). Test `an agent-update whose lastPrompt cannot be persisted still merges the rest of the snapshot` passes (`Tests  1 passed`). The test is non-tautological: without the `setItem` spy the same update would persist the entry and the `null` assertion would fail.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (new `describe('AgentList lastPrompt mirror storage-failure isolation (TASK-0225 UAT)')` added by this run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "cannot be persisted"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-001: The mirror is invoked at exactly both ingest points and nowhere else
- **Scenario**: TASK-0225 requires one helper called from (1) the initial `/status` load and (2) the `agent-update` SSE handler, and explicitly NOT from the `agent-removed` handler (store cleanup on delete is a separate roadmap item) and not from anywhere else. Behavior at both points is already proven at runtime by UAT-EDGE-005 and UAT-EDGE-001; this case verifies the wiring by reading the code.
- **Steps**:
  1. With Serena, `search_for_pattern` for `mirrorLastPrompt|saveLastPayload` in `frontend/src/components/AgentList.tsx`.
  2. Confirm there is exactly one definition (`function mirrorLastPrompt(agent: Pick<Agent, 'id' | 'lastPrompt'>): void`) and exactly two call sites: `for (const agent of agentList) mirrorLastPrompt(agent)` inside the `fetch(`${apiUrl}/status`)` `.then((data) => ...)` branch, and `mirrorLastPrompt(updated)` at the top of the `useSSEEvent<Agent>('agent-update', ...)` callback (after `hasReceivedSSEStateRef.current = true`, before `deriveStatus`/`setAgents`).
  3. Confirm `saveLastPayload` in `AgentList.tsx` is referenced only by its import and by the single call inside `mirrorLastPrompt`.
  4. Read the `agent-removed` handler and confirm it does not call `mirrorLastPrompt` or any `lastPayload` function.
  5. Confirm the helper's early-return guard: returns unless `lastPrompt` is a non-null object with a non-empty string `text` and a string `ts`, and the write uses `source: 'hook'`.
- **Expected Result**: all five confirmations hold. (As of generation: definition at line ~138, calls at ~2170 and ~2195; line numbers drift, count and placement are what matter.)
- **Repeatable Unit Test**: Not applicable: a static wiring check; the runtime behavior at both call sites is already unit-backed by UAT-EDGE-001, UAT-EDGE-005 and UAT-EDGE-010.
- [FAIL: auto-judge: step 4 does not hold as written — the agent-removed handler now calls clearLastPayload(id) (AgentList.tsx:2239, added by TASK-0228 clear-on-delete after this UAT was written); steps 1-3 and 5 hold (1 definition at :138, 2 call sites at :2173 and :2201, saveLastPayload only at import :10 and :142, guard + source 'hook' correct). Stale expectation, not a TASK-0225 defect; needs human re-judgment or a UAT text update] <!-- 2026-09-20 -->

---

### UAT-INT-002: The mirror is a side effect only; it adds no React state and does not touch the merge, chime or attention logic
- **Scenario**: TASK-0225 forbids putting the payload in React state and forbids altering the chime/attention logic, `prevStatusRef` bookkeeping or the `{ ...next[idx], ...updated }` merge. Display now exists (TASK-0226 strip, TASK-0227 card) but it reads the store through `useLastPayload`, not through anything this task adds. A runtime "nothing renders differently" assertion is no longer meaningful, so verify structurally.
- **Steps**:
  1. Read `mirrorLastPrompt` in `frontend/src/components/AgentList.tsx` and confirm it returns `void`, calls no `set*` state setter, and its only side effect is the `saveLastPayload(...)` call.
  2. Read the `agent-update` handler and confirm the only TASK-0225 addition is the single `mirrorLastPrompt(updated)` line; `deriveStatus`, `needsAttention`, the `playDoorbell`/`playChime` branches, `prevStatusRef.current.set(...)` and the `setAgents` merge (`next[idx] = { ...next[idx], ...updated }`) are unchanged.
  3. Read the initial `/status` `.then` branch and confirm the mirror loop sits before the `!hasReceivedSSEStateRef.current` guard and the guarded `setAgents` / `prevStatusRef` / `setBgs` / `setSessionAlive` / `setSessionExists` block is unchanged.
  4. Confirm `frontend/src/lib/api.ts` and `frontend/src/lib/lastPayload.ts` carry no TASK-0225 edits (the local `Agent` interface field is the only type change).
- **Expected Result**: all four confirmations hold.
- **Repeatable Unit Test**: Not applicable: a structural code-review check. The non-interference part is covered at runtime by UAT-EDGE-011 (merge still runs when the mirror's write fails).
- [FAIL: auto-judge: step 3 does not hold as written — the guarded /status block is no longer unchanged: it now contains `if (Array.isArray(data.agents)) sweepOrphanedLastPayloads(...)` (AgentList.tsx:2178, added by TASK-0228). Steps 1, 2 and 4 hold (mirrorLastPrompt is void, no set* calls, only saveLastPayload; agent-update handler's doorbell/chime/prevStatusRef/merge logic intact with the single mirrorLastPrompt(updated) line; no lastPrompt in api.ts or lib/lastPayload.ts). Stale expectation, not a TASK-0225 defect; needs human re-judgment or a UAT text update] <!-- 2026-09-20 -->

---

### UAT-UI-001: [DEFERRED-TO-UAT manual] Live round trip: real prompt in a hook-installed agent reaches localStorage via SSE and survives a reload
- **Page**: `http://localhost:4321/` (Agents page), with a live Claude Code agent running under the conductor with the tmux-conductor hooks installed (TASK-0221 sidecar capture and TASK-0222 server field must be live).
- **Description**: End-to-end proof that a prompt typed straight into a real agent's terminal is captured by the hook, exposed by the host-server as `agent.lastPrompt`, delivered over SSE, and mirrored into `localStorage` by this task. Deliberately NOT run at generation time and not to be run by an autonomous agent.
- **Steps**:
  1. Open the dashboard and DevTools (Application > Local Storage > `http://localhost:4321`). Note the current `conductor:lastPayload:<id>` for the target agent, if any.
  2. In the target agent's terminal (dashboard Interact mode or the tmux window), type a distinctive prompt such as `uat-0225 live probe` and press Enter.
  3. Without reloading, watch Local Storage.
  4. Reload the page and re-inspect Local Storage.
  5. Optionally submit a second prompt via the dashboard Add Task form (TASK-0223) with a later timestamp, then confirm a subsequent older-or-equal hook value does not clobber it.
- **Expected Result**: within a poll/SSE cycle after step 2, `conductor:lastPayload:<agent id>` (numeric id) holds `{ "text": "uat-0225 live probe", "ts": "<ISO time of submit>", "source": "hook" }`; the entry is still present with the same value after the reload in step 4 (the initial `/status` load re-mirrors it; a redundant write is harmless); other agents' keys are untouched.
- **Repeatable Unit Test**: Not applicable: needs a real hook-installed agent, real tmux, the running host-server and a browser; the unit-backed equivalents are UAT-EDGE-001, UAT-EDGE-005 and UAT-EDGE-010.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (manual live round trip, deferred; no browser automation run)] <!-- 2026-09-20 -->

---
