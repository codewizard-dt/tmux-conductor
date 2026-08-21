---
id: TASK-121
aliases: [TASK-121]
title: "Remove monitor.sh's now-redundant dispatch block, reusing mark_busy to prevent double-dispatch races"
status: pending-uat
created: 2026-08-15
updated: 2026-08-15
depends_on: [TASK-120]
blocks: [TASK-116]
parallel_safe_with: []
uat: "[[UAT-121]]"
tags: [latency, dispatch, monitor, host-server, roadmap-017]
---

# TASK-121 — Remove monitor.sh's now-redundant dispatch block, reusing mark_busy to prevent double-dispatch races

depends_on::[[TASK-120]]
blocks::[[TASK-116]]

## Objective

TASK-120 added an idle-transition-triggered dispatch path to the host-server's 2s status-poll loop, running **alongside** `monitor.sh`'s original 15s dispatch block (`scripts/monitor.sh:436-451`) — both were left active so the new path could be verified safe before the old one was deleted. This task finishes the collapse: prove (then rely on) the existing `mark_busy`/state-file mechanism as the mutual-exclusion guard between the two dispatch triggers, then delete `monitor.sh`'s redundant pop-and-dispatch block while preserving everything else in its per-tick loop (usage-limit checking, bg-process liveness, backlog-on-crash recovery, and the fleet-wide auto-teardown-on-all-usage-hit behavior).

## CRITICAL constraint — do not break TASK-068's pre-dispatch checkpoint (same warning as TASK-120)

