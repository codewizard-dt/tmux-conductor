import { test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  LAST_PROMPT_MAX_CHARS,
  __resetLastPromptCacheForTests,
  capLastPromptText,
  readLastPrompt,
  removeLastPromptSidecar,
} from './lastPrompt.ts';

// Fixtures live under the repo-local ./tmp (never /tmp).
const TMP_ROOT = path.join(process.cwd(), 'tmp');
let dir = '';

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  dir = fs.mkdtempSync(path.join(TMP_ROOT, 'last-prompt-'));
  __resetLastPromptCacheForTests();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const TS = '2026-09-20T10:00:00.000Z';

function writeMeta(name: string, meta: unknown): string {
  const file = path.join(dir, `${name}.meta.json`);
  fs.writeFileSync(file, typeof meta === 'string' ? meta : JSON.stringify(meta));
  return file;
}

void test('a valid sidecar yields { text, ts }', () => {
  writeMeta('a', { last_prompt: { text: 'hello world', ts: TS } });
  assert.deepEqual(readLastPrompt(dir, 'a'), { text: 'hello world', ts: TS });
});

void test('a missing file yields null', () => {
  assert.equal(readLastPrompt(dir, 'nope'), null);
});

void test('invalid JSON yields null', () => {
  writeMeta('a', '{ not json');
  assert.equal(readLastPrompt(dir, 'a'), null);
});

void test('a sidecar without last_prompt yields null', () => {
  writeMeta('a', { transcript_path: '/x.jsonl', model: 'm' });
  assert.equal(readLastPrompt(dir, 'a'), null);
});

void test('malformed last_prompt shapes each yield null', () => {
  const bad: unknown[] = [
    { text: '', ts: TS },
    { text: 42, ts: TS },
    { text: 'hi' },
    { text: 'hi', ts: 'not-a-date' },
    { text: 'hi', ts: 123 },
    'a string',
    ['array'],
    null,
  ];
  for (const lp of bad) {
    __resetLastPromptCacheForTests();
    writeMeta('a', { last_prompt: lp });
    assert.equal(readLastPrompt(dir, 'a'), null, JSON.stringify(lp));
  }
});

void test('text over the cap is truncated to exactly the cap (1999 + ellipsis)', () => {
  writeMeta('a', { last_prompt: { text: 'x'.repeat(5000), ts: TS } });
  const got = readLastPrompt(dir, 'a');
  assert.ok(got);
  assert.equal(got.text.length, LAST_PROMPT_MAX_CHARS);
  assert.equal(got.text, 'x'.repeat(LAST_PROMPT_MAX_CHARS - 1) + '…');
});

void test('capLastPromptText is idempotent and leaves text at the cap untouched', () => {
  const exact = 'y'.repeat(LAST_PROMPT_MAX_CHARS);
  assert.equal(capLastPromptText(exact), exact);
  const once = capLastPromptText('z'.repeat(9000));
  assert.equal(capLastPromptText(once), once);
});

void test('capLastPromptText never splits a surrogate pair at the cut', () => {
  // Emoji (2 UTF-16 units) positioned so its high surrogate lands at index 1998.
  const text = 'a'.repeat(LAST_PROMPT_MAX_CHARS - 2) + '😀' + 'tail';
  const got = capLastPromptText(text);
  assert.equal(got, 'a'.repeat(LAST_PROMPT_MAX_CHARS - 2) + '…');
  assert.ok(got.length <= LAST_PROMPT_MAX_CHARS);
});

void test('unrelated and unknown keys (incl. last_prompt.prompt_id) are ignored', () => {
  writeMeta('a', {
    transcript_path: '/x.jsonl',
    session_id: 's',
    ts: 'top-level',
    last_prompt: { text: 'hi', ts: TS, prompt_id: 'p-1', extra: { a: 1 } },
  });
  assert.deepEqual(readLastPrompt(dir, 'a'), { text: 'hi', ts: TS });
});

void test('multi-line and unicode text survive verbatim', () => {
  const text = '  first line\n\nsecond → línea ✓ 日本語 😀\n\tthird  ';
  writeMeta('a', { last_prompt: { text, ts: TS } });
  assert.equal(readLastPrompt(dir, 'a')?.text, text);
});

void test('cache: unchanged file (same mtime + size) is served from cache; a changed file is re-read', () => {
  // Pin mtime to a whole-second value so restoring it is exact (no sub-ms drift).
  const FIXED = 1_700_000_000;
  const file = writeMeta('a', { last_prompt: { text: 'AAAA', ts: TS } });
  fs.utimesSync(file, FIXED, FIXED);
  assert.equal(readLastPrompt(dir, 'a')?.text, 'AAAA');

  // Same-length rewrite with mtime forced back: the cache must still be served.
  fs.writeFileSync(file, JSON.stringify({ last_prompt: { text: 'BBBB', ts: TS } }));
  fs.utimesSync(file, FIXED, FIXED);
  assert.equal(readLastPrompt(dir, 'a')?.text, 'AAAA', 'served from cache');

  // Changed size (and mtime) is re-parsed.
  fs.writeFileSync(file, JSON.stringify({ last_prompt: { text: 'CCCCCC', ts: TS } }));
  assert.equal(readLastPrompt(dir, 'a')?.text, 'CCCCCC', 're-read after change');

  // The reset hook drops the cache: the forced-same-mtime rewrite is now seen.
  fs.utimesSync(file, FIXED, FIXED);
  assert.equal(readLastPrompt(dir, 'a')?.text, 'CCCCCC');
  fs.writeFileSync(file, JSON.stringify({ last_prompt: { text: 'DDDDDD', ts: TS } }));
  fs.utimesSync(file, FIXED, FIXED);
  assert.equal(readLastPrompt(dir, 'a')?.text, 'CCCCCC', 'still cached (same size + pinned mtime)');
  __resetLastPromptCacheForTests();
  assert.equal(readLastPrompt(dir, 'a')?.text, 'DDDDDD');
});

void test('a sidecar that disappears yields null on the next read (no stale cache)', () => {
  const file = writeMeta('a', { last_prompt: { text: 'hi', ts: TS } });
  assert.ok(readLastPrompt(dir, 'a'));
  fs.unlinkSync(file);
  assert.equal(readLastPrompt(dir, 'a'), null);
});

void test('removeLastPromptSidecar unlinks the file, invalidates the cache, and a later read is null', () => {
  const file = writeMeta('a', { last_prompt: { text: 'hi', ts: TS } });
  assert.ok(readLastPrompt(dir, 'a'));
  removeLastPromptSidecar(dir, 'a');
  assert.equal(fs.existsSync(file), false);
  assert.equal(readLastPrompt(dir, 'a'), null);
});

void test('removeLastPromptSidecar on a missing sidecar does not throw', () => {
  assert.doesNotThrow(() => {
    removeLastPromptSidecar(dir, 'never-existed');
  });
});
