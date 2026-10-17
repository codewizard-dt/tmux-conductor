// TASK-0222 / UAT-0222: scope guards around agent.lastPrompt that the reader and
// parity tests do not cover.
//  - the partial one-shot 'agent-update' payloads (spawn / clone / project-create /
//    rename, all `...ctx` spreads) stay lastPrompt-free (an omitted field means
//    "unchanged" to the frontend merge; TASK-0215 owns bringing them to parity, and
//    will need to relax test 1 when it does),
//  - DELETE /agents/:id/window keeps the hook sidecar (the agent survives),
//  - activeTask / getActiveTask / the status contract are unchanged and independent
//    of the sidecar,
//  - the stored prompt value is never logged.
import { test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { getActiveTask } from './state.ts';
import type { ConductorConf } from './config.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

const TMP_ROOT = path.join(process.cwd(), 'tmp');
let dir = '';

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  dir = fs.mkdtempSync(path.join(TMP_ROOT, 'last-prompt-contract-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Source of the first `{ ... }` function/handler body that starts at `opener`, up to its closing `\n  });` or `\n}`. */
function sliceFrom(source: string, opener: string, terminator: RegExp): string {
  const start = source.indexOf(opener);
  assert.ok(start >= 0, `opener not found: ${opener}`);
  const rest = source.slice(start);
  const m = terminator.exec(rest);
  assert.ok(m, `terminator not found after: ${opener}`);
  return rest.slice(0, m.index + m[0].length);
}

void test('the partial one-shot agent-update payloads (...ctx spreads) do not carry lastPrompt', () => {
  const payloads = [...indexSource.matchAll(/broadcastSSE\('agent-update', \{\n[^}]*?\}\);/g)].map((m) => m[0]);
  const partial = payloads.filter((p) => p.includes('...ctx'));
  // TASK-0222 shipped five inline `...ctx` payloads (spawn, clone, project-create,
  // rename, respawn). TASK-0215 is moving the new-agent ones behind buildNewAgentUpdate,
  // so the count is deliberately not pinned: the guard is "no inline partial payload
  // carries lastPrompt", and the full builders below must still be found.
  for (const p of partial) {
    assert.doesNotMatch(p, /lastPrompt/, `partial payload unexpectedly carries lastPrompt:\n${p}`);
  }
  // The two full builders (no ...ctx spread) are the ones that do carry it.
  const full = payloads.filter((p) => !p.includes('...ctx'));
  assert.ok(full.some((p) => p.includes('lastPrompt: agent.lastPrompt,')), 'periodic broadcast must carry lastPrompt');
  assert.ok(indexSource.includes("sendSSE(reply, 'agent-update', {") && /sendSSE\(reply, 'agent-update', \{[\s\S]{0,1500}?lastPrompt: agent\.lastPrompt,/.test(indexSource), 'connect replay must carry lastPrompt');
});

void test('the GET /status no-session fallback reports lastPrompt: null on each agent', () => {
  assert.match(
    indexSource,
    /activeTask: null,\s*\n\s+lastPrompt: null,\s*\n\s+label: null,[\s\S]{0,400}?sessionAlive: false,\s*\n\s+sessionExists: false,\s*\n\s+agents: agentStatuses,/,
    'expected the no-session /status fallback to hand-build lastPrompt: null',
  );
});

void test('pollAndDiff decides whether to broadcast via agentSnapshotChanged, and agentDiff.ts stays import-free of index.ts', () => {
  assert.match(indexSource, /const prev = prevSnapshot\.agents\.find\(\(a\) => a\.id === agent\.id\);\s*\n\s+if \(agentSnapshotChanged\(prev, agent\)\) \{/);
  const diffSource = fs.readFileSync(path.join(__dirname, 'agentDiff.ts'), 'utf8');
  assert.doesNotMatch(diffSource, /from ['"]\.\/index/, 'agentDiff.ts must not import from index.ts (cycle)');
  assert.match(diffSource, /prev\.lastPrompt\?\.ts !== next\.lastPrompt\?\.ts/);
  assert.match(diffSource, /prev\.lastPrompt\?\.text !== next\.lastPrompt\?\.text/);
});

void test('DELETE /agents/:id/window keeps the sidecar; DELETE /agents/:id removes it', () => {
  const windowHandler = sliceFrom(indexSource, "api.delete<{ Params: { id: string } }>('/agents/:id/window'", /\n {2}\}\);/);
  assert.match(windowHandler, /\.state`\)\); \} catch/, 'window-close handler must still unlink the .state file');
  assert.doesNotMatch(windowHandler, /removeLastPromptSidecar|\.meta\.json/, 'window-close must not remove the hook sidecar');

  const agentHandler = sliceFrom(indexSource, "api.delete<{ Params: { id: string } }>('/agents/:id', async", /\n {2}\}\);/);
  assert.match(agentHandler, /removeLastPromptSidecar\(stateDir, winName\);/, 'agent delete must remove the sidecar');
});

void test('activeTask is still computed by getActiveTask and broadcast unchanged', () => {
  assert.match(indexSource, /const activeTask = getActiveTask\(conf, wn, state\);/);
  assert.match(indexSource, /interface Snapshot \{[\s\S]{0,900}?activeTask: string \| null; lastPrompt: LastPrompt \| null;/);
  const replay = sliceFrom(indexSource, "sendSSE(reply, 'agent-update', {", /\}\);/);
  const periodic = sliceFrom(indexSource, "broadcastSSE('agent-update', {\n        id: agent.id,", /\}\);/);
  for (const body of [replay, periodic]) {
    assert.match(body, /activeTask: agent\.activeTask,/);
    assert.match(body, /lastPrompt: agent\.lastPrompt,/);
  }
});

void test('the status contract and getActiveTask know nothing about lastPrompt', () => {
  const contract = sliceFrom(indexSource, 'function buildAgentStatusContract(', /\n\}\n/);
  assert.doesNotMatch(contract, /lastPrompt|last_prompt/);
  const stateSource = fs.readFileSync(path.join(__dirname, 'state.ts'), 'utf8');
  const getActiveTaskSource = sliceFrom(stateSource, 'export function getActiveTask(', /\n\}\n/);
  assert.doesNotMatch(getActiveTaskSource, /lastPrompt|last_prompt|meta\.json/);
});

void test('getActiveTask output is independent of a last_prompt sidecar', () => {
  const win = 'agent-x';
  const logDir = path.join(dir, 'logs');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(logDir, 'dispatch.jsonl'), JSON.stringify({ ts: now, agent: win, command: 'do the dispatched thing' }) + '\n');
  fs.writeFileSync(path.join(stateDir, `${win}.state`), 'busy\n');
  const conf = { logDir, stateDir } as unknown as ConductorConf;

  const without = getActiveTask(conf, win, 'busy');
  fs.writeFileSync(
    path.join(stateDir, `${win}.meta.json`),
    JSON.stringify({ last_prompt: { text: 'typed by a human', ts: now } }),
  );
  const withSidecar = getActiveTask(conf, win, 'busy');

  assert.equal(without, 'do the dispatched thing');
  assert.equal(withSidecar, without, 'a sidecar last_prompt must not change activeTask');
  assert.equal(getActiveTask(conf, win, 'idle'), null, 'idle agents still have no activeTask');
});

void test('nothing logs the stored prompt value (console / JSONL loggers never see lastPrompt)', () => {
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  assert.ok(files.includes('lastPrompt.ts') && files.includes('index.ts'));
  for (const f of files) {
    const lines = fs.readFileSync(path.join(__dirname, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/lastPrompt|last_prompt/.test(line) && /console\.|appendFileSync|logTransition|dispatch\.jsonl|transitions\.jsonl/.test(line)) {
        assert.fail(`${f}:${String(i + 1)} logs or persists lastPrompt: ${line.trim()}`);
      }
    });
  }
  const reader = fs.readFileSync(path.join(__dirname, 'lastPrompt.ts'), 'utf8');
  assert.doesNotMatch(reader.replace(/\/\/[^\n]*/g, ''), /console\./, 'the reader must not use console');
});
