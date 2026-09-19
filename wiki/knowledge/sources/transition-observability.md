---
id: transition-observability
title: Observability for Agent Status Transitions
updated: 2026-09-18
sources:
  - ../../raw/research/transition-observability/index.md
confidence: extracted
tags: [observability, logging, agents, state, debugging]
---

# Observability for Agent Status Transitions

tmux-conductor writes several append-only JSONL logs (`dispatch.jsonl`, `hooks.jsonl`, `observability.jsonl`), none of which alone captured a full per-transition record — one line pairing `from`/`to` state with *why* the detector decided that and *what the pane looked like* at that moment. `dispatch.jsonl` only fires on dispatch (idle-with-a-queued-task only); `hooks.jsonl` only covers hook-driven idle/busy for Claude Code agents; `observability.jsonl`'s `status_transition` event fires on every state change but carries only `{agentId, agent, previousState, nextState}` — no reason, no pattern, no pane text. This was the gap `transitions.jsonl` (below) was built to close.

**This is a wiring gap, not a missing-capability gap.** Both independent detectors — `monitor.sh`'s `is_idle()` (bash) and `host-server/state.ts`'s `detectAgentStatus()` (TypeScript) — already compute exactly the needed reasoning (`LAST_DETECTION`/`LAST_STATE_VALUE`/`LAST_STATE_AGE` globals; internal state-file/age/pattern branches) and often already have a pane tail in hand at the same call site, but discard it after using it to decide true/false. `host-server`'s `buildSnapshot` already captures a 15-line pane tail once per agent per tick for status+mode detection — a transition log can reuse that same string at zero extra `capture-pane` cost.

**This exact gap was identified once before it was finally closed.** Finding F7 of `application-latency-structure/index-2.md` (2026-07-04) proposed an `agent-status-transition` JSONL stream with reason/pattern-profile/age fields — but stopped short of the pane-text snapshot. As of 2026-09-13 the gap was still open, over two months after F7. `BUG-0001` (a false busy→idle read while an agent was mid-turn waiting on a background sub-agent) was the concrete cost of the gap: diagnosing it required cross-referencing multiple logs because no single record captured state+reason+pane-text together at the moment of the false transition.

**The fix has since shipped as ROADMAP-019 (TASK-143/TASK-144), and it matches the originally recommended design.** Re-confirmed live against `CLAUDE.md`'s "Unified transition observability (ROADMAP-019)" paragraph and the code on 2026-09-18: a `logs/transitions.jsonl` stream is emitted from two independent paths that both reuse an already-captured pane tail at zero extra `capture-pane` cost.

- **Primary (hook-based signal):** `host-server`'s `pollAndDiff` (`host-server/index.ts:2419` `lastDetectionByAgentId` side-channel, consumed at the `appendTransitionLog` call around `host-server/index.ts:2580`) fires on every polled state change across all agents, with a pane tail already in hand from `buildSnapshot`.
- **Mirror (regex-fallback signal):** `monitor.sh`'s poll loop (`scripts/monitor.sh:22` declares `TRANSITION_LOG`; `emit_transition_jsonl` at `scripts/monitor.sh:435-541`) diffs each tick's `LAST_STATE_VALUE` against the previous tick's per-agent state (`PREV_TRANSITION_STATE`) and emits the same JSONL stream for the hookless/regex-fallback path monitor.sh alone can see.

This keeps the existing perf-focused `observability.jsonl` uncluttered by large, occasionally-sensitive pane-text payloads while giving analysis passes everything needed to ask "why did this transition happen, and was the pattern right." External structured-logging practice for agent systems (the "AgentTrace" framework) converges on the same shape: pair state changes with causal metadata and store them for later batch analysis rather than as scattered ad hoc log lines.

**The two emitters' records are not the same shape — a permanent, intentional asymmetry, not a bug.** The host-server record carries `agentId`, `agent`, `from`, `to`, `reason`, `matchedPattern`, `stateFileAgeS`, `windowPresent`, `queuedTasks`, `paneTail` (it has the richer per-agent object and diff already built by `buildSnapshot`/`pollAndDiff`). The `monitor.sh` record carries only `agent`, `from`, `to`, `reason`, `stateFileAgeS`, `paneTail` — no `agentId` (bash has no stable numeric agent id in scope at that call site), no `matchedPattern` (the bash `is_idle()` reasoning isn't split into a separate matched-pattern field the way the TypeScript detector's is), and no `windowPresent`/`queuedTasks` (monitor.sh's poll loop doesn't carry those fields at the transition-diff call site). This was previously undocumented on this page. Any downstream consumer reading `transitions.jsonl` as a single stream must treat these four fields as optional/host-server-only rather than assuming a uniform record shape across all lines.

derived_from::[[Agent State Determination]]
relates_to::[[Local Observability]]
relates_to::[[Pane-Idle Detection Cannot See Async Background Agent Work]]
uses::[[Host Server]]
