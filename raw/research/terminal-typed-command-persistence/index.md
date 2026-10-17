---
topic: "Whenever a user sends a command directly from typing it into the terminal and pressing enter, that command should be persisted in local storage and shown as the active, as the most recent command from the user that should be displayed at the top of the page."
slug: terminal-typed-command-persistence
researched: 2026-09-19
sources: [./sources.md]
---

# Research: Persisting the Last Directly-Typed Terminal Command as the "Active" Command

> The dashboard already has an "active task" strip at the top of the agent detail pane (`agent.activeTask`), but it is fed **only** by `dispatch.jsonl` — i.e. queue-dispatched commands — so a command typed straight into the Direct Input terminal never appears there [S1][S2]. Direct Input sends **one keystroke at a time** through a single frontend choke point (`enqueue()` in `LogTail.tsx`), so the browser never holds the assembled command line [S3]; recording "the command" therefore needs a line buffer that mirrors what the pane's readline would do, and that mirror is lossy (history recall, Tab completion, cursor edits, paste). The cheapest correct-enough design is a small `lib/` module (pattern of `agentOrder.ts`) that buffers printable text and commits on `Enter` into `localStorage` keyed per agent, exposed to the strip through `useSyncExternalStore`, with the lossy cases explicitly defined (and the exact-line send-box path recorded verbatim).

## Research Questions

1. Where do "commands typed directly into the terminal" enter the system, and is there a single interception point?
2. What does the top-of-page "active" command display show today, and where does its data come from?
3. What localStorage conventions already exist in the frontend that a new persistence key should follow?
4. How can the frontend derive "the command the user submitted" from per-keystroke input?
5. How should a localStorage value drive a re-rendering React component (same tab and across tabs)?

## Current State (Codebase)

- **Input path.** In Direct Input mode a hidden capture `<div>` receives `onKeyDown={handleKeyDown}`; `handleKeyDown` maps each key through `mapKey()` and calls `enqueue(payload)` [S3]. `mapKey` returns `{ text: <single char> }` for printable keys and `{ keys: ['Enter'] }`, `['BSpace']`, `['Up']`, `['Tab']`, `['C-u']`, `['C-w']`, etc. for control keys [S3]. `handlePaste` sends `{ text: pastedText }` through the same `enqueue` [S3]. `enqueue` first tries the terminal WebSocket (`terminalWsRef.current?.sendInput`) when the terminal is `focused`, else falls back to a serialized `sendAgentKeys` POST to `/agents/:id/keys` [S3][S6]. **`enqueue()` is the one place every typed byte passes through.**
- **Second, exact channel.** The send box under the terminal (`handleSendSubmit`) sends `{ text, enter: true }` — an exact, complete line — and already persists an unsent *draft* in `localStorage` under `conductor:sendDraft:<agentId>` [S3].
- **Server never sees a "command".** `POST /agents/:id/keys` → `sendDirectInput()` shells out to `tmux send-keys` (literal text, key names, optional Enter) with no logging of what was sent as a command and no write to `dispatch.jsonl` [S6].
- **Active-command display today.** `getActiveTask(conf, windowName, state)` returns the last `dispatch.jsonl` record's `command` only while the agent is `busy`/`awaiting`/`stalled`, and drops it if the `busy` state file is >30 s newer than the dispatch record [S2]. The value ships as `agent.activeTask` and is rendered in two places in `AgentList.tsx`: a full-width strip at the top of the agent detail pane (`border-b … font-mono text-[11px] … truncate`) and a `text-[10px]` line in the sidebar agent card [S1].
- **localStorage conventions.** Keys are namespaced `conductor:<thing>:<agentId>` (`sendDraft`, `taskDraft`) [S3][S4] or a module constant (`AGENT_ORDER_STORAGE_KEY`) with pure `loadOrder`/`saveOrder`/`clearOrder` helpers in `frontend/src/lib/agentOrder.ts`; every access is wrapped in `try/catch` and degrades silently, and tests assert both the persisted value and the "does not throw when `getItem`/`setItem` throws" behaviour [S4][S5].

## Key Findings

