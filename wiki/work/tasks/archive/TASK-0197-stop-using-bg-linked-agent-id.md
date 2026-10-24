---
id: TASK-0197
aliases: [TASK-0197]
title: "Stop reading and writing bg_processes.linked_agent_id: remove the link input, API/status fields, CONDUCTOR_BG_* env injection, and legacy AGENT_BG_LINKS"
status: done
created: 2026-09-19
updated: 2026-10-17
depends_on: []
blocks: [TASK-0198]
parallel_safe_with: [TASK-0188, TASK-0189]
uat: "[[UAT-0197]]"
tags: [bg-processes, host-server, frontend, scripts, roadmap-0024]
---

# TASK-0197 — Stop reading and writing bg_processes.linked_agent_id: remove the link input, API/status fields, CONDUCTOR_BG_* env injection, and legacy AGENT_BG_LINKS

implements::[[TASK-0187]]
relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
blocks::[[TASK-0198]]
relates_to::[[TASK-0195]]
relates_to::[[TASK-0196]]

> Stage 1 of 2 of the RETIRE decision recorded in `TASK-0187` (option C). This task removes every reader and writer of `linked_agent_id`, but **leaves the column in place, unused**, so the schema never loses a column while code still reads it. `TASK-0198` drops the column afterwards. Shares `AgentList.tsx` / `AgentList.test.tsx` with other in-flight tasks and the `POST/PATCH /bg-processes` handlers with `TASK-0195` and `TASK-0196`: re-read each file immediately before editing it.

## Objective

Projects own bg processes and `project_id` is the sole access boundary. The 1:1 `linked_agent_id` link overlaps with it, nothing consumes the `CONDUCTOR_BG_NAME/LOG/STATE` env vars it feeds, and the live DB has 0 linked rows. Remove the "Link to Agent" input, the `linkedAgent` / `linkedAgentId` fields on the API, status and SSE types, the env injection into the linked agent's launch (`scripts/conductor.sh`, `scripts/spawn.sh`, via `scripts/lib/db.sh::load_agents`), and the legacy `AGENT_BG_LINKS` conf remnants. After this task nothing reads or writes the column; new rows get `NULL`.

## Approach

- Do not touch the schema (`host-server/db.ts` DDL ~305) or add a migration here. The column stays, `SELECT *` still returns it, and `ON DELETE SET NULL` still applies. Dropping it is `TASK-0198`.
- Nothing replaces the env injection. The project-scoped `dev-commands` skill (list/status/tail, plus the restart and tail endpoints from `TASK-0190`/`TASK-0192`) is the only agent interface. Do not add a project-level env var set: agents do not read them, and env is frozen at agent launch so it goes stale when a bg process is added or renamed.
- The host-server never set `CONDUCTOR_BG_*` when spawning agents, so dashboard-spawned agents are unaffected.
- The separate legacy agent-side `linkedBg` derived from `conf.agentBgLinks` (`host-server/index.ts` ~1153, ~1519, ~2536) is removed here too.
- Use `mcp__serena__find_referencing_symbols` on each symbol before removing it so no consumer is missed. Line numbers are from 2026-09-19 and may drift.

## Steps

### 1. Backend: stop writing and exposing the link  <!-- agent: general-purpose -->

- [x] `host-server/index.ts` `POST /bg-processes` (~1890-1940): remove `linkedAgent` from the `Body` type and destructuring, its `typeof` validation, the "Resolve linkedAgent name to id" block, the `linkedAgentId` argument to `createBgProcess(...)`, and `linkedAgent` from the 201 response body. An old client still sending `linkedAgent` is ignored.
- [x] `host-server/db.ts::createBgProcess` (~693-696): remove the `linkedAgentId` param and the `linked_agent_id` column from the `INSERT`. Remove `linkedAgentId` from the `BgProcess` interface (~42) and `mapBgProcess` (~216). Keep `linked_agent_id` on `BgProcessRow` (~145) only if `SELECT *` types need it; otherwise remove it. Do not change the DDL (~305).
- [x] `host-server/db.ts` `seedFromLegacy` `linkBg` statement (~468, ~477-479) and its loop: remove it so first-boot seeding no longer writes links.
- [x] `host-server/index.ts` `BgStatus.linkedAgent` (~144), its computation in `buildBgStatuses` (~156) and return (~169), and the `prev.linkedAgent !== bg.linkedAgent` comparison in the SSE `bg-update` diff (~2690).
- [x] `host-server/index.ts` legacy agent-side `linkedBg` (~1153, ~1519, ~2536) and `host-server/config.ts` `AGENT_BG_LINKS` (`declare -p` list ~157, `bgLinksRaw` parse ~194-199, the `bgLinks`/`agentBgLinks` conf field): remove, using `find_referencing_symbols` to fix any remaining consumer.

