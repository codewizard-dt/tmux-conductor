import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { ROLE_VALUES, getRoleFragment, applyRoleFragmentToWorktree } from './rolePresets.ts';
import { createWorktree } from './git.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(__dirname, '../tmp');
const rolePresetsSourcePath = path.join(__dirname, 'rolePresets.ts');

function git(dir: string, ...args: string[]): void {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
}

/**
 * Create a throwaway git repo under ./tmp (never /tmp, per this repo's
 * mandatory scratch-file convention) with the given initial branch and one
 * commit. Mirrors git.test.ts's makeRepo() helper.
 */
function makeRepo(label: string, initialBranch: string): string {
  fs.mkdirSync(tmpDir, { recursive: true });
  const rand = Math.random().toString(36).slice(2, 10);
  const dir = fs.mkdtempSync(path.join(tmpDir, `task113-${label}-${rand}-`));
  git(dir, 'init', '-b', initialBranch);
  git(
    dir,
    '-c', 'user.email=uat@test.local',
    '-c', 'user.name=UAT',
    'commit', '--allow-empty', '-m', 'init',
  );
  return dir;
}

/**
 * Creates a scratch directory under ./tmp containing a byte-identical copy
 * of rolePresets.ts's *current* source (read fresh from disk on every call,
 * never hardcoded here) plus a small driver script that imports the copy
 * and prints getRoleFragment('generic'). The real host-server/rolePresets.ts
 * and host-server/role-presets.json are never read for writing, moved, or
 * modified — only this scratch copy is touched, so concurrent work on the
 * real files elsewhere in the repo is unaffected.
 *
 * Pass `jsonContents` to write a role-presets.json alongside the copy (e.g.
 * malformed JSON); omit it to exercise the absent-file fallback path.
 */
