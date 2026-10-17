---
id: user-input-provenance-classification
title: User-Input Provenance Classification (Human vs. Dispatch vs. Injected)
aliases: [prompt-kind-classification, input-provenance-layers]
updated: 2026-09-20
sources:
  - ../../raw/research/differentiate-actual-user-input/index.md
confidence: inferred
tags: [hooks, claude-code, provenance, pattern]
---

# User-Input Provenance Classification (Human vs. Dispatch vs. Injected)

Text reaches an agent's prompt from several senders, and the receiving application cannot see all of them: a **human** (dashboard Direct Input or an attached terminal), the **conductor** (queue dispatch, Add Task dispatch, an orchestrator's enqueue — all `tmux send-keys`), the **harness** (`<task-notification>`, `<system-reminder>`, hook feedback, subagent and peer/teammate messages) and **slash-command expansions**. "The prompt hook fired" therefore proves only that *some* text was submitted.

**Classify by elimination, one layer per sender the receiver cannot see.** Layer 1 uses the application's own provenance to remove harness-injected text: allow only transcript `origin.kind === "human"` (join via the hook's `prompt_id` to the record's `promptId`, unverified); null/absent origin is *unattributed*, so map it to `unknown`, never assume human. Layer 2 uses the **sender's own record** to remove the conductor's injections: the send is invisible to Claude (PTY bytes are identical) but the conductor writes `dispatch.jsonl` before typing, so match agent + normalized text within a short window and consume the record once. What remains is human (positively confirmable only for dashboard Direct Input, where the server sees the keystrokes; a terminal attach is human by elimination).

**Design rules:** prefer an allow-list on the positive signal over a deny-list of named kinds (the CLI leaves `origin` null for peer messages even though the SDK documents a `peer` kind); keep a cheap prefix guard in the hook as belt and braces only; do the transcript join lazily server-side (the hook runs before the transcript record exists and must stay tiny); store the resulting `kind` with the value instead of dropping data, and let the display policy decide what to show; degrade to ledger-only for agents without hooks (Codex, Aider). Limits: `origin` and `promptSource` disagree on a small slice of real records; identical text typed right after a dispatch is mislabelled `dispatch`; correlation windows need tuning.

relates_to::[[hook-authoritative-last-prompt]] relates_to::[[last-user-message-capture]] relates_to::[[differentiate-actual-user-input]] relates_to::[[claude-code-hooks]] relates_to::[[dispatch-path-parity]] relates_to::[[keystroke-stream-command-reconstruction]]
