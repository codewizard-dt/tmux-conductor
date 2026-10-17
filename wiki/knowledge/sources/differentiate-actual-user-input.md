---
id: differentiate-actual-user-input
title: Telling Genuine User Input Apart From Everything Else an Agent Receives
aliases: [actual-user-input, prompt-provenance, human-vs-injected-prompt]
updated: 2026-09-20
sources:
  - ../../raw/research/differentiate-actual-user-input/index.md
  - ../../raw/research/differentiate-actual-user-input/sources.md
confidence: extracted
tags: [hooks, claude-code, provenance, last-command, direct-input]
---

# Telling Genuine User Input Apart From Everything Else an Agent Receives

Follow-up to `derived_from::[[last-user-message-capture]]`, which recommended the `UserPromptSubmit` hook as the exact "what the user actually sent" signal. **That signal is not human-only.** Three independent reports show `UserPromptSubmit` also fires for Claude Code's machine-injected `<task-notification>` messages (a finished background agent), delivered to the hook as `prompt` exactly like a real prompt — so ROADMAP-0027's `last_prompt`, as implemented in TASK-0221, would store an XML blob as "the last message" whenever a background agent finishes. TASK-0219 tested typed, slash, paste and dispatch but never an injected notification, so this is a gap in our evidence. See `relates_to::[[claude-code-hooks]]`.

**Two different questions, two different signals.** *Human vs. harness-injected* is answered by Claude Code itself: transcript user records carry `origin.kind` (`human`, `task-notification`, `peer`, `coordinator`, `auto-continuation`, `unclassified`) and `promptSource` (`typed`, `system`, `sdk`); a record with no `origin` is *unattributed* (before v2.1.210 it counted as human). Measured in a real CLI 2.1.278 session: typed prompts are `human`/`typed`, typed slash commands are `human`/null, and 48 cross-session peer messages were `origin` null — not the documented `peer` kind — so an allow-list on `origin.kind === "human"` is safe and a deny-list on named kinds is not. *Human vs. conductor-dispatched* cannot come from Claude: `tmux send-keys` and a keyboard are byte-identical, so only the sender knows, and the conductor already writes `dispatch.jsonl` (with the exact `command`) before it types.

**Recommended design (classification by elimination):** (1) a cheap prefix guard in the hook so `<task-notification`, `<system-reminder`, `<teammate-message`, `Another Claude session sent a message:` and `<local-command` never overwrite `last_prompt`; (2) a server-side classifier that joins the hook's `prompt_id` to the transcript's `promptId` (join equality **unverified**) and treats only `origin.kind === "human"` as human, everything else `injected`/`unknown`; (3) correlate against `dispatch.jsonl` (same agent, normalized text, short window, consume once) to label `dispatch`; (4) store `kind: human | dispatch | injected | unknown` beside `last_prompt` and show human + dispatch (the confirmed scope) with a small "queued" marker, never `injected`. Run a small isolated spike first: does the hook fire for background-task completions and peer messages, is `prompt_id` == `promptId`, what `origin` a `send-keys` prompt gets, and queued-while-busy, Up-recall and image-paste behaviour. See `derived_from::[[user-input-provenance-classification]]`.

**Audit findings kept from the interrupted assumption review:** the hook's sidecar key equals the server's `agentWindowName` at spawn (confirmed), but **rename** renames the tmux window and `<win>.state` and not `<win>.meta.json`, and the running agent keeps its old `CONDUCTOR_AGENT_NAME`, so `lastPrompt` goes missing until restart; `agents.id INTEGER PRIMARY KEY` without `AUTOINCREMENT` does reuse ids after delete, justifying TASK-0228's orphan sweep; the installed `~/.claude/hooks/tmux-conductor` copy is still the old version (feature inert until re-install); the +1 byte change to `~/.claude/settings.json` remains unexplained (Claude Code writes that file itself and has had writer races); and `scripts/verify-bg-link-retired.sh` shows a fully isolated host-server + private tmux stack is feasible for hermetic live verification.

> **Contradiction:** `[[last-user-message-capture]]` and `[[hook-authoritative-last-prompt]]` call the `UserPromptSubmit` payload the authoritative record of what the user *actually sent*; this source shows the event also carries harness-injected text, so the hook value alone is not human input. Both pages carry the callout.
