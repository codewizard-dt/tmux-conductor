---
topic: "how to improve observability/logging of agent status transitions. log a snapshot of the terminal output and the details of the to/from status transition so that it can be analyzed later to improve the transition logic"
slug: transition-observability
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Observability for Agent Status Transitions

> tmux-conductor already writes three JSONL logs, but none of them captures the one thing needed to debug or improve the status-detection heuristics themselves: a single record, per transition, that pairs `from`/`to` state with *why* the detector decided that and *what the pane actually looked like* at that moment. A prior research pass (`application-latency-structure/index-2.md`, F7, 2026-07-04) already proposed part of this and was never implemented — the gap it identified is still open today, confirmed by reading the current code. The recommended fix is a new `transitions.jsonl` stream, emitted from the one place both detection paths (`host-server`'s `detectAgentStatus` and `monitor.sh`'s `is_idle`) already compute a state, extended to also carry the pane snapshot and match reasoning that both functions currently discard after using them to decide true/false.

## Research Questions

- What does the current codebase log today when an agent's status changes, and where does that logging happen?
- What specific information is missing that would be needed to retroactively analyze *why* a transition was (mis)detected?
- Has this gap been identified before, and if so, what was recommended and why wasn't it built?
- What do the two independent detectors (`monitor.sh` bash regex/state-file logic vs. `host-server`'s TypeScript `detectAgentStatus`) already compute internally that could be surfaced instead of recomputed?
- What structured-logging patterns from outside this codebase apply to a heuristic, multi-signal state detector like this one?

## Current State (Codebase)

Three append-only JSONL logs already exist, none of which is a full transition-analysis log:

1. **`$LOG_DIR/dispatch.jsonl`** (`scripts/monitor.sh:341-384`, `emit_dispatch_jsonl`) — one record **per dispatch only** (not per transition), fields `ts, agent, command, state, state_age_s, detection, queue, queue_remaining, pane_tail` (last 10 non-blank pane lines as a JSON array via `pane_tail_json`, `scripts/monitor.sh:329-338`). The host-server's own dispatch path (`dispatchTaskToAgent`, `host-server/index.ts:471-524`) writes a matching-shape record with `detection` values like `"immediate-enqueue"` / `"idle-transition-poll"`. Since dispatch only happens on an idle transition *with a queued task*, most transitions (busy→awaiting, awaiting→busy, idle→busy, busy→stalled, any transition on an agent with an empty queue) never produce a `dispatch.jsonl` record at all.
2. **`$CONDUCTOR_LOG_DIR/hooks.jsonl`** (`hooks/lib/write-state.js:73-86`) — one record **per Claude Code lifecycle hook fire**, fields `ts, agent, event, prev_state, new_state`. This only covers the two states hooks themselves know about (`idle`/`busy`) and only fires for a hooked Claude Code agent — no pane snapshot, no reasoning, silent for Aider/Codex/hookless agents and for the richer states (`awaiting`, `stalled`, `exited`) that only the pane-reading detectors compute.
3. **`logs/observability.jsonl`**, event `status_transition` (`host-server/index.ts:2392-2400`, inside `pollAndDiff`) — fires on **every** state change the host-server's 2s poll observes (all state pairs, not just idle-related ones), but the payload is only `{ agentId, agent, previousState, nextState }`. No pane text, no detection method, no age, no matched pattern — exactly the fields this research topic is asking for are the ones this record is missing.

The two independent detectors that decide state already compute — and then discard — everything needed:
- **`monitor.sh`'s `is_idle()`** (`scripts/monitor.sh:135-292`) sets three globals per call before returning: `LAST_DETECTION` (`state-file` / `busy-recovered` / `pane-dead` / `regex`), `LAST_STATE_VALUE`, `LAST_STATE_AGE`. These are only read afterward by `emit_dispatch_jsonl` (dispatch-time only) and by a plain-text `log "$name — idle detected (detection=... state=... age=...)"` line on the idle path only — not written anywhere for the busy/awaiting/stalled paths, and never paired with a pane snapshot in the same record.
- **`host-server`'s `detectAgentStatus()`** (`host-server/state.ts:314-423`) internally branches on state-file value + age vs. `busyPattern`/`awaitingPattern`/`idlePattern` matches (via `grepMatches`) and a memoized 15-line pane tail (`tail5()`), but returns only the final state string — none of the intermediate branch taken, pattern matched, or tail text is returned to the caller. `pollAndDiff` (`host-server/index.ts:2357-2401`) does have the 15-line tail already captured earlier in the same tick (`buildSnapshot`'s `tail15`, `host-server/index.ts:2298`) but does not thread it into the `status_transition` log call.

