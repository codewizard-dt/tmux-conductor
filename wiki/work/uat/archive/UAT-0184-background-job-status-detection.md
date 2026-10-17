---
id: UAT-0184
aliases: [UAT-0184]
title: "UAT: Detect outstanding background jobs in agent status detection via ~/.claude/jobs/*/state.json"
status: passed
task: TASK-0184
created: 2026-09-19
updated: 2026-09-19
---

# UAT-0184 — UAT: Detect outstanding background jobs in agent status detection via ~/.claude/jobs/*/state.json

implements::[[TASK-0184]]

> **Source task**: [[TASK-0184]]
> **Generated**: 2026-09-19
> **Scope**: this is a backend-only, no-UI task — a new detection module (`host-server/backgroundJobs.ts`) plus a wrapper (`detectAgentStatusWithBackgroundJobs` in `host-server/state.ts`) wired into 8 existing status-detection call sites in `host-server/index.ts`. No new HTTP route was added; it changes what the `GET /api/status`-family endpoints report as a side effect of existing routes. There is therefore no new `UAT-UI-NNN` surface. `host-server/backgroundJobs.test.ts` already carries 10 unit tests for the pure `hasActiveBackgroundJob` function — this UAT does not duplicate those; it covers the previously-untested `detectAgentStatusWithBackgroundJobs` wrapper contract, the real index.ts wiring, and a read-only regression-safety check against the live host-server.

---

## Prerequisites

- [ ] `host-server/node_modules` installed
- [ ] For UAT-API-001 only: a host-server instance already running on `:8788` serving this machine's real agents (read-only — do not start/stop it)

## Not covered by this UAT (deliberately excluded)

- **The pure `hasActiveBackgroundJob` function's own detection logic** (transcript correlation, `working`/`blocked`/`done`/unrecognized-state handling, staleness fallback, caching) — already exhaustively covered by the 10 existing tests in `host-server/backgroundJobs.test.ts`, untouched by this task.
- **Driving a genuinely `"working"` real `~/.claude/jobs/*` entry end-to-end through the live dashboard** — per TASK-0184's own Step 5 note, this session's Agent-tool dispatches are synchronous teammate/subagent calls and do not create real `~/.claude/jobs/` entries, and a live host-server on `:8788` is already serving this machine's real agents and must not be disturbed. UAT-EDGE-003 below documents this gap explicitly rather than faking a permissive assertion.

---

## Test Cases

