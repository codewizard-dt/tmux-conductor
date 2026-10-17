import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BG_CALLER_MAX_LENGTH,
  BG_RESTARTS_LOG_FILE,
  BG_RESTARTS_TAIL_BYTES,
  RestartHistory,
  appendAuditRecord,
  buildAuditRecord,
  callerKindFor,
  clearRestartHistoryCache,
  evaluateCooldown,
  getRestartHistory,
  parseCallerHeader,
  readLogTail,
  type AuditDeps,
  type BgRestartAuditRecord,
} from './bgRestartPolicy.ts';

// TASK-0193 Step 4. Hermetic: injected fakes and explicit epoch-ms clocks; the
// only real filesystem use is one small fixture under the repo-local ./tmp/.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse('2026-09-20T12:00:00.000Z');
const COOLDOWN_MS = 60_000;

function jsonl(...records: Array<Record<string, unknown>>): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

function rec(bg: string, outcome: string, tsMs: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ts: new Date(tsMs).toISOString(), bg, callerKind: 'agent', caller: 'agent-a', outcome, ...extra };
}

function historyOver(text: string | null): { history: RestartHistory; reads: string[] } {
  const reads: string[] = [];
  const history = new RestartHistory({
    logPath: '/fake/logs/bg-restarts.jsonl',
    readTail: (p) => {
      reads.push(p);
      return text;
    },
  });
  return { history, reads };
}

// ---------------------------------------------------------------- header parsing

void test('parseCallerHeader: undefined, empty, whitespace-only and non-string values yield null', () => {
  assert.equal(parseCallerHeader(undefined), null);
  assert.equal(parseCallerHeader(''), null);
  assert.equal(parseCallerHeader('   \t  '), null);
  assert.equal(parseCallerHeader(42), null);
  assert.equal(parseCallerHeader({}), null);
  assert.equal(parseCallerHeader([]), null);
});

void test('parseCallerHeader: trims and returns the value verbatim otherwise', () => {
  assert.equal(parseCallerHeader('  my-agent  '), 'my-agent');
  assert.equal(parseCallerHeader('Agent With Spaces'), 'Agent With Spaces');
});

void test('parseCallerHeader: repeated header (array) uses the first element', () => {
  assert.equal(parseCallerHeader(['first', 'second']), 'first');
  assert.equal(parseCallerHeader(['', 'second']), null);
});

void test('parseCallerHeader: strips control characters (incl. CR/LF/NUL/DEL) and yields null if nothing remains', () => {
  assert.equal(parseCallerHeader('ab\r\ncd'), 'abcd');
  assert.equal(parseCallerHeader('a\u0000b\u007fc\u009fd'), 'abcd');
  assert.equal(parseCallerHeader('\u0001\u0002\n'), null);
});

void test('parseCallerHeader: caps oversized values at BG_CALLER_MAX_LENGTH', () => {
  const long = 'x'.repeat(BG_CALLER_MAX_LENGTH + 500);
  const out = parseCallerHeader(long);
  assert.equal(out?.length, BG_CALLER_MAX_LENGTH);
  const exact = 'y'.repeat(BG_CALLER_MAX_LENGTH);
  assert.equal(parseCallerHeader(exact), exact);
});

void test('parseCallerHeader: re-trims after truncation so no trailing space survives', () => {
  const v = 'a'.repeat(BG_CALLER_MAX_LENGTH - 1) + ' ' + 'b'.repeat(10);
  const out = parseCallerHeader(v);
  assert.equal(out, 'a'.repeat(BG_CALLER_MAX_LENGTH - 1));
});

void test('callerKindFor: null caller is dashboard, any identity is agent', () => {
  assert.equal(callerKindFor(null), 'dashboard');
  assert.equal(callerKindFor('agent-a'), 'agent');
});

// ---------------------------------------------------------------- evaluateCooldown

