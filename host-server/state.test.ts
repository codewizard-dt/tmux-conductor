import { test, describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConductorConf, clearConfCache, DEFAULT_CONF_PATH, type ConductorConf } from './config.ts';
import { detectAgentStatus, detectAgentStatusWithBackgroundJobs, awaitingWindow, windowTarget, isTmuxWindowPresent, capturePaneTail } from './state.ts';
import { sendTextToPane, sendDispatchToPane } from './state.ts';
import { bgLiveness, BG_STARTUP_GRACE_MS, readTmuxWindowInventory } from './state.ts';

// TASK-142: detectAgentStatus's return type was widened from a bare
// AgentRunState string to { state, reason, matchedPattern? }, set at every
// existing return site without changing the resolved `state` value or any
// detection logic. These tests pin the exact reason/matchedPattern mapping
// for all 18 return sites (per raw/research/detect-agent-status-reason-mapping/
// index.md), grouped by the top-level branch each site lives in.
//
// Every case below passes an explicit, non-empty `precapturedTail` and
// explicit `windowPresent`/`paneCurrentCommand` values so detectAgentStatus
// never has to shell out to a real tmux session — the one exception is the
// "starting" case, which deliberately wants an empty tail and relies on
// capturePaneTail() returning '' for a tmux target that does not exist (a
// fake, randomized session name makes that safe even on a machine with a
// live tmux-conductor session running).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(__dirname, '../tmp');

