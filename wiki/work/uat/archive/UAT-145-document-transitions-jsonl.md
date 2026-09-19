---
id: UAT-145
aliases: [UAT-145]
title: "UAT: Document transitions.jsonl and add it to the diagnostic bundle"
status: passed
task: TASK-145
created: 2026-09-13
updated: 2026-09-13
---

# UAT-145 — UAT: Document transitions.jsonl and add it to the diagnostic bundle

implements::[[TASK-145]]

> **Source task**: [[TASK-145]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Repo checked out with TASK-145's changes to `CLAUDE.md`, `AGENTS.md`, `README.md`, and `scripts/collect-diagnostics.sh` in place
- [ ] `bash` available to run the two repeatable `scripts/verify-*.sh` checks below (no live host-server, tmux session, or network access required — both stub or bypass those)

---

## Test Cases

### UAT-EDGE-001: transitions.jsonl is documented in CLAUDE.md and AGENTS.md with the same detail as dispatch.jsonl/hooks.jsonl
- **Scenario**: per the Approach, `CLAUDE.md` and `AGENTS.md` each need a `$LOG_DIR/transitions.jsonl` row in their log-file table (mirroring the existing `dispatch.jsonl`/`hooks.jsonl` rows) plus one Key Design Decisions sentence naming ROADMAP-019 and both emitters (`host-server`'s `pollAndDiff` and `monitor.sh`'s `is_idle()` poll loop).
- **Steps**:
  1. Run the unit test command below.
  2. Inspect that both files carry a `` `$LOG_DIR/transitions.jsonl` `` table row mentioning `pollAndDiff` and the `monitor.sh` poll loop, and a design-decision sentence mentioning `ROADMAP-019`, `$LOG_DIR/transitions.jsonl`, `pollAndDiff`, and `is_idle()`.
- **Expected Result**: All four checks (2 per file) pass for both `CLAUDE.md` and `AGENTS.md`.
- **Repeatable Unit Test**: Created: `scripts/verify-transitions-jsonl-docs.sh`
- **Unit Test Command**: `bash scripts/verify-transitions-jsonl-docs.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-002: transitions.jsonl is documented in README.md's Outputs list and Observability section
- **Scenario**: `README.md`'s "Data & Migrations" bullet list and its "Observability" section (`**Dispatch log:**` / `**Hook log:**` bullets) each need a matching `logs/transitions.jsonl` entry.
- **Steps**:
  1. Run the unit test command below.
  2. Inspect that the Data & Migrations list contains a `logs/transitions.jsonl` bullet mentioning `pollAndDiff`, and the Observability section contains a `**Transition log:**` bullet naming `logs/transitions.jsonl` with its `agentId`/`stateFileAgeS` fields.
- **Expected Result**: Both checks pass.
- **Repeatable Unit Test**: Created: `scripts/verify-transitions-jsonl-docs.sh`
- **Unit Test Command**: `bash scripts/verify-transitions-jsonl-docs.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-003: collect-diagnostics.sh bundles logs/transitions.jsonl when present
- **Scenario**: `scripts/collect-diagnostics.sh`'s bundling loop (`for file in logs/observability.jsonl logs/hooks.jsonl logs/dispatch.jsonl logs/transitions.jsonl`) must copy `logs/transitions.jsonl` into the timestamped output directory byte-for-byte, the same best-effort "copy if present" pattern already used for the other three logs, without regressing `dispatch.jsonl`/`hooks.jsonl` bundling.
- **Steps**:
  1. Run the unit test command below.
  2. Inspect that a fixture `logs/transitions.jsonl` ends up copied into the generated bundle directory alongside `dispatch.jsonl`/`hooks.jsonl`.
- **Expected Result**: The script exits 0 and the bundle contains an identical copy of `transitions.jsonl`, `dispatch.jsonl`, and `hooks.jsonl`.
- **Repeatable Unit Test**: Created: `scripts/verify-collect-diagnostics-transitions-bundle.sh`
- **Unit Test Command**: `bash scripts/verify-collect-diagnostics-transitions-bundle.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-004: collect-diagnostics.sh never fails when logs/transitions.jsonl is absent
- **Scenario**: the bundling loop's `if [[ -f "$file" ]]` guard must make `logs/transitions.jsonl` optional — its absence must not raise an error under the script's `set -euo pipefail`, matching the existing best-effort semantics for the other three logs.
- **Steps**:
  1. Run the unit test command below (it runs this case after removing the fixture `logs/transitions.jsonl`).
  2. Inspect that the script still exits 0 and the resulting bundle simply has no `transitions.jsonl` file, while `dispatch.jsonl` is still present.
- **Expected Result**: Script exits 0; no `transitions.jsonl` appears in that run's bundle; other logs are unaffected.
- **Repeatable Unit Test**: Created: `scripts/verify-collect-diagnostics-transitions-bundle.sh`
- **Unit Test Command**: `bash scripts/verify-collect-diagnostics-transitions-bundle.sh`
- [x] Pass <!-- 2026-09-13 -->

---

## Gaps

None — every planned case (doc-content presence across `CLAUDE.md`/`AGENTS.md`/`README.md`, and both the present/absent bundling behavior of `scripts/collect-diagnostics.sh`) is covered by a promoted, verified-green repeatable unit test. No API, UI, or live-server behavior was introduced by this task, so no case required deferring to human/live verification.

Note on unit-test location: `uatGenerate.promoteTests` is set to the legacy value `true` (mapped to `dedicated`), but this repo's actual convention for testing standalone shell scripts under `scripts/` is co-located sibling `verify-*.sh` files (see `verify-transitions-jsonl-emit.sh`, `verify-sse-role-payload.sh`, `verify-task-pop-soft-flip.sh`) rather than a dedicated test directory — there is no Node/Python test harness for these bash scripts. Followed the repo's existing sibling layout over the stored `dedicated` preference, as TASK-143's UAT (UAT-143) already did for the same reason.
