---
id: tmux-send-keys-render-delay-race
title: "tmux send-keys: a literal-text send + immediate Enter races the target program's own render"
aliases: [send-keys-enter-race, dispatch-render-delay]
updated: 2026-09-19
sources:
  - ../../raw/research/dispatch-clear-first-enter-race/index.md
confidence: extracted
tags: [tmux, dispatch, host-server, reliability, pattern]
---

# tmux send-keys: literal text + immediate Enter races the target program's own render

`tmux send-keys -t <target> -l -- "<text>"` followed immediately by `tmux send-keys -t <target> Enter` **looks** like two sequential, safely-ordered operations because the second `spawnSync`/shell command only starts after the first one returns. But that return only means tmux's server has accepted and delivered the keystrokes to the pane's pty — it says nothing about whether the **target program** (a Claude Code CLI REPL, in this codebase) has actually read, parsed, and rendered them yet. Sending `Enter` before that render completes can land on the wrong UI state — e.g. selecting a highlighted slash-command autocomplete entry instead of submitting the line — leaving the typed text sitting unsubmitted at the prompt.

`uses::[[host-server]]` has this exact race in two independent implementations of "type text then press Enter into a tmux pane":
- `state.ts::sendTextToPane` (task dispatch) — zero delay between the literal-text send and the `Enter` send, in every case.
- `index.ts::sendDirectInput` (`POST /agents/:id/keys`, Direct Input) — has an explicit `await sleep(300)` before `Enter`, but only when the send is a multiline paste-buffer operation; the single-line `send-keys -l` case (identical shape to task dispatch) has no delay either.

The one place in this codebase that *does* guard against this is `scripts/dispatch.sh`, the bash CLI dispatch tool: `sleep 0.3  # let the UI render before submitting` between the literal-text `send-keys` and the `Enter` `send-keys`. When host-server grew its own TypeScript dispatch path (`TASK-011`'s immediate-dispatch fast path, later becoming the sole dispatch owner via `TASK-120`/`TASK-121`), it copied the two-separate-`send-keys`-calls *shape* of that convention but not the render-delay half — the one detail the original comment flags as load-bearing.

**Compounding case: chained sends.** `index.ts::dispatchTaskToAgent`'s `opts.clearFirst` (set only for project-scoped tasks, `task.kind === 'project'`) calls `sendTextToPane` **twice** back-to-back — once for `/clear`, once for the real command — with no gap between the two calls either. This doubles exposure to the same race in a single dispatch and was confirmed live: real `logs/dispatch.jsonl` records show the exact predicted failure mode, a `/clear` and a task command concatenated on one unsubmitted line. See `derived_from::[[dispatch-clear-first-enter-race]]` for the full investigation and evidence.

**General lesson**: any code that drives a tmux-hosted interactive program via `send-keys` must treat "the target program has caught up" as a *timing* problem, not a *sequencing* problem — a fixed settle delay (this codebase's own precedent: 300ms, both in `scripts/dispatch.sh` and in `sendDirectInput`'s multiline case) is required before `Enter`, and doubly so before a *second* `Enter` immediately following a UI-state-changing command like `/clear`.

**Resolved (TASK-0185):** `state.ts::sendTextToPane` is now async and carries the same 300ms settle (env `DISPATCH_SUBMIT_DELAY_MS`) as `scripts/dispatch.sh` and `sendDirectInput`'s multiline path, and the `clearFirst` chain (`/clear` → Enter → 1000ms settle → task text → 300ms → Enter) goes through the new `sendDispatchToPane`. relates_to::[[TASK-0185]]

relates_to::[[host-server]] relates_to::[[tmux-send-keys-key-names]] relates_to::[[idle-detection-vs-async-background-work]]
