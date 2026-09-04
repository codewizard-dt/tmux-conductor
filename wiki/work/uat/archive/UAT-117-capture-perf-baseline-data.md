---
id: UAT-117
aliases: [UAT-117]
title: "UAT: Capture a representative period of real liveUpdateMetrics data from /api/perf/live-updates"
status: passed
task: TASK-117
created: 2026-09-02
updated: 2026-09-02
---

# UAT-117 — UAT: Capture a representative period of real liveUpdateMetrics data from /api/perf/live-updates

implements::[[TASK-117]]

> **Source task**: [[TASK-117]]
> **Generated**: 2026-09-02

> **Scope note**: TASK-117 doesn't ship a runtime feature (API endpoint / UI) — `GET /api/perf/live-updates` itself (`host-server/index.ts:721-736`) predates this task and is out of scope here. What this task actually delivers, and what this UAT verifies, is: (1) `scripts/capture-perf-baseline.sh`, a new, committed capture script with its own CLI/argument/failure-handling behavior; (2) `tmp/roadmap-017-perf-capture/summarize.mjs`, a scratch analysis script; and (3) a documented, reproducible dataset + summary appended to the task file. Cases below are grouped accordingly: EDGE cases unit-test the committed script's behavior in isolation (no live server needed); CLI cases exercise/verify the live capture and the captured data itself.

---

## Prerequisites

- [ ] `curl` and `jq` installed and on `PATH`.
- [ ] Node >=26 with the `host-server/` dev dependencies installed (`npm install` in `host-server/`) — needed for the new `tsx`-run unit test file.
- [ ] For UAT-CLI-001 only: host-server running locally on port 8788 (`make dev`, or `npm run dev` in `host-server/`).
- [ ] For UAT-CLI-002/003: the raw capture file `./tmp/roadmap-017-perf-capture/20260902-001004.jsonl` present in this checkout. It was produced by TASK-117 Step 2 and lives under this repo's mandatory `./tmp/` scratch directory, which is gitignored — it will **not** be present in a fresh clone. If absent, either restore it from the machine that ran the capture, or re-run `scripts/capture-perf-baseline.sh` per the task's own Step 2 to regenerate an equivalent file (update the path used below accordingly).
- [ ] Repo-local `./tmp/` writable — UAT-CLI-001's helper script lives there (`./tmp/uat117-live-capture-check.sh`, already created during this UAT's generation), never `/tmp`.

---

## Test Cases

### UAT-EDGE-001: `--help`/`-h` prints usage and exits 0 without writing an output file
- **Scenario**: `capture-perf-baseline.sh`'s `usage()` function (script lines 30-40) is invoked directly from the arg-parsing loop's `-h|--help` branch (line 48-49), which calls `exit 0` before the `OUT_DIR`/`mkdir` block (line 64-65) ever runs.
- **Steps**: Covered by the repeatable unit test below — no manual reproduction needed.
- **Expected Result**: Exit code 0; stdout matches `Usage: capture-perf-baseline.sh` and lists `Env overrides: BACKEND_PORT, HOST, ENDPOINT, INTERVAL_S, DURATION_S.`; no new file appears under `./tmp/roadmap-017-perf-capture/`.
- **Repeatable Unit Test**: Created: `host-server/capturePerfBaseline.test.ts` (test `capture-perf-baseline.sh --help prints usage and exits 0 without writing an output file`).
- **Unit Test Command**: `node --import tsx/esm --test capturePerfBaseline.test.ts` (run from `host-server/`)
- [x] Pass <!-- 2026-09-02: verified via `node --import tsx/esm --test capturePerfBaseline.test.ts` from host-server/ -->

### UAT-EDGE-002: Non-numeric/non-positive `--interval` and `--duration` values are rejected
- **Scenario**: Lines 55-62 validate `INTERVAL_S`/`DURATION_S` against `^[0-9]+$` and `> 0` after arg parsing, `exit 1` with a message on stderr, before `OUT_DIR` is created.
- **Steps**: Covered by the repeatable unit test below.
- **Expected Result**: `--interval abc` → exit 1, stderr contains `INTERVAL_S must be a positive integer (got: abc)`. `--duration 0` → exit 1, stderr contains `DURATION_S must be a positive integer (got: 0)`. Neither invocation creates a file under `./tmp/roadmap-017-perf-capture/`.
- **Repeatable Unit Test**: Created: `host-server/capturePerfBaseline.test.ts` (test `capture-perf-baseline.sh rejects non-numeric/non-positive --interval and --duration values`).
- **Unit Test Command**: `node --import tsx/esm --test capturePerfBaseline.test.ts` (run from `host-server/`)
- [x] Pass <!-- 2026-09-02 -->

