---
topic: "Best strategy for a repeatable unit test covering scripts/monitor.sh's emit_transition_jsonl() and the poll loop's transition-diff logic (TASK-144), given monitor.sh cannot be sourced in isolation"
slug: monitor-sh-transition-emit-testability
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Testing strategy for monitor.sh's emit_transition_jsonl / transition-diff logic

> Extract only `emit_transition_jsonl` and `pane_tail_json` via structural (function-boundary) text extraction into a throwaway harness with a stubbed `tmux`, and unit-test the JSON shape/null-handling there. Do not attempt to exercise the poll loop's live diff-skip-first-tick behavior end-to-end (that requires a real tmux session and real `POLL_INTERVAL`-scale sleeps, which the project's own promotability bar excludes) — cover the diff-skip guard by evaluating its literal extracted conditional against constructed `PREV_TRANSITION_STATE` states instead. Do not add a testability seam to monitor.sh itself; there is no repo precedent for that and it would touch production code outside TASK-144's diff.

## Research Questions
- Can `scripts/monitor.sh` be `source`d for isolated function testing?
- Does this repo have precedent for testing a script that has top-level side effects / an infinite loop?
- Is a testability seam (env-guarded early return) in monitor.sh an acceptable minimal change?
- What's the lowest-risk way to get a deterministic, fast, repeatable test for `emit_transition_jsonl`'s JSON shape and the first-tick-suppression / diff-detection logic?

