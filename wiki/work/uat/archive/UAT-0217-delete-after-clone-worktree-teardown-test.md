---
id: UAT-0217
aliases: [UAT-0217]
title: "UAT: Cover delete-after-clone worktree and branch teardown with a test"
status: passed
task: TASK-0217
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0217 — UAT: Cover delete-after-clone worktree and branch teardown with a test

implements::[[TASK-0217]]

> **Source task**: [[TASK-0217]]
> **Generated**: 2026-09-20

---

## Prerequisites

TASK-0217 is backend-only, so **every case here is unit-backed or a static check. No dev stack, browser, tmux session, or fixture agents are needed.** Each case runs one file- and name-scoped command from the repo root exactly as written (each starts with `cd`) and is judged from its recorded output. All the tests build throwaway git repos under `./tmp/` (`task217-*`) and remove them in `finally` blocks.

- [ ] `host-server/` dependencies installed (`node --import tsx/esm` resolves `tsx`) and `git` on `PATH` (verified with git 2.50.1).
- [ ] Do **not** run `db.migration.test.ts` unscoped. The task's own Step 3 command lists it, but it carries unrelated failures from other agents' concurrent work. Nothing in TASK-0217 changed that file, so no case here needs it.
- [ ] Do not run the whole `host-server` suite as evidence for any single case below; use the scoped command each case gives.

Source under test:
- `host-server/worktreeTeardown.ts`: `teardownAgentWorktree(entry)`, best-effort and never throws. It resolves `getGitRoot(entry.workdir) ?? path.dirname(path.dirname(entry.worktreePath))`, runs `removeWorktree`, runs `pruneWorktrees(gitRoot)` when that fails, then `deleteBranch`.
- `host-server/git.ts`: `pruneWorktrees(gitRoot): boolean` (`git worktree prune`).
- `host-server/index.ts`: `DELETE /agents/:id` calls `teardownAgentWorktree(entry)` and no longer runs `removeWorktree`/`deleteBranch` inline.
- Tests: `host-server/worktreeTeardown.test.ts` (6 tests, all names prefixed `TASK-0217:`) and two `pruneWorktrees` tests in `host-server/git.test.ts`.

Out of scope, on purpose: the HTTP route itself and the tmux window kill. The task assigns those to the live UAT in TASK-0218. The route is only pinned here at source level (EDGE-007).

Coverage note: the task's Objective has four parts. Each maps to a case:

| Objective clause | Case |
|---|---|
| Deleting a forced clone removes its worktree directory, git registration and `conductor/<cloneId>` branch, even with unmerged and uncommitted work | EDGE-001 |
| The source agent, its worktree/branch and the source repo's working tree stay untouched, and the reverse holds | EDGE-001, EDGE-002 |
| The teardown survives a hand-deleted directory without leaking the branch or the path (the latent leak the task fixes) | EDGE-003, EDGE-004, EDGE-005, EDGE-009 |
| A future change to path/branch derivation or to the DELETE route cannot silently leak worktrees | EDGE-006, EDGE-007, EDGE-008, EDGE-010 |

---

## Test Cases