### UAT-EDGE-003: An unknown CLI argument is rejected
- **Scenario**: The arg-parsing loop's default `*)` branch (lines 50-51) prints `Unknown argument: $1` to stderr, then `usage() >&2`, then `exit 1`.
- **Steps**: Covered by the repeatable unit test below.
- **Expected Result**: `--bogus` → exit 1, stderr contains both `Unknown argument: --bogus` and the `Usage: capture-perf-baseline.sh` usage text. No output file created.
- **Repeatable Unit Test**: Created: `host-server/capturePerfBaseline.test.ts` (test `capture-perf-baseline.sh rejects an unknown CLI argument`).
- **Unit Test Command**: `node --import tsx/esm --test capturePerfBaseline.test.ts` (run from `host-server/`)
- [x] Pass <!-- 2026-09-02 -->

### UAT-EDGE-004: Curl failures don't crash the script — an `{capturedAt, error}` line is recorded and capture continues
- **Scenario**: When `curl` fails (non-zero exit or empty body), lines 111-118 log a `WARN: sample failed` line to stdout and append a `{capturedAt, error}` JSON line (no `response` key) to the output file instead of the success-path `{capturedAt, response}` shape (lines 96-109), incrementing `ERROR_COUNT` rather than exiting.
- **Steps**: Covered by the repeatable unit test below (points `ENDPOINT` at `http://127.0.0.1:1/unreachable`, a loopback port nothing listens on, so `curl` fails fast with connection-refused).
- **Expected Result**: Script still exits 0; stdout contains `WARN: sample failed`; exactly one new `.jsonl` file is created with exactly one line; that line parses as JSON with a `capturedAt` field and an `error` field, and no `response` field.
- **Repeatable Unit Test**: Created: `host-server/capturePerfBaseline.test.ts` (test `capture-perf-baseline.sh continues past curl failures and records an {capturedAt, error} line for an unreachable endpoint`).
- **Unit Test Command**: `node --import tsx/esm --test capturePerfBaseline.test.ts` (run from `host-server/`)
- [x] Pass <!-- 2026-09-02 -->

