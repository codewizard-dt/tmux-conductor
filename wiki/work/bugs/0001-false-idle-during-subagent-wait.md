---
id: BUG-0001
aliases: [BUG-0001]
title: "Main agent falsely marked idle while waiting on a background sub-agent (Task tool), causing premature task dequeue"
status: in-progress
severity: critical
priority: P1
created: 2026-08-15
updated: 2026-09-19
reporter: David Taylor
assignee: "—"
tags: host-server, dispatch, hooks, subagents
impact: "Affects any agent running a skill that spawns background Task-tool sub-agents (observed with /power-mode) while it has additional queued tasks behind the current one. Risk: task-queue ordering guarantee (one task at a time per agent) is violated — a queued task can dispatch into an agent that is still mid-turn, waiting on its own sub-agent work. Confirmed 2026-09-03: the current sentinel fix does not protect the primary case (a background sub-agent running without ever needing input) — see the Update in Resolution. Confirmed 2026-09-04: the proposed pane-text (footer-hint) fallback is disqualified — it's global/account-scoped, not per-agent — and an undocumented ~/.claude/jobs/*/state.json internal was found as a riskier alternative candidate. Awaiting a user decision on how to proceed."
workaround: "Avoid queuing follow-on tasks during sub-agent-heavy skills — manually hold off queuing the next /power-mode (or similar) task until the current one, including its sub-agents, has actually finished. Process workaround only, not a fix."
linked_task: "[[TASK-120]], [[TASK-121]], [[TASK-0184]]"
---

# BUG-0001 — Main agent falsely marked idle while waiting on a background sub-agent (Task tool), causing premature task dequeue

## Environment

- OS: macOS (Darwin 25.3.0)
- App: tmux-conductor @ `e8b9c65` (main branch, working tree had uncommitted changes at time of report)
- Runtime: host-server (Fastify) + `monitor.sh`
- Config: default `conductor.conf`, no overrides mentioned

## Steps to Reproduce

1. Start an agent running a skill that spawns background sub-agents via the Task/Agent tool (observed with `/power-mode`) while the agent also has additional tasks queued behind the current one.
2. Let the sub-agent run in the background while the main agent's turn is still open (main agent shows "Cogitating…" / thinking, not yet returned to a prompt).
3. Observe the dashboard/monitor treat the agent as idle during this wait.
4. Observe the next queued task (e.g. next `/power-mode` roadmap item) gets dispatched before the current one's work (including its sub-agent) has actually finished.

## Expected Behavior

The agent should remain marked busy for the duration of the entire turn, including any time spent waiting on background sub-agents (e.g. Task-tool agents dispatched via `/power-mode` or the Workflow tool) it spawned as part of that turn. No queued task should be dispatched to that agent until its current turn — and all sub-agent work it is waiting on — has genuinely completed.

## Actual Behavior

While `cryptwiz-1` was mid-turn — actively "Cogitating…" and waiting on a background `Agent(UAT auto TASK-109)` sub-agent it had spawned via `/power-mode`, with 3 more `/power-mode` roadmap tasks still queued behind the current one — the agent's status was (at least transiently) read as idle, and the next queued task was dequeued/dispatched prematurely, before the current task's sub-agent work had finished.

Screenshot captured mid-incident: `tmp/dashboard-drops/1786838260573-Screenshot-2026-08-15-at-6.54.17-PM.png`.

Note: the `TASK-109`/`UAT-109` visible in the screenshot belongs to the **cryptwiz** project's own task tracking (a separate project this conductor instance was orchestrating), not this repo's `TASK-109` — numbering coincidence only.

## Reproducibility

- **Frequency**: always (per reporter: "always, as long as there are subagents running and the main agent is waiting")
- **First seen**: 2026-08-15
- **Last seen**: 2026-08-15

## Root Cause Analysis

**Confirmed root cause**: `hooks/on-stop.js` (`hooks/on-stop.js:2`, delegating to `hooks/lib/write-state.js:writeState('idle', 'stop')`) writes `idle` to `$STATE_DIR/<agent>.state` **unconditionally** whenever Claude Code's `Stop` hook fires — with no awareness of whether the agent spawned background/async sub-agent work that is still running.