### UAT-EDGE-001: Wrapper passes through every non-idle `detectAgentStatus` result unchanged
- **Scenario**: `detectAgentStatusWithBackgroundJobs(conf, windowName, launchCmd, workdir, ...)` must return the exact same result as the underlying `detectAgentStatus(...)` (byte-for-byte, including `reason`/`matchedPattern`) whenever the underlying state is not `idle` — covering `busy`, `awaiting`, `stalled`, `exited`, `no-window`, and `starting`. This is the "only ever upgrades idle to busy, never anything else" contract from the task's Approach section.
- **Steps**: Run the unit test command.
- **Expected Result**: The test passes — all 6 sub-cases match `detectAgentStatus`'s own result exactly.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`detectAgentStatusWithBackgroundJobs: passes through every non-idle detectAgentStatus result unchanged (busy, awaiting, stalled, exited, no-window, starting)`)
- **Unit Test Command**: `cd host-server && npx tsx --test --test-name-pattern="passes through every non-idle" state.test.ts`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-002: Wrapper leaves an idle result unchanged when no background job correlates
- **Scenario**: With a hook-written `idle` state file and a workdir/agent name that resolves no transcript (no sidecar, no derivable project dir — `resolveTranscriptPath` returns `null`), the wrapper must return the exact same `{ state: 'idle', reason: 'state-file', matchedPattern: 'idle' }` as the raw detection, without ever touching the real `~/.claude/jobs` directory (this path returns `false` before `hasActiveBackgroundJob` ever calls `fs.readdirSync` on the jobs dir, so it's safe to run on any machine regardless of real job state).
- **Steps**: Run the unit test command.
- **Expected Result**: The test passes.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (`detectAgentStatusWithBackgroundJobs: an idle result with no resolvable transcript (no sidecar, no derivable workdir) stays idle`)
- **Unit Test Command**: `cd host-server && npx tsx --test --test-name-pattern="no resolvable transcript" state.test.ts`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-003: Wrapper upgrades idle to busy/background-job when an active job correlates (gap — not independently testable through the wrapper's public API)
- **Scenario**: When `hasActiveBackgroundJob(...)` would return `true` for the resolved transcript, the wrapper must return `{ state: 'busy', reason: 'background-job' }` instead of the raw idle result.
- **Gap**: `detectAgentStatusWithBackgroundJobs` calls `hasActiveBackgroundJob(conf.stateDir, windowName, workdir, conf.pendingAgentStaleMs)` with **no `jobsDir` override** (confirmed by reading `host-server/state.ts:452-467`) — unlike the pure function itself, which does accept one for exactly this reason. That means a scratch fixture cannot be injected through the wrapper's public API without either monkeypatching `fs` or writing into the real `~/.claude/jobs` directory, which this UAT will not do (see "Not covered" above). This specific branch is therefore verified two other ways instead of a wrapper-level test: (a) direct source inspection of the wrapper body, which is a straight `if (result.state === 'idle') { ... return { state: 'busy', reason: 'background-job' } }` with no additional logic to diverge from the pure function's own contract; (b) the pure function's own already-passing `true`-branch unit tests in `backgroundJobs.test.ts` (`"working"`, `"blocked"`, and unrecognized-but-fresh cases). TASK-0184's own Step 5 verification note reached the same conclusion via a synthetic fixture calling `hasActiveBackgroundJob` directly.
- **Steps**: Read `host-server/state.ts:452-467` and confirm the wrapper body matches the description above; cross-reference `backgroundJobs.test.ts`'s three `true`-branch cases.
- **Expected Result**: Wrapper body confirmed as a direct pass-through of `hasActiveBackgroundJob`'s boolean into `{ state: 'busy', reason: 'background-job' }`, no other logic present.
- **Repeatable Unit Test**: Blocked — wrapper does not expose a `jobsDir` override, so the upgrade path cannot be driven from a scratch fixture without touching the real `~/.claude/jobs` directory or monkeypatching `fs`. Recommend (not implemented here, out of this task's scope) adding an optional `jobsDir` parameter to `detectAgentStatusWithBackgroundJobs` purely for testability if this gap needs closing later.
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-004: All 8 production call sites use the wrapper, not the raw `detectAgentStatus`
- **Scenario**: Every status-detection call site in `host-server/index.ts` that previously called `detectAgentStatus` directly now calls `detectAgentStatusWithBackgroundJobs`, threading `agent.workdir` (or the equivalent local var) as the 4th argument.
- **Steps**: `find_referencing_symbols` (Serena) on `detectAgentStatusWithBackgroundJobs` in `host-server/index.ts`.
- **Expected Result**: Exactly 8 call sites, all passing a workdir argument: `refreshAgentContextCache` (line 242), the `POST /api/tasks` immediate-enqueue fast path (line 939, kept as the original inline `.state === 'idle'` boolean shape per the task's own note), `POST /agents` (line 1077), `POST /agents/:id/window` (line 1140), `PATCH /agents/:id` (line 1506), `POST /agents/:id/clone` (line 1554), `POST /projects/:id/agents` (line 2250), and `buildSnapshot` (line 2496). None of these call the raw `detectAgentStatus` directly any more.
- **Repeatable Unit Test**: Not applicable — this is a structural/call-site fact verified by symbolic source search, not an independently testable runtime behavior beyond what UAT-EDGE-001/002 already prove about the wrapper function itself.
- [x] Pass <!-- 2026-09-19 -->

### UAT-API-001 (regression safety, read-only): Live `GET /api/status` still reports normal idle/busy status for a real agent with no background job
- **Scenario**: After this task's wiring change, an agent with no outstanding background job must still report its ordinary state-file-driven status through the now-wrapped call sites — i.e. the change must not have broken the common case for every other agent on the machine.
- **Steps**: `curl -s http://localhost:8788/api/status` against the already-running live host-server (no agents dispatched, no state mutated) and inspect one agent's `status` object.
- **Expected Result**: The endpoint returns 200 with a well-formed `status` object (`state`, `reason`, `evidence`) for each agent; an agent with no active background job reports its ordinary idle/busy state exactly as before this task (verified live 2026-09-19: agent `architect-2` returned `{"state":"idle","reason":"state file plus pane evidence", ...}` with no errors).
- **Repeatable Unit Test**: Not applicable — inherently a live, non-deterministic instance check (depends on whichever real agents are running at test time); not fixture-based and not meant to be re-run automatically.
- [x] Pass <!-- 2026-09-19 -->
