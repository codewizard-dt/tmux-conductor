import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { readConductorConf, clearConfCache } from './config.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(__dirname, '../tmp');

function writeTempConf(name: string, contents: string): string {
  const confPath = path.join(tmpDir, name);
  fs.writeFileSync(confPath, contents, 'utf8');
  return confPath;
}

// TASK-107: TERMINAL_LOG_MAX_ROWS_PER_AGENT is a new tuning constant added to
// the same three-part config pattern as terminalTailLines/terminalPollMs
// (declare -p list, parsePositiveIntSetting call, ConductorConf interface +
// cache field). These tests exercise that pattern end-to-end against a real
// (file-backed) conductor.conf, the same way readConductorConf is actually
// invoked in production — not by inspecting source directly — so a
// regression in the declare -p variable list (the most common way to break
// this pattern) is caught: an omitted variable name there makes bash's
// `declare -p` never emit it, so parseDeclare returns null and the value
// silently falls back to the default regardless of what the conf sets.
void test('TERMINAL_LOG_MAX_ROWS_PER_AGENT defaults to 500 when absent from conductor.conf', () => {
  const confPath = writeTempConf(
    'config-test-terminal-log-default.conf',
    'SESSION_NAME="task107-default"\n',
  );
  clearConfCache();
  const conf = readConductorConf(confPath);
  assert.equal(conf.terminalLogMaxRowsPerAgent, 500);
});

void test('TERMINAL_LOG_MAX_ROWS_PER_AGENT honors an explicit positive value from conductor.conf', () => {
  const confPath = writeTempConf(
    'config-test-terminal-log-custom.conf',
    'SESSION_NAME="task107-custom"\nTERMINAL_LOG_MAX_ROWS_PER_AGENT=42\n',
  );
  clearConfCache();
  const conf = readConductorConf(confPath);
  assert.equal(conf.terminalLogMaxRowsPerAgent, 42);
});

void test('TERMINAL_LOG_MAX_ROWS_PER_AGENT falls back to the default for a non-positive value', () => {
  const confPath = writeTempConf(
    'config-test-terminal-log-invalid.conf',
    'SESSION_NAME="task107-invalid"\nTERMINAL_LOG_MAX_ROWS_PER_AGENT=0\n',
  );
  clearConfCache();
  const conf = readConductorConf(confPath);
  assert.equal(conf.terminalLogMaxRowsPerAgent, 500);
});

// TASK-119: METRICS_SNAPSHOT_INTERVAL_MS follows the identical three-part
// pattern (declare -p list, parsePositiveIntSetting call, ConductorConf
// interface + cache field) — same regression this file already guards
// against for TERMINAL_LOG_MAX_ROWS_PER_AGENT: an omitted variable name in
// the declare -p list silently falls back to the default even when the conf
// sets it, so these tests exercise readConductorConf end-to-end rather than
// inspecting source.
void test('METRICS_SNAPSHOT_INTERVAL_MS defaults to 60000 when absent from conductor.conf', () => {
  const confPath = writeTempConf(
    'config-test-metrics-snapshot-default.conf',
    'SESSION_NAME="task119-default"\n',
  );
  clearConfCache();
  const conf = readConductorConf(confPath);
  assert.equal(conf.metricsSnapshotIntervalMs, 60000);
});

void test('METRICS_SNAPSHOT_INTERVAL_MS honors an explicit positive value from conductor.conf', () => {
  const confPath = writeTempConf(
    'config-test-metrics-snapshot-custom.conf',
    'SESSION_NAME="task119-custom"\nMETRICS_SNAPSHOT_INTERVAL_MS=5000\n',
  );
  clearConfCache();
  const conf = readConductorConf(confPath);
  assert.equal(conf.metricsSnapshotIntervalMs, 5000);
});

void test('METRICS_SNAPSHOT_INTERVAL_MS falls back to the default for a non-positive value', () => {
  const confPath = writeTempConf(
    'config-test-metrics-snapshot-invalid.conf',
    'SESSION_NAME="task119-invalid"\nMETRICS_SNAPSHOT_INTERVAL_MS=0\n',
  );
  clearConfCache();
  const conf = readConductorConf(confPath);
  assert.equal(conf.metricsSnapshotIntervalMs, 60000);
});

// BUG-0001: PENDING_AGENT_STALE_S follows the identical three-part pattern
// (declare -p list, parsePositiveIntSetting call, ConductorConf interface +
// cache field) as TERMINAL_LOG_MAX_ROWS_PER_AGENT/METRICS_SNAPSHOT_INTERVAL_MS
// above — same regression these tests guard against: an omitted variable
// name in the declare -p list silently falls back to the default even when
// the conf sets it. Unlike the other two, this setting is seconds in the
// conf but milliseconds on ConductorConf (compared against Date.now()), so
// the conversion itself is asserted too.
void test('PENDING_AGENT_STALE_S defaults to 3600s (3600000ms) when absent from conductor.conf', () => {
  const confPath = writeTempConf(
    'config-test-pending-agent-stale-default.conf',
    'SESSION_NAME="bug0001-default"\n',
  );
  clearConfCache();
  const conf = readConductorConf(confPath);
  assert.equal(conf.pendingAgentStaleMs, 3_600_000);
});

void test('PENDING_AGENT_STALE_S honors an explicit positive value from conductor.conf, converted from seconds to ms', () => {
  const confPath = writeTempConf(
    'config-test-pending-agent-stale-custom.conf',
    'SESSION_NAME="bug0001-custom"\nPENDING_AGENT_STALE_S=120\n',
  );
  clearConfCache();
  const conf = readConductorConf(confPath);
  assert.equal(conf.pendingAgentStaleMs, 120_000);
});

void test('PENDING_AGENT_STALE_S falls back to the default for a non-positive value', () => {
  const confPath = writeTempConf(
    'config-test-pending-agent-stale-invalid.conf',
    'SESSION_NAME="bug0001-invalid"\nPENDING_AGENT_STALE_S=0\n',
  );
  clearConfCache();
  const conf = readConductorConf(confPath);
  assert.equal(conf.pendingAgentStaleMs, 3_600_000);
});