void test('evaluateCooldown: agent inside the cooldown is rejected with correct retryAfterS', () => {
  const d = evaluateCooldown({ now: T0 + 15_000, lastRestartAt: T0, cooldownMs: COOLDOWN_MS, callerKind: 'agent' });
  assert.deepEqual(d, { allowed: false, retryAfterS: 45, cooldownRemainingS: 45 });
});

void test('evaluateCooldown: agent after the cooldown is allowed', () => {
  const d = evaluateCooldown({ now: T0 + COOLDOWN_MS + 5_000, lastRestartAt: T0, cooldownMs: COOLDOWN_MS, callerKind: 'agent' });
  assert.deepEqual(d, { allowed: true });
});

void test('evaluateCooldown: boundary - exactly at cooldownMs allowed, 1ms before rejected', () => {
  assert.deepEqual(evaluateCooldown({ now: T0 + COOLDOWN_MS, lastRestartAt: T0, cooldownMs: COOLDOWN_MS, callerKind: 'agent' }), {
    allowed: true,
  });
  const d = evaluateCooldown({ now: T0 + COOLDOWN_MS - 1, lastRestartAt: T0, cooldownMs: COOLDOWN_MS, callerKind: 'agent' });
  assert.equal(d.allowed, false);
});

void test('evaluateCooldown: retryAfterS is ceil of remaining seconds with a minimum of 1', () => {
  const at = (elapsedMs: number) => {
    const d = evaluateCooldown({ now: T0 + elapsedMs, lastRestartAt: T0, cooldownMs: COOLDOWN_MS, callerKind: 'agent' });
    assert.equal(d.allowed, false);
    return d.retryAfterS;
  };
  assert.equal(at(0), 60);
  assert.equal(at(1), 60); // 59.999s -> 60
  assert.equal(at(500), 60); // 59.5s -> 60
  assert.equal(at(1_000), 59);
  assert.equal(at(1_001), 59); // 58.999s -> 59
  assert.equal(at(COOLDOWN_MS - 1), 1); // 1ms remaining -> min 1
  assert.equal(at(COOLDOWN_MS - 999), 1);
});

void test('evaluateCooldown: cooldownMs <= 0 disables the cooldown', () => {
  for (const cooldownMs of [0, -1, -60_000]) {
    assert.deepEqual(evaluateCooldown({ now: T0, lastRestartAt: T0, cooldownMs, callerKind: 'agent' }), { allowed: true });
  }
  assert.deepEqual(evaluateCooldown({ now: T0, lastRestartAt: T0, cooldownMs: Number.NaN, callerKind: 'agent' }), { allowed: true });
});

void test('evaluateCooldown: dashboard caller is exempt inside the cooldown', () => {
  const d = evaluateCooldown({ now: T0 + 1_000, lastRestartAt: T0, cooldownMs: COOLDOWN_MS, callerKind: 'dashboard' });
  assert.deepEqual(d, { allowed: true });
});

void test('evaluateCooldown: never-restarted (null / undefined) is allowed', () => {
  assert.deepEqual(evaluateCooldown({ now: T0, lastRestartAt: null, cooldownMs: COOLDOWN_MS, callerKind: 'agent' }), { allowed: true });
  assert.deepEqual(evaluateCooldown({ now: T0, lastRestartAt: undefined, cooldownMs: COOLDOWN_MS, callerKind: 'agent' }), {
    allowed: true,
  });
});

