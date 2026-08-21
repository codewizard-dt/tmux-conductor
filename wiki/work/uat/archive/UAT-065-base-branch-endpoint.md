---
id: UAT-065
aliases: [UAT-065]
title: "UAT: Base-branch endpoint — GET /api/agents/:id/base-branch auto-detects default branch"
status: passed
task: TASK-065
created: 2026-07-06
updated: 2026-07-06
---

# UAT-065 — UAT: Base-branch endpoint — GET /api/agents/:id/base-branch auto-detects default branch

implements::[[TASK-065]]

> **Source task**: [[TASK-065]]
> **Generated**: 2026-07-06
> **Note**: The task title says `:agent`, but the implemented route follows the codebase convention of numeric `:id` (matching every other `/agents/:id/*` route). Test with agent IDs, e.g. `/api/agents/11/base-branch`.

---

## Prerequisites

- [ ] Host-server running on `http://127.0.0.1:8788` (`make dev` or `npm --prefix host-server run dev`)
- [ ] At least one agent whose `workdir` is a git repository exists in the DB. At generation time agent id `11` ("general", workdir `/Users/davidtaylor/Repositories/tmux-conductor`, origin/HEAD → `origin/main`) qualifies — verify with `curl -sS http://127.0.0.1:8788/api/agents | jq '[.[] | {id, name, workdir}]'` and substitute the id in the commands below if it changed
- [ ] For UAT-API-002 only: the conductor tmux session is running (`POST /agents` returns 409 `session not running` otherwise)
- [ ] `jq` installed

---

## Test Cases

### UAT-API-001: Git agent returns detected base branch
- **Endpoint**: `GET /api/agents/:id/base-branch`
- **Description**: For an agent whose workdir is a git repo, the endpoint returns the auto-detected default branch as `{ base: "<branch>" }`. Agent 11's workdir has `origin/HEAD` → `origin/main`, so detection step 1 must yield `main`.
- **Steps**:
  1. Confirm agent id 11 exists and its workdir is the tmux-conductor repo (see Prerequisites)
  2. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents/11/base-branch'
  ```
- **Expected Result**: HTTP 200 with body exactly `{"base":"main"}` (a non-null string; `main` because the repo's `origin/HEAD` resolves to `origin/main`)
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (origin/HEAD detection path)
- [x] Pass <!-- 2026-07-06 -->

### UAT-API-002: Non-git agent returns base null
- **Endpoint**: `GET /api/agents/:id/base-branch`
- **Description**: For an agent whose workdir is not inside a git work tree, the endpoint returns `{ base: null }` (not an error).
- **Steps**:
  1. Create a throwaway agent with a non-git workdir (home dir is not a git repo):
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat065-nongit","workdir":"/Users/davidtaylor","launchCmd":"bash"}'
     ```
  2. Note the returned `agent.id` (call it `<NID>`)
  3. Run the command below, substituting `<NID>`
  4. Teardown — remove the throwaway agent:
     ```bash
     curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$UAT065_NID"
     ```
- **Command**:
  ```bash
  curl -sS "http://127.0.0.1:8788/api/agents/$UAT065_NID/base-branch"
  ```
- **Expected Result**: HTTP 200 with body exactly `{"base":null}`
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (`isGitRepo` negative case; route-level null mapping needs the live server — routes are registered inline, no injectable app export)
- [x] Pass <!-- 2026-07-06 -->

### UAT-API-003: Unknown agent id returns 404
- **Endpoint**: `GET /api/agents/:id/base-branch`
- **Description**: A numeric id with no matching agent row returns 404 with an error body.
- **Steps**:
  1. Run the curl command below as-is (999999 must not be a real agent id)
- **Command**:
  ```bash
  curl -sS -i 'http://127.0.0.1:8788/api/agents/999999/base-branch'
  ```
- **Expected Result**: HTTP 404 with body `{"error":"agent 999999 not found"}`
- **Repeatable Unit Test**: Not applicable: Fastify route wiring is registered inline in `host-server/index.ts` with no injectable app export; verified against the live server only
- [x] Pass <!-- 2026-07-06 -->

### UAT-API-004: Diff endpoint shares detectBaseBranch (integration)
- **Endpoint**: `GET /api/agents/:id/diff`
- **Description**: TASK-065 extracted detection into the shared `detectBaseBranch` helper and rewired the TASK-064 diff route onto it. The diff response's `base` field must equal the base-branch endpoint's `base` for the same agent.
- **Steps**:
  1. Run the curl command below as-is
  2. Compare `base` with UAT-API-001's result for agent 11
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents/11/diff' | jq '{base}'
  ```
- **Expected Result**: HTTP 200; `base` is `"main"` — identical to the value returned by `/api/agents/11/base-branch` (both routes call the shared helper in `host-server/git.ts`)
- **Repeatable Unit Test**: Not applicable: cross-route HTTP integration over the live server
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-001: Non-numeric agent id returns 400
- **Scenario**: The `:id` param does not parse as an integer (`parseInt` → NaN).
- **Steps**:
  1. Run the command below as-is
     ```bash
     curl -sS -i 'http://127.0.0.1:8788/api/agents/abc/base-branch'
     ```
- **Expected Result**: HTTP 400 with body `{"error":"invalid agent id"}`
- **Repeatable Unit Test**: Not applicable: param parsing lives inline in the route handler; verified against the live server only
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-002: Detection order — origin/HEAD → main/master/develop → fallback main
- **Scenario**: The acceptance-criteria detection order, exercised against throwaway git fixture repos: (1) `origin/HEAD` wins when it resolves to a local branch; (2) an `origin/HEAD` pointing at a branch that does not exist locally is skipped; (3) `main` is preferred over `master`; (4) `master` then `develop` are used when earlier names are absent; (5) `'main'` is the terminal fallback when nothing resolves; plus `isGitRepo` true/false.
- **Steps**:
  1. Run the unit suite below (fixtures are created and cleaned under the repo-local `./tmp/`)
     ```bash
     cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && node --import tsx/esm --test git.test.ts
     ```
- **Expected Result**: All 7 tests pass, 0 fail (verified passing at generation time)
- **Repeatable Unit Test**: Created: `host-server/git.test.ts`
- [x] Pass <!-- 2026-07-06 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| Returns `{ base: "<branch>" }` for git agents | UAT-API-001 |
| Returns `{ base: null }` for non-git agents | UAT-API-002 |
| Returns 404 for unknown agents | UAT-API-003 |
| `detectBaseBranch` shared with diff endpoint | UAT-API-004 |
| Detection order origin/HEAD → main/master/develop → fallback main | UAT-EDGE-002 (`host-server/git.test.ts`) |
| `npx tsc --noEmit` passes | Static gate — verified during /tackle (not re-tested here) |
