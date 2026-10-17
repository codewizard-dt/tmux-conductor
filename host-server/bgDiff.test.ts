import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { bgStatusChanged, type DiffableBg } from './bgDiff.ts';

function bg(overrides: Partial<DiffableBg> = {}): DiffableBg {
  return {
    windowPresent: true,
    state: 'running',
    liveness: 'running',
    lastRestart: null,
    ...overrides,
  };
}

void test('no previous snapshot is a change (first sight)', () => {
  assert.equal(bgStatusChanged(undefined, bg()), true);
});

void test('identical statuses are not a change', () => {
  assert.equal(bgStatusChanged(bg(), bg()), false);
  const lr = { at: '2026-09-20T10:00:00.000Z', caller: 'proj-agent' };
  assert.equal(bgStatusChanged(bg({ lastRestart: { ...lr } }), bg({ lastRestart: { ...lr } })), false);
});

void test('windowPresent flips it', () => {
  assert.equal(bgStatusChanged(bg(), bg({ windowPresent: false })), true);
});

void test('state flips it', () => {
  assert.equal(bgStatusChanged(bg(), bg({ state: null })), true);
});

void test('liveness flips it', () => {
  assert.equal(bgStatusChanged(bg(), bg({ liveness: 'exited' })), true);
});

void test('null to non-null lastRestart flips it (and back)', () => {
  const lr = { at: '2026-09-20T10:00:00.000Z', caller: null };
  assert.equal(bgStatusChanged(bg({ lastRestart: null }), bg({ lastRestart: lr })), true);
  assert.equal(bgStatusChanged(bg({ lastRestart: lr }), bg({ lastRestart: null })), true);
});

void test('both lastRestart null or absent does not flip it', () => {
  assert.equal(bgStatusChanged(bg({ lastRestart: null }), bg({ lastRestart: null })), false);
  assert.equal(bgStatusChanged(bg({ lastRestart: undefined }), bg({ lastRestart: null })), false);
});

void test('lastRestart.at change flips it', () => {
  const a = { at: '2026-09-20T10:00:00.000Z', caller: 'proj-agent' };
  const b = { at: '2026-09-20T10:05:00.000Z', caller: 'proj-agent' };
  assert.equal(bgStatusChanged(bg({ lastRestart: a }), bg({ lastRestart: b })), true);
});

void test('lastRestart.caller change flips it (agent to dashboard)', () => {
  const at = '2026-09-20T10:00:00.000Z';
  assert.equal(
    bgStatusChanged(bg({ lastRestart: { at, caller: 'proj-agent' } }), bg({ lastRestart: { at, caller: null } })),
    true,
  );
});

// index.ts has top-level side effects and cannot be imported in a unit test, so the
// pollAndDiff wiring is pinned via source text (same precedent as bgRestartPolicy.test.ts).
void test('index.ts pollAndDiff broadcasts bg-update through bgStatusChanged, not an inline field comparison', () => {
  const indexSource = fs.readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(indexSource, /import \{ bgStatusChanged \} from '\.\/bgDiff\.ts'/);
  assert.match(
    indexSource,
    /if \(bgStatusChanged\(prev, bg\)\) \{\s*broadcastSSE\('bg-update', bg\);\s*\}/,
  );
});
