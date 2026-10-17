---
id: UAT-0222
aliases: [UAT-0222]
title: "UAT: Read the hook sidecar's last_prompt in the host-server and expose agent.lastPrompt on the snapshot, both SSE builders and the change-diff predicate"
status: pending
task: TASK-0222
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0222 — UAT: Read the hook sidecar's last_prompt in the host-server and expose agent.lastPrompt on the snapshot, both SSE builders and the change-diff predicate

implements::[[TASK-0222]]

> **Source task**: [[TASK-0222]]
> **Generated**: 2026-09-20

---

## Prerequisites

- [ ] Repo checkout at the tmux-conductor root; Node.js >= 18 and `host-server/node_modules` installed (the runner is `node --import tsx/esm --test`).
- [ ] **Safety**: no case here touches the live fleet. Do NOT run `install-hooks.sh` against the real `~/.claude`, do NOT edit `~/.claude/settings.json`, do NOT kill/restart tmux windows/sessions or the running host-server/dev servers, and do NOT hand-edit any real `logs/state/*.meta.json`. Unit-backed cases use fixtures under `./tmp/` (repo-local, removed in `after`); the live API cases are read-only `GET`s against the already-running host-server on port 8788.
- [ ] **Stale-server gate (API cases only).** The running host-server is launched without `--watch`, so a process started before TASK-0222 keeps serving payloads WITHOUT `lastPrompt`. Observed at generation time: `GET /api/status` returned agents with no `lastPrompt` key at all. A stale process is a prerequisite failure for `UAT-API-001` to `UAT-API-004`, not a TASK-0222 defect. The human restarts the host-server (`make dev`) before judging them. Every EDGE/INT case is independent of the live process.
- [ ] Verification-scope caveat: other in-flight tasks edit `host-server/index.ts` concurrently (TASK-0209, TASK-0211, TASK-0215 `buildNewAgentUpdate`). At generation time a full `npx tsc --noEmit` reported errors in `index.ts` (`AgentContext` vs `Record<string, unknown>` at the new-agent `buildNewAgentUpdate` call sites) and `agentUpdatePayload.test.ts`; none mention `lastPrompt` and none are in TASK-0222's files. Every command below is scoped to TASK-0222's own files. A red full-suite result in another task's files is not a TASK-0222 failure.

Source under test:
- `host-server/lastPrompt.ts`: `LastPrompt`, `LAST_PROMPT_MAX_CHARS` (2000), `capLastPromptText` (1999 chars + one `…`, drops a dangling high surrogate, idempotent), `readLastPrompt(stateDir, windowName)` (mtime+size cache, never throws), `removeLastPromptSidecar`, `__resetLastPromptCacheForTests`.
- `host-server/index.ts`: `Snapshot` inline agent type (`lastPrompt: LastPrompt | null`), `buildSnapshot`, the `GET /status` no-session fallback, the `GET /events` connect replay, `pollAndDiff` periodic broadcast, `DELETE /agents/:id` (unlinks the sidecar) vs `DELETE /agents/:id/window` (keeps it).
- `host-server/agentDiff.ts`: `agentSnapshotChanged` compares `lastPrompt.ts` and `lastPrompt.text`.
- Implementation tests: `host-server/lastPrompt.test.ts`, `host-server/sseLastPromptParity.test.ts`, the 6 `lastPrompt` cases in `host-server/agentDiff.test.ts`. Tests added by this UAT (sibling layout, as in UAT-0209; the legacy `uatGenerate.promoteTests` value maps to `dedicated` but the repo's sibling layout wins): `host-server/lastPromptContract.test.ts` (8 source/behavior guards) and `host-server/sseLastPromptParityMutation.test.ts` (parity non-tautology proof).

Coverage note: every EDGE case is unit-backed by a verified file-scoped command; the backing test names are listed in each case. API cases are read-only live GETs behind the stale-server gate. INT cases are static gates scoped to TASK-0222's files. The live prompt round trip (`UAT-MAN-001`) and its two follow-ons are `[DEFERRED-TO-UAT manual]`: an autonomous run must NOT perform them (they need TASK-0221's hook installed via `install-hooks.sh` against the real `~/.claude` and agents restarted).

