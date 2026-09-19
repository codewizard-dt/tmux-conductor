---
id: TASK-144
aliases: [TASK-144]
title: "Mirror transitions.jsonl logging in monitor.sh's is_idle() for the hookless/regex-fallback path"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: [TASK-145]
parallel_safe_with: [TASK-142, TASK-143]
uat: "[[UAT-144]]"
tags: [monitor, bash, observability, logging, roadmap-019]
---

# TASK-144 — Mirror transitions.jsonl logging in monitor.sh's is_idle() for the hookless/regex-fallback path

blocks::[[TASK-145]]

<!-- Updated: 2026-09-13 -->
Progress: 3/3 steps done. Live-tmux transition confirmation deferred to UAT (runtime verification, not a tackle static gate).

## Objective

TASK-143 adds `logs/transitions.jsonl` from the host-server's TypeScript detector, but `monitor.sh`'s independent bash detector (`is_idle()`) is the only one that ever runs for hookless agents (Aider, Codex, plain shell without Claude Code hooks) and its own `LAST_DETECTION`/`LAST_STATE_VALUE`/`LAST_STATE_AGE` globals are currently only surfaced to `dispatch.jsonl` (dispatch-time only) — most bash-detected transitions never get logged anywhere. Add a bash-side emitter so every transition `is_idle()` observes, not just dispatch-time ones, lands in the same `logs/transitions.jsonl` stream.

## Approach

`scripts/monitor.sh`'s `is_idle()` (lines 135-292) already sets `LAST_DETECTION`, `LAST_STATE_VALUE`, `LAST_STATE_AGE` on every call, and `pane_tail_json()` (lines 329-338) already exists (used by `emit_dispatch_jsonl`) to capture a 10-line JSON-array pane snapshot. Add a new `emit_transition_jsonl` function, a sibling to `emit_dispatch_jsonl` (lines 341-384), that:

1. Is called from the main poll loop (around line 439, where `is_idle "$target" "$window_name" "$name"` is invoked) whenever the per-agent previous state differs from `LAST_STATE_VALUE`.
2. Tracks "previous state per agent" in a new associative array (e.g. `PREV_TRANSITION_STATE[name]`), since `is_idle()` itself has no persistent memory across ticks today — `monitor.sh` must track it in the poll loop, not inside `is_idle()`.
3. Writes a record shaped identically to TASK-143's host-server record (same field names: `ts`, `agentId` — omit or null if unavailable to bash, `agent`, `from`, `to`, `reason` (mapped from `LAST_DETECTION`: `state-file`/`busy-recovered`/`pane-dead`/`regex`), `stateFileAgeS` (from `LAST_STATE_AGE`), `paneTail` (via `pane_tail_json`)) so a downstream analysis script never needs per-detector parsing branches.

Do this for **every** transition the loop observes (idle, busy, awaiting, stalled-equivalent, pane-dead/exited), not just the idle-dispatch path `emit_dispatch_jsonl` already covers.

## Steps

### 1. Add per-agent previous-state tracking to the poll loop <!-- agent: general-purpose -->

- [x] In `scripts/monitor.sh`, declare a new associative array near the existing `AGENT_NAMES`/`AGENT_CMDS` declarations (check `scripts/lib/db.sh` for where those are declared, to match the existing pattern) to hold each agent's last-observed state, e.g. `declare -gA PREV_TRANSITION_STATE`.
- [x] In the main loop's per-agent block (around `scripts/monitor.sh:417-452`), after calling `is_idle "$target" "$window_name" "$name"`, compare `LAST_STATE_VALUE` (set by `is_idle`) against `${PREV_TRANSITION_STATE[$name]:-}`. If different (and `PREV_TRANSITION_STATE[$name]` was already set — i.e. not the agent's first tick), call the new `emit_transition_jsonl` (Step 2). Always update `PREV_TRANSITION_STATE[$name]="$LAST_STATE_VALUE"` after the check, whether or not it changed.

