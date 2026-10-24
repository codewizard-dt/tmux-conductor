---
topic: "how to evaluate agent state transitions (to status, from status, snapshot at time of transition)"
slug: agent-state-transition-evaluation
researched: 2026-10-17
---

# Primary Sources — How to Evaluate Agent State Transitions

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| C1 | codebase | `host-server/state.ts::detectAgentStatus` (lines 9-12, 405-524) | 2026-10-17 | Full 18-return-site TS detector body and the `DetectionReason` union it reports |
| C2 | codebase | `host-server/index.ts::pollAndDiff` (lines 2836-2965), `appendTransitionLog` (503-514), `lastDetectionByAgentId` (2719) | 2026-10-17 | How the host-server detects a from→to change and emits the unified `transitions.jsonl` record |
| C3 | codebase | `host-server/fixtures/awaiting-panes/manifest.json` | 2026-10-17 | Shape and content of the shared golden-fixture corpus (14 cases: launch type, state-file value/age, pane capture file, expected `{state, reason}`) |
| C4 | codebase | `host-server/state.test.ts` (symbol overview — one test per numbered return site 1-18, plus `awaiting-pane fixtures (TASK-0231)` describe block) | 2026-10-17 | Confirms the unit-test tier is one-call-per-test (0-switch coverage) against both synthetic and golden-fixture inputs |
| C5 | codebase | `scripts/monitor.sh` lines 495-543 (`emit_dispatch_jsonl`, `emit_transition_jsonl`), `scripts/verify-awaiting-detection.sh` header comment | 2026-10-17 | Bash-side transition emission and the structural-extraction test harness that checks it against the same fixture manifest as the TS side |
| C6 | codebase | `scripts/report-false-awaiting.mjs` (full file) | 2026-10-17 | The project's current production false-positive proxy: dialog-marker regex absent ⇒ flagged; documents its own pre-fix baseline (329 awaiting transitions, 54% no-dialog-marker, 6% busy-spinner-visible) |
| C7 | codebase | `raw/research/transition-observability/index.md` | 2026-10-17 | Prior research that designed `transitions.jsonl` itself (now implemented) — read to avoid re-deriving; cites AgentTrace-style span logging and general audit-log guidance |
| C8 | codebase | `raw/research/monitor-sh-transition-emit-testability/index.md` | 2026-10-17 | Prior research establishing the "no live tmux/DB/sleeps, structural extraction instead" constraint that any new bash-side test must respect |
| C9 | codebase | `wiki/knowledge/concepts/dispatch-path-parity.md`, `wiki/knowledge/concepts/agent-state-determination.md`, `wiki/log.md` (TASK-0231/BUG-0013 entries) | 2026-10-17 | Confirms "two implementations, one fixture set" is a named, recurring project convention, and the historical loop from a found false-positive bug to a permanent fixture addition |
| S1 | web | https://arxiv.org/pdf/2401.09376 | 2026-10-17 | Bayesian Hui-Walter-paradigm approach to estimating FPR/FNR from unlabeled production data by comparing independent classifiers rather than requiring ground truth |
| S2 | web | https://arxiv.org/pdf/1702.00518 | 2026-10-17 | True FPR cannot be estimated directly without negative samples, but can be recovered from positive-unlabeled data given a known class prior |
| S3 | web | https://arxiv.org/pdf/2308.02695 | 2026-10-17 | Warns that using a model to self-label its own validation data (i.e. validating a heuristic with a correlate of itself) underestimates error even when total error looks low |
| S4 | web | https://yrkan.com/course/module-03-test-design/state-transition-testing/ ; https://www.tmap.net/node/645 | 2026-10-17 | Definitions of 0-switch coverage (every transition once) vs. 1-switch coverage (every consecutive transition pair), and that 1-switch "catches defects where the system's history matters" |
| S5 | web | https://claudskills.com/skills/golden-master/SKILL.md ; https://www.sitepoint.com/golden-master-testing-refactor-complicated-views/ | 2026-10-17 | Golden master / characterization testing definition (Michael Feathers), the caveat that golden fixtures only catch regressions the fixture set already exercises, and recommended practice of capturing real/observed behavior rather than speculative cases |
| S6 | web | https://speedscale.com/blog/traffic-replay-production-traffic-replication | 2026-10-17 | Production traffic capture-and-replay rationale: finds bugs a controlled test environment wouldn't surface, used here as the external analogue to `transitions.jsonl` + `report-false-awaiting.mjs`'s field-evaluation tier |

## Excerpts

### S3 — FPR Estimation for Fraud Detection in the Presence of Class-Conditional Label Noise
https://arxiv.org/pdf/2308.02695
> using the model to directly clean its own validation data leads to underestimates even if total error is low

### S4 — State Transition Testing (yrkan.com / tmap.net)
https://yrkan.com/course/module-03-test-design/state-transition-testing/
> 0-switch coverage: Test every valid transition at least once. Minimum coverage.
> 1-switch coverage: Test every pair of consecutive transitions. Catches defects where the system's history matters.

### S5 — Golden Master Testing skill definition
https://claudskills.com/skills/golden-master/SKILL.md
> A golden master records what existing code currently outputs across many inputs, so any later change in that output makes the test fail... most useful for legacy code where the intended behavior is unknown... golden fixtures won't catch a regression if they don't contain the values that trigger it.
