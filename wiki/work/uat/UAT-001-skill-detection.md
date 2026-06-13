---
id: UAT-001
title: "UAT: Skill detection — backend scanner + dashboard surfacing"
status: pending
task: TASK-001
created: 2026-06-12
updated: 2026-06-12
---

# UAT-001 — UAT: Skill detection — backend scanner + dashboard surfacing

implements::[[TASK-001]]

> **Source task**: [`wiki/work/tasks/TASK-001-skill-detection.md`](../tasks/TASK-001-skill-detection.md)
> **Generated**: 2026-06-12

---

## Prerequisites

- [ ] Backend running on port 8788: `cd backend && npx tsx index.ts` (or built: `node dist/index.js`)
- [ ] Frontend dev server running on port 4321: `cd frontend && npm run dev`
- [ ] `~/.claude/skills/` exists and contains at least one skill directory (confirmed: 56 present on this host)
- [ ] Agent `tmux-conductor` is registered in `conductor.conf` with `workdir=/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] `.claude/skills/typecheck/SKILL.md` exists in the repo root (it does — added by this project)
- [ ] `jq` installed for JSON assertions

---

## Test Cases

### UAT-API-001: GET /api/skills returns user skills array

- **Endpoint**: `GET /api/skills`
- **Description**: Verifies the global skills endpoint returns a non-empty `user` array and an array-shaped `plugin` field. Each Skill object must have the required fields.
- **Steps**:
  1. Ensure the backend is running.
  2. Run the command below and inspect the output.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/skills' | jq '{user_count: (.user | length), plugin_count: (.plugin | length), sample: .user[0]}'
  ```
- **Expected Result**: HTTP 200. Output shows `user_count` ≥ 1 (at least 56 on this host), `plugin_count` ≥ 0, and `sample` contains `name` (string), `userInvocable` (boolean), `autoOnly` (boolean), `source` = `"user"`.
- [ ] Pass

---

### UAT-API-002: GET /api/skills Skill objects have correct field types

- **Endpoint**: `GET /api/skills`
- **Description**: Verifies every user skill has the required fields with correct types — no missing `name`, no wrong types for booleans.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/skills' | jq '[.user[] | select((.name | type) != "string" or (.userInvocable | type) != "boolean" or (.autoOnly | type) != "boolean" or (.source != "user"))] | length'
  ```
- **Expected Result**: Output is `0` — no skills with invalid field types or wrong source value.
- [ ] Pass

---

### UAT-API-003: GET /api/agents/:agent/skills returns project + user skills for known agent

- **Endpoint**: `GET /api/agents/tmux-conductor/skills`
- **Description**: The `tmux-conductor` agent has workdir pointing at this repo, which contains `.claude/skills/typecheck/`. The endpoint must return the `typecheck` skill in `project` and the full user set in `user`.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/agents/tmux-conductor/skills' | jq '{agent: .agent, workdir: .workdir, project_count: (.project | length), user_count: (.user | length), typecheck: (.project[] | select(.name == "typecheck"))}'
  ```
- **Expected Result**: HTTP 200. `agent` = `"tmux-conductor"`, `workdir` = `/Users/davidtaylor/Repositories/tmux-conductor`, `project_count` ≥ 1, `user_count` ≥ 1. The `typecheck` object is present with `source` = `"project"`, `userInvocable` = `true`, `autoOnly` = `false`, `title` = `"typecheck"`.
- [ ] Pass

---

### UAT-API-004: GET /api/agents/:agent/skills project skills carry source = "project"

- **Endpoint**: `GET /api/agents/tmux-conductor/skills`
- **Description**: Project skills returned by the per-agent endpoint must have `source: "project"`, not `"user"`.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/agents/tmux-conductor/skills' | jq '[.project[] | select(.source != "project")] | length'
  ```
- **Expected Result**: Output is `0` — every skill in `project` has `source = "project"`.
- [ ] Pass

---

### UAT-API-005: GET /api/agents/:agent/skills user skills match global /api/skills user skills

- **Endpoint**: `GET /api/agents/tmux-conductor/skills` vs `GET /api/skills`
- **Description**: The `user` array in the per-agent response must be identical in count to the global `/api/skills` user array (same scanner, same cache).
- **Steps**:
  1. Run both commands and compare counts.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/skills' | jq '.user | length'
  ```
  then:
  ```bash
  curl -sS 'http://localhost:8788/api/agents/tmux-conductor/skills' | jq '.user | length'
  ```
- **Expected Result**: Both commands return the same integer (e.g. `56`).
- [ ] Pass

---

### UAT-EDGE-001: GET /api/agents/:agent/skills returns 404 for unknown agent

