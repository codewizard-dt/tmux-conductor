import { test, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// TASK-0234 / UAT-0234: scripts/audit-sample-transitions.mjs is the read-only,
// interactive human-audit sampler for logs/transitions.jsonl. It is driven here
// the same way a human would at the keyboard, by piping canned y/n/s answers into
// its stdin via spawnSync's `input` option, against a hand-written JSONL under
// the repo-local ./tmp/ (never system temp).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'audit-sample-transitions.mjs');
const TMP_ROOT = path.join(REPO_ROOT, 'tmp');
fs.mkdirSync(TMP_ROOT, { recursive: true });
const scratch = fs.mkdtempSync(path.join(TMP_ROOT, 'audit-sample-transitions-'));
after(() => { fs.rmSync(scratch, { recursive: true, force: true }); });

const records = [
  // sourceIndex 0: genuine dialog marker, no busy footer
  { ts: '2026-09-20T10:00:00.000Z', agent: 'a', from: 'busy', to: 'awaiting', reason: 'awaiting-pattern', paneTail: 'Which option?\nEnter to select · Tab/Arrow keys to navigate · Esc to cancel' },
  // sourceIndex 1: no dialog marker, `esc to interrupt` visible
  { ts: '2026-09-20T11:00:00.000Z', agent: 'b', from: 'idle', to: 'awaiting', reason: 'regex-fallback', paneTail: ['Verdicts (2-4)?', '✳ Thinking… (esc to interrupt)'] },
  // sourceIndex 2: no dialog marker, no busy footer
  { ts: '2026-09-20T12:00:00.000Z', agent: 'c', from: 'busy', to: 'awaiting', reason: 'awaiting-pattern', paneTail: 'no markers here at all' },
];
const jsonl = `${records.map((r) => JSON.stringify(r)).join('\n')}\nthis line is not json\n`;
const logFile = path.join(scratch, 'transitions.jsonl');
fs.writeFileSync(logFile, jsonl);

function run(args: string[], input = '') {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO_ROOT, input });
}

void test('audit-sample-transitions: seeded sample order, verdicts, summary, and --out shape', () => {
  const outPath = path.join(scratch, 'out.jsonl');
  // --seed 42 deterministically orders this fixture as [c, a, b]; answer y, n, s in that order.
  const r = run(['--n', '3', '--file', logFile, '--seed', '42', '--out', outPath], 'y\nn\ns\n');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Heuristic verdict: suspected-false-positive/);
  assert.match(r.stdout, /Heuristic verdict: genuine/);
  assert.match(r.stdout, /Was this really awaiting\? \[y\/n\/s=skip\]: /);
  assert.match(r.stdout, /Malformed lines:\s+1\b/);
  assert.match(r.stdout, /Total sampled:\s+3\b/);
  assert.match(r.stdout, /Skipped:\s+1\b/);
  assert.match(r.stdout, /Agreement:\s+0\/2 \(0\.0%\)/);
  assert.match(r.stdout, new RegExp(`Written to:\\s+${outPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  const lines = fs.readFileSync(outPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { sourceIndex: number; ts: string; agent: string; from: string; to: string; reason: string; heuristicVerdict: string; humanVerdict: string; agreed: boolean | null });
  assert.equal(lines.length, 3);
  const bySource = Object.fromEntries(lines.map((l) => [l.sourceIndex, l])) as Record<number, { sourceIndex: number; ts: string; agent: string; from: string; to: string; reason: string; heuristicVerdict: string; humanVerdict: string; agreed: boolean | null }>;
  assert.deepEqual(bySource[2], { ts: '2026-09-20T12:00:00.000Z', agent: 'c', from: 'busy', to: 'awaiting', reason: 'awaiting-pattern', sourceIndex: 2, heuristicVerdict: 'suspected-false-positive', humanVerdict: 'genuine', agreed: false });
  assert.deepEqual(bySource[0], { ts: '2026-09-20T10:00:00.000Z', agent: 'a', from: 'busy', to: 'awaiting', reason: 'awaiting-pattern', sourceIndex: 0, heuristicVerdict: 'genuine', humanVerdict: 'suspected-false-positive', agreed: false });
  assert.deepEqual(bySource[1], { ts: '2026-09-20T11:00:00.000Z', agent: 'b', from: 'idle', to: 'awaiting', reason: 'regex-fallback', sourceIndex: 1, heuristicVerdict: 'suspected-false-positive', humanVerdict: 'skipped', agreed: null });
});

void test('audit-sample-transitions --since excludes older records', () => {
  const r = run(['--n', '1', '--file', logFile, '--since', '2026-09-20T11:30:00Z', '--seed', '1', '--out', path.join(scratch, 'out-since.jsonl')], 's\n');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ts:\s+2026-09-20T12:00:00\.000Z/);
  assert.match(r.stdout, /Total sampled:\s+1\b/);
});

void test('audit-sample-transitions prints a stderr notice and samples all records when fewer than --n match', () => {
  const r = run(['--n', '5', '--file', logFile, '--seed', '7', '--out', path.join(scratch, 'out-fewer.jsonl')], 's\ns\ns\n');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Only 3 matching record\(s\) \(< --n 5\); sampling all of them\./);
  assert.match(r.stdout, /Total sampled:\s+3\b/);
  assert.match(r.stdout, /Skipped:\s+3\b/);
});

void test('audit-sample-transitions is read-only: the input log is unchanged after a run', () => {
  const before = fs.readFileSync(logFile, 'utf8');
  const beforeMtime = fs.statSync(logFile).mtimeMs;
  run(['--n', '1', '--file', logFile, '--seed', '1', '--out', path.join(scratch, 'out-readonly.jsonl')], 's\n');
  assert.equal(fs.readFileSync(logFile, 'utf8'), before);
  assert.equal(fs.statSync(logFile).mtimeMs, beforeMtime);
});

void test('audit-sample-transitions exit codes: 0 for --help, 2 for a bad argument, 1 for an unreadable file', () => {
  const help = run(['-h']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage: node scripts\/audit-sample-transitions\.mjs/);
  assert.equal(run(['--bogus']).status, 2);
  assert.equal(run(['--file', path.join(scratch, 'does-not-exist.jsonl')]).status, 1);
});
