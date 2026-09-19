---
id: detect-agent-status-reason-mapping
title: "detectAgentStatus Return-Site to DetectionReason Mapping"
aliases: [DetectionReason Mapping]
source: ../../raw/research/detect-agent-status-reason-mapping/index.md
researched: 2026-09-13
tags: [host-server, observability, state, roadmap-019]
---

# detectAgentStatus Return-Site → DetectionReason Mapping

Source: [raw/research/detect-agent-status-reason-mapping/index.md](../../raw/research/detect-agent-status-reason-mapping/index.md)

`detectAgentStatus()` (`host-server/state.ts:313-422`) has **18** distinct `return` statements, not the ~13 a first-pass read suggested. TASK-142 widens its return type to `{state, reason, matchedPattern?}`; this research resolves which of the 8 example `DetectionReason` values (`no-window | exited | starting | state-file | busy-recovered | awaiting-pattern | regex-fallback | inventory-timeout`) each of the 18 sites should use, since neither the task's Acceptance Criteria prose (which names only 7) nor the doc comment individually enumerates every site.

Key resolutions:
- **`inventory-timeout` is real**, mapped to the `stalled` return site — confirmed because the prior, independently-written [Observability for Agent Status Transitions](transition-observability.md) research proposed the identical 8-value vocabulary (including `inventory-timeout`) before TASK-142 existed, ruling out that it was illustrative cruft AC correctly dropped.
- **Three return sites have no doc-comment label at all**: the idle→busy override via `busyPattern`, the awaiting→busy revert when the dialog closes, and the three plain unmodified state-file fallthroughs. All three fall back to the generic `'state-file'` reason, differentiated only by `matchedPattern` — rather than inventing a 9th reason value not supported by either grounding document.
- The full 18-row mapping table lives in the source report.

relates_to::[[Agent State Determination]]
relates_to::[[Observability for Agent Status Transitions]]
