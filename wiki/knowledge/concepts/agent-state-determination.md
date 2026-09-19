---
id: agent-state-determination
title: Agent State Determination
aliases: [Agent Status Detection, Agent State Detection]
updated: 2026-09-18
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

relates_to::[[Dashboard Performance Benchmarking]]
relates_to::[[Local Observability]]
relates_to::[[Observability for Agent Status Transitions]]
relates_to::[[detectAgentStatus Return-Site to DetectionReason Mapping]]
relates_to::[[Testing strategy for monitor.sh's emit_transition_jsonl / transition-diff logic]]
