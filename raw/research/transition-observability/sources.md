---
topic: "how to improve observability/logging of agent status transitions. log a snapshot of the terminal output and the details of the to/from status transition so that it can be analyzed later to improve the transition logic"
slug: transition-observability
researched: 2026-09-13
---

# Primary Sources — Observability for Agent Status Transitions

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `scripts/monitor.sh::is_idle, emit_dispatch_jsonl, pane_tail_json, pane_tail5` | 2026-09-13 | Confirmed `LAST_DETECTION`/`LAST_STATE_VALUE`/`LAST_STATE_AGE` globals are computed per call but only surfaced to `dispatch.jsonl` (dispatch-time only) and a plain-text idle-path log line — never for every transition. |
| S2 | codebase | `host-server/state.ts::detectAgentStatus` (lines 314-423) | 2026-09-13 | Confirmed the TS detector branches on state-file value/age vs. busy/idle/awaiting patterns using a memoized 15-line pane tail, but returns only the final state string — no reason/pattern/tail is exposed to callers. |
| S3 | codebase | `host-server/index.ts::pollAndDiff, buildSnapshot, appendObservabilityLog` (lines 2278-2443) | 2026-09-13 | Confirmed the existing `status_transition` event (`appendObservabilityLog('status_transition', {agentId, agent, previousState, nextState})`) carries no reason/pattern/pane-tail, and that `tail15` is already captured once per agent per tick in `buildSnapshot` at zero extra cost if reused. |
| S4 | codebase | `hooks/lib/write-state.js::writeState` (lines 1-115) | 2026-09-13 | Confirmed `hooks.jsonl` records (`ts, agent, event, prev_state, new_state`) cover only hook-driven idle/busy transitions for Claude Code agents, with no pane snapshot and no reasoning metadata. |
| S5 | codebase | `wiki/knowledge/concepts/local-observability.md` | 2026-09-13 | Confirmed the project's own documented observability surface list (`dispatch.jsonl`, `hooks.jsonl`, `observability.jsonl`) and that `observability.jsonl`'s "agent status transitions" signal is the aggregate counter + thin event, not a snapshot-bearing log. |
| S6 | codebase | `raw/research/application-latency-structure/index-2.md` (Finding F7) | 2026-09-13 | Prior research (2026-07-04) already proposed an `agent-status-transition` JSONL stream with reason/pattern-profile/age fields (no pane snapshot) — confirmed via S2/S3 that this was never implemented, over two months later. |
| S7 | codebase | `wiki/work/bugs/0001-false-idle-during-subagent-wait.md` | 2026-09-13 | Concrete real-world cost of the missing transition-snapshot log: a false busy→idle read had to be diagnosed by cross-referencing multiple logs/sources instead of one transition record. |
| S8 | web | https://arxiv.org/html/2602.10133v1 ("AgentTrace: A Structured Logging Framework for Agent System Observability") | 2026-09-13 | Structured-logging design pattern for agent systems: formalized `L(S:E:C) → R` schema, span-nested start/complete pairing for causal reconstruction, dual JSONL + OpenTelemetry storage for later batch analysis. |
| S9 | web | https://juliofalbo.medium.com/effective-logging-strategies-for-better-observability-and-debugging-4b90decefdf1 | 2026-09-13 | General logging-strategy guidance: timestamped, structured logs across a system let you "reconstruct the sequence and identify the root cause" during incident analysis — supports the recommendation that a per-transition JSONL record (not scattered logs) is the right analysis unit. |

## Excerpts

### S6 — application-latency-structure/index-2.md, Finding F7
`raw/research/application-latency-structure/index-2.md`
> ### F7 - Observability should include state-transition evidence
> Agent status confusion is a UX issue and a latency issue: users wait or interact based on whether the dashboard says `busy`, `awaiting`, `stalled`, or `idle`. Add an `agent-status-transition` JSONL stream or structured log fields:
> - agent id/window
> - previous status/current status
> - reason: `state-file`, `busy-recovered`, `awaiting-pattern`, `pane-dead`, `regex-fallback`, `inventory-timeout`
> - state file age
> - pattern profile: `claude`, `codex`, `custom`
> - whether a pane capture was needed
> - detection duration

### S8 — AgentTrace paper (fetched summary)
https://arxiv.org/html/2602.10133v1
> AgentTrace proposes a formalized logging transformation: "L(S:E:C) → R, where S denotes the surface (cognitive, operational, or contextual), E is the event content, C represents metadata context, and R is a structured record." ... The paper emphasizes capturing "start" and "complete" events for each method invocation, with span nesting enforcing "temporal causality across reasoning, tool, and workflow events." ... The framework stores logs in dual formats (JSONL and OpenTelemetry) to support "batch analytics and visualization."

### S9 — Effective Logging Strategies (Falbo)
https://juliofalbo.medium.com/effective-logging-strategies-for-better-observability-and-debugging-4b90decefdf1
> good timestamped logs across services let you reconstruct the sequence and identify the root cause
