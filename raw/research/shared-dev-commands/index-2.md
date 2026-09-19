---
topic: >
  Scope TASK-add for ROADMAP-020 Phase 1 ("Fix the split-brain"): make SQLite
  the sole source of truth for bg-process definitions — host-server routes
  call db.ts's createBgProcess/deleteBgProcess instead of the conductor.conf
  writers.
slug: shared-dev-commands
researched: 2026-09-13
sources: [./sources-2.md]
---

# Research: Fix the bg-process split-brain (ROADMAP-020 Phase 1)

> Builds on [index.md](index.md) — that report already identified and recommended fixing this split-brain (its Gap 1 and Option A step 1). This pass re-confirms the split-brain against the **current** code (line numbers, symbol names, call sites all re-verified live rather than trusted from the prior report) and adds one finding the prior report missed: the split-brain is **wider** than `BG_PROCESSES` alone — `AGENT_BG_LINKS` (the bg↔agent link) is *also* split, and the bash side has already fully migrated off it. This turns "Option A step 1" from a recommendation into a concrete, line-cited implementation plan for a single task.

## Research Questions
- Where do bg-process *definitions* currently get written/read across `conductor.conf` vs SQLite `db.ts`, as of the current working tree (not the prior report's line numbers)?
- Which host-server routes still call the `conductor.conf` writers, and what exactly would each call site become?
- What does `db.ts` already expose (`createBgProcess`/`deleteBgProcess`/`listBgProcesses`) vs. what's still missing for the routes to use it as sole source of truth?
- What do `conductor.sh`/`spawn.sh`/`monitor.sh` (via `scripts/lib/db.sh`'s `load_bg`/`load_agents`) actually read today, and does the *link* (bg↔agent), not just the bg-process list, have the same split?
- What is the smallest correct implementation plan for one task, including test surface?

## Current State (Codebase) — re-confirmed live

**Definitions split** (confirms prior report's Gap 1, now with exact locations):
- `scripts/lib/db.sh`'s `load_bg()` (`scripts/lib/db.sh:71-82`) reads `SELECT name, workdir, launch_cmd FROM bg_processes ORDER BY name` — SQLite only. Called by `conductor.sh`, `spawn.sh`, `monitor.sh`, `teardown.sh` — this is what actually spawns/monitors/tears down bg processes.
- `host-server/index.ts:1817-1860` (`POST /bg-processes`) still calls `appendBgProcessToConf(conf._confPath, ...)` (`host-server/config.ts:234-252`, regex-edits the `BG_PROCESSES=(...)` block in `conductor.conf`) — with the exact code comment the prior report cited, unchanged: *"conductor.conf is authoritative for bg processes... write the definition there, not the DB."*
- `host-server/index.ts:1862-1889` (`DELETE /bg-processes/:name`) calls `removeBgProcessFromConf` (`host-server/config.ts:254-276`) — same pattern, same conf-only write.
- `host-server/index.ts:1894-1916` (`POST /bg-processes/:name/window`) and `:1922-1940` (`DELETE .../window`) both look up the entry via `conf.bgProcesses.find(...)` — reads from the conf-parsed array, not SQLite.
- `buildBgStatuses` (`host-server/index.ts:147-166`, feeding `GET /status`'s `bgProcesses` array via `buildSnapshot` → `host-server/index.ts:2404`) destructures `bgProcesses`/`agentBgLinks` from `conf` (the parsed `conductor.conf`), not from SQLite.
- `host-server/db.ts` already exports `listBgProcesses` (674-676), `createBgProcess` (678-683, takes `{name, workdir, launchCmd, linkedAgentId?}`), `deleteBgProcess` (685-687, takes numeric `id`) — all fully implemented, and (confirmed via `host-server/db.test.ts`, which has **zero** `BgProcess`-related assertions) **completely untested**, not just uncalled.

**New finding — the link (bg↔agent) is split too, and bash already migrated off the conf side:**
- `scripts/lib/db.sh`'s `load_agents()` (line 65) joins `bg_processes.linked_agent_id` directly in SQL: `LEFT JOIN bg_processes b ON b.linked_agent_id=a.id` to populate each agent's `_linked_bg`, which `conductor.sh`/`spawn.sh` then use to inject `CONDUCTOR_BG_NAME`/`CONDUCTOR_BG_LOG`/`CONDUCTOR_BG_STATE` into that agent's launch env (`scripts/conductor.sh:62-66`, `scripts/spawn.sh:53-57`, and their container-mode twins). **The bash side reads the link from `bg_processes.linked_agent_id` (SQLite), not from `conductor.conf`'s `AGENT_BG_LINKS` array at all.**
- Yet `host-server/index.ts`'s `POST /bg-processes` still writes the link into `conductor.conf` — `await addBgLink(conf._confPath, linkedAgent, name)` (`host-server/config.ts:278-307`, appends to the `AGENT_BG_LINKS=(...)` block) — and `DELETE /bg-processes/:name` calls the inverse `removeBgLink` (`host-server/config.ts:309-331`). **These writes currently land in a conf array nothing reads for spawn/env purposes any more** — a bg process linked to an agent through the dashboard today gets an `AGENT_BG_LINKS` entry that `conductor.sh`/`spawn.sh` silently ignore, so the agent never receives `CONDUCTOR_BG_NAME` etc. This is a live, user-facing consequence of the split-brain beyond what the prior report scoped (it only called out `BG_PROCESSES`, not `AGENT_BG_LINKS`).
- `appendBgProcessToConf`, `removeBgProcessFromConf`, `addBgLink`, `removeBgLink` (`host-server/config.ts`) have **exactly the four call sites listed above** in `host-server/index.ts` (confirmed via project-wide search) and no test coverage (`host-server/config.test.ts` only exercises `readConductorConf`/`clearConfCache`). Once the two route handlers stop calling them, they become fully dead code with zero remaining callers.
- `clearConfCache()` is called at the end of both route handlers (`index.ts:1852`, `:1883`) purely to invalidate the conf-read cache after the conf-file write — becomes unnecessary once the write is SQLite-only (the DB is queried live, no cache to invalidate). `clearConfCache` itself has other, unrelated callers (test files) and stays exported.
- `readConductorConf`'s parsing of `BG_PROCESSES`/`AGENT_BG_LINKS` into `ConductorConf.bgProcesses`/`agentBgLinks` (`host-server/config.ts:148-232`) is **not** dead after this fix — `db.ts`'s `seedFromLegacy()` (`host-server/db.ts:447-480`) still reads `conf.bgProcesses`/`conf.agentBgLinks` once, on first-ever DB open, to import any pre-existing conf-defined bg processes into SQLite. This parsing must be left untouched; only the *write-back* functions and their four call sites are in scope.

## Key Findings

- The split-brain is real and reproducible from current code, exactly as the prior report described for bg-process *definitions* [S1][S2].
- It additionally covers the bg↔agent *link*, and here the bash scripts have already fully cut over to SQLite (`bg_processes.linked_agent_id` via a SQL join) — so the host-server's conf-writing side isn't just redundant, it's actively producing data nothing consumes, while the actual runtime behavior (env var injection) is already correctly SQLite-driven [S3][S4].
- `createBgProcess`/`deleteBgProcess`/`listBgProcesses` are implementation-ready but have zero test coverage today — any task wiring them into live routes should add DB-level tests for them, not just route-level ones [S5].
- Four writer functions in `config.ts` (`appendBgProcessToConf`, `removeBgProcessFromConf`, `addBgLink`, `removeBgLink`) have exactly one caller file (`index.ts`) and exactly four call sites total, all within the two routes this task touches — clean removal candidates once the routes are rewired, with no fan-out risk elsewhere in the codebase [S1].
- No frontend changes are required: `AddBgProcessForm.tsx` and `AgentList.tsx`'s `BgProcessSection`/`BgProcessRow` only consume the `POST/DELETE /bg-processes[/window]` JSON contract, which this fix does not change (same request/response shapes, different storage underneath) [S6].

## Constraints

- `linkedAgent` arrives at `POST /bg-processes` as an agent **name** (string) today (`req.body.linkedAgent`), but `createBgProcess`'s `linkedAgentId` is a numeric FK into `agents.id`. Agent names are only unique **per project** (`idx_agents_project_name`/`idx_agents_null_name` in `db.ts`'s v2 migration) — a bare-name lookup can be ambiguous across projects. `bg_processes` has no `project_id` yet (that's ROADMAP-020 Phase 2, explicitly out of scope here), so there is no project context to disambiguate with. The correct, honest scope for this task is: resolve by first name match via `listAgents(db)`, and leave true disambiguation to Phase 2's `project_id` work — do not attempt to solve project-scoped linking here.
- Must not touch `BG_PROCESSES=()`/`AGENT_BG_LINKS=()` blocks in `conductor.conf` or `readConductorConf`'s parsing of them — `seedFromLegacy()` still depends on that parsing for one-time legacy import on first DB open. Only the four *write* functions and their call sites are in scope for removal.
- `db.migration.test.ts` already has fixtures that create a `bg_processes` table at multiple schema versions — any new DB-level tests for `createBgProcess`/`deleteBgProcess`/`listBgProcesses` belong in `db.test.ts` (general CRUD), not `db.migration.test.ts` (schema-version transitions only), to keep the two test files' concerns separate as the codebase already does for `agents`/`tasks`/`schedules`.
- Per CLAUDE.md: never read/write `.env` files (not relevant here — no `.env` involved) and use `./tmp/` for any host-side scratch/verification, never `/tmp`.

## Recommendation

**Scope for this task** (ROADMAP-020 Phase 1 only — no `project_id`, no UI, no skill/script; those are Phases 2-4):

1. `POST /bg-processes` (`host-server/index.ts:1817-1860`): replace the `conf.bgProcesses.some(...)` uniqueness check with a check against `listBgProcesses(db)`; resolve `linkedAgent` (name) → `linkedAgentId` via `listAgents(db).find(a => a.name === linkedAgent)` (400 if a non-empty `linkedAgent` doesn't resolve); call `createBgProcess(db, { name, workdir, launchCmd, linkedAgentId })` in place of `appendBgProcessToConf` + `addBgLink`; drop the now-unneeded `clearConfCache()` call in this handler. Tmux window creation / pipe-pane lines (1855-1857) are unaffected.
2. `DELETE /bg-processes/:name` (`:1862-1889`): look up the entry via `listBgProcesses(db).find(b => b.name === name)` instead of `conf.bgProcesses.find(...)`; call `deleteBgProcess(db, entry.id)` in place of `removeBgProcessFromConf` + `removeBgLink` (deleting the row already drops the link, since `linked_agent_id` lives on the `bg_processes` row itself); drop the `clearConfCache()` call. State-file cleanup (`unlinkSync` on `bg-${name}.state`) is unaffected.
3. `POST /bg-processes/:name/window` (`:1894-1916`) and `DELETE /bg-processes/:name/window` (`:1922-…`): swap their `conf.bgProcesses.find(...)` lookups for `listBgProcesses(db).find(...)`. No conf writes happen in these two handlers today, so nothing else changes.
4. `buildBgStatuses` (`:147-166`): source the process list from `listBgProcesses(db)` instead of `conf.bgProcesses`; resolve each entry's `linkedAgent` **display name** by looking up `listAgents(db).find(a => a.id === bg.linkedAgentId)?.name ?? null` instead of scanning `conf.agentBgLinks`. `db` is already an in-scope module-level binding in `index.ts` (used directly by several other functions, e.g. `buildQueuedTaskCounts`), so no new parameter needs to thread through — `buildBgStatuses` can drop its dependency on `conf.bgProcesses`/`conf.agentBgLinks` while keeping its `conf` param for `sessionName`/`stateDir`/`logDir`.
5. Remove `appendBgProcessToConf`, `removeBgProcessFromConf`, `addBgLink`, `removeBgLink` from `host-server/config.ts` and their import in `index.ts` (`clearConfCache` and the rest of the `config.ts` import stay, since `clearConfCache`/`readConductorConf`/`DEFAULT_CONF_PATH` have other live uses). Leave the `BG_PROCESSES=()`/`AGENT_BG_LINKS=()` blocks and their parsing in `conductor.conf`/`config.ts` untouched (still needed by `seedFromLegacy`).
6. Tests: add `createBgProcess`/`listBgProcesses`/`deleteBgProcess` CRUD coverage to `host-server/db.test.ts` (currently absent); extend/adjust any `host-server/index.ts` route-level tests (or add them, if bg-process routes are currently untested at that layer — confirm during implementation) to assert the SQLite-only path; run `host-server/db.migration.test.ts` unchanged (schema itself isn't migrating) to confirm no regression.

**Risks and mitigations:**
- **Losing the agent-name→id resolution for `linkedAgent`.** Mitigate by 400-ing clearly when the name doesn't resolve to exactly the intended agent (accept the per-project-name-ambiguity limitation explicitly, documented as deferred to Phase 2, rather than silently guessing).
- **Removing conf-writer functions breaks something not caught by search.** Mitigated by the confirmed-empty call-site search above (`host-server/config.ts` writers have exactly the four call sites cited, all in the two routes this task rewires) — safe to remove in the same task rather than leaving them as unreferenced dead code.
- **`buildBgStatuses`'s signature/behavior change affecting `GET /status` snapshot consumers.** The JSON shape of `BgStatus` (`name, workdir, launchCmd, windowPresent, state, logPath, statePath, linkedAgent`) is unchanged — only the internal data source moves from conf to SQLite — so downstream (dashboard) consumers need no changes.

## Next Steps

- `/task-add` this exact scope as the ROADMAP-020 Phase 1 task (already in progress in this session).
- Once done, Phase 2 (`project_id` on `bg_processes`) becomes unblocked and should reuse the same `listAgents`/`listBgProcesses` patterns established here.
