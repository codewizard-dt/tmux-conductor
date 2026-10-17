import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readConductorConf, clearConfCache, DEFAULT_CONF_PATH } from './config.ts';

// BUG-0002: AWAITING_PATTERN matches per-line against the last 8 non-blank
// pane lines via `grep -qE` (exactly as scripts/monitor.sh and
// host-server/state.ts's grepMatches do — see state.ts:222). This exercises
// the ACTUAL pattern in the repo-root conductor.conf, not a copy, so a future
// edit to AWAITING_PATTERN that regresses either case below fails here.
function matches(pattern: string, line: string): boolean {
  const result = spawnSync('grep', ['-qE', pattern], { input: line, encoding: 'utf8' });
  return result.status === 0;
}

function awaitingPattern(): string {
  clearConfCache();
  return readConductorConf(DEFAULT_CONF_PATH).awaitingPattern;
}

void test('AWAITING_PATTERN matches an inline slash-option prompt whose "?" is not at end of line (BUG-0002: /uat-walk verdict prompt)', () => {
  const pattern = awaitingPattern();
  assert.equal(matches(pattern, 'Verdict? P/F/Fix/Skip'), true);
  assert.equal(matches(pattern, 'Continue? Delete/Keep/Skip'), true);
});

void test('AWAITING_PATTERN still matches its pre-existing documented cases', () => {
  const pattern = awaitingPattern();
  assert.equal(matches(pattern, 'Rotate anyway?'), true, 'bare trailing "?"');
  assert.equal(matches(pattern, 'Continue? [Y/n]'), true, '[Y/n] confirm prompt');
  assert.equal(matches(pattern, '> '), true, 'bare ">" prompt');
  assert.equal(matches(pattern, 'Enter to select · Esc to cancel'), true, 'AskUserQuestion dialog footer');
  assert.equal(matches(pattern, 'ctrl+g to edit · shift+tab to approve'), true, 'plan-approval footer');
});

// BUG-0013: the ">" alternative is fully anchored (^\s*>\s*$) so it only matches
// a line that is nothing but ">", not any line that merely ends in ">".
void test('AWAITING_PATTERN ">" alternative matches only a line that is just ">" (BUG-0013)', () => {
  const pattern = awaitingPattern();
  assert.equal(matches(pattern, '>'), true, 'bare ">"');
  assert.equal(matches(pattern, '  >  '), true, 'padded bare ">"');
  assert.equal(matches(pattern, '### 1. Implement the fix <!-- agent: general-purpose -->'), false, 'HTML comment ending in ">"');
  assert.equal(matches(pattern, 'aider>'), false, 'aider prompt ending in ">"');
  assert.equal(matches(pattern, '❯ /research <topic or question to research>'), false, 'draft input ending in ">"');
  // Anchors must apply per line, not per multi-line block.
  assert.equal(matches(pattern, 'some output\n>\nmore output'), true, 'bare ">" on its own line inside a block');
  assert.equal(matches(pattern, 'some output\nfoo <bar>\nmore output'), false, 'no line is only ">"');
});

void test('AWAITING_PATTERN does not regress the git-prompt false positive it was previously fixed for', () => {
  const pattern = awaitingPattern();
  assert.equal(matches(pattern, 'myproject ?2 ~'), false, 'powerlevel10k/starship untracked-file indicator');
  assert.equal(matches(pattern, 'esc to interrupt'), false, 'lowercase busy spinner must never match (case-sensitive)');
});
