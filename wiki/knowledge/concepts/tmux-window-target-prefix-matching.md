---
id: tmux-window-target-prefix-matching
title: "tmux Window Targets Prefix-Match — Use `=` for Exact Names"
aliases: [tmux-exact-match-target, tmux-target-window-prefix]
updated: 2026-09-19
sources:
  - ../../raw/research/inactive-agent-shows-other-agents-window/index.md
confidence: extracted
tags: [tmux, pattern, host-server, correctness]
---

# tmux window targets prefix-match — use `=` for exact names

When a tmux command's `-t` names a window (`session:window`), tmux resolves the window part by (1) exact name, (2) a **unique prefix** of a window name, (3) an fnmatch pattern. So `-t conductor:foo` silently addresses `foo-copy` whenever no window named exactly `foo` exists. Verified on tmux 3.7c: `has-session -t conductor:<name>` returned success and `display-message` reported the sibling window; the same target with a non-prefix name failed with "can't find window"; and `conductor:=<name>` (the `=` exact-match prefix) failed as desired.

**Consequence for any tool that builds targets from names it owns**: a "missing window" check via `has-session`/`display-message` is not a presence check, and every read *and write* (`capture-pane`, `send-keys`, `kill-window`, `pipe-pane`) can land on a different window. An exact-match `list-windows` inventory is the only reliable presence signal without `=`. In `uses::[[host-server]]` the status path used the inventory (correct) while every other path used prefix-matching targets — see `derived_from::[[inactive-agent-shows-other-agents-window]]`.

**Shipped (TASK-0182, 2026-09-19):** `windowTarget()` in `host-server/state.ts` emits `session:=window` and is used for every window target in `state.ts`/`index.ts` and the bash scripts; regression-tested in `host-server/state.test.ts` and `scripts/verify-exact-window-targets.sh`. A related operational gotcha found while verifying: the live host-server was `npm run start` with no `--watch`, so source fixes do not reach it until it is restarted (`make dev`).

**Rule**: centralize target construction in one helper that emits `session:=window` (tmux ≥ 2.1), or target by `window_id` (`@N`) resolved from the inventory when duplicate names must be tolerated. Window names containing `:` or `.` remain unaddressable either way.

relates_to::[[host-server]]
relates_to::[[tmux-send-keys-render-delay-race]]
relates_to::[[agent-state-determination]]