<!-- Notes: declared `declare -gA PREV_TRANSITION_STATE` at monitor.sh:37 (top-level globals block, matching declare -gA pattern from lib/db.sh's load_agents()). is_idle call site restructured (monitor.sh:445-465) to capture `idle_rc` via if/else (required under set -euo pipefail so a non-zero is_idle return doesn't abort the loop), then unconditionally runs the transition check using `${PREV_TRANSITION_STATE[$name]+set}` (not `:-`) to distinguish "never set" (first tick, skip emit) from "set to empty string" (LAST_STATE_VALUE can legitimately be "" for pane-dead). emit_transition_jsonl referenced but not yet defined — lands in Step 2. bash -n scripts/monitor.sh passed. -->

### 2. Add emit_transition_jsonl <!-- agent: general-purpose -->

- [x] Add `emit_transition_jsonl()` near `emit_dispatch_jsonl` (`scripts/monitor.sh:341-384`), following the exact same pattern (bash argument passing + a `python3 -c` heredoc for JSON construction, `>> "$LOG_DIR/transitions.jsonl" 2>/dev/null || true` at the end so a failure here can never break the poll loop).
- [x] Fields: `ts` (`date -u +%Y-%m-%dT%H:%M:%SZ`), `agent` (name), `from` (previous value), `to` (`LAST_STATE_VALUE`), `reason` (`LAST_DETECTION`), `stateFileAgeS` (`LAST_STATE_AGE`, null if empty), `paneTail` (via the existing `pane_tail_json "$target"` helper).

<!-- Notes: emit_transition_jsonl added at monitor.sh:400-431 (emit_dispatch_jsonl untouched at 350-391). New `TRANSITION_LOG="$LOG_DIR/transitions.jsonl"` var at monitor.sh:22, same LOG_DIR base as dispatch.jsonl/hooks.jsonl so both bash and TASK-143's host-server writer land in the same physical file. from/to null-if-empty; reason passed through from LAST_DETECTION unmapped; stateFileAgeS null if empty. bash -n passed. Minor tooling deviation flagged by the sub-agent: the one-line TRANSITION_LOG declaration was added via the standard Edit tool instead of Serena (function body itself used insert_after_symbol correctly); content verified correct via Serena search_for_pattern read-back. -->

### 3. Verify <!-- agent: general-purpose -->

- [x] Bash syntax check: `bash -n scripts/monitor.sh`.
- [DEFERRED-TO-UAT] Manually run `monitor.sh` against a live tmux session with at least one hookless/regex-only agent (or force a state-file-less agent), force a transition (e.g. dispatch a task or edit the pane), and confirm a new line appears in `logs/transitions.jsonl` with a non-empty `paneTail`.
- [x] Confirm `dispatch.jsonl` output is unchanged — this task only adds a new call site, never modifies `emit_dispatch_jsonl` itself.

<!-- Notes: bash -n scripts/monitor.sh exit 0. emit_dispatch_jsonl (lines 350-391) confirmed structurally intact and untouched via Serena find_symbol — still writes only to DISPATCH_LOG with its original field set (ts, agent, command, state, state_age_s, detection, queue, queue_remaining, pane_tail), no from/to/reason/TRANSITION_LOG leakage. emit_transition_jsonl (lines 400-431) confirmed as a distinct sibling writing only to TRANSITION_LOG. The live-tmux transition observation item is runtime/E2E per tackle policy — deferred to the UAT phase, not run here. -->

## Acceptance Criteria

- [x] Every state change `is_idle()` observes for every agent (not just idle-with-a-queued-task) produces one `logs/transitions.jsonl` record with the same field names TASK-143's host-server writer uses. (Implemented and statically verified; live confirmation deferred to UAT.)
- [x] The first tick for a newly-registered agent does not emit a spurious transition record (no prior state to diff against). (Uses `${PREV_TRANSITION_STATE[$name]+set}` to distinguish unset-key from empty-string-value.)
- [x] A write failure to `transitions.jsonl` never aborts `monitor.sh`'s loop (matches the existing `|| true` convention in `emit_dispatch_jsonl`).

## Verification

- [x] `bash -n scripts/monitor.sh`
- [DEFERRED-TO-UAT] Live transition observed in `logs/transitions.jsonl` (manual, documented above)

### Roadmap

Implements [[ROADMAP-019]] Phase 2 — `wiki/work/roadmaps/ROADMAP-019-agent-status-transition-observability.md`. Grounded in `raw/research/transition-observability/index.md` (Implementation outline step 5: "Mirror on the bash side").
