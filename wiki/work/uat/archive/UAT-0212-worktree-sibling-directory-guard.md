---
id: UAT-0212
aliases: [UAT-0212]
title: "UAT: Guard and test that new worktrees land in a newly created sibling directory of the repo root"
status: passed
task: TASK-0212
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0212 — UAT: Guard and test that new worktrees land in a newly created sibling directory of the repo root

implements::[[TASK-0212]]

> **Source task**: [[TASK-0212]]
> **Generated**: 2026-09-20

---

## Prerequisites

TASK-0212 is backend-only (`host-server/git.ts` guard plus tests). **Every case below is judged from a recorded command; none needs the dev stack, the dashboard, tmux, or a live agent.** Do not create, clone, stop or destroy any real agent for this UAT.

- [ ] `host-server/` dependencies installed (`cd host-server && npm ci` if `node_modules` is missing). Run every command from the repo root exactly as written.
- [ ] `git` on PATH. The unit tests create scratch repos under the OS temp dir and clean them up; EDGE-011 writes a scratch repo under `./tmp/` (repo-local, gitignored) and deletes it.
- [ ] Known unrelated failures. `host-server/db.migration.test.ts` has two pre-existing failures from other work (`bgHasLinkedAgentColumn` not defined, and the TASK-125 v8 fixture against the v12 migration). **Never run that file unfiltered**; every command below scopes it with `--test-name-pattern`, so a red unfiltered run is not a TASK-0212 failure.
- [ ] Concurrent edits from TASK-0211 (`agentDiff.ts`, `index.ts`, `AgentList.tsx`) can leave `tsc` errors in files this task does not own. UAT-GATE-001 filters to this task's files for that reason.

Source under test (`host-server/git.ts`):
- `assertWorktreeOutsideRoot(gitRoot, worktreePath): WorktreeCreateResult` — resolves both paths through `fs.realpathSync.native` on the deepest existing ancestor, then refuses an empty relative path, a relative path not escaping upward (`..`), and a `gitRoot` whose `path.dirname` equals itself (filesystem root). Refusal reason: `refusing to create a worktree inside the repository root (<root>); worktrees must be siblings of the root`.
- `tryCreateWorktree(gitRoot, worktreePath, branch)` — calls the guard first and returns its refusal before `git worktree add` is spawned. `createWorktree` is a thin `.ok` wrapper over it.
- `siblingWorktreeDir(gitRoot)` (`<parent>/<repo>-worktrees`) and `siblingWorktreePath(gitRoot, agentId)` (`<parent>/<repo>-worktrees/<agentId>`).
- `host-server/db.ts`: `createAgent({ useWorktree })` and `addWorktreeToAgent` both build the target with `siblingWorktreePath(getGitRoot(workdir), id)` and create it through `tryCreateWorktree`.

Coverage notes (read before judging):
- The guard's refusal is covered at the unit level only. `db.ts` calls `siblingWorktreePath` directly, so there is no seam to force a nested target through `createAgent` / `addWorktreeToAgent`; the task's optional end-to-end refusal bullet was skipped for that reason (documented in `db.migration.test.ts` at the TASK-0212 header comment). Propagation of a `git-failed` `WorktreeError` message to the caller is UAT-0210's territory.
- The clone path (TASK-0213) does not exist yet. It is out of scope here; TASK-0213 adds its own clone-specific sibling assertion.
- The task Approach keeps legacy nested worktrees (`worktrees/1`, `worktrees/12`) untouched. The guard is referenced only from `tryCreateWorktree` (creation), never from teardown, diff or checkpoint reads; EDGE-011 proves teardown of a nested legacy worktree still works.

---

## Test Cases