## Current State (Codebase)
- `scripts/monitor.sh` sources `conductor.conf` unconditionally at top level (`scripts/monitor.sh:11`), which hardcodes `LOG_DIR="./logs"`, `STATE_DIR="./logs/state"`, `POLL_INTERVAL=15` with plain `VAR=value` assignments (not `: "${VAR:=default}"`), so pre-exporting overrides before sourcing monitor.sh does not survive — unlike `CONDUCTOR_DB`, which `scripts/lib/db.sh` resolves conditionally and so *can* be overridden (this is what `scripts/verify-task-pop-soft-flip.sh` and `scripts/verify-teardown-window-mapping.sh` rely on).
- `scripts/monitor.sh` also calls `load_agents`/`load_bg` at top level (lines 51-52, require a working `CONDUCTOR_DB`) and ends in an unconditional `while true; do ... done` poll loop (from ~line 442) with no env-guarded early return. There is no `[[ "${BASH_SOURCE[0]}" == "$0" ]]`-style guard anywhere in `scripts/*.sh` (confirmed via `search_for_pattern` — zero matches for that idiom or any `TEST_MODE`/sourced-guard pattern).
- `emit_transition_jsonl` (`scripts/monitor.sh:400-431`) and `pane_tail_json` (`scripts/monitor.sh:337-346`) are standalone functions with no shared mutable state beyond globals (`LAST_STATE_AGE`, `TRANSITION_LOG`) that a caller sets/reads directly — they are otherwise pure given their arguments plus those globals, and their only external dependency is `tmux capture-pane` (inside `pane_tail_json`) and `python3` (present on the dev machine, already relied on elsewhere in the file, e.g. `emit_dispatch_jsonl`).
- The per-tick diff-skip guard (`scripts/monitor.sh:502`, `if [ -n "${PREV_TRANSITION_STATE[$name]+set}" ] && [ "${PREV_TRANSITION_STATE[$name]}" != "$LAST_STATE_VALUE" ]; then`) is inline in the main loop, not a standalone function — it can only be tested by literal-extracting that one conditional line, not by calling something.
- Repo precedent for testing scripts with real side effects: `scripts/verify-teardown-window-mapping.sh` runs the **real** `teardown.sh` as a subprocess against a scratch tmux session (`tmux new-session -d ...`) and a scratch `CONDUCTOR_DB`, then asserts on its log output and on real tmux/DB state afterward — it does not stub `tmux`, and it does not extract functions. This works for `teardown.sh` because that script runs to completion (no infinite loop) and its two integration points (`CONDUCTOR_DB`, `CONDUCTOR_SESSION_NAME`) are both externally overridable.
- `monitor.sh` differs in two ways that break that same pattern: (1) it never exits (background+kill would work, but then the test also inherits `POLL_INTERVAL=15` real-time sleeps between ticks, since that value can't be overridden per above), and (2) it would write into the **real** `./logs/transitions.jsonl` and `./logs/state/` (not a scratch path), since `LOG_DIR`/`STATE_DIR` are hardcoded unconditional assignments sourced from the real `conductor.conf`.

## Key Findings
- Running the real `monitor.sh` end-to-end (background it, wait ~2×15s for two ticks, inspect `logs/transitions.jsonl`, kill it) is possible but requires a **live tmux session** and **real wall-clock sleeps at `POLL_INTERVAL` scale**, and pollutes the real `./logs` tree — this squarely matches the uat-generate skill's own unit-test exclusion list ("without a live server, real browser session, external API, database, network, secrets, wall-clock sleeps, or filesystem state that is hard to isolate"). [S1]
- `emit_transition_jsonl` and `pane_tail_json`, in contrast, take explicit arguments, touch only a stubbable `tmux` call and a `python3 -c` heredoc, and write to a `TRANSITION_LOG` path that is just a bash variable read at call time (not re-derived) — so it *is* overridable after extraction, unlike sourcing the whole file. [S2]
- No repo precedent exists for a `BASH_SOURCE`-guarded testability seam in any `scripts/*.sh` file; the two existing "test a live script" precedents (`verify-task-pop-soft-flip.sh`, `verify-teardown-window-mapping.sh`) both work by testing a *library* file (`lib/db.sh`, which has no top-level side effects) or by running a *terminating* script end-to-end against scratch infra — neither pattern needed a seam, because neither target script has monitor.sh's "infinite loop + hardcoded real paths" combination. [S3]

## Constraints
- Must not require a live tmux session, a live DB, or `POLL_INTERVAL`-scale sleeps (violates the project's own unit-test-promotability bar).
- Must not modify `scripts/monitor.sh` itself for testability — TASK-144's diff is already closed out (status `pending-uat`); adding a seam would be an unreviewed, out-of-scope production change made from the UAT-generation pass.
- Must not introduce a new test framework (bats/shunit2) — none exists in this repo, and the local convention is plain, self-contained `scripts/verify-*.sh` files.
- Must produce a genuinely repeatable, fast, deterministic result — not merely a manual walkthrough restated as a script.

## Solution Comparison

| Criteria | (1) Structural function extraction + stubbed `tmux` | (2) Testability seam in monitor.sh | (3) Run real monitor.sh against scratch tmux+DB, backgrounded | (4) Mark Blocked, no test file |
|---|---|---|---|---|
| **Approach** | `awk`/`sed`-style boundary extraction of `emit_transition_jsonl`/`pane_tail_json` bodies into a throwaway harness; stub `tmux`; override `TRANSITION_LOG` after sourcing | Add an env-guarded early return before `load_agents`/the main loop | Real subprocess, scratch `CONDUCTOR_DB` + scratch tmux session, background + kill, real `POLL_INTERVAL` sleeps | Analysis only |
| **Pros** | No live tmux/DB/sleep; deterministic; matches promotability bar; no production-code change | Would let the whole file be sourced cleanly for any future test | Tests the real integration path exactly as shipped | Zero risk of divergence/staleness |
| **Cons** | Coupled to function-name/brace-boundary text shape (drifts if functions are heavily restructured); doesn't cover the inline poll-loop diff logic directly (needs a second, separate literal-line check) | Out of scope for a UAT-generation pass; touches code the task already closed; no repo precedent | Live tmux session + ~30s real sleep; writes into the real `./logs` tree (LOG_DIR/STATE_DIR are hardcoded, not overridable); exactly the exclusion list the promotability bar names | Repeatable coverage for the deterministic JSON-shape logic is lost |
| **Complexity** | Low | Low (seam itself) but high in scope-risk | Medium | None |
| **New infra** | None | A convention no other script uses | None (reuses scratch-DB pattern from precedent) | None |
| **Codebase fit** | Matches `emit_dispatch_jsonl`'s already-established sibling-function shape; consistent with how `verify-task-pop-soft-flip.sh` sources isolated logic | Poor — no precedent, and modifies a task-closed file | Matches `verify-teardown-window-mapping.sh`'s subprocess pattern, but that precedent's target script terminates and has overridable paths; monitor.sh has neither | N/A |
| **Maintenance** | Low; re-verify boundary extraction still matches if monitor.sh is heavily refactored | Ongoing seam to maintain | Flaky-prone over time (timing, real tmux) | N/A |

## Recommendation

**Adopt (1): structural extraction + a stubbed `tmux`, as `scripts/verify-transitions-jsonl-emit.sh`.**

Implementation outline:
1. Use a function-boundary extraction (function-name line → matching top-level `}`) to pull the *live* text of `emit_transition_jsonl` and `pane_tail_json` out of `scripts/monitor.sh` at test-run time (not copy-pasted/duplicated logic — always re-extracted from the current file, so the test can't silently drift from the real implementation).
2. Define a stub `tmux` shell function in the harness (no real tmux dependency) that returns fixed `capture-pane` output, so `pane_tail_json` is deterministic.
3. `source` the extracted function text, set `TRANSITION_LOG` to a scratch path under `./tmp/`, set `LAST_STATE_AGE` per case, and call `emit_transition_jsonl <agent> <from> <to> <target>` for: (a) a normal transition with a non-empty `from`/age, (b) an empty `from` (first observed value) asserting JSON `null`, (c) an empty `stateFileAgeS` asserting JSON `null`.
4. Parse each resulting line with `python3 -c 'json.loads(...)'` and assert on `ts` format, `agent`, `from`, `to`, `reason`, `stateFileAgeS`, `paneTail` (list of strings).
5. Separately, `grep`-extract the literal diff-guard line (`scripts/monitor.sh:502`) and `eval` it against constructed `PREV_TRANSITION_STATE` array states (unset key → no emit; key set to same value → no emit; key set to a different value, including empty-string `LAST_STATE_VALUE` → emit) to cover the first-tick-suppression logic without needing the full loop or a live pane.
6. Do **not** attempt to drive the real poll loop end-to-end — the task file itself already defers "Manually run monitor.sh against a live tmux session... confirm a new line appears" to UAT (Step 3, `[DEFERRED-TO-UAT]`), which is the correct split: the deterministic JSON/logic pieces are unit-testable now; the live wiring is Manual/UAT.

Risks and mitigations:
- **Boundary-extraction fragility**: if a future edit reshapes `emit_transition_jsonl`'s signature, the extraction still finds the function by name and grabs whatever body exists — it will just test the new body, which is the desired behavior (no false staleness). If the function is renamed or removed, the harness fails loudly (extraction yields empty text), which is an acceptable, visible failure mode.
- **Diff-guard line drifting from the extracted text** (e.g. reformatted spacing breaking the grep pattern): keep the grep pattern anchored on the stable substrogram `PREV_TRANSITION_STATE[$name]+set` rather than exact whitespace.

**Alternative if constraints change**: if this repo later adopts `bats-core` (or similar) for bash testing, the same two behaviors should move into that framework's fixtures instead of ad hoc extraction — but that is out of scope until such a framework exists.

## Next Steps
- Implement `scripts/verify-transitions-jsonl-emit.sh` per the outline above as part of `/uat-generate`'s unit-test promotion for UAT-144.
- No `/task-add` or `/decision-create` needed — this is an implementation detail of the current UAT generation, not a new backlog item.
