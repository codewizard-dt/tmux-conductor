---
topic: "Exact mapping of every return site inside detectAgentStatus onto a DetectionReason value, for TASK-142"
slug: detect-agent-status-reason-mapping
researched: 2026-09-13
sources: [./sources.md]
---

# Research: detectAgentStatus return-site → DetectionReason mapping

> `detectAgentStatus` (`host-server/state.ts:313-422`) has 18 distinct `return` statements, not the ~13 a first-pass read suggested. TASK-142's Approach section gives an example `DetectionReason` union of 8 values (`no-window | exited | starting | state-file | busy-recovered | awaiting-pattern | regex-fallback | inventory-timeout`) but its Acceptance Criteria prose only names 7 of them, and three return sites (the idle→busy busy-pattern override, the awaiting→busy dialog-gone revert, and the plain unmodified state-file fallthroughs) have no explicit doc-comment label at all. Cross-referencing the prior `transition-observability` research (which independently proposed the same 8-value reason list, including `inventory-timeout`, before TASK-142 existed) resolves the ambiguity: `inventory-timeout` is real and maps to the `stalled` branch, and the three unlabeled sites should all fall back to the generic `state-file` reason, distinguished from each other only by `matchedPattern`.

## Research Questions

- How many `return` sites does `detectAgentStatus` actually have, and what is each one's exact branch condition?
- Which `DetectionReason` value does each site map to, given the task's own example union and its Acceptance Criteria's 7-name list?
- Is `inventory-timeout` a real required reason value (for the `stalled` branch) or just illustrative cruft the AC list correctly omitted?
- How should the three doc-comment-unlabeled branches (idle→busy pattern override, awaiting→busy dialog-gone revert, plain state-file fallthrough) be named?
- Is the AC's 7-name list exhaustive, or can/should more values than 7 be used as long as they're derived from real branches?

## Current State (Codebase)

`detectAgentStatus` (`host-server/state.ts:313-422`, read in full via `mcp__serena__find_symbol` with `include_body=true`) contains exactly **18** `return` statements across 4 top-level precedence branches (per its own doc comment, lines ~279-313): no-window, exited/pane-dead, hook-written state-file (with several refinements), and capture-pane regex fallback.

TASK-142 (`wiki/work/tasks/TASK-142-widen-detect-agent-status-reason.md`) widens the return type to `{state, reason, matchedPattern?}`, with an **example** type:
```ts
export type DetectionReason =
  | 'no-window' | 'exited' | 'starting'
  | 'state-file' | 'busy-recovered' | 'awaiting-pattern'
  | 'regex-fallback' | 'inventory-timeout';
```
Its Acceptance Criteria separately says reason values must "match the branch names already documented in the function's own doc comment (state-file, busy-recovered, pane-dead/exited, regex-fallback, awaiting-pattern, no-window, starting)" — 7 names, `inventory-timeout` absent. TASK-143 (`wiki/work/tasks/TASK-143-host-server-transitions-jsonl.md`) is the consumer: it threads `reason`/`matchedPattern` into a new `logs/transitions.jsonl` record and cites this same research area.

## Key Findings

- **F-1**: The prior `transition-observability` research (`raw/research/transition-observability/index.md`, 2026-09-13, written *before* TASK-142/143 were created from its Next Steps) independently proposed the exact same reason vocabulary, in a code-comment enum on its proposed `transitions.jsonl` record: `state-file | busy-recovered | pane-dead | regex-fallback | awaiting-pattern | inventory-timeout | hook-event`. This confirms `inventory-timeout` is a deliberate, real value (not illustrative cruft) — it was proposed independently, before TASK-142's author wrote the task, then carried into TASK-142's own example union. *(codebase — cross-document)*
- **F-2**: Neither the prior research's list nor TASK-142's AC prose explicitly enumerates every one of the 18 return sites. Both documents describe `detectAgentStatus`'s doc comment only at the *top-level branch* granularity (no-window / exited / state-file / regex-fallback), while the state-file branch alone contains 9 of the 18 sites with 3 distinct refinements (`awaiting-pattern`, `busy-recovered` ×2, `inventory-timeout`) plus 6 sites with no distinct label at all. *(codebase, inference)*
- **F-3**: The 3 unlabeled sites are: (a) `state==='idle'` block overridden to `'busy'` when `busyPattern` matches the tail (mirror-image of the labeled `awaiting-pattern` override, but for the busy pattern instead); (b) `state==='awaiting'` block reverted to `'busy'` when the dialog footer is gone (`!matchesAwaiting(tail)`); (c) the three plain fallthroughs where the state-file's own value is returned completely unmodified (busy stays busy, awaiting stays awaiting, idle stays idle). None of these three appear as a distinct name in either document's reason vocabulary. *(codebase, inference)*
- **F-4**: TASK-142's own Approach text explicitly names only 2 of the refinements as illustrative examples of the mechanical rule ("e.g. the busy-recovered codex/hook-failure branches use reason: 'busy-recovered'; the plain regex-fallback tail... uses reason: 'regex-fallback'") — it does not claim to enumerate all 18 sites, and does not forbid reusing a reason value across multiple structurally-similar sites. *(codebase)*
- **F-5**: `matchedPattern` is typed as optional and constrained to exactly `'busy' | 'idle' | 'awaiting'` in TASK-142's own example interface — it already carries the "which pattern, if any, fired" information. This means `reason` does not need a distinct value per pattern-match outcome; `matchedPattern` can do that differentiation while `reason` stays at the coarser "which family of logic decided this" granularity. *(codebase, inference)*

