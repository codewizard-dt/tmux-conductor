---
topic: A new type of agent that acts as an orchestrator of other agents, routing commands and tasks as needed
slug: orchestrator-agent-routing
researched: 2026-09-13
sources: [./sources.md]
---

# Research: An Orchestrator Agent That Routes Commands/Tasks to Other Agents

> tmux-conductor already has a mechanical "conductor" (idle detection + FIFO task-queue dequeue) but no agent that *decides* which of the fleet's agents should get a given task based on its content or an agent's capabilities. The industry pattern for exactly this role is the orchestrator-worker / supervisor pattern, proven at Anthropic's own production scale — but the same sources are equally emphatic that a deterministic dispatcher is the right default and an LLM router is the escalation, not the starting point. Recommendation: extend the existing rule-based `pop_task_sql`/`popTask` precedence with a declared-capability/tag match first (cheap, deterministic, fits this project's no-auth/single-user risk profile); add an LLM routing step — running as a host-server background job that calls the existing `POST /queue/:agent` API, not a new tmux pane — only for tasks that fall through the tag match.

## Research Questions
- What routing/orchestration mechanisms does tmux-conductor already have, and where do they stop short of content-aware routing?
- What are the established architectural patterns for "an agent that routes tasks to other agents," and which one(s) fit a fleet of independently-running, vendor-agnostic tmux-hosted CLI processes (not in-process, tool-calling subagents)?
- What do production deployments and recent failure-taxonomy research say about when this pattern helps vs. when it adds pure overhead?
- Where would a routing decision-maker actually run inside tmux-conductor's existing architecture (host-server job vs. new tmux pane), and what does it need that doesn't exist yet?
- What's the smallest safe first step, given this project's explicit no-auth/local-only/no-daemon posture?

## Current State (Codebase)
tmux-conductor's task queue is SQL-backed and already supports per-agent scoping, but "routing" today is entirely a human/script decision made at *insert* time, never a decision an agent makes at *dispatch* time:

- `host-server/db.ts::popTask` (line 840) and its bash mirror `scripts/lib/db.sh::pop_task_sql` (line 87) select the next queued row for an agent by a fixed SQL precedence — scoped rows for that agent first, then global rows — and soft-flip the row to `status='done'` on pop. There is no content inspection, no capability matching, nothing beyond "which rows are already tagged for me." [S1, S2]
- `host-server/index.ts::dispatchTaskToAgent` (lines 493-540) is pure mechanics once a task is popped: pre-dispatch git checkpoint, `busy` state-file write, a `dispatch.jsonl` log line, an optional `/clear`, then `send-keys`. No reasoning happens here either — by the time this function runs, the "which agent" question is already answered. [S3]
- `scripts/add-task.sh` scopes a new task to the caller's CWD-derived agent name; the dashboard's `AddTaskForm.tsx` similarly requires the human to pick a target agent (or leave it global) when creating a task. Assignment is manual, not agent-decided.
- Agents already carry a `type` (`claude`/`codex`/`custom`, via `detectAgentType`), but this field only selects an idle/busy detection regex — it is never consulted for task assignment.
- The closest thing to "an orchestrator agent" in this user's environment is `power-mode`, a separate user-global Claude Code skill that drives a roadmap/task file through a pipeline by spawning Claude Code's own in-process `Agent()` subagents/teammates. It has **no visibility into tmux-conductor's SQLite queue or `GET /agents`/`GET /status` API** — it orchestrates a different, in-process fleet, not the cross-process tmux panes tmux-conductor manages. [S4]
- Claude Code's own "Agent Teams" feature (opt-in, enabled globally for this user) is bounded to a single interactive session — one team, no nesting, no headless mode — a different layer again from tmux-conductor's vendor-agnostic, cross-process pane model. [S5]
- No task, roadmap, or bug in the wiki addresses capability-aware or content-aware task routing; this is genuinely new scope for the project, not a documented gap being revisited. [S6]

## Key Findings

1. **The exact role described — an agent that routes tasks to other agents — is Anthropic's own production "orchestrator-worker" pattern**, used in Claude's Research feature: a lead agent analyzes an incoming request, decomposes it, and delegates to specialized subagents with explicit objectives/boundaries/output formats. Anthropic found that *vague* delegation directly causes the failure mode most relevant here — duplicated or gapped work — and fixed it not with smarter workers but with more explicit orchestrator-side task descriptions. [S8]

2. **Anthropic's own newer guidance is a caution, not an endorsement to build one immediately**: "we've seen teams invest months building elaborate multi-agent architectures only to discover that improved prompting on a single agent achieved equivalent results." Orchestrator-subagent is framed as the *default starting hierarchical pattern* once multi-agent is actually justified — not a general upgrade path from a single conductor. [S9]