---

## Test Cases

### UAT-EDGE-001: A missing, unparseable or lastPrompt-less sidecar yields null
- **Scenario**: `readLastPrompt` is called for (a) a window with no `.meta.json`, (b) a sidecar containing invalid JSON, (c) a sidecar with only `transcript_path`/`model` (no `last_prompt`).
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing tests `a missing file yields null`, `invalid JSON yields null` and `a sidecar without last_prompt yields null`.
- **Expected Result**: each call returns `null` and none throws. Test run exits 0 with 0 failures.
- **Repeatable Unit Test**: Created: `host-server/lastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: Every malformed last_prompt shape yields null
- **Scenario**: `last_prompt` is present but invalid: empty `text`, non-string `text` (42), missing `ts`, unparseable `ts` (`not-a-date`), non-string `ts` (123), a bare string, an array, and `null`.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `malformed last_prompt shapes each yield null` (it loops all eight shapes with the cache reset between them).
- **Expected Result**: all eight shapes return `null`; none is treated as a prompt. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/lastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: A valid sidecar yields { text, ts }; multi-line and unicode text survive verbatim
- **Scenario**: `last_prompt: { text: 'hello world', ts: '2026-09-20T10:00:00.000Z' }`, and a prompt with leading/trailing spaces, blank lines, a tab, arrows, accents, CJK and an emoji.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing tests `a valid sidecar yields { text, ts }` and `multi-line and unicode text survive verbatim`.
- **Expected Result**: the first returns exactly `{ text: 'hello world', ts }`; the second returns `text` byte-for-byte equal to the input (no trimming, no normalization). Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/lastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: Unknown keys and last_prompt.prompt_id are ignored
- **Scenario**: the sidecar carries `transcript_path`, `session_id`, a top-level `ts`, and `last_prompt: { text, ts, prompt_id: 'p-1', extra: { a: 1 } }` (TASK-0219's `prompt_id`).
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `unrelated and unknown keys (incl. last_prompt.prompt_id) are ignored`.
- **Expected Result**: the result is exactly `{ text: 'hi', ts }`: no `prompt_id`, no `extra`, and the top-level `ts` is not confused with `last_prompt.ts`. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/lastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-005: Text over 2000 characters is capped to exactly 2000 (1999 + ellipsis); text at the cap is untouched; the cap is idempotent
- **Scenario**: a 5000-character prompt is read; separately `capLastPromptText` is applied to a 2000-char string, a 9000-char string, and to an already-capped result.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing tests `text over the cap is truncated to exactly the cap (1999 + ellipsis)` and `capLastPromptText is idempotent and leaves text at the cap untouched`.
- **Expected Result**: the read returns `text.length === 2000` and `text === 'x'.repeat(1999) + '…'`; a string of exactly 2000 characters comes back unchanged; capping twice equals capping once. `LAST_PROMPT_MAX_CHARS === 2000`. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/lastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-006: The cap never splits a surrogate pair
- **Scenario**: an emoji (two UTF-16 units) is positioned so its high surrogate lands on the last kept index of the cut (`'a' * 1998 + '😀' + 'tail'`).
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `capLastPromptText never splits a surrogate pair at the cut`.
- **Expected Result**: the dangling high surrogate is dropped: the result is `'a' * 1998 + '…'` (length 1999, at most 2000) and contains no lone surrogate. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/lastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-007: An unchanged sidecar is not re-parsed; a changed one is re-read (mtime + size cache)
- **Scenario**: mtime is pinned with `fs.utimesSync`. A same-length rewrite with the mtime forced back must still be served from cache (proving no re-parse); a rewrite that changes the size must be re-read; after `__resetLastPromptCacheForTests()` a forced-same-mtime rewrite is seen.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `cache: unchanged file (same mtime + size) is served from cache; a changed file is re-read`.
- **Expected Result**: `AAAA` is still returned after the same-length/same-mtime rewrite to `BBBB` ("served from cache"); `CCCCCC` is returned after the size change ("re-read after change"); after the reset hook the previously cached `DDDDDD` rewrite is returned. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/lastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-008: A sidecar that disappears yields null on the next read (a failed read is not cached)
- **Scenario**: a valid sidecar is read (cached), then the file is unlinked, then read again.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `a sidecar that disappears yields null on the next read (no stale cache)`.
- **Expected Result**: the second read returns `null`, not the cached value (the stat failure evicts the entry). Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/lastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPrompt.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-009: The Snapshot inline agent type declares lastPrompt
- **Scenario**: BUG-0006 precedent: a field missing from the `Snapshot` type lets a builder silently omit it. `lastPrompt: LastPrompt | null` must be declared in the `interface Snapshot` agent element type so the compiler flags any builder that omits it.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `the Snapshot inline agent type declares lastPrompt`.
- **Expected Result**: the source regex matches within `interface Snapshot { ... agents: Array<{ ...; lastPrompt: LastPrompt | null; ... }` in `host-server/index.ts`. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/sseLastPromptParity.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test sseLastPromptParity.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-010: buildSnapshot reads the sidecar and returns lastPrompt per agent
- **Scenario**: the REST status snapshot builder computes `const lastPrompt = readLastPrompt(conf.stateDir, wn);` (keyed by the tmux window name from `agentWindowName`) and returns `lastPrompt,` after `usage`.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `buildSnapshot's returned per-agent object includes lastPrompt`.
- **Expected Result**: the regex bounded to `function buildSnapshot(): Snapshot {` finds `usage: usageByAgent.get(agent.id) ?? null,` immediately followed by `lastPrompt,`. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/sseLastPromptParity.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test sseLastPromptParity.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-011: The GET /status no-session fallback reports lastPrompt: null on each agent
- **Scenario**: when the tmux session is absent, `GET /status` hand-builds each agent entry (`activeTask: null`); the type change forces `lastPrompt: null` there.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `the GET /status no-session fallback reports lastPrompt: null on each agent`.
- **Expected Result**: `activeTask: null,` is followed by `lastPrompt: null,` then `label: null,` in the block that ends with `sessionAlive: false, sessionExists: false, agents: agentStatuses,`. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/lastPromptContract.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPromptContract.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-012: The SSE connect replay (GET /events) carries lastPrompt in its agent-update payload
- **Scenario**: a late-connecting or reconnecting dashboard must receive `lastPrompt` in the replayed full `agent-update`; the regex is bounded to the `sendSSE(reply, 'agent-update', {` opener so a match in the periodic builder cannot satisfy it.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `the SSE connect replay (GET /events) includes lastPrompt in its agent-update payload`.
- **Expected Result**: `lastPrompt: agent.lastPrompt,` appears within 1500 characters of the connect-replay opener. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/sseLastPromptParity.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test sseLastPromptParity.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-013: pollAndDiff's periodic broadcast carries lastPrompt
- **Scenario**: the periodic `broadcastSSE('agent-update', {` payload built from `agent.*` must include `lastPrompt: agent.lastPrompt,` (the second hand-maintained builder).
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `pollAndDiff's periodic broadcast includes lastPrompt`.
- **Expected Result**: the bounded regex from the `broadcastSSE('agent-update', {` opener finds `lastPrompt: agent.lastPrompt,`. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/sseLastPromptParity.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test sseLastPromptParity.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-014: lastPrompt sits after usage/inGitRepo and the worktreePath/branch/role adjacency is preserved
- **Scenario**: `sseRolePayloadParity.test.ts` regex-asserts `worktreePath`, `branch`, `role` are adjacent in the periodic payload and that `role: agent.role,` is within 600 chars of the connect-replay opener. `lastPrompt` must not be inserted between them.
- **Steps**:
  1. Run the unit test command below (both files together).
  2. Confirm the passing test `lastPrompt sits after usage/inGitRepo and never between worktreePath/branch/role in either SSE body` and the existing role-parity tests (`the initial-connect SSE resend (GET /api/events) includes role in its agent-update payload`, `pollAndDiff's periodic agent-update broadcast includes role, at parity with worktreePath/branch ...`).
- **Expected Result**: all pass; neither `worktreePath: agent.worktreePath,` nor `branch: agent.branch,` is directly followed by `lastPrompt`. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/sseLastPromptParity.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test sseLastPromptParity.test.ts sseRolePayloadParity.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-015: The parity tests are non-tautological
- **Scenario**: for each of the five `lastPrompt` occurrences guarded by the parity file (Snapshot type, `buildSnapshot`, connect replay, periodic broadcast, `DELETE /agents/:id` sidecar removal), a copy of `index.ts` with exactly that occurrence removed is run against a copy of `sseLastPromptParity.test.ts` in a `./tmp/` scratch dir (the real `index.ts` is never modified). A control run on the unmutated source is also executed.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the six passing tests: `control: the unmutated source passes every parity test` and one `mutation: removing the <type|buildSnapshot|replay|periodic|delete> occurrence fails exactly its own parity test` per occurrence.
- **Expected Result**: the control run is fully green; each mutated run exits non-zero and fails exactly the one matching parity test while the other guarded tests still pass (so a match in one builder cannot satisfy another). Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/sseLastPromptParityMutation.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test sseLastPromptParityMutation.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-016: agentSnapshotChanged flags null to set and set to null
- **Scenario**: a new prompt on an otherwise-idle agent (previous `lastPrompt: null`) and a cleared prompt (previous set, next `null`) must each produce an `agent-update`.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing tests `lastPrompt null -> set is a change` and `lastPrompt set -> null is a change`.
- **Expected Result**: `agentSnapshotChanged` returns `true` in both directions. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/agentDiff.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test agentDiff.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-017: agentSnapshotChanged flags an identical-text resubmit (different ts) and a different text with the same ts
- **Scenario**: two prompts can share a second-resolution `ts`, and the same text resubmitted must still bump the event because `ts` differs; both `ts` and `text` are compared.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing tests `lastPrompt with a different ts but the same text (identical resubmit) is a change` and `lastPrompt with a different text but the same ts is a change`.
- **Expected Result**: `true` for `{text:'hi', ts:T0}` to `{text:'hi', ts:T1}` and for `{text:'hi', ts:T0}` to `{text:'yo', ts:T0}`. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/agentDiff.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test agentDiff.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-018: agentSnapshotChanged does not fire on an unchanged prompt, and treats undefined and null as equal
- **Scenario**: an identical `{text, ts}` on both sides is not a change (no event spam every tick); `undefined` vs `null` on either side (fixtures/callers that predate the field) is not a change.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing tests `lastPrompt with the same ts and text is not a change` and `lastPrompt undefined vs null is not a change`.
- **Expected Result**: `false` for equal prompts and for both `undefined`/`null` orderings; the pre-existing test `a pre-existing field from each group still triggers a change` still passes. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/agentDiff.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test agentDiff.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-019: pollAndDiff decides via agentSnapshotChanged, and agentDiff.ts stays free of index.ts imports
- **Scenario**: the predicate is only useful if `pollAndDiff` actually calls it; and `agentDiff.ts` must remain import-free of `index.ts` (cycle; `index.ts` has top-level side effects and cannot be imported in tests).
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `pollAndDiff decides whether to broadcast via agentSnapshotChanged, and agentDiff.ts stays import-free of index.ts`.
- **Expected Result**: `index.ts` contains `const prev = prevSnapshot.agents.find(...)` followed by `if (agentSnapshotChanged(prev, agent)) {`; `agentDiff.ts` has no `from './index...'` import and contains both `prev.lastPrompt?.ts !== next.lastPrompt?.ts` and `prev.lastPrompt?.text !== next.lastPrompt?.text`. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/lastPromptContract.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPromptContract.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-020: The partial one-shot agent-update payloads are untouched
- **Scenario**: the inline spawn / clone / project-create / rename `broadcastSSE('agent-update', {...})` payloads (`...ctx` spreads) are partial payloads the frontend merges field-by-field; an omitted `lastPrompt` means "unchanged". They must not carry `lastPrompt` (TASK-0215 owns bringing them to parity; when it lands this guard is expected to be relaxed deliberately, which is why the count of inline payloads is not pinned).
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `the partial one-shot agent-update payloads (...ctx spreads) do not carry lastPrompt`.
- **Expected Result**: no `broadcastSSE('agent-update', {...})` payload containing `...ctx` mentions `lastPrompt`, while the periodic broadcast and the connect replay do. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/lastPromptContract.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPromptContract.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-021: DELETE /agents/:id unlinks the hook sidecar, so a re-created same-named agent inherits nothing
- **Scenario**: `DELETE /agents/:id` unlinked `<winName>.state` but left `<winName>.meta.json`, so a re-created agent of the same name would inherit the deleted agent's `last_prompt`. The handler now calls `removeLastPromptSidecar(stateDir, winName)` after `deleteAgent`; the helper unlinks best-effort and drops the cache entry.
- **Steps**:
  1. Run the unit test command below (both files).
  2. Confirm the passing tests `removeLastPromptSidecar unlinks the file, invalidates the cache, and a later read is null`, `removeLastPromptSidecar on a missing sidecar does not throw` (`lastPrompt.test.ts`) and `the DELETE /agents/:id handler removes the hook sidecar` (`sseLastPromptParity.test.ts`).
- **Expected Result**: the file is gone (`fs.existsSync` false), a later `readLastPrompt` returns `null`, a missing sidecar does not throw, and the delete handler source calls `removeLastPromptSidecar(stateDir, winName);` after `deleteAgent(db, entry.id);`. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/lastPrompt.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPrompt.test.ts sseLastPromptParity.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-022: DELETE /agents/:id/window (close window only) keeps the sidecar
- **Scenario**: closing only the tmux window leaves the agent registered; it survives and re-opens, so its retained `last_prompt` must not be removed. Only the `.state` file is unlinked there.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `DELETE /agents/:id/window keeps the sidecar; DELETE /agents/:id removes it`.
- **Expected Result**: the `/agents/:id/window` handler still unlinks `<winName>.state` and contains neither `removeLastPromptSidecar` nor `.meta.json`; the `/agents/:id` handler contains `removeLastPromptSidecar(stateDir, winName);`. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/lastPromptContract.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPromptContract.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-023: activeTask and getActiveTask are unchanged and independent of the sidecar
- **Scenario**: `activeTask` stays in the API and status contract; only its frontend display use is replaced by a later task. A `last_prompt` in the sidecar must not change what `getActiveTask` returns; an idle agent still has no active task; `activeTask` remains in both SSE bodies and the `Snapshot` type beside `lastPrompt`.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing tests `activeTask is still computed by getActiveTask and broadcast unchanged`, `the status contract and getActiveTask know nothing about lastPrompt` and `getActiveTask output is independent of a last_prompt sidecar`.
- **Expected Result**: `const activeTask = getActiveTask(conf, wn, state);` is intact; both SSE bodies keep `activeTask: agent.activeTask,`; `buildAgentStatusContract` and `getActiveTask` (in `state.ts`) contain no `lastPrompt`/`last_prompt`/`meta.json`; with a `busy` state file and a `dispatch.jsonl` record, `getActiveTask(conf, win, 'busy')` returns the dispatched command both before and after a `last_prompt` sidecar is written, and `'idle'` returns `null`. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/lastPromptContract.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPromptContract.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-024: The stored prompt is never logged or copied into the JSONL logs
- **Scenario**: the stored prompt may contain secrets. No non-test `host-server/*.ts` line may combine `lastPrompt`/`last_prompt` with `console.*`, `appendFileSync`, `logTransition`, `dispatch.jsonl` or `transitions.jsonl`, and the reader must not use `console` at all.
- **Steps**:
  1. Run the unit test command below.
  2. Confirm the passing test `nothing logs the stored prompt value (console / JSONL loggers never see lastPrompt)`.
- **Expected Result**: the scan of every non-test `host-server/*.ts` file finds no offending line, and `lastPrompt.ts` (comments stripped) contains no `console.`. Test run exits 0.
- **Repeatable Unit Test**: Created: `host-server/lastPromptContract.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test lastPromptContract.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-API-001: Every agent in GET /api/status carries a lastPrompt key
- **Endpoint**: `GET /api/status`
- **Description**: the REST snapshot (`buildSnapshot`, or the no-session fallback) gained `lastPrompt`. It must be present on every agent, `null` until a hook-installed agent has stored a prompt. Read-only. Behind the stale-server gate (see Prerequisites).
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '[.agents[] | has("lastPrompt")] | unique'
  ```
- **Expected Result**: `[true]`. `[false]` (or a mix) means the running host-server predates TASK-0222 (stale-server gate: restart it and re-run); `[]` means there are no agents (prerequisite failure, not a pass).
- **Repeatable Unit Test**: Not applicable: exercises the real running host-server payload; the same wiring is covered statically by UAT-EDGE-009 to UAT-EDGE-011
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-API-002: Each non-null lastPrompt is exactly { text, ts } and within the 2000-character cap
- **Endpoint**: `GET /api/status`
- **Description**: a stored prompt on the wire has only the two documented keys (no `prompt_id`, no sidecar leakage) and `text` respects the cap. On a fleet where no hook-installed agent has stored a prompt yet the result is legitimately empty. Read-only. Behind the stale-server gate.
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '[.agents[].lastPrompt | select(. != null) | {keys: (keys | sort), capOk: ((.text | length) <= 2000), tsIso: (.ts | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T"))}] | unique'
  ```
- **Expected Result**: either `[]` (no agent has a stored prompt yet: not a failure, but the case is then only partially exercised; see `UAT-MAN-001`) or exactly `[{"keys":["text","ts"],"capOk":true,"tsIso":true}]`. Any other object (extra keys, `capOk:false`) is a failure.
- **Repeatable Unit Test**: Not applicable: needs live sidecars written by the real hook; the parsing/cap rules are covered by UAT-EDGE-002 to UAT-EDGE-006
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-API-003: The SSE connect replay carries lastPrompt on each agent-update
- **Endpoint**: `GET /api/events` (SSE)
- **Description**: the replayed full `agent-update` events on connect include the `lastPrompt` token per agent (the value or `null`). Read-only; curl exits by timeout after 3 seconds. Behind the stale-server gate.
- **Steps**:
  1. Run the curl command below as-is (a timeout exit code is expected).
- **Command**:
  ```bash
  curl -sS -N --max-time 3 'http://localhost:8788/api/events' | grep -oE '"lastPrompt":(null|\{)'
  ```
- **Expected Result**: one `"lastPrompt":null` or `"lastPrompt":{` token per registered agent (the count equals the agent count from `UAT-API-001`). No output means the running host-server predates TASK-0222 (stale-server gate) or no snapshot has been taken yet.
- **Repeatable Unit Test**: Not applicable: needs a live SSE stream; the builder wiring is covered by UAT-EDGE-012
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-API-004: activeTask stays on the payload and lastPrompt does not leak into the status contract
- **Endpoint**: `GET /api/status`
- **Description**: `activeTask` remains a sibling key on each agent and inside `status`; `lastPrompt` is a sibling of `activeTask` and must NOT appear in `agent.status` (the `buildAgentStatusContract` shape). Read-only. Behind the stale-server gate (the `lastPrompt` half only).
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '[.agents[] | {activeTask: has("activeTask"), statusActiveTask: (.status | has("activeTask")), statusLastPrompt: (.status | has("lastPrompt"))}] | unique'
  ```
- **Expected Result**: `[{"activeTask":true,"statusActiveTask":true,"statusLastPrompt":false}]`.
- **Repeatable Unit Test**: Not applicable: live payload shape; the contract's source-level independence is covered by UAT-EDGE-023
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-001: TASK-0222's files typecheck cleanly
- **Scenario**: the `Snapshot` type change is supposed to force every per-agent builder; a full `tsc --noEmit` may be transiently red in other tasks' files (TASK-0215), so the gate is scoped by grepping for TASK-0222's files and the `lastPrompt` symbol.
- **Steps**:
  1. Run the command below (expect no output).
- **Command**:
  ```bash
  cd host-server && npx tsc --noEmit 2>&1 | grep -E 'lastPrompt|agentDiff|sseLastPromptParity|lastPromptContract'
  ```
- **Expected Result**: prints nothing (grep exits 1): no type error is attributed to `lastPrompt.ts`, `lastPrompt.test.ts`, `agentDiff.ts`, `agentDiff.test.ts`, `sseLastPromptParity.test.ts`, `lastPromptContract.test.ts`, `sseLastPromptParityMutation.test.ts`, or mentions the `lastPrompt` symbol (which would indicate a builder missing the field). Errors in other files are recorded, not failed.
- **Repeatable Unit Test**: Not applicable: this case IS the static gate for the unit test files
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-002: TASK-0222's files pass eslint
- **Scenario**: the full `npm run lint` reports pre-existing `no-floating-promises` errors in other tasks' files (`bgOutput.test.ts`, `bgRestart.test.ts`, `state.test.ts`), so the lint gate is scoped to TASK-0222's files.
- **Steps**:
  1. Run the command below (expect exit 0, no output).
- **Command**:
  ```bash
  cd host-server && npx eslint lastPrompt.ts lastPrompt.test.ts agentDiff.ts agentDiff.test.ts sseLastPromptParity.test.ts lastPromptContract.test.ts sseLastPromptParityMutation.test.ts
  ```
- **Expected Result**: exits 0 with no findings.
- **Repeatable Unit Test**: Not applicable: this case IS the static gate for the unit test files
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-003: The whole TASK-0222 suite runs green together
- **Scenario**: run every TASK-0222 test file in one invocation (the task's own verify command plus the two UAT-added files and the role-parity file it must not break).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test lastPrompt.test.ts sseLastPromptParity.test.ts agentDiff.test.ts lastPromptContract.test.ts sseLastPromptParityMutation.test.ts sseRolePayloadParity.test.ts
  ```
- **Expected Result**: exits 0; 46 tests, 0 failed, 0 cancelled, 0 skipped (counts may grow if other tasks add role-parity cases; failures are what matters).
- **Repeatable Unit Test**: Not applicable: aggregates the per-case unit tests already recorded in UAT-EDGE-001 to UAT-EDGE-024
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-MAN-001: [DEFERRED-TO-UAT manual] Live round trip on a hook-installed agent (GET /status, GET /events, agent-update within one tick)
- **Scenario**: **DEFERRED-TO-UAT manual. A human performs this; an autonomous agent must NOT run it (it needs TASK-0221's hook installed via `install-hooks.sh` against the real `~/.claude` and agents restarted, which the task guardrails forbid).** It belongs to ROADMAP-0027 Phase 4 and proves the whole chain: hook writes `last_prompt`, the host-server reads it, and dashboards receive it.
- **Steps**:
  1. Human runs `./install-hooks.sh` (refreshes `~/.claude/hooks/tmux-conductor/lib/write-state.js`), restarts the host-server (`make dev`) so it runs the TASK-0222 code, and restarts a throwaway agent so its hooks load.
  2. In a terminal, start `curl -sS -N 'http://localhost:8788/api/events' | grep --line-buffered '"lastPrompt"'` and leave it running.
  3. Type a distinctive message into the throwaway agent's Claude Code session (for example `uat-0222 round trip`) and submit it.
  4. Run `curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name=="<throwaway>") | .lastPrompt'`.
  5. While the agent is idle again, submit the identical text a second time, then a different message with a newline in it.
- **Expected Result**: step 3 produces an `agent-update` with `"lastPrompt":{"text":"uat-0222 round trip","ts":"<ISO>"}` within one status tick (about 2 s, `STATUS_POLL_MS`); step 4 shows the same `{ text, ts }`; the identical resubmit in step 5 produces a NEW event with a later `ts`; the multi-line message is shown verbatim and replaces the earlier value.
- **Repeatable Unit Test**: Not applicable: requires the real installed hooks, a live Claude Code session and a human at the terminal (the reader, wiring and diff behavior are covered by UAT-EDGE-001 to UAT-EDGE-019)
- [FAIL: auto-judge: DEFERRED-TO-UAT manual case requires human verification (needs real install-hooks.sh and agent restart)] <!-- 2026-09-20 -->

---

### UAT-MAN-002: [DEFERRED-TO-UAT manual] lastPrompt is retained until replaced, including across a host-server restart
- **Scenario**: **DEFERRED-TO-UAT manual; human only.** Roadmap semantics: no age expiry and no clearing on idle; the value lives in the sidecar, not in host-server memory.
- **Steps**:
  1. After `UAT-MAN-001`, leave the throwaway agent idle for several minutes and re-run the step-4 `GET /api/status` query.
  2. Human restarts the host-server (`make dev`) and re-runs the query.
  3. Close only the agent's tmux window from its actions menu (`DELETE /agents/:id/window`), then re-run the query.
- **Expected Result**: `lastPrompt` is unchanged after idling, after the host-server restart (it is re-read from the sidecar), and after the window-only close (the agent survives; the sidecar is kept, see `UAT-EDGE-022`).
- **Repeatable Unit Test**: Not applicable: needs a live agent and a host-server restart (the no-expiry and keep-on-window-close logic are covered by UAT-EDGE-003, UAT-EDGE-007 and UAT-EDGE-022)
- [FAIL: auto-judge: DEFERRED-TO-UAT manual case requires human verification (live agent and host-server restart)] <!-- 2026-09-20 -->

---

### UAT-MAN-003: [DEFERRED-TO-UAT manual] Deleting an agent and re-creating one with the same name starts with lastPrompt null
- **Scenario**: **DEFERRED-TO-UAT manual; human only, throwaway agent only.** End-to-end proof of the stale-sidecar cleanup (TASK-0228's finding) against a real `DELETE /agents/:id`.
- **Steps**:
  1. With the throwaway agent holding a stored `lastPrompt` (from `UAT-MAN-001`), confirm `ls logs/state/<window>.meta.json` exists.
  2. Destroy the agent from its actions menu (`DELETE /agents/:id`).
  3. Confirm the sidecar is gone (`ls logs/state/<window>.meta.json` fails) and that no other agent's sidecar was removed.
  4. Re-create an agent with the same name and workdir via the navbar `+ Add Agent` modal, and run the `GET /api/status` query for it.
- **Expected Result**: the deleted agent's `<window>.meta.json` is removed; the re-created agent reports `"lastPrompt": null` until it receives its first prompt, and the dashboard's localStorage mirror is not repopulated with the deleted agent's text.
- **Repeatable Unit Test**: Not applicable: requires a live agent lifecycle (the unlink itself is covered by UAT-EDGE-021)
- [FAIL: auto-judge: DEFERRED-TO-UAT manual case requires human verification (live agent lifecycle)] <!-- 2026-09-20 -->