### UAT-EDGE-001: Deleting a forced-worktree clone of a worktree-less agent removes its worktree, registration and branch, and leaves the source alone
- **Scenario**: A source agent lives in a real repo with no worktree. `cloneAgentRecord(db, source, { forceWorktree: true })` gives the clone `conductor/<cloneId>` and a worktree. The test commits a file and leaves an uncommitted file inside the clone's worktree (an unmerged branch plus a dirty tree), then runs `teardownAgentWorktree(clone)` and `deleteAgent`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The test passes (`pass 1`, `fail 0`). It asserts: the result is `{ removedWorktree: true, deletedBranch: true }`; the worktree directory no longer exists; `git worktree list` no longer lists it; `git branch --list conductor/<cloneId>` is empty; the source row still exists and the clone row is gone; the source workdir still exists; the source repo's `git status --porcelain` is empty; `main` still exists. The unmerged commit plus dirty file prove `--force` removal and `branch -D` (not `-d`).
- **Repeatable Unit Test**: Created: `host-server/worktreeTeardown.test.ts` (written by the TASK-0217 tackle; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="forced-worktree clone of a worktree-less" worktreeTeardown.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: A clone and its worktree-backed source tear down independently in both directions
- **Scenario**: The source is created with `useWorktree: true`, and a forced clone gets a second worktree. Tearing down the clone must leave the source's worktree directory, registration and `conductor/<sourceId>` branch intact. Then a second clone is created and the **source** is torn down, which must leave the second clone's worktree, registration and branch intact and its row alive.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The test passes (`pass 1`, `fail 0`). The clone and source worktree paths and branches are distinct. Both teardowns return `{ removedWorktree: true, deletedBranch: true }`. After each teardown only the torn-down agent's directory, registration and branch are gone, and the other agent's are all still present.
- **Repeatable Unit Test**: Created: `host-server/worktreeTeardown.test.ts` (TASK-0217 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="tear down independently" worktreeTeardown.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: Teardown after the worktree directory was removed by hand leaves no stale registration and no leaked branch
- **Scenario**: A clone's worktree directory is `rm -rf`'d by hand. Git still holds the registration, which is the state that made `git branch -D` refuse ("used by worktree") and made a later `git worktree add` for the same path fail. `teardownAgentWorktree` must end with the registration gone and the branch deleted, and must not warn that `git branch -D` failed.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The test passes (`pass 1`, `fail 0`). The precondition (stale registration present) holds. Afterwards: `result.deletedBranch` is `true`; the registration is gone; the branch is gone; no `git branch -D failed` warning was emitted; and `createWorktree(repo, worktreePath, branch)` succeeds again for the same path and branch (nothing leaked).
- **Known limit**: on git 2.50.1 `git worktree remove --force` already copes with a missing directory, so this end-state test passes even without the prune fallback. It is a real requirement check but it cannot by itself prove the fallback exists. EDGE-004 pins `pruneWorktrees` directly and EDGE-009 pins that the helper calls it.
- **Repeatable Unit Test**: Created: `host-server/worktreeTeardown.test.ts` (TASK-0217 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="removed by hand" worktreeTeardown.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: pruneWorktrees drops the stale registration of a hand-deleted worktree so its branch can then be deleted
- **Scenario**: This pins the `git.ts` half of the leak fix independently of git-version behaviour. After a worktree directory is deleted by hand, `deleteBranch` must first fail (the branch is still held by the stale registration). `pruneWorktrees(repo)` must then return `true`, `git worktree list` must no longer mention the worktree, and `deleteBranch` must now succeed.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The test `pruneWorktrees drops the registration of a hand-deleted worktree so its branch can be deleted` passes (`pass 1`, `fail 0`). The name pattern is anchored on the words "hand-deleted worktree" so it selects only this test.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (TASK-0217 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="hand-deleted worktree" git.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-005: pruneWorktrees is best-effort, returning false instead of throwing for a path that is not a git repo
- **Scenario**: `pruneWorktrees` must keep the same best-effort contract as `removeWorktree`. It returns a boolean and never throws, which is what lets the teardown helper stay non-blocking for the DB delete.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `pruneWorktrees returns false (without throwing) for a path that is not a git repo` passes (`pass 1`, `fail 0`).
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (TASK-0217 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="not a git repo" git.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-006: When the agent's workdir no longer exists, teardown falls back to the worktree's grandparent as the git root and still removes it
- **Scenario**: For an entry whose `workdir` is gone (`getGitRoot` returns null), the helper must use `path.dirname(path.dirname(worktreePath))`. The test builds the legacy in-repo layout `<repo>/worktrees/77` by hand, because the fallback resolves to the repo root only for that layout.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `when the workdir is gone, teardown falls back to <worktreePath>/../.. as the git root` passes (`pass 1`, `fail 0`). The result is `{ removedWorktree: true, deletedBranch: true }`, the directory is gone, the registration is gone and `conductor/77` no longer exists.
- **Repeatable Unit Test**: Created: `host-server/worktreeTeardown.test.ts` (TASK-0217 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="falls back to" worktreeTeardown.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-007: An agent with no worktree is skipped with no git side effects and no warnings
- **Scenario**: An entry with `worktreePath: null` must return `{ removedWorktree: false, deletedBranch: false }` and touch nothing, even when a stray `branch` value is set and a same-named branch exists in the repo. It must also not warn. The test compares `git worktree list --porcelain` before and after, and asserts the stray `conductor/5` branch survives.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `an agent without a worktree is skipped with no git side effects` passes (`pass 1`, `fail 0`).
- **Repeatable Unit Test**: Created: `host-server/worktreeTeardown.test.ts` (TASK-0217 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="without a worktree is skipped" worktreeTeardown.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-008: The DELETE /agents/:id handler delegates to teardownAgentWorktree and has no inline git teardown
- **Scenario**: The route body cannot be `inject`ed, so the test reads `host-server/index.ts` as text. It locates the `api.delete<…>('/agents/:id', async (req, reply) => {` handler and asserts its body contains `teardownAgentWorktree(` and contains neither `removeWorktree(` nor `deleteBranch(`. Without this guard, someone could re-inline the teardown and skip the prune step while every other test stays green.
- **Steps**:
  1. Run the unit test command below.
  2. Optionally confirm the wiring by eye: `host-server/index.ts` imports `teardownAgentWorktree` from `./worktreeTeardown.ts` and calls `teardownAgentWorktree(entry);` immediately before `deleteAgent(db, entry.id);`.
- **Expected Result**: `the DELETE /agents/:id handler delegates to teardownAgentWorktree and has no inline git teardown` passes (`pass 1`, `fail 0`).
- **Repeatable Unit Test**: Created: `host-server/worktreeTeardown.test.ts` (TASK-0217 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="handler delegates" worktreeTeardown.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-009: The helper prunes only after a failed remove, before the branch delete, and keeps its three original warning strings
- **Scenario**: EDGE-003 cannot fail without the prune fallback on modern git, so nothing else pins the fallback in `teardownAgentWorktree` itself. The task requires (a) `pruneWorktrees(gitRoot)` called when `removeWorktree` returns false, before the branch delete is retried, and (b) the existing warning strings preserved verbatim: `git worktree remove failed for`, `git branch -D failed for` and `worktree cleanup threw`. This check reads `host-server/worktreeTeardown.ts` and tests all four conditions.
- **Steps**:
  1. From the repo root, run the command below as-is.
- **Command**:
  ```bash
  node -e 'const s=require("fs").readFileSync("host-server/worktreeTeardown.ts","utf8");console.log(["git worktree remove failed for","git branch -D failed for","worktree cleanup threw"].map(w=>s.includes(w)).join(" "), /if \(!result\.removedWorktree\) \{[\s\S]*?pruneWorktrees\(gitRoot\);[\s\S]*?\}\s*if \(entry\.branch\)/.test(s))'
  ```
- **Expected Result**: Exactly `true true true true` (verified at generation time; the last field may carry terminal colour codes, which are not part of the verdict). Any `false` means a warning string was renamed or the prune fallback was removed, reordered or made unconditional (FAIL).
- **Repeatable Unit Test**: Blocked: promotable in principle as a static assertion beside the existing route-wiring test in `host-server/worktreeTeardown.test.ts` (same source-reading pattern), but this generation run was restricted to wiki edits by the team lead. Add a `void test('teardownAgentWorktree prunes after a failed remove, before the branch delete', …)` asserting the same regex and strings against `worktreeTeardown.ts`; the scripted command above is the repeatable check until then. A behavioural test would need a way to force `removeWorktree` to fail while the directory exists (module seam or git shim), which the repo does not have.
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-010: The tests leave no temporary repos or worktree directories behind under ./tmp
- **Scenario**: TASK-0217 Step 3 requires that the tests clean up after themselves (`./tmp/` is the only allowed scratch location). **Run this case after EDGE-001..008 have executed** (leftovers from those runs are exactly what it counts). The tests create `./tmp/task217-*` repos and `<repo>-worktrees` siblings; the clone worktrees live in `task217-<label>-…-worktrees`, which also start with `task217-`.
- **Steps**:
  1. Run EDGE-001 through EDGE-008 in the same checkout.
  2. From the repo root, run the command below as-is.
- **Command**:
  ```bash
  node -e 'console.log(require("fs").readdirSync("tmp").filter(n=>n.startsWith("task217-")).length)'
  ```
- **Expected Result**: `0` (verified after a full run of `worktreeTeardown.test.ts` and both `pruneWorktrees` tests). Any other number means a test leaked a repo or worktree directory (FAIL); list them with `git worktree list` from the repo root and remove them before re-running.
- **Repeatable Unit Test**: Not applicable: this asserts on the filesystem state left after other tests run; each test's own `finally` cleanup is the unit-level guard
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-GATE-001: host-server typecheck and lint of the touched files are clean
- **Scenario**: The extraction and the new `pruneWorktrees` export must compile under the project's strict settings, and the four touched TypeScript files must pass ESLint. Lint is scoped to those files so unrelated in-flight edits by other agents cannot fail this case.
- **Steps**:
  1. Run both commands below as-is.
- **Command**:
  ```bash
  cd host-server && npx tsc --noEmit
  ```
  ```bash
  cd host-server && npx eslint worktreeTeardown.ts worktreeTeardown.test.ts git.ts git.test.ts
  ```
- **Expected Result**: Both commands print nothing and exit `0` (verified at generation time). A `tsc` error in a file other than `worktreeTeardown.ts`, `worktreeTeardown.test.ts`, `git.ts`, `git.test.ts` or `index.ts` comes from concurrent work by another task. Re-run once it settles, and do not attribute it to TASK-0217. Any error in those files is a FAIL.
- **Repeatable Unit Test**: Not applicable: a static gate (compiler and linter), not a unit assertion
- [x] Pass <!-- 2026-09-20 -->
