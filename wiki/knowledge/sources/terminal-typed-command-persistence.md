---
id: terminal-typed-command-persistence
title: Persisting the Last Directly-Typed Terminal Command as the "Active" Command
aliases: [typed-command-persistence, last-typed-command]
updated: 2026-09-20
sources:
  - ../../raw/research/terminal-typed-command-persistence/index.md
  - ../../raw/research/terminal-typed-command-persistence/sources.md
  - ../../raw/research/last-user-message-capture/index.md
confidence: ambiguous
tags: [frontend, terminal, localstorage, direct-input, react]
---

# Persisting the Last Directly-Typed Terminal Command as the "Active" Command

Research ahead of a `/roadmap-create` for the requirement: when a user types a command straight into the Direct Input terminal and presses Enter, persist it to `localStorage` and show it as the most recent/"active" command at the top of the page.

**The "active command" strip already exists but cannot see typed commands.** `agent.activeTask` renders in a full-width strip at the top of the agent detail pane and as a line in each sidebar card (both in `AgentList.tsx`), and it is sourced **only** from the last `dispatch.jsonl` record via `getActiveTask()` in `host-server/state.ts`, and only while the agent is `busy`/`awaiting`/`stalled`. `POST /agents/:id/keys` → `sendDirectInput()` just forwards to `tmux send-keys` and records nothing, so a directly-typed command never reaches that pipeline. This is a genuinely new data source, not a display tweak (see [[agent-detail-modal]], [[host-server]]).

**`LogTail.enqueue()` is the single capture seam, but it only sees keystrokes.** `mapKey()` emits one `{ text: <char> }` or `{ keys: ['Enter'|'BSpace'|'Up'|'Tab'|'C-u'…] }` per keypress, and `handlePaste` and the send box funnel through the same `enqueue` (WebSocket first, HTTP `/keys` fallback). The browser never holds the assembled command line, so "the command" has to be **reconstructed** — and that reconstruction is lossy (history recall, Tab completion, cursor edits, paste). See `derived_from::[[keystroke-stream-command-reconstruction]]` and [[log-tail]].

**Recommended shape: a small `lib/` module in the `agentOrder.ts` pattern** — pure `load/save/clear` helpers keyed `conductor:lastCommand:<agentId>` (existing `conductor:<thing>:<agentId>` convention, every access try/catch'd), a pure line-buffer reducer that commits on `Enter` and **keeps the previous record when uncertain**, and a `useSyncExternalStore` hook (own same-tab listener set, since `localStorage` does not notify the writing tab) feeding the existing strip. The send-box path records the exact `{text, enter:true}` line through the same module. Two product questions must be settled before tasks are cut: whether "active" means *retained until replaced* (matches the requirement text) or *cleared when the agent goes idle* (matches today's strip), and which top-of-page surface(s) render it and how they merge with the dispatch-driven `activeTask`. A secret-capture risk (passwords typed into a masked prompt landing in plaintext `localStorage`) needs an explicit mitigation.

> **Contradiction (TASK-0200, 2026-09-20):** the claims above that "the send box funnels through `enqueue`" and "records the exact `{text, enter:true}` line" no longer hold. TASK-0200 removed the one-off send box from `LogTail`; its bottom bar now hosts the Add Task box (queue entry, not a pane keystroke), so the only `enqueue` inputs are Direct Input keys, paste and image drops, and there is no exact-line source in the terminal. The `sendDraft` key is likewise gone.

Relates to [[browser-terminal-input-capture]] and the frontend localStorage conventions used by draft persistence (`sendDraft`, `taskDraft`) and `agentOrder.ts`.

> **Contradiction (2026-09-20):** the recommendation above (frontend line-buffer in `enqueue()` → `localStorage`) is superseded for hook-capable agents by `raw/research/last-user-message-capture/index.md`: Claude Code's `UserPromptSubmit` hook already delivers the exact submitted `prompt`, and this repo's `write-state.js` parses and drops it. Persisting it in the `<agent>.meta.json` sidecar is exact, server-side, reload/browser-independent and covers queue-dispatched prompts, removing the localStorage lossiness and secret-in-browser-storage risks. This page's option A survives only as the fallback for agents without hooks. See `contradicts::[[last-user-message-capture]]` and [[hook-authoritative-last-prompt]]. The open "retained vs. cleared-on-idle" product question is unchanged.