### UAT-CLI-001: A live capture run against a real running host-server writes correctly-shaped JSONL sample lines
- **Scenario**: Task acceptance criterion 1 ("writes one JSON line per sample... to `./tmp/roadmap-017-perf-capture/`") exercised end-to-end against a genuinely running server, not a stub — the one behavior that cannot be unit-tested without a live HTTP dependency (success-path branch, script lines 96-109).
- **Steps**:
  1. Ensure the host-server is running on `:8788` (per Prerequisites).
  2. The helper script `./tmp/uat117-live-capture-check.sh` already exists (created during this UAT's generation); if missing, recreate it:
     ```bash
     mkdir -p tmp/roadmap-017-perf-capture
     cat > tmp/uat117-live-capture-check.sh <<'EOF'
     #!/bin/bash
     set -e
     mkdir -p tmp/roadmap-017-perf-capture
     before=$(cd tmp/roadmap-017-perf-capture && ls *.jsonl 2>/dev/null | sort || true)
     bash scripts/capture-perf-baseline.sh --interval 1 --duration 4 >/dev/null
     after=$(cd tmp/roadmap-017-perf-capture && ls *.jsonl | sort)
     new_file=$(comm -13 <(echo "$before") <(echo "$after"))
     FILE="tmp/roadmap-017-perf-capture/$new_file"
     lines=$(wc -l < "$FILE" | tr -d ' ')
     shape_ok=$(jq -s 'all(.[]; (keys == ["capturedAt","response"]) and ((.response|keys) == ["eventLoop","liveUpdates","settings","timestamp"]) and (.response.liveUpdates|has("timings")) and (.response.eventLoop|has("delay")))' "$FILE")
     rm -f "$FILE"
     echo "LINES=$lines SHAPE_OK=$shape_ok"
     EOF
     chmod +x tmp/uat117-live-capture-check.sh
     ```
  3. Run the command below as-is (self-cleaning — deletes the run file it creates).
- **Command**:
  ```bash
  bash tmp/uat117-live-capture-check.sh
  ```
- **Expected Result**: `LINES=<n> SHAPE_OK=true` with `n` between 3 and 4 (the `--interval 1 --duration 4` window is timing-sensitive — each sample's own curl round-trip eats into the 1s budget, so exact sample count varies run to run; this is expected script behavior, not a defect. Verified live twice during generation: 4 and 3 lines respectively, `SHAPE_OK=true` both times). Each line must have exactly the top-level keys `capturedAt`/`response`, with `response` carrying `timestamp`/`settings`/`liveUpdates`/`eventLoop` and both `liveUpdates.timings` and `eventLoop.delay` present, matching the real `/api/perf/live-updates` response shape (`host-server/index.ts:721-736`).
- **Repeatable Unit Test**: Not applicable: requires a genuinely running host-server process to curl against (real HTTP service dependency) — the exact case the unit-test criteria exclude. `host-server/git.test.ts` establishes the pattern of a live-command UAT case in this repo for behavior that can't be isolated.
- [x] Pass <!-- 2026-09-02: verified live twice, see Expected Result -->

### UAT-CLI-002: Re-summarizing the raw captured file reproduces the exact numbers recorded in TASK-117's "Captured Baseline" section
- **Scenario**: The task's acceptance criterion 3 requires the recorded summary to actually reflect the raw data cited alongside it. This re-runs `tmp/roadmap-017-perf-capture/summarize.mjs` fresh against the raw `.jsonl` and diffs its output against the numbers pasted into the task file, catching any transcription/staleness error rather than trusting the recorded prose.
- **Steps**: Run the command below as-is.
- **Command**:
  ```bash
  node tmp/roadmap-017-perf-capture/summarize.mjs tmp/roadmap-017-perf-capture/20260902-001004.jsonl
  ```
- **Expected Result**: Output reproduces exactly the table in TASK-117's "Captured Baseline" section — verified identical during this UAT's generation:
  - `samples: 708`, `first: 2026-09-02T05:10:04Z`, `last: 2026-09-02T07:09:57Z`
  - `statusTicks: intervalAvgMs{n=707 p50=63.455 p95=69.450 p99=74.103 max=246.084} observedLastMsMax=81.002`
  - `terminalTicks: intervalAvgMs{n=707 p50=21.523 p95=24.079 p99=25.973 max=30.628} observedLastMsMax=37.376`
  - `focusedTerminalTicks: intervalAvgMs{n=707 p50=0.004 p95=5.718 p99=5.869 max=6.133} observedLastMsMax=10.004`
  - `tmuxCaptureTail: intervalAvgMs{n=707 p50=4.224 p95=4.596 p99=4.678 max=5.011} observedLastMsMax=5.473`
  - `tmuxCaptureTailRaw: intervalAvgMs{n=278 p50=12.801 p95=13.385 p99=13.591 max=13.690} observedLastMsMax=17.233`
  - `sseBroadcasts: intervalAvgMs{n=8 p50=0.030 p95=0.034 p99=0.034 max=0.034} observedLastMsMax=0.034`
  - `p50Ms: mean= 21.574 max= 22.036`, `p95Ms: mean= 22.133 max= 22.479`, `p99Ms: mean= 65.308 max= 67.568`, `maxMs: overall max= 945.291`
  - `max activeSseConnections observed: 1`, `max snapshot-capture-calls per status tick (aggregate, not per-agent): 6.00`
- **Repeatable Unit Test**: Not applicable: both `summarize.mjs` (the code under test) and its input data file live under this repo's gitignored `./tmp/` scratch directory by deliberate design (the task's own Step 3 notes: "Kept as a scratch script under `./tmp/` rather than `scripts/` since it's a one-off analysis tool for this specific capture file"). Neither is committed to git, so there is no repo-tracked location a persisted automated test could attach to — a fresh clone has neither the script nor the data. Verified live instead, against what's actually on disk in this environment.
- [x] Pass <!-- 2026-09-02: re-ran and diffed byte-for-byte against the task file's table, identical -->

### UAT-CLI-003: The raw captured file independently satisfies the numeric "representative" bar (duration, sample count, dashboard-connection, idle/busy mix)
- **Scenario**: Task acceptance criterion 2 — rather than trusting the task's own narrative summary, recompute the representativeness numbers directly from the raw data.
- **Steps**: Run the command below as-is.
- **Command**:
  ```bash
  jq -s '{samples: length, first: .[0].capturedAt, last: .[-1].capturedAt, sampleSpanS: ((.[-1].capturedAt | strptime("%Y-%m-%dT%H:%M:%SZ") | mktime) - (.[0].capturedAt | strptime("%Y-%m-%dT%H:%M:%SZ") | mktime)), sseConnectedFraction: (([.[] | select(.response.liveUpdates.activeSseConnections > 0)] | length) / length), hasIdleBusyMix: ((.[-1].response.liveUpdates.statusTransitions | has("busy->idle")) and (.[-1].response.liveUpdates.statusTransitions | has("idle->busy")))}' tmp/roadmap-017-perf-capture/20260902-001004.jsonl
  ```
- **Expected Result**: `{"samples": 708, "first": "2026-09-02T05:10:04Z", "last": "2026-09-02T07:09:57Z", "sampleSpanS": 7193, "sseConnectedFraction": 1, "hasIdleBusyMix": true}`.
  - `samples: 708` clears the ≥360 bar comfortably.
  - `sseConnectedFraction: 1` — every sample had `activeSseConnections > 0` (criterion 4, exceeded).
  - `hasIdleBusyMix: true` — the final cumulative `statusTransitions` includes both `busy->idle` and `idle->busy` (criterion 3's idle/busy-mix half; the ≥2-distinct-agents half of criterion 3 isn't independently derivable from this payload, which carries no per-agent breakdown — same limitation the task file itself notes).
  - **Duration nuance, found during generation (not smoothed over)**: `sampleSpanS` (last sample's `capturedAt` minus first sample's `capturedAt`) is **7193s — about 7 seconds under** the nominal 7200s/2h threshold, which looks like a marginal miss on criterion 1 if read naively off the raw timestamps alone. This is *not* a real shortfall: `tmp/roadmap-017-perf-capture/capture-run.log`'s own final line reads `[02:10:07] Stopped. samples=708 errors=0 elapsed=7203s`, i.e. the capture *process* was actively up and sampling for 7203s (≥7200), and the 10s gap is exactly one poll interval — the 708th (last) sample is timestamped ~10s before the process's final elapsed check breaks the loop, because a sample is only logged at the *start* of each interval, not continuously through to exit. The criterion is about the capture window's wall-clock duration (which the process log corroborates at 7203s), not the raw first→last sample-timestamp delta, so criterion 1 is genuinely met — but a naive verifier checking `sampleSpanS >= 7200` alone would flag a false negative. Corroborate the 7203s figure directly if re-checking: `tail -1 tmp/roadmap-017-perf-capture/capture-run.log`.
- **Repeatable Unit Test**: Not applicable: same reasoning as UAT-CLI-002 — the target data file lives under gitignored `./tmp/`, not committed, so no fresh checkout has it to test against.
- [x] Pass <!-- 2026-09-02 -->

### UAT-STATIC-001: `bash -n scripts/capture-perf-baseline.sh` — clean
- **Scenario**: Task acceptance criterion 1's syntax check.
- **Steps**: Run the command below as-is.
- **Command**:
  ```bash
  bash -n scripts/capture-perf-baseline.sh
  ```
- **Expected Result**: No output, exit code 0.
- **Repeatable Unit Test**: Not applicable: this is the static gate itself, not a case to further unit-test.
- [x] Pass <!-- 2026-09-02 -->

### UAT-STATIC-002: Full host-server test suite passes (0 failures), including the 4 new capture-script tests
- **Scenario**: Regression gate — the new `capturePerfBaseline.test.ts` file must not break, or be broken by, the rest of the suite.
- **Steps**: Run the command below as-is from `host-server/`.
- **Command**:
  ```bash
  npm test
  ```
- **Expected Result**: Summary line shows `fail 0`. (109 passing as of this UAT's generation, including the 4 new tests — not asserting an exact total since this repo's suite is a moving target under concurrent multi-agent development; what matters is zero failures.)
- **Repeatable Unit Test**: Not applicable: this is the static gate itself, not a case to further unit-test.
- [x] Pass <!-- 2026-09-02 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| `scripts/capture-perf-baseline.sh` exists, runs cleanly, writes one JSON line per sample to `./tmp/roadmap-017-perf-capture/` | UAT-STATIC-001 (syntax), UAT-EDGE-001..004 (CLI + failure-handling behavior), UAT-CLI-001 (live happy path) |
| A captured dataset exists meeting all 5 representativeness criteria (duration, sample count, fleet diversity, connected dashboard client, raw samples preserved) | UAT-CLI-003 (duration incl. the sample-span timing nuance, sample count, dashboard-connection, idle/busy-mix evidence — directly recomputed from the raw file, not just narrative trust); raw-samples-preserved is implicit in UAT-CLI-002/003 succeeding at all |
| A summary (p50/p95/p99/max per `timings` key, plus event-loop delay percentiles) is recorded in the task file, with the raw data file's path cited | UAT-CLI-002 (byte-for-byte re-derivation match) |

**Split**: 4 of 9 cases are unit-backed (`capturePerfBaseline.test.ts`, machine-checkable with no human/live-server dependency); 3 are live/data commands run directly against this environment's real host-server and real captured file (UAT-CLI-001/002/003); 2 are the task's own static gates (UAT-STATIC-001/002). No case requires human judgment — every verdict above is a command with a concrete expected output.
