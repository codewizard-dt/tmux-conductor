---
id: hook-authoritative-last-prompt
title: Hook-Authoritative Last Prompt (Submit Event vs. Keystroke Mirror)
aliases: [userpromptsubmit-last-prompt, authoritative-submit-signal]
updated: 2026-09-20
sources:
  - ../../raw/research/last-user-message-capture/index.md
  - ../../raw/research/differentiate-actual-user-input/index.md
confidence: ambiguous
tags: [hooks, claude-code, pattern, sidecar]
---

# Hook-Authoritative Last Prompt (Submit Event vs. Keystroke Mirror)

To record "the message the user actually sent", prefer an **event emitted by the application that accepted the input** over reconstructing the input from the client's key events. The application is the only party that knows whether Enter meant *submit*; a client-side `onEnter`/keystroke mirror can only guess (see `contradicts::[[keystroke-stream-command-reconstruction]]` for hook-enabled agents).

**Shape for tmux-conductor:** `UserPromptSubmit` hook → `hooks/lib/write-state.js` sidecar merge (`<agent>.meta.json` gains `last_prompt: { text, ts }`, text capped at 2000 chars including the ellipsis marker; see Storage rules) → host-server reads the sidecar beside `resolveTranscriptPath` → new `lastPrompt` field on the agent snapshot (`buildSnapshot` **and** both SSE builders, plus the SSE change-diff comparison) → rendered in the existing `activeTask` strip/sidebar card. Retained-until-replaced semantics come free; `activeTask` stays the transient in-flight value.

**Properties:** exact for every input route (typed, history recall, paste, queue dispatch, another client); server-side so it survives reload and browser changes; adds no work to the keystroke hot path; hook stays best-effort (`exit 0`, never blocks the agent). **Limits:** hook-capable agents only (Claude Code; Codex likely via the same registered script); typed-vs-dispatched needs a `dispatch.jsonl` correlation; slash-command coverage unverified (`UserPromptExpansion` is the documented slash-command event); hook edits need installer re-run + agent restart; stored prompts may contain secrets.

**Second-best alternative:** tail the transcript JSONL for the last real user record — needs a heuristic filter (`!isMeta`, string content, not `<command-…>`/`<local-command-…>` wrappers, not sidechain) over an unspecified format. Keep as a cross-check, not the primary source.

## Storage rules

Decided in TASK-0220 (`derived_from::[[TASK-0220]]`); the sidecar (`last_prompt: { text, ts }`) and the browser `localStorage` store (`conductor:lastPayload:<agentId>`, `{ text, ts, source: 'hook' | 'add-task' }`) share them.

- **Ordering:** newest `ts` wins, comparing parsed epoch milliseconds (an unparseable `ts` counts as oldest); an exact tie goes to `hook` over `add-task`. Queue dispatch is not a separate source: the hook sees it as a normal submit.
- **Length cap:** 2000 characters total (1999 plus a single `…` marker at most), applied by the hook on write and re-applied idempotently by the host-server reader and `saveLastPayload`, without splitting a surrogate pair.
- **Multi-line display:** the strip and sidebar card show the first non-empty trimmed line, plus ` …` when more non-empty lines follow, via the shared `firstLinePreview(text)` helper; the full capped text goes in the `title` tooltip.
- **Secrets:** no redaction and no masked-prompt detection. A submitted secret is stored verbatim in `logs/state/<agent>.meta.json` and `localStorage` (local, single-user, gitignored, overwritten by the next prompt); `logs/dispatch.jsonl` already stores dispatched commands verbatim, so this is no new class of exposure.
- **Slash commands:** stored raw, exactly as submitted; if `UserPromptSubmit` does not fire for them, `UserPromptExpansion` feeds the same field under the same rules.
- **Empty prompts:** an empty or whitespace-only prompt never overwrites a stored value (hook, SSE mirror and `saveLastPayload` all guard it); stored text is otherwise not trimmed.
- **Lifecycle:** `DELETE /agents/:id` unlinks the agent's `<winName>.meta.json` sidecar so a re-created same-named agent does not inherit a stale `last_prompt`. The store API takes `agentId: number` (callers pass `agent.id`).

relates_to::[[claude-code-hooks]] relates_to::[[last-user-message-capture]] relates_to::[[terminal-typed-command-persistence]] relates_to::[[log-tail]] relates_to::[[host-server]]

> **Contradiction (2026-09-20):** this page treats the `UserPromptSubmit` payload as the exact record of what the user *sent*. `raw/research/differentiate-actual-user-input/index.md` finds the event also fires for harness-injected text (e.g. a finished background agent's `<task-notification>` block arrives as `prompt`), so the hook value alone is **not** proof of human input, and TASK-0221 as implemented would store such a block as `last_prompt`. Classify with `derived_from::[[user-input-provenance-classification]]` (prefix guard in the hook; server-side `origin.kind === "human"` join via `prompt_id`; `dispatch.jsonl` correlation) and store a `kind`. Slash-command and paste findings above are unaffected.
