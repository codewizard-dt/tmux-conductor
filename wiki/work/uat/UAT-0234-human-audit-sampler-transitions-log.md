---
id: UAT-0234
aliases: [UAT-0234]
title: "UAT: Add a Read-Only Human-Audit Sampler for logs/transitions.jsonl"
status: pending
task: TASK-0234
created: 2026-10-17
updated: 2026-10-17
---

# UAT-0234 — UAT: Add a Read-Only Human-Audit Sampler for logs/transitions.jsonl

implements::[[TASK-0234]]

> **Source task**: [[TASK-0234]]
> **Generated**: 2026-10-17

---

## Prerequisites

- [ ] Node.js >= 18 available on PATH (repo targets Node 22+; verified against Node v26 locally)
- [ ] Working directory is the repo root `/Users/davidtaylor/Repositories/tmux-conductor` (run commands from the repo root)
- [ ] No prerequisite data — every test below builds its own scratch JSONL under `./tmp/`; none touch the real `logs/transitions.jsonl` except to confirm it is untouched

---

## Test Cases

### UAT-CLI-001: Seeded sample drives the full interactive loop and produces matching summary + `--out` shape
- **Description**: Verifies the core interactive flow end-to-end — per-record display (ts/agent/change/reason/pane tail/heuristic verdict), the `y`/`n`/`s` prompt, the printed summary counts, and the exact per-line JSON shape written to `--out`, using `--seed 42` for a reproducible sample order.
- **Steps**:
  1. Create a scratch JSONL at `./tmp/uat-0234-manual/transitions.jsonl` with 3 `to: "awaiting"` records (one with a genuine dialog marker, one with `esc to interrupt` visible, one with neither) plus one malformed (non-JSON) line.
  2. Run: `printf 'y\nn\ns\n' | node scripts/audit-sample-transitions.mjs --n 3 --file ./tmp/uat-0234-manual/transitions.jsonl --seed 42 --out ./tmp/uat-0234-manual/out.jsonl`
  3. Observe the three per-record blocks, answer `y`, `n`, `s` in order.
- **Expected Result**: Exit code `0`. Stdout contains `Malformed lines:    1`, `Total sampled:      3`, `Skipped:            1`, `Agreement:          0/2 (0.0%)`, and `Written to:` followed by the `--out` path. `./tmp/uat-0234-manual/out.jsonl` has exactly 3 lines, each a JSON object with keys `{ts, agent, from, to, reason, sourceIndex, heuristicVerdict, humanVerdict, agreed}`; the `s`-answered record has `humanVerdict: "skipped"` and `agreed: null`.
- **Repeatable Unit Test**: Created: `host-server/auditSampleTransitions.test.ts` (test: "audit-sample-transitions: seeded sample order, verdicts, summary, and --out shape")
- **Unit Test Command**: `node --import tsx/esm --test host-server/auditSampleTransitions.test.ts`
- [x] Pass <!-- 2026-10-17 -->

### UAT-CLI-002: `--since` excludes older records
- **Description**: Verifies the `--since <ISO>` filter is applied before sampling, matching `report-false-awaiting.mjs`'s existing `--since` semantics.
- **Steps**:
  1. Using the same 3-record fixture as UAT-CLI-001, run: `printf 's\n' | node scripts/audit-sample-transitions.mjs --n 1 --file ./tmp/uat-0234-manual/transitions.jsonl --since 2026-09-20T11:30:00Z --seed 1 --out ./tmp/uat-0234-manual/out-since.jsonl`
- **Expected Result**: Exit `0`. Only the one record with `ts >= 2026-09-20T11:30:00Z` is eligible; stdout shows that record's `ts` and `Total sampled:      1`.
- **Repeatable Unit Test**: Created: `host-server/auditSampleTransitions.test.ts` (test: "audit-sample-transitions --since excludes older records")
- **Unit Test Command**: `node --import tsx/esm --test host-server/auditSampleTransitions.test.ts`
- [x] Pass <!-- 2026-10-17 -->

