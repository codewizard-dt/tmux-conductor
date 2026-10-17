---
topic: Infrastructure requirements for multi-agent architecture. This is relevant for the orchestrator, the proposed orchestrator agent.
slug: multi-agent-infrastructure-requirements
researched: 2026-09-19
sources: [./sources.md]
---

# Research: Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)

> Builds on [orchestrator-agent-routing/index.md](../orchestrator-agent-routing/index.md), [index-2.md](../orchestrator-agent-routing/index-2.md) and [index-3.md](../orchestrator-agent-routing/index-3.md), which asked *which shape* the orchestrator should take and *what agents exist to route among*. This report asks the question those three never did: **what has to exist underneath, regardless of shape?** Headline: tmux-conductor's queue is safe under concurrency (atomic claim, WAL, matching busy timeouts on both sides) but has **no notion of a task finishing** — `popTask` marks a task `done` when it is *dispatched* [S1], the dispatch log carries no task id [S4], and there is no lease, attempt count, result, dependency, or verification step [S8]. Every orchestrator shape — even the purely deterministic role router already accepted in DEC-0006 [S12] — needs a small Tier-0 hardening layer first: task↔dispatch↔outcome correlation, one authoritative dispatcher (today there are two, and only one honours the BUG-0001 sentinel [S5, S9, S10]), and dispatch-path parity. An LLM-driven orchestrator additionally needs a runtime the host-server does not have (no Anthropic/Agent SDK dependency [S11]), a concurrency and cost guard where none exists today (`USAGE_CHECK_CMD='true'` [S16]; one shared quota pool [S36]), and a blast-radius decision, because every agent is launched with `--dangerously-skip-permissions` [S8]. Recommendation: build Tier 0 now, ship DEC-0006's role tier on top of it, and defer the LLM step, ephemeral fallback and orchestrator-pane shapes until measurements taken in a Phase 0 assumptions audit justify them.

## Research Questions
1. What infrastructure does tmux-conductor already provide that an orchestrator can rely on, and what are the concrete gaps?
2. What do production multi-agent systems and coding-agent fleets require beneath the orchestration logic (state, delivery semantics, isolation, observability, cost, safety)?
3. What runtime does an orchestrator that calls an LLM need, given that host-server has no Claude dependency today?
4. What are the concurrency, quota, and blast-radius limits that bound how many agents an orchestrator can safely drive?
5. Which assumptions in the three prior rounds and in DEC-0006 are now falsified or unverified?

## Current State (Codebase)

