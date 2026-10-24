---
id: TASK-0234
aliases: [TASK-0234]
title: "Add a Read-Only Human-Audit Sampler for logs/transitions.jsonl"
status: pending-uat
created: 2026-10-17
updated: 2026-10-17
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-0234]]"
tags: [testing, agent-state, observability, scripts]
---

# TASK-0234 — Add a Read-Only Human-Audit Sampler for logs/transitions.jsonl

relates_to::[[state-detector-evaluation-tiers]]

## Objective

`scripts/report-false-awaiting.mjs` estimates the false-positive rate of `to: "awaiting"` transitions in `logs/transitions.jsonl` using a second heuristic (dialog-marker regex over `paneTail`): a record is flagged as a likely false positive if the last 8 non-blank `paneTail` lines contain no recognized dialog marker, or conversely if the busy-spinner text (`esc to interrupt`) is visible. That is useful but not ground truth — it is one heuristic checking another, and the literature on estimating false-positive rate from unlabeled data warns this kind of self-validation tends to underestimate error (see `wiki/knowledge/concepts/state-detector-evaluation-tiers.md`'s "limit of a self-referential false-positive proxy" section). Add `scripts/audit-sample-transitions.mjs`: a read-only, interactive CLI that samples real transitions (default `to: "awaiting"`, filterable), shows each one's pane snapshot to a human, asks for a yes/no verdict, and reports how often the human agrees with the existing dialog-marker heuristic — a calibrated precision estimate instead of a self-referential one.

## Approach

- Stdlib-only (`fs`, `path`, `url`, `readline`), mirroring `report-false-awaiting.mjs`'s style and its log-path resolution (`--file` wins; else `$LOG_DIR/transitions.jsonl` when `LOG_DIR` is set; else `<repo root>/logs/transitions.jsonl`, repo root resolved relative to the script's own location via `fileURLToPath`/`path.dirname`, not `cwd`).
- Duplicate (do not extract into a shared module — this project's convention, confirmed by `report-false-awaiting.mjs` and `scripts/verify-awaiting-detection.sh`/`scripts/verify-transitions-jsonl-emit.sh`, is standalone scripts with their own copies of small helpers, not shared modules under `scripts/lib/`) `report-false-awaiting.mjs`'s `paneText(tail)` helper (handles `paneTail` as either a string or an array of lines), `lastNonBlankLines(text, n)` helper, and its `DIALOG_MARKER`/`BUSY_MARKER` regex constants verbatim, so the heuristic verdict computed here is identical to the one `report-false-awaiting.mjs` already computes. Define the single-record heuristic verdict as: `'genuine'` when `DIALOG_MARKER` matches the last 8 non-blank `paneTail` lines AND `BUSY_MARKER` ("esc to interrupt") is not present anywhere in `paneTail`; `'suspected-false-positive'` otherwise.
- CLI flags: `--file <path>` (same resolution as `report-false-awaiting.mjs`), `--since <ISO>`, `--to <state>` (default `awaiting`; filters `rec.to === opts.to`), `--n <count>` (default `10`, the sample size — if fewer matching records exist than `--n`, sample all of them and say so), `--seed <int>` (optional; when given, use a small seeded PRNG — e.g. a mulberry32 implementation inlined in the script — for a reproducible shuffle/sample; when omitted, use `Math.random()`), `--out <path>` (default `./tmp/audit-sample-<ISO-timestamp-with-colons-stripped>.jsonl`), `-h`/`--help` (prints usage and exits 0, matching `report-false-awaiting.mjs`'s `USAGE` string style).
- The script is strictly read-only against the real `transitions.jsonl`: it uses `fs.readFileSync` only against that file and never opens it for writing. It only writes to the `--out` path (default under `./tmp/`, per this repo's scratch-file convention — never `/tmp` or `mktemp`).
- Interaction loop (one iteration per sampled record, using `node:readline`'s `createInterface({ input: process.stdin, output: process.stdout })`): print a formatted block — `ts`, `agent`, `from → to`, `reason`, `matchedPattern` (if present on the record), and the last 8 non-blank `paneTail` lines (via the duplicated `lastNonBlankLines`/`paneText` helpers) — followed by a line showing the heuristic's own verdict (`Heuristic verdict: genuine` / `Heuristic verdict: suspected-false-positive`), then prompt on stdin: `Was this really <opts.to>? [y/n/s=skip]: `. Treat `y`/`Y` as human verdict `genuine`, `n`/`N` as `suspected-false-positive`, `s`/`S` (or empty input) as skip; re-prompt on any other input.
- Per-record output written to `--out` as one JSON object per line: `{ ts, agent, from, to, reason, sourceIndex, heuristicVerdict, humanVerdict, agreed }`, where `sourceIndex` is the 0-based index of the record within the filtered-and-matched set read from the source file (enough to identify which source record a line corresponds to without re-hashing), `humanVerdict` is `'genuine' | 'suspected-false-positive' | 'skipped'`, and `agreed` is `heuristicVerdict === humanVerdict` (boolean) or `null` when `humanVerdict === 'skipped'`.
- After the loop, print a summary to stdout: total sampled, total skipped, agreement count and rate (`agreed === true` count / count of non-skipped records), and the `--out` path written.
- No live tmux/DB access — the script only reads one JSONL file and reads stdin via `readline`. Malformed JSONL lines in the source file are skipped and counted, matching `report-false-awaiting.mjs`'s existing behavior.
- Exit codes, matching `report-false-awaiting.mjs`'s convention: `0` ok (including when the human sampling loop completes, even if some records were skipped), `1` read failure on the source file, `2` bad arguments.

## Steps

### 1. Confirm script conventions  <!-- agent: general-purpose -->

- [x] Re-read `scripts/report-false-awaiting.mjs` in full and note its exact `parseArgs`/`fail`/`USAGE` pattern, `paneText(tail)`, `lastNonBlankLines(text, n)`, `DIALOG_MARKER`, `BUSY_MARKER`, `TAIL_LINES`, and its log-path resolution (`REPO_ROOT` via `fileURLToPath(import.meta.url)` + `path.dirname(path.dirname(...))`, `--file` override, else `$LOG_DIR`/`transitions.jsonl`, else `<repo root>/logs/transitions.jsonl`)
- [x] Skim `host-server/reportFalseAwaiting.test.ts` to confirm the project's test precedent for this script (it spawns the real script via `spawnSync('node', [SCRIPT, ...args])` against a scratch JSONL under `./tmp/report-false-awaiting-<random>/`, asserts stdout via regex, and asserts the input file's content/mtime are unchanged to prove read-only behavior) — cite this as the precedent in Step 4's manual verification, since an interactive stdin tool cannot reuse the same spawn-and-assert-stdout approach directly
- [x] Confirm `./tmp/` is this repo's scratch-file convention (see `CLAUDE.md`'s Shell Command Conventions section and the `./tmp/` usage already in `report-false-awaiting.mjs`'s own smoke test and `host-server/reportFalseAwaiting.test.ts`) and do not propose any other location for `--out`'s default

### 2. Implement scripts/audit-sample-transitions.mjs  <!-- agent: general-purpose -->

- [x] Create `scripts/audit-sample-transitions.mjs` as a Node ESM script (`#!/usr/bin/env node`), stdlib-only (`node:fs`, `node:path`, `node:url`, `node:readline`)
- [x] Implement `parseArgs(argv)` handling `--file`, `--since`, `--to` (default `'awaiting'`), `--n` (default `10`, parse as integer, reject non-positive via `fail()`), `--seed` (optional integer), `--out` (default computed from current time), `-h`/`--help`; unknown args call `fail()` with a `USAGE` string listing every flag
- [x] Duplicate `paneText(tail)`, `lastNonBlankLines(text, n)`, `DIALOG_MARKER`, `BUSY_MARKER`, `TAIL_LINES = 8` from `report-false-awaiting.mjs` verbatim; add `function heuristicVerdict(rec) { ... }` returning `'genuine'` or `'suspected-false-positive'` per the Approach section's rule
- [x] Implement log-path resolution identical to `report-false-awaiting.mjs` (same `REPO_ROOT`, same `$LOG_DIR` env fallback, same default `<repo root>/logs/transitions.jsonl`); read with `fs.readFileSync`, parse line-by-line, skip and count malformed lines, filter to `rec.to === opts.to` and (when `--since` given) `Date.parse(rec.ts) >= opts.since`
- [x] Implement a seeded sampler: if `--seed` given, use an inlined mulberry32 PRNG seeded from it to do a Fisher-Yates shuffle of the matched-records array, then take the first `opts.n`; if no `--seed`, shuffle with `Math.random()`. If fewer matched records than `opts.n` exist, use all of them and print a one-line notice to stderr (not stdout, so it doesn't pollute piped output)
- [x] Implement the interactive loop with `readline.createInterface`, prompting once per sampled record as specified in the Approach section; collect `{ ts, agent, from, to, reason, sourceIndex, heuristicVerdict, humanVerdict, agreed }` per record (skip input re-prompts on unrecognized answers)
- [x] After the loop, compute and print the summary (total sampled, skipped count, agreement count/rate over non-skipped records), resolve the default `--out` path as `./tmp/audit-sample-<ISO timestamp with `:` replaced by `-`>.jsonl` when `--out` is omitted, `fs.mkdirSync(path.dirname(outPath), { recursive: true })`, write one JSON object per line via `fs.writeFileSync`, and print the written path
- [x] Set exit codes: `0` on normal completion, `1` if the source file can't be read, `2` on bad arguments (mirror `fail()` from `report-false-awaiting.mjs`)

### 3. Documentation  <!-- agent: general-purpose -->

- [x] Add a row for `scripts/audit-sample-transitions.mjs` to the "Going-forward summary" table in `scripts/README.md`, in the same style as the existing `report-false-awaiting.mjs` row, explicitly noting it is interactive/manual (requires a human at the keyboard, not CI-runnable) and strictly read-only against the real `transitions.jsonl` (writes only to `--out` under `./tmp/`)
- [x] In the new script's own header comment block (mirroring `report-false-awaiting.mjs`'s header), document the CLI usage line, every flag, the heuristic-verdict rule, and the output record shape

### 4. Manual verification (no automated test)  <!-- agent: general-purpose -->

- [x] Hand-build a tiny scratch JSONL with 2-3 fake transition records (at least one with a genuine dialog marker and no busy text, at least one with no dialog marker, matching `host-server/reportFalseAwaiting.test.ts`'s existing fixture records as a model) under `./tmp/audit-sample-transitions-dryrun/transitions.jsonl`
- [x] Record the real `logs/transitions.jsonl`'s mtime and a content hash (e.g. `shasum`) before the dry run
- [x] Run `node scripts/audit-sample-transitions.mjs --n 2 --file ./tmp/audit-sample-transitions-dryrun/transitions.jsonl --out ./tmp/audit-sample-transitions-dryrun/audit-test-output.jsonl`, answer the interactive prompts (try `y`, `n`, and `s` across the sample to exercise all three paths), and confirm: the printed summary's counts match what was answered, the `--out` file exists with one JSON line per non-... (every sampled record, skipped included) with the documented shape, and the process exits `0`
- [x] Also run it once with `-h`/`--help` (expect usage text and exit `0`) and once with a bad flag (expect exit `2`) and once with `--file` pointing at a nonexistent path (expect exit `1`)
- [x] Re-check the real `logs/transitions.jsonl`'s mtime and content hash match the pre-run values exactly, confirming the script never touched it

## Dependencies

- Depends on: none.
- Blocks: none.
- Parallel-safe with: any task not editing `scripts/report-false-awaiting.mjs` or `scripts/README.md`'s summary table concurrently.
