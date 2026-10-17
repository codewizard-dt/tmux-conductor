import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

// TASK-0197: the bg-to-agent link (`bg_processes.linked_agent_id`, `linkedAgent` API/status
// fields, CONDUCTOR_BG_* env injection, AGENT_BG_LINKS conf) is retired. These are static pins
// across the host-server, the shell scripts, conductor.conf and the frontend: they assert the
// retired identifiers no longer appear in executable code (comments may still explain the
// history). They deliberately never mention the DB column name, so they stay valid after
// TASK-0198 drops it.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

/** Strip `/* ... *\/` blocks and `//` comments (line-leading or trailing) from TS/TSX source. */
function stripJsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

/** Strip `#` comment lines (and trailing ` # ...`) from shell / conf source. */
function stripShellComments(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.replace(/\s+#\s.*$/, ''))
    .join('\n');
}

void test('TASK-0197: host-server code no longer reads, writes or exposes a bg-to-agent link', () => {
  const banned = /linkedAgent|linkedBg|agentBgLinks|bgLinks|AGENT_BG_LINKS|CONDUCTOR_BG_/;
  for (const rel of ['host-server/index.ts', 'host-server/db.ts', 'host-server/config.ts']) {
    const code = stripJsComments(read(rel));
    const hit = banned.exec(code);
    assert.equal(hit, null, `${rel} still references retired identifier '${hit?.[0] ?? ''}'`);
  }
});

void test('TASK-0197: POST/PATCH /bg-processes handlers do not destructure any link field', () => {
  const code = stripJsComments(read('host-server/index.ts'));
  const postStart = code.indexOf(`'/bg-processes', async (req, reply)`);
  const patchStart = code.indexOf(`'/bg-processes/:slug', async (req, reply)`);
  assert.ok(postStart !== -1 && patchStart !== -1 && postStart < patchStart, 'both bg handlers located');
  const postHead = code.slice(code.lastIndexOf('api.post<', postStart), postStart + 400);
  assert.doesNotMatch(postHead, /link/i, 'POST /bg-processes Body type / destructuring has no link field');
  const patchHead = code.slice(code.lastIndexOf('api.patch<', patchStart), patchStart + 400);
  assert.doesNotMatch(patchHead, /link/i, 'PATCH /bg-processes/:slug Body type / destructuring has no link field');
  // The 201 body of POST is `{ ok, bg: { slug, name, workdir, launchCmd, projectId } }` only.
  assert.match(code, /send\(\{ ok: true, bg: \{ slug, name, workdir, launchCmd, projectId \} \}\)/);
});

void test('TASK-0197: conductor.conf declares no AGENT_BG_LINKS', () => {
  const conf = stripShellComments(read('conductor.conf'));
  assert.doesNotMatch(conf, /AGENT_BG_LINKS/);
});

void test('TASK-0197: conductor.conf no longer claims agent-to-bg links live in SQLite (comments included)', () => {
  const raw = read('conductor.conf');
  assert.doesNotMatch(raw, /AGENT_BG_LINKS/);
  assert.doesNotMatch(raw, /agent\s*(?:↔|<->|-)\s*bg\s+links?/i, 'stale header comment still mentions agent<->bg links');
});

void test('TASK-0197: CLAUDE.md and scripts/README.md document the retirement', () => {
  for (const rel of ['CLAUDE.md', 'scripts/README.md']) {
    assert.match(read(rel), /bg-to-agent link is retired \(TASK-0197\)/, `${rel} records the retirement`);
  }
});

void test('TASK-0197: shell scripts inject no CONDUCTOR_BG_* and load_agents does not join bg_processes', () => {
  for (const rel of ['scripts/conductor.sh', 'scripts/spawn.sh', 'scripts/lib/db.sh']) {
    const code = stripShellComments(read(rel));
    const hit = /CONDUCTOR_BG_|AGENT_BG\b|_linked_bg|_bg_env/.exec(code);
    assert.equal(hit, null, `${rel} still references '${hit?.[0] ?? ''}'`);
  }
  const db = read('scripts/lib/db.sh');
  const start = db.indexOf('load_agents() {');
  const end = db.indexOf('\n}\n', start);
  assert.ok(start !== -1 && end > start, 'load_agents body located');
  const body = stripShellComments(db.slice(start, end));
  assert.doesNotMatch(body, /bg_processes|linked_agent_id/, 'load_agents no longer joins bg_processes');
  assert.match(body, /read -r name workdir cmd window_name agent_id project_id/, 'field list is the six agent fields');
});

void test('TASK-0197: frontend has no link input, type field, api field or "linked to" label', () => {
  for (const rel of [
    'frontend/src/components/AddBgProcessForm.tsx',
    'frontend/src/components/AgentList.tsx',
    'frontend/src/lib/api.ts',
  ]) {
    const code = stripJsComments(read(rel));
    const hit = /linkedAgent|Link to Agent|CONDUCTOR_BG_|linked to/.exec(code);
    assert.equal(hit, null, `${rel} still references '${hit?.[0] ?? ''}'`);
  }
});