1. **Typed commands are invisible to every "active task" surface.** The strip is dispatch-log-driven [S1][S2]; Direct Input never writes a dispatch record [S6]. So the requirement is a genuinely new data source, not a display tweak.
2. **`enqueue()` is the correct capture seam.** It sees every keystroke and paste, in both the WebSocket and HTTP paths, so hooking there avoids double-instrumenting two transports [S3].
3. **The command line has to be reconstructed, and reconstruction is lossy.** The pane owns the real input buffer (Claude Code TUI / a shell). The frontend only sees deltas. A mirror buffer is exact for "type text, press Enter", but wrong when the user: recalls history with `Up`/`Down` (no text sent, buffer empty at Enter), Tab-completes, moves the cursor and edits mid-line, uses `C-u`/`C-w`/`M-` word edits, or pastes multi-line text [S3] *(inference — no primary source for the TUI's exact readline behaviour)*.
4. **Two ways to close the lossiness, with different cost.** (a) Define the semantics narrowly and honestly — record only what the frontend can prove it typed, and drop the record (do not overwrite the last good one) when the buffer is empty/uncertain at Enter. (b) Read the assembled line from the pane on Enter via the existing `capture-pane` tail path — exact, but server-side, racy against the TUI re-render, and it would not be "localStorage" any more *(inference)* [S6].
5. **"Active" needs a lifecycle decision.** The existing strip clears itself when the agent leaves `busy` [S2]; a persisted-to-localStorage command is by design *retained*. Whether "active" means "the last command, kept until replaced" (matches the requirement wording "most recent command … displayed at the top") or "the in-flight command, cleared when idle" is a product choice that changes the data model (timestamp + status vs. plain string).
6. **React's supported way to render an external store is `useSyncExternalStore`.** `subscribe` must return an unsubscribe, `getSnapshot` must return a cached/immutable value (`Object.is` compared), and `subscribe` should be declared outside the component [S7]. localStorage does not notify same-tab writers, so the module needs its own listener set for same-tab updates and can additionally listen to the browser `storage` event for other tabs *(inference — `storage` event semantics are standard DOM behaviour, not verified against a fetched doc in this run)*.
7. **Existing test idioms transfer directly.** `localStorage.clear()` in `beforeEach`, seed-before-mount, and throw-injection tests are already the norm [S5].

## Constraints

- Frontend-only persistence as requested: no schema/DB change, no new endpoint. `conductor.conf` and SQLite stay untouched (CLAUDE.md config-vs-data split) [S8].
- Must follow the `conductor:<thing>:<agentId>` key convention and the try/catch-and-degrade rule; storage may be unavailable (private mode) [S3][S4].
- Must not break Direct Input latency: capture must be synchronous, allocation-light, and never `await` inside `handleKeyDown` (`enqueue` already fans out asynchronously) [S3].
- Secrets risk: a user may type a password/token into the pane; persisting typed text to `localStorage` stores it unencrypted in the browser *(inference — worth a mitigation: skip capture while a masked prompt is up, or cap/expire entries)*.
- The strip renders `agent.activeTask` (a string from the API); a second source (local) has to be merged with, or take precedence over, the server value.
- Terminal-first detail pane already drives Direct Input on by default, so the feature applies to nearly every session in that pane [S3].

## Solution Comparison

| Criteria | A. Frontend line-buffer in `enqueue()` → localStorage | B. Record only the send-box submit (`handleSendSubmit`) | C. Server records `POST /keys` lines (reads pane on Enter) |
|----------|-------------------------------------------------------|----------------------------------------------------------|-------------------------------------------------------------|
| **Approach** | Mirror typed text; on `Enter` commit `{command, ts}` to `conductor:lastCommand:<agentId>` | Persist the exact `text` when the send box submits | Add the line to `dispatch.jsonl`-style record server-side; surface via `activeTask` |
| **Matches requirement ("typed into the terminal")** | Yes | No — that is the box *under* the terminal | Yes, but not via localStorage |
| **Pros** | Frontend-only; one seam (`enqueue`); covers WS + HTTP paths | Exact, trivial, ~10 lines | Exact line (from pane); survives reload/other browsers; one source of truth |
| **Cons** | Lossy on history/Tab/cursor edits/paste; possible secret capture | Wrong input surface; misses the terminal entirely | Not localStorage; capture-pane race with TUI redraw; more moving parts |
| **Complexity** | Medium | Low | High |
| **Dependencies** | None | None | None (new endpoint/field) |
| **Codebase fit** | High — mirrors `agentOrder.ts` + draft keys | High but off-target | Medium — extends `state.ts`/`index.ts`, contradicts "local storage" |
| **Maintenance** | Edge-case tuning as TUI input behaviour changes | Minimal | Ongoing server/client contract |

## Recommendation

**Option A**, with the send-box path (B) recorded through the same module so both inputs feed one store.

Implementation outline (ordering, not step detail):
1. Pure `frontend/src/lib/lastCommand.ts`: `loadLastCommand(agentId)`, `saveLastCommand(agentId, entry)`, `clearLastCommand(agentId)`, an in-memory listener set, and a `subscribeLastCommand` / `getLastCommandSnapshot` pair shaped for `useSyncExternalStore` — with unit tests in the `agentOrder.test.ts` style (corrupt JSON, throwing storage).
2. A pure line-buffer reducer (`applyKeyToBuffer(buffer, payload) → { buffer, submitted? }`) so the lossy rules are unit-testable independent of React.
3. Wire the reducer into `LogTail.enqueue()` (and `handleSendSubmit`) so every input path commits on Enter.
4. A `useLastCommand(agentId)` hook and render it in the detail-pane strip (and optionally the sidebar card), reconciling with `agent.activeTask`.
5. Tests for the strip and for `LogTail` capture; UAT for the round-trip (type → Enter → reload → still shown).

Risks & mitigations:
- *Wrong line recorded after history/Tab/cursor edits* → reducer resets to "uncertain" on those keys and, when uncertain at Enter, **leaves the previous record unchanged** rather than storing a wrong one.
- *Secrets typed into a masked prompt* → decide up-front: skip capture when the pane shows a password prompt, and/or cap length and store only the first line; document it.
- *Stale display* → store a timestamp and decide the "active vs. retained" lifecycle explicitly (Finding 5).
- *Multi-tab/clone agents share a workdir* → key by `agentId`, never workdir (memory: agents can share a workdir).

Alternative if constraints change: if exactness across browsers/reloads matters more than "localStorage", choose C and reuse the `activeTask` pipeline.

## Next Steps

- Decide the two open product questions before filing tasks: (1) what "active" means (retained-until-replaced vs. cleared-on-idle); (2) which "top of the page" surface (detail-pane strip, sidebar card, or both) and how it merges with the existing dispatch-driven `activeTask`.
- Then a roadmap: `/roadmap-create` → tasks via `/task-add --roadmap ROADMAP-NNNN`.
- Fold this report into the wiki: `/wiki-ingest raw/research/terminal-typed-command-persistence/index.md` (auto-ingest is enabled for this run).
