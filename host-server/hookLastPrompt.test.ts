import { test, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// TASK-0221: the UserPromptSubmit hook persists the submitted prompt as
// `last_prompt: { text, ts }` in <stateDir>/<agent>.meta.json. These tests spawn
// the real hook scripts (hooks/on-prompt-submit.js, hooks/on-stop.js) with a
// temp state dir under ./tmp/, so they exercise the actual writeState path.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tmpRoot = path.join(repoRoot, 'tmp');
const AGENT = 'test-agent';
const CAP = 2000;

fs.mkdirSync(tmpRoot, { recursive: true });
const runRoot = fs.mkdtempSync(path.join(tmpRoot, 'hook-last-prompt-'));
after(() => {
  fs.rmSync(runRoot, { recursive: true, force: true });
});

interface Fixture {
  stateDir: string;
  logDir: string;
  metaFile: string;
  stateFile: string;
}

function makeFixture(): Fixture {
  const dir = fs.mkdtempSync(path.join(runRoot, 'case-'));
  const stateDir = path.join(dir, 'state');
  const logDir = path.join(dir, 'logs');
  return {
    stateDir,
    logDir,
    metaFile: path.join(stateDir, `${AGENT}.meta.json`),
    stateFile: path.join(stateDir, `${AGENT}.state`),
  };
}

function runHook(script: string, input: unknown, fx: Fixture, rawStdin = false) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['TMUX'];
  env['CONDUCTOR_AGENT_NAME'] = AGENT;
  env['CONDUCTOR_STATE_DIR'] = fx.stateDir;
  env['CONDUCTOR_LOG_DIR'] = fx.logDir;
  return spawnSync(process.execPath, [path.join(repoRoot, 'hooks', script)], {
    input: rawStdin ? String(input) : JSON.stringify(input),
    env,
    encoding: 'utf8',
  });
}

interface LastPrompt {
  text: string;
  ts: string;
  prompt_id?: string;
}
interface Meta {
  transcript_path?: string;
  session_id?: string;
  ts?: string;
  last_prompt?: LastPrompt;
}

function readMeta(fx: Fixture): Meta {
  return JSON.parse(fs.readFileSync(fx.metaFile, 'utf8')) as Meta;
}

function submit(fx: Fixture, prompt: unknown, extra: Record<string, unknown> = {}) {
  const res = runHook('on-prompt-submit.js', { session_id: 's1', transcript_path: '/t/s1.jsonl', prompt, ...extra }, fx);
  assert.equal(res.status, 0);
  return res;
}

function hasLoneSurrogate(s: string): boolean {
  return /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);
}

void test('on-prompt-submit stores prompt text and ts, keeps session fields, writes busy', () => {
  const fx = makeFixture();
  submit(fx, 'hello');
  const meta = readMeta(fx);
  const lp = meta.last_prompt;
  assert.ok(lp);
  assert.equal(lp.text, 'hello');
  assert.ok(!Number.isNaN(Date.parse(lp.ts)));
  assert.equal(new Date(lp.ts).toISOString(), lp.ts);
  assert.equal(lp.ts, meta.ts, 'last_prompt.ts agrees with meta.ts');
  assert.equal(meta.session_id, 's1');
  assert.equal(meta.transcript_path, '/t/s1.jsonl');
  assert.equal(fs.readFileSync(fx.stateFile, 'utf8').trim(), 'busy');
});

void test('prompt_id is stored when present', () => {
  const fx = makeFixture();
  submit(fx, 'hello', { prompt_id: 'pid-123' });
  assert.equal(readMeta(fx).last_prompt?.prompt_id, 'pid-123');
});

void test('multi-line prompt is stored verbatim', () => {
  const fx = makeFixture();
  const prompt = 'line one\nline two\n\n    indented line four\ttab';
  submit(fx, prompt);
  assert.equal(readMeta(fx).last_prompt?.text, prompt);
});

void test('a later prompt replaces an earlier one', () => {
  const fx = makeFixture();
  submit(fx, 'first');
  submit(fx, 'second');
  assert.equal(readMeta(fx).last_prompt?.text, 'second');
});

