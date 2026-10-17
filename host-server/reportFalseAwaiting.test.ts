import { test, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// TASK-0231 Step 7 / UAT-0231: scripts/report-false-awaiting.mjs is the read-only
// measurement tool for BUG-0013's false-awaiting rate. This runs the real script
// against a hand-written JSONL under the repo-local ./tmp/ (never system temp).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'report-false-awaiting.mjs');
const TMP_ROOT = path.join(REPO_ROOT, 'tmp');
fs.mkdirSync(TMP_ROOT, { recursive: true });
const scratch = fs.mkdtempSync(path.join(TMP_ROOT, 'report-false-awaiting-'));
after(() => { fs.rmSync(scratch, { recursive: true, force: true }); });

const records = [
  // C: older awaiting record, no dialog marker, no busy footer (excluded by --since below)
  { ts: '2026-09-10T00:00:00.000Z', agent: 'a', from: 'busy', to: 'awaiting', reason: 'awaiting-pattern', paneTail: 'some output\nfoo <!-- x -->' },
  // A: genuine dialog marker, no busy footer
  { ts: '2026-09-20T10:00:00.000Z', agent: 'a', from: 'busy', to: 'awaiting', reason: 'awaiting-pattern', paneTail: 'Which option?\nEnter to select · Tab/Arrow keys to navigate · Esc to cancel' },
  // B: no dialog marker, `esc to interrupt` visible (agent demonstrably running)
  { ts: '2026-09-20T11:00:00.000Z', agent: 'b', from: 'idle', to: 'awaiting', reason: 'regex-fallback', paneTail: ['Verdicts (2-4)?', '✻ Thinking… (esc to interrupt)'] },
  // D: not an awaiting transition, must be ignored
  { ts: '2026-09-20T12:00:00.000Z', agent: 'a', from: 'awaiting', to: 'busy', reason: 'state-file', paneTail: 'esc to interrupt' },
];
const jsonl = `${records.map((r) => JSON.stringify(r)).join('\n')}\nthis line is not json\n`;
const logFile = path.join(scratch, 'transitions.jsonl');
fs.writeFileSync(logFile, jsonl);

function run(args: string[]) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO_ROOT });
}

void test('report-false-awaiting counts awaiting transitions, no-dialog, busy-visible and skips malformed lines', () => {
  const r = run(['--file', logFile]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Malformed lines:\s+1\b/);
  assert.match(r.stdout, /Awaiting transitions:\s+3\b/);
  assert.match(r.stdout, /No dialog marker \(last 8 lines\):\s+2 \(66\.7%\)/);
  assert.match(r.stdout, /'esc to interrupt' visible:\s+1 \(33\.3%\)/);
  assert.match(r.stdout, /2\s+busy \| awaiting-pattern/);
  assert.match(r.stdout, /1\s+idle \| regex-fallback/);
});

void test('report-false-awaiting --since excludes older records', () => {
  const r = run(['--file', logFile, '--since', '2026-09-20T00:00:00Z']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Awaiting transitions:\s+2\b/);
  assert.match(r.stdout, /No dialog marker \(last 8 lines\):\s+1 \(50\.0%\)/);
  assert.match(r.stdout, /'esc to interrupt' visible:\s+1 \(50\.0%\)/);
});

void test('report-false-awaiting is read-only: the input log is unchanged after a run', () => {
  const before = fs.readFileSync(logFile, 'utf8');
  const beforeMtime = fs.statSync(logFile).mtimeMs;
  run(['--file', logFile]);
  assert.equal(fs.readFileSync(logFile, 'utf8'), before);
  assert.equal(fs.statSync(logFile).mtimeMs, beforeMtime);
});

void test('report-false-awaiting exit codes: 1 for an unreadable file, 2 for bad arguments', () => {
  assert.equal(run(['--file', path.join(scratch, 'does-not-exist.jsonl')]).status, 1);
  assert.equal(run(['--since', 'not-a-date', '--file', logFile]).status, 2);
  assert.equal(run(['--bogus']).status, 2);
});