function makeStateDir(label: string): string {
  fs.mkdirSync(tmpDir, { recursive: true });
  const rand = Math.random().toString(36).slice(2, 10);
  return fs.mkdtempSync(path.join(tmpDir, `detect-agent-status-${label}-${rand}-`));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function baseConf(stateDir: string, overrides: Partial<ConductorConf> = {}): ConductorConf {
  clearConfCache();
  return {
    ...readConductorConf(DEFAULT_CONF_PATH),
    stateDir,
    sessionName: 'uat142-detect-status-fixture',
    pollInterval: 15,
    stallTimeout: 300,
    ...overrides,
  };
}

function writeState(stateDir: string, windowName: string, value: string, ageMs = 0): void {
  const p = path.join(stateDir, `${windowName}.state`);
  fs.writeFileSync(p, value);
  if (ageMs > 0) {
    const past = new Date(Date.now() - ageMs);
    fs.utimesSync(p, past, past);
  }
}

// ── Branch 1: window absent ──────────────────────────────────────────────

void test('detectAgentStatus: no-window when the tmux window is absent (site 1)', () => {
  const dir = makeStateDir('no-window');
  try {
    const conf = baseConf(dir);
    const result = detectAgentStatus(conf, 'agent-x', 'claude', undefined, false, null);
    assert.deepEqual(result, { state: 'no-window', reason: 'no-window' });
  } finally {
    cleanup(dir);
  }
});

// ── Branch 2: pane fell back to a shell ──────────────────────────────────

void test('detectAgentStatus: exited when the pane fell back to a plain shell (site 2)', () => {
  const dir = makeStateDir('exited');
  try {
    const conf = baseConf(dir);
    const result = detectAgentStatus(conf, 'agent-x', 'claude', undefined, true, 'zsh');
    assert.deepEqual(result, { state: 'exited', reason: 'exited' });
  } finally {
    cleanup(dir);
  }
});

// ── Branch 3: hook-written 'busy' state file ─────────────────────────────

void test('detectAgentStatus: busy state-file with the busy pattern visible is an unmodified fallthrough (site 8)', () => {
  const dir = makeStateDir('busy-fallthrough');
  try {
    const conf = baseConf(dir);
    writeState(dir, 'agent-x', 'busy');
    const result = detectAgentStatus(conf, 'agent-x', 'claude', 'esc to interrupt', true, 'claude');
    assert.deepEqual(result, { state: 'busy', reason: 'state-file', matchedPattern: 'busy' });
  } finally {
    cleanup(dir);
  }
});

void test('detectAgentStatus: busy state-file with an open dialog is reported awaiting (site 4)', () => {
  const dir = makeStateDir('busy-awaiting');
  try {
    const conf = baseConf(dir);
    writeState(dir, 'agent-x', 'busy');
    const result = detectAgentStatus(conf, 'agent-x', 'claude', 'Enter to select · Esc to cancel', true, 'claude');
    assert.deepEqual(result, { state: 'awaiting', reason: 'awaiting-pattern', matchedPattern: 'awaiting' });
  } finally {
    cleanup(dir);
  }
});

void test('detectAgentStatus: codex safety net recovers an old busy file to idle (site 5)', () => {
  const dir = makeStateDir('codex-recovered');
  try {
    const conf = baseConf(dir, { pollInterval: 1 });
    writeState(dir, 'agent-x', 'busy', 10_000);
    const result = detectAgentStatus(conf, 'agent-x', 'codex', 'codex>', true, 'codex');
    assert.deepEqual(result, { state: 'idle', reason: 'busy-recovered', matchedPattern: 'idle' });
  } finally {
    cleanup(dir);
  }
});

void test('detectAgentStatus: hook-failure safety net recovers an old busy file to idle for non-codex agents (site 6)', () => {
  const dir = makeStateDir('hook-failure-recovered');
  try {
    const conf = baseConf(dir, { pollInterval: 1 });
    writeState(dir, 'agent-x', 'busy', 10_000);
    const result = detectAgentStatus(conf, 'agent-x', 'claude', 'accept edits on (shift+tab to cycle)', true, 'claude');
    assert.deepEqual(result, { state: 'idle', reason: 'busy-recovered', matchedPattern: 'idle' });
  } finally {
    cleanup(dir);
  }
});

void test('detectAgentStatus: an old busy file matching no pattern at all is reported stalled (site 7)', () => {
  const dir = makeStateDir('stalled');
  try {
    const conf = baseConf(dir, { stallTimeout: 1 });
    writeState(dir, 'agent-x', 'busy', 5_000);
    const result = detectAgentStatus(conf, 'agent-x', 'claude', 'nothing recognizable here', true, 'claude');
    assert.deepEqual(result, { state: 'stalled', reason: 'inventory-timeout' });
  } finally {
    cleanup(dir);
  }
});

// ── Branch 3 continued: hook-written 'awaiting' state file ───────────────

void test("detectAgentStatus: awaiting state-file reverts to busy once the dialog is gone (site 9)", () => {
  const dir = makeStateDir('awaiting-gone');
  try {
    const conf = baseConf(dir);
    writeState(dir, 'agent-x', 'awaiting');
    const result = detectAgentStatus(conf, 'agent-x', 'claude', 'just some ordinary output', true, 'claude');
    assert.equal(result.state, 'busy');
    assert.equal(result.reason, 'state-file');
    assert.equal(result.matchedPattern, undefined);
  } finally {
    cleanup(dir);
  }
});

void test('detectAgentStatus: awaiting state-file persists while the dialog is still open (site 10)', () => {
  const dir = makeStateDir('awaiting-persists');
  try {
    const conf = baseConf(dir);
    writeState(dir, 'agent-x', 'awaiting');
    const result = detectAgentStatus(conf, 'agent-x', 'claude', 'Enter to select · Esc to cancel', true, 'claude');
    assert.deepEqual(result, { state: 'awaiting', reason: 'state-file', matchedPattern: 'awaiting' });
  } finally {
    cleanup(dir);
  }
});

// ── Branch 3 continued: hook-written 'idle' state file ───────────────────

void test('detectAgentStatus: idle state-file is overridden to busy when the busy pattern is visible (site 11)', () => {
  const dir = makeStateDir('idle-to-busy');
  try {
    const conf = baseConf(dir);
    writeState(dir, 'agent-x', 'idle');
    const result = detectAgentStatus(conf, 'agent-x', 'claude', 'esc to interrupt', true, 'claude');
    assert.deepEqual(result, { state: 'busy', reason: 'state-file', matchedPattern: 'busy' });
  } finally {
    cleanup(dir);
  }
});

void test('detectAgentStatus: idle state-file is overridden to awaiting when a dialog is visible (site 12)', () => {
  const dir = makeStateDir('idle-to-awaiting');
  try {
    const conf = baseConf(dir);
    writeState(dir, 'agent-x', 'idle');
    const result = detectAgentStatus(conf, 'agent-x', 'claude', 'Rotate anyway?', true, 'claude');
    assert.deepEqual(result, { state: 'awaiting', reason: 'awaiting-pattern', matchedPattern: 'awaiting' });
  } finally {
    cleanup(dir);
  }
});

void test('detectAgentStatus: idle state-file with no overriding pattern is an unmodified fallthrough (site 13)', () => {
  const dir = makeStateDir('idle-fallthrough');
  try {
    const conf = baseConf(dir);
    writeState(dir, 'agent-x', 'idle');
    const result = detectAgentStatus(conf, 'agent-x', 'claude', 'nothing interesting here', true, 'claude');
    assert.deepEqual(result, { state: 'idle', reason: 'state-file', matchedPattern: 'idle' });
  } finally {
    cleanup(dir);
  }
});

// ── Branch 4: no state file -> capture-pane regex fallback ───────────────

void test('detectAgentStatus: no state file and an empty pane tail is reported starting (site 14)', () => {
  const dir = makeStateDir('starting');
  try {
    const conf = baseConf(dir);
    const result = detectAgentStatus(conf, 'uat142-nonexistent-window', 'claude', undefined, true, 'claude');
    assert.deepEqual(result, { state: 'starting', reason: 'starting' });
  } finally {
    cleanup(dir);
  }
});

void test('detectAgentStatus: no state file, regex fallback reports busy when BUSY_PATTERN matches (site 15)', () => {
  const dir = makeStateDir('fallback-busy');
  try {
    const conf = baseConf(dir);
    const result = detectAgentStatus(conf, 'agent-x', 'claude', 'esc to interrupt', true, 'claude');
    assert.deepEqual(result, { state: 'busy', reason: 'regex-fallback', matchedPattern: 'busy' });
  } finally {
    cleanup(dir);
  }
});

void test('detectAgentStatus: no state file, regex fallback reports awaiting when AWAITING_PATTERN matches (site 16)', () => {
  const dir = makeStateDir('fallback-awaiting');
  try {
    const conf = baseConf(dir);
    const result = detectAgentStatus(conf, 'agent-x', 'claude', 'Rotate anyway?', true, 'claude');
    assert.deepEqual(result, { state: 'awaiting', reason: 'regex-fallback', matchedPattern: 'awaiting' });
  } finally {
    cleanup(dir);
  }
});

void test('detectAgentStatus: no state file, regex fallback reports idle when IDLE_PATTERN matches (site 17)', () => {
  const dir = makeStateDir('fallback-idle');
  try {
    const conf = baseConf(dir);
    const result = detectAgentStatus(conf, 'agent-x', 'claude', '? for shortcuts', true, 'claude');
    assert.deepEqual(result, { state: 'idle', reason: 'regex-fallback', matchedPattern: 'idle' });
  } finally {
    cleanup(dir);
  }
});

void test('detectAgentStatus: no state file, regex fallback defaults to busy when nothing matches (site 18)', () => {
  const dir = makeStateDir('fallback-default');
  try {
    const conf = baseConf(dir);
    const result = detectAgentStatus(conf, 'agent-x', 'claude', 'totally unrecognized pane content', true, 'claude');
    assert.deepEqual(result, { state: 'busy', reason: 'regex-fallback' });
    assert.equal(result.matchedPattern, undefined);
  } finally {
    cleanup(dir);
  }
});

// ── TASK-0231 / BUG-0013: shared awaiting-pane fixture manifest ──────────
//
// host-server/fixtures/awaiting-panes/manifest.json is the single source of
// truth for pane captures + expected classification. It is exercised here
// against detectAgentStatus (real conductor.conf patterns via baseConf) and,
// independently, against monitor.sh's is_idle by
// scripts/verify-awaiting-detection.sh — so the two detectors cannot drift.

interface AwaitingPaneCase {
  name: string;
  launch: 'claude' | 'codex';
  stateFile: 'idle' | 'busy' | 'awaiting' | null;
  ageS: number;
  pane: string;
  expected: { state: string; reason?: string };
}

const awaitingFixtureDir = path.resolve(__dirname, 'fixtures/awaiting-panes');
const awaitingCases = JSON.parse(
  fs.readFileSync(path.join(awaitingFixtureDir, 'manifest.json'), 'utf8'),
) as AwaitingPaneCase[];

void describe('awaiting-pane fixtures (TASK-0231)', () => {
  void it('manifest is non-empty', () => {
    assert.ok(awaitingCases.length > 0);
  });

  for (const c of awaitingCases) {
    void it(`${c.name}: ${c.launch} / state-file ${c.stateFile ?? 'absent'} -> ${c.expected.state}`, () => {
      const dir = makeStateDir(`fixture-${c.name}`);
      try {
        const conf = baseConf(dir);
        const pane = fs.readFileSync(path.join(awaitingFixtureDir, c.pane), 'utf8');
        if (c.stateFile !== null) {
          writeState(dir, 'agent-x', c.stateFile, c.ageS * 1000);
        }
        const result = detectAgentStatus(conf, 'agent-x', c.launch, pane, true, c.launch);
        assert.equal(result.state, c.expected.state, `state for ${c.name}`);
        if (c.expected.reason !== undefined) {
          assert.equal(result.reason, c.expected.reason, `reason for ${c.name}`);
        }
      } finally {
        cleanup(dir);
      }
    });
  }
});

void test('detectAgentStatus: awaiting state-file + busy footer + "?" line reverts to busy (BUG-0013 site 9 shape)', () => {
  const dir = makeStateDir('awaiting-busy-footer');
  try {
    const conf = baseConf(dir);
    writeState(dir, 'agent-x', 'awaiting');
    const pane = [
      '● I finished the first part of the change.',
      '  Should I continue with the second part now?',
      '',
      '✻ Simmering… (21s · ↓ 2.0k tokens)',
      '',
      '────────────────────────────────────────',
      '❯',
      '────────────────────────────────────────',
      '  ⏵⏵ accept edits on (shift+tab to cycle) · esc to interrupt',
    ].join('\n');
    const result = detectAgentStatus(conf, 'agent-x', 'claude', pane, true, 'claude');
    assert.equal(result.state, 'busy');
    assert.equal(result.reason, 'state-file');
    assert.equal(result.matchedPattern, undefined);
  } finally {
    cleanup(dir);
  }
});

void test('awaitingWindow drops ❯ draft lines and blank lines and keeps the last 8', () => {
  const lines = [
    'l1', '', 'l2', '❯ /research <topic>', 'l3', '   ', 'l4', 'l5', '  ❯   another draft',
    'l6', 'l7', 'l8', 'l9', 'l10',
  ];
  // A bare ❯ (empty prompt box, no text after it) is not a draft line and is kept.
  const withBare = [...lines, '❯'];
  const kept = awaitingWindow(lines.join('\n')).split('\n');
  assert.deepEqual(kept, ['l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10']);
  assert.ok(!kept.some((l) => l.includes('❯')), 'no draft lines survive');
  assert.ok(kept.every((l) => l.trim() !== ''), 'no blank lines survive');
  assert.equal(kept.length, 8);
  const keptBare = awaitingWindow(withBare.join('\n')).split('\n');
  assert.equal(keptBare[keptBare.length - 1], '❯');
  assert.equal(keptBare.length, 8);
});

void test('detectAgentStatus: codex awaiting state-file with "Running" scrollback stays awaiting', () => {
  const dir = makeStateDir('codex-awaiting-running');
  try {
    const conf = baseConf(dir);
    writeState(dir, 'agent-x', 'awaiting');
    const pane = [
      '• Running npm test in the sample project',
      '  └ 12 passed, 0 failed',
      '',
      '  Would you like to run the following command?',
      '',
      '  Press Enter to confirm or Esc to cancel',
    ].join('\n');
    const result = detectAgentStatus(conf, 'agent-x', 'codex', pane, true, 'codex');
    assert.equal(result.state, 'awaiting');
    assert.equal(result.reason, 'state-file');
  } finally {
    cleanup(dir);
  }
});

// ── TASK-0182: exact-match tmux window targets ───────────────────────────
//
// Bare `-t sess:win` PREFIX-matches window names (`foo` resolves to
// `foo-copy`), so a missing agent window silently read another agent's pane.
// `sess:=win` is exact-only. The integration cases use their own throwaway,
// uniquely named session and never touch a live `conductor` session.

const tmuxAvailable = spawnSync('tmux', ['-V'], { encoding: 'utf8' }).status === 0;

void describe('tmux exact-match window targets (TASK-0182)', () => {
  void it('windowTarget builds an exact-match (`=`) target', () => {
    assert.equal(windowTarget('s', 'foo'), 's:=foo');
  });

  void describe('against a throwaway tmux session', { skip: !tmuxAvailable }, () => {
    const sessionName = `tc-test-${String(process.pid)}-${String(Date.now())}`;

    before(() => {
      const r = spawnSync('tmux', ['new-session', '-d', '-s', sessionName, '-n', 'foo-copy'], { encoding: 'utf8' });
      assert.equal(r.status, 0, `tmux new-session failed: ${r.stderr}`);
    });

    after(() => {
      spawnSync('tmux', ['kill-session', '-t', `=${sessionName}`], { encoding: 'utf8' });
    });

    void it('isTmuxWindowPresent finds the exact window name', () => {
      assert.equal(isTmuxWindowPresent(sessionName, 'foo-copy'), true);
    });

    void it('isTmuxWindowPresent does not prefix-match a sibling window', () => {
      assert.equal(isTmuxWindowPresent(sessionName, 'foo'), false);
    });

    void it('capturePaneTail returns empty for a name that only prefix-matches another window', () => {
      assert.equal(capturePaneTail(sessionName, 'foo', 5), '');
    });

    void it('capturePaneTail does not throw for the exact window', () => {
      assert.doesNotThrow(() => capturePaneTail(sessionName, 'foo-copy', 5));
    });
  });
});

// ── TASK-0184: detectAgentStatusWithBackgroundJobs wrapper ────────────────
//
// The wrapper has no dedicated coverage yet (backgroundJobs.test.ts covers
// the pure hasActiveBackgroundJob function directly; these tests cover the
// wrapper's own pass-through / upgrade contract). Note: hasActiveBackgroundJob
// is invoked by the wrapper with the real, default `~/.claude/jobs` dir (the
// wrapper does not expose a jobsDir override), so only cases that resolve to
// `false` before ever reading that directory can be driven deterministically
// here — see UAT-0184's own report for the "upgrades idle to busy" gap.

void test('detectAgentStatusWithBackgroundJobs: passes through every non-idle detectAgentStatus result unchanged (busy, awaiting, stalled, exited, no-window, starting)', () => {
  const dir = makeStateDir('wrapper-passthrough');
  try {
    const conf = baseConf(dir, { stallTimeout: 1 });
    const workdir = '/nonexistent/uat-0184-wrapper-workdir';

    writeState(dir, 'agent-busy', 'busy');
    assert.deepEqual(
      detectAgentStatusWithBackgroundJobs(conf, 'agent-busy', 'claude', workdir, 'esc to interrupt', true, 'claude'),
      detectAgentStatus(conf, 'agent-busy', 'claude', 'esc to interrupt', true, 'claude'),
    );

    writeState(dir, 'agent-awaiting', 'awaiting');
    assert.deepEqual(
      detectAgentStatusWithBackgroundJobs(conf, 'agent-awaiting', 'claude', workdir, 'Enter to select · Esc to cancel', true, 'claude'),
      detectAgentStatus(conf, 'agent-awaiting', 'claude', 'Enter to select · Esc to cancel', true, 'claude'),
    );

    writeState(dir, 'agent-stalled', 'busy', 5_000);
    assert.deepEqual(
      detectAgentStatusWithBackgroundJobs(conf, 'agent-stalled', 'claude', workdir, 'nothing recognizable here', true, 'claude'),
      detectAgentStatus(conf, 'agent-stalled', 'claude', 'nothing recognizable here', true, 'claude'),
    );

    assert.deepEqual(
      detectAgentStatusWithBackgroundJobs(conf, 'agent-exited', 'claude', workdir, undefined, true, 'zsh'),
      detectAgentStatus(conf, 'agent-exited', 'claude', undefined, true, 'zsh'),
    );

    assert.deepEqual(
      detectAgentStatusWithBackgroundJobs(conf, 'agent-no-window', 'claude', workdir, undefined, false, null),
      detectAgentStatus(conf, 'agent-no-window', 'claude', undefined, false, null),
    );

    assert.deepEqual(
      detectAgentStatusWithBackgroundJobs(conf, 'uat0184-nonexistent-window', 'claude', workdir, undefined, true, 'claude'),
      detectAgentStatus(conf, 'uat0184-nonexistent-window', 'claude', undefined, true, 'claude'),
    );
  } finally {
    cleanup(dir);
  }
});

void test('detectAgentStatusWithBackgroundJobs: an idle result with no resolvable transcript (no sidecar, no derivable workdir) stays idle', () => {
  const dir = makeStateDir('wrapper-idle-no-transcript');
  try {
    const conf = baseConf(dir);
    writeState(dir, 'agent-x', 'idle');
    const workdir = '/nonexistent/uat-0184-wrapper-workdir-no-transcript';
    const result = detectAgentStatusWithBackgroundJobs(conf, 'agent-x', 'claude', workdir, 'nothing interesting here', true, 'claude');
    assert.deepEqual(result, { state: 'idle', reason: 'state-file', matchedPattern: 'idle' });
  } finally {
    cleanup(dir);
  }
});

// TASK-0185: send chain (text -> render-settle sleep -> separate Enter). The
// injected run/sleep fakes record an ordered event log so no real tmux is
// spawned and nothing really sleeps. Assumes the default 300ms / 1000ms delays.
function makeSendFakes(opts: { throwOnRun?: boolean } = {}) {
  const events: string[] = [];
  const runArgs: string[][] = [];
  return {
    events,
    runArgs,
    deps: {
      run: (args: string[]) => {
        events.push(`run:${JSON.stringify(args)}`);
        runArgs.push(args);
        if (opts.throwOnRun) throw new Error('tmux boom');
      },
      sleep: (ms: number) => {
        events.push(`sleep:${String(ms)}`);
        return Promise.resolve();
      },
    },
  };
}

void describe('sendTextToPane / sendDispatchToPane (TASK-0185)', () => {
  const target = windowTarget('sess', 'agent-a');
  const textRun = (text: string) => `run:${JSON.stringify(['send-keys', '-t', target, '-l', '--', text])}`;
  const enterRun = `run:${JSON.stringify(['send-keys', '-t', target, 'Enter'])}`;

  void it('sendTextToPane emits send-keys -l -- text, sleep(300), then a separate Enter', async () => {
    const { events, runArgs, deps } = makeSendFakes();
    await sendTextToPane('sess', 'agent-a', 'hello world', deps);
    assert.deepEqual(events, [textRun('hello world'), 'sleep:300', enterRun]);
    assert.deepEqual(runArgs[1], ['send-keys', '-t', target, 'Enter']);
  });

  void it('sendDispatchToPane with clearFirst=false sends only the command sequence (no /clear)', async () => {
    const { events, deps } = makeSendFakes();
    await sendDispatchToPane('sess', 'agent-a', '/tackle TASK-1', { clearFirst: false }, deps);
    assert.deepEqual(events, [textRun('/tackle TASK-1'), 'sleep:300', enterRun]);
  });

  void it('sendDispatchToPane with clearFirst=true sends /clear, settles, then the command', async () => {
    const { events, deps } = makeSendFakes();
    await sendDispatchToPane('sess', 'agent-a', '/tackle TASK-1', { clearFirst: true }, deps);
    assert.deepEqual(events, [
      textRun('/clear'),
      'sleep:300',
      enterRun,
      'sleep:1000',
      textRun('/tackle TASK-1'),
      'sleep:300',
      enterRun,
    ]);
  });

  void it('passes shell/special characters through verbatim as a single -l -- argument', async () => {
    const { runArgs, deps } = makeSendFakes();
    const cmd = 'echo "hi $HOME"; printf \'a\\nb\' \\ done';
    await sendTextToPane('sess', 'agent-a', cmd, deps);
    assert.deepEqual(runArgs[0], ['send-keys', '-t', target, '-l', '--', cmd]);
  });

  void it('does not send Enter and propagates the rejection when the text send throws', async () => {
    const { events, deps } = makeSendFakes({ throwOnRun: true });
    await assert.rejects(sendTextToPane('sess', 'agent-a', 'boom', deps), /tmux boom/);
    assert.deepEqual(events, [textRun('boom')]);
    assert.ok(!events.includes(enterRun));
  });
});

void describe('bgLiveness (TASK-0191)', () => {
  const now = 1_000_000_000;

  void it("reports 'stopped' when the window is absent, whatever the pane command", () => {
    assert.equal(bgLiveness({ windowPresent: false, paneCommand: 'node', launchCmd: 'npm run dev' }), 'stopped');
    assert.equal(bgLiveness({ windowPresent: false, paneCommand: undefined, launchCmd: 'npm run dev' }), 'stopped');
  });

  void it("reports 'running' when the pane runs a non-shell command", () => {
    assert.equal(bgLiveness({ windowPresent: true, paneCommand: 'node', launchCmd: 'npm run dev' }), 'running');
  });

  void it("reports 'exited' when the pane fell back to a plain shell", () => {
    assert.equal(bgLiveness({ windowPresent: true, paneCommand: 'zsh', launchCmd: 'npm run dev' }), 'exited');
    assert.equal(bgLiveness({ windowPresent: true, paneCommand: '/bin/bash', launchCmd: 'npm run dev' }), 'exited');
  });

  void it("reports 'running' for a shell pane inside the startup grace", () => {
    assert.equal(
      bgLiveness({
        windowPresent: true,
        paneCommand: 'zsh',
        launchCmd: 'npm run dev',
        windowActivityMs: now - (BG_STARTUP_GRACE_MS - 1),
        nowMs: now,
      }),
      'running',
    );
  });

  void it("reports 'exited' for a shell pane once the startup grace has elapsed", () => {
    assert.equal(
      bgLiveness({
        windowPresent: true,
        paneCommand: 'zsh',
        launchCmd: 'npm run dev',
        windowActivityMs: now - BG_STARTUP_GRACE_MS,
        nowMs: now,
      }),
      'exited',
    );
  });

  void it("applies no grace when only one of windowActivityMs / nowMs is supplied", () => {
    assert.equal(
      bgLiveness({ windowPresent: true, paneCommand: 'zsh', launchCmd: 'npm run dev', windowActivityMs: now }),
      'exited',
    );
    assert.equal(
      bgLiveness({ windowPresent: true, paneCommand: 'zsh', launchCmd: 'npm run dev', nowMs: now }),
      'exited',
    );
  });

  void it("reports 'running' when the launch command is itself a shell", () => {
    assert.equal(bgLiveness({ windowPresent: true, paneCommand: 'zsh', launchCmd: 'zsh -c "make watch"' }), 'running');
    assert.equal(bgLiveness({ windowPresent: true, paneCommand: 'bash', launchCmd: 'FOO=1 bash' }), 'running');
  });

  void it("reports 'running' when tmux returns an empty command (fail toward not restarting)", () => {
    assert.equal(bgLiveness({ windowPresent: true, paneCommand: '', launchCmd: 'npm run dev' }), 'running');
    assert.equal(bgLiveness({ windowPresent: true, paneCommand: '  \n', launchCmd: 'npm run dev' }), 'running');
    assert.equal(bgLiveness({ windowPresent: true, paneCommand: undefined, launchCmd: 'npm run dev' }), 'running');
    assert.equal(bgLiveness({ windowPresent: true, paneCommand: null, launchCmd: 'npm run dev' }), 'running');
  });

  void it("ignores env-var prefixes on a non-shell launch command (still 'exited' at a shell prompt)", () => {
    assert.equal(bgLiveness({ windowPresent: true, paneCommand: 'zsh', launchCmd: 'PORT=3000 npm run dev' }), 'exited');
  });

  void it("treats the pane command case-insensitively and by basename", () => {
    assert.equal(bgLiveness({ windowPresent: true, paneCommand: '/usr/bin/ZSH', launchCmd: 'npm run dev' }), 'exited');
  });

  void it("never reports 'exited' for a non-shell pane command, even long after window activity", () => {
    assert.equal(
      bgLiveness({
        windowPresent: true,
        paneCommand: 'node',
        launchCmd: 'npm run dev',
        windowActivityMs: 0,
        nowMs: now,
      }),
      'running',
    );
  });

  void it("still reports 'stopped' for an absent window inside the grace window", () => {
    assert.equal(
      bgLiveness({
        windowPresent: false,
        paneCommand: 'zsh',
        launchCmd: 'npm run dev',
        windowActivityMs: now,
        nowMs: now,
      }),
      'stopped',
    );
  });
});

// TASK-0191: readTmuxWindowInventory now asks tmux for a third column
// (#{window_activity}, epoch SECONDS) and exposes it as windowActivityMs. A fake `tmux` shim on
// PATH stands in for the real binary so the format string and the tolerant parsing are pinned
// without a live tmux server. Whether a REAL tmux expands #{window_activity} is UAT-0191.
void describe('readTmuxWindowInventory window_activity column (TASK-0191)', () => {
  let shimDir = '';
  let argsFile = '';
  let savedPath: string | undefined;

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    shimDir = fs.mkdtempSync(path.join(tmpDir, 'inventory-shim-'));
    argsFile = path.join(shimDir, 'args.txt');
    const script = [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > '${argsFile}'`,
      // name<TAB>command<TAB>activity: normal, empty activity, non-numeric activity, legacy 2-column line
      "printf 'bg-a\\tzsh\\t1000\\nbg-b\\tnode\\t\\nbg-c\\tsleep\\tnotanumber\\nbg-old\\tbash\\n'",
      '',
    ].join('\n');
    fs.writeFileSync(path.join(shimDir, 'tmux'), script, { mode: 0o755 });
    savedPath = process.env['PATH'];
    process.env['PATH'] = `${shimDir}${path.delimiter}${savedPath ?? ''}`;
    // Warm-up: the first exec of a freshly written script can exceed the 100 ms
    // TMUX_SYNC_TIMEOUT_MS on macOS (code-signing scan), which would look like a tmux timeout.
    spawnSync(path.join(shimDir, 'tmux'), ['warm-up'], { timeout: 10_000 });
  });

  after(() => {
    if (savedPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = savedPath;
    cleanup(shimDir);
  });

  void it('requests #{window_activity} as a tab-delimited third column', () => {
    readTmuxWindowInventory('any-session');
    const args = fs.readFileSync(argsFile, 'utf8').split('\n');
    const fmt = args[args.indexOf('-F') + 1];
    assert.equal(fmt, '#{window_name}\t#{pane_current_command}\t#{window_activity}');
  });

  void it('converts activity seconds to ms and skips empty / non-numeric values without dropping the window', () => {
    const inv = readTmuxWindowInventory('any-session');
    assert.equal(inv.sessionExists, true);
    assert.deepEqual(
      [...inv.windows],
      [
        ['bg-a', 'zsh'],
        ['bg-b', 'node'],
        ['bg-c', 'sleep'],
        ['bg-old', 'bash'],
      ],
    );
    assert.deepEqual([...inv.windowActivityMs], [['bg-a', 1_000_000]]);
  });
});
