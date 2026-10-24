---
id: agent-state-transition-evaluation
title: How to Evaluate Agent State Transitions
updated: 2026-10-17
sources:
  - ../../raw/research/agent-state-transition-evaluation/index.md
confidence: inferred
tags: [agents, state, testing, observability]
---

# How to Evaluate Agent State Transitions

tmux-conductor already runs a **three-tier evaluation strategy** for its from/to agent-status heuristics, built incrementally across BUG-0013/TASK-0231 and the earlier transition-observability work: (1) unit/branch tests in `host-server/state.test.ts`, one per numbered `return` site of `detectAgentStatus` (18 sites); (2) a golden pane-snapshot fixture corpus (`host-server/fixtures/awaiting-panes/manifest.json`) shared between the TypeScript detector and `monitor.sh`'s bash detector via `scripts/verify-awaiting-detection.sh`'s structural extraction; and (3) a production `logs/transitions.jsonl` stream with an offline false-positive reporter (`scripts/report-false-awaiting.mjs`). This maps directly onto recognized external testing techniques: **0-switch coverage** (every individual transition exercised once — tiers 1 and 2), **golden-master/characterization testing** (Michael Feathers' term for capturing real/observed behavior as the regression baseline — tier 2), and **production-traffic replay** (tier 3).

**Where the mapping exposes a gap.** State-transition-testing literature distinguishes 0-switch coverage from **1-switch coverage** — testing every *consecutive pair* of transitions, specifically because it "catches defects where the system's history matters." tmux-conductor's age-dependent recovery branches (`busy-recovered`, `inventory-timeout`) are exactly this kind of history-sensitive logic, yet every existing test calls the detector exactly once per case with a pre-set fake age — there is no test that simulates two sequential polls and asserts on the resulting pair. Separately, the golden-fixture tier (tier 2) only exists for the `awaiting` classification; `busy`/`idle`/`stalled`/`exited` have no equivalent curated corpus, so a regression there has no fixture-level safety net analogous to what BUG-0013 built for `awaiting`.

**Where the production tier is weaker than it looks.** `report-false-awaiting.mjs`'s false-positive proxy (absence of a dialog-marker regex in the pane snapshot) is a second heuristic layered on the first, not a ground-truth label. Literature on estimating false-positive rate from unlabeled production data warns specifically that "using the model to directly clean its own validation data leads to underestimates even if total error is low" — the more defensible alternatives are a small human-audited sample, or comparing against an independent second method (the Hui-Walter paradigm). tmux-conductor's dual TS/bash detectors are structurally close to a second independent method already, but the reporter doesn't currently cross-check the two detectors' live verdicts against each other — only against its own text heuristic.

uses::[[Agent State Determination]]
relates_to::[[Dispatch-Path Parity (Two Dispatchers, One Gate)]]
relates_to::[[Observability for Agent Status Transitions]]
