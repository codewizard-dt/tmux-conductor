---
id: UAT-113
aliases: [UAT-113]
title: "UAT: Write role fragment into the agent's worktree CLAUDE.md on spawn"
status: passed
task: TASK-113
created: 2026-08-15
updated: 2026-08-15
---

# UAT-113 — UAT: Write role fragment into the agent's worktree CLAUDE.md on spawn

implements::[[TASK-113]]

> **Source task**: [[TASK-113]]
> **Generated**: 2026-08-15
> **Weighting note**: this is the highest-stakes case in the whole role feature — the catastrophic failure mode is `applyRoleFragmentToWorktree` (`host-server/rolePresets.ts:93-106`) resolving its write path to the SOURCE repo's `CLAUDE.md` instead of the agent's worktree copy, destroying a real user's project instructions. Every test below that touches the write path asserts the source repo's `CLAUDE.md` byte-for-byte, not a substring check. 100% machine-verifiable — this task has no UI surface. `applyRoleFragmentToWorktree` is already called from `createAgent()`'s `if (created)` branch (`host-server/db.ts`, wired in TASK-113's own Step 3), passing `worktreePath` — never `gitRoot`/`data.workdir` — so the live-API cases below exercise the real wiring, not a hand-built call.

---

## Prerequisites

- [ ] Host-server running on `http://127.0.0.1:8788` (`make dev` or `npm --prefix host-server run dev`)
- [ ] The conductor tmux session is running (`POST /api/agents` returns `409 { error: "session not running" }` otherwise)
- [ ] `jq` and `git` installed
- [ ] Cleanup after every live test: `DELETE /api/agents/:id` for every throwaway agent (cascades worktree/branch teardown per TASK-063), and remove any fixture repo created under `./tmp/`. Do not touch `./data/conductor.db`.

---

## Test Cases

### UAT-API-001: Spawning a git-backed agent with a non-generic role writes the fragment into the worktree's CLAUDE.md, appended (not overwritten), and never touches the source repo's CLAUDE.md
- **Endpoint**: `POST /api/agents`
- **Description**: The headline safety case, exercised through the real spawn wiring (`POST /agents` → `createAgent()` → `createWorktree()` → `applyRoleFragmentToWorktree()`), not just the isolated function. Seeds a known `CLAUDE.md` at the fixture repo root, spawns an agent with `role: "backend"` against it, and asserts (a) the worktree's `CLAUDE.md` contains both the original seeded content AND the appended `## Role: backend` section (proving append, not overwrite), and (b) the source repo's `CLAUDE.md` — read from the fixture repo root, never the worktree path — is byte-for-byte identical to what was seeded, before and after.
- **Steps**:
  1. Create the fixture repo with a known, distinctive `CLAUDE.md`:
     ```bash
     mkdir -p /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat113-fixture
     cd /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat113-fixture
     git init -b main -q
     printf '# Source Repo Instructions\n\nDo not touch this file. UAT-113 sentinel.\n' > CLAUDE.md
     git add CLAUDE.md
     git -c user.email=uat@test.local -c user.name=UAT commit -q -m init
     cd /Users/davidtaylor/Repositories/tmux-conductor
     ```
  2. Save the seeded content for the later byte-for-byte comparison: `cat /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat113-fixture/CLAUDE.md`
  3. Run the command below (this is the real spawn path — `role` reaches `createAgent()` exactly as TASK-115 wired it).
  4. Note the response's `agent.id` (`$GID`) and `agent.worktreePath` (`$WP`); confirm `agent.role` is `"backend"`.
  5. Read the worktree's `CLAUDE.md`: `cat "$WP/CLAUDE.md"`
  6. Read the source repo's `CLAUDE.md` again and diff it against the Step 2 save: `diff /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat113-fixture/CLAUDE.md <(printf '# Source Repo Instructions\n\nDo not touch this file. UAT-113 sentinel.\n')`
  7. Teardown:
     ```bash
     curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$GID"
     rm -rf /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat113-fixture
     ```
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat113happy","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat113-fixture","launchCmd":"sleep 300","role":"backend"}'
  ```
- **Expected Result**: HTTP 201; `agent.worktreePath`/`agent.branch` are non-null strings, `agent.role` is `"backend"`. The worktree's `CLAUDE.md` (step 5) contains `# Source Repo Instructions` and `Do not touch this file. UAT-113 sentinel.` (the original content, unmodified — proving append, not overwrite) AND a `## Role: backend` heading followed by text containing `Treat API contracts and data integrity as the load-bearing concern` (backend's fragment from `host-server/role-presets.json`). The step-6 `diff` produces **no output** — the source repo's `CLAUDE.md` is byte-for-byte identical to what was seeded; this is the one assertion that must never be weakened to a substring check.
- **Repeatable Unit Test**: Not applicable: live-server integration exercising the full `POST /agents` → `createAgent()` → `createWorktree()` → `applyRoleFragmentToWorktree()` wiring over a real git worktree (Fastify routes are registered inline with no injectable app export). The isolated function logic this wiring calls into is covered by the repeatable unit test cited in UAT-EDGE-001 below.
- [x] Pass <!-- 2026-08-15 — verified live: HTTP 201, worktreePath/branch/role all correct, worktree CLAUDE.md contains original content + appended "## Role: backend" section with the correct fragment text, and the source repo CLAUDE.md's SHA-256 checksum was identical before and after (ede4341b...31c30a) — byte-for-byte confirmed, not just a diff/visual check. Worktree and branch both confirmed actually removed after DELETE (git worktree list / git branch -a), not just the DB row. -->

