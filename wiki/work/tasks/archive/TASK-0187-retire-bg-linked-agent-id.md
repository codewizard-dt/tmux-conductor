---
id: TASK-0187
aliases: [TASK-0187]
title: "Retire linked_agent_id: stop writing the link, drop its UI and CONDUCTOR_BG_* env injection"
status: trashed
created: 2026-09-19
updated: 2026-09-20
depends_on: []
blocks: []
parallel_safe_with: [TASK-0186, TASK-0188, TASK-0189]
uat: ""
tags: [bg-processes, host-server, frontend, scripts, roadmap-0024]
---

# TASK-0187 — Retire linked_agent_id: stop writing the link, drop its UI and CONDUCTOR_BG_* env injection

relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]

> ROADMAP-0024 Phase 1. Shares `AgentList.tsx` / `AgentList.test.tsx` with other in-flight tasks — re-read those files immediately before editing. Edits `host-server/index.ts` in the bg-process regions only (`BgStatus`/`buildBgStatuses`, `POST /bg-processes`, the bg diff at ~2690), which are disjoint from TASK-0180's and TASK-0185's regions.

## Objective

Projects now own bg processes, so the one-agent-to-one-bg-process link is redundant: any agent in the project reaches its bg processes through the skill and server. **Decision (2026-09-19): retire it.** Stop writing the link, remove the "Link to Agent" UI, the `linkedAgent` fields on the API/UI types, the `CONDUCTOR_BG_NAME/LOG/STATE` env injection into the linked agent's launch, and the `AGENT_BG_LINKS` conf remnants. **Leave the `bg_processes.linked_agent_id` column in place as unused data** — SQLite cannot `DROP COLUMN` a column that is part of a foreign key without rebuilding the table, and rebuilding is out of scope. Existing values stay stale and harmless.

## Approach

Rejected alternatives: keep as an optional "owner" label; keep unchanged; full removal with a table rebuild. Existing rows keep their `linked_agent_id`; nothing reads it after this task (`ON DELETE SET NULL` on the FK still applies).

Use `mcp__serena__find_referencing_symbols` for each symbol before removing it, so no consumer is missed. Line numbers below are from 2026-09-19 and may drift.

## Steps

### 1. Backend: stop writing and exposing the link  <!-- agent: general-purpose -->

- [ ] `host-server/index.ts` `POST /bg-processes` (~1891): remove `linkedAgent` from the `Body` type and destructuring, the `typeof linkedAgent` validation (~1917), the "Resolve linkedAgent name to id" block (~1924-1932), the `linkedAgentId` spread in the `createBgProcess(...)` call (~1935), and `linkedAgent` from the 201 response body (~1941). An old client still sending `linkedAgent` is simply ignored.
- [ ] `host-server/db.ts::createBgProcess` (~693): remove the `linkedAgentId` param and the `linked_agent_id` column from the `INSERT` (the column defaults to NULL). Remove `linkedAgentId` from the `BgProcess` interface (~42) and `mapBgProcess` (~216); keep `linked_agent_id` on `BgProcessRow` (~145) since `SELECT *` still returns it.
- [ ] `host-server/db.ts` `seedFromLegacy` `linkBg` statement (~468) and its loop: remove the legacy `AGENT_BG_LINKS` import so first-boot seeding no longer writes links.
- [ ] `host-server/index.ts` `BgStatus.linkedAgent` (~144), its computation in `buildBgStatuses` (~156) and return (~169), and the `prev.linkedAgent !== bg.linkedAgent` comparison in the bg-update diff (~2690).
- [ ] `host-server/config.ts`: remove `AGENT_BG_LINKS` from the `declare -p` list (~157), the `bgLinksRaw` parse (~194) and the `bgLinks` field from the conf type; use `find_referencing_symbols` on `bgLinks` to fix any remaining consumer.

### 2. Scripts: remove the env injection  <!-- agent: general-purpose -->

- [ ] `scripts/lib/db.sh` `load_agents` (~80): remove the `COALESCE(b.name,'')` select column and the `LEFT JOIN bg_processes b ON b.linked_agent_id=a.id`. This shifts the positional fields, so `Read` every caller of `load_agents` (`conductor.sh`, `spawn.sh`, and any other script found with `search_for_pattern` on `load_agents`) and update each `IFS=... read -r` field list and any array that held the linked-bg name.
- [ ] `scripts/conductor.sh` (~63, ~81) and `scripts/spawn.sh` (~54, ~71): remove the `_linked_bg`/`_bg_env` construction and its interpolation into the launch text.
- [ ] `scripts/verify-teardown-window-mapping.sh` (~52) fixture schema keeps the `linked_agent_id` column (it mirrors the real table); only change it if it depends on `load_agents` field order.
- [ ] `bash -n` every edited script.

### 3. Frontend: remove the UI and types  <!-- agent: general-purpose -->

- [ ] `frontend/src/components/AddBgProcessForm.tsx`: remove the `linkedAgent` state (~51), it from the POST body (~96), and the "Link to Agent" select plus the help text mentioning `CONDUCTOR_BG_*` (~236-246). If the agents fetch exists only to populate that select, remove it too.
- [ ] `frontend/src/components/AgentList.tsx`: remove `linkedAgent` from the `BgProcess` type (~70) and the `linked to {bg.linkedAgent}` label (~1427); fix the ~2018 comment that mentions `linkedAgent`.
- [ ] `frontend/src/lib/api.ts` `BgProcessDefinition` (~419): remove `linkedAgentId`.

### 4. Tests  <!-- agent: general-purpose -->

- [ ] Update `frontend/src/components/AddBgProcessForm.test.tsx` (drop link-select cases; assert the POST body has no `linkedAgent`), `frontend/src/components/AgentList.test.tsx` (drop bg-tile "linked to" cases; add one asserting a bg tile renders no "linked to" text), `host-server/db.test.ts` (`createBgProcess` no longer accepts/sets a link; a row created with the old shape has `linked_agent_id` NULL).
- [ ] Leave `host-server/db.migration.test.ts` fixtures alone — they model historical schemas that still include the column.

### 5. Docs  <!-- agent: general-purpose -->

- [ ] `search_for_pattern` `CONDUCTOR_BG_|linked agent|AGENT_BG_LINKS` across `CLAUDE.md`, `AGENTS.md`, `README.md`, `scripts/README.md`, `skills/dev-commands/SKILL.md`, `conductor.conf`, and update or delete each mention; note in `scripts/README.md` that `bg_processes.linked_agent_id` remains as unused legacy data.
- [ ] `Read` then `Edit` `wiki/knowledge/concepts/background-process-registry.md`: add a short "linked_agent_id retired (2026-09-19)" note.

### 5b. Verify  <!-- agent: general-purpose -->

- [ ] `cd host-server && npx tsc --noEmit && npm test`, `cd frontend && npx tsc --noEmit && npm test && npx eslint src`; all clean. Live check `[DEFERRED-TO-UAT]`: after `make dev`, spawn/wake an agent and confirm `env | grep CONDUCTOR_BG` prints nothing; create a bg process from the dashboard with no link field.

## Notes

