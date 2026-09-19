---
topic: "Exact mapping of every return site inside detectAgentStatus onto a DetectionReason value, for TASK-142"
slug: detect-agent-status-reason-mapping
researched: 2026-09-13
---

# Primary Sources — detectAgentStatus return-site → DetectionReason mapping

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/state.ts::detectAgentStatus` (lines 313-422, read via `mcp__serena__find_symbol` with `include_body=true`) | 2026-09-13 | Full function body confirming exactly 18 `return` statements and their branch conditions |
| S2 | codebase | `wiki/work/tasks/TASK-142-widen-detect-agent-status-reason.md` | 2026-09-13 | The task's example `DetectionReason` union (8 values) and Acceptance Criteria's 7-name prose list |
| S3 | codebase | `wiki/work/tasks/TASK-143-host-server-transitions-jsonl.md` | 2026-09-13 | Confirms the consumer treats `reason` as an opaque pass-through string, not branching on specific values |
| S4 | codebase | `raw/research/transition-observability/index.md` | 2026-09-13 | Prior, independently-written research proposing the same 8-value reason vocabulary (including `inventory-timeout`) before TASK-142 existed — resolves the ambiguity over whether `inventory-timeout` is real |

## Excerpts

### S4 — raw/research/transition-observability/index.md
`raw/research/transition-observability/index.md`, "Proposed record shape" section
> "reason": "state-file",            // state-file | busy-recovered | pane-dead |
>                                      // regex-fallback | awaiting-pattern |
>                                      // inventory-timeout | hook-event

### S2 — TASK-142's Approach section
`wiki/work/tasks/TASK-142-widen-detect-agent-status-reason.md`
> ```ts
> export type DetectionReason =
>   | 'no-window' | 'exited' | 'starting'
>   | 'state-file' | 'busy-recovered' | 'awaiting-pattern'
>   | 'regex-fallback' | 'inventory-timeout';
> ```

### S1 — detectAgentStatus body (key excerpt: the three unlabeled sites)
`host-server/state.ts::detectAgentStatus`
> ```ts
> if (state === 'idle') {
>   const tail = tail5();
>   if (tail !== '' && busyPattern && grepMatches(busyPattern, tail)) return 'busy';
>   if (matchesAwaiting(tail)) {
>     return 'awaiting';
>   }
>   return 'idle';
> }
> ```