**What is solid**
- **Atomic task claim.** `popTask` is a single `UPDATE tasks … WHERE id = (SELECT … LIMIT 1) RETURNING …`; a popped row can never be re-selected because the subquery filters `status='queued'` [S1]. This is the same shape the SQLite-queue literature uses for atomic claim [S30].
- **Consistent SQLite concurrency settings on both implementations.** Node opens with WAL, `foreign_keys=ON`, `busy_timeout=5000` [S2]; the bash wrapper uses `.timeout 5000` [S3]. (Caveat from the driver docs: in this build only the busy callback handles `SQLITE_BUSY` in WAL mode [S28], so 5 s is a hard ceiling on writer contention, not a wait-forever lock.)
- **A background-job pattern to hang an orchestrator on.** `startManagedLoop` gives timer loops with slow-tick backoff and observability logging; the `schedule poll` loop already enqueues tasks and broadcasts `task-added` over SSE [S6].
- **Capability primitive exists.** `agents.role` is a schema-v7 CHECK-constrained enum of seven values [S8, S15]; `TASK-0199` adds `description` [S13]. (Round 3's recommendation to add a `role` column [S20] was already satisfied — see Contradictions.)
- **Isolation primitives exist for the persistent-agent case.** `createWorktree`, `removeWorktree`, `deleteBranch`, `stashCheckpoint`, `applyStash` [S7], wired into `dispatchTaskToAgent`'s pre-dispatch checkpoint [S4].

**What is missing (all verified in code unless marked)**
- **No task completion semantics.** `popTask` sets `status='done'`, `completed_at=now` at dispatch [S1]. "Done" therefore means "sent to a pane", not "finished". `tasks` has no attempt, lease, result, failure, role, or dependency column [S8].
- **No task id in the dispatch path.** `dispatchTaskToAgent(db, conf, agent, cmdText, detection, opts)` receives text only, and the `dispatch.jsonl` record has no task id, tier, or routing reason [S4]. The task→dispatch→transition→outcome chain cannot be reconstructed after the fact, which DEC-0006 already names as a requirement (driver 4, "every routing decision must be recorded") [S12].
- **Two dispatchers, one gate.** The host-server's `pollAndDiff` pops on idle transitions behind the usage-limited file and the BUG-0001 pending-agents sentinel [S5]; the host-server also re-creates the `monitor` window that runs `scripts/monitor.sh` [S9], which pops via `pop_task_sql` [S10]. A pattern search found no reference to the pending-agents sentinel anywhere under `scripts/` [S10]. *(Inference — needs a runtime test: the bash path may dispatch into an agent the host-server path would have held back.)* The atomic claim prevents a double pop, but not divergent gating.
- **No merge function** in `git.ts` [S7, S15]; **no teardown trigger**; teardown is `--force`/`-D` [S12].
- **No Claude runtime in host-server.** Runtime dependencies are Fastify + better-sqlite3 + dotenv [S11]. Round 1's comparison row for an LLM router listed its dependency as "Existing Claude API/Agent SDK access from host-server" [S18] — that access does not exist.
- **No quota or concurrency control.** `USAGE_CHECK_CMD='true'`; "There is currently NO automated usage checking" [S16], and no scriptable quota signal exists [S17]. The only gate is the manually-created `usage-limited` file [S5].
- **Permissive launch posture.** Default launch command is `claude --dangerously-skip-permissions --append-system-prompt-file …` [S8]; there is no auth on the host-server (CLAUDE.md, DEC-0003 as cited in [S12]).
- **Unresolved blockers for the fallback path.** BUG-0001 still `in-progress`; TASK-0184 (background-job detection) is done but TASK-133 (sentinel-gate dispatch) is `todo`; BUG-0012 (fake-dispatch never fires) is `open` [S14].

## Key Findings

1. **Reliability of a multi-agent system comes from infrastructure discipline, not the routing brain.** Anthropic's production write-up names the same list this repo lacks: agents are stateful and errors compound, so they need durable execution, retries and checkpoints, and full production tracing to diagnose non-deterministic failures [S24]; the coordination cost shows up as "result coordination, state consistency, and error propagation" [S24]. MAST-style failure evidence already gathered in round 1 points the same way [S18].

2. **The missing primitive is *task lifecycle*, and the reference designs all have it.** SQLite job queues that survive crashes use claim → lease/visibility timeout → ack, with attempt counting and a dead-letter state after N deliveries, and accept at-least-once delivery [S30]. Claude Code's own Agent Teams task list has file-locked claiming, `pending → in_progress → completed`, and dependencies that block claiming [S29]. tmux-conductor has only "queued → done-at-dispatch" [S1, S8]. The lease pitfall is documented too: a visibility timeout that is too short re-enqueues live work and burns attempts [S31] — relevant because agent tasks run for minutes to hours, so a lease must be renewed by a liveness signal rather than fixed short.

3. **Task completion is not derivable from the existing idle signal.** The signal available is a per-agent turn-end (`Stop` hook → `idle`) [S21]; BUG-0001 shows that signal is already unreliable when background sub-agents are in flight [S14, S12], and a multi-turn task ending in an `awaiting` dialog is not complete either. A sibling repo makes the identical design choice — excluding `SubagentStop` because "subagents finishing doesn't mean the main agent is done" [S22]. An orchestrator that "verifies" work needs an explicit completion contract (task id carried into the dispatch, a completion marker, and an independent check), which is precisely MAST's "verification gap" from round 1 [S18].

4. **Worktree isolation is necessary infrastructure for parallel coding agents, and it is not sufficient.** It defers conflicts to merge time rather than removing them [S32]; ports, databases, Docker volumes and caches remain shared unless explicitly split per worktree [S33]; abandoned worktrees eat disk [S34]; coordination overhead grows non-linearly with agent count and merges should be serialized one branch at a time [S35]. Fleet-scale tooling adds a FIFO merge queue and a watchdog [S32]. Every one of those is absent here beyond create/remove [S7]. DEC-0006's fallback path depends on all of them [S12, S15].

5. **An LLM-calling orchestrator needs a runtime, and there are three realistic ways to get one.** (a) Spawn `claude -p --output-format json` as a subprocess — returns `session_id` and cost metadata, can `--resume`, supports `--max-turns` and `--bare` [S25, S26]; matches how host-server already shells out to `tmux`/`git` [S6, S9] and adds no dependency. (b) Add `@anthropic-ai/claude-agent-sdk` — typed `maxTurns`, `maxBudgetUsd`, subagent depth/concurrency env caps, `resume` [S27]; adds a dependency and an auth/billing question. (c) Host the orchestrator as a tmux agent like any other — reuses dispatch and idle detection but inherits their unreliability and full pane authority. Programmatic-use billing relative to subscription is unsettled: an announced separation of Agent SDK credit was "paused on the effective date" [S38] *(second-hand; verify before choosing (a) or (b))*.

6. **Concurrency is bounded by a quota pool the system cannot see.** Subscription limits are a 5-hour rolling window plus a weekly cap, shared across Claude Code, chat and Cowork [S36]. Practitioners of parallel headless fleets report the failure modes directly: rate limits burn in minutes, missing cost caps let a retry loop spend heavily, and the fix is a concurrency semaphore plus per-invocation and per-day budgets [S39]. Round 3's still-open gap — no coding-specific token multiplier — is now partly filled by one second-hand figure: Agent Teams ≈7x tokens in plan mode [S37], versus the 4x/15x chat/research figures earlier rounds imported [S18, S24]. tmux-conductor does record per-agent token usage locally (`getAllAgentUsageTotals`, `usage.ts` — symbol list in `host-server/db.ts`), which is a viable input to a *local* budget guard even though no server-side quota signal exists [S17].

7. **Observability must connect the chain, not add a vendor.** The repo's `transitions.jsonl` precedent (status-transition reasons) is the right style [S12]; the gap is a shared correlation id across enqueue → route → dispatch → transition → outcome (Finding 3, [S4]). OpenTelemetry's GenAI agent spans (`invoke_agent`, `execute_tool`) are a converging vocabulary but every relevant document is still "Development" status [S40] — borrow the naming, do not depend on the SDK. Loop guards (hard step/re-route caps, handoff-circle detection) are the standard instrument-before-scaling item [S42].

8. **Blast radius grows with orchestration, and the local posture is at the edge of what vendor guidance supports.** Every agent skips permission prompts by default [S8, S22]; Anthropic's guidance is that sandboxing needs both filesystem and network isolation and "is not a complete isolation boundary" [S41]. An orchestrator does not change that per-agent risk, but it does add an automated *writer of instructions into those agents' queues*. Round 1's constraint stands and is strengthened: any router may only enqueue, never inject keystrokes [S18, S20].

9. **Policy hooks in this ecosystem fail open, and shared hook state is racy — both bear on any orchestrator guard.** The sibling enforcement kit's own SECURITY.md concedes a fail-open bug "silently disables enforcement", and its README says blockers fail closed while its parse-error path allows [S23]; its state is keyed by a hash of cwd with a non-atomic read-modify-write [S23], the same shared-workdir hazard already recorded for this repo. The sibling status plugin writes state files without locking and uses a check-then-write PID guard [S22]. Lesson: any orchestrator safety control must be enforced server-side (in the enqueue API), not as an advisory hook, and per-agent state must be keyed by agent identity, never cwd.

10. **The sibling repos add no orchestration prior art** — closing round 2/3's open gap: `tmux-agent-status` is a monitor with no queue or messaging (deployment = one window + one worktree per manifest entry) [S22]; the enforcement kit is single-agent policy enforcement [S23]. Neither contains routing logic.

## Constraints
- No Anthropic dependency and no auth in host-server; adding either is a real architectural change [S11, S12].
- The queue claim must remain implemented identically in TypeScript and bash until one path is retired; DEC-0006's role tier must land in both, in the same order, with a parity check [S15].
- Merge/teardown must require human confirmation while BUG-0001 is open [S12, S15].
- Routers may only enqueue via the existing API path [S18, S20].
- The quota signal is not scriptable; any cost control has to be built from local usage data and static caps [S16, S17].
- Fleet churn is high and includes disposable test agents (round 2 [S19]), so fleet-size thresholds from generic literature should not be reused (round 2 [S19]).

## Solution Comparison

Infrastructure is layered; the comparison below is for the one open *build-vs-buy* choice — the runtime for any orchestrator step that calls an LLM.

| Criteria | W. Orchestrator as a tmux agent | X. Deterministic only (no LLM) | Y. `claude -p` subprocess from host-server | Z. Claude Agent SDK in host-server |
|---|---|---|---|---|
| **Approach** | A long-lived agent row whose prompt tells it to triage the queue | Role tier + rules in SQL; no model call | Managed loop spawns `claude -p --output-format json --max-turns N`, parses JSON, enqueues via API | Import SDK; call `query()` with `maxTurns`/`maxBudgetUsd` |
| **Pros** | Zero new runtime code; reuses dispatch + dashboard | No cost, no new failure domain; matches DEC-0006 A | No new dependency; cost and session id in output; hard turn cap; same pattern as existing `spawnSync` use | Typed budget + turn caps, structured results, permission modes, session resume |
| **Cons** | Nondeterministic; full pane authority; inherits idle-detection unreliability (BUG-0001); costs a full agent slot | Cannot place genuinely ambiguous tasks | Process spawn per decision; must parse CLI output; auth/billing follows the CLI login | New dependency + auth model (API key vs subscription unresolved [S38]); bigger surface |
| **Complexity** | Low code / High risk | Low | Medium | Medium-High |
| **Dependencies** | None | None | `claude` CLI on PATH (already required) | `@anthropic-ai/claude-agent-sdk` |
| **Codebase fit** | Fits the agents model; worst fit for the trust boundary | Best | Good — `startManagedLoop` + subprocess | Fair — first Anthropic dependency in host-server [S11] |
| **Maintenance** | Prompt drift, monitoring an extra agent | Trivial | CLI flag drift | SDK version drift |

## Recommendation

**Tiered build order — infrastructure first, brain last.**

*Tier 0 — prerequisites for every orchestrator shape (deterministic, no LLM):*
1. **Correlation id.** Thread `task.id` through `popTask` → `dispatchTaskToAgent` → `dispatch.jsonl` (+ a `routing.jsonl` with matched tier and candidates, per DEC-0006) so enqueue→dispatch→outcome is reconstructable [S4, S12].
2. **Task lifecycle.** Separate "dispatched" from "completed": add explicit states/timestamps (dispatched_at, completed_at, attempts, failure reason) and a reroute counter that caps loops [S1, S8, S30, S42]. Decide the completion signal deliberately (Finding 3) rather than reusing `idle`.
3. **One authoritative dispatcher, or gate parity.** Resolve `monitor.sh` vs `pollAndDiff` [S9, S10]; at minimum make the BUG-0001 sentinel/usage gates common to both, and add a parity test for `popTask`/`pop_task_sql` [S15].
4. **Role tier (DEC-0006 A) on top of 1–3**, in both implementations [S12].

*Tier 1 — only if Phase 0 measurements show the deterministic tier leaves material work unplaced:*
5. **Local budget + concurrency guard** (max active agents, a per-window token budget from local usage data, honour `usage-limited`) before any automated step can create load [S16, S17, S36, S39].
6. **LLM triage step via option Y** (`claude -p`, `--max-turns`, JSON output, enqueue-only, gated behind "no deterministic match", logged to `routing.jsonl`), revisiting Z only if the SDK's billing/auth position is clarified [S25-S27, S38].

*Tier 2 — only after Tier 0–1 prove out and BUG-0001 is closed:*
7. **Merge queue + human-confirmed teardown + orphan reaper + per-worktree env/port isolation** for DEC-0006's ephemeral fallback [S7, S12, S32-S35].
8. **Orchestrator-as-agent (W), inter-agent messaging, task dependencies, OTel-style spans** — defer; none has a demonstrated need here [S29, S40].

**Risks and mitigations**
- *Building lifecycle on an unreliable completion signal* → treat completion as a state change requiring a second signal (task-id acknowledgement or explicit human/UAT confirmation), not idle alone [S14, S22].
- *Dual-dispatcher drift* → parity test + a single shared gate module or retire one path [S10, S15].
- *Quota exhaustion from automated load* → static concurrency cap and local budget before any autonomous step [S39, S36].
- *Lease too short* → renew leases from liveness (state-file mtime), do not use a fixed short timeout [S31].
- *Advisory guards that fail open* → enforce in the enqueue API [S23].

**Alternative if constraints change:** if Anthropic clarifies subscription treatment of Agent SDK usage, or the team moves to API-key billing, option Z becomes preferable to Y for its typed budget controls [S27, S38]. If agents ever run across machines, the file-based state and single SQLite file stop being sufficient and a real broker/lease service and auth become Tier-0 [S30].

## Contradictions and Superseded Statements (for the wiki's `> **Contradiction:**` callouts)
- **Round 3 [S20] vs codebase/DEC-0006/TASK-0199 [S8, S12, S13]:** round 3 recommended adding `role` (and `description`) columns to `agents`; `role` already exists (schema v7). Only `description` remains (TASK-0199). Round 3 was written the day after DEC-0006 but did not cite it.
- **Round 1 [S18] vs `host-server/package.json` [S11]:** round 1 treated an LLM router's dependency as "existing Claude API/Agent SDK access from host-server"; no such access exists.
- **DEC-0006 [S12] "revisit when TASK-133 unblocks" vs task state [S14]:** TASK-0184 later shipped a different mitigation (job-state correlation for status display); TASK-133 is still `todo` and BUG-0001 is still open, so the gate condition is unchanged even though the detection picture improved.
- **CLAUDE.md wording is easy to over-read (not a contradiction):** CLAUDE.md says `hasPendingBackgroundAgents()` "gates both dispatch call sites". Both call sites are in `host-server/index.ts` (lines 970 and 2700 [S5, S43]); neither is `monitor.sh`. The bash dispatcher [S10] is a third dispatch site the sentinel never reaches *(inference from an absence-of-match search — verify at runtime, see A4)*.

## Assumptions Register (input to the roadmap's Phase 0)
| # | Assumption (where it lives) | Status | How to verify |
|---|---|---|---|
| A1 | "Fleet is small (~5-8)" (round 1 [S18]) | Contradicted by round 2 [S19] on 30-record tails; churn includes disposable fixtures | Count distinct *long-lived* agents over 14 days from `dispatch.jsonl` |
| A2 | Host-server has Claude API/SDK access (round 1 [S18]) | **Falsified** [S11] | Already checked |
| A3 | `done` on a task means it completed (implicit, whole queue UI) | **Falsified** — set at dispatch [S1] | Already checked; audit UI copy/labels for the same assumption |
| A4 | There is one dispatch path (implicit in DEC-0006 [S12]) | **Falsified in part** — two exist [S9, S10] | Runtime test: hold an agent in a false-idle state and observe whether `monitor.sh` dispatches |
| A5 | `Stop`→`idle` marks the end of a task (hook design [S21]) | Unreliable [S14, S22] | Correlate `hooks.jsonl` Stop events with actual task outcomes over a sample |
| A6 | 7 role values are enough to place tasks (DEC-0006 [S12]) | Unverified | Sample recent tasks; estimate the fraction placeable by role |
| A7 | 4x/15x token multipliers apply (round 1 [S18, S24]) | Chat/research figures; one coding figure ≈7x (second-hand [S37]) | Measure local usage totals for orchestrated vs single-agent runs |
| A8 | Programmatic (`claude -p`/SDK) usage bills like interactive usage | Unverified, reportedly in flux [S38] | Check current Anthropic billing docs; run a metered probe |
| A9 | Worktree isolation removes cross-agent conflicts (round 2 [S19]) | Partly false — defers conflicts, shares ports/DBs [S32, S33] | Inventory shared external resources in target projects |
| A10 | "No auth, local single-user" is an adequate trust boundary for an automated router (CLAUDE.md, DEC-0003 [S12]) | Unverified once a process can enqueue into agents launched with permissions skipped [S8, S41] | Threat-model the enqueue API; decide server-side controls |
| A11 | Agents in one workdir can be told apart by cwd (hooks) | False by the repo's own prior finding and the kit's design [S23] | Confirm all hooks key by agent identity, not cwd |
| A12 | A quota-blind system is acceptable at today's concurrency (DEC-0001 [S16]) | Becomes false as automated load rises [S36, S39] | Track usage-limited incidents vs concurrent agent count |

## Next Steps
- **Requested by the user:** run `/roadmap-create` from this report with **Phase 0 = assessment of the assumptions in the source texts** (the register above is the seed).
- `/task-add` candidates once the roadmap exists: thread task id through dispatch + `routing.jsonl`; task lifecycle columns + completion contract; dispatcher parity or retirement of `monitor.sh` dispatch; local concurrency/budget guard.
- `/decision-create` for the LLM-step runtime (Y vs Z vs W) — deliberately *after* Phase 0's billing and measurement results.
- Still open: no coding-specific, first-party token-cost figure (A7); billing treatment of programmatic usage (A8).