3. **LangGraph's supervisor pattern is the most mature reference implementation of "an agent that routes tasks to other agents" outside Anthropic itself.** A supervisor node inspects shared state and calls specialist agents via handoff tools, deciding "which agent to invoke based on the current context and task requirements" — structurally the same decision tmux-conductor's `popTask` makes today by SQL precedence alone. [S10]

4. **Azure's Well-Architected guidance directly favors tmux-conductor's current default**: "The appropriate agent... is identifiable from the initial input. In that case, use deterministic routing or a simpler dispatcher that doesn't take an active role in processing." An LLM router is the answer only once the correct agent for a task is *not* mechanically derivable from the task alone. [S15]

5. **Known failure modes are well-characterized and map cleanly onto tmux-conductor's specific risk surface.** NeurIPS 2025's MAST taxonomy (1,600+ traces across AutoGen/CrewAI/LangGraph) attributes ~40% of multi-agent pilot failures to three root causes: specification ambiguity, coordination breakdowns (message loss, circular handoffs — i.e. routing loops), and verification gaps (no independent check before calling a handoff "done"). Coordination failures alone account for ~37% of failures across those three frameworks. [S13, S14] Production supervisor deployments report the concrete version of this: a routing loop that hits `recursion_limit` because "the supervisor keeps asking the wrong specialist who keeps deferring back" — fixed in the router's prompt, not the limit. [S12]

6. **Cost is a real, quantified gate, not a vague concern**: multi-agent orchestration runs roughly 15x the token cost of a plain chat turn; Anthropic's Research system alone runs ~4x a single chat turn per subagent. Any LLM-driven routing step should be invoked only for tasks a deterministic rule can't place, not per-task. [S9, S14]

7. **A production capability-routing design needs a declared capability taxonomy per agent plus first-class telemetry on the routing decision itself** — AWS's Agentic AI Lens calls for "a structured capability taxonomy that drives deterministic routing and automatic substitution" and treats "routing outcomes, fallback activations" as first-class observable events, not side effects. [S16] tmux-conductor already has the matching observability precedent to copy: `transitions.jsonl` records every status-transition decision with its reason so misdetection is diagnosable after the fact — a `routing.jsonl` in the same shape (candidate agents considered, chosen agent, reason, deterministic-vs-LLM path) is the natural analog for routing decisions.