## Constraints

- No new detection logic, branches, or `capture-pane` calls — TASK-142 is explicit that this is a mechanical widening of an already-decided value at each existing `return` site.
- The resolved `state` value and all downstream behavior must be byte-for-byte unchanged; only the *shape* of the return value changes.
- `reason` values should stay within the 8-value union already given in TASK-142's Approach section (adding a 9th, e.g. a `busy-pattern` name for finding F-3a, would exceed what either grounding document's vocabulary supports and isn't necessary given `matchedPattern` already disambiguates it).

## Recommendation

**Use exactly the 8-value union already given in TASK-142's Approach section**, mapping all 18 return sites as follows (site descriptions in execution order):

| # | Branch / condition | `reason` | `matchedPattern` |
|---|---|---|---|
| 1 | `!hasWindow` | `'no-window'` | — |
| 2 | `paneCurrentCommand` explicit shell-check → exited | `'exited'` | — |
| 3 | `isPaneDead(...)` fallback → exited | `'exited'` | — |
| 4 | state-file `'busy'` → `matchesAwaiting(tail)` true | `'awaiting-pattern'` | `'awaiting'` |
| 5 | state-file `'busy'` → codex safety net recovers to idle | `'busy-recovered'` | `'idle'` |
| 6 | state-file `'busy'` → hook-failure safety net recovers to idle | `'busy-recovered'` | `'idle'` |
| 7 | state-file `'busy'` → stall timeout, no pattern matches | `'inventory-timeout'` | — |
| 8 | state-file `'busy'` → unmodified fallthrough | `'state-file'` | `'busy'` |
| 9 | state-file `'awaiting'` → dialog gone, reverts to busy | `'state-file'` | — |
| 10 | state-file `'awaiting'` → dialog persists | `'state-file'` | `'awaiting'` |
| 11 | state-file `'idle'` → `busyPattern` override to busy | `'state-file'` | `'busy'` |
| 12 | state-file `'idle'` → `matchesAwaiting(tail)` true | `'awaiting-pattern'` | `'awaiting'` |
| 13 | state-file `'idle'` → unmodified fallthrough | `'state-file'` | `'idle'` |
| 14 | regex fallback, empty tail | `'starting'` | — |
| 15 | regex fallback, `busyPattern` matches | `'regex-fallback'` | `'busy'` |
| 16 | regex fallback, `matchesAwaiting(tail)` true | `'regex-fallback'` | `'awaiting'` |
| 17 | regex fallback, `idlePattern` matches | `'regex-fallback'` | `'idle'` |
| 18 | regex fallback, final fallthrough (no pattern matched) | `'regex-fallback'` | — |

**Rationale for the 3 previously-ambiguous cases**:
- Sites 7 (`stalled`) → `'inventory-timeout'`: confirmed real by F-1 (independently proposed in the prior research before this task existed).
- Sites 9 and 11 (the two unlabeled pattern-driven state-file overrides not given their own name) → `'state-file'`, differentiated by `matchedPattern`. This keeps the reason vocabulary at exactly the 8 values both grounding documents already agree on, rather than inventing a 9th (`'busy-pattern'`) that appears nowhere in either source.
- Sites 8, 10, 13 (unmodified fallthroughs) → `'state-file'` with `matchedPattern` set to the value that was already true of the file (`'busy'`/`'awaiting'`/`'idle'`) for symmetry with the override sites, even though no pattern *check* was involved in producing them — this is metadata only and doesn't add logic.

**Keep `inventory-timeout` in the union** (do not drop it) — it is required for the `stalled` return site, which has no other suitable value. The AC's 7-name list is not exhaustive; it is illustrative prose that a task author wrote without walking all 18 return sites individually, and should not be read as a hard whitelist that excludes `inventory-timeout`.

### Risks and mitigations

- **Risk**: A future reader might expect `reason` to disambiguate every override the same way `awaiting-pattern` does, and be surprised that `busy`-pattern overrides fall under the generic `'state-file'` bucket instead of a symmetric `'busy-pattern'` name. **Mitigation**: this is intentional — flagged here and should be flagged with a short inline code comment at that return site referencing this research, so TASK-143's consumer and future maintainers aren't confused.
- **Risk**: TASK-143 (the consumer) hard-codes an assumption about which reason values exist. **Mitigation**: TASK-143's own Approach section already treats `reason` as an opaque pass-through string it logs verbatim — it does not branch on specific reason values, so this mapping doesn't constrain it further.

## Next Steps

- Proceed with TASK-142 Step 2 (widen the return type) using the table above verbatim at each of the 18 return sites.
- No follow-on `/task-add` needed — this resolves an implementation ambiguity within an already-scoped task rather than surfacing new work.
