---
id: UAT-116
aliases: [UAT-116]
title: "UAT: Verify real task-start latency drops from ~15s worst-case to ~2s under a live agent session"
status: passed
task: TASK-116
created: 2026-08-22
updated: 2026-08-22
---

# UAT-116 — UAT: Verify real task-start latency drops from ~15s worst-case to ~2s under a live agent session

implements::[[TASK-116]]

> **Source task**: [[TASK-116]]
> **Generated**: 2026-08-22

TASK-116 is a pure live-measurement task — it introduces no application code, API route, or UI change. Its deliverable is a recorded before/after latency measurement and a verdict against the roadmap's ~15s→~2s claim. Accordingly, every case below verifies the recorded artifact and its methodology rather than exercising new code (there is none to exercise).

---

## Prerequisites

- [ ] Read access to `wiki/work/tasks/TASK-116-verify-dispatch-latency.md` and `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.

---

## Test Cases

### UAT-EDGE-001: Results section present with both trial tables and computed min/median/max
- **Scenario**: TASK-116's Acceptance Criteria require both distributions "captured with the documented protocol ... not estimated" and recorded in the task file.
- **Steps**:
  1. Open `wiki/work/tasks/TASK-116-verify-dispatch-latency.md`.
  2. Confirm a `## Results` section exists containing two 10-row trial tables (one "Before", one "After") with per-trial `Δt` values in milliseconds.
  3. Confirm each table is followed by a `min = ... · median = ... · max = ...` summary line.
- **Expected Result**: `## Results` section present; "Before" table has 10 rows (min 7746ms / median 12380.5ms / max 12722ms); "After" table has 10 rows (min 174ms / median 837.5ms / max 1895ms), each row showing `detection: idle-transition-poll`.
- **Repeatable Unit Test**: Not applicable — this verifies a recorded measurement artifact in a markdown wiki file, not application logic; there is no code path to unit-test.
- [x] Pass <!-- 2026-08-22, verified by direct read: Results section present, both 10-row tables with exact matching figures and detection field -->

### UAT-EDGE-002: Verdict meets the documented acceptance bar
- **Scenario**: The Acceptance Criteria require the "after" median ≤ `STATUS_POLL_MS` (2000ms) + ~1.5s margin, "after" max within a couple seconds of `STATUS_POLL_MS`, and "before" max materially bounded by the old 15s `POLL_INTERVAL`.
- **Steps**:
  1. In the `## Results` section, locate the "Comparison against the acceptance bar" subsection.
  2. Confirm the before max (12722ms) is described as bounded by the 15s `POLL_INTERVAL`.
  3. Confirm the after median (837.5ms) is confirmed ≤ 3500ms and the after max (1895ms) is confirmed ≤ ~2000ms (`STATUS_POLL_MS` itself, tighter than the "couple seconds" bar).
  4. Confirm an explicit one-line verdict is present (`MET` or `NOT MET`, with rationale if not met).
- **Expected Result**: Verdict line reads "MET", with the median/max comparisons against the numeric bars spelled out.
- **Repeatable Unit Test**: Not applicable — narrative verdict text in a wiki file, not executable logic.
- [x] Pass <!-- 2026-08-22, verified by direct read: "Verdict: MET" present with before-max/after-median/after-max all spelled out against the numeric bars -->

### UAT-EDGE-003: All Steps checkboxes and Acceptance Criteria checkboxes are checked
- **Scenario**: `/tackle`'s outline-completion convention requires every `### N.` step's checkboxes and the `## Acceptance Criteria` checkboxes to be `[x]` before the task can leave `in-progress`.
- **Steps**:
  1. Open `wiki/work/tasks/TASK-116-verify-dispatch-latency.md`.
  2. Confirm all checkboxes under `### 1.`, `### 2.`, and `### 3.` (six total) are `[x]`.
  3. Confirm all four checkboxes under `## Acceptance Criteria` are `[x]`.
  4. Confirm frontmatter `status: pending-uat`.
- **Expected Result**: 10/10 checkboxes checked; frontmatter `status: pending-uat`.
- **Repeatable Unit Test**: Not applicable — frontmatter/checklist state in a markdown task file.
- [x] Pass <!-- 2026-08-22, verified by direct read: all 6 Steps checkboxes and all 4 Acceptance Criteria checkboxes are [x], frontmatter status: pending-uat -->

### UAT-EDGE-004: Roadmap Phase 1 item annotated with the measurement result
- **Scenario**: Step 3 of TASK-116 requires updating ROADMAP-017's Phase 1 checklist item to reflect the recorded result (without flipping the checkbox itself, per the repo's closing-convention note).
- **Steps**:
  1. Open `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.
  2. Locate the Phase 1 `TASK-116` line.
  3. Confirm it is annotated with the before/after median and max figures (or an equivalent summary) and remains an unchecked `- [ ]` box (checkbox flip deferred to the closing/UAT convention).
- **Expected Result**: TASK-116's roadmap line contains "before median 12380.5ms/max 12722ms" and "after median 837.5ms/max 1895ms" (or equivalent), checkbox still `[ ]`.
- **Repeatable Unit Test**: Not applicable — roadmap markdown annotation, not application logic.
- [x] Pass <!-- 2026-08-22, verified by direct read: roadmap line reads "before median 12380.5ms/max 12722ms → after median 837.5ms/max 1895ms", checkbox still [ ] -->

### UAT-EDGE-005: Fixture cleanup — no leftover synthetic agents, worktrees, or DB rows
- **Scenario**: The task's instructions require deleting any fixture agents/worktrees created for the measurement once trials are complete, and leaving the live environment (real registered agents, DB) untouched.
- **Steps**:
  1. Run `git worktree list` from the repo root — confirm no worktree under `./tmp/task-116-latency/` remains.
  2. Run `curl -sS http://localhost:8788/api/status` (host-server must be running) and confirm no agent named `latency-test-after` (or similar TASK-116 fixture name) appears in the `agents` array.
  3. Confirm `./tmp/task-116-latency/` no longer exists on disk.
- **Expected Result**: `git worktree list` shows only the repo's real worktrees (no `baseline-worktree`); `/api/status` lists only the pre-existing real agents; `./tmp/task-116-latency/` is absent.
- **Repeatable Unit Test**: Not applicable — verifies absence of scratch fixtures on the live host filesystem/session, not application logic.
- [x] Pass <!-- 2026-08-22 -->