This is not a hook-attribution bug (the investigation prompt's leading hypothesis — that a Task-tool sub-agent's own lifecycle hooks might write to the *parent's* state file via shared env vars/cwd resolution in `write-state.js` — was investigated and ruled out): Anthropic's documented `Stop` behavior is that it fires only after all **synchronous** sub-agent work (the classic Task tool, bracketed by `SubagentStart`/`SubagentStop` *inside* the outer turn) has resolved. A synchronous Task-tool sub-agent cannot be "still running" at the moment `Stop` fires for the parent.

The actual mechanism is Claude Code's **background/async-agent feature**, shipped in v2.1.198 (~July 1 2026) — several months after this repo's hook set was last touched (April 2026, task 009's idle/busy vocabulary collapse). As of that version, background agents run by default and the outer turn's `Stop` hook is **documented to fire legitimately** (a real, correct turn-completion, not a bug) while a background agent the turn spawned keeps running independently, resumed later via the `Notification` hook's `agent_needs_input`/`agent_completed` event types. `Stop`'s own JSON payload has no field describing outstanding background work (verified against two independent primary sources — see `raw/research/stop-hook-subagent-detection/index.md`, which pre-dates this fix and did the bulk of this root-cause investigation), so the idle/busy state file `on-stop.js` writes cannot, by construction, represent "turn ended, but a background agent I spawned is still going." The screenshots that motivated `TASK-133` (`tmp/dashboard-drops/1786843012759-stage-{1,2,3}.png`) show exactly this: the agent's own turn ends with "Waiting for 3 background agents to finish," the dashboard reads `idle`, and the next queued task dispatches into the same pane while the original 3 background agents are still running (still counting up past 24s).

`host-server/index.ts`'s dispatch architecture had, independently of this bug, already moved from `monitor.sh`'s polling loop (per `TASK-120`/`TASK-121`, both landed) into two host-server call sites that both key off the same idle/busy state file: the `POST /api/tasks` immediate-enqueue fast path and `pollAndDiff`'s idle-transition trigger. Both call sites inherited the false-idle read with no additional check, which is why the bug reproduced "always, as long as there are subagents running and the main agent is waiting," regardless of which of those two paths fired.

A prior task, `TASK-133` (status `todo` at the time of this fix), had already designed the correct remedy — an event-driven sentinel keyed to the `Notification` hook's `agent_needs_input`/`agent_completed` types — based on the same research. This fix implements that design.

## Resolution

Implemented an event-driven sentinel that tracks outstanding background agents independently of the idle/busy state file, and gated both dispatch call sites on it:

1. **`hooks/on-notification.js`** (new) — registered under the `Notification` hook event (`hooks/register-hooks.jq`, `install-hooks.sh`). Logs every payload to `$CONDUCTOR_LOG_DIR/notification-debug.jsonl` (cheap, and the only way to eventually confirm real field names/semantics — see Verification below). On `notification_type === 'agent_needs_input'`, creates a sentinel file under `$STATE_DIR/<agent>.pending-agents/<timestamp>-<random>`; on `agent_completed`, removes the oldest sentinel (FIFO) if any exist. Every other `notification_type` is a no-op (still logged) — this does **not** reopen the `done`/`working`/`wait`/`dispatching` vocabulary `TASK-009` deliberately collapsed in April 2026.
2. **`host-server/pendingAgents.ts`** (new) — `hasPendingBackgroundAgents(stateDir, windowName, staleMs)` checks that directory for any sentinel newer than `staleMs`; a sentinel older than that is logged and ignored, so a missed or misunderstood `agent_completed` notification can never wedge the queue forever (mirrors the existing busy-older-than-2×POLL_INTERVAL → stalled staleness pattern).
3. **`host-server/index.ts`** — both dispatch call sites now check `hasPendingBackgroundAgents(conf.stateDir, win, conf.pendingAgentStaleMs)` before dispatching: the `POST /api/tasks` immediate-enqueue fast path (falls through to a normal queued task instead of dispatching immediately when pending) and `pollAndDiff`'s idle-transition trigger (holds dispatch for that tick, tries again next poll).
4. **`conductor.conf` / `host-server/config.ts`** — new `PENDING_AGENT_STALE_S` setting (default 3600s / 1 hour — generous on purpose, since a real background agent run can legitimately take a long time), following the existing three-part conf-parsing pattern (`declare -p` list, `parsePositiveIntSetting`, `ConductorConf` interface + cache field).
5. **Docs** — `hooks/README.md` gained a `on-notification.js` section describing the sentinel mechanism explicitly as separate from the idle/busy state machine; `CLAUDE.md`'s idle-detection design-decisions list gained a pointer sentence.

### Verification performed

- `cd host-server && npm run typecheck` — clean.
- `cd host-server && npm test` — all 98 tests pass, including 6 new `pendingAgents.test.ts` cases (missing directory, fresh sentinel, emptied directory, stale sentinel ignored + logged, mixed fresh+stale, per-window scoping) and 3 new `config.test.ts` cases for `PENDING_AGENT_STALE_S` (default, explicit override with the seconds→ms conversion, non-positive fallback) — added following this file's existing pattern for identically-shaped settings.
- `bash -n install-hooks.sh` — clean. `jq -f hooks/register-hooks.jq` dry-run against an empty `{}` settings doc confirms `Notification` registers correctly alongside the existing four events.
- Ran `install-hooks.sh` twice against scratch settings/install-dir paths under `./tmp/` — `on-notification.js` installs, registers exactly once under `Notification`, and re-running is idempotent (no duplicate entries in any of the five hook arrays).
- Exercised `hooks/on-notification.js` directly with synthetic stdin payloads (`./tmp/` scratch `$CONDUCTOR_STATE_DIR`/`$CONDUCTOR_LOG_DIR`): two `agent_needs_input` events created two sentinel files; an unrelated `idle_prompt` event was correctly a no-op; two successive `agent_completed` events removed them FIFO (oldest first) down to an empty directory; a further `agent_completed` against an already-empty directory did not crash (exit 0); `notification-debug.jsonl` recorded all five events with correct `notification_type` fields.

### Update 2026-09-03 — confirmed via current Claude Code docs: the sentinel does NOT protect the scenario that motivated this bug

Re-researched the two open questions below against current (September 2026) official Claude Code documentation (`code.claude.com/docs/en/hooks-guide`, `.../hooks`, `.../agent-view`) rather than a live session, since the specific open question — `agent_needs_input`'s firing semantics — turns out to be answerable from documentation alone (it wasn't in August; the docs have since been clarified).

**Confirmed: `agent_needs_input` fires *only* when a background agent is blocked on a decision and genuinely needs the user — it is not a general "still outstanding" heartbeat.** Per the current docs: it fires when "a background session starts waiting on your input while agent view is open, or the current session asks you an agent team teammate's terminal setup question."

This is a **materially worse finding than the risk originally flagged** (§86 below, written when this was still an open question): it means a background sub-agent that runs to completion *without ever needing input* — the normal case for an autonomous `/power-mode`-style UAT-auto sub-agent doing its own work, arguably the majority case, and almost certainly what the original incident's `Agent(UAT auto TASK-109)` was doing — **never fires `agent_needs_input` at all**, so no sentinel is ever created for it. `hasPendingBackgroundAgents()` reads an empty (or absent) directory the entire time that agent is running, and dispatch proceeds exactly as it did before this fix. **As designed, this fix does not protect the scenario that motivated BUG-0001's original report.** It only helps a narrower, real-but-secondary case: a background agent that happens to pause on a decision before completing.

Also confirmed while re-researching: there is still **no documented "started" event** for background/async agent dispatch (checked the full current `Notification` matcher-type list: `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `elicitation_url_dialog`, `elicitation_complete`, `elicitation_response`, `agent_needs_input`, `agent_completed`, `quota_auto_resume_fired`, `quota_auto_resume_stale`, `quota_auto_resume_disabled` — no `agent_started` or equivalent), and `PreToolUse`'s ability to distinguish a background/async Task dispatch from a synchronous one in `tool_input` remains undocumented. So there is no way, using only *documented* Claude Code hook behavior, to seed a sentinel at the moment a background agent starts — only `agent_completed` (which does fire on completion regardless of whether input was ever needed, per the docs) is available as a reliable signal, and it's a clear-signal with no matching set-signal for the common no-input-needed path.

The correlator question (§87 below) remains genuinely unconfirmable from documentation — current docs list `session_id`/`transcript_path`/`cwd`/`permission_mode` as common `Notification` fields plus `notification_type`/`message`/`title`, but don't clarify whether `session_id` uniquely identifies a single background agent or the whole session tree. This is now secondary to the firing-semantics finding above, which is the actual reason this fix doesn't work, not just a robustness gap under concurrency.

**Recommended next step, revised**: this needs a design change, not just a verification pass. Two directions worth weighing (not yet decided or implemented):
1. **Text-pattern fallback as the primary mechanism, not the event-driven sentinel.** This codebase already has precedent for exactly this shape of problem — `AWAITING_PATTERN`'s pane-text matching with a staleness fallback (see `CLAUDE.md`'s idle-detection design-decisions) — because Claude Code doesn't expose a clean hook signal for "waiting on a human," either, so the existing solution is text detection, not a hook. A similar pane-text heuristic (something in the pane while a background agent is running that's distinguishable from an ordinary idle/busy state) may be the only mechanism that covers the *un*-blocked, still-running case, since no hook does.
2. **Live capture, upgraded scope**: dispatching a real background/async agent doesn't actually require a live multi-agent *tmux* session as originally assumed — any Claude Code session with the `Notification` hook registered would see the real payload for its own background/async dispatches (e.g. via the `Agent` tool's background-capable modes). This is more reachable than previously scoped, but does require installing this repo's hooks into `~/.claude/settings.json` (global, machine-wide, outside this repo) to observe it, which is a broader-blast-radius action than typical repo-local work — flagging for explicit go-ahead rather than doing it inside an unattended loop cycle.

### Update 2026-09-04 — `/research`ed both options in depth; direction 1 (footer-hint pane-text) is disqualified by a live check; found a third, riskier candidate

Ran `/research` (persisted at `raw/research/bug-0001-background-agent-detection/`, ingested into `wiki/knowledge/sources/bug-0001-background-agent-detection.md`) to flesh out both directions from the update above. Confirmed via current docs: `agent_completed` fires on success *or* failure (the clear-side of the sentinel is sound); no per-agent correlator field is documented anywhere on the `Notification` payload after three separate fetch attempts. Found a third signal not previously considered: the interactive prompt footer's `←` hint (`← N agents` / `← for agents` / `← N done`), which per docs distinguishes "N agents need input" from "agents active, none need input" — exactly the missing case.

User approved building direction 1 (the footer-hint pattern) on this basis. Before writing any pattern, did the one live check the research report called for — and **it disqualifies the footer hint entirely**: read-only `tmux capture-pane` against 4 live, completely unrelated agent panes (different projects: `bootstrap-claude`, `cryptwiz-py`, two `tmux-conductor` panes) all showed the identical `← 1 agent` footer at the same moment, none of which had any background sub-agent of their own running. The "1" was this investigating session's own unrelated `notification-hook-research` sub-agent (spawned via the `Agent` tool, still idle/unread). **The `←` hint is global/account-wide — reflecting every background job on the machine, not scoped to the specific pane displaying it.** Matching on it per-agent would gate dispatch on activity totally unrelated to that agent, which is worse than the bug it's meant to fix, not a fix. Direction 1 from the update above is dead.

While investigating why, found `~/.claude/jobs/<id>/state.json` (Claude Code's own internal per-background-job state — confirmed by inspecting all 4 job directories currently on this machine): a JSON `state` field (`working`/`blocked`/`stopped`), a `linkScanPath` pointing directly into `~/.claude/projects/-Users-davidtaylor-Repositories-<project>/...jsonl` (making it correlatable to a specific project/agent), and a `fan` array of sub-tasks with `startedAt`/`doneAt` timestamps (`doneAt: 0` = still running). This is structurally exactly what's needed — precise, per-agent, distinguishes "still working" from "blocked/done" — but it's **undocumented private internal state** (`600` permissions, no public API, no stability contract, could change format or location without notice). This is a materially different, higher risk than either direction previously weighed: not a supported hook, not a documented UI surface, a bet on reverse-engineered internals.

**Status now**: three options on the table, none implemented — (1) keep only the existing hook-based sentinel, accept the known no-input-needed gap, no new work; (2) poll `~/.claude/jobs/*/state.json` with a loud fallback if the format ever looks unexpected; (3) something else. Flagged back to the user for a decision — not proceeding unilaterally on (2) given its undocumented-internals risk, same caution class as the earlier global-config-change flag.

### Update 2026-09-19 — fresh live repro; found the missing correlator for option 2; user approved proceeding with option 2

Fresh screenshot repro (`tmp/dashboard-drops/1789799698836-Screenshot-2026-09-19-at-1.02.12-AM.png`): an agent's pane transcript shows an in-progress teammate/sub-agent conversation ("Teammate @tackle-0182-step2-index-ts finished", `main` still waiting on `tackle-0182-step3-terminal-loops`), while the dashboard badges it `NO TASKS` (the frontend's `empty` status — `idle` state + zero queued tasks, see `frontend/src/components/AgentList.tsx:118`). Confirms the gap is still live and reproduces exactly as before: `host-server/state.ts`'s `detectAgentStatus()` never calls `hasPendingBackgroundAgents()` — that check still only gates the two dispatch call sites in `host-server/index.ts`, not status detection, so the *displayed* status is wrong even on ticks where dispatch itself is correctly held.

**New finding, not previously known**: a real per-job correlator exists after all, just not inside `~/.claude/jobs/<id>/state.json` itself — it's in the **parent session's own transcript**. When a session spawns a background job, the parent's `.jsonl` (the same file tracked per-agent by this repo's hook sidecar, `logs/state/<agent>.meta.json` → `transcript_path`/`session_id`) gets a dedicated record:

```json
{"type":"continued-in","sessionId":"<parent-session-id>","continuedInSessionId":"<job-session-id>"}
```

Verified live against two independent, unrelated background jobs currently on this machine (`~/.claude/jobs/5aa8a27d/`, `~/.claude/jobs/7290ca9d/`) — in both cases, grepping the job's own `sessionId` across `~/.claude/projects/<project-dir>/*.jsonl` turned up exactly one other transcript containing a `continued-in` record whose `continuedInSessionId` matched, and that transcript's own `sessionId` was the spawning session. This resolves the correlator gap the 2026-09-04 update flagged (§104) as "no per-agent correlator field is documented anywhere on the payload" — the correlator isn't on the job's `state.json`, it's a event type in the parent's transcript.

This changes the design for option 2: instead of matching background jobs to an agent by `cwd` alone (ambiguous whenever [[project_agents_share_workdir|multiple agents share a workdir]]), the poller can scan the agent's own transcript (already known via the hook sidecar) for `continued-in` records, collect the `continuedInSessionId`s, and check only those specific jobs' `state.json` for non-terminal state — a precise, per-agent match, not a `cwd` heuristic. Observed `state` values so far: `"working"` (in a job's `timeline.jsonl`, non-terminal) and `"done"` (in `state.json`, terminal) — the full enum (e.g. whether `"blocked"`/`"stopped"`/`"failed"` also occur) is still unconfirmed, so the staleness-bound fallback (mirroring `PENDING_AGENT_STALE_S`) stays load-bearing: an unrecognized `state` value should log a loud warning and be treated as non-terminal (busy) only until the job's `updatedAt` ages past the staleness bound, so an unknown-format job can never wedge a status read forever.

**User decision**: proceed with option 2 (poll `~/.claude/jobs/*/state.json`, correlated via the transcript's `continued-in` records), given the correlator gap is now resolved. Filed as `[[TASK-0184]]`.

Original next-step text, superseded by the above but kept for the historical record:

> Recommended next step before closing: reproduce the original repro live (stack `/power-mode` tasks, one of which spawns background sub-agents) with this fix installed, inspect `$CONDUCTOR_LOG_DIR/notification-debug.jsonl` for the real payload shape, and confirm via `$LOG_DIR/dispatch.jsonl` that no premature dispatch occurs while `<agent>.pending-agents/` is non-empty. `TASK-133` (status `todo` as of this fix, which independently designed this same remedy from the same research) already scopes exactly this live-investigation-and-confirm step — worth reconciling/closing out alongside this bug rather than duplicating it.

### Update 2026-09-19 — TASK-0184 Steps 1-3 implemented; Step 5 (live verification) still outstanding

Implemented option 2 from the update above. `host-server/backgroundJobs.ts` (new module) exports `hasActiveBackgroundJob(stateDir, agentName, workdir, staleMs, jobsDir?)`, which resolves an agent's transcript via the existing `resolveTranscriptPath` (`host-server/context.ts`), collects `continuedInSessionId`s from `{"type":"continued-in",...}` records, and checks each matching `~/.claude/jobs/<id>/state.json`.

**Confirmed final `state` enum** (Step 1's live investigation, against two real jobs' full `timeline.jsonl` histories — `5aa8a27d`, `7290ca9d`): `"working"` and `"blocked"` are non-terminal (job still outstanding — `"blocked"` was a new finding not previously known, a coordination stall waiting on a peer session, not an error); `"done"` is terminal; anything else is unrecognized, logged via `console.warn`, and treated as active only within the staleness bound of the job's `updatedAt` (mirroring `pendingAgents.ts`'s stale-sentinel fallback). No `"failed"`/`"stopped"`/`"error"`/`"cancelled"` state was ever observed in either job's full history. **Staleness bound used**: `conf.pendingAgentStaleMs` — the same `PENDING_AGENT_STALE_S` conductor.conf setting the existing `hasPendingBackgroundAgents()` sentinel already uses; no new config key was added.

`host-server/state.ts` gained `detectAgentStatusWithBackgroundJobs()`, a wrapper that calls the existing `detectAgentStatus()` unchanged and, only when its result is `{state: 'idle', ...}`, additionally checks `hasActiveBackgroundJob(...)` and upgrades to `{state: 'busy', reason: 'background-job'}`. `detectAgentStatus()` itself and its 18-case test matrix (`state.test.ts`) are untouched — this is strictly additive. All 8 `detectAgentStatus(...)` call sites in `host-server/index.ts` (the task's own estimate of 7 was stale) now call the wrapper, each threading that call site's `agent.workdir`. `cd host-server && npx tsc --noEmit` clean; `npm test` 179/179.

This is deliberately independent of `host-server/pendingAgents.ts` / `hasPendingBackgroundAgents()` (the Notification-hook-driven dispatch-gating sentinel from this bug's original fix / `TASK-133`) — that mechanism is untouched and still gates dispatch exactly as before. This new signal only affects status *detection/display*, via a completely different, hook-independent mechanism (polling Claude Code's own `~/.claude/jobs/*/state.json`), so it does not depend on `agent_needs_input` ever firing — closing exactly the gap the 2026-09-03 update above found in the hook-driven sentinel alone.

**Still outstanding**: Step 5's live check — confirming against a real, genuinely-`"working"` background job that `GET /agents`/the dashboard shows `busy` for its duration and reverts once the job's `state.json` reads `"done"` — has not yet been performed by anyone. `status:` stays `in-progress`; this is **not** being closed here. Closing this bug is the user's call via `/bug-close BUG-0001` once Step 5's live check confirms the fix, per `wiki/work/bugs/lifecycle.md`'s regression-test-and-fix-commit gate — the same pattern `TASK-133` followed.

### What remains unverified (original, 2026-08-26 — see the update above for what's now confirmed)

The exact real-world semantics and payload shape of `agent_needs_input`/`agent_completed` were **not** confirmed against a live Claude Code session — that would require actually dispatching a real `/power-mode`-style run with background sub-agents inside a live multi-agent tmux session, which was out of reach for this investigation (delegated agent, no live tmux session, and deliberately avoiding spending real usage/tokens on an unverified assumption). Specifically still open, exactly as flagged as unconfirmed in `raw/research/stop-hook-subagent-detection/index.md` before this fix:

- Whether `agent_needs_input` really fires as a general "this background agent is still outstanding" ping (this fix's working assumption) versus only when the background agent needs a specific user decision — if the latter, a background agent that runs to completion without ever needing input would never get a sentinel written for it at all, and this fix would silently fail to protect that case. **[Confirmed 2026-09-03: it's the latter — see Update above.]**
- Whether the payload carries a per-agent correlator (e.g. `agent_id`) — none was assumed; the FIFO per-arrival-file scheme is deliberately correlator-free and therefore cannot correctly track multiple concurrent background agents completing out of order (it would clear an unrelated sentinel instead of the one that actually finished). With a single background agent at a time this is harmless; with concurrent background agents (the original incident had 3) it can under- or over-clear. **[Still unconfirmed as of 2026-09-03 — now secondary to the firing-semantics finding above.]**
- Whether there is a reliable "started" signal at all beyond `agent_needs_input` — per the research, `PreToolUse` cannot reliably distinguish a background/async dispatch from a synchronous one, so this fix does not attempt a "started" seed and relies solely on the two Notification types. **[Confirmed still absent from documentation as of 2026-09-03 — see Update above.]**

## Related

`relates_to::[[TASK-120]]`, `relates_to::[[TASK-121]]` — flagged as possibly the same idle-detection/dispatch-triggering code path (both still `todo` as of filing), not confirmed. See `wiki/work/tasks/TASK-120-collapse-dispatch-into-status-poll.md` and `wiki/work/tasks/TASK-121-remove-redundant-monitor-dispatch.md`.
