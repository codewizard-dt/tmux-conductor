---
id: TASK-145
aliases: [TASK-145]
title: "Document transitions.jsonl and add it to the diagnostic bundle"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: [TASK-143, TASK-144]
blocks: []
parallel_safe_with: []
uat: "[[UAT-145]]"
tags: [docs, observability, roadmap-019]
---

# TASK-145 — Document transitions.jsonl and add it to the diagnostic bundle

depends_on::[[TASK-143]]
depends_on::[[TASK-144]]

## Objective

`logs/transitions.jsonl` (added by TASK-143 and TASK-144) needs to be documented alongside the repo's two existing log tables (`dispatch.jsonl`, `hooks.jsonl`) and included in the existing local diagnostics bundle, matching the documentation convention every other log in this repo already follows.

## Approach

Mirror the exact existing documentation pattern for `dispatch.jsonl`/`hooks.jsonl` — a row in each doc's log-file table with the same column style, plus one line in the "Key Design Decisions" prose block. Add the new file to `scripts/collect-diagnostics.sh`'s bundled-files list, matching its existing `dispatch.jsonl`/`hooks.jsonl`/`observability.jsonl` handling exactly (same best-effort "copy if present" pattern).

## Steps

### 1. Update the three doc files <!-- agent: general-purpose -->

- [x] `CLAUDE.md`: add a `logs/transitions.jsonl` row to the log-file table (mirroring the existing `$LOG_DIR/dispatch.jsonl` / `$CONDUCTOR_LOG_DIR/hooks.jsonl` rows), and one sentence in the "Key Design Decisions" bullet list describing the new stream's fields (`ts, agent, from, to, reason, matchedPattern, stateFileAgeS, paneTail`) and that it's emitted from both `host-server`'s `pollAndDiff` (TASK-143) and `monitor.sh`'s `is_idle()` poll loop (TASK-144).
- [x] `AGENTS.md`: same table row + design-decision sentence (this file currently duplicates `CLAUDE.md`'s log-table content — keep both in sync).
- [x] `README.md`: add `logs/transitions.jsonl` to its existing "Outputs"/log-file bullet list (see the existing `logs/dispatch.jsonl — append-only dispatch audit log` / `logs/hooks.jsonl — append-only hook transition log` lines) with a matching one-line description.

### 2. Add to the diagnostics bundle <!-- agent: general-purpose -->

- [x] `scripts/collect-diagnostics.sh`: add `logs/transitions.jsonl` to the existing `for file in logs/observability.jsonl logs/hooks.jsonl logs/dispatch.jsonl; do ... done` loop (or equivalent list) so it's captured in the timestamped diagnostic bundle the same way the other three logs already are.

### 3. Verify <!-- agent: general-purpose -->

- [x] `mcp__serena__search_for_pattern` for `transitions.jsonl` across `CLAUDE.md`, `AGENTS.md`, `README.md`, and `scripts/collect-diagnostics.sh` confirms all four were updated.
- [x] Re-read each edited section to confirm the new row/line matches the existing table/list formatting exactly (column order, wording style).

## Acceptance Criteria

- [x] `transitions.jsonl` is documented in `CLAUDE.md`, `AGENTS.md`, and `README.md` with the same level of detail as `dispatch.jsonl`/`hooks.jsonl`.
- [x] `scripts/collect-diagnostics.sh` bundles `logs/transitions.jsonl` when present, without failing when it's absent (matches the existing best-effort pattern for the other three logs).

## Verification

- [x] `mcp__serena__search_for_pattern` confirms all four files were touched (documented above)

<!-- Updated: 2026-09-13 (all steps complete) -->

### Roadmap

Implements [[ROADMAP-019]] Phase 3 (final phase) — `wiki/work/roadmaps/ROADMAP-019-agent-status-transition-observability.md`. Grounded in `raw/research/transition-observability/index.md` (Implementation outline step 6).