void test('cooldown applies across different agent callers (a restart by any caller arms it for every agent)', () => {
  const { history } = historyOver(null);
  history.recordSuccess('proj-web', T0, 'agent-a');
  // agent-b is a different caller but the cooldown is per bg process, not per caller.
  const last = history.last('proj-web');
  const d = evaluateCooldown({ now: T0 + 10_000, lastRestartAt: last?.at, cooldownMs: COOLDOWN_MS, callerKind: callerKindFor('agent-b') });
  assert.equal(d.allowed, false);
  // A dashboard restart also arms it for agents.
  history.recordSuccess('proj-api', T0, null);
  const d2 = evaluateCooldown({
    now: T0 + 10_000,
    lastRestartAt: history.last('proj-api')?.at,
    cooldownMs: COOLDOWN_MS,
    callerKind: 'agent',
  });
  assert.equal(d2.allowed, false);
  // Cooldown is per bg: a different bg is unaffected.
  const d3 = evaluateCooldown({
    now: T0 + 10_000,
    lastRestartAt: history.last('proj-other')?.at,
    cooldownMs: COOLDOWN_MS,
    callerKind: 'agent',
  });
  assert.equal(d3.allowed, true);
});

// ---------------------------------------------------------------- RestartHistory

void test('failed restart does not arm the cooldown: only failed/cooldown/denied lines => last() null and evaluateCooldown allows', () => {
  const text = jsonl(rec('proj-web', 'failed', T0), rec('proj-web', 'cooldown', T0 + 1_000), rec('proj-web', 'denied', T0 + 2_000));
  const { history } = historyOver(text);
  assert.equal(history.last('proj-web'), null);
  assert.equal(history.lastRestart('proj-web'), null);
  const d = evaluateCooldown({ now: T0 + 3_000, lastRestartAt: history.last('proj-web')?.at, cooldownMs: COOLDOWN_MS, callerKind: 'agent' });
  assert.deepEqual(d, { allowed: true });
});

void test('seeding keeps the latest restarted ts per bg and ignores other outcomes', () => {
  const text = jsonl(
    rec('proj-web', 'restarted', T0),
    rec('proj-web', 'restarted', T0 + 30_000, { caller: 'agent-b' }),
    rec('proj-web', 'failed', T0 + 90_000),
    rec('proj-web', 'cooldown', T0 + 95_000),
    rec('proj-api', 'restarted', T0 + 5_000, { caller: null, callerKind: 'dashboard' }),
  );
  const { history } = historyOver(text);
  assert.deepEqual(history.last('proj-web'), { at: T0 + 30_000, caller: 'agent-b' });
  assert.deepEqual(history.last('proj-api'), { at: T0 + 5_000, caller: null });
  assert.equal(history.last('proj-none'), null);
});

void test('seeding keeps the latest restarted ts even when lines are out of order', () => {
  const text = jsonl(rec('proj-web', 'restarted', T0 + 30_000, { caller: 'late' }), rec('proj-web', 'restarted', T0, { caller: 'early' }));
  const { history } = historyOver(text);
  assert.deepEqual(history.last('proj-web'), { at: T0 + 30_000, caller: 'late' });
});

void test('lazy seeding happens once: readTail called exactly once across multiple accesses, and not at construction', () => {
  const { history, reads } = historyOver(jsonl(rec('proj-web', 'restarted', T0)));
  assert.equal(reads.length, 0);
  history.last('proj-web');
  history.last('proj-api');
  history.lastRestart('proj-web');
  history.recordSuccess('proj-x', T0, null);
  assert.equal(reads.length, 1);
  assert.deepEqual(reads, ['/fake/logs/bg-restarts.jsonl']);
});

void test('recordSuccess after seeding overrides the seeded value, and lastRestart returns an ISO string', () => {
  const { history } = historyOver(jsonl(rec('proj-web', 'restarted', T0)));
  history.recordSuccess('proj-web', T0 + 120_000, 'agent-z');
  assert.deepEqual(history.last('proj-web'), { at: T0 + 120_000, caller: 'agent-z' });
  assert.deepEqual(history.lastRestart('proj-web'), { at: new Date(T0 + 120_000).toISOString(), caller: 'agent-z' });
});

