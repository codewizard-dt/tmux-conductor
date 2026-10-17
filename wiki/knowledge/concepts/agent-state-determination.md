---
id: agent-state-determination
title: Agent State Determination
aliases: [Agent Status Detection, Agent State Detection]
updated: 2026-09-20
sources:
  - ../../raw/research/application-latency-structure/index.md
  - ../../raw/research/application-latency-structure/index-2.md
  - ../../raw/research/transition-observability/index.md
  - ../../raw/research/detect-agent-status-reason-mapping/index.md
tags: [agents, state, status, performance]
---

# Agent State Determination

Agent state determination combines several evidence sources: hook-written state files, tmux window inventory, pane-current-command liveness, plain `capture-pane` regex fallback, POSIX grep pattern checks, active-task inference, labels, mode detection, and context metadata. This gives robust fallback behavior across Claude, Codex, and custom agents, but it also spreads status semantics across backend detection and frontend display derivation.

The latency research recommends moving toward one backend-owned status contract. The host-server now keeps the legacy top-level `state` field for compatibility, and also emits a `status` object for each agent. That object contains `state`, backend-selected `display` (`empty` and `idle-waiting` included), `reason`, `needsAttention`, `activeTask`, and evidence fields for tmux window presence, pane-current-command, state-file value/age, and whether the active task is intentionally retained.

The dashboard should treat `status` as the authoritative contract and avoid re-implementing hook-state, regex, liveness, or active-task rules in React. `state` remains a compatibility alias for older call sites until the dashboard migration is complete.

Observability for this concept should record status transitions with previous/current status, detection reason, state-file age, agent profile (`claude`, `codex`, `custom`), whether a pane capture was needed, and detection duration. This makes dashboard state regressions diagnosable rather than relying on visual reports.

**Shipped as of 2026-09-18**: the observability gap is closed. `logs/transitions.jsonl` is live from both detectors — the host-server's `pollAndDiff` and `scripts/monitor.sh`'s poll loop each emit one JSONL record per detected status transition. `detectAgentStatus()`'s 18 `return` sites are mapped onto the 8-value `DetectionReason` union per [[detectAgentStatus Return-Site to DetectionReason Mapping]]. See [[Observability for Agent Status Transitions]] for the transition stream's shape and [[Testing strategy for monitor.sh's emit_transition_jsonl / transition-diff logic]] for its test coverage.

## BUG-0013 false-awaiting

The `awaiting` state (a dialog or prompt needs the user) was over-reported while agents were actually thinking. Measured from `logs/transitions.jsonl` for 2026-09-13..09-20: 329 transitions into `awaiting`, 178 with no dialog marker in the pane, 21 with `esc to interrupt` visible. Tracked as [BUG-0013](../../work/bugs/0013-agent-marked-waiting-while-thinking.md), fixed by [TASK-0231](../../work/tasks/TASK-0231-fix-false-awaiting-busy-guard-and-pattern-tightening.md).

**Cause.** Three compounding defects: (1) the awaiting check ran with no busy guard (the `busy`/`idle` cases in `monitor.sh`, the `state === 'awaiting'` branch in `state.ts`), so the busy footer did not veto it; (2) the `>` alternative was `>\s*$`, which matched any line merely ending in `>` (HTML comments, `❯ /research <topic…>` placeholders); (3) a typed `❯ …?` draft in Claude Code's input box counted as a prompt.

**The guard.** For non-Codex agents, the `?`/`>` heuristics are ignored, and an `awaiting` state file is reported (host-server) or reverted (monitor) as busy, while `BUSY_PATTERN` (`esc to interrupt`) is visible in the last 15 non-blank lines. Codex is exempt: its busy pattern is broad and can match scrollback while a real confirm dialog is open.

**The draft-line rule and window.** The awaiting window is the last 8 non-blank pane lines (not just the last one) after dropping Claude Code `❯ <typed draft>` input lines (`^\s*❯\s+\S`). The `>` alternative is now `^\s*>\s*$`: a line that is only `>`. This corrects the earlier "last non-blank line" description of the pattern.

**Shared fixtures.** Both detectors are pinned to one fixture set, `host-server/fixtures/awaiting-panes/manifest.json`: `host-server/state.test.ts` covers the TypeScript side (`awaitingWindow`, the branch guard) and `scripts/verify-awaiting-detection.sh` covers `monitor.sh` (`awaiting_window`, `busy_visible`). `scripts/report-false-awaiting.mjs` re-measures the false-awaiting rate from the transitions log. See [[Dispatch-Path Parity (Two Dispatchers, One Gate)]] for why two implementations need one fixture set.

relates_to::[[Dashboard Performance Benchmarking]]
relates_to::[[Local Observability]]
relates_to::[[Dispatch-Path Parity (Two Dispatchers, One Gate)]]
relates_to::[[Observability for Agent Status Transitions]]
relates_to::[[detectAgentStatus Return-Site to DetectionReason Mapping]]
relates_to::[[Testing strategy for monitor.sh's emit_transition_jsonl / transition-diff logic]]