### UAT-EDGE-001: A sibling target is accepted
- **Scenario**: `assertWorktreeOutsideRoot` is given a root and (a) the canonical `<root>-worktrees/7` target, (b) an unrelated sibling directory.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `assertWorktreeOutsideRoot accepts a sibling path` passes (`pass 1`, `fail 0`, `skipped 0`): both calls return exactly `{ ok: true }`.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (written by the TASK-0212 tackle; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="accepts a sibling path" git.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: A target nested under the root is refused at any depth
- **Scenario**: targets `<root>/wt` and `<root>/a/b/c/wt` (one level and several levels under the root).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `assertWorktreeOutsideRoot refuses paths nested under the root at any depth` passes (`pass 1`, `fail 0`): each call returns `{ ok: false }` with a `reason` matching `/inside the repository root/`.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (written by the TASK-0212 tackle; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="nested under the root at any depth" git.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: The root itself is refused
- **Scenario**: `assertWorktreeOutsideRoot(root, root)` (empty relative path).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `assertWorktreeOutsideRoot refuses the root itself` passes (`pass 1`, `fail 0`): `{ ok: false }`, reason matches `/inside the repository root/`.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (written by the TASK-0212 tackle; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="refuses the root itself" git.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: A filesystem-root `gitRoot` (`/`) is refused
- **Scenario**: an odd `gitRoot` of `/` would make every absolute path "inside" it; the task requires refusing it outright.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `assertWorktreeOutsideRoot refuses gitRoot '/'` passes (`pass 1`, `fail 0`): `assertWorktreeOutsideRoot('/', '/some-worktree')` returns `{ ok: false }` with a reason matching `/inside the repository root/`.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (written by the TASK-0212 tackle; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="refuses gitRoot" git.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-005: A symlinked parent whose real path is inside the root is refused
- **Scenario**: a symlink created outside the repo points at the repo root; the target `<symlink>/wt` looks like a sibling lexically but resolves inside the root. This is the `realpath` half of the guard (also the macOS `/tmp` → `/private/tmp` class of bug).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `assertWorktreeOutsideRoot refuses a symlinked parent whose real path is inside the root` passes with `pass 1`, `fail 0`, and **`skipped 0`** on macOS/Linux: `{ ok: false }`, reason matches `/inside the repository root/`. A `skipped 1` is acceptable only on a platform where `fs.symlinkSync` itself fails; on this macOS host a skip is a FAIL of the case (the check silently did not run).
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (written by the TASK-0212 tackle; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="symlinked parent" git.test.ts` (verified: pass 1, fail 0, skipped 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-006: `tryCreateWorktree` refuses a nested target without invoking git
- **Scenario**: a real scratch repo and target `<repo>/nested/wt`. The guard must short-circuit before `git worktree add`, so nothing on disk or in git changes.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `tryCreateWorktree refuses a nested target without invoking git` passes (`pass 1`, `fail 0`): result is `{ ok: false }` with reason matching `/inside the repository root/`; the target path does not exist; `git worktree list --porcelain` is byte-identical before and after; branch `conductor/try-nested` was not created.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (written by the TASK-0212 tackle; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="tryCreateWorktree refuses a nested" git.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-007: The `<repo>-worktrees/<id>` layout is defined once and is pure
- **Scenario**: `siblingWorktreeDir('/a/b/repo')` and `siblingWorktreePath('/a/b/repo', 7)`, with no git and no filesystem access.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `siblingWorktreePath and siblingWorktreeDir build the <root>-worktrees layout` passes (`pass 1`, `fail 0`): the dir equals `/a/b/repo-worktrees` and the path equals `/a/b/repo-worktrees/7`.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (written by the TASK-0212 tackle; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="build the <root>-worktrees layout" git.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-008: Subdirectory workdir, retroactive path (`addWorktreeToAgent`) lands in a newly created sibling directory
- **Scenario**: a repo with a tracked `packages/app`; an agent whose `workdir` is that subdirectory; `addWorktreeToAgent` is called after creation. The worktree must be built from the git top level (not the workdir), outside the repo, in a `<repo>-worktrees` directory that did not exist before, and the source tree must stay clean.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `TASK-0212: addWorktreeToAgent for a subdirectory workdir creates the worktree as a sibling of the repo root` passes (`pass 1`, `fail 0`). It asserts: `worktreePath === <realpath of parent>/<repo>-worktrees/<agentId>`; `path.relative(repo, worktreePath)` starts with `..` (against both the given and the real repo path); the sibling directory did not exist before the call and exists afterwards; the worktree directory exists; `git -C <repo> status --porcelain` is empty.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (written by the TASK-0212 tackle; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="TASK-0212: addWorktreeToAgent for a subdirectory" db.migration.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-009: Subdirectory workdir, create-time path (`createAgent({ useWorktree: true })`) lands in a newly created sibling directory
- **Scenario**: same fixture and assertions as EDGE-008, through the Add Agent / project-spawn creation path instead of the retroactive path.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `TASK-0212: createAgent({ useWorktree: true }) for a subdirectory workdir creates the worktree as a sibling of the repo root` passes (`pass 1`, `fail 0`) with the same six assertions as EDGE-008 (canonical `<realParent>/<repo>-worktrees/<agentId>`, outside the root, sibling directory newly created, worktree exists, clean `git status --porcelain`).
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (written by the TASK-0212 tackle; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="TASK-0212: createAgent" db.migration.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-010: Existing worktree behavior is unchanged
- **Scenario**: the task requires the pre-existing `createWorktree` / `removeWorktree` tests and the ROADMAP-007 sibling assertion (`path.dirname(worktreePath) === \`${repo}-worktrees\``) to keep passing unchanged, and a normal sibling creation through `tryCreateWorktree` to still succeed with the guard in front.
- **Steps**:
  1. Run the git.test.ts command below (the whole file, including `tryCreateWorktree returns { ok: true } on success`, the `createWorktree`/`removeWorktree` tests, and the TASK-0210 reason tests).
  2. Run the db.migration.test.ts command below (the two ROADMAP-007 tests, scoped so the two unrelated pre-existing failures are not exercised).
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test git.test.ts
  ```
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern="ROADMAP-007: createAgent creates a sibling|ROADMAP-007: addWorktreeToAgent opts" db.migration.test.ts
  ```
- **Expected Result**: Step 1: `tests 37`, `pass 37`, `fail 0`, `skipped 0` (a higher `tests` count from later tasks is fine; `fail` must be 0 and `skipped` 0 on macOS). Step 2: `tests 2`, `pass 2`, `fail 0`.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` and `host-server/db.migration.test.ts` (both pre-existing; the TASK-0212 tackle left these tests unchanged)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test git.test.ts && node --import tsx/esm --test --test-name-pattern="ROADMAP-007: createAgent creates a sibling|ROADMAP-007: addWorktreeToAgent opts" db.migration.test.ts` (verified: 37/37 and 2/2)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-011: A legacy nested worktree can still be torn down (the guard never applies to teardown)
- **Scenario**: the two pre-existing nested worktrees (`worktrees/1`, `worktrees/12`) predate the rule. The guard must apply to creation only. This builds a nested worktree with plain `git` (bypassing `tryCreateWorktree`) inside a scratch repo under `./tmp/`, then calls the real `removeWorktree` on it.
- **Steps**:
  1. Run the command below from the repo root.
  2. Confirm the output, then the scratch directory is already removed by the command itself.
- **Command**:
  ```bash
  rm -rf ./tmp/uat-0212-legacy && mkdir -p ./tmp/uat-0212-legacy && git init -q -b main ./tmp/uat-0212-legacy/repo && git -C ./tmp/uat-0212-legacy/repo -c user.email=t@t -c user.name=T commit -q --allow-empty -m init && git -C ./tmp/uat-0212-legacy/repo worktree add -q ./nested-legacy-wt -b legacy2 && (cd host-server && node --import tsx/esm -e "const m = await import('./git.ts'); const path = await import('node:path'); const p = path.resolve('../tmp/uat-0212-legacy/repo'); console.log('removeWorktree nested legacy =>', m.removeWorktree(p, p + '/nested-legacy-wt'));") ; git -C ./tmp/uat-0212-legacy/repo worktree list; rm -rf ./tmp/uat-0212-legacy
  ```
- **Expected Result**: The `console.log` line reads `removeWorktree nested legacy => true` (the value may be wrapped in ANSI colour codes), and the final `git worktree list` shows only the main checkout (`.../tmp/uat-0212-legacy/repo ... [main]`), with no `nested-legacy-wt` entry. Any `false`, thrown error, or a surviving `nested-legacy-wt` line is a FAIL (the guard has leaked into teardown).
- **Repeatable Unit Test**: Not applicable: no unit test covers teardown of a nested worktree (`removeWorktree` tests use sibling paths) and this UAT-generation run was not permitted to edit test files; covered by the scripted check above, which was run end to end once before writing (result `true`, worktree list showed only `[main]`). Candidate for promotion into `host-server/git.test.ts` in a later pass.
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-GATE-001: Typecheck and lint are clean for the files this task owns
- **Scenario**: `tsc --noEmit` currently reports errors in files owned by concurrent work (`agentDiff.test.ts`, `hookLastPrompt.test.ts`), so the gate is filtered to the three TASK-0212 files. ESLint is run on those files directly.
- **Steps**:
  1. Run both commands below from the repo root.
- **Command**:
  ```bash
  cd host-server && npx tsc --noEmit 2>&1 | grep -E '^(git|db|db\.migration)\.(test\.)?ts' ; echo "scoped-tsc-lines-above (none expected)"
  ```
  ```bash
  cd host-server && npx eslint git.ts git.test.ts db.migration.test.ts
  ```
- **Expected Result**: The `tsc` command prints no lines before the trailing echo (no diagnostics whose path is `git.ts`, `git.test.ts`, `db.ts`, `db.test.ts` or `db.migration.test.ts`). `eslint` prints nothing and exits 0. Diagnostics in other files are not this task's and do not fail the case.
- **Repeatable Unit Test**: Not applicable: static analysis gate, not runtime behavior.
- [x] Pass <!-- 2026-09-20 -->

---

## Gaps and notes for the reviewer

- **Guard refusal through `createAgent` / `addWorktreeToAgent` is not exercised end to end.** No seam exists to force a nested `siblingWorktreePath` target; refusal is pinned at `assertWorktreeOutsideRoot` / `tryCreateWorktree` (EDGE-001..006), which is the single choke point every creation path funnels through. This matches the task's own fallback for that bullet.
- **Clone path.** TASK-0213's clone creation is not implemented yet; its sibling assertion belongs to that task's UAT.
- **Subdirectory pane cwd.** A subdirectory workdir maps to the worktree root, not the equivalent subdirectory inside it (task Note for TASK-0213). Not asserted here; only the worktree's location is.