### UAT-EDGE-001: Fewer matching records than `--n` samples all of them and warns on stderr
- **Scenario**: `--n` exceeds the number of records matching `--to`/`--since` after filtering.
- **Steps**: Run with `--n 5` against the 3-record fixture: `printf 's\ns\ns\n' | node scripts/audit-sample-transitions.mjs --n 5 --file ./tmp/uat-0234-manual/transitions.jsonl --seed 7 --out ./tmp/uat-0234-manual/out-fewer.jsonl`
- **Expected Result**: Exit `0`. Stderr contains `Only 3 matching record(s) (< --n 5); sampling all of them.` (not stdout, so piped output stays clean). Stdout shows `Total sampled:      3`.
- **Repeatable Unit Test**: Created: `host-server/auditSampleTransitions.test.ts` (test: "audit-sample-transitions prints a stderr notice and samples all records when fewer than --n match")
- **Unit Test Command**: `node --import tsx/esm --test host-server/auditSampleTransitions.test.ts`
- [x] Pass <!-- 2026-10-17 -->

### UAT-EDGE-002: Script is strictly read-only against the source log
- **Scenario**: The source JSONL's content and mtime must be byte-for-byte unchanged after any run, proving the script only reads it and only ever writes to `--out`.
- **Steps**: Record the fixture file's content and mtime, run the script once (any flags, answering `s` to any prompts), then re-check content and mtime.
- **Expected Result**: Content and mtime are identical before and after.
- **Repeatable Unit Test**: Created: `host-server/auditSampleTransitions.test.ts` (test: "audit-sample-transitions is read-only: the input log is unchanged after a run")
- **Unit Test Command**: `node --import tsx/esm --test host-server/auditSampleTransitions.test.ts`
- [x] Pass <!-- 2026-10-17 -->

### UAT-EDGE-003: Exit codes for `--help`, a bad argument, and an unreadable file
- **Scenario**: `-h`/`--help` prints usage and exits `0`; an unrecognized flag exits `2`; a `--file` path that doesn't exist exits `1`.
- **Steps**:
  1. `node scripts/audit-sample-transitions.mjs -h` — expect exit `0` and the `Usage: node scripts/audit-sample-transitions.mjs ...` banner listing every flag.
  2. `node scripts/audit-sample-transitions.mjs --bogus` — expect exit `2`.
  3. `node scripts/audit-sample-transitions.mjs --file ./tmp/uat-0234-manual/does-not-exist.jsonl` — expect exit `1` and a `Cannot read ...` message on stderr.
- **Expected Result**: Exit codes `0`, `2`, `1` respectively, as above.
- **Repeatable Unit Test**: Created: `host-server/auditSampleTransitions.test.ts` (test: "audit-sample-transitions exit codes: 0 for --help, 2 for a bad argument, 1 for an unreadable file")
- **Unit Test Command**: `node --import tsx/esm --test host-server/auditSampleTransitions.test.ts`
- [x] Pass <!-- 2026-10-17 -->

### UAT-MANUAL-001: Human-at-the-keyboard walkthrough against the real transitions log
- **Description**: This script is explicitly interactive/manual by design (TASK-0234's Approach section) — it exists to get a *human's* yes/no judgment on real `awaiting` transitions, not to be driven by canned input. This case verifies the output is legible and useful to an actual person sampling real data, which the automated cases above cannot verify (they assert on exact strings from a synthetic fixture, not on readability).
- **Steps**:
  1. At a real terminal, from the repo root, run: `node scripts/audit-sample-transitions.mjs --n 5` (reads the real `logs/transitions.jsonl` if it has `awaiting` transitions; otherwise point `--file` at a copy).
  2. For each sampled record, read the printed block (ts/agent/change/reason/pane tail/heuristic verdict) and answer the `[y/n/s=skip]:` prompt based on genuine judgment of whether the pane tail really shows a waiting dialog.
  3. Review the final summary and open the written `--out` file.
- **Expected Result**: Each printed block is readable and sufficient to make a judgment without consulting other tooling; the summary's agreement rate and the `--out` JSONL are both coherent with the human's own answers. Requires a human at the keyboard to judge — not auto-judgeable.
- **Repeatable Unit Test**: Not applicable: the thing under test is human legibility/judgment of live terminal output against real unlabeled data, not a deterministic assertion
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-10-17 -->

---

## Gaps

- None. All four flags (`--file`, `--since`, `--to`, `--n`, `--seed`, `--out`, `-h`/`--help`) and all documented exit codes/behaviors were directly confirmed against the real script's output before writing these tests (dry runs in `./tmp/`, cleaned up afterward); nothing was dropped for lack of research. `--to` itself (changing the sampled state away from the default `awaiting`) was not given its own case since it is a one-line equality filter identical in mechanism to the already-covered `--since`/`--n` filtering — judged low-value to duplicate.
