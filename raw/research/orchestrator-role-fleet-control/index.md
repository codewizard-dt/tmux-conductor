---
topic: a new 'role' for agents is 'orchestrator' and they can manage tmux window agents and bg processes
slug: orchestrator-role-fleet-control
researched: 2026-09-20
sources: [./sources.md]
---

# Research: An `orchestrator` Agent Role That Manages tmux-Window Agents and Background Processes

> Builds on [orchestrator-agent-routing](../orchestrator-agent-routing/index.md) (+ `index-2.md`, `index-3.md`), [multi-agent-infrastructure-requirements](../multi-agent-infrastructure-requirements/index.md), [host-agent-identification-and-control](../host-agent-identification-and-control/index.md) and [bg-process-agent-access](../bg-process-agent-access/index.md). Those asked *how a task finds its agent* and *what must exist beneath any orchestrator*. This report asks a different question they never did: **what does it take for one agent — carrying a new `orchestrator` role — to manage the *lifecycle* of the fleet's tmux windows and bg processes?** Headline: almost every control verb the orchestrator needs **already exists as a host-server HTTP route** [S5, S7]; what is missing is (1) the role value itself, which is a CHECK-constrained enum needing a table-rebuild migration [S1], (2) any way for the role to *change an agent's behaviour* unless it has a worktree — the role fragment is only ever written into a worktree's `CLAUDE.md` [S2, S4], (3) an agent-facing client (a skill, following the `dev-commands` precedent [S8]), (4) an unambiguous caller identity — today only the window name reaches the agent's env, and it is non-injective [S6, S9], and (5) guardrails: self-target protection, fleet-size cap, no recursive orchestrators, human-confirmed destructive actions, and an audit trail. Under the repo's no-auth trust model a server-side check **cannot deny a headerless caller** (a headerless call is a "human"), so the orchestrator role is a *capability grant plus guardrails plus audit*, not a permission wall [S9, S21]. Recommendation: extend the enum with `orchestrator`, scope v1 to **lifecycle management only** (open/close/create windows, bg open/close/restart/tail) — deliberately *not* task-completion tracking or task routing, which depend on unbuilt Tier-0 infrastructure [S12] — and build on ROADMAP-0024's restart/identity/audit work rather than re-planning it [S10].

## Research Questions
1. Which management verbs does an orchestrator need for tmux-window agents and bg processes, and which already exist as host-server routes?
2. What does adding `orchestrator` to the `agents.role` enum actually touch (schema, presets, tests, UI), and does a role change an agent's behaviour today?
3. How does an orchestrator agent call the host-server, and how does the server know *who* is calling and whether that caller may act?
4. What guardrails does an agent that can spawn, close and restart things need (self-harm, recursion, cost, destructive actions, audit)?
5. How does this sequence against the active roadmaps and the earlier orchestrator research?

## Current State (Codebase)

**Control verbs already exist as routes** (all unauthenticated, keyed by numeric agent id / bg name) [S5, S7]:

| Need | Existing route | Notes |
|---|---|---|
| Observe fleet | `GET /status`, `GET /agents`, `GET /agents/:id/tail`, `GET /projects/:id/bg-processes` | read-only |
| Create agent + window | `POST /agents` (`name`, `workdir`, `launchCmd`, `role`, `useWorktree`) | 409 if session down or window exists; returns 201 |
| Close / reopen agent window | `DELETE /agents/:id/window`, `POST /agents/:id/window` | close removes the state file; reopen reaps a dead husk, 409 if already running or ambiguous |
| Delete agent | `DELETE /agents/:id` | force-removes worktree and `branch -D` (DEC-0006 driver 3: destructive) [S11] |
| Give work | `POST /tasks` (`agentId`, `command`, `placement`) | enqueue path |
| Type into a pane | `POST /agents/:id/keys`, `/mode` | direct injection; DEC-0006 driver 7 says routers may only enqueue [S11] |
| Bg open / close / read | `POST`/`DELETE /bg-processes/:name/window`, `GET /bg-processes/:name/tail` | open returns 409 if the window exists |
| Bg restart | **missing** — planned as `TASK-0190` in ROADMAP-0024 [S10, S14] | |

