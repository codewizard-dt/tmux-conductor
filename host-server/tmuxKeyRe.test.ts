import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

// index.ts starts the Fastify server (registers plugins and eventually calls
// `await listenWithRetry()` at module top level) as an import-time side effect, so it
// cannot be imported directly in a unit test — see sseRolePayloadParity.test.ts /
// rolePresets.test.ts / perfBudgets.test.ts for the established precedent of pinning
// this kind of server-wiring behavior via static assertions against the raw source
// text instead.
//
// Rather than hand-copying TMUX_KEY_RE's pattern here (which would drift silently the
// next time index.ts's copy changes — exactly the hazard this allowlist regex is
// documented to guard against, per wiki/knowledge/concepts/tmux-send-keys-key-names.md:
// "the only thing standing between a typo and garbage text being typed into a live
// agent's prompt — never widen it to a broad pattern, only an explicit enumeration"),
// this extracts the live regex literal straight out of index.ts's source text and
// reconstructs a real RegExp from it, so these assertions always exercise the actual
// current pattern.
const tmuxKeyReMatch = indexSource.match(/const TMUX_KEY_RE = \/(.+)\/;/);
assert.ok(tmuxKeyReMatch, 'expected to find a `const TMUX_KEY_RE = /.../;` definition in index.ts');
const TMUX_KEY_RE = new RegExp(tmuxKeyReMatch[1] ?? '');

// TASK-149: Ctrl+Arrow / Cmd+Arrow / Option(Alt)+Arrow terminal navigation added
// C-Left/C-Right/M-Left/M-Right (plus Up/Down alongside them) to this allowlist so the
// /agents/:agent/keys endpoint stops silently rejecting the new key names LogTail.tsx's
// mapKey() now forwards.
void test('TMUX_KEY_RE accepts the new C-Left/C-Right/M-Left/M-Right key names', () => {
  assert.equal(TMUX_KEY_RE.test('C-Left'), true);
  assert.equal(TMUX_KEY_RE.test('C-Right'), true);
  assert.equal(TMUX_KEY_RE.test('M-Left'), true);
  assert.equal(TMUX_KEY_RE.test('M-Right'), true);
});

void test('TMUX_KEY_RE accepts C-Up/C-Down/M-Up/M-Down (added alongside the arrow-left/right names)', () => {
  assert.equal(TMUX_KEY_RE.test('C-Up'), true);
  assert.equal(TMUX_KEY_RE.test('C-Down'), true);
  assert.equal(TMUX_KEY_RE.test('M-Up'), true);
  assert.equal(TMUX_KEY_RE.test('M-Down'), true);
});

void test('TMUX_KEY_RE still accepts pre-existing key names (regression guard)', () => {
  assert.equal(TMUX_KEY_RE.test('Enter'), true);
  assert.equal(TMUX_KEY_RE.test('Escape'), true);
  assert.equal(TMUX_KEY_RE.test('Left'), true);
  assert.equal(TMUX_KEY_RE.test('Right'), true);
  assert.equal(TMUX_KEY_RE.test('Home'), true);
  assert.equal(TMUX_KEY_RE.test('End'), true);
  assert.equal(TMUX_KEY_RE.test('C-c'), true);
  assert.equal(TMUX_KEY_RE.test('M-b'), true);
  assert.equal(TMUX_KEY_RE.test('F5'), true);
});

// TASK-0165: Cmd+Backspace/Option+Backspace were mapped to C-u/C-w specifically
// because both were already covered by the C-[a-z] class, avoiding any regex
// change. Asserted literally (not just inferred from the class via 'C-c')
// so that claim has direct evidence.
void test("TMUX_KEY_RE accepts C-u and C-w (TASK-0165's Cmd/Option+Backspace targets, already covered by the pre-existing C-[a-z] class)", () => {
  assert.equal(TMUX_KEY_RE.test('C-u'), true);
  assert.equal(TMUX_KEY_RE.test('C-w'), true);
});

void test('TMUX_KEY_RE rejects adjacent invalid strings (allowlist must stay an explicit enumeration, not widen to a broad pattern)', () => {
  assert.equal(TMUX_KEY_RE.test('C-Delete'), false);
  assert.equal(TMUX_KEY_RE.test('S-Left'), false);
  assert.equal(TMUX_KEY_RE.test('C-left'), false); // case-sensitive
  assert.equal(TMUX_KEY_RE.test('M-Lefty'), false);
  assert.equal(TMUX_KEY_RE.test('C-'), false);
  assert.equal(TMUX_KEY_RE.test(''), false);
});
