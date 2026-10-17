---
id: TASK-0188
aliases: [TASK-0188]
title: "Keep bg process names globally unique and reject bg/agent window-name collisions in both directions"
status: trashed
created: 2026-09-19
updated: 2026-09-20
depends_on: []
blocks: []
parallel_safe_with: [TASK-0186, TASK-0187, TASK-0189]
uat: ""
tags: [bg-processes, host-server, decision, roadmap-0024]
---

# TASK-0188 — Keep bg process names globally unique and reject bg/agent window-name collisions in both directions

relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
relates_to::[[tmux-window-target-prefix-matching]]

> ROADMAP-0024 Phase 1. Edits `host-server/index.ts` in the bg-create and agent create/rename/clone regions only — disjoint from TASK-0180's and TASK-0185's regions. Re-read the file before editing.

## Objective

**Decision (2026-09-19): bg process names stay globally unique** — no per-project uniqueness, no table rebuild, no file renames. Routes, `bg-<name>.log` and `bg-<name>.state` are all keyed by the bare name, and bg processes share one tmux window namespace with agents (an agent's window is `agentWindowName()` = `<project>-<name>`, or just `<name>` with no project). This task records the decision and closes an enforcement gap found during research: `POST /bg-processes` rejects a duplicate bg name and a *live* window of that name, but does **not** check whether the name equals an agent's window name that currently has no live window (an inactive agent), and agent create/rename/clone does not check bg names at all. Either collision would make the two entities fight over one tmux window on next spawn/wake.

## Approach

Rejected: per-project unique names (would need the `agents`-style partial-unique-index rebuild plus project-qualified log/state filenames and routes); global names with an auto project prefix. Add one shared helper and call it from every create/rename path so the rule lives in one place.

Helper (in `host-server/db.ts`, next to `agentWindowName`): `findWindowNameConflict(db, windowName, opts?: { exceptAgentId?: number })` returns `{ kind: 'bg' | 'agent'; name: string } | null`, checking `listBgProcesses(db)` names and `listAgents(db).map(agentWindowName)`. Routes map a non-null result to `409 { error: "window name '<x>' is already used by <kind> '<name>'" }`.

Route-level tests have no Fastify harness in this repo (see UAT-0180), so unit-test the helper and defer route behavior to UAT.

## Steps

### 1. Add the shared helper  <!-- agent: general-purpose -->

- [ ] In `host-server/db.ts` add `findWindowNameConflict` as described (exported, pure over the DB, no tmux calls). Use `agentWindowName` for the agent side.

### 2. Enforce it on every path that creates or renames a window name  <!-- agent: general-purpose -->

- [ ] `host-server/index.ts` `POST /bg-processes` (~1911): after the existing duplicate-bg check, call the helper with the bg `name`; on a conflict with an **agent**, return the 409 above. Keep the existing `isTmuxWindowPresent` check.
- [ ] Agent creation: use `mcp__serena__find_referencing_symbols` on `createAgent` to find every route that creates an agent (`POST /agents`, `POST /projects/:id/agents`, clone at `POST /agents/:id/clone`, and any others); before each `createAgent`, compute the new agent's window name (`projectName ? \`${projectName}-${name}\` : name`) and reject a conflict with a **bg** process (409).
- [ ] Agent rename (`PATCH /agents/:id`, ~1473-1479): extend the existing agent-vs-agent `windowConflict` check to also reject a bg name; do the same for any route that changes an agent's project (its window name is project-prefixed), if one exists.

### 3. Tests  <!-- agent: general-purpose -->

- [ ] `host-server/db.test.ts`: cases for `findWindowNameConflict` — bg-vs-bg duplicate, bg name equal to a project agent's `<project>-<name>`, bg name equal to a no-project agent's bare name, agent window name equal to a bg name, `exceptAgentId` excluding the agent's own name on rename, and no conflict for a distinct name.

### 4. Record the decision  <!-- agent: general-purpose -->

- [ ] `Read` then `Edit` ROADMAP-0024 `## Notes` (append a bullet; re-read first — TASK-0186 also appends) and `wiki/knowledge/concepts/background-process-registry.md` (add a "Name uniqueness (2026-09-19)" paragraph: globally unique, why, the collision guard). Do not change roadmap checkboxes.

### 5. Verify  <!-- agent: general-purpose -->

- [ ] `cd host-server && npx tsc --noEmit && npm test` clean. Live `[DEFERRED-TO-UAT]`: `POST /api/bg-processes` with a `name` equal to an existing inactive agent's window name returns 409 before any window is created (safe: the 409 fires before `tmux new-window`).

## Notes

