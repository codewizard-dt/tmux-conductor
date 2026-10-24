---
id: TASK-0187
aliases: [TASK-0187]
title: "Decide the fate of the single-agent linked_agent_id now that projects own bg processes"
status: done
created: 2026-09-19
updated: 2026-09-20
depends_on: []
blocks: []
parallel_safe_with: [TASK-0186, TASK-0188, TASK-0189]
uat: ""
tags: [bg-processes, decision, roadmap-0024]
---

# TASK-0187 — Decide the fate of the single-agent linked_agent_id now that projects own bg processes

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
relates_to::[[TASK-0186]]

> ROADMAP-0024 Phase 1 (Decisions & Spike). Produces a **written decision, not production code.** Any code or migration the decision implies is filed as a follow-up task, not done here.

## Objective

`bg_processes.linked_agent_id` (nullable FK to `agents(id)`, `ON DELETE SET NULL`) pre-dates project scoping: it ties one bg process to one agent, and the bash side reads it to inject `CONDUCTOR_BG_NAME` / `CONDUCTOR_BG_LOG` / `CONDUCTOR_BG_STATE` into *that agent's* launch env (`scripts/conductor.sh:63,81`, `scripts/spawn.sh:54,71`, via the `LEFT JOIN bg_processes b ON b.linked_agent_id=a.id` in `scripts/lib/db.sh::load_agents`). Now that a project owns its bg processes and every agent in the project is meant to see and restart them, the 1:1 link overlaps with `project_id` and produces two ways to say "this agent may use this process". Decide whether the column stays, is narrowed, or is retired, and what replaces the env-var injection if it goes.

## Approach

Candidate outcomes:

| Option | What changes | Consequence |
|--------|--------------|-------------|
| A. Keep as-is | Nothing; document that `linked_agent_id` is a legacy convenience and `project_id` is the access boundary | Two overlapping concepts remain; `dev-commands` stays project-scoped while env vars stay agent-scoped |
| B. Deprecate | Stop exposing it in the create/edit forms and API docs; keep the column and env injection for existing rows | Least breakage, but a dead concept lingers |
| C. Retire | Migration drops the column (schema_version bump + `db.migration.test.ts` fixture); env injection is replaced by a project-level mechanism (for example every agent of the project gets the project's bg names, or the skill is the only interface) | Cleanest model; touches `db.ts`, `index.ts` bg routes, `AddBgProcessForm.tsx`, `AgentList.tsx`, both spawn scripts, `db.sh`, `conductor.conf` comments |

Evidence to gather first: every reader and writer of the field (host-server `index.ts` create/patch handlers around lines 1890-1940 and the status builder around 144-169; `db.ts` `BgProcess` type, `createBgProcess`, and the link-by-name statement near line 468/693; frontend `AddBgProcessForm.tsx` `linkedAgent` input, `AgentList.tsx`, `api.ts`; both spawn scripts and `db.sh`), plus whether any agent's prompt, skill, or CLAUDE.md actually consumes the `CONDUCTOR_BG_*` env vars (if nothing reads them, option C is nearly free).

Decision output must state: (1) keep / deprecate / retire, (2) what replaces `CONDUCTOR_BG_*` injection if anything, (3) the migration plan for existing linked rows (a linked row whose agent has a project could seed `project_id` where it is still `NULL`; coordinate with `TASK-0186`), (4) the list of follow-up tasks.

## Decision

**Outcome: RETIRE (option C), staged as two follow-ups so the column is never dropped while code still reads it.**

**Evidence (Step 1 inventory).**

- Live DB (`./data/conductor.db`): 2 `bg_processes` rows (`dev-stack`, project 3; `dev`, project 10). 0 rows have `linked_agent_id NOT NULL`, 0 have `project_id NULL`.
- Nothing consumes `CONDUCTOR_BG_NAME/LOG/STATE`. No skill, rule, `CLAUDE.md`, `AGENTS.md` or agent prompt in the repo tells an agent to read them; the only prose is a comment at `conductor.conf:25-35` and help text at `AddBgProcessForm.tsx:246`. Caveat: `~/.claude/rules/` could not be scanned by the Step 1 agent. The two rule files loaded into context (`agent-teams-preference.md`, `lsp-first.md`) do not mention them, but the directory was not exhaustively checked.
- The env vars are set in exactly one place: `scripts/conductor.sh:60-65,78-83` and `scripts/spawn.sh:51-56,68-73`, fed by the `LEFT JOIN` in `scripts/lib/db.sh:80`. The host-server never sets them when it spawns agents (zero `CONDUCTOR_BG_` hits under `host-server/`), so dashboard-spawned agents never had them.
- The `dev-commands` skill (`skills/dev-commands/SKILL.md`, `dev-commands.sh list|status|tail <name>`) is the real agent interface and uses `CONDUCTOR_STATE_DIR` / `CONDUCTOR_LOG_DIR`, not `CONDUCTOR_BG_*`.
- The link is immutable after create (`updateBgProcess` never touches `linked_agent_id`) and optional, hidden behind "Show advanced" in `AddBgProcessForm`.
- Reader/writer footprint: `host-server/db.ts` (`BgProcess.linkedAgentId` ~:42, row ~:145/:216, `createBgProcess` ~:693-696, `seedFromLegacy` `linkBg` ~:468/:477-479, schema :305); `host-server/index.ts` (`BgStatus.linkedAgent` :144, `buildBgStatuses` :156/:169, `POST /bg-processes` ~:1890-1940, SSE `bg-update` diff ~:2690); `frontend/src/lib/api.ts:419`; `AgentList.tsx:70` and `:1427`; `AddBgProcessForm.tsx` :51/:96/:103/:233-246; `scripts/lib/db.sh:80`; `conductor.sh`; `spawn.sh`; `scripts/verify-teardown-window-mapping.sh:52` (fixture); `conductor.conf:25-35` (`AGENT_BG_LINKS`, read by `host-server/config.ts` ~:157, :194-199); plus the separate legacy agent-side `linkedBg` from `conf.agentBgLinks` (`index.ts` ~:1153/1519/2536). Tests that break: `host-server/db.test.ts` (3 cases ~:119-156, :260-273), `AddBgProcessForm.test.tsx:195-216`, `AgentList.test.tsx` fixtures (type-only). `db.migration.test.ts` fixtures are old-version schemas and stay valid.

**The four output points.**

| # | Point | Answer |
|---|-------|--------|
| 1 | Keep / deprecate / retire | **Retire.** |
| 2 | Replacement for `CONDUCTOR_BG_*` injection | **Nothing is injected.** The project-scoped `dev-commands` skill (list/status/tail, plus the restart and ANSI-stripped tail endpoints from `TASK-0190`/`TASK-0192` under ROADMAP-0024) is the only agent interface, and `project_id` is the sole access boundary. Rejected: a project-level env var set. Agents do not read them, env is frozen at launch so it goes stale the moment a bg process is added or renamed, and it would recreate the same dead concept at project scope. |
| 3 | Migration plan for existing linked rows | No live data to migrate (0 linked rows). The migration must still be safe on other installs: before the column is dropped, seed `project_id` from the linked agent's `project_id` `WHERE project_id IS NULL AND linked_agent_id IS NOT NULL`; anything still `NULL` afterwards is backfilled by workdir under `TASK-0186`'s 2026-09-20 amendment (a project is required for every bg process; enforced by `TASK-0195`/`TASK-0196`). SQLite cannot `ALTER TABLE DROP COLUMN` a column with a `REFERENCES` clause, so removal needs a table-rebuild migration (`schema_version` bump plus a `db.migration.test.ts` fixture, same pattern as the earlier `agents` v2 and `tasks` v8 rebuilds). See coupling below. |
| 4 | Follow-up tasks | `TASK-0197` and `TASK-0198` (below). |

**Coupling with sibling decisions.**

- `TASK-0186` (done; amended 2026-09-20 to require a project for every bg process): rows left `NULL` after the seed must be backfilled by workdir before `project_id` becomes `NOT NULL`. The linked-agent seed this decision needs is one input to that backfill, so it is implemented once, inside the shared v10 rebuild (`TASK-0196`/`TASK-0198`). `TASK-0195` prevents new `NULL` rows at the source.
- `TASK-0188` (decision in flight; follow-up `TASK-0196` already filed, Option B): `TASK-0196` plans a `schema_version` 10 rebuild of `bg_processes` (two partial unique indexes) and already says to fold any `linked_agent_id` change into it. `TASK-0198` therefore says: if `TASK-0196` has not shipped, drop the column inside that same v10 rebuild (one migration, one version bump, one fixture); if it has, add the next standalone rebuild that recreates `TASK-0196`'s indexes.

**Rejected options.**

- **A. Keep as-is:** leaves two overlapping ways to say "this agent may use this process", keeps dead code, and keeps a form input whose help text promises env vars nothing reads.
- **B. Deprecate:** hiding the input while keeping the column and env injection preserves exactly the dead concept this task exists to remove. With zero live rows and zero consumers, its "least breakage" advantage is worthless.

**Rationale.** No consumer, no live data, and a cheap mechanical removal make C nearly free, whereas A and B keep a dead concept indefinitely.

**Follow-up tasks (not implemented here).**

- [[TASK-0197]] (`wiki/work/tasks/TASK-0197-stop-using-bg-linked-agent-id.md`) — stage 1: stop reading and writing `linked_agent_id`: remove the `linkedAgent` form input, API field, status/SSE field, env injection, and legacy `AGENT_BG_LINKS`/`linkedBg`, with tests and docs. Column left in place, unused. Must land first.
- [[TASK-0198]] (`wiki/work/tasks/TASK-0198-drop-bg-linked-agent-id-column-migration.md`) — stage 2: drop `bg_processes.linked_agent_id` via a table-rebuild migration that seeds `project_id` first; depends on `TASK-0197`; folded into `TASK-0196`'s v10 rebuild if that has not shipped.

## Steps

### 1. Gather evidence  <!-- agent: Explore -->

- [x] Produce a complete reader/writer inventory of `linked_agent_id` / `linkedAgent` / `linkedAgentId` and `CONDUCTOR_BG_NAME|LOG|STATE`
  - Use Serena `search_for_pattern` over `host-server/`, `frontend/src/`, `scripts/`, `skills/`, `hooks/`, `conductor.conf` (skip `wiki/` and `raw/`)
  - For each hit record: reader or writer, and whether removing it breaks a test (`host-server/db.test.ts`, `db.migration.test.ts`, `AddBgProcessForm.test.tsx`, `AgentList.test.tsx`)
  - Search agent-facing prose (`skills/dev-commands/SKILL.md`, `~/.claude/rules/`, project `CLAUDE.md`) for any instruction that tells an agent to read the `CONDUCTOR_BG_*` vars
  - Read-only query the live DB for how many rows have `linked_agent_id NOT NULL` (`sqlite3 -readonly ./data/conductor.db`), and how many of those also lack a `project_id`

<!-- Updated: 2026-09-19 -->

### 2. Decide and record  <!-- agent: general-purpose -->

- [x] Write the decision into this task under a new `## Decision` section above `## Steps` covering the four output points in Approach, rejected options, and rationale <!-- Updated: 2026-09-20 -->
- [x] Append a short "linked_agent_id" subsection to `wiki/knowledge/concepts/background-process-registry.md` recording the outcome, with `derived_from::[[TASK-0187]]` <!-- Updated: 2026-09-20 -->
- [x] If the outcome is B or C, file the implementation follow-up(s) with `/task-add` (migration, form/API cleanup, spawn-script change) and list their IDs in the Decision section; do not implement them here <!-- Updated: 2026-09-20 --> (`TASK-0197`, `TASK-0198`)

### 3. Close out  <!-- agent: general-purpose -->

- [x] Flip this task to `done` per `wiki/work/tasks/lifecycle.md`, drop its line from `wiki/work/tasks/index.md`, tick the ROADMAP-0024 checkbox for this item, and append a `wiki/log.md` entry <!-- Updated: 2026-09-20 -->

## Dependencies

- Depends on: none.
- Blocks: nothing hard in ROADMAP-0024; any follow-up implementation task becomes its dependent.
- Soft link: coordinate with `TASK-0186` (a linked agent's project can seed `project_id` for unscoped rows) and `TASK-0188` (name-uniqueness decision touches the same table rebuild if a migration is needed; if both decisions require a `bg_processes` rebuild, fold them into one migration).
- Parallel-safe with `TASK-0186`, `TASK-0188`, `TASK-0189`.
