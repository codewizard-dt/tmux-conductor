import { test, describe, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { cleanTerminalOutput, readLogTail, clampTailLines, TAIL_MAX_BYTES } from './bgOutput.ts';

// TASK-0192: cleanTerminalOutput is a pure function; readLogTail is exercised
// against throwaway files under the repo-local ./tmp (never /tmp or
// os.tmpdir(), never the real bg logs).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.resolve(__dirname, '../tmp');

const ESC = '\x1b';

void describe('cleanTerminalOutput', () => {
  void test('SGR colour sequences are removed', () => {
    assert.equal(cleanTerminalOutput(`${ESC}[31mred${ESC}[0m plain ${ESC}[1;38;5;208mbold${ESC}[m`), 'red plain bold');
  });

  void test('cursor-move and erase CSI sequences are removed', () => {
    assert.equal(cleanTerminalOutput(`a${ESC}[2Kb${ESC}[10;20Hc${ESC}[?25ld${ESC}[3A`), 'abcd');
  });

  void test('OSC title sequences are removed (BEL and ST terminated)', () => {
    assert.equal(cleanTerminalOutput(`${ESC}]0;my title\x07hello`), 'hello');
    assert.equal(cleanTerminalOutput(`${ESC}]2;other title${ESC}\\hello`), 'hello');
  });

  void test('an unterminated OSC stops at end of line and keeps following lines', () => {
    assert.equal(cleanTerminalOutput(`${ESC}]0;cut off title\nnext`), '\nnext');
  });

  void test('other two-byte escapes and charset designations are removed', () => {
    assert.equal(cleanTerminalOutput(`${ESC}7save${ESC}8${ESC}(Bx${ESC}=y`), 'savexy');
  });

  void test('a \\r-redrawn progress line collapses to its last frame', () => {
    assert.equal(cleanTerminalOutput('10%\r50%\r100% done\nnext'), '100% done\nnext');
  });

  void test('\\r\\n line endings are preserved as line breaks, not wiped', () => {
    assert.equal(cleanTerminalOutput('one\r\ntwo\r\nthree'), 'one\ntwo\nthree');
    assert.equal(cleanTerminalOutput('one\r\r\ntwo'), 'one\ntwo');
  });

  void test('a redraw followed by CRLF keeps the last frame', () => {
    assert.equal(cleanTerminalOutput('a\rb\rfinal\r\nnext'), 'final\nnext');
  });

  void test('UTF-8 multibyte text is unharmed', () => {
    const s = 'héllo 日本語 \u{1F680} ünïcödé';
    assert.equal(cleanTerminalOutput(`${ESC}[32m${s}${ESC}[0m`), s);
  });

  void test('--- restart ... --- marker lines pass through unchanged', () => {
    const marker = '--- restart 2026-09-19T10:00:00Z ---';
    assert.equal(cleanTerminalOutput(`before\n${marker}\nafter\n`), `before\n${marker}\nafter\n`);
  });

  void test('tabs and newlines survive; other control bytes (incl. backspace) are dropped', () => {
    assert.equal(cleanTerminalOutput('a\tb\nc\x00d\x07e\x08f\x7fg'), 'a\tb\ncdefg');
  });
});

void describe('clampTailLines', () => {
  void test('parses, clamps to 1..1000, and defaults on NaN', () => {
    assert.equal(clampTailLines('25'), 25);
    assert.equal(clampTailLines('0'), 1);
    assert.equal(clampTailLines('-5'), 1);
    assert.equal(clampTailLines('99999'), 1000);
    assert.equal(clampTailLines('abc'), 50);
    assert.equal(clampTailLines(undefined), 50);
    assert.equal(clampTailLines(undefined, 200), 200);
    assert.equal(clampTailLines(7), 7);
  });
});

void describe('readLogTail', () => {
  let dir: string;

  before(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    dir = fs.mkdtempSync(path.join(tmpRoot, 'bg-output-test-'));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeLog(name: string, content: string): string {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  void test('TAIL_MAX_BYTES defaults to 256 KiB', () => {
    assert.equal(TAIL_MAX_BYTES, 256 * 1024);
  });

  void test('a missing file yields empty lines, size 0, null updatedAt', async () => {
    const r = await readLogTail(path.join(dir, 'does-not-exist.log'), { lines: 10 });
    assert.deepEqual(r, { lines: [], truncated: false, sizeBytes: 0, updatedAt: null });
  });

  void test('an empty file yields empty lines with an mtime', async () => {
    const r = await readLogTail(writeLog('empty.log', ''), { lines: 10 });
    assert.deepEqual(r.lines, []);
    assert.equal(r.truncated, false);
    assert.equal(r.sizeBytes, 0);
    assert.equal(typeof r.updatedAt, 'string');
  });

  void test('a small file is cleaned, split on newline, and the final newline yields no empty tail line', async () => {
    const raw = `${ESC}[32mone${ESC}[0m\r\ntwo\r\nprog 1\rprog 2\rprog 3\r\n--- restart ---\n`;
    const r = await readLogTail(writeLog('small.log', raw), { lines: 50 });
    assert.deepEqual(r.lines, ['one', 'two', 'prog 3', '--- restart ---']);
    assert.equal(r.truncated, false);
    assert.equal(r.sizeBytes, Buffer.byteLength(raw));
    assert.ok(r.updatedAt && !Number.isNaN(Date.parse(r.updatedAt)));
  });

  void test('a file without a trailing newline keeps its last line', async () => {
    const r = await readLogTail(writeLog('nonl.log', 'a\nb\nc'), { lines: 50 });
    assert.deepEqual(r.lines, ['a', 'b', 'c']);
  });

  void test('lines clamp: fewer than available returns the last N; more than available returns all; <1 returns 1', async () => {
    const p = writeLog('clamp.log', Array.from({ length: 10 }, (_, i) => `l${String(i + 1)}`).join('\n') + '\n');
    assert.deepEqual((await readLogTail(p, { lines: 3 })).lines, ['l8', 'l9', 'l10']);
    assert.equal((await readLogTail(p, { lines: 5000 })).lines.length, 10);
    assert.deepEqual((await readLogTail(p, { lines: 0 })).lines, ['l10']);
    assert.deepEqual((await readLogTail(p, { lines: Number.NaN })).lines.length, 10);
  });

  void test('a log larger than maxBytes reports truncated and drops the leading partial line', async () => {
    const all = Array.from({ length: 20 }, (_, i) => `line-${String(i + 1).padStart(3, '0')}`);
    const p = writeLog('big.log', all.join('\n') + '\n'); // 9 bytes per line, 180 total
    const r = await readLogTail(p, { lines: 1000, maxBytes: 64 });
    assert.equal(r.truncated, true);
    assert.equal(r.sizeBytes, 180);
    assert.ok(r.lines.length > 0 && r.lines.length < 20);
    for (const l of r.lines) assert.match(l, /^line-\d{3}$/); // no partial line survives
    assert.equal(r.lines[r.lines.length - 1], 'line-020');
    // Window starts at byte 116, the "\n" ending line-013 (line-013 spans 108..116),
    // so line-013 is dropped as partial and line-014 is the first complete line.
    assert.equal(r.lines[0], 'line-014');
  });

  void test('a window that begins exactly on a line boundary keeps that line', async () => {
    const p = writeLog('aligned.log', 'aaa\nbbb\nccc\n');
    const r = await readLogTail(p, { lines: 10, maxBytes: 8 }); // exactly "bbb\nccc\n"
    assert.equal(r.truncated, true);
    assert.deepEqual(r.lines, ['bbb', 'ccc']);
  });

  void test('a file exactly maxBytes long is not truncated', async () => {
    const p = writeLog('exact.log', 'aaa\nbbb\n');
    const r = await readLogTail(p, { lines: 10, maxBytes: 8 });
    assert.equal(r.truncated, false);
    assert.deepEqual(r.lines, ['aaa', 'bbb']);
  });

  void test('a multibyte char split at the window boundary never garbles the kept lines', async () => {
    const all = Array.from({ length: 12 }, (_, i) => `日本語日本語-${String(i + 1).padStart(2, '0')}`);
    const p = writeLog('utf8.log', all.join('\n') + '\n');
    // Sweep window sizes so the boundary lands on every byte offset of the multibyte chars.
    for (let maxBytes = 22; maxBytes <= 80; maxBytes++) {
      const r = await readLogTail(p, { lines: 1000, maxBytes });
      assert.equal(r.truncated, true, `maxBytes=${String(maxBytes)}`);
      for (const l of r.lines) {
        assert.ok(!l.includes('�'), `replacement char at maxBytes=${String(maxBytes)}: ${l}`);
        assert.match(l, /^日本語日本語-\d{2}$/, `maxBytes=${String(maxBytes)}`);
      }
      assert.equal(r.lines[r.lines.length - 1], '日本語日本語-12');
    }
  });

  void test('a single line longer than the window yields no lines but truncated: true', async () => {
    const p = writeLog('long.log', 'x'.repeat(500) + '\n');
    const r = await readLogTail(p, { lines: 10, maxBytes: 64 });
    assert.equal(r.truncated, true);
    assert.deepEqual(r.lines, []);
  });
});