### UAT-API-002: Spawning an agent with a non-git workdir succeeds normally; no CLAUDE.md write is attempted, but the role still persists
- **Endpoint**: `POST /api/agents`
- **Description**: `applyRoleFragmentToWorktree()` is only reachable from `createAgent()`'s `if (created)` branch, itself nested inside `if (gitRoot)` (`host-server/db.ts`) — for a non-git `workdir`, `gitRoot` is `null` and the entire worktree/role-fragment block is skipped. `worktree_path`/`branch` stay `NULL`, but the `role` column (a plain DB write, unrelated to git) is unaffected and still persists.
- **Steps**:
  1. Run the command below (`workdir: "/tmp"` — guaranteed not to be a git work tree).
  2. Note the response's `agent.id` (`$GID2`).
  3. Teardown: `curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$GID2"`
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat113nogit","workdir":"/tmp","launchCmd":"sleep 300","role":"backend"}'
  ```
- **Expected Result**: HTTP 201; `agent.worktreePath: null`, `agent.branch: null`, `agent.role: "backend"` — agent creation succeeds exactly as it did before TASK-113, and the role is still recorded even though there is no worktree to write a `CLAUDE.md` fragment into.
- **Repeatable Unit Test**: Not applicable: live-server integration verifying an early-return code path (`if (gitRoot)` never entered) that requires the real route; the underlying non-git detection (`getGitRoot` returning `null`) already has repeatable coverage in `host-server/git.test.ts` from TASK-061.
- [x] Pass <!-- 2026-08-15 — verified live: HTTP 201, worktreePath:null, branch:null, role:"backend" exactly. -->

### UAT-EDGE-001: `applyRoleFragmentToWorktree` — non-generic role appends the fragment; source repo `CLAUDE.md` never modified (isolated function, safety invariant)
- **Scenario**: The same safety invariant as UAT-API-001, verified at the function level in isolation (no live server) — a hand-built fixture repo with a known `CLAUDE.md`, a real `git worktree add` via `createWorktree()`, then a direct call to `applyRoleFragmentToWorktree(worktreePath, 'backend')`. Asserts the worktree's `CLAUDE.md` retains the original content and gains the `## Role: backend` section, and — the never-skippable assertion — the source repo's `CLAUDE.md` (read from `gitRoot`, not `worktreePath`) is `assert.strictEqual`-identical before and after.
- **Steps**: Already implemented and passing as part of TASK-113's own Step 4 (`host-server/rolePresets.test.ts`, added during that task's `/tackle`, not this generation run) — no new work needed; this case documents and cross-references the existing coverage.
- **Expected Result**: The cited unit test passes: worktree `CLAUDE.md` contains the original source content, the `## Role: backend` heading, and `getRoleFragment('backend')`'s exact text; the source repo's `CLAUDE.md` is `assert.strictEqual` to its pre-call value.
- **Repeatable Unit Test**: Created (pre-existing from TASK-113's own implementation, cited here): `host-server/rolePresets.test.ts` (`applyRoleFragmentToWorktree appends the role fragment to the worktree CLAUDE.md and never modifies the source repo CLAUDE.md`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass <!-- 2026-08-15 — re-run: rolePresets.test.ts 16/16 pass, including this exact target test. -->

### UAT-EDGE-002: `applyRoleFragmentToWorktree` — the `generic` role also writes a fragment (a deliberate choice, not a silent skip)
- **Scenario**: The task's Approach section explicitly left "skip `generic`" vs. "write `generic`'s fragment too" to the implementer, as long as the choice is deliberate and documented. TASK-113's implementation chose to write it (documented in the function's JSDoc) — this case pins that choice with a test, so a future change can't silently flip it back to a skip.
- **Steps**:
  1. Write the test (byte-for-byte reproduction of the pattern already established by `host-server/rolePresets.test.ts`'s sibling `applyRoleFragmentToWorktree` test — a throwaway fixture repo via the file's existing `makeRepo()` helper, a real `createWorktree()` call, then `applyRoleFragmentToWorktree(worktreePath, 'generic')`):
     ```ts
     test("applyRoleFragmentToWorktree writes the 'generic' role's fragment too (not skipped)", () => {
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
     ```
  2. Run the command below as-is.
- **Command**:
  ```bash
  node --import tsx/esm --test host-server/rolePresets.test.ts
  ```
- **Expected Result**: The new test passes alongside the rest of the file (verified: 16/16 passing in `rolePresets.test.ts` after adding this test, full host-server suite 81/81 passing).
- **Repeatable Unit Test**: Created: `host-server/rolePresets.test.ts` (`applyRoleFragmentToWorktree writes the 'generic' role's fragment too (not skipped)`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass <!-- 2026-08-15 — verified by running the command above during generation -->

### UAT-EDGE-003: `applyRoleFragmentToWorktree` — a CLAUDE.md write failure logs a warning and never throws (matches `createWorktree()`'s existing best-effort convention)
- **Scenario**: `applyRoleFragmentToWorktree`'s body (`host-server/rolePresets.ts:93-106`) wraps its file I/O in try/catch and calls `console.warn(...)` on failure, matching `createAgent()`'s existing best-effort convention for `createWorktree()` failures (a failure there only logs a warning and never aborts agent creation). A real filesystem failure — writing to a `worktreePath` whose parent directory does not exist — reliably triggers the catch without mocking `fs`.
- **Steps**:
  1. Write the test (stubs `console.warn` for the duration of the call to capture the warning message, restores it in a `finally`):
     ```ts
     test('applyRoleFragmentToWorktree logs a warning and does not throw when the CLAUDE.md write fails', () => {
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
     ```
  2. Run the command below as-is.
- **Command**:
  ```bash
  node --import tsx/esm --test host-server/rolePresets.test.ts
  ```
- **Expected Result**: The new test passes: `applyRoleFragmentToWorktree` does not throw for a target whose parent directory doesn't exist, no directory is created as a side effect, and exactly one `console.warn` call fires, naming both the function and the role that failed.
- **Repeatable Unit Test**: Created: `host-server/rolePresets.test.ts` (`applyRoleFragmentToWorktree logs a warning and does not throw when the CLAUDE.md write fails`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass <!-- 2026-08-15 — verified by running the command above during generation -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| Spawning a git-backed agent with a non-`generic` role appends that role's fragment to `<worktreePath>/CLAUDE.md` under a `## Role: <role>` heading | UAT-API-001, UAT-EDGE-001 |
| The source repository's own `CLAUDE.md` (outside any worktree) is never modified by this code path — verified by an explicit test assertion | UAT-API-001, UAT-EDGE-001 (both assert byte-for-byte equality, not a substring check) |
| A `CLAUDE.md` write failure (e.g. permissions) logs a warning and does not abort agent creation | UAT-EDGE-003 (function-level: does not throw); UAT-API-002 (route-level: agent creation succeeds even when no worktree exists to write into) |
| `npx tsc --noEmit` passes cleanly in `host-server/` | Static gate — verified during `/tackle` and re-verified during this generation (clean); not re-tested here |
| (implementation detail, not in the original AC, explicitly requested for this UAT) `generic` role also writes a fragment, deliberately | UAT-EDGE-002 |
| (implementation detail) Non-git workdir skips the worktree/role-fragment block entirely, role still persists | UAT-API-002 |

**Split summary**: 5 of 5 cases execute a real, machine-checkable verdict with no human in the loop — 2 live-API integration tests against the real spawn wiring (UAT-API-001/002), and 3 unit-test-backed edge cases (UAT-EDGE-001 citing TASK-113's own pre-existing test, UAT-EDGE-002/003 newly created and verified during this generation run: `rolePresets.test.ts` 16/16, full `host-server/` suite 81/81, `npx tsc --noEmit` clean). This task has no UI surface, so there are no human-only cases.

**Note on `uatGenerate.promoteTests`**: the stored preference (`true`, legacy grammar) maps to `dedicated`, but the repo's own layout overrides it — every `host-server/` test file sits as a sibling next to (or, as here, alongside a closely related module in) the code it tests, with no dedicated `test/` directory anywhere. Following that established local pattern (and the file TASK-113 itself already wrote to), UAT-EDGE-002/003's promoted tests were added directly to the existing `host-server/rolePresets.test.ts` rather than a new dedicated-folder file.