void test('on-stop without a prompt leaves last_prompt unchanged but refreshes meta.ts', async () => {
  const fx = makeFixture();
  submit(fx, 'keep me');
  const before = readMeta(fx);
  const beforeLast = JSON.stringify(before.last_prompt);
  await new Promise((r) => setTimeout(r, 5));
  const res = runHook('on-stop.js', { session_id: 's1', transcript_path: '/t/s1.jsonl' }, fx);
  assert.equal(res.status, 0);
  const afterMeta = readMeta(fx);
  assert.equal(JSON.stringify(afterMeta.last_prompt), beforeLast);
  assert.notEqual(afterMeta.ts, before.ts);
  assert.equal(fs.readFileSync(fx.stateFile, 'utf8').trim(), 'idle');
});

void test('empty, whitespace-only, missing and non-string prompts never overwrite', () => {
  const fx = makeFixture();
  // No last_prompt is created from a bad prompt on a fresh sidecar.
  for (const bad of ['', '   \n\t ', 123, null]) {
    submit(fx, bad);
    assert.equal(readMeta(fx).last_prompt, undefined, `created from ${JSON.stringify(bad)}`);
  }
  runHook('on-prompt-submit.js', { session_id: 's1' }, fx);
  assert.equal(readMeta(fx).last_prompt, undefined);

  submit(fx, 'real prompt');
  const stored = JSON.stringify(readMeta(fx).last_prompt);
  for (const bad of ['', '   \n\t ', 123, null]) {
    submit(fx, bad);
    assert.equal(JSON.stringify(readMeta(fx).last_prompt), stored, `overwritten by ${JSON.stringify(bad)}`);
  }
  runHook('on-prompt-submit.js', { session_id: 's1' }, fx);
  assert.equal(JSON.stringify(readMeta(fx).last_prompt), stored);
});

void test('a prompt longer than the cap is truncated to exactly the cap with one marker', () => {
  const fx = makeFixture();
  submit(fx, 'x'.repeat(2500));
  const text = readMeta(fx).last_prompt?.text ?? '';
  assert.equal(text.length, CAP);
  assert.equal(text, 'x'.repeat(CAP - 1) + '…');
});

void test('a prompt of exactly the cap is stored untouched', () => {
  const fx = makeFixture();
  const prompt = 'y'.repeat(CAP);
  submit(fx, prompt);
  assert.equal(readMeta(fx).last_prompt?.text, prompt);
});

void test('exit status is 0 for a corrupt pre-existing meta.json', () => {
  const fx = makeFixture();
  fs.mkdirSync(fx.stateDir, { recursive: true });
  fs.writeFileSync(fx.metaFile, '{not json', 'utf8');
  const res = submit(fx, 'after corrupt');
  assert.equal(res.status, 0);
  assert.equal(fs.readFileSync(fx.stateFile, 'utf8').trim(), 'busy');
  assert.equal(readMeta(fx).last_prompt?.text, 'after corrupt');
});

void test('exit status is 0 for non-JSON stdin and no sidecar is written', () => {
  const fx = makeFixture();
  const res = runHook('on-prompt-submit.js', 'this is not json', fx, true);
  assert.equal(res.status, 0);
  assert.equal(fs.readFileSync(fx.stateFile, 'utf8').trim(), 'busy');
  assert.equal(fs.existsSync(fx.metaFile), false);
});

void test('exit status is 0 when the state dir is unwritable', () => {
  const fx = makeFixture();
  fs.mkdirSync(path.dirname(fx.stateDir), { recursive: true });
  fs.writeFileSync(fx.stateDir, 'a file, not a directory', 'utf8');
  const res = runHook('on-prompt-submit.js', { prompt: 'x' }, fx);
  assert.equal(res.status, 0);
});

void test('paste-wrapped prompt is unwrapped to the inner text', () => {
  const fx = makeFixture();
  submit(fx, '\n\n<pasted_content id="1">\nline one\nline two\n</pasted_content id="1">\n');
  assert.equal(readMeta(fx).last_prompt?.text, 'line one\nline two');
});

