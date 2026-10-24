---
id: state-detector-evaluation-tiers
title: Evaluating a Heuristic State Detector (Three-Tier Testing)
updated: 2026-10-17
sources:
  - ../../raw/research/agent-state-transition-evaluation/index.md
confidence: inferred
tags: [testing, agents, state, observability, methodology]
---

# Evaluating a Heuristic State Detector (Three-Tier Testing)

A heuristic, multi-signal state detector — one that decides a discrete status from regex matches, file ages, and pane text rather than from an authoritative source of truth — cannot be fully validated by unit tests alone, because its hard cases are exactly the inputs a test author wouldn't think to construct by hand. tmux-conductor's agent-status detection (`detectAgentStatus` in `host-server/state.ts`, mirrored in `scripts/monitor.sh`'s `is_idle()`) has converged on a three-tier strategy that matches named external testing techniques:

1. **Unit/branch tests (0-switch coverage).** One test per individual transition/branch, each calling the detector exactly once against a hand-built input. "0-switch coverage" in formal state-transition-testing terms is the *minimum* bar: every transition exercised at least once, with no attention to sequences. `host-server/state.test.ts`'s 18 numbered-site tests (one per `return` in `detectAgentStatus`) are this tier.
2. **Golden/characterization fixtures.** Real captured inputs (here, literal pane-text snapshots) paired with an expected output, used as a regression baseline the way Michael Feathers' "golden master" pattern captures existing legacy behavior rather than a speculative spec. The key caveat from this literature: *a golden fixture set only catches a regression if it already contains an input that triggers it* — it is not exhaustive by construction, only by accumulation. tmux-conductor's `host-server/fixtures/awaiting-panes/manifest.json`, grown case-by-case from real BUG-0013 false positives and shared between both language implementations via `scripts/verify-awaiting-detection.sh`, is this tier.
3. **Production replay + offline analysis.** Every real transition is logged (`logs/transitions.jsonl`) with enough context (from/to, reason, matched pattern, age, pane snapshot) to analyze after the fact, and a dedicated read-only script (`scripts/report-false-awaiting.mjs`) estimates a false-positive rate from that log using a secondary heuristic (dialog-marker presence).

**The missing middle: 1-switch coverage.** Formal state-transition testing names a level between 0-switch and full path coverage: testing every *consecutive pair* of transitions, because some defects only appear when "the system's history matters." Age-gated recovery logic (`busy-recovered`, `inventory-timeout`) is precisely this kind of history-sensitive branch, and it is exactly the kind of logic tier 1's single-call tests cannot exercise — a test would need to simulate two or more sequential polls with a controlled, advancing fake state-file age and assert on the resulting from→to pair.

**The limit of a self-referential false-positive proxy.** Tier 3's analysis script validates the detector's heuristic using a *second* heuristic (regex over the same pane text), not a ground-truth label. The research literature on estimating false-positive rate from unlabeled data is explicit that this kind of self-validation tends to underestimate error — the stronger alternatives are a small human-audited sample (to calibrate the proxy's own precision) or comparing two genuinely independent detection methods against each other (the Hui-Walter paradigm). tmux-conductor's existing TS/bash dual-detector setup is structurally close to the latter but isn't currently exploited that way in the reporting tool.

**Generalizable takeaway**: this three-tier shape (branch tests → golden fixtures grown from real incidents → production log + offline analysis) is a reusable pattern for *any* heuristic classifier in this codebase, not specific to agent status. The two gaps above (no sequence/1-switch tests, no human-calibrated precision estimate) are the natural next increments, not a different approach.

uses::[[Agent State Determination]]
relates_to::[[Dispatch-Path Parity (Two Dispatchers, One Gate)]]
relates_to::[[Observability for Agent Status Transitions]]
relates_to::[[detectAgentStatus Return-Site to DetectionReason Mapping]]
relates_to::[[Testing strategy for monitor.sh's emit_transition_jsonl / transition-diff logic]]