8. **The Claude Agent SDK's own subagent shape confirms what a capability taxonomy should look like at the data-model level**: each subagent declares a `description` used purely so an orchestrating model can decide *when* to invoke it, alongside a scoped `tools` list and optional `model`. tmux-conductor's `agents` table has no equivalent free-text `description`/`skills` field to route against today — the closest existing signal is the already-implemented `GET /agents/:agent/skills` endpoint (project + user skills for that agent's workdir), which a router could read without any schema change. [S7]

## Constraints

- **Agents are separate OS processes in separate tmux panes, not in-process tool-callable subagents.** Unlike LangGraph's handoff tools or the Claude Agent SDK's `Agent` tool, tmux-conductor has exactly one channel out to an agent (`send-keys`) and one channel in (`capture-pane` / hook state files). Any routing decision has to land through the same `dispatchTaskToAgent`/SQLite path everything else uses — it cannot be a native function call.
- **No auth layer anywhere in this system** (deliberate, per `CLAUDE.md`: fully local, single-user). An orchestrator that can push commands into a live coding agent's pane is a larger blast radius than one that only reorders a queue — routing decisions should be scoped to enqueueing (`POST /queue/:agent`), never to direct `/agents/:agent/keys` interaction.
- **`monitor.sh`'s poll loop is bash, subprocess-heavy, and already latency-sensitive** (per existing local-observability research) — an LLM call per tick does not belong there. A routing decision-maker belongs either as an async host-server job (mirroring the existing `dueSchedules`/`fireSchedule` pattern) or as its own periodically-triggered process, never inline in the poll loop.
- **No capability/skill metadata exists on the `agents` or `tasks` tables today** beyond the type-detection regex and the unrelated `GET /agents/:agent/skills` endpoint — a tag-matching router needs at minimum a `tags`/`skills` column on both tables.
- **The soft-flip task history (`popTask` → `status='done'`) is a good audit foundation but records no rationale** — nothing today explains *why* a task ended up scoped to a given agent, which is exactly the "specification ambiguity" root cause MAST flags as failure category #1. A routing decision needs its own log line, not just a state change.
- **Fleet size today is small** (per the active tasks/roadmaps index, a handful of tasks against a handful of agents) — well under the "escalate to hierarchical when worker count exceeds 5-8" threshold the research converges on. [S13]

## Solution Comparison

| Criteria | A. Deterministic tag/capability router | B. LLM router as host-server background job | C. Dedicated orchestrator agent pane |
|---|---|---|---|
| **Approach** | Add `tags` to `agents`/`tasks`; extend `pop_task_sql`/`popTask` precedence to prefer a tag match before falling back to global | Async Node job (like `dueSchedules`) calls Claude with `GET /agents` roster + task text when no tag match exists; result is an ordinary `POST /queue/:agent` call | New tmux-hosted Claude Code instance (its own pane/skill, à la `power-mode`) that watches the API and assigns tasks with full reasoning/extended thinking |
| **Pros** | Deterministic, debuggable, near-zero cost, fits Azure/AWS guidance for "agent identifiable from input" | Handles genuinely ambiguous tasks; reuses all existing dispatch/checkpoint/logging machinery; gated so cost stays bounded | Highest-fidelity to Anthropic's own orchestrator-worker pattern; can renegotiate, ask clarifying questions, hold multi-step state |
| **Cons** | Can't handle genuinely ambiguous/novel task text | Adds an LLM call + new decision surface; needs its own routing-decision log to stay diagnosable | Full extra Claude Code process; new idle/busy state to detect; ~4-15x token cost; duplicates `power-mode`'s role; highest coordination-failure exposure (MAST) |
| **Complexity** | Low | Medium | High |
| **Dependencies** | None new (SQL columns only) | Existing Claude API/Agent SDK access from host-server | Another live tmux-conductor agent slot + its own skill/prompt |
| **Codebase fit** | Extends `popTask`/`pop_task_sql` in place; no new architecture | Mirrors `dueSchedules`/`fireSchedule`'s existing async-job shape | Mirrors `power-mode`, but for a fleet `power-mode` currently can't see |
| **Maintenance** | Trivial | Needs a routing-decision log + fallback-to-unassigned path | Needs its own status detection, failure handling, and cost monitoring |

## Recommendation

**Ship A now; add B only where A demonstrably falls short; defer C.**

Implementation outline:
1. Add nullable `tags` (free-text or small JSON array) columns to both `agents` and `tasks`.
2. Extend `popTask`/`pop_task_sql` precedence to: scoped-to-this-agent rows → tag-match rows (task tag ⊆ agent tags) → global rows — a pure SQL change, no new process.
3. Emit a `routing.jsonl` record (mirroring `transitions.jsonl`'s shape) whenever a task is popped, recording which precedence tier matched and why — closes the "no rationale recorded" gap before any LLM step is added.
4. Only after A ships and proves insufficient (tasks regularly landing in the untagged/global bucket with no clear agent), add B: a host-server job triggered on task-insert-with-no-tag-match, calling Claude with the agent roster (name, declared tags, current status/active task, and optionally its `GET /agents/:agent/skills` output) plus the task text, writing its choice back via the existing `POST /queue/:agent` endpoint — never a direct pane write.
5. Do not build C unless the fleet grows past ~5-8 concurrently active agents with materially different specializations, or task volume moves from "occasional human-scoped" to "high-volume, unscoped, multi-source" — at that point, extend `power-mode`'s existing pipeline-driving pattern to also see tmux-conductor's queue, rather than inventing a second, competing orchestrator concept.

Risks and mitigations:
- **Routing loops** (MAST's top coordination failure) — cap re-routes per task with a counter column; a task that fails its tag match twice falls back to global/unassigned rather than bouncing.
- **Blast radius** — any router (A or B) is restricted to enqueueing via `POST /queue/:agent`; it must never call the keystroke-injection endpoint directly.
- **Cost creep** (option B) — gate the LLM call strictly behind "no deterministic match," never run it per-task unconditionally.
- **Silent misrouting** — the `routing.jsonl` log (step 3) is not optional; it's the same lesson tmux-conductor already learned the hard way with status-transition observability (`[[Observability for Agent Status Transitions]]`).

Alternative if constraints change: if agents start arriving with genuinely dynamic, unpredictable capabilities (e.g., hot-swappable skill sets rather than a fixed per-project role), a description-based match closer to the Claude Agent SDK's subagent model (S7) — free-text description compared semantically rather than exact tag match — becomes worth the added complexity over plain tag equality.

## Next Steps
- `/task-add Add tags column to agents/tasks tables and extend pop_task_sql/popTask precedence with a tag-match tier before the global fallback` — the safe, valuable first slice (Option A) regardless of whether B/C ever get built.
- If there's appetite to go further than A: `/decision-create` a formal Decision Group comparing A/B/C before committing engineering time — this is a new architectural surface for the project, not a bug fix, and the research above surfaces real trade-offs worth recording rather than deciding informally.
- Once A ships, revisit this research to decide whether observed unassigned/global-bucket task volume justifies Option B.
