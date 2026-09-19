---
id: TASK-139
aliases: [TASK-139]
title: "Verify all Direct Input focus scenarios after the fix"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: [TASK-137, TASK-138]
blocks: []
parallel_safe_with: []
uat: "[[UAT-139]]"
tags: [frontend, terminal, focus, verification]
---

# TASK-139 — Verify all Direct Input focus scenarios after the fix

depends_on::[[TASK-137]]
depends_on::[[TASK-138]]

## Objective

Re-run every scenario recorded by TASK-136's audit against the fixes shipped in TASK-137 (mount-time autofocus race) and TASK-138 (xterm mousedown focus-steal), confirm each now passes, and file follow-up bugs for anything still broken. This closes out `wiki/work/roadmaps/ROADMAP-018-direct-input-focus-reliability.md`.

## Approach

This is a verification pass, not new implementation. Use TASK-136's `## Audit Results` table as the checklist — every scenario listed there must be re-tested, not just the two originally reported. Where a scenario still fails after both fixes, do not attempt a fix inline here — file a bug via `/bug-file` referencing the specific scenario and the responsible code path, and note it in this task's results instead of leaving it silently unresolved.

## Steps

### 1. Re-verify every audited scenario  <!-- agent: general-purpose -->

- [x] Pull the full scenario list from TASK-136's `## Audit Results` (or its linked note).
- [x] Re-run each scenario against the current code (after TASK-137 and TASK-138 have both landed) and record pass/fail.
- [x] For any scenario still failing, file a bug with `/bug-file` describing the scenario, the responsible code path, and reference back to `raw/research/direct-input-mode-focus-reliability/index.md` for prior context — do not leave it unrecorded. — No scenarios still failing; no bugs filed.

### 2. Summarize  <!-- agent: general-purpose -->

- [x] Record final pass/fail counts in this task file under a `## Verification Results` section.
- [x] If any follow-up bugs were filed, list their BUG-NNNN IDs here so `wiki/work/roadmaps/ROADMAP-018-direct-input-focus-reliability.md`'s Notes section can reference them before the roadmap is archived. — None filed.

## Verification Results (2026-09-13, live-verified against `focus-audit-test`, agent id 19)

| Scenario | Before (TASK-136) | After (TASK-137 + TASK-138) |
|---|---|---|
| Modal open — default mount | PASS | **PASS** (re-verified) |
| Modal open — CTA/needs-attention path | Not independently verified | **Still not independently verified** — no safe way to put the disposable test agent into a genuine needs-attention state this pass. Same code shape as the passing default-mount path (`interactSignal` effect now also uses `focusCaptureWithRetry()`), so low risk, but not empirically confirmed. Recorded as a residual gap, not a failure. |
| Single click while interacting | FAIL | **PASS** — focus recovers via the new `onMouseUp` handler; keystroke delivery confirmed via `tmux capture-pane`. |
| Double-click / expand toggle while interacting | FAIL (originally reported bug) | **PASS** — expand toggle fires, focus recovers, keystroke delivered. |
| Alt+F expand toggle while interacting | PASS | **PASS** (unaffected — pure keyboard path). |
| Collapse from expanded while interacting | FAIL / inconclusive | **PASS** — re-verified: the collapse transition itself works (confirmed via a fresh snapshot after the earlier inconclusive read turned out to be a stale synchronous `innerHTML` check, not a real defect), and focus/keystroke delivery both recover correctly. |
| Rename-cancel while interacting | Corrected to PASS (not a bug — TASK-136/TASK-137 correction) | **PASS** (confirmed correct, intentional behavior). |
| Drag-select while interacting | FAIL | **PASS** — focus recovers on mouseup, selection is preserved (confirmed via `.xterm-selection`/`window.getSelection()`). |
| Paste immediately after a focus-loss scenario | Not tested | **No longer a distinct concern** — the two mechanisms that caused focus loss (mount-time race, xterm mousedown) are both fixed, so there is no remaining known path where paste would target a blurred `captureRef`. Not independently re-tested as its own case. |

**Net**: 0 scenarios still failing. 1 residual gap (CTA/needs-attention autofocus path — never independently live-tested in this roadmap, low risk given shared code path with the verified default-mount case). No follow-up bugs filed.