**The role is a label, not a behaviour, unless the agent has a worktree.** `agents.role` is `TEXT NOT NULL DEFAULT 'generic' CHECK (role IN ('generic','frontend','backend','qa','devops','security','architect'))`, added in schema v7 [S1]. `getRoleFragment` supplies a prompt fragment per role from `role-presets.json` [S2, S3], but `applyRoleFragmentToWorktree` — which appends `## Role: <role>` to `<worktree>/CLAUDE.md` — has exactly two call sites, both in worktree creation paths in `db.ts` (`createAgent` with a worktree, and the retroactive create-worktree helper) [S2, S4]. An agent created without a worktree therefore gets **no role-driven prompt at all**. An orchestrator does not edit code and would normally not have a worktree.

**Enum duplication.** The enum lives in four places that must be edited together: the CHECK in `db.ts` (v7) [S1], `ROLE_VALUES` in `rolePresets.ts` (whose header comment says to keep it in sync) [S2], `role-presets.json` [S3], and the migration test fixtures (`db.migration.test.ts` lines 237 and 327 embed the same 7-value CHECK). `POST /agents` and `POST /projects/:id/agents` both validate against `ROLE_VALUES` [S5, S7]. The frontend treats role as a free string (`role?: string | null` in `AgentList.tsx:45`, `role?: string` in `api.ts:365`) — a pattern search found no hard-coded frontend role list [S17] *(the location of the role picker was not confirmed)*.

**CHECK widening has a precedent.** SQLite cannot alter a CHECK in place; schema v8 did a full rebuild — `foreign_keys = OFF`, a transaction that creates `tasks_v8`, copies columns explicitly (never `SELECT *`), drops, renames, recreates the index [S1]. Schema is at v10 [S1]; ROADMAP-0024's `TASK-0195/0196/0198` (bg_processes NOT NULL, per-project uniqueness, drop `linked_agent_id`) also need migrations [S10], so version numbers must be coordinated.

**Identity reaching an agent.** The spawn command is `CONDUCTOR_AGENT_NAME='<winName>' CONDUCTOR_STATE_DIR=… CONDUCTOR_LOG_DIR=… <launchCmd>` [S6]; `<winName>` is `<project>-<name>` for project agents, which is not injective (`a-b`+`c` vs `a`+`b-c`) [S9]. The agent's numeric DB id — the key every route uses [S16] — is **not** exported. `TASK-0193/0194` (todo) define an `X-Conductor-Agent` header resolved server-side, failing closed on unknown/ambiguous callers [S9].

**Agent-facing client precedent.** `skills/dev-commands/` is a skill (`SKILL.md` + `dev-commands.sh`, `curl` + optional `jq`, offline fallback) that agents use to read bg process state and logs [S8]; the installer already copies the skill directory [S14].

**No wake-up channel.** An agent runs only when the queue dispatches a task or a human types. `schedules` (`POST /schedules`, `intervalSeconds`, `action: append|jump`, `agentId`) already enqueue a prompt to a chosen agent on an interval [S5], and `startManagedLoop` exists as a timer host [S12].

## Key Findings

1. **The gap is not verbs, it is identity, effect, and guardrails.** Spawn, window open/close, task enqueue, bg window open/close and tail are all routes today [S5, S7]; the only missing verb is bg restart, already scheduled [S10]. Building an orchestrator therefore does not need a new control API; it needs a caller-aware layer on the existing one.

2. **Adding the role value is a known-shape but not free migration.** A CHECK cannot be widened in place, so `agents` must be rebuilt using the v8 pattern [S1]. `agents` is the parent of FK-referencing tables (tasks, agent_terminal_log, and bg `linked_agent_id` until `TASK-0198` drops it), so the rebuild must run with `foreign_keys = OFF` inside a transaction, copy columns explicitly, and recreate the indexes (`idx_agents_project_name`, `idx_agents_null_name`, per the agent-identity memory [S16]). Coordinate the version number with ROADMAP-0024's migrations [S10]. *(Inference: an ADD COLUMN alternative — an orthogonal `is_orchestrator` flag — avoids the rebuild entirely; see the comparison.)*

