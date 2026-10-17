#!/usr/bin/env node
// TASK-0231 Step 7: report-false-awaiting.mjs
//
// Read-only measurement of how many `awaiting` transitions look like false
// positives. Reads the unified transition log ($LOG_DIR/transitions.jsonl,
// written by the host-server's pollAndDiff and monitor.sh's is_idle()) and, for
// every record with `to: "awaiting"`, prints:
//   - the total count
//   - how many have NO dialog marker in the last 8 non-blank lines of paneTail
//     (a genuine Claude Code dialog / prompt always leaves one of the markers
//     below on screen, so a missing marker means AWAITING_PATTERN matched
//     something that is not a real prompt)
//   - how many have `esc to interrupt` visible anywhere in paneTail (the busy
//     spinner is on screen, so the agent was actually working)
//   - a breakdown of `from | reason`, sorted descending
//
// Dialog markers (case-sensitive), matched against the last 8 non-blank lines:
//   Enter to (select|confirm|submit) | Esc to (cancel|go back) | [Y/n] | [y/N]
//   | ctrl.g to edit | shift.tab to approve
//
// Pre-fix baseline (before TASK-0231), window 2026-09-13 to 2026-09-20:
//   329 total awaiting transitions, 178 with no dialog marker (54%),
//   21 with `esc to interrupt` visible (6%).
//
// Usage:
//   node scripts/report-false-awaiting.mjs [--since <ISO>] [--file <path>]
//
//   --since <ISO>   only count records whose ts >= this ISO-8601 time
//   --file <path>   read this JSONL instead of the default log
//
// Log path resolution: --file wins; otherwise $LOG_DIR/transitions.jsonl when
// LOG_DIR is set in the environment; otherwise <repo root>/logs/transitions.jsonl
// (repo root resolved relative to this script, not the cwd).
//
// Stdlib only, and strictly read-only: it uses fs.readFileSync and never writes.
// Malformed JSONL lines are skipped and counted. Exit codes: 0 ok, 1 read
// failure, 2 bad arguments.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(__filename)); // scripts/.. == repo root

const DIALOG_MARKER =
  /Enter to (select|confirm|submit)|Esc to (cancel|go back)|\[Y\/n\]|\[y\/N\]|ctrl.g to edit|shift.tab to approve/;
const BUSY_MARKER = 'esc to interrupt';
const TAIL_LINES = 8;

const USAGE = `Usage: node scripts/report-false-awaiting.mjs [--since <ISO>] [--file <path>]

  --since <ISO>   only count records with ts >= this ISO-8601 time
  --file <path>   read this JSONL file (default: $LOG_DIR/transitions.jsonl,
                  or <repo root>/logs/transitions.jsonl)
  -h, --help      show this help`;

function fail(msg) {
  process.stderr.write(`${msg}\n\n${USAGE}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { since: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (arg === '--since' || arg === '--file') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) fail(`Missing value for ${arg}`);
      if (arg === '--file') {
        opts.file = value;
      } else {
        const ms = Date.parse(value);
        if (Number.isNaN(ms)) fail(`Invalid ISO timestamp for --since: ${value}`);
        opts.since = ms;
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

function pct(part, whole) {
  return whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

const opts = parseArgs(process.argv.slice(2));
const file = opts.file
  ? path.resolve(opts.file)
  : path.join(process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : path.join(REPO_ROOT, 'logs'), 'transitions.jsonl');

let raw;
try {
  raw = fs.readFileSync(file, 'utf8');
} catch (err) {
  process.stderr.write(`Cannot read ${file}: ${err.message}\n`);
  process.exit(1);
}

let malformed = 0;
let awaiting = 0;
let noDialog = 0;
let busyVisible = 0;
let earliest = null;
let latest = null;
const breakdown = new Map();

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
  if (rec.to !== 'awaiting') continue;

  awaiting++;
  if (typeof rec.ts === 'string') {
    if (earliest === null || rec.ts < earliest) earliest = rec.ts;
    if (latest === null || rec.ts > latest) latest = rec.ts;
  }
  const text = paneText(rec.paneTail);
  if (!DIALOG_MARKER.test(lastNonBlankLines(text, TAIL_LINES).join('\n'))) noDialog++;
  if (text.includes(BUSY_MARKER)) busyVisible++;

  const key = `${rec.from ?? '?'} | ${rec.reason ?? '?'}`;
  breakdown.set(key, (breakdown.get(key) ?? 0) + 1);
}

const out = [];
out.push(`File:               ${file}`);
if (opts.since !== null) out.push(`Since:              ${new Date(opts.since).toISOString()}`);
if (earliest !== null) out.push(`Awaiting ts range:  ${earliest} .. ${latest}`);
out.push(`Malformed lines:    ${malformed}`);
out.push('');
out.push(`Awaiting transitions:                 ${awaiting}`);
out.push(`  No dialog marker (last ${TAIL_LINES} lines):   ${noDialog} (${pct(noDialog, awaiting)})`);
out.push(`  'esc to interrupt' visible:         ${busyVisible} (${pct(busyVisible, awaiting)})`);
out.push('');
out.push('from | reason breakdown (count):');
if (breakdown.size === 0) {
  out.push('  (none)');
} else {
  const rows = [...breakdown.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const width = Math.max(...rows.map(([, c]) => String(c).length));
  for (const [key, count] of rows) out.push(`  ${String(count).padStart(width)}  ${key}`);
}
process.stdout.write(`${out.join('\n')}\n`);