- **Endpoint**: `GET /api/agents/no-such-agent/skills`
- **Description**: Requesting skills for an agent not registered in conductor.conf must return HTTP 404 with a descriptive error message.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' 'http://localhost:8788/api/agents/no-such-agent/skills'
  ```
- **Expected Result**: Output is `404`.
- [ ] Pass

---

### UAT-EDGE-002: GET /api/agents/:agent/skills error body contains agent name

- **Endpoint**: `GET /api/agents/no-such-agent/skills`
- **Description**: The 404 body must name the missing agent in the `error` field.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/agents/no-such-agent/skills' | jq '.error'
  ```
- **Expected Result**: Output is `"agent 'no-such-agent' not found in conductor.conf"`.
- [ ] Pass

---

### UAT-EDGE-003: Agent with no project .claude/skills dir returns empty project array

- **Endpoint**: `GET /api/agents/wetware/skills`
- **Description**: The `wetware` agent's workdir (`/Users/davidtaylor/Repositories/gauntlet/wetware-factory`) should not have a `.claude/skills/` directory. The endpoint must return an empty `project` array rather than erroring.
- **Steps**:
  1. Confirm no `.claude/skills/` in wetware's workdir: `ls /Users/davidtaylor/Repositories/gauntlet/wetware-factory/.claude/skills 2>&1`
  2. Run the command below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/agents/wetware/skills' | jq '{project_count: (.project | length), ok: (has("project") and has("user") and has("agent") and has("workdir"))}'
  ```
- **Expected Result**: `project_count` = `0`, `ok` = `true`. No error.
- [ ] Pass

---

### UAT-UI-001: Skills section appears in AgentDetailModal

- **Page**: `http://localhost:4321`
- **Description**: Opening the detail modal for any registered agent must show a collapsible "Skills" section below the diff area.
- **Steps**:
  1. Open the frontend at `http://localhost:4321`.
  2. Wait for the agent board to load.
  3. Click on any agent card to open its detail modal.
  4. Scroll down past the diff section.
  5. Observe whether a `<details>` element with a `<summary>` containing "Skills" is present.
- **Expected Result**: A "Skills (N)" summary heading is visible in the modal, where N is a positive integer.
- [ ] Pass

---

### UAT-UI-002: Project skills section shows typecheck for tmux-conductor agent

- **Page**: `http://localhost:4321`
- **Description**: The `tmux-conductor` agent's modal must display a "Project" group containing a `typecheck` skill row.
- **Steps**:
  1. Open the frontend at `http://localhost:4321`.
  2. Locate the `tmux-conductor` agent card (it may be in any board column).
  3. Click the card to open its detail modal.
  4. Click "Skills (N)" to expand the section.
  5. Look for a "Project" group with a row containing `/typecheck` in monospace text.
- **Expected Result**: A row with `/typecheck` (monospace) is visible under the "Project" heading. A "project" badge (violet background) is present on that row.
- [ ] Pass

---

### UAT-UI-003: User skills group is present and collapsed by default

- **Page**: `http://localhost:4321`
- **Description**: The "User (N)" group inside the Skills section must be a collapsed `<details>` element by default (with N ≥ 1, reflecting the 56+ user skills on this host).
- **Steps**:
  1. Open any agent's detail modal.
  2. Expand the "Skills (N)" section.
  3. Observe the "User (N)" sub-group.
- **Expected Result**: The "User (N)" sub-section is present and collapsed (its content is not visible until clicked). N ≥ 1.
- [ ] Pass

---

### UAT-UI-004: Clicking a skill row enqueues it and shows confirmation toast

- **Page**: `http://localhost:4321`
- **Description**: Clicking a skill row must POST `/api/queue/:agent` with `{ task: "/<skill-name>" }` and display a `"/{name} queued ✓"` inline confirmation that disappears after ~1.5 s.
- **Steps**:
  1. Open the `tmux-conductor` agent modal.
  2. Expand "Skills (N)" then "User (N)".
  3. Click any skill row (e.g. `research`).
  4. Observe the toast and verify the queue.
  5. Run the queue verification command below to confirm the task was enqueued.
- **Command** (run after clicking):
  ```bash
  curl -sS 'http://localhost:8788/api/queue/tmux-conductor' | jq '.tasks[-1]'
  ```
- **Expected Result**: A `"/{skill-name} queued ✓"` message appears briefly in the modal then disappears. The queue command returns the enqueued task string (e.g. `"/research"`). After ~1.5 s the confirmation disappears automatically.
- [ ] Pass

---

### UAT-UI-005: Skills badges reflect frontmatter correctly for typecheck skill

- **Page**: `http://localhost:4321`
- **Description**: The `typecheck` skill has `user-invocable: true` and `disable-model-invocation: false` in its frontmatter, so it should show only the "project" badge (violet) — no "auto-only" or "manual" badge.
- **Steps**:
  1. Open the `tmux-conductor` agent modal.
  2. Expand "Skills (N)" and look at the `/typecheck` row under Project.
  3. Note which badges are present.
- **Expected Result**: Only a "project" badge (violet) is shown. No "auto-only" (blue) or "manual" (amber) badge is present.
- [ ] Pass
