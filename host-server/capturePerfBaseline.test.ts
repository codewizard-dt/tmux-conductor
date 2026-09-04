// UAT-117: covers scripts/capture-perf-baseline.sh's CLI argument validation
// and its curl-failure resilience (TASK-117 step 1). The live happy-path
// capture against a real running host-server, and the accuracy of the
// captured/summarized data, are exercised as live UAT-CLI cases instead —
// see wiki/work/uat/UAT-117-capture-perf-baseline-data.md.
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, '../scripts/capture-perf-baseline.sh');
const outDir = path.resolve(__dirname, '../tmp/roadmap-017-perf-capture');

function listJsonl(): string[] {
  if (!fs.existsSync(outDir)) return [];
  return fs.readdirSync(outDir).filter((f) => f.endsWith('.jsonl'));
}

function runScript(args: string[], env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('bash', [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 15000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

void test('capture-perf-baseline.sh --help prints usage and exits 0 without writing an output file', () => {
  const before = listJsonl();
  const r = runScript(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: capture-perf-baseline\.sh/);
  assert.match(r.stdout, /Env overrides: BACKEND_PORT, HOST, ENDPOINT, INTERVAL_S, DURATION_S\./);
  assert.deepEqual(listJsonl(), before, '--help must not create an output file');
});

void test('capture-perf-baseline.sh rejects non-numeric/non-positive --interval and --duration values', () => {
  const before = listJsonl();

  const badInterval = runScript(['--interval', 'abc']);
  assert.equal(badInterval.status, 1);
  assert.match(badInterval.stderr, /INTERVAL_S must be a positive integer \(got: abc\)/);

  const zeroDuration = runScript(['--duration', '0']);
  assert.equal(zeroDuration.status, 1);
  assert.match(zeroDuration.stderr, /DURATION_S must be a positive integer \(got: 0\)/);

  assert.deepEqual(listJsonl(), before, 'validation failures must not create an output file');
});

void test('capture-perf-baseline.sh rejects an unknown CLI argument', () => {
  const before = listJsonl();
  const r = runScript(['--bogus']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown argument: --bogus/);
  assert.match(r.stderr, /Usage: capture-perf-baseline\.sh/);
  assert.deepEqual(listJsonl(), before, 'an unknown argument must not create an output file');
});

void test('capture-perf-baseline.sh continues past curl failures and records an {capturedAt, error} line for an unreachable endpoint', () => {
  const before = new Set(listJsonl());
  const r = runScript([], {
    ENDPOINT: 'http://127.0.0.1:1/unreachable',
    INTERVAL_S: '1',
    DURATION_S: '1',
  });
  assert.equal(r.status, 0, `script should exit 0 even when every sample fails (stderr: ${r.stderr})`);
  assert.match(r.stdout, /WARN: sample failed/);

  const created = listJsonl().filter((f) => !before.has(f));
  assert.equal(created.length, 1, 'expected exactly one new run file');
  const createdFile = created[0];
  assert.ok(createdFile, 'expected the new run file to have a name');
  const outFile = path.join(outDir, createdFile);
  try {
    const lines = fs.readFileSync(outFile, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const firstLine = lines[0];
    assert.ok(firstLine, 'expected the sample line to be non-empty');
    const parsed = JSON.parse(firstLine) as Record<string, unknown>;
    assert.ok('capturedAt' in parsed, 'sample line must carry a capturedAt timestamp');
    assert.ok('error' in parsed, 'a sample against an unreachable endpoint must record an error field, not a response');
    assert.ok(!('response' in parsed), 'a failed sample must not also carry a response field');
  } finally {
    fs.unlinkSync(outFile);
  }
});