void test('history reseeded from a fixture after a simulated module restart: cooldown survives', () => {
  const text = jsonl(rec('proj-web', 'restarted', T0, { caller: 'agent-a' }));
  const first = historyOver(text).history;
  assert.deepEqual(first.last('proj-web'), { at: T0, caller: 'agent-a' });
  // "Restart": a brand-new instance over the same on-disk text.
  const second = historyOver(text).history;
  const last = second.last('proj-web');
  assert.deepEqual(last, { at: T0, caller: 'agent-a' });
  const d = evaluateCooldown({ now: T0 + 20_000, lastRestartAt: last.at, cooldownMs: COOLDOWN_MS, callerKind: 'agent' });
  assert.deepEqual(d, { allowed: false, retryAfterS: 40, cooldownRemainingS: 40 });
});

void test('malformed JSONL lines are skipped without aborting seeding', () => {
  const good = JSON.stringify(rec('proj-web', 'restarted', T0));
  const text = [
    '{not json',
    '',
    '   ',
    'null',
    '[1,2,3]',
    '"a string"',
    '42',
    JSON.stringify({ outcome: 'restarted', ts: new Date(T0).toISOString() }), // no bg
    JSON.stringify({ outcome: 'restarted', bg: 'x' }), // no ts
    JSON.stringify({ outcome: 'restarted', bg: 'x', ts: 'not-a-date' }),
    JSON.stringify({ outcome: 'restarted', bg: 7, ts: new Date(T0).toISOString() }),
    good,
    '{"truncated": ',
  ].join('\n');
  const { history } = historyOver(text);
  assert.deepEqual(history.last('proj-web'), { at: T0, caller: 'agent-a' });
  assert.equal(history.last('x'), null);
});

void test('a non-string caller in a seeded restarted line is recorded as null', () => {
  const { history } = historyOver(jsonl({ ts: new Date(T0).toISOString(), bg: 'proj-web', outcome: 'restarted', caller: 7 }));
  assert.deepEqual(history.last('proj-web'), { at: T0, caller: null });
});

void test('missing log (readTail null), throwing reader, or no logPath all seed nothing', () => {
  assert.equal(historyOver(null).history.last('proj-web'), null);
  const throwing = new RestartHistory({
    logPath: '/fake/x.jsonl',
    readTail: () => {
      throw new Error('boom');
    },
  });
  assert.equal(throwing.last('proj-web'), null);
  let called = false;
  const noPath = new RestartHistory({
    readTail: () => {
      called = true;
      return jsonl(rec('proj-web', 'restarted', T0));
    },
  });
  assert.equal(noPath.last('proj-web'), null);
  assert.equal(called, false);
});

// ---------------------------------------------------------------- audit records

void test('buildAuditRecord: required fields only; undefined optional keys are omitted', () => {
  const r = buildAuditRecord({ ts: T0, bg: 'proj-web', callerKind: 'agent', caller: 'agent-a', outcome: 'restarted' });
  assert.deepEqual(r, {
    ts: '2026-09-20T12:00:00.000Z',
    bg: 'proj-web',
    callerKind: 'agent',
    caller: 'agent-a',
    outcome: 'restarted',
  });
  for (const key of ['cooldownRemainingS', 'mechanism', 'step', 'status']) {
    assert.equal(Object.prototype.hasOwnProperty.call(r, key), false, `${key} must be omitted`);
  }
});

void test('buildAuditRecord: ts is an ISO string from a number or a Date; caller null is preserved', () => {
  const fromNumber = buildAuditRecord({ ts: T0, bg: 'b', callerKind: 'dashboard', caller: null, outcome: 'restarted' });
  const fromDate = buildAuditRecord({ ts: new Date(T0), bg: 'b', callerKind: 'dashboard', caller: null, outcome: 'restarted' });
  assert.equal(fromNumber.ts, '2026-09-20T12:00:00.000Z');
  assert.equal(fromDate.ts, fromNumber.ts);
  assert.equal(fromNumber.caller, null);
  assert.ok(Object.prototype.hasOwnProperty.call(fromNumber, 'caller'));
});