A dedicated wiki page already documents the general local-observability landscape: `wiki/knowledge/concepts/local-observability.md` lists `dispatch.jsonl`/`hooks.jsonl`/`observability.jsonl` as "the current useful surfaces" and separately flags "agent status transitions" as one of the signal types written to `observability.jsonl` — but that page describes the aggregate `statusTransitions` *counter* (`liveUpdateMetrics.statusTransitions[key]++`) and the existing thin `status_transition` event, not a snapshot-bearing transition log.

**This exact gap was already identified once and not built.** `raw/research/application-latency-structure/index-2.md` (2026-07-04, still the live, un-superseded research on this exact area) has a finding **F7 — "Observability should include state-transition evidence"** recommending an `agent-status-transition` JSONL stream with `agent id/window, previous/current status, reason (state-file/busy-recovered/awaiting-pattern/pane-dead/regex-fallback/inventory-timeout), state file age, pattern profile (claude/codex/custom), whether a pane capture was needed, detection duration`. Reading the current code (above) confirms **F7 was never implemented** — `status_transition` still only carries 4 bare fields, more than two months later. F7 itself, notably, still stopped short of the pane-text snapshot the user is now asking for — it proposed the *reasoning metadata* but not the *raw terminal text* alongside it.

`BUG-0001` (`wiki/work/bugs/0001-false-idle-during-subagent-wait.md`, filed 2026-08-15, still `in-progress` as of 2026-09-04) is the concrete cost of this gap: an agent was transiently misread as idle while genuinely mid-turn, and diagnosing it required manually re-deriving what the pane looked like at the moment of the false transition from scattered sources, because no single log record captured state+reason+pane-text together at that instant.

## Key Findings

- **F-1**: None of the three existing logs is keyed to "one record per transition, all states, with pane text and reasoning together" — `dispatch.jsonl` is dispatch-scoped (idle-only, task-gated), `hooks.jsonl` is hook-scoped (idle/busy-only, Claude-only), `observability.jsonl`'s `status_transition` is transition-scoped but reason/snapshot-free. *(codebase)*
- **F-2**: Both detectors already compute the exact reasoning fields needed (`LAST_DETECTION`/`LAST_STATE_VALUE`/`LAST_STATE_AGE` in bash; the state-file/age/pattern branches inside `detectAgentStatus` in TS) and already have a pane tail in hand at the same call site — this is a **wiring problem, not a missing-capability problem**. No new pane captures are needed on the host-server side since `buildSnapshot` already captures `tail15` once per agent per tick and reuses it for both status and mode detection (`host-server/index.ts:2296-2299`); a transition log can reuse that same string at zero extra `capture-pane` cost. *(codebase)*
- **F-3**: `detectAgentStatus` does not currently expose *which* pattern matched or *which* branch fired as part of its return value — only the final state. Any wiring must either widen its return type (e.g. `{ state, reason, matchedPattern? }`) or have `pollAndDiff` recompute the reason redundantly. Widening the return type is the correct fix since the function already has all the information inline at each `return` site. *(codebase, inference)*
- **F-4**: The prior F7 recommendation (reason + pattern-profile + age, no snapshot) was never implemented despite being scoped, dated, and specific — the two-month gap plus BUG-0001's cost suggests low prioritization is not the same as low value; the concrete ask that resurfaced it (this research) additionally wants the pane snapshot F7 omitted. *(codebase / project history)*
- **F-5**: Structured-logging literature converges on treating a state transition as a pairable *start/complete* (or before/after) event with a shared correlation id, not a single flat line — "AgentTrace" (an agent-observability logging framework) formalizes this as `L(S:E:C) → R` with span nesting so "temporal causality across reasoning, tool, and workflow events" is reconstructable, and stores dual JSONL + OpenTelemetry-shaped output for later batch analysis [S6]. Applied here: a transition record that carries **both** the outgoing pane snapshot (what made the detector *leave* the old state) and enough of the new state's pane text is more analyzable than a single after-the-fact snapshot. *(web)*
- **F-6**: General audit-log-for-state-machine guidance agrees a transition log's job is to be the source of truth for later incident reconstruction — "good timestamped logs across services let you reconstruct the sequence and identify the root cause" [S5] — and that structured (JSON, filterable) beats string-formatted logs for this exact "search/aggregate later" use case [S5]. This matches the project's own established convention (JSONL everywhere) so no new format is needed, just a new stream. *(web)*

