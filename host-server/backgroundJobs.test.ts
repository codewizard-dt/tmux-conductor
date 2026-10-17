import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { hasActiveBackgroundJob } from './backgroundJobs.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(__dirname, '../tmp');
const STALE_MS = 3_600_000;

interface Fixture { root: string; stateDir: string; jobsDir: string; transcriptPath: string; }

function makeFixture(label: string): Fixture {
  fs.mkdirSync(tmpDir, { recursive: true });
  const rand = Math.random().toString(36).slice(2, 10);
  const root = fs.mkdtempSync(path.join(tmpDir, `background-jobs-${label}-${rand}-`));
  const stateDir = path.join(root, 'state');
  const jobsDir = path.join(root, 'jobs');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(jobsDir, { recursive: true });
  const transcriptPath = path.join(root, 'transcript.jsonl');
  return { root, stateDir, jobsDir, transcriptPath };
}

function cleanup(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

function writeSidecar(stateDir: string, agentName: string, transcriptPath: string, sessionId = 'parent-session'): void {
  fs.writeFileSync(
    path.join(stateDir, `${agentName}.meta.json`),
    JSON.stringify({ transcript_path: transcriptPath, session_id: sessionId }),
  );
}

function writeTranscript(transcriptPath: string, lines: unknown[]): void {
  fs.writeFileSync(transcriptPath, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}

function writeJob(jobsDir: string, jobId: string, job: Record<string, unknown>): void {
  const dir = path.join(jobsDir, jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(job));
}

void test('hasActiveBackgroundJob returns false when there is no sidecar and no derivable transcript', () => {
  const { root, stateDir, jobsDir } = makeFixture('no-transcript');
  try {
    assert.equal(hasActiveBackgroundJob(stateDir, 'my-agent', '/nonexistent/workdir-xyz', STALE_MS, jobsDir), false);
  } finally {
    cleanup(root);
  }
});

void test('hasActiveBackgroundJob returns false when the transcript has no continued-in records', () => {
  const { root, stateDir, jobsDir, transcriptPath } = makeFixture('no-continued-in');
  try {
    writeSidecar(stateDir, 'my-agent', transcriptPath);
    writeTranscript(transcriptPath, [
      { type: 'assistant', message: { model: 'claude-opus-4-8' } },
      { type: 'user' },
    ]);
    assert.equal(hasActiveBackgroundJob(stateDir, 'my-agent', '/unused', STALE_MS, jobsDir), false);
  } finally {
    cleanup(root);
  }
});

void test('hasActiveBackgroundJob returns true when a continued-in job is still "working"', () => {
  const { root, stateDir, jobsDir, transcriptPath } = makeFixture('working');
  try {
    writeSidecar(stateDir, 'my-agent', transcriptPath);
    writeTranscript(transcriptPath, [
      { type: 'continued-in', sessionId: 'parent-session', continuedInSessionId: 'job-1' },
    ]);
    writeJob(jobsDir, 'job-1', { state: 'working', sessionId: 'job-1', updatedAt: new Date().toISOString() });
    assert.equal(hasActiveBackgroundJob(stateDir, 'my-agent', '/unused', STALE_MS, jobsDir), true);
  } finally {
    cleanup(root);
  }
});

void test('hasActiveBackgroundJob returns true when a continued-in job is "blocked" (peer-coordination stall)', () => {
  const { root, stateDir, jobsDir, transcriptPath } = makeFixture('blocked');
  try {
    writeSidecar(stateDir, 'my-agent', transcriptPath);
    writeTranscript(transcriptPath, [
      { type: 'continued-in', sessionId: 'parent-session', continuedInSessionId: 'job-1' },
    ]);
    writeJob(jobsDir, 'job-1', { state: 'blocked', sessionId: 'job-1', updatedAt: new Date().toISOString() });
    assert.equal(hasActiveBackgroundJob(stateDir, 'my-agent', '/unused', STALE_MS, jobsDir), true);
  } finally {
    cleanup(root);
  }
});

void test('hasActiveBackgroundJob returns false when the continued-in job is "done"', () => {
  const { root, stateDir, jobsDir, transcriptPath } = makeFixture('done');
  try {
    writeSidecar(stateDir, 'my-agent', transcriptPath);
    writeTranscript(transcriptPath, [
      { type: 'continued-in', sessionId: 'parent-session', continuedInSessionId: 'job-1' },
    ]);
    writeJob(jobsDir, 'job-1', { state: 'done', sessionId: 'job-1', updatedAt: new Date().toISOString() });
    assert.equal(hasActiveBackgroundJob(stateDir, 'my-agent', '/unused', STALE_MS, jobsDir), false);
  } finally {
    cleanup(root);
  }
});

void test('hasActiveBackgroundJob returns false when the job directory is missing entirely (already garbage-collected)', () => {
  const { root, stateDir, jobsDir, transcriptPath } = makeFixture('gc-d');
  try {
    writeSidecar(stateDir, 'my-agent', transcriptPath);
    writeTranscript(transcriptPath, [
      { type: 'continued-in', sessionId: 'parent-session', continuedInSessionId: 'job-1' },
    ]);
    // jobsDir exists but has no job-1 entry at all.
    assert.equal(hasActiveBackgroundJob(stateDir, 'my-agent', '/unused', STALE_MS, jobsDir), false);
  } finally {
    cleanup(root);
  }
});

void test('hasActiveBackgroundJob treats an unrecognized state as active while fresh, and warns once', (t) => {
  const { root, stateDir, jobsDir, transcriptPath } = makeFixture('unrecognized-fresh');
  try {
    writeSidecar(stateDir, 'my-agent', transcriptPath);
    writeTranscript(transcriptPath, [
      { type: 'continued-in', sessionId: 'parent-session', continuedInSessionId: 'job-1' },
    ]);
    writeJob(jobsDir, 'job-1', { state: 'starting-up', sessionId: 'job-1', updatedAt: new Date().toISOString() });

    const warnSpy = t.mock.method(console, 'warn', () => {});
    assert.equal(hasActiveBackgroundJob(stateDir, 'my-agent', '/unused', STALE_MS, jobsDir), true);
    assert.equal(warnSpy.mock.calls.length, 1);
    assert.match(String(warnSpy.mock.calls[0]?.arguments[0]), /unrecognized job state "starting-up"/);
  } finally {
    cleanup(root);
  }
});

void test('hasActiveBackgroundJob treats an unrecognized state as inactive once updatedAt ages past staleMs', () => {
  const { root, stateDir, jobsDir, transcriptPath } = makeFixture('unrecognized-stale');
  try {
    writeSidecar(stateDir, 'my-agent', transcriptPath);
    writeTranscript(transcriptPath, [
      { type: 'continued-in', sessionId: 'parent-session', continuedInSessionId: 'job-1' },
    ]);
    const staleUpdatedAt = new Date(Date.now() - 2 * STALE_MS).toISOString();
    writeJob(jobsDir, 'job-1', { state: 'starting-up', sessionId: 'job-1', updatedAt: staleUpdatedAt });
    assert.equal(hasActiveBackgroundJob(stateDir, 'my-agent', '/unused', STALE_MS, jobsDir), false);
  } finally {
    cleanup(root);
  }
});

void test('hasActiveBackgroundJob returns true when multiple continued-in jobs exist and only one is still active', () => {
  const { root, stateDir, jobsDir, transcriptPath } = makeFixture('multi');
  try {
    writeSidecar(stateDir, 'my-agent', transcriptPath);
    writeTranscript(transcriptPath, [
      { type: 'continued-in', sessionId: 'parent-session', continuedInSessionId: 'job-a' },
      { type: 'continued-in', sessionId: 'parent-session', continuedInSessionId: 'job-b' },
    ]);
    writeJob(jobsDir, 'job-a', { state: 'done', sessionId: 'job-a', updatedAt: new Date().toISOString() });
    writeJob(jobsDir, 'job-b', { state: 'working', sessionId: 'job-b', updatedAt: new Date().toISOString() });
    assert.equal(hasActiveBackgroundJob(stateDir, 'my-agent', '/unused', STALE_MS, jobsDir), true);
  } finally {
    cleanup(root);
  }
});

void test('hasActiveBackgroundJob caches the transcript scan by (path, mtimeMs, size) — a same-signature rewrite still serves the cached scan', () => {
  const { root, stateDir, jobsDir, transcriptPath } = makeFixture('cache');
  try {
    writeSidecar(stateDir, 'my-agent', transcriptPath);
    const contentA = `${JSON.stringify({ type: 'continued-in', sessionId: 'parent-session', continuedInSessionId: 'job-1' })}\n`;
    fs.writeFileSync(transcriptPath, contentA);
    // Normalize mtime precision up front: utimesSync only has millisecond
    // resolution, so a filesystem that stamps sub-millisecond mtimes (e.g.
    // APFS) would otherwise make the post-rewrite utimesSync below land on a
    // slightly different mtimeMs than the one this first call caches.
    const preStat = fs.statSync(transcriptPath);
    fs.utimesSync(transcriptPath, preStat.atime, preStat.mtime);
    writeJob(jobsDir, 'job-1', { state: 'working', sessionId: 'job-1', updatedAt: new Date().toISOString() });

    assert.equal(hasActiveBackgroundJob(stateDir, 'my-agent', '/unused', STALE_MS, jobsDir), true);

    // fs.readFileSync can't be spied directly: `import * as fs from 'fs'`
    // yields an ES module namespace object, and namespace exotic objects
    // reject [[Set]] unconditionally (confirmed at runtime), so neither
    // plain reassignment nor node:test's t.mock.method (which needs
    // Object.defineProperty) can intercept it. Prove the cache functionally
    // instead: overwrite the transcript with content that has NO
    // continued-in records, but pad it to the exact same byte length and
    // force the exact same mtime, so the (path, mtimeMs, size) cache key
    // still matches — if the second call actually re-read the file it would
    // see zero session ids and return false.
    const originalStat = fs.statSync(transcriptPath);
    const contentB = ' '.repeat(Buffer.byteLength(contentA, 'utf8'));
    fs.writeFileSync(transcriptPath, contentB);
    fs.utimesSync(transcriptPath, originalStat.atime, originalStat.mtime);

    assert.equal(
      hasActiveBackgroundJob(stateDir, 'my-agent', '/unused', STALE_MS, jobsDir),
      true,
      'second call should be served from the (path, mtimeMs, size) cache, not the rewritten content',
    );
  } finally {
    cleanup(root);
  }
});
