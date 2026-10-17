---
id: last-user-message-capture
title: Capturing the Last Command / Chat Message the User Actually Sent
aliases: [last-prompt-capture, onenter-vs-userpromptsubmit]
updated: 2026-09-20
sources:
  - ../../raw/research/last-user-message-capture/index.md
  - ../../raw/research/last-user-message-capture/sources.md
  - ../../raw/research/differentiate-actual-user-input/index.md
confidence: ambiguous
tags: [hooks, claude-code, direct-input, sidecar, last-command]
---

# Capturing the Last Command / Chat Message the User Actually Sent

Follow-up to `derived_from::[[terminal-typed-command-persistence]]`, prompted by the question "should we capture the last sent message with an `onEnter` handler?". **No — Enter is a keystroke, not a submission.** In Direct Input the TUI (Claude Code) owns the input line, so Enter can also accept an autocomplete/slash-command suggestion, confirm a dialog choice, submit nothing, or add a newline; the browser cannot tell which. xterm.js has no `onEnter` at all — Enter arrives as `\r` in `onData` (or via `onKey`), and the common "buffer chars until `\r`" tutorial pattern is a hand-rolled shell, not an app-owned input line. See `relates_to::[[keystroke-stream-command-reconstruction]]`.

**The authoritative "actually sent" signal already exists in this repo.** Claude Code's `UserPromptSubmit` hook fires when a prompt is accepted, before the model processes it, and its stdin payload carries a **`prompt`** field with the exact submitted text. `hooks/on-prompt-submit.js` is already registered under that event (for Codex too, via the same script), and the shared `write-state.js::writeState()` already `JSON.parse`s the whole payload — then persists only `transcript_path`/`session_id`/`model` into `<agent>.meta.json` and **discards the prompt**. Persisting `payload.prompt` as `last_prompt: { text, ts }` in that same sidecar merge is a ~5-line change (no signature change: only `UserPromptSubmit` carries `prompt`, so other events leave the previous value). The host-server already reads that sidecar (`context.ts::resolveTranscriptPath`). See `derived_from::[[hook-authoritative-last-prompt]]` and [[claude-code-hooks]].

**Why this beats the localStorage/keystroke plan:** it is exact (history recall, Tab, cursor edits, paste, multi-line), covers queue-dispatched prompts and input from any client, and is server-side so it survives reload and is identical across browsers. The existing `activeTask` pipeline (`getActiveTask()` → snapshot → SSE diff `prev.activeTask !== agent.activeTask` → strip in `AgentList.tsx`) shows exactly where a `lastPrompt` field plugs in; keep `activeTask` for the transient in-flight case.

**Alternatives and gaps.** Tailing the transcript JSONL works but is noisy — `type:"user"` records include injected meta lines (`isMeta`), tool results, `<local-command-caveat>` blocks and slash-command wrapper strings, and community parsers confirm `type` names the channel, not the author. **Unverified:** whether `UserPromptSubmit` fires for typed slash commands (a separate `UserPromptExpansion` event exists for them) — dump one payload to settle it before promising full coverage. The hook alone cannot label typed vs. queue-dispatched (correlate with the latest `dispatch.jsonl` record). Non-hook agents (Aider) still need the keystroke fallback. Hook edits need `install-hooks.sh` re-run and an agent restart (hook config is snapshotted at session start). Cap/redact stored text (secrets, large pastes).

> **Contradiction (2026-09-20):** the "authoritative signal" claim above is too strong. `raw/research/differentiate-actual-user-input/index.md` shows `UserPromptSubmit` also fires for harness-injected messages (a `<task-notification>` block from a finished background agent arrives as `prompt`), so the payload is exact text but not necessarily human input, and TASK-0219 never tested that case. Layered classification (Claude's `origin.kind`, then the conductor's `dispatch.jsonl`) is in `derived_from::[[differentiate-actual-user-input]]` and [[user-input-provenance-classification]].
