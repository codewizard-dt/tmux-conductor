---
topic: "Whenever a user sends a command directly from typing it into the terminal and pressing enter, that command should be persisted in local storage and shown as the active, as the most recent command from the user that should be displayed at the top of the page."
slug: terminal-typed-command-persistence
researched: 2026-09-19
---

# Primary Sources — Persisting the Last Directly-Typed Terminal Command as the "Active" Command

Line numbers for Serena-derived rows are as reported by Serena (0-based) and are approximate; symbol names are the stable locator.

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `frontend/src/components/AgentList.tsx` — `agent.activeTask && (…)` render sites (~1135–1142 detail-pane strip, ~1243–1247 sidebar card) | 2026-09-19 | The top-of-page "active" strip and the sidebar-card line both render only `agent.activeTask` |
| S2 | codebase | `host-server/state.ts::getActiveTask` (~743–763) | 2026-09-19 | `activeTask` comes solely from the last `dispatch.jsonl` record for the window, only while state is busy/awaiting/stalled, dropped if busy file is >30 s newer than the record |
| S3 | codebase | `frontend/src/components/LogTail.tsx` — `mapKey`, `enqueue`, `handleKeyDown`, `handlePaste`, `handleSendSubmit`, `sendText` draft key | 2026-09-19 | Per-key input mapping; `enqueue` is the single choke point (WebSocket path with HTTP fallback); send box sends `{text, enter:true}`; existing `conductor:sendDraft:<agentId>` localStorage key with try/catch |
| S4 | codebase | `frontend/src/components/AddTaskForm.tsx` — `conductor:taskDraft:<agentId>` get/set/remove | 2026-09-19 | Second instance of the `conductor:<thing>:<agentId>` key convention with try/catch degrade |
| S5 | codebase | `frontend/src/lib/agentOrder.ts::loadOrder` (+ `saveOrder`, `clearOrder`, `AGENT_ORDER_STORAGE_KEY`) and `agentOrder.test.ts`, `AgentList.test.tsx` (TASK-0183 block) | 2026-09-19 | Pure localStorage helper pattern with validation and silent-failure; test idioms (`localStorage.clear()`, seed-before-mount, throwing `getItem`/`setItem`) |
| S6 | codebase | `host-server/index.ts` — `POST /agents/:id/keys` handler (~1325–1341) and `sendDirectInput` (~595–663) | 2026-09-19 | Server only forwards keys/text/enter to `tmux send-keys`; no command record is written anywhere |
| S7 | context7 | `/reactjs/react.dev` — "useSyncExternalStore subscribe to browser storage event and getSnapshot must return cached immutable value" | 2026-09-19 | Hook signature; `getSnapshot` must be immutable/cached (`Object.is`); `subscribe` should be declared outside the component and return an unsubscribe |
| S8 | codebase | `CLAUDE.md` (project) — Config vs data split; Direct/Interact endpoints table | 2026-09-19 | Constraint that operational data lives in SQLite/host-server and that `POST /agents/:agent/keys` is the direct-input path |

## Excerpts

### S7 — React `useSyncExternalStore` reference
https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useSyncExternalStore.md
> **getSnapshot** … A function that returns a snapshot of the data in the store needed by the component. While unchanged, repeated calls must return the same value. If the returned value differs (compared via `Object.is`), React re-renders.

> The store snapshot returned by `getSnapshot` must be immutable. If the underlying store has mutable data, return a new immutable snapshot if the data has changed. Otherwise, return a cached last snapshot.

> If a different `subscribe` function is passed during a re-render, React will re-subscribe to the store using the newly passed `subscribe` function. You can prevent this by declaring `subscribe` outside the component.

### S3 — `LogTail.tsx::enqueue` (verbatim)
```ts
function enqueue(payload: KeysPayload) {
  if (focused && terminalWsRef.current?.sendInput(payload)) {
    setSendError(null)
    return
  }
  queueRef.current = queueRef.current
    .then(() => sendAgentKeys(agentId, payload))
    ...
}
```

### S2 — `state.ts::getActiveTask` (verbatim excerpt)
```ts
if (state !== 'busy' && state !== 'awaiting' && state !== 'stalled') return null;
const record = readLastDispatches(conf.logDir).get(windowName);
if (!record) return null;
...
if (fileState === 'busy' && mtimeMs - Date.parse(record.ts) > 30_000) { return null; }
return record.command;
```
