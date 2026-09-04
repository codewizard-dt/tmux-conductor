import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { LIVE_UPDATE_PERF_BUDGETS } from './perfBudgets.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const perfBudgetsSource = fs.readFileSync(path.join(__dirname, 'perfBudgets.ts'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

// TASK-118: the five LIVE_UPDATE_PERF_BUDGETS values were calibrated from
// TASK-117's captured ~2h real-usage baseline (708 samples), replacing the
// "intentionally conservative" placeholders. Pin the calibrated numbers so a
// future edit can't silently drift back toward placeholder values without a
// test noticing.
void test('LIVE_UPDATE_PERF_BUDGETS holds the TASK-118-calibrated values', () => {
  assert.deepEqual(LIVE_UPDATE_PERF_BUDGETS, {
    maxStatusTickMs: 150,
    maxTerminalTickMs: 50,
    maxFocusedTerminalTickMs: 15,
    maxCaptureCallsPerAgentPerStatusInterval: 1,
    maxDashboardSseConnections: 1,
  });
});

// perfBudgets.ts's header comment used to say "intentionally conservative
// until a representative local baseline is captured" — TASK-118 replaced
// that with the capture window's provenance. Assert both directions: the
// old placeholder language is gone, and the new provenance (capture dates,
// sample count, TASK-117/TASK-118 pointers) is present.
void test("perfBudgets.ts's header comment documents the TASK-117 capture window and cites TASK-117/TASK-118 instead of the old placeholder language", () => {
  assert.doesNotMatch(
    perfBudgetsSource,
    /intentionally conservative until a representative local baseline is captured/,
    'expected the old placeholder language to be replaced',
  );
  assert.match(perfBudgetsSource, /TASK-117/, 'expected the header comment to cite TASK-117');
  assert.match(perfBudgetsSource, /TASK-118/, 'expected the header comment to cite TASK-118');
  assert.match(perfBudgetsSource, /708 samples/, 'expected the header comment to cite the captured sample count');
  assert.match(perfBudgetsSource, /2026-09-02T05:10:04Z/, 'expected the header comment to cite the capture window start timestamp');
});

// The Approach section explicitly calls for preserving maxFocusedTerminalTickMs's
// relative tightness (an order of magnitude tighter than the other two budgets)
// unless the captured data clearly contradicted it — it didn't. Pin the
// ordering invariant, not just the absolute numbers, so a future recalibration
// that keeps the absolute numbers "reasonable" in isolation can't quietly
// collapse the intentional gap between focused-terminal and the other budgets.
void test('maxFocusedTerminalTickMs stays tighter than maxTerminalTickMs, which stays tighter than maxStatusTickMs', () => {
  // Widen to `number` (not the `as const` literal types) so this comparison is a
  // genuine runtime regression check, not a tautology TypeScript can resolve statically.
  const focusedMs: number = LIVE_UPDATE_PERF_BUDGETS.maxFocusedTerminalTickMs;
  const terminalMs: number = LIVE_UPDATE_PERF_BUDGETS.maxTerminalTickMs;
  const statusMs: number = LIVE_UPDATE_PERF_BUDGETS.maxStatusTickMs;
  assert.ok(
    focusedMs < terminalMs,
    'maxFocusedTerminalTickMs should be tighter than maxTerminalTickMs',
  );
  assert.ok(
    terminalMs < statusMs,
    'maxTerminalTickMs should be tighter than maxStatusTickMs',
  );
});

// TASK-118 wired the three startManagedLoop call sites that used to hardcode
// matching-by-coincidence `warnAfterMs` literals to import LIVE_UPDATE_PERF_BUDGETS
// from perfBudgets.ts instead, so future recalibrations only require editing
// perfBudgets.ts. Assert the import exists and each of the three loops
// references the budget constant rather than a bare numeric literal.
void test("index.ts's status/tail/focused-tail poll loops reference LIVE_UPDATE_PERF_BUDGETS instead of hardcoded warnAfterMs literals", () => {
  assert.match(
    indexSource,
    /import \{ LIVE_UPDATE_PERF_BUDGETS \} from '\.\/perfBudgets\.ts';/,
    "expected index.ts to import LIVE_UPDATE_PERF_BUDGETS from './perfBudgets.ts'",
  );

  const statusPollLine = indexSource.split('\n').find((l) => l.includes("startManagedLoop('status poll'"));
  const tailPollLine = indexSource.split('\n').find((l) => l.includes("startManagedLoop('tail poll'"));
  const focusedTailPollLine = indexSource.split('\n').find((l) => l.includes("startManagedLoop('focused tail poll'"));

  assert.ok(statusPollLine, "expected to find the 'status poll' startManagedLoop call site");
  assert.ok(tailPollLine, "expected to find the 'tail poll' startManagedLoop call site");
  assert.ok(focusedTailPollLine, "expected to find the 'focused tail poll' startManagedLoop call site");

  assert.match(statusPollLine, /warnAfterMs: LIVE_UPDATE_PERF_BUDGETS\.maxStatusTickMs/, "'status poll' should reference LIVE_UPDATE_PERF_BUDGETS.maxStatusTickMs");
  assert.match(tailPollLine, /warnAfterMs: LIVE_UPDATE_PERF_BUDGETS\.maxTerminalTickMs/, "'tail poll' should reference LIVE_UPDATE_PERF_BUDGETS.maxTerminalTickMs");
  assert.match(focusedTailPollLine, /warnAfterMs: LIVE_UPDATE_PERF_BUDGETS\.maxFocusedTerminalTickMs/, "'focused tail poll' should reference LIVE_UPDATE_PERF_BUDGETS.maxFocusedTerminalTickMs");

  assert.doesNotMatch(statusPollLine, /warnAfterMs: 1500/, "'status poll' should no longer hardcode warnAfterMs: 1500");
  assert.doesNotMatch(tailPollLine, /warnAfterMs: 1500/, "'tail poll' should no longer hardcode warnAfterMs: 1500");
  assert.doesNotMatch(focusedTailPollLine, /warnAfterMs: 150\b/, "'focused tail poll' should no longer hardcode warnAfterMs: 150");
});