## Constraints

- **Local-first, no hosted infra** — per `wiki/knowledge/concepts/local-observability.md`, any solution must work as a local JSONL file, not a hosted logging backend. Matches existing `dispatch.jsonl`/`hooks.jsonl`/`observability.jsonl` convention.
- **Never break the agent or the poll loop** — every existing JSONL writer in this codebase is wrapped in try/catch-and-swallow (`hooks/lib/write-state.js`, `appendObservabilityLog` in `host-server/index.ts:432-443`, `emit_dispatch_jsonl`'s `|| true` in `monitor.sh:383`). A new writer must follow the same best-effort convention.
- **Two independent detectors, two languages** — `monitor.sh` (bash) and `host-server/state.ts` (TypeScript) each compute state independently and neither currently emits a rich record for every transition. A complete fix touches both, though the host-server path is the one that already drives `observability.jsonl`'s existing (thin) `status_transition` event and is therefore the lower-effort integration point.
- **No log rotation anywhere in this repo** — `dispatch.jsonl`/`hooks.jsonl`/`observability.jsonl` are all unbounded-growth by explicit prior convention (noted in `TASK-119-persist-metrics-snapshots.md`: "this repo doesn't rotate any of its host-side logs today"). A pane-snapshot-bearing log is the largest-per-record log yet (a 15-line pane tail vs. 4 short fields) — this raises the growth-rate stakes of that existing convention without a task deciding to change it.
- **Sensitive pane content** — prior research (`application-latency-structure/index-2.md` Constraints) already flagged that "logs may contain prompts, pane tails, paths, model/session metadata, and task commands" and recommended sensitive fields stay opt-in/redacted. A pane-snapshot transition log is exactly this risk surface at higher volume than the existing dispatch-only pane capture.
- **`detectAgentStatus`'s return type is part of its public contract** — it's imported and called from multiple sites in `host-server/index.ts` (status snapshot, mode detection reuse). Widening its return shape needs updating all call sites, not just `pollAndDiff`.

## Solution Comparison

| Criteria | A. Extend existing `status_transition` event in-place | B. New dedicated `transitions.jsonl` stream | C. Full session/turn tracing (AgentTrace-style spans) |
|----------|----------|----------|----------|
| **Approach** | Add `reason`, `matchedPattern`, `stateAgeS`, `paneTail` fields to the existing `appendObservabilityLog('status_transition', …)` call | New `appendFileSync` writer (mirroring `dispatch.jsonl`'s shape) dedicated to transitions, written from the same `pollAndDiff` site plus a bash-side equivalent in `monitor.sh` | Wrap each Claude Code turn (hook Start→Stop) and each detected state segment as a span with start/end pane snapshots, trace/span ids |
| **Pros** | Near-zero new code; reuses `tail15` already in hand; single log to grep | Keeps `observability.jsonl` lean (perf/timing focus) vs. a data-heavy log meant for a different audience (detection-logic analysis); easy to point a future analysis script at one file; can be added to `scripts/collect-diagnostics.sh` bundle immediately | Richest causal reconstruction (matches F-5's span-nesting recommendation); best long-term fit if agent-behavior analytics becomes a bigger feature |
| **Cons** | Mixes a large, occasionally-sensitive field (pane text) into the same file as small perf-metric events, likely fastest to hit "unbounded growth" pain since `observability.jsonl` also carries `metrics_snapshot` at a steady cadence | One more log file to teach `collect-diagnostics.sh`/README about; still bash+TS duplication unless `monitor.sh`'s dispatch-time path is also updated | Substantial new design/instrumentation work; overkill for the stated need ("analyze transitions to improve detection logic"); no existing span/trace-id concept in this codebase to build on |
| **Complexity** | Low | Low–Medium | High |
| **Dependencies** | None | None | None (still just JSONL) but needs a new id-correlation convention |
| **Codebase fit** | Strong (matches F7's original framing) | Strong (matches `dispatch.jsonl` precedent of a dedicated single-purpose log) | Weak today — no existing span/trace primitive to extend |
| **Maintenance** | Low | Low | Medium — spans need start/end pairing discipline everywhere |

## Recommendation

**Recommended approach: B — a new `logs/transitions.jsonl` stream**, populated primarily from the host-server's `pollAndDiff` (since it already runs every 2s across all agents, all state pairs, and already has `tail15` in hand at zero extra `capture-pane` cost), with a matching bash-side emitter added to `monitor.sh`'s `is_idle()` call sites so the fallback/regex-only detection path (used when hooks are absent, e.g. Codex/Aider) is covered too.

**Why not A**: `observability.jsonl` is explicitly the perf/timing surface per `wiki/knowledge/concepts/local-observability.md` (`slow_loop`, `tmux_timeout`, `metrics_snapshot`, `terminal_ws_open/close`). Folding a pane-text-bearing, detection-logic-analysis-oriented record into the same append-only file makes both harder to consume: a script tailing `observability.jsonl` for perf regressions would also need to filter out multi-line pane snapshots, and vice versa.

**Why not C**: The stated goal is "analyze the to/from transition and the pane snapshot to improve the transition logic" — a flat per-transition record with reason + snapshot already gives an analyst everything needed to ask "why did this go busy→idle here, what did the pane say, was the pattern right." Full span/trace causality is solving a broader problem (whole-turn reconstruction) this topic didn't ask for, and there is no existing span/trace-id primitive in the codebase to build it on cheaply.

### Proposed record shape (`logs/transitions.jsonl`, one line per detected change)

```json
{
  "ts": "2026-09-13T18:04:22.101Z",
  "agentId": 7,
  "agent": "cryptwiz-1",
  "window": "cryptwiz-1",
  "from": "busy",
  "to": "idle",
  "detector": "host-server" ,        // or "monitor.sh"
  "reason": "state-file",            // state-file | busy-recovered | pane-dead |
                                       // regex-fallback | awaiting-pattern |
                                       // inventory-timeout | hook-event
  "matchedPattern": "idlePattern",    // which of busy/idle/awaiting matched, if any
  "agentType": "claude",             // claude | codex | custom — profileForAgent()
  "stateFileAgeS": 31.2,
  "hadWindow": true,
  "paneTail": ["...", "..."],        // reuse the already-captured 15-line tail15/pane_tail5, as an array of lines
  "queuedTasks": 2
}
```

### Implementation outline

1. **Widen `detectAgentStatus`'s return** (`host-server/state.ts:314`) from a bare `AgentRunState` string to `{ state: AgentRunState, reason: string, matchedPattern?: string }` (or an out-parameter object mutated at each `return` site) — every existing `return 'idle'`/`return 'busy'`/etc. site already knows exactly which branch it took; this is a mechanical change, not new logic.
2. **Update all call sites** in `host-server/index.ts` (`buildSnapshot`, any other caller) to accept the widened shape; keep `state.agentStatuses[].state` unchanged for the existing snapshot/SSE contract — only the new transition-logging call site needs the extra fields.
3. **Add a `appendTransitionLog(...)` writer** next to `appendObservabilityLog` (`host-server/index.ts:432`), same try/catch/mkdir/appendFileSync pattern, writing to `logs/transitions.jsonl`. Call it from `pollAndDiff` (`host-server/index.ts:2392`) alongside (not instead of) the existing `appendObservabilityLog('status_transition', …)` call — keep the counter/perf event as-is for backward compatibility with anything already parsing it, and add the new richer log as an addition.
4. **Reuse `tail15`** already computed in `buildSnapshot` (`host-server/index.ts:2298`) for the `paneTail` field — thread it (or the specific agent's slice of it) through to `pollAndDiff`'s transition-detection block rather than re-capturing.
5. **Mirror on the bash side**: in `scripts/monitor.sh`, add a `emit_transition_jsonl` sibling to `emit_dispatch_jsonl` (same `pane_tail_json` helper, reusing `LAST_DETECTION`/`LAST_STATE_VALUE`/`LAST_STATE_AGE`), called from every branch of `is_idle()` that changes `LAST_STATE_VALUE` from what a per-agent "previous value" tracker (a new associative array, e.g. `PREV_STATE[name]`) last saw — not just the currently-logged idle path.
6. **Document the new log** in `CLAUDE.md`/`AGENTS.md`/`README.md`'s log-file tables (matching the existing `dispatch.jsonl`/`hooks.jsonl` rows) and add it to `scripts/collect-diagnostics.sh`'s bundled-files list (currently `observability.jsonl, hooks.jsonl, dispatch.jsonl`).
7. **Config**: no new `conductor.conf` tunable is strictly required (reuses `LOG_DIR`/`CONDUCTOR_LOG_DIR`), but if pane-snapshot capture is judged sensitive enough to be opt-out, follow the existing conf-comment convention (see `USAGE_CHECK_CMD`/`PENDING_AGENT_STALE_S` blocks) with something like `TRANSITION_LOG_PANE_LINES=15` (0 disables snapshot capture, keeping only the reason/metadata fields).

### Risks and mitigations

- **Growth rate**: a 15-line pane snapshot per transition is the largest-per-record log in the repo. Mitigate by capping the snapshot to the same 15 non-blank lines already captured for detection (no extra capture cost) rather than a full-screen dump, and by explicitly noting the growth rate in a code comment (matching the precedent set in `TASK-119`) rather than adding rotation logic out of scope.
- **Sensitive content**: pane text can contain file paths, prompts, or task output. This project already accepts this risk for `dispatch.jsonl`'s `pane_tail` field at dispatch time; extending the same acceptance to transitions is consistent, but flag it explicitly in the log's own doc comment per the prior research's Constraints section (`application-latency-structure/index-2.md`).
- **Double bookkeeping (bash + TS)**: the two detectors already duplicate logic (see `conductor/usage-check-and-detection-bugs` memory for a bug class this caused before, e.g. the `AWAITING_PATTERN` `\?` landmine). Keep the two `emit_transition_jsonl`/`appendTransitionLog` implementations field-identical so a downstream analysis script doesn't need per-detector parsing branches — write a short shared JSON schema comment in both files pointing at each other.
- **Return-type widening ripple**: widening `detectAgentStatus`'s signature touches every call site; do this as a single isolated commit/task so a `tsc` failure surfaces every missed site before the transition-logging code is added on top.

### Alternative if constraints change

If pane-snapshot volume genuinely becomes a problem (e.g. disk growth complaints), fall back to **Option A's lighter fields only** (reason/pattern/age, no pane text) as an interim step — this alone would have resolved F7 and given BUG-0001-class investigations most of their value, just without the raw terminal evidence.

## Next Steps

- `/task-add Add a transitions.jsonl log capturing from/to state, detection reason, matched pattern, and pane snapshot for every agent status change (host-server pollAndDiff + monitor.sh is_idle)`
- `/task-add Widen detectAgentStatus's return type to expose detection reason and matched pattern alongside the resolved state`
- Consider closing the loop on `BUG-0001` by re-running its repro once `transitions.jsonl` exists — it would have made the false-idle window directly visible in a single record instead of requiring cross-referencing multiple logs.