3. **A role must be given an effect that does not depend on a worktree.** Today only worktree agents receive a role fragment [S2, S4]. Options for a non-worktree orchestrator: (a) export `CONDUCTOR_ROLE` (and the agent id) in the spawn env alongside the existing three variables [S6] and have the skill read it; (b) append a generated role file via `--append-system-prompt-file`, which Claude Code documents as appending to the default prompt for the current invocation only [S18] — the repo's default launch command already uses this flag [S7], but `launchCmd` is a user-editable string and other vendors (Codex, Aider) have no equivalent, so it can only be Claude-specific; (c) require a worktree for orchestrators (rejected: pointless isolation, and it mutates a worktree `CLAUDE.md`). The orchestrator's *authority* should come from the server-recognised role; its *behavioural instructions* from a prompt/skill.

4. **Under the no-auth model, "only orchestrators may do X" is not enforceable; what is enforceable is a scoped grant, guardrails and audit.** A call without the caller header is treated as a human [S9], and the trust model is local single-user, no auth (CLAUDE.md, DEC-0003 as cited by [S11]). Any agent with a shell can also `curl` without the header, or run `tmux kill-window` directly [S12: every agent launches with `--dangerously-skip-permissions`]. So a role check cannot *deny* an ordinary agent; it can only (a) recognise orchestrator callers to apply **extra** restrictions to them (self-target, no recursion, fleet cap, confirmation on destructive verbs), and (b) attribute every action in an audit log. This matches the security guidance: OWASP's "complete mediation" — validate downstream requests against policy rather than trust the model to decide safety [S21] — and "least agency", because an agent can stay within its permissions and still act inappropriately [S24]. Frame it in docs as guardrails against *mistakes*, not a security boundary — the same caveat `TASK-0194` writes for its own guard [S9].

5. **Caller identity should be the numeric agent id, not the window name.** The window-name header is ambiguous for some project/agent name pairs and `TASK-0194` correctly denies ambiguous callers [S9]; but an *orchestrator* denied on ambiguity cannot do its job, and it is always freshly spawned with the role, so it can be given `CONDUCTOR_AGENT_ID` at spawn. tmux also exposes a unique pane id: `TMUX_PANE` is put in the pane's process environment once at pane creation and inherited by descendants [S25, S26, S27], and a sibling tool resolves callers from it via `tmux display-message` after checking the caller's `$TMUX` socket [S28]. Use of `TMUX_PANE` is an *option for verification* (server maps pane id → window), not needed for v1. Decision to record: extend `TASK-0193`'s header convention with an id form rather than fork a second header.

6. **Do not let the orchestrator drive workers by typing into their panes.** The prior rounds already fixed this: routers may only enqueue [S11, S15, S12], and `agent-as-tool` vs `subagent` conversational-authority evidence supports it [S15]. So the orchestrator's grant should include `POST /tasks` and exclude `POST /agents/:id/keys` and `/mode` (unless the human confirms). Similarly it should not hold `DELETE /agents/:id` (force-delete of worktree and branch) [S11] without human confirmation — the destructive-action gate the least-privilege sources recommend: "require approval for deletes, external sends, privilege changes, and bulk exports" [S21], and user confirmation of agent actions [S22].

7. **Self-harm and runaway guards specific to a manager that acts on windows.** (a) *Self-target:* closing or deleting its own window kills the orchestrator mid-command; the server can compare caller id to target id and refuse (409 `self-target`). (b) *Recursion:* an orchestrator creating `role=orchestrator` agents multiplies control planes; forbid it (depth cap of 1) server-side in `POST /agents` when the caller is an orchestrator. (c) *Cost/concurrency:* there is no local quota or concurrency cap today (`USAGE_CHECK_CMD='true'`, one shared quota pool) [S12]; an agent that can spawn agents needs a server-side maximum-active-agents guard before it ships. (d) *Loops:* bg restart already plans a cooldown and audit log [S10]; window close/reopen needs the same. (e) *Audit:* one JSONL record per orchestrator action with caller id, verb, target, outcome — reuse `TASK-0193`'s writer and header convention [S9].

8. **An orchestrator cannot currently know a worker finished a task, so v1 should not try.** `popTask` marks a task `done` at dispatch, not on completion; there is no task id in the dispatch log; the idle signal is unreliable with background sub-agents (BUG-0001) [S12]. Lifecycle management (is the window present, is the bg process running/exited, restart it, reopen a dead window) does **not** need completion semantics — it needs the real-liveness work already in ROADMAP-0024 (`TASK-0191`) [S10]. Carving v1 as *lifecycle manager* defers the coupling to Tier-0 hardening that [S12] recommended.