function makeScratchModule(label: string, jsonContents?: string, driverRoles: string[] = ['generic']): string {
  fs.mkdirSync(tmpDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(tmpDir, `rolePresets-${label}-`));
  const source = fs.readFileSync(rolePresetsSourcePath, 'utf8');
  fs.writeFileSync(path.join(dir, 'rolePresets.ts'), source, 'utf8');
  if (jsonContents !== undefined) {
    fs.writeFileSync(path.join(dir, 'role-presets.json'), jsonContents, 'utf8');
  }
  const driverPath = path.join(dir, 'driver.ts');
  // One getRoleFragment(...) call per requested role, each writing its own
  // line to stdout (in order) so a test can compare multiple roles' output
  // from the same scratch environment (e.g. proving a missing/empty key
  // falls back to exactly the generic fragment) without asserting on prose.
  const calls = driverRoles
    .map((r) => `process.stdout.write(getRoleFragment(${JSON.stringify(r)}) + '\\n');`)
    .join('\n');
  fs.writeFileSync(
    driverPath,
    `import { getRoleFragment } from './rolePresets.ts';\n${calls}\n`,
    'utf8',
  );
  return driverPath;
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

void test('getRoleFragment returns a non-empty string for every ROLE_VALUES entry', () => {
  for (const role of ROLE_VALUES) {
    const fragment = getRoleFragment(role);
    assert.equal(typeof fragment, 'string');
    assert.ok(fragment.length > 0, `expected a non-empty fragment for role "${role}"`);
  }
});

void test("getRoleFragment('nonexistent-role') falls back to the same fragment as getRoleFragment('generic')", () => {
  assert.equal(getRoleFragment('nonexistent-role'), getRoleFragment('generic'));
});

void test('getRoleFragment degrades to a non-empty fallback (never throws) when role-presets.json is absent', () => {
  const driverPath = makeScratchModule('missing-file');
  const dir = path.dirname(driverPath);
  try {
    const result = spawnSync('node', ['--import', 'tsx/esm', driverPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, `subprocess exited with status ${String(result.status)}: ${result.stderr}`);
    assert.ok(result.stdout.length > 0, 'expected non-empty stdout from getRoleFragment fallback');
  } finally {
    cleanup(dir);
  }
});

void test('getRoleFragment degrades to a non-empty fallback (never throws) when role-presets.json is malformed JSON', () => {
  const driverPath = makeScratchModule('malformed-json', '{ not valid json');
  const dir = path.dirname(driverPath);
  try {
    const result = spawnSync('node', ['--import', 'tsx/esm', driverPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, `subprocess exited with status ${String(result.status)}: ${result.stderr}`);
    assert.ok(result.stdout.length > 0, 'expected non-empty stdout from getRoleFragment fallback');
  } finally {
    cleanup(dir);
  }
});

void test("getRoleFragment('') falls back to the same fragment as getRoleFragment('generic')", () => {
  assert.equal(getRoleFragment(''), getRoleFragment('generic'));
});

void test('getRoleFragment never throws for null/undefined role (type-violating input) and falls back to generic', () => {
  const loose = getRoleFragment as unknown as (role: string | null | undefined) => string;
  assert.doesNotThrow(() => { loose(null); });
  assert.doesNotThrow(() => { loose(undefined); });
  assert.equal(loose(null), getRoleFragment('generic'));
  assert.equal(loose(undefined), getRoleFragment('generic'));
});

void test('getRoleFragment degrades to a non-empty fallback (never throws) when role-presets.json parses to a non-object (JSON array)', () => {
  const driverPath = makeScratchModule('non-object-array', '[1,2,3]');
  const dir = path.dirname(driverPath);
  try {
    const result = spawnSync('node', ['--import', 'tsx/esm', driverPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, `subprocess exited with status ${String(result.status)}: ${result.stderr}`);
    assert.ok(result.stdout.trim().length > 0, 'expected non-empty stdout from getRoleFragment fallback');
  } finally {
    cleanup(dir);
  }
});

void test('getRoleFragment degrades to a non-empty fallback (never throws) when role-presets.json parses to a non-object (JSON string)', () => {
  const driverPath = makeScratchModule('non-object-string', '"just a string"');
  const dir = path.dirname(driverPath);
  try {
    const result = spawnSync('node', ['--import', 'tsx/esm', driverPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, `subprocess exited with status ${String(result.status)}: ${result.stderr}`);
    assert.ok(result.stdout.trim().length > 0, 'expected non-empty stdout from getRoleFragment fallback');
  } finally {
    cleanup(dir);
  }
});

void test("getRoleFragment('qa') falls back to exactly the generic fragment when role-presets.json is missing the 'qa' key", () => {
  const json = JSON.stringify({
    generic: 'Generic fragment for scratch test.',
    frontend: 'Frontend fragment.',
    backend: 'Backend fragment.',
    // qa intentionally omitted
    devops: 'Devops fragment.',
    security: 'Security fragment.',
    architect: 'Architect fragment.',
  });
  const driverPath = makeScratchModule('missing-key-qa', json, ['qa', 'generic']);
  const dir = path.dirname(driverPath);
  try {
    const result = spawnSync('node', ['--import', 'tsx/esm', driverPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, `subprocess exited with status ${String(result.status)}: ${result.stderr}`);
    const parts = result.stdout.split('\n');
    const qaOut = parts[0] ?? '';
    const genericOut = parts[1] ?? '';
    assert.ok(qaOut.length > 0, 'expected a non-empty fragment for the missing qa key');
    assert.equal(qaOut, genericOut, "expected the missing 'qa' key to fall back to exactly the generic fragment");
  } finally {
    cleanup(dir);
  }
});

void test("getRoleFragment('security') falls back to exactly the generic fragment when role-presets.json has an empty-string value for 'security'", () => {
  const json = JSON.stringify({
    generic: 'Generic fragment for scratch test.',
    frontend: 'Frontend fragment.',
    backend: 'Backend fragment.',
    qa: 'QA fragment.',
    devops: 'Devops fragment.',
    security: '',
    architect: 'Architect fragment.',
  });
  const driverPath = makeScratchModule('empty-value-security', json, ['security', 'generic']);
  const dir = path.dirname(driverPath);
  try {
    const result = spawnSync('node', ['--import', 'tsx/esm', driverPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, `subprocess exited with status ${String(result.status)}: ${result.stderr}`);
    const parts = result.stdout.split('\n');
    const securityOut = parts[0] ?? '';
    const genericOut = parts[1] ?? '';
    assert.ok(securityOut.length > 0, 'expected a non-empty fragment for the empty-string security value');
    assert.equal(securityOut, genericOut, "expected an empty-string 'security' value to fall back to exactly the generic fragment");
  } finally {
    cleanup(dir);
  }
});

void test("ROLE_VALUES matches the role enum in host-server/db.ts's agents.role CHECK constraint exactly", () => {
  const dbSource = fs.readFileSync(path.join(__dirname, 'db.ts'), 'utf8');
  const match = /CHECK \(role IN \(([^)]+)\)\)/.exec(dbSource);
  assert.ok(match, 'expected to find the agents.role CHECK constraint in db.ts');
  const dbRoles = (match[1] ?? '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort();
  const presetRoles = [...ROLE_VALUES].sort();
  assert.deepEqual(presetRoles, dbRoles, "rolePresets.ts's ROLE_VALUES has drifted from db.ts's CHECK constraint");
});

// TASK-115: index.ts's POST /agents used to declare its own local
// VALID_AGENT_ROLES array, independently of rolePresets.ts's ROLE_VALUES —
// this test used to diff the two for drift. TASK-115 refactored both
// role-validating routes (POST /agents and the newly-role-aware
// POST /projects/:id/agents) to import and reuse ROLE_VALUES directly, so
// the duplicate array this test diffed against no longer exists — drift is
// now structurally impossible rather than merely detected after the fact.
// Assert the stronger invariant: index.ts imports ROLE_VALUES, never
// re-declares a local copy, and both routes' validation actually uses it.
void test("host-server/index.ts's role validation imports and reuses rolePresets.ts's ROLE_VALUES (no local duplicate enum)", () => {
  const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
  assert.match(
    indexSource,
    /import \{ ROLE_VALUES \} from '\.\/rolePresets\.ts';/,
    'expected index.ts to import ROLE_VALUES from rolePresets.ts',
  );
  assert.doesNotMatch(
    indexSource,
    /VALID_AGENT_ROLES/,
    "index.ts should no longer declare its own VALID_AGENT_ROLES array — both role-validating routes reuse rolePresets.ts's ROLE_VALUES instead",
  );
  const roleChecks = indexSource.match(/ROLE_VALUES\.includes\(role\)/g) ?? [];
  assert.ok(
    roleChecks.length >= 2,
    `expected at least 2 call sites validating role against ROLE_VALUES (POST /agents and POST /projects/:id/agents), found ${String(roleChecks.length)}`,
  );
});

void test('role-presets.json has all 7 ROLE_VALUES keys, each a substantive non-empty fragment (no prose-content assertion)', () => {
  const raw = fs.readFileSync(path.join(__dirname, 'role-presets.json'), 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  for (const role of ROLE_VALUES) {
    assert.ok(Object.prototype.hasOwnProperty.call(parsed, role), `role-presets.json is missing the "${role}" key`);
    const value = parsed[role];
    assert.equal(typeof value, 'string', `role-presets.json's "${role}" value must be a string`);
    assert.ok((value as string).length > 40, `role-presets.json's "${role}" fragment looks too short to be substantive guidance (got ${String((value as string).length)} chars)`);
  }
});

void test('applyRoleFragmentToWorktree appends the role fragment to the worktree CLAUDE.md and never modifies the source repo CLAUDE.md', () => {
  const repo = makeRepo('applyfrag', 'main');
  const worktreePath = path.join(tmpDir, `task113-wt-${Math.random().toString(36).slice(2, 10)}`);
  const sourceClaudeMd = '# Source Repo Instructions\n\nDo not touch this file.\n';
  try {
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), sourceClaudeMd, 'utf8');
    git(repo, 'add', 'CLAUDE.md');
    git(
      repo,
      '-c', 'user.email=uat@test.local',
      '-c', 'user.name=UAT',
      'commit', '-m', 'add CLAUDE.md',
    );

    const ok = createWorktree(repo, worktreePath, 'conductor/task113-agent');
    assert.equal(ok, true);

    applyRoleFragmentToWorktree(worktreePath, 'backend');

    const worktreeClaudeMd = fs.readFileSync(path.join(worktreePath, 'CLAUDE.md'), 'utf8');
    assert.ok(worktreeClaudeMd.includes(sourceClaudeMd), 'worktree CLAUDE.md should retain the original source content');
    assert.ok(worktreeClaudeMd.includes('## Role: backend'), 'worktree CLAUDE.md should contain the "## Role: backend" heading');
    assert.ok(worktreeClaudeMd.includes(getRoleFragment('backend')), 'worktree CLAUDE.md should contain the backend role fragment');

    // Never-skippable safety assertion (TASK-113's core invariant): the
    // SOURCE repo's CLAUDE.md — at gitRoot, NOT worktreePath — must be
    // byte-for-byte unchanged after applyRoleFragmentToWorktree runs.
    const sourceClaudeMdAfter = fs.readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8');
    assert.strictEqual(sourceClaudeMdAfter, sourceClaudeMd, 'applyRoleFragmentToWorktree must never modify the source repo CLAUDE.md');
  } finally {
    // `git worktree add` registers the path with the main repo; prune the
    // registration before removing the directory tree so the fixture repo
    // itself is left clean for any later test in this process.
    spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktreePath], { encoding: 'utf8' });
    cleanup(worktreePath);
    cleanup(repo);
  }
});

// UAT-113: the Approach section explicitly leaves the 'generic' vs. skip
// decision to the implementer as long as it's deliberate and documented —
// TASK-113 chose to write generic's fragment too (not skip). Pin that choice
// so a future change can't silently flip it back to a skip without a test
// noticing.
void test("applyRoleFragmentToWorktree writes the 'generic' role's fragment too (not skipped)", () => {
  const repo = makeRepo('generic', 'main');
  const worktreePath = path.join(tmpDir, `task113-wt-generic-${Math.random().toString(36).slice(2, 10)}`);
  try {
    const ok = createWorktree(repo, worktreePath, 'conductor/task113-generic-agent');
    assert.equal(ok, true);

    applyRoleFragmentToWorktree(worktreePath, 'generic');

    const worktreeClaudeMd = fs.readFileSync(path.join(worktreePath, 'CLAUDE.md'), 'utf8');
    assert.ok(worktreeClaudeMd.includes('## Role: generic'), 'worktree CLAUDE.md should contain the "## Role: generic" heading');
    assert.ok(worktreeClaudeMd.includes(getRoleFragment('generic')), "worktree CLAUDE.md should contain generic's role fragment, not an empty/skipped section");
  } finally {
    spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktreePath], { encoding: 'utf8' });
    cleanup(worktreePath);
    cleanup(repo);
  }
});

// UAT-113: a CLAUDE.md write failure must log a warning and return normally
// (never throw), matching createAgent()'s existing best-effort convention
// for createWorktree() failures. Trigger a real fs failure — writeFileSync
// into a worktreePath whose directory does not exist — rather than mocking
// fs, so this exercises the actual try/catch in applyRoleFragmentToWorktree.
void test('applyRoleFragmentToWorktree logs a warning and does not throw when the CLAUDE.md write fails', () => {
  const nonexistentWorktreePath = path.join(tmpDir, `task113-does-not-exist-${Math.random().toString(36).slice(2, 10)}`, 'nested', 'worktree');
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try {
    assert.doesNotThrow(() => { applyRoleFragmentToWorktree(nonexistentWorktreePath, 'security'); });
    assert.equal(fs.existsSync(nonexistentWorktreePath), false, 'no directory should have been created as a side effect of the failed write');
    assert.equal(warnings.length, 1, 'expected exactly one console.warn call');
    assert.match(warnings[0] ?? '', /applyRoleFragmentToWorktree/, 'warning should identify the failing function');
    assert.match(warnings[0] ?? '', /security/, 'warning should mention the role that failed to write');
  } finally {
    console.warn = originalWarn;
  }
});

// TASK-167: PATCH /agents/:id (host-server/index.ts) accepts { name?, role? }
// and validates role the same way POST /agents does. index.ts is a
// top-level-await script that calls fastify.listen() unconditionally at
// import time (see host-server/sseRolePayloadParity.test.ts's own comment on
// this same constraint, and its "no harness to trigger deterministically"
// framing) — importing it here to exercise the route over real HTTP would
// also collide with a live dev-server instance already bound to its
// configured port. The route's own DB-layer behavior (a role/name update
// actually landing) is covered behaviorally in db.test.ts's
// updateAgentRole/updateAgentName tests instead; these pin the route's
// request-validation shape and branching statically, the same way the
// ROLE_VALUES-drift test above does.
void test('PATCH /agents/:id rejects an invalid role with the same "role must be one of: ..." message shape POST /agents uses', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
  const roleMessageOccurrences = indexSource.match(/role must be one of: \$\{ROLE_VALUES\.join\(', '\)\}/g) ?? [];
  assert.ok(
    roleMessageOccurrences.length >= 2,
    `expected the exact "role must be one of: \${ROLE_VALUES.join(', ')}" 400 error message at both POST /agents and PATCH /agents/:id, found ${String(roleMessageOccurrences.length)} occurrence(s)`,
  );
  assert.match(
    indexSource,
    /api\.patch<\{ Params: \{ id: string \}; Body: \{ name\?: string; role\?: string \} \}>\('\/agents\/:id',[\s\S]{0,600}?if \(newRole !== undefined && \(typeof newRole !== 'string' \|\| !ROLE_VALUES\.includes\(newRole\)\)\) \{\s*\n\s*return reply\.status\(400\)\.send\(\{ error: `role must be one of: \$\{ROLE_VALUES\.join\(', '\)\}` \}\);/,
    'expected PATCH /agents/:id to validate role against ROLE_VALUES and return a 400 with the "role must be one of: ..." message',
  );
});

void test('PATCH /agents/:id returns 400 when the body has neither name nor role', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
  assert.match(
    indexSource,
    /api\.patch<\{ Params: \{ id: string \}; Body: \{ name\?: string; role\?: string \} \}>\('\/agents\/:id',[\s\S]{0,300}?if \(newName === undefined && newRole === undefined\) \{\s*\n\s*return reply\.status\(400\)\.send\(\{ error: 'at least one of name or role is required' \}\);/,
    'expected PATCH /agents/:id to 400 with "at least one of name or role is required" when both fields are absent',
  );
});

void test('PATCH /agents/:id applies a name change and a role change independently (a body with both updates both, not just one)', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
  // The rename block is its own top-level `if`, gated on newName...
  assert.match(
    indexSource,
    /if \(newName !== undefined && newName !== oldName\) \{/,
    'expected PATCH /agents/:id to gate its rename logic on `newName !== undefined && newName !== oldName`',
  );
  // ...and closes with `renamed = true;` immediately followed by a SIBLING
  // (not nested — same indentation, not inside the rename block's braces)
  // `if (newRole !== undefined)` that independently calls updateAgentRole.
  // This is what makes a body carrying both name and role update both rather
  // than the role update being unreachable once a rename has run.
  assert.match(
    indexSource,
    /renamed = true;\n {4}\}\n\n {4}if \(newRole !== undefined\) \{\n {6}updated = updateAgentRole\(db, entry\.id, newRole\);\n {4}\}/,
    'expected the role-change `if` to immediately follow the rename block\'s closing brace at the same indentation (a sibling, not nested inside it) — the body-carries-both-fields case depends on this',
  );
});
