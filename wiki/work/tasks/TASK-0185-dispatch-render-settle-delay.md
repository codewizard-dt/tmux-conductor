---
id: TASK-0185
aliases: [TASK-0185]
title: "Fix dispatched task text never submitting: add render-settle delays to sendTextToPane and the /clear chain"
status: pending-uat
created: 2026-09-19
updated: 2026-09-19
depends_on: []
blocks: []
parallel_safe_with: [TASK-133, TASK-011]
uat: "[[UAT-0185]]"
tags: [host-server, dispatch, tmux, reliability, bug]
---

# TASK-0185 — Fix dispatched task text never submitting: add render-settle delays to sendTextToPane and the /clear chain

relates_to::[[dispatch-clear-first-enter-race]]
relates_to::[[tmux-send-keys-render-delay-race]]

## Objective

A queued command dispatched by the host-server is typed into the agent's tmux pane but never submitted. For project-scoped tasks (`kind === 'project'`, which set `clearFirst`), the `/clear` text and the task text end up concatenated on one line, and **neither `Enter` registers — `/clear` itself is never sent either**. Root cause (see [[dispatch-clear-first-enter-race]]): `host-server/state.ts::sendTextToPane` fires the literal-text `send-keys` and the `Enter` `send-keys` back-to-back via two `spawnSync` calls with zero gap, and `dispatchTaskToAgent`'s `clearFirst` branch chains two such sends with no gap between them either. The target CLI has not rendered the typed text when `Enter` arrives, so the `Enter` is swallowed. `scripts/dispatch.sh` and `sendDirectInput`'s multiline path already carry a 300ms settle; the host-server task-dispatch path does not. This task adds the missing delays.

## Approach

Decisions confirmed with the user:

- **Async + non-blocking `sleep`, not a blocking wait.** `sendTextToPane` becomes `async` and awaits a 300ms gap between the literal-text send and `Enter` (matching `dispatch.sh`'s `sleep 0.3` and `sendDirectInput`'s `await sleep(300)`). `Atomics.wait`-style blocking is rejected: a project-task dispatch would freeze the Fastify event loop (SSE, terminal WebSocket) for 600ms+.
- **Larger settle after `/clear`.** `/clear` resets the whole Claude Code session, which is heavier than rendering a plain prompt, so the chain is: type `/clear` → 300ms → `Enter` → **post-clear settle (default 1000ms)** → type task text → 300ms → `Enter`. Both delays are constants in `state.ts` with env overrides, following the existing `TMUX_SYNC_TIMEOUT_MS` idiom (`DISPATCH_SUBMIT_DELAY_MS`, `DISPATCH_POST_CLEAR_DELAY_MS`).
- **Testable seam.** The `/clear` chain moves out of `index.ts` (which boots a server on import and can't be unit-tested) into a new exported `state.ts::sendDispatchToPane(session, window, cmdText, { clearFirst }, deps?)`. `sendTextToPane` and `sendDispatchToPane` take an optional `deps` (`{ run, sleep }`) so `state.test.ts` can inject fakes and assert call order and gaps without real tmux or real waiting.
- **No double-dispatch during the gap.** `dispatchTaskToAgent` already writes `busy` to the state file and `popTask` has already removed the row *before* any send, so a 2s `pollAndDiff` tick or an immediate-enqueue fast-path during the gap sees `busy` and won't re-dispatch. No new lock is needed.
- **Callers.** `dispatchTaskToAgent` becomes `async`. In `pollAndDiff` (a sync function on an interval) it is fire-and-forget with a `.catch` that logs. In `POST /tasks`'s immediate-enqueue fast-path it is awaited so `dispatched: true` is only returned after the Enter went out (adds ≤300ms to that request; `clearFirst` is never set on that path).
- **Out of scope:** BUG-0001 / TASK-133's background-sub-agent sentinel gate (a separate, already-tracked compounding cause); `scripts/dispatch.sh` (already has the delay); a pane-echo-polling approach (rejected as overkill); filing a separate `/bug-file` (task only, per the user).

**Concurrency caveat:** the working tree has uncommitted edits to `host-server/index.ts` and `host-server/state.ts` from other work, and TASK-133/TASK-011 touch the same call sites. `/tackle` must re-read each symbol immediately before editing and touch only the regions named below.

## Steps

### 1. Add delay constants and async send helpers in state.ts  <!-- agent: general-purpose -->

- [x] In `host-server/state.ts`, next to `TMUX_SYNC_TIMEOUT_MS` (L19), add:
  - `const DISPATCH_SUBMIT_DELAY_MS = Number(process.env['DISPATCH_SUBMIT_DELAY_MS'] ?? '300');` with a comment noting it mirrors `scripts/dispatch.sh`'s `sleep 0.3  # let the UI render before submitting`.
  - `const DISPATCH_POST_CLEAR_DELAY_MS = Number(process.env['DISPATCH_POST_CLEAR_DELAY_MS'] ?? '1000');` with a comment that `/clear` resets the whole session and needs longer to settle than a plain prompt.
  - a module-local `const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));` if `state.ts` has none (`index.ts:79` has its own; do not import from `index.ts`).
- [x] Add an exported `type PaneSendDeps = { run?: (args: string[]) => void; sleep?: (ms: number) => Promise<void> }` (both optional; defaults are the real `spawnSync('tmux', args, { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS })` runner and the module `sleep`).
- [x] Rewrite `sendTextToPane` (currently L524-528, returns `void`) as `export async function sendTextToPane(sessionName, windowName, text, deps?: PaneSendDeps): Promise<void>`: `send-keys -t <target> -l -- <text>`, then `await sleep(DISPATCH_SUBMIT_DELAY_MS)`, then `send-keys -t <target> Enter` (Enter stays a separate argument, never embedded, per the repo's key design decision).
- [x] Add `export async function sendDispatchToPane(sessionName, windowName, cmdText, opts: { clearFirst?: boolean }, deps?: PaneSendDeps): Promise<void>`: if `opts.clearFirst`, `await sendTextToPane(..., '/clear', deps)` then `await sleep(DISPATCH_POST_CLEAR_DELAY_MS)`; then `await sendTextToPane(..., cmdText, deps)`.

<!-- Updated: 2026-09-19 08:45 -->
<!-- Step 1 done in host-server/state.ts (sendTextToPane now ~L553 after concurrent edits). Constants DISPATCH_SUBMIT_DELAY_MS=300 / DISPATCH_POST_CLEAR_DELAY_MS=1000 (env-overridable) + module `sleep`; exported `PaneSendDeps` (fields typed `| undefined` for exactOptionalPropertyTypes); private `runTmux` default runner (ignores spawnSync result, as the old code did); async `sendTextToPane` and `sendDispatchToPane` (its `clearFirst?: boolean | undefined`). tsc --noEmit clean for state.ts; eslint/Serena diagnostics clean for state.ts. Expected leftovers in index.ts: 2 no-floating-promises errors at the two sendTextToPane calls in dispatchTaskToAgent -- resolved by Steps 3-4. -->

### 2. Unit tests for the send chain  <!-- agent: general-purpose -->

- [x] In `host-server/state.test.ts` (node:test; follow that file's existing style — check its imports first), add tests using injected `run`/`sleep` fakes that record an ordered event log (`run:<args>` / `sleep:<ms>`):
  - (a) `sendTextToPane` emits exactly `send-keys -l -- <text>`, then `sleep(300)`, then `send-keys Enter` — in that order; `Enter` is its own argv element.
  - (b) `sendDispatchToPane` with `clearFirst: false` emits only the single text→sleep→Enter sequence for the command (no `/clear`).
  - (c) `sendDispatchToPane` with `clearFirst: true` emits, in order: `/clear` text, `sleep(300)`, `Enter`, `sleep(1000)`, command text, `sleep(300)`, `Enter`.
  - (d) a command containing shell/special characters (`"`, `$`, `\`, `;`) is passed through verbatim as a single `-l --` argument.
  - (e) if `run` throws on the text send, `Enter` is not sent and the rejection propagates.
- [x] Do not touch pre-existing tests in that file; other work has uncommitted edits there (re-read before appending).

<!-- Updated: 2026-09-19 08:48 -->
<!-- Step 2 done: new `describe('sendTextToPane / sendDispatchToPane (TASK-0185)')` block appended to host-server/state.test.ts (~L398+) with 5 tests (a)-(e) using injected run/sleep fakes; one new import line `sendTextToPane, sendDispatchToPane` added under the existing state import; no pre-existing test touched. node --import tsx/esm --test state.test.ts: 29/29 pass; tsc --noEmit clean; no eslint errors in the new code. Observed but NOT caused by this task: 9 eslint errors in the pre-existing TASK-0182 block (~L281-310: missing `void` on it()/unawaited-promise, template-literal numbers) -- confirmed by inspection those tests don't call sendTextToPane; left untouched. -->

### 3. Make dispatchTaskToAgent async and use the chain  <!-- agent: general-purpose -->

- [x] In `host-server/index.ts`, update the `state.ts` import (L14) to add `sendDispatchToPane`; remove `sendTextToPane` from the import if it becomes unused there (check with `find_referencing_symbols`).
- [x] Change `dispatchTaskToAgent` (~L494-541) to `async ... : Promise<void>`. Keep everything before the sends exactly as-is (checkpoint stash, `busy` state write, `dispatch.jsonl` record) so the `busy` write still precedes any send. Replace the tail (`if (opts?.clearFirst) sendTextToPane(... '/clear'); sendTextToPane(... cmdText);`) with `await sendDispatchToPane(conf.sessionName, win, cmdText, { clearFirst: opts?.clearFirst === true });`.

<!-- Updated: 2026-09-19 08:50 -->
<!-- Step 3 done in host-server/index.ts: state.ts import (L14) now has `sendDispatchToPane` in place of `sendTextToPane` (no other references to it in index.ts); `dispatchTaskToAgent` is `async ...: Promise<void>` and its tail is `await sendDispatchToPane(conf.sessionName, win, cmdText, { clearFirst: opts?.clearFirst === true });` -- checkpoint stash, `busy` state write and dispatch.jsonl record untouched, so `busy` still precedes any send. tsc --noEmit clean; Serena diagnostics clean. eslint: exactly 2 expected no-floating-promises errors at the callers (POST /tasks immediate-enqueue ~L949, pollAndDiff ~L2638) -- fixed by Step 4. -->

### 4. Update both call sites  <!-- agent: general-purpose -->

- [x] `pollAndDiff` (~L2640, sync function; leave it sync): change to `void dispatchTaskToAgent(db, conf, dbAgent, task.command, 'idle-transition-poll', { clearFirst: task.kind === 'project' }).catch((err: unknown) => { console.error(\`[conductor] dispatchTaskToAgent failed for agent ${String(dbAgent.id)}:\`, err); });`. Leave the surrounding `hasPendingBackgroundAgents` gate (BUG-0001) untouched.
- [x] `POST /tasks` immediate-enqueue fast-path (~L951): `await dispatchTaskToAgent(db, conf, foundAgent, cmdText, 'immediate-enqueue');` inside the existing handler (confirm the handler is `async`; it uses `return reply...`). If the send throws, `console.error` it and reply `500 { error: 'dispatch failed' }` — do NOT fall through to the queue-add path, because the `busy` state file was already written before the send. On success keep `broadcastSSE('snapshot', ...)` and the `{ ok: true, dispatched: true }` reply after the await.
- [x] Run `find_referencing_symbols` on `dispatchTaskToAgent` afterwards to confirm no third caller was added by concurrent work; any new caller must handle the returned promise.

<!-- Updated: 2026-09-19 08:52 -->
<!-- Step 4 done in host-server/index.ts. pollAndDiff (~L2643): `void dispatchTaskToAgent(...).catch(err => console.error(...))`, still sync, BUG-0001 hasPendingBackgroundAgents gate and popTask untouched. POST /tasks fast-path (~L947-960, handler already async): `await dispatchTaskToAgent(...)` in try/catch; on throw console.error + `500 { error: 'dispatch failed' }` (no fall-through to queue-add since `busy` is already written); on success broadcastSSE('snapshot') + `{ ok: true, dispatched: true }` after the await. find_referencing_symbols: exactly two callers (POST /tasks, pollAndDiff), no third from concurrent work. tsc --noEmit, eslint index.ts and Serena diagnostics all clean -- zero no-floating-promises errors remain. -->

### 5. Verify  <!-- agent: general-purpose -->

- [x] `npm run typecheck` and lint for `host-server` (use the repo's scripts — check `package.json`); run `state.test.ts` (`node --import tsx/esm --test host-server/state.test.ts`). Fix only errors introduced by this task's own edits.
- [DEFERRED-TO-UAT] Manual check via `make dev` with a real idle agent: (1) enqueue a **project-scoped** task and confirm in the pane (`tmux capture-pane`) that `/clear` runs, the session resets, then the task text is submitted and the agent goes busy; (2) enqueue an **agent-scoped** task to an idle agent with an empty queue (immediate fast-path) and confirm it submits; (3) enqueue while the agent is mid-dispatch and confirm no second dispatch fires during the gap; (4) inspect `logs/dispatch.jsonl` for exactly one record per dispatch.

<!-- Updated: 2026-09-19 08:54 -->
<!-- Step 5 static gates done: tsc --noEmit clean (root and `npm run typecheck --workspace host-server`); all 17 host-server/*.test.ts files pass individually (state.test.ts 29/29 incl. the 5 new TASK-0185 cases; no file needed a live server). `npx eslint .` reports 9 errors, ALL in the pre-existing `describe('tmux exact-match window targets (TASK-0182)')` block of state.test.ts (L281-310: 7x no-floating-promises on describe/it, 2x restrict-template-expressions at L287) -- TASK-0182's code, left untouched; zero lint errors in TASK-0185's regions. The live-agent manual check (2nd bullet) stays [DEFERRED-TO-UAT]. -->

### 6. Update wiki  <!-- agent: general-purpose -->

- [x] `wiki/knowledge/concepts/tmux-send-keys-render-delay-race.md`: add a line noting `host-server/state.ts::sendTextToPane` now carries the same settle as `dispatch.sh` and `sendDirectInput` (TASK-0185), with `relates_to::[[TASK-0185]]`. Read the page first; do not restructure it.
- [x] `wiki/knowledge/sources/dispatch-clear-first-enter-race.md`: append a `resolved_by::[[TASK-0185]]` line after the existing `relates_to` lines (one line only; the page is otherwise correct).
- [x] `wiki/knowledge/entities/components/host-server.md`: if it describes task dispatch, note the async delays; skip if it does not mention dispatch mechanics.
<!-- Updated: 2026-09-19 08:57 -->
<!-- Step 6 done: added a "Resolved (TASK-0185)" paragraph to tmux-send-keys-render-delay-race.md (+ relates_to::[[TASK-0185]]); appended `resolved_by::[[TASK-0185]]` to dispatch-clear-first-enter-race.md; added a "Fixed by TASK-0185" paragraph to entities/components/host-server.md right after its now-stale "zero delay" paragraph (old text kept, labelled pre-fix); appended the tackle entry to wiki/log.md and confirmed the log tail intact. -->
- [x] Append a `wiki/log.md` entry for the fix at the end of the tackle run, and spot-check the log tail afterwards (parallel appends have corrupted it before).