9. **Waking the orchestrator needs no new infrastructure.** A schedule scoped to the orchestrator's agent id that enqueues a "review fleet health and act per your role" prompt every N minutes uses the existing `schedules` table and route [S5]; alternatives (an SSE-subscribed loop or a managed server-side loop) are heavier and unneeded for v1 [S12]. Caveat: a scheduled prompt into an *awaiting* agent stacks behind it — schedules already have `skipIfPending` [S5].

10. **How to hand the orchestrator its tools: server enforcement first, skill client second, MCP later.** Claude Code supports per-session MCP servers (`--mcp-config`, `--strict-mcp-config` "only use MCP servers from `--mcp-config`") [S19], which would give true *tool minimisation* (only orchestrator sessions see fleet tools; consistent with the guidance that tool access be allow-listed per agent, not inherited [S23]) and typed schemas. But it needs a new stdio server process wrapping the API and is Claude-specific, whereas a skill that wraps `curl` matches the shipped `dev-commands` precedent [S8] and works wherever the skill loads (skills are global once installed [S14], so availability is not authorisation — another reason enforcement must be server-side). A per-session `--settings` override [S20] could also restrict a non-skip-permissions orchestrator to allow-listed Bash commands *(inference — not verified in this session; the repo's own allowlist syntax `Bash(git log:*)` is quoted in CLAUDE.md)*, but that departs from the fleet-wide `--dangerously-skip-permissions` default [S12].

11. **UI and sequencing hazards.** The active ROADMAP-0023 (sidebar/detail-pane redesign, 1/10) is rewriting the same `AgentList` components the role badge and any orchestrator affordances would touch [S29]; UI work should follow it. ROADMAP-0024's Phase 2–3 (restart, cooldown, audit, caller resolution) is a hard prerequisite for the bg half of this roadmap [S10]. DEC-0006's role-match router tier (accepted, unbuilt) would treat `role` as a *specialty* for task placement [S11]; an `orchestrator` value must be excluded from role-matched task placement or it will be handed coding tasks (a semantic decision: role as *privilege class* vs *specialty*).

## Constraints
- No auth on the host-server; localhost, single user (CLAUDE.md; DEC-0003 via [S11]). Guards are advisory against mistakes, not a security boundary [S9].
- Every agent launches with `--dangerously-skip-permissions`; an agent in tmux can always call `tmux` directly [S12, S13].
- The role enum is a CHECK constraint; widening it is a table rebuild that must keep FK integrity and indexes [S1].
- Vendor-agnostic design: prompt-injection flags (`--append-system-prompt-file`) are Claude-specific [S18]; the server-side guard and skill client must not assume Claude for the *authority* path.
- Orchestrator instructions to workers must go through the queue, not pane injection [S11, S15].
- ROADMAP-0024 owns bg restart, liveness, cooldown, audit writer and the caller header; this roadmap must depend on it, not duplicate it [S10].
- Frontend edits should wait for ROADMAP-0023's component rewrite [S29].
- All code edits via Serena; host-server is strict TypeScript with `better-sqlite3`; migrations need `db.migration.test.ts` fixtures [S1, S14].

## Solution Comparison

Two open modelling/plumbing choices. **(1) How to represent "orchestrator"**:

| Criteria | A. New `orchestrator` value in the role enum | B. Orthogonal `is_orchestrator` (or `capabilities`) column | C. Convention only (name/prompt), no schema |
|---|---|---|---|
| **Approach** | Widen CHECK via `agents` table rebuild; add `role-presets.json` fragment | `ALTER TABLE agents ADD COLUMN` | Treat any agent as orchestrator if it holds the skill |
| **Pros** | Matches the request ("a new role"); one selector, one column, one injection path; visible in existing UI and `PATCH /agents/:id` | No rebuild, no FK risk; an agent can be both `architect` and orchestrator | Zero code |
| **Cons** | Rebuild of the parent table + index recreation; four-place enum sync; single-valued (cannot also be `backend`); collides with DEC-0006's specialty semantics | Two overlapping concepts; new UI control; diverges from "role" wording | No server-recognised identity → cannot apply orchestrator-only guardrails or audit |
| **Complexity** | Medium | Low-Medium | Low |
| **Dependencies** | None new | None new | None |
| **Codebase fit** | High (v8 rebuild precedent [S1]) | Medium | Low |
| **Maintenance** | Enum sync burden (already true today) | Low | High (undefined behaviour) |

**(2) How the orchestrator gets its tools:**

| Criteria | X. Skill wrapping `curl` (`fleet-control`) | Y. Per-session MCP server | Z. Raw API instructions in prompt |
|---|---|---|---|
| **Approach** | Skill dir + script like `dev-commands` [S8] | `--mcp-config`/`--strict-mcp-config` stdio server [S19] | Fragment tells the agent the routes |
| **Pros** | Precedent; no new process; offline-friendly; already installed by the installer | Typed tools; real tool minimisation; per-agent allow-list [S23] | None to build |
| **Cons** | Globally visible to all agents; relies on server enforcement | New component, Claude-specific, config plumbing | Error-prone curl quoting; no schema |
| **Complexity** | Low-Medium | Medium-High | Low |
| **Codebase fit** | High | Low-Medium | Low |

## Recommendation

**Model the role as enum value (A); deliver tools as a skill (X); enforce and audit in the server; scope v1 to lifecycle management.**

Phases (input to `/roadmap-create`):
1. **Decisions** — role semantics (privilege class vs specialty, and exclusion from DEC-0006 role-matched placement); the orchestrator grant table (which routes, which need human confirmation); identity (agent-id env + header form vs window name); how the role reaches a non-worktree agent (env + skill vs `--append-system-prompt-file`).
2. **Role foundation** — `agents` rebuild migration adding `orchestrator` (coordinated with 0024's schema versions); sync `ROLE_VALUES`, `role-presets.json`, test fixtures; export `CONDUCTOR_ROLE` / `CONDUCTOR_AGENT_ID` at spawn.
3. **Server-side guardrails** — caller resolution reuse from `TASK-0193/0194`; self-target refusal; no orchestrator-creates-orchestrator; max-active-agents cap; confirmation gate on delete; unified orchestrator audit JSONL.
4. **Agent client** — `fleet-control` skill (list, tail, open/close/reopen window, create agent, enqueue task, bg list/tail/open/close/restart), role fragment for the orchestrator, optional schedule preset for periodic fleet review.
5. **Dashboard & verify** — role picker option + orchestrator badge and action log view (after ROADMAP-0023), `verify-` script and a UAT for an orchestrator that restarts a crashed bg process and reopens a dead agent window.

**Risks and mitigations**
- *Enum rebuild breaks FKs or drops indexes* → follow the v8 pattern; fixture test asserting row counts, FK integrity (`PRAGMA foreign_key_check`) and index presence [S1].
- *Guard mistaken for security* → state the caveat in route comments and the wiki page, as `TASK-0194` does [S9].
- *Runaway spawning / restart loops* → fleet cap, cooldown, audit, and a kill-switch (dashboard can strip the role via `PATCH /agents/:id`, which already accepts `role` [S5]).
- *Orchestrator handed coding tasks by a future role router* → exclude the value in DEC-0006's tier when it is built [S11].
- *Migration number collisions with ROADMAP-0024* → claim versions in one place; sequence after 0024's schema tasks or use B if timing conflicts.

**Alternative if constraints change:** if agents ever run outside the host or the trust model changes to require auth, replace header identity with a signed per-agent token (as [S14] already notes) and the guardrails become a real boundary; if the rebuild collides with 0024's migrations, option B ships sooner and can be folded into the enum later.

## Next Steps
- `/roadmap-create` (this run) sequences the phases above; then `/roadmap-next` files tasks.
- Decisions to settle during planning: role semantics vs DEC-0006; orchestrator grant table and which verbs need human confirmation; agent-id identity vs window-name header; role→prompt mechanism for non-worktree agents; fleet-size cap value.
- Still unverified: where the frontend role picker lives; whether `TMUX_PANE`-based verification is worth adding over the header; allow-rule restriction of a non-skip-permissions orchestrator.
