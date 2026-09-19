import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { readConductorConf, clearConfCache, DEFAULT_CONF_PATH, type ConductorConf } from './config.ts';
import { detectAgentStatus } from './state.ts';

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
