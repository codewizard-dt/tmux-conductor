// TASK-0222: agent.lastPrompt must ride the REST snapshot (buildSnapshot) and BOTH
// hand-maintained SSE 'agent-update' builders (GET /events connect replay and
// pollAndDiff's periodic broadcast), and be declared on the Snapshot type so the
// compiler flags a builder that omits it (BUG-0006 precedent for `role`).
// Source-regex checks in the style of sseRolePayloadParity.test.ts, each bounded to
// its own call opener so a match in one builder cannot satisfy another.
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

void test('the Snapshot inline agent type declares lastPrompt', () => {
  assert.match(
    indexSource,
    /interface Snapshot \{[\s\S]{0,800}?agents: Array<\{[^\n]*\blastPrompt: LastPrompt \| null;/,
    'expected the Snapshot agent type to declare `lastPrompt: LastPrompt | null`',
  );
});

void test("buildSnapshot's returned per-agent object includes lastPrompt", () => {
  assert.match(
    indexSource,
    /function buildSnapshot\(\): Snapshot \{[\s\S]{0,4500}?usage: usageByAgent\.get\(agent\.id\) \?\? null,\s*\n\s+lastPrompt,/,
    'expected buildSnapshot to return `lastPrompt,` in the per-agent object',
  );
});

void test('the SSE connect replay (GET /events) includes lastPrompt in its agent-update payload', () => {
  assert.match(
    indexSource,
    /sendSSE\(reply, 'agent-update', \{[\s\S]{0,1500}?\n\s+lastPrompt: agent\.lastPrompt,/,
    'expected the connect-replay agent-update payload to include `lastPrompt: agent.lastPrompt,`',
  );
});

void test("pollAndDiff's periodic broadcast includes lastPrompt", () => {
  assert.match(
    indexSource,
    /broadcastSSE\('agent-update', \{[\s\S]{0,1500}?\n\s+lastPrompt: agent\.lastPrompt,/,
    "expected the periodic broadcastSSE('agent-update', ...) payload to include `lastPrompt: agent.lastPrompt,`",
  );
});

void test('lastPrompt sits after usage/inGitRepo and never between worktreePath/branch/role in either SSE body', () => {
  // sseRolePayloadParity.test.ts requires worktreePath, branch, role adjacent in the periodic payload.
  assert.doesNotMatch(indexSource, /worktreePath: agent\.worktreePath,\s*\n\s*lastPrompt/);
  assert.doesNotMatch(indexSource, /branch: agent\.branch,\s*\n\s*lastPrompt/);
});

void test('the DELETE /agents/:id handler removes the hook sidecar', () => {
  assert.match(
    indexSource,
    /deleteAgent\(db, entry\.id\);[\s\S]{0,600}?removeLastPromptSidecar\(stateDir, winName\);/,
    'expected DELETE /agents/:id to call removeLastPromptSidecar(stateDir, winName)',
  );
});