### 2. Scripts: remove the env injection  <!-- agent: general-purpose -->

- [x] `scripts/lib/db.sh::load_agents` (~80): remove the `COALESCE(b.name,'')` select column and the `LEFT JOIN bg_processes b ON b.linked_agent_id=a.id`. This shifts positional fields, so `Read` every caller of `load_agents` (`conductor.sh`, `spawn.sh`, and any other found via `search_for_pattern` on `load_agents`) and update each `read -r` field list and any array holding the linked-bg name.
- [x] `scripts/conductor.sh` (~60-65, ~78-83) and `scripts/spawn.sh` (~51-56, ~68-73): remove the `_linked_bg` / `_bg_env` construction and its interpolation into the launch text.
- [x] `scripts/verify-teardown-window-mapping.sh` (~52): the fixture schema mirrors the real table and keeps the column; change it only if it depends on `load_agents` field order.
- [x] `conductor.conf` (~25-35): delete the `AGENT_BG_LINKS` block and its comment.
- [x] `bash -n` every edited script.

### 3. Frontend: remove the UI and types  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AddBgProcessForm.tsx`: remove the `linkedAgent` state (~51), its entry in the POST body (~96, ~103), and the "Link to Agent" select plus the help text mentioning `CONDUCTOR_BG_*` (~233-246). If the agents fetch exists only to populate that select, remove it too, and drop the "Show advanced" toggle if nothing else lives behind it.
- [x] `frontend/src/components/AgentList.tsx`: remove `linkedAgent` from the `BgProcess` type (~70) and the `linked to {bg.linkedAgent}` label (~1427); fix any comment that mentions `linkedAgent`.
- [x] `frontend/src/lib/api.ts` `BgProcessDefinition` (~419): remove `linkedAgentId`.

### 4. Tests  <!-- agent: general-purpose -->

- [x] `host-server/db.test.ts` (~119-156, ~260-273): the three link cases stop asserting a link. Assert `createBgProcess` no longer accepts or sets one and a fresh row has `linked_agent_id` NULL (a `SELECT linked_agent_id` is fine since the column still exists).
- [x] `frontend/src/components/AddBgProcessForm.test.tsx` (~195-216): drop the link-select cases; assert the POST body has no `linkedAgent`.
- [x] `frontend/src/components/AgentList.test.tsx`: remove `linkedAgent` from bg fixtures (type-only) and add one assertion that a bg tile renders no "linked to" text.
- [x] Leave `host-server/db.migration.test.ts` fixtures alone: they model historical schemas that still include the column.

### 5. Docs  <!-- agent: general-purpose -->

- [x] `search_for_pattern` `CONDUCTOR_BG_|linked agent|AGENT_BG_LINKS|linkedAgent` across `CLAUDE.md`, `AGENTS.md`, `README.md`, `scripts/README.md`, `skills/dev-commands/SKILL.md`, `conductor.conf`, and update or delete each mention. In `scripts/README.md` note that `bg_processes.linked_agent_id` remains as unused legacy data until `TASK-0198` drops it.
- [x] `Read` then `Edit` `wiki/knowledge/concepts/background-process-registry.md`: adjust the "linked_agent_id" subsection status once this task lands (code no longer reads or writes it; column drop pending `TASK-0198`).

### 6. Verify  <!-- agent: general-purpose -->

- [x] `cd host-server && npx tsc --noEmit && npm test`; `cd frontend && npx tsc --noEmit && npm test && npx eslint src`; `bash -n` on touched scripts. All clean: both tsc clean, host-server 295/295, frontend 339/339, eslint 0 errors (6 pre-existing LogTail warnings), `bash -n` clean. <!-- Updated: 2026-09-20 -->
- [ ] `[DEFERRED-TO-UAT]`: after `make dev`, spawn or wake an agent through `scripts/conductor.sh` and confirm `env | grep CONDUCTOR_BG` prints nothing; create a bg process from the dashboard with no link field.

## Dependencies

- Depends on: none (decision recorded in `TASK-0187`).
- Blocks: `TASK-0198` (the column must not be dropped while any code still reads it).
- Soft links: `TASK-0195` and `TASK-0196` edit the same `POST/PATCH /bg-processes` handlers and `AgentList.tsx`; land in any order but re-read before editing.
