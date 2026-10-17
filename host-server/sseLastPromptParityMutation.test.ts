// TASK-0222 / UAT-0222: proves sseLastPromptParity.test.ts is non-tautological.
// For each of the five lastPrompt occurrences in index.ts, a copy of the source with
// exactly that occurrence removed is run against a copy of the parity test; exactly
// the matching parity test must fail and the other tests must still pass. A control
// run on the unmutated source must be fully green.
import { test, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
const paritySource = fs.readFileSync(path.join(__dirname, 'sseLastPromptParity.test.ts'), 'utf8');

const TMP_ROOT = path.join(process.cwd(), 'tmp');
fs.mkdirSync(TMP_ROOT, { recursive: true });
const work = fs.mkdtempSync(path.join(TMP_ROOT, 'last-prompt-mutation-'));
after(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

const T_TYPE = 'the Snapshot inline agent type declares lastPrompt';
const T_BUILD = "buildSnapshot's returned per-agent object includes lastPrompt";
const T_REPLAY = 'the SSE connect replay (GET /events) includes lastPrompt in its agent-update payload';
const T_PERIODIC = "pollAndDiff's periodic broadcast includes lastPrompt";
const T_DELETE = 'the DELETE /agents/:id handler removes the hook sidecar';

/** Remove the n-th (0-based) occurrence of `needle`; asserts it exists. */
function removeNth(source: string, needle: string, n: number): string {
  let from = -1;
  for (let i = 0; i <= n; i++) {
    from = source.indexOf(needle, from + 1);
    assert.ok(from >= 0, `occurrence ${String(n)} of ${needle} not found`);
  }
  return source.slice(0, from) + source.slice(from + needle.length);
}

function runParity(name: string, mutatedIndex: string): { failed: string[]; passed: string[]; status: number | null } {
  const d = path.join(work, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'index.ts'), mutatedIndex);
  fs.writeFileSync(path.join(d, 'sseLastPromptParity.test.ts'), paritySource);
  // The runner marks its children with NODE_TEST_CONTEXT; a nested `node --test`
  // that inherits it reports over the parent's channel instead of stdout.
  const env = { ...process.env };
  delete env['NODE_TEST_CONTEXT'];
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', '--test', '--test-reporter=tap', path.join(d, 'sseLastPromptParity.test.ts')],
    { encoding: 'utf8', cwd: __dirname, timeout: 60_000, env },
  );
  const out = r.stdout;
  const failed = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => (m[1] ?? '').trim());
  const passed = [...out.matchAll(/^ok \d+ - (.+)$/gm)].map((m) => (m[1] ?? '').trim());
  return { failed, passed, status: r.status };
}

const ALL = [T_TYPE, T_BUILD, T_REPLAY, T_PERIODIC, T_DELETE];

void test('control: the unmutated source passes every parity test', () => {
  const r = runParity('control', indexSource);
  assert.equal(r.status, 0);
  assert.deepEqual(r.failed, []);
  for (const t of ALL) assert.ok(r.passed.includes(t), `control run should pass: ${t}`);
});

const mutations: Array<{ id: string; expectFail: string; mutate: (s: string) => string }> = [
  { id: 'type', expectFail: T_TYPE, mutate: (s) => removeNth(s, ' lastPrompt: LastPrompt | null;', 0) },
  { id: 'buildSnapshot', expectFail: T_BUILD, mutate: (s) => removeNth(s, '      lastPrompt,\n', 0) },
  { id: 'replay', expectFail: T_REPLAY, mutate: (s) => removeNth(s, 'lastPrompt: agent.lastPrompt,', 0) },
  { id: 'periodic', expectFail: T_PERIODIC, mutate: (s) => removeNth(s, 'lastPrompt: agent.lastPrompt,', 1) },
  { id: 'delete', expectFail: T_DELETE, mutate: (s) => removeNth(s, 'removeLastPromptSidecar(stateDir, winName);', 0) },
];

for (const m of mutations) {
  void test(`mutation: removing the ${m.id} occurrence fails exactly its own parity test`, () => {
    const r = runParity(m.id, m.mutate(indexSource));
    assert.notEqual(r.status, 0, 'the mutated run must fail');
    assert.deepEqual(r.failed, [m.expectFail]);
    for (const t of ALL.filter((x) => x !== m.expectFail)) {
      assert.ok(r.passed.includes(t), `unrelated test must still pass: ${t}`);
    }
  });
}
