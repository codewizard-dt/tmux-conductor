---
id: agent-state-determination
title: Agent State Determination
aliases: [Agent Status Detection, Agent State Detection]
updated: 2026-07-04
sources:
  - ../../raw/research/application-latency-structure/index.md
  - ../../raw/research/application-latency-structure/index-2.md
tags: [agents, state, status, performance]
---

# Agent State Determination

Agent state determination combines several evidence sources: hook-written state files, tmux window inventory, pane-current-command liveness, plain `capture-pane` regex fallback, POSIX grep pattern checks, active-task inference, labels, mode detection, and context metadata. This gives robust fallback behavior across Claude, Codex, and custom agents, but it also spreads status semantics across backend detection and frontend display derivation.

The latency research recommends moving toward one backend-owned status contract. The host-server now keeps the legacy top-level `state` field for compatibility, and also emits a `status` object for each agent. That object contains `state`, backend-selected `display` (`empty` and `idle-waiting` included), `reason`, `needsAttention`, `activeTask`, and evidence fields for tmux window presence, pane-current-command, state-file value/age, and whether the active task is intentionally retained.

The dashboard should treat `status` as the authoritative contract and avoid re-implementing hook-state, regex, liveness, or active-task rules in React. `state` remains a compatibility alias for older call sites until the dashboard migration is complete.

Observability for this concept should record status transitions with previous/current status, detection reason, state-file age, agent profile (`claude`, `codex`, `custom`), whether a pane capture was needed, and detection duration. This makes dashboard state regressions diagnosable rather than relying on visual reports.

relates_to::[[Dashboard Performance Benchmarking]]
relates_to::[[Local Observability]]