void test('real TASK-0219 paste payload (indent and blank line inside) round-trips its inner text', () => {
  const fx = makeFixture();
  submit(
    fx,
    '\n\n<pasted_content id="8822">\npaste line one\npaste line two\n\n    paste indented line four\n</pasted_content id="8822">\n',
  );
  assert.equal(readMeta(fx).last_prompt?.text, 'paste line one\npaste line two\n\n    paste indented line four');
});

void test('typed text before and after a paste wrapper is preserved', () => {
  const fx = makeFixture();
  submit(fx, 'please review:\n\n<pasted_content id="2">\ndiff body\n</pasted_content id="2">\nthanks');
  assert.equal(readMeta(fx).last_prompt?.text, 'please review:\n\ndiff body\nthanks');
});

void test('a prompt that is only an empty paste wrapper does not overwrite', () => {
  const fx = makeFixture();
  submit(fx, 'previous');
  const stored = JSON.stringify(readMeta(fx).last_prompt);
  submit(fx, '\n\n<pasted_content id="3">\n\n</pasted_content id="3">\n');
  assert.equal(JSON.stringify(readMeta(fx).last_prompt), stored);
});

void test('a paste wrapper is unwrapped before the cap is applied', () => {
  const fx = makeFixture();
  submit(fx, `\n\n<pasted_content id="4">\n${'z'.repeat(2500)}\n</pasted_content id="4">\n`);
  assert.equal(readMeta(fx).last_prompt?.text, 'z'.repeat(CAP - 1) + '…');
});

void test('emoji and non-ASCII text round-trip verbatim', () => {
  const fx = makeFixture();
  const prompt = '"quoted" \'single\' `backtick` $VAR back\\slash 😀 café naïve 日本語';
  submit(fx, prompt);
  assert.equal(readMeta(fx).last_prompt?.text, prompt);
});

void test('a cut that lands inside a surrogate pair drops the dangling high surrogate', () => {
  const fx = makeFixture();
  // Emoji occupies indices 1998-1999; keeping CAP-1 = 1999 chars would end on its high surrogate.
  submit(fx, 'a'.repeat(1998) + '😀' + 'zzz');
  const text = readMeta(fx).last_prompt?.text ?? '';
  assert.equal(text, 'a'.repeat(1998) + '…');
  assert.equal(hasLoneSurrogate(text), false);
});

void test('a surrogate pair that fits entirely before the marker is kept whole', () => {
  const fx = makeFixture();
  // Emoji occupies indices 1997-1998; 1999 kept chars end on its low surrogate.
  submit(fx, 'a'.repeat(1997) + '😀' + 'zzzz');
  const text = readMeta(fx).last_prompt?.text ?? '';
  assert.equal(text, 'a'.repeat(1997) + '😀' + '…');
  assert.equal(text.length, CAP);
  assert.equal(hasLoneSurrogate(text), false);
});

void test('session-start and stop-failure events leave last_prompt unchanged', () => {
  const fx = makeFixture();
  submit(fx, 'keep me');
  const stored = JSON.stringify(readMeta(fx).last_prompt);
  for (const script of ['on-session-start.js', 'on-stop-failure.js', 'on-stop.js']) {
    const res = runHook(script, { session_id: 's1', transcript_path: '/t/s1.jsonl' }, fx);
    assert.equal(res.status, 0, script);
    assert.equal(JSON.stringify(readMeta(fx).last_prompt), stored, script);
  }
});

void test('the prompt text is never written to hooks.jsonl', () => {
  const fx = makeFixture();
  const secret = 'SECRET-PROMPT-TEXT-0221 with spaces';
  submit(fx, secret, { prompt_id: 'pid-secret-check' });
  const log = fs.readFileSync(path.join(fx.logDir, 'hooks.jsonl'), 'utf8');
  assert.ok(log.trim().length > 0, 'hooks.jsonl has a transition record');
  assert.equal(log.includes('SECRET-PROMPT-TEXT-0221'), false);
  assert.equal(log.includes('pid-secret-check'), false);
});

void test('a custom slash command prompt is stored as the raw typed text', () => {
  const fx = makeFixture();
  submit(fx, '/review-pr 123 --strict');
  assert.equal(readMeta(fx).last_prompt?.text, '/review-pr 123 --strict');
});
