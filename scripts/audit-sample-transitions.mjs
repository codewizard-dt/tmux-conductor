#!/usr/bin/env node
// TASK-0234: audit-sample-transitions.mjs
//
// Interactive, human-in-the-loop audit of logs/transitions.jsonl. Samples real
// transitions (default `to: "awaiting"`), shows each one's pane snapshot, asks
// whether the transition was real, and reports how often the human agrees with
// the dialog-marker heuristic used by report-false-awaiting.mjs. That gives a
// calibrated precision estimate instead of one heuristic checking another.
// MANUAL ONLY: needs a human at the keyboard, not CI-runnable.
//
// Usage:
//   node scripts/audit-sample-transitions.mjs [--file <path>] [--since <ISO>]
//        [--to <state>] [--n <count>] [--seed <int>] [--out <path>]
//
//   --file <path>   read this JSONL instead of the default log
//   --since <ISO>   only sample records whose ts >= this ISO-8601 time
//   --to <state>    sample records with this `to` state (default: awaiting)
//   --n <count>     sample size (default: 10; fewer matches => sample all)
//   --seed <int>    seed for a reproducible sample (default: Math.random)
//   --out <path>    write per-record verdicts here
//                   (default: ./tmp/audit-sample-<ISO timestamp>.jsonl)
//
// Log path resolution: --file wins; otherwise $LOG_DIR/transitions.jsonl when
// LOG_DIR is set in the environment; otherwise <repo root>/logs/transitions.jsonl
// (repo root resolved relative to this script, not the cwd).
//
// Heuristic verdict (identical to report-false-awaiting.mjs):
//   'genuine'                  DIALOG_MARKER matches the last 8 non-blank
//                              paneTail lines AND 'esc to interrupt' is absent
//                              from paneTail
//   'suspected-false-positive' otherwise
//
// Output record (one JSON object per line in --out):
//   { ts, agent, from, to, reason, sourceIndex, heuristicVerdict,
//     humanVerdict, agreed }
//   sourceIndex   0-based index within the filtered-and-matched source records
//   humanVerdict  'genuine' | 'suspected-false-positive' | 'skipped'
//   agreed        heuristicVerdict === humanVerdict, or null when skipped
//
// Stdlib only. Strictly read-only against the transitions log (fs.readFileSync
// only); the only file written is --out. Malformed JSONL lines are skipped and
// counted. Exit codes: 0 ok, 1 read failure, 2 bad arguments.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(__filename)); // scripts/.. == repo root

const DIALOG_MARKER =
  /Enter to (select|confirm|submit)|Esc to (cancel|go back)|\[Y\/n\]|\[y\/N\]|ctrl.g to edit|shift.tab to approve/;
const BUSY_MARKER = 'esc to interrupt';
const TAIL_LINES = 8;

const USAGE = `Usage: node scripts/audit-sample-transitions.mjs [--file <path>] [--since <ISO>]
         [--to <state>] [--n <count>] [--seed <int>] [--out <path>]

  --file <path>   read this JSONL file (default: $LOG_DIR/transitions.jsonl,
                  or <repo root>/logs/transitions.jsonl)
  --since <ISO>   only sample records with ts >= this ISO-8601 time
  --to <state>    sample records whose "to" equals this state (default: awaiting)
  --n <count>     sample size (default: 10)
  --seed <int>    seed for a reproducible sample (default: random)
  --out <path>    write per-record verdicts here
                  (default: ./tmp/audit-sample-<ISO timestamp>.jsonl)
  -h, --help      show this help`;

