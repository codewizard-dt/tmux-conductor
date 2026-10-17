---
id: inactive-agent-shows-other-agents-window
title: Why an Inactive Agent Shows Another Agent's tmux Window
aliases: [tmux-prefix-match-wrong-window, inactive-agent-wrong-terminal]
updated: 2026-09-19
sources:
  - ../../../raw/research/inactive-agent-shows-other-agents-window/index.md
confidence: ambiguous
tags: [tmux, host-server, bug, window-targeting, dashboard]
---

# Why an Inactive Agent Shows Another Agent's tmux Window

User screenshots showed `tmux-conductor-3` badged NO WINDOW yet rendering a live terminal (and a "DIRECT INPUT — KEYS GO TO TMUX-CONDUCTOR-3" banner) that actually belonged to its clone `tmux-conductor-3-copy`, while `tmux-conductor-2` / `roadmap` (also NO WINDOW) correctly showed "Window not present." The suspected name collision is close but not the mechanism: **there is no duplicate name.** The cause is that `derived_from::[[host-server]]` addresses every pane with `-t <session>:<windowName>`, and tmux resolves the window component by exact name first, then a unique **prefix** match (then fnmatch). With `…-3` gone and `…-3-copy` alive, `…-3` silently resolves to the copy. Verified live on tmux 3.7c.

**The status badge is right, everything else is wrong.** The snapshot/poll path uses an exact-match `Map` built from one `list-windows` call (`readTmuxWindowInventory`), so it correctly reports `no-window`. But `capturePaneTail`, `capturePaneTailRaw`, `isPaneDead`, `sendTextToPane`, the `kill-window`/`rename-window`/`pipe-pane` calls, and the `isTmuxWindowPresent` guard (`has-session -t sess:win`) all use the prefix-matching form — and the 2s terminal loops capture every agent without a presence check. "Some but not all" = only agents whose window name is a strict prefix of another live window's name, which `POST /agents/:id/clone`'s `-copy` suffix guarantees for any stopped original.

> **Contradiction (2026-09-19, found during TASK-0182 Step 3):** the raw research report says the 2-second `terminal-loop` / `focused-terminal-loop` "capture every agent's pane **without** a `windowPresent` check." That is wrong: both loops already read one `readTmuxWindowInventory` per tick and filtered to agents whose exact `agentWindowName` is in it (and skipped on timeout). The leaking read paths were the `isTmuxWindowPresent`-guarded tail endpoint and terminal WebSocket, not the loops. `raw/` is immutable so the report was not edited; this page carries the correction. The task's loop change is only a one-time empty-text clear broadcast when a window vanishes.

**It is not just cosmetic.** Because the guard passes on a prefix match, Interact-mode keys, image-upload typing, Stop, Delete (`kill-window`), and queue dispatch on an inactive agent can act on the clone's live pane — including killing it. The `409 window already exists` checks also false-positive when creating an agent whose window name prefixes a live one. Recommended fix: a single `windowTarget()` helper emitting tmux's exact-match `session:=window` (supported ≥ 2.1; project needs ≥ 3.0), applied across `state.ts`, `index.ts`, and the bash scripts, plus a regression test with `foo`/`foo-copy`. See [[tmux-window-target-prefix-matching]].

relates_to::[[host-server]]
relates_to::[[tmux-window-target-prefix-matching]]
relates_to::[[agent-state-determination]]
relates_to::[[inactive-agents-panel]]
