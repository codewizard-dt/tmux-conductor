import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { hasPendingBackgroundAgents } from './pendingAgents.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(__dirname, '../tmp');

function makeStateDir(label: string): string {
  fs.mkdirSync(tmpDir, { recursive: true });
  const rand = Math.random().toString(36).slice(2, 10);
  return fs.mkdtempSync(path.join(tmpDir, `pending-agents-${label}-${rand}-`));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

void test('hasPendingBackgroundAgents returns false when the pending-agents directory does not exist', () => {
  const stateDir = makeStateDir('missing-dir');
  try {
    assert.equal(hasPendingBackgroundAgents(stateDir, 'my-agent', 3_600_000), false);
  } finally {
    cleanup(stateDir);
  }
});

void test('hasPendingBackgroundAgents returns true when a fresh sentinel file exists', () => {
  const stateDir = makeStateDir('fresh');
  try {
    const dir = path.join(stateDir, 'my-agent.pending-agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${String(Date.now())}-abc123`), '');
    assert.equal(hasPendingBackgroundAgents(stateDir, 'my-agent', 3_600_000), true);
  } finally {
    cleanup(stateDir);
  }
});

void test('hasPendingBackgroundAgents returns false and does not throw when the directory exists but is empty (agent_completed cleared it)', () => {
  const stateDir = makeStateDir('empty');
  try {
    const dir = path.join(stateDir, 'my-agent.pending-agents');
    fs.mkdirSync(dir, { recursive: true });
    assert.equal(hasPendingBackgroundAgents(stateDir, 'my-agent', 3_600_000), false);
  } finally {
    cleanup(stateDir);
  }
});

void test('hasPendingBackgroundAgents treats a sentinel older than staleMs as stale and returns false (missed agent_completed fallback)', () => {
  const stateDir = makeStateDir('stale');
  try {
    const dir = path.join(stateDir, 'my-agent.pending-agents');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${String(Date.now())}-abc123`);
    fs.writeFileSync(filePath, '');
    const old = new Date(Date.now() - 2 * 3_600_000);
    fs.utimesSync(filePath, old, old);
    assert.equal(hasPendingBackgroundAgents(stateDir, 'my-agent', 3_600_000), false);
  } finally {
    cleanup(stateDir);
  }
});

void test('hasPendingBackgroundAgents returns true when at least one sentinel is fresh even if another is stale', () => {
  const stateDir = makeStateDir('mixed');
  try {
    const dir = path.join(stateDir, 'my-agent.pending-agents');
    fs.mkdirSync(dir, { recursive: true });
    const stalePath = path.join(dir, `${String(Date.now())}-stale`);
    fs.writeFileSync(stalePath, '');
    const old = new Date(Date.now() - 2 * 3_600_000);
    fs.utimesSync(stalePath, old, old);
    fs.writeFileSync(path.join(dir, `${String(Date.now())}-fresh`), '');
    assert.equal(hasPendingBackgroundAgents(stateDir, 'my-agent', 3_600_000), true);
  } finally {
    cleanup(stateDir);
  }
});

void test('hasPendingBackgroundAgents is scoped per window name — sentinels for a different agent do not leak in', () => {
  const stateDir = makeStateDir('scoped');
  try {
    const dir = path.join(stateDir, 'other-agent.pending-agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${String(Date.now())}-abc123`), '');
    assert.equal(hasPendingBackgroundAgents(stateDir, 'my-agent', 3_600_000), false);
  } finally {
    cleanup(stateDir);
  }
});