function fail(msg) {
  process.stderr.write(`${msg}\n\n${USAGE}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { since: null, file: null, to: 'awaiting', n: 10, seed: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (['--since', '--file', '--to', '--n', '--seed', '--out'].includes(arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) fail(`Missing value for ${arg}`);
      if (arg === '--file') {
        opts.file = value;
      } else if (arg === '--to') {
        opts.to = value;
      } else if (arg === '--out') {
        opts.out = value;
      } else if (arg === '--since') {
        const ms = Date.parse(value);
        if (Number.isNaN(ms)) fail(`Invalid ISO timestamp for --since: ${value}`);
        opts.since = ms;
      } else if (arg === '--n') {
        if (!/^\d+$/.test(value) || Number(value) <= 0) fail(`--n must be a positive integer: ${value}`);
        opts.n = Number(value);
      } else {
        if (!/^-?\d+$/.test(value)) fail(`--seed must be an integer: ${value}`);
        opts.seed = Number(value);
      }
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

/** paneTail may be a string (possibly with \n) or an array of lines. */
function paneText(tail) {
  if (typeof tail === 'string') return tail;
  if (Array.isArray(tail)) return tail.map((l) => (typeof l === 'string' ? l : String(l))).join('\n');
  return '';
}

function lastNonBlankLines(text, n) {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(-n);
}

function heuristicVerdict(rec) {
  const text = paneText(rec.paneTail);
  const hasDialog = DIALOG_MARKER.test(lastNonBlankLines(text, TAIL_LINES).join('\n'));
  return hasDialog && !text.includes(BUSY_MARKER) ? 'genuine' : 'suspected-false-positive';
}

/** Small seeded PRNG (mulberry32). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle; returns [{ rec, sourceIndex }] reordered. */
function shuffle(items, rand) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pct(part, whole) {
  return whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

const opts = parseArgs(process.argv.slice(2));
const file = opts.file
  ? path.resolve(opts.file)
  : path.join(process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : path.join(REPO_ROOT, 'logs'), 'transitions.jsonl');
const outPath = path.resolve(
  opts.out ?? path.join('tmp', `audit-sample-${new Date().toISOString().replace(/:/g, '-')}.jsonl`),
);

let raw;
try {
  raw = fs.readFileSync(file, 'utf8');
} catch (err) {
  process.stderr.write(`Cannot read ${file}: ${err.message}\n`);
  process.exit(1);
}

let malformed = 0;
const matched = [];
for (const line of raw.split('\n')) {
  if (line.trim() === '') continue;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    malformed++;
    continue;
  }
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
    malformed++;
    continue;
  }
  if (opts.since !== null) {
    const ms = Date.parse(rec.ts);
    if (Number.isNaN(ms) || ms < opts.since) continue;
  }
  if (rec.to !== opts.to) continue;
  matched.push({ rec, sourceIndex: matched.length });
}

const rand = opts.seed !== null ? mulberry32(opts.seed) : Math.random;
const sample = shuffle(matched, rand).slice(0, opts.n);
if (matched.length < opts.n) {
  process.stderr.write(`Only ${matched.length} matching record(s) (< --n ${opts.n}); sampling all of them.\n`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();

/** Prompt until y/n/s; EOF on stdin counts as skip. */
async function ask(prompt) {
  for (;;) {
    process.stdout.write(prompt);
    const { value, done } = await lines.next();
    if (done) {
      process.stdout.write('\n');
      return 's';
    }
    const ans = value.trim().toLowerCase();
    if (ans === 'y' || ans === 'n' || ans === 's' || ans === '') return ans || 's';
  }
}

const results = [];
for (let i = 0; i < sample.length; i++) {
  const { rec, sourceIndex } = sample[i];
  const heuristic = heuristicVerdict(rec);
  const block = [];
  block.push(`--- Sample ${i + 1}/${sample.length} ---`);
  block.push(`ts:      ${rec.ts}`);
  block.push(`agent:   ${rec.agent}`);
  block.push(`change:  ${rec.from} -> ${rec.to}`);
  block.push(`reason:  ${rec.reason}`);
  if (rec.matchedPattern !== undefined) block.push(`pattern: ${rec.matchedPattern}`);
  block.push('pane tail (last 8 non-blank lines):');
  for (const l of lastNonBlankLines(paneText(rec.paneTail), TAIL_LINES)) block.push(`  | ${l}`);
  block.push(`Heuristic verdict: ${heuristic}`);
  process.stdout.write(`\n${block.join('\n')}\n`);

  const ans = await ask(`Was this really ${opts.to}? [y/n/s=skip]: `);
  const humanVerdict = ans === 'y' ? 'genuine' : ans === 'n' ? 'suspected-false-positive' : 'skipped';
  results.push({
    ts: rec.ts,
    agent: rec.agent,
    from: rec.from,
    to: rec.to,
    reason: rec.reason,
    sourceIndex,
    heuristicVerdict: heuristic,
    humanVerdict,
    agreed: humanVerdict === 'skipped' ? null : heuristic === humanVerdict,
  });
}
rl.close();

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, results.map((r) => `${JSON.stringify(r)}\n`).join(''));

const skipped = results.filter((r) => r.humanVerdict === 'skipped').length;
const judged = results.length - skipped;
const agreed = results.filter((r) => r.agreed === true).length;
const summary = [];
summary.push('');
summary.push(`File:               ${file}`);
summary.push(`Malformed lines:    ${malformed}`);
summary.push(`Total sampled:      ${results.length}`);
summary.push(`Skipped:            ${skipped}`);
summary.push(`Agreement:          ${agreed}/${judged} (${pct(agreed, judged)})`);
summary.push(`Written to:         ${outPath}`);
process.stdout.write(`${summary.join('\n')}\n`);
