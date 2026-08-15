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
test('TERMINAL_LOG_MAX_ROWS_PER_AGENT defaults to 500 when absent from conductor.conf', () => {
  const confPath = writeTempConf(
    'config-test-terminal-log-default.conf',
    'SESSION_NAME="task107-default"\n',
  );
  clearConfCache();
  const conf = readConductorConf(confPath);
  assert.equal(conf.terminalLogMaxRowsPerAgent, 500);
});

test('TERMINAL_LOG_MAX_ROWS_PER_AGENT honors an explicit positive value from conductor.conf', () => {
  const confPath = writeTempConf(
    'config-test-terminal-log-custom.conf',
    'SESSION_NAME="task107-custom"\nTERMINAL_LOG_MAX_ROWS_PER_AGENT=42\n',
  );
  clearConfCache();
  const conf = readConductorConf(confPath);
  assert.equal(conf.terminalLogMaxRowsPerAgent, 42);
});

test('TERMINAL_LOG_MAX_ROWS_PER_AGENT falls back to the default for a non-positive value', () => {
  const confPath = writeTempConf(
    'config-test-terminal-log-invalid.conf',
    'SESSION_NAME="task107-invalid"\nTERMINAL_LOG_MAX_ROWS_PER_AGENT=0\n',
  );
  clearConfCache();
  const conf = readConductorConf(confPath);
  assert.equal(conf.terminalLogMaxRowsPerAgent, 500);
});
