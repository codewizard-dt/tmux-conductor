---
id: UAT-064
aliases: [UAT-064]
title: "UAT: Diff endpoint — GET /api/agents/:id/diff (git diff base..HEAD)"
status: passed
task: TASK-064
created: 2026-07-06
updated: 2026-07-06
---

# UAT-064 — UAT: Diff endpoint — GET /api/agents/:id/diff (git diff base..HEAD)

implements::[[TASK-064]]

> **Source task**: [[TASK-064]]
> **Generated**: 2026-07-06

---

## Prerequisites

- [ ] Host-server running on `http://127.0.0.1:8788` (`make dev`, or `npm --prefix host-server run dev`).
- [ ] At least one agent row exists in the DB. Discover ids/workdirs with: `curl -sS 'http://127.0.0.1:8788/api/agents' | jq '.[] | {id, name, workdir}'`.
- [ ] For the diff happy-path (UAT-API-001): an agent whose `workdir` is a git repository with at least one commit on `HEAD` that is ahead of its base branch (`main`/`master`/`origin/HEAD`), so `git diff base..HEAD` yields non-empty output. If none exists, UAT-API-004 (empty-diff case) still exercises the git path.
- [ ] For UAT-API-002: an agent whose `workdir` is NOT a git repository (a plain non-git directory).
- [ ] `jq` installed (used for a single pipe stage in some checks).

> Note: the route param is the **numeric agent id** (`:id`), not the agent name. Substitute a real id from the `/api/agents` list into `<ID>` below.

---

## Test Cases

### UAT-API-001: Diff for a git-repo agent ahead of base
- **Endpoint**: `GET /api/agents/:id/diff`
- **Description**: For an agent whose `workdir` is a git repo with commits ahead of the base branch, the endpoint returns 200 with a non-empty unified diff plus the detected base branch and a `truncated` flag.
- **Steps**:
  1. Pick an agent id whose `workdir` is a git repo ahead of base (see prerequisites): `<ID>`.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents/<ID>/diff'
  ```
- **Expected Result**: HTTP 200. JSON object `{ "diff": "<unified-diff-text>", "base": "<branch>", "truncated": false }`. `diff` is a non-empty string containing standard `diff --git` hunks; `base` is one of the detected branches (typically `main` or `master`); `truncated` is `false` unless the diff exceeds 500 KiB.
- **Repeatable Unit Test**: Blocked: host-server/ has no unit-test framework (no vitest/jest, no `test` script, no `*.test.ts`); adding one is new infrastructure out of this task's scope. Verified via HTTP.
- [x] Pass <!-- 2026-07-06 -->

### UAT-API-002: Non-git agent returns null diff
- **Endpoint**: `GET /api/agents/:id/diff`
- **Description**: For an agent whose `workdir` is not a git repository, the endpoint returns 200 with `{ diff: null, base: null }` (the "no worktree" case).
- **Steps**:
  1. Pick an agent id whose `workdir` is a plain non-git directory: `<ID>`.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents/<ID>/diff'
  ```
- **Expected Result**: HTTP 200. JSON body exactly `{ "diff": null, "base": null }` (no `truncated` field on this path).
- **Repeatable Unit Test**: Blocked: no unit-test framework in host-server/. Verified via HTTP.
- [x] Pass <!-- 2026-07-06 -->

### UAT-API-003: Empty diff when HEAD equals base
- **Endpoint**: `GET /api/agents/:id/diff`
- **Description**: For a git-repo agent whose `HEAD` has no changes relative to the detected base branch, the endpoint returns 200 with an empty diff string (not an error, not null).
- **Steps**:
  1. Pick an agent id whose `workdir` is a git repo currently even with its base branch (e.g. checked out on `main` with no commits ahead): `<ID>`.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents/<ID>/diff'
  ```
- **Expected Result**: HTTP 200. JSON `{ "diff": "", "base": "<branch>", "truncated": false }` — `diff` is the empty string, `base` is the detected branch, `truncated` is `false`.
- **Repeatable Unit Test**: Blocked: no unit-test framework in host-server/. Verified via HTTP.
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-001: Unknown agent id returns 404
- **Scenario**: Requesting a diff for an agent id that does not exist in the DB.
- **Endpoint**: `GET /api/agents/:id/diff`
- **Steps**:
  1. Choose an id known not to exist (e.g. `99999`).
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents/99999/diff'
  ```
- **Expected Result**: HTTP 404. JSON `{ "error": "agent 99999 not found" }`.
- **Repeatable Unit Test**: Blocked: no unit-test framework in host-server/. Verified via HTTP.
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-002: Non-numeric id returns 400
- **Scenario**: Requesting a diff with a non-numeric id path segment (the route parses `:id` via `parseInt`).
- **Endpoint**: `GET /api/agents/:id/diff`
- **Steps**:
  1. Use a non-numeric id such as `abc`.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents/abc/diff'
  ```
- **Expected Result**: HTTP 400. JSON `{ "error": "invalid agent id" }`.
- **Repeatable Unit Test**: Blocked: no unit-test framework in host-server/. Verified via HTTP.
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-003: Base-branch detection reports a valid branch
- **Scenario**: For any git-repo agent, the `base` field returned reflects the inline detection order (origin/HEAD → main → master → default `main`) and names a real branch.
- **Endpoint**: `GET /api/agents/:id/diff`
- **Steps**:
  1. Pick a git-repo agent id: `<ID>`.
  2. Run the curl command below and inspect the `base` field.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents/<ID>/diff' | jq '.base'
  ```
- **Expected Result**: HTTP 200. `.base` is a non-null string equal to the repo's default branch (e.g. `"main"` or `"master"`) — matching what `git -C <workdir> symbolic-ref --short refs/remotes/origin/HEAD` (stripped of `origin/`) or the first existing of `main`/`master` resolves to.
- **Repeatable Unit Test**: Blocked: no unit-test framework in host-server/. Verified via HTTP.
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-004: Large diff is capped with truncated flag (manual/optional)
- **Scenario**: When `git diff base..HEAD` exceeds 500 KiB, the response `diff` is sliced to 500 KiB and `truncated` is `true`.
- **Endpoint**: `GET /api/agents/:id/diff`
- **Steps**:
  1. Use (or prepare) a git-repo agent whose `HEAD` is ahead of base by more than 500 KiB of textual diff (e.g. add a large generated file and commit it).
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents/<ID>/diff' | jq '{truncated, len: (.diff | length)}'
  ```
- **Expected Result**: HTTP 200. `truncated` is `true` and `.diff | length` equals `512000` (500 * 1024). This case is optional/manual — it requires deliberately staging a >500 KiB diff.
- **Repeatable Unit Test**: Blocked: no unit-test framework in host-server/; also requires a large fixture repo. Verified manually via HTTP.
- [x] Pass <!-- 2026-07-06 -->

---

## Notes

- All verification is HTTP-based against the running host-server, consistent with existing UAT files (e.g. `UAT-005`, `UAT-006`); host-server/ ships no in-repo unit-test runner, so unit-test promotion is blocked by absent harness for every case.
- The endpoint currently keys "no worktree" off `workdir` not being a git repo, since the `worktree_path`/`branch` columns (TASK-060/TASK-061) were not yet populated when TASK-064 was implemented. Once TASK-061 populates real worktrees, the git-repo path exercises the same code.
- Base-branch detection is inlined as a temporary stand-in for the shared `detectBaseBranch` helper introduced by TASK-065.