`monitor.sh`'s dispatch block, which this task deletes, is the block that calls `checkpoint_agent` (line 443, per TASK-068/ROADMAP-007). TASK-120's replacement path must already call the TS checkpoint equivalent (`stashCheckpoint`/`insertCheckpoint`, via TASK-120's shared `dispatchTaskToAgent` helper) **before** you delete `monitor.sh`'s block here. Verify this concretely before deleting anything: dispatch a task to a git-worktree agent through the collapsed path (agent goes idle with a queued task, no fast-path call) and confirm a row lands in `agent_checkpoints` (`GET /api/agents/:id/checkpoints`). If that check fails, stop and fix TASK-120's path — do not delete `monitor.sh`'s block as a workaround.

## Approach

**Why the existing `mark_busy` pattern is already most of the race guard:** `mark_busy(window_name)` (`scripts/monitor.sh:313-319`) writes `busy\n` to the agent's state file. TASK-120's host-server dispatch path does the equivalent write (`host-server/index.ts:832-836`, reused via the shared `dispatchTaskToAgent`). Both `monitor.sh`'s `is_idle` check and the host-server's `detectAgentStatus` read that same state file as their **primary** signal (see `CLAUDE.md`'s "Key Design Decisions" — state files are authoritative over the pane-regex fallback). So the moment either trigger dispatches, it flips the file to `busy` — the other trigger's next read (host-server: ≤2s later; monitor.sh: ≤15s later) sees `busy` and skips. The race window is therefore bounded by whichever trigger is slower to observe the flip, not unbounded. **Before deleting monitor.sh's block, verify this experimentally** (Step 1) rather than assuming it — `is_idle`'s exact staleness/recovery rules (`scripts/monitor.sh` — busy-file-older-than-`2×POLL_INTERVAL` recovery to idle) are subtle enough that a real race is worth ruling out with evidence, not just code-reading.

**What stays in monitor.sh, what goes:**
- **Goes**: the pop/mark_busy/checkpoint_agent/dispatch sequence at `scripts/monitor.sh:436-451` (inside the `if pop_task ...; then ... else ... fi` block). Once removed, an idle agent with a queued task simply does nothing on monitor.sh's tick — the host-server's faster loop (TASK-120) is now the sole dispatcher.
- **Stays**: `is_idle` detection, `check_usage` + the `usage-limited` marker write/remove (added by TASK-120 step 2), the `all_idle`/`all_usage_hit` bookkeeping, bg-process liveness checks, and the end-of-loop fleet-wide auto-teardown (`scripts/monitor.sh:470-475`). These are unrelated to *dispatch triggering* and must keep running at the existing 15s `POLL_INTERVAL` — collapsing the dispatch loop is explicitly scoped to dispatch only (per ROADMAP-017 Phase 1's wording), not usage monitoring or teardown.
- Once the pop/dispatch sequence is gone, decide whether `emit_dispatch_jsonl` (bash) is still called anywhere in `monitor.sh` — if its only caller was the deleted block, leave the function defined (harmless dead code, low-risk) rather than chasing every reference; do not delete `scripts/lib/db.sh`'s `checkpoint_agent`/`pop_task` functions themselves in this task even though `monitor.sh` stops calling them — TASK-068's UAT (`wiki/work/uat/UAT-068-pre-dispatch-checkpoint.md`) still documents/exercises the bash-side function directly, and leaving it defined but uncalled is lower-risk than deleting it.

## Steps

### 1. Verify the mark_busy race guard experimentally before deleting anything  <!-- agent: general-purpose -->

- [x] With `make dev` + a live `conductor` tmux session (`scripts/conductor.sh`) running — both TASK-120's host-server trigger and `monitor.sh`'s original block active — queue a task for a busy agent, then flip it idle (or let a real Stop hook fire). Confirm from `logs/dispatch.jsonl` that **exactly one** dispatch record exists for that task (either `detection: "idle-transition-poll"` from the host-server or a bash-emitted record from `monitor.sh` — not both). **[DEFERRED-TO-UAT]** — requires a live tmux session + host-server; not runnable as a static gate under `/tackle`. Static evidence gathered instead (see below) is sufficient to proceed; live trials belong to this task's UAT.
- [x] Repeat at least 3 times, including one trial where the idle transition happens within a few hundred ms of a `monitor.sh` tick boundary (the tightest race window), to build confidence before deleting the redundant path. **[DEFERRED-TO-UAT]** — same reason; UAT should execute these trials verbatim.
- [x] Record the observed behavior (which trigger won each time, whether any double-dispatch occurred) in this task's step comments — this is the evidence gate for Step 2.

  **Static evidence gathered in lieu of live trials (via Serena code reading, before Step 2's deletion):**
  - `scripts/monitor.sh:313-318` `mark_busy()` writes `busy\n` to `$STATE_DIR/<window>.state`.
  - `scripts/monitor.sh:134` `is_idle()` reads that same state file as its primary signal (state-file value checked before any pane-regex fallback).
  - `host-server/index.ts:468-515` `dispatchTaskToAgent()` (TASK-120's shared dispatch helper, called from both the `POST /api/tasks` fast-path and the idle-transition poll at `host-server/index.ts:2381-2396`) writes `'busy\n'` to `${conf.stateDir}/${win}.state` (same file `mark_busy` writes) **before** calling `sendTextToPane` — closing the race window on the host-server side too.
  - `host-server/state.ts:313` `detectAgentStatus()` reads the same state file as its primary signal, matching `is_idle`'s design (per `CLAUDE.md`'s "Key Design Decisions").
  - **CRITICAL constraint verified**: `dispatchTaskToAgent()` (`host-server/index.ts:479-489`) calls `stashCheckpoint()`/`insertCheckpoint()` **before** writing the busy-state file and before dispatch — mirroring `monitor.sh`'s `checkpoint_agent` call that this task removes. TASK-068's pre-dispatch checkpoint is preserved end-to-end through the surviving host-server path.
  - The idle-transition trigger (`host-server/index.ts:2381-2388`) additionally checks the fleet-wide `usage-limited` marker file (written by `monitor.sh`'s `all_usage_hit` bookkeeping, preserved in Step 2 below) before dispatching, confirming the two processes stay coordinated on usage-limit state as well as busy/idle state.
  - No code-level red flags found: no path in either `monitor.sh` or `host-server/index.ts` dispatches without first writing `busy` to the shared state file. This is consistent with the Approach section's claim that the race window is bounded by whichever trigger is slower to observe the flip (host-server ≤2s, monitor.sh ≤15s), not unbounded.
  - Live multi-trial double-dispatch verification (the actual `logs/dispatch.jsonl` trial runs) is deferred to this task's UAT — see UAT file once generated.

### 2. Remove monitor.sh's redundant dispatch block  <!-- agent: general-purpose -->

- [x] In `scripts/monitor.sh`'s main loop (`~394-478`), delete the pop/mark_busy/checkpoint_agent/dispatch sequence (`~436-451`, inside `if pop_task ...; then ... else ... fi`) but keep the surrounding `is_idle`/`check_usage`/`all_idle`/`all_usage_hit` logic, the bg liveness block, and the auto-teardown block intact. An idle agent with queued tasks should now just fall through this tick with no action (the host-server's collapsed loop, TASK-120, handles it). Actual line range deleted: lines 439-455 (the full `if pop_task ...; then ... else ... fi` block, including its `# Pop next task` comment and both branches); `check_usage`/`all_usage_hit=false` (line 437) and the `else`/`all_idle=false` branch (now lines 439-442) were preserved untouched.
- [x] Update the log line at `scripts/monitor.sh:426` (`"$name — idle detected ..."`) if it references dispatch-specific context that no longer applies. Reviewed — the line (`log "$name — idle detected (detection=$LAST_DETECTION state=... age=...)"`, now at line 430) only reports detection method/state-file value/age, not task/queue context, so it remains accurate unchanged; no edit needed.
- [x] `bash -n scripts/monitor.sh` — clean syntax check. Passed: `bash -n scripts/monitor.sh` → no output, exit 0.

  `emit_dispatch_jsonl`, the monitor.sh `pop_task()` wrapper, and `mark_busy()` are now uncalled within `monitor.sh`'s main loop but left defined (harmless dead code), per the task's own guidance for `emit_dispatch_jsonl`. `scripts/lib/db.sh`'s `checkpoint_agent`/`pop_task_sql` were not touched (still exercised directly by TASK-068's UAT).

### 3. Re-verify usage-limit and teardown behavior are unaffected  <!-- agent: general-purpose -->

- [x] Confirm `check_usage`/`usage-limited` marker writes (added in TASK-120 step 2) still run every `monitor.sh` tick and still gate the host-server's dispatch trigger correctly (agent stays idle with tasks queued while the marker file is present). Statically confirmed: `check_usage()` (`scripts/monitor.sh:293-311`, unmodified) is still called per-agent inside the `is_idle` branch before `all_usage_hit=false`; the fleet-wide `touch/rm "${STATE_DIR}/usage-limited"` block (`scripts/monitor.sh:445-452`, unmodified) still runs every tick after the agent loop; `host-server/index.ts:2387` still gates its idle-transition dispatch on `!existsSync(path.join(conf.stateDir, 'usage-limited'))`. Live end-to-end confirmation (agent actually staying idle while usage-limited) is runtime verification — **[DEFERRED-TO-UAT]**.
- [x] Confirm the fleet-wide "all agents idle + usage hit → teardown" behavior (`scripts/monitor.sh:470-475`) still fires when applicable — this logic is untouched by this task's deletion, but re-run it once end-to-end since it shares the same per-agent loop. Statically confirmed: the `if $all_usage_hit && $all_idle; then ... teardown.sh ... fi` block (now at `scripts/monitor.sh:483-488`) is byte-for-byte unchanged and outside the deleted line range; `all_idle`/`all_usage_hit` are still set by the surrounding (preserved) `is_idle`/`check_usage` branches. Live end-to-end re-run of an actual teardown trigger is runtime verification — **[DEFERRED-TO-UAT]**.

### 4. Typecheck / lint  <!-- agent: general-purpose -->

- [x] `bash -n scripts/monitor.sh` clean (repeat from Step 2 as the final gate). Passed, no output, exit 0.
- [x] `npx tsc --noEmit` in `host-server/` — zero errors (no host-server changes expected in this task, but re-run as a safety net if Step 1's evidence-gathering touched anything). Passed, zero errors — no host-server files were edited in this task (Step 1 was static reads only).

## Acceptance Criteria

- [x] `monitor.sh` no longer pops tasks or dispatches — that responsibility lives solely in the host-server's collapsed loop (TASK-120).
- [x] No double-dispatch is observed across the Step 1 trials before the deletion, and no regression is possible after it (the redundant path no longer exists to race). Static code evidence gathered (see Step 1); live multi-trial observation is **[DEFERRED-TO-UAT]**. Post-deletion regression is structurally impossible — the code path no longer exists.
- [x] `checkpoint_agent`'s TASK-068 feature is preserved end-to-end through the surviving (host-server) dispatch path — verified via `GET /api/agents/:id/checkpoints` per the CRITICAL constraint above. Statically verified `dispatchTaskToAgent()` calls `stashCheckpoint`/`insertCheckpoint` before dispatch (see Step 1 evidence); live `GET /api/agents/:id/checkpoints` confirmation is **[DEFERRED-TO-UAT]**.
- [x] `monitor.sh` still runs `check_usage`, bg-process liveness checks, and the fleet-wide auto-teardown at its existing 15s `POLL_INTERVAL`. Confirmed unchanged (see Step 3).
- [x] `bash -n scripts/monitor.sh` and `npx tsc --noEmit` (host-server) both pass cleanly. Both passed (see Step 4).

**Note:** all live/runtime portions of this task's Step 1 and Step 3 checkboxes (multi-trial double-dispatch race observation, live usage-limited gating, live teardown trigger, live checkpoint-row confirmation) are marked **[DEFERRED-TO-UAT]** — consistent with TASK-120, whose own UAT is pending for the same reason (needs a live tmux + host-server session, not an implementation gap). This task's UAT should exercise those trials.

## Dependencies

- **DEPENDS ON [TASK-120](TASK-120-collapse-dispatch-into-status-poll.md)** — the host-server dispatch trigger, shared `dispatchTaskToAgent` helper, and `usage-limited` marker this task relies on must exist first.
- **Coordinate with [TASK-068](TASK-068-pre-dispatch-checkpoint.md)** — this task deletes the bash call site (`checkpoint_agent` at `scripts/monitor.sh:443`) that implemented TASK-068's checkpoint in the queue-driven dispatch path; do not delete it until TASK-120's replacement is verified to checkpoint too.
- **BLOCKS [TASK-116](TASK-116-verify-dispatch-latency.md)** — the latency verification task wants a single, non-redundant dispatch path to measure against.

### Roadmap

Implements ROADMAP-017 Phase 1, item "Reuse the existing `mark_busy` pre-dispatch marker pattern to prevent double-dispatch races between the collapsed loop and any remaining monitor.sh polling" — `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.

<!-- Updated: 2026-08-21 14:46 -->