void test('buildAuditRecord: optional fields are included when supplied (0 counts as supplied) and the record round-trips through JSON', () => {
  const r = buildAuditRecord({
    ts: T0,
    bg: 'proj-web',
    callerKind: 'agent',
    caller: 'agent-a',
    outcome: 'cooldown',
    cooldownRemainingS: 0,
    mechanism: 'tmux-respawn',
    step: 'respawn-window',
    status: 429,
  });
  assert.equal(r.cooldownRemainingS, 0);
  assert.equal(r.mechanism, 'tmux-respawn');
  assert.equal(r.step, 'respawn-window');
  assert.equal(r.status, 429);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

void test("buildAuditRecord: 'denied' outcome is accepted", () => {
  const r = buildAuditRecord({ ts: T0, bg: 'proj-web', callerKind: 'agent', caller: 'agent-a', outcome: 'denied', status: 403 });
  assert.equal(r.outcome, 'denied');
  assert.equal(r.status, 403);
});

// ---------------------------------------------------------------- appendAuditRecord

interface AuditHarness {
  deps: AuditDeps;
  events: Array<{ kind: 'mkdir'; dir: string } | { kind: 'append'; file: string; text: string }>;
}

function auditHarness(opts: { appendThrows?: boolean; mkdirThrows?: boolean } = {}): AuditHarness {
  const events: AuditHarness['events'] = [];
  return {
    events,
    deps: {
      mkdir: (dir) => {
        events.push({ kind: 'mkdir', dir });
        if (opts.mkdirThrows) throw new Error('mkdir failed');
      },
      appendFile: (file, text) => {
        if (opts.appendThrows) throw new Error('disk full');
        events.push({ kind: 'append', file, text });
      },
    },
  };
}

const SAMPLE: BgRestartAuditRecord = buildAuditRecord({
  ts: T0,
  bg: 'proj-web',
  callerKind: 'agent',
  caller: 'agent-a',
  outcome: 'restarted',
  mechanism: 'tmux-respawn',
});

void test('appendAuditRecord: mkdirs the log dir first, then appends one newline-terminated valid JSON line to <logDir>/bg-restarts.jsonl', () => {
  const { deps, events } = auditHarness();
  const ok = appendAuditRecord(deps, '/fake/logs', SAMPLE);
  assert.equal(ok, true);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { kind: 'mkdir', dir: '/fake/logs' });
  const append = events[1];
  assert.ok(append && append.kind === 'append');
  assert.equal(append.file, path.join('/fake/logs', BG_RESTARTS_LOG_FILE));
  assert.equal(BG_RESTARTS_LOG_FILE, 'bg-restarts.jsonl');
  assert.ok(append.text.endsWith('\n'));
  assert.equal(append.text.indexOf('\n'), append.text.length - 1, 'exactly one line');
  assert.deepEqual(JSON.parse(append.text), SAMPLE);
});

void test('appendAuditRecord: returns false and does not throw when appendFile throws', () => {
  const { deps } = auditHarness({ appendThrows: true });
  let result: boolean | undefined;
  assert.doesNotThrow(() => {
    result = appendAuditRecord(deps, '/fake/logs', SAMPLE);
  });
  assert.equal(result, false);
});

void test('appendAuditRecord: returns false and does not throw when mkdir throws (and skips the append)', () => {
  const { deps, events } = auditHarness({ mkdirThrows: true });
  assert.equal(appendAuditRecord(deps, '/fake/logs', SAMPLE), false);
  assert.equal(events.filter((e) => e.kind === 'append').length, 0);
});

void test('appendAuditRecord output seeds RestartHistory: appended restarted lines round-trip', () => {
  const { deps, events } = auditHarness();
  appendAuditRecord(deps, '/fake/logs', SAMPLE);
  appendAuditRecord(
    deps,
    '/fake/logs',
    buildAuditRecord({ ts: T0 + 1_000, bg: 'proj-web', callerKind: 'agent', caller: 'agent-a', outcome: 'cooldown', cooldownRemainingS: 59 }),
  );
  const text = events.map((e) => (e.kind === 'append' ? e.text : '')).join('');
  const { history } = historyOver(text);
  assert.deepEqual(history.last('proj-web'), { at: T0, caller: 'agent-a' });
});

// ---------------------------------------------------------------- getRestartHistory cache

void test('getRestartHistory: same instance for the same logDir, different instance for another', () => {
  clearRestartHistoryCache();
  try {
    const a1 = getRestartHistory('/fake/logs-a');
    const a2 = getRestartHistory('/fake/logs-a');
    const b = getRestartHistory('/fake/logs-b');
    assert.equal(a1, a2);
    assert.notEqual(a1, b);
    clearRestartHistoryCache();
    assert.notEqual(getRestartHistory('/fake/logs-a'), a1);
  } finally {
    clearRestartHistoryCache();
  }
});

// ---------------------------------------------------------------- real default reader

void test('readLogTail (real fs): null for a missing file; large files drop the partial first line and still parse', () => {
  const tmpRoot = path.join(__dirname, '..', 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'bgRestartPolicy-test-'));
  try {
    assert.equal(readLogTail(path.join(dir, 'nope.jsonl')), null);

    // Small file: returned whole, including the first line.
    const small = path.join(dir, 'small.jsonl');
    fs.writeFileSync(small, jsonl(rec('proj-web', 'restarted', T0)));
    assert.equal(readLogTail(small), jsonl(rec('proj-web', 'restarted', T0)));

    // Large file: padding lines push the early record out of the tail window.
    const big = path.join(dir, 'big.jsonl');
    const early = jsonl(rec('proj-early', 'restarted', T0));
    const pad = jsonl(rec('proj-pad', 'failed', T0, { pad: 'p'.repeat(1_000) }));
    const lastRestart = jsonl(rec('proj-web', 'restarted', T0 + 60_000, { caller: 'agent-tail' }));
    const padCount = Math.ceil(BG_RESTARTS_TAIL_BYTES / pad.length) + 5;
    fs.writeFileSync(big, early + pad.repeat(padCount) + lastRestart);
    assert.ok(fs.statSync(big).size > BG_RESTARTS_TAIL_BYTES);

    const tail = readLogTail(big);
    assert.ok(tail !== null);
    assert.ok(tail.length <= BG_RESTARTS_TAIL_BYTES);
    assert.ok(tail.startsWith('{'), 'partial first line must be dropped');
    assert.ok(tail.endsWith(lastRestart));

    const history = new RestartHistory({ logPath: big });
    assert.deepEqual(history.last('proj-web'), { at: T0 + 60_000, caller: 'agent-tail' });
    assert.equal(history.last('proj-early'), null, 'record outside the tail window is not seeded');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- route wiring (static pin)

// index.ts has top-level side effects and cannot be imported in a unit test;
// see transitionsLog.test.ts for the precedent of pinning wiring via source text.
const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

void test('index.ts wires the restart route to the policy module: 429 restart cooldown, Retry-After, audit + shared history', () => {
  assert.match(indexSource, /from '\.\/bgRestartPolicy\.ts'/);
  assert.match(indexSource, /getRestartHistory\(/);
  assert.match(indexSource, /appendAuditRecord\(/);
  assert.match(indexSource, /evaluateCooldown\(/);
  assert.match(indexSource, /reply\.header\(\s*'Retry-After'/);
  assert.match(indexSource, /status\(\s*429\s*\)/);
  assert.match(indexSource, /error:\s*'restart cooldown'/);
});

void test('index.ts leaves the TASK-0194 marker where the same-project guard goes', () => {
  assert.match(indexSource, /TASK-0194/);
});
