---
id: BUG-0013
aliases: [BUG-0013]
title: "Agent shown as 'waiting for input' while still thinking (mismatched status transition)"
status: in-progress
severity: critical
priority: P0
created: 2026-09-19
updated: 2026-09-20
reporter: David Taylor
assignee: David Taylor
tags: dashboard, status-detection, host-server, monitor
impact: "Every agent on every project. The dashboard badge flips to 'waiting' and shows the Interact CTA while the agent is working, and monitor.sh treats an agent marked awaiting as not-idle, so queued tasks are held back until the offending line leaves the last 8 pane lines. In logs/transitions.jsonl (2026-09-13 to 2026-09-20), 178 of 329 transitions into awaiting had no dialog footer on screen, and 21 had 'esc to interrupt' visible (agent demonstrably still working). No data loss."
workaround: "None known."
linked_task: "[[TASK-0231]]"
---

# BUG-0013 — Agent shown as 'waiting for input' while still thinking (mismatched status transition)

## Environment

- OS: macOS (Darwin 25.3.0)
- App: tmux-conductor @ `6957b9c` (main branch, working tree had uncommitted changes at time of report)
- Runtime: host-server (Fastify) + React dashboard
- Config: default `conductor.conf`, no overrides mentioned

## Steps to Reproduce

The trigger has not been identified; these steps record only what was observed.

1. Have an agent running a turn (its tmux pane shows it thinking).
2. Watch that agent's status badge on the dashboard.
3. Intermittently the badge changes to "waiting" even though the agent is still thinking.

## Expected Behavior

The agent's status stays `busy` for the whole turn while its pane shows it still working. "Waiting" appears only when the agent is genuinely blocked on a prompt or dialog.

## Actual Behavior

The dashboard marks the agent as waiting for input while the agent is still thinking. Reported 2026-09-19 as "another" occurrence of a mismatched agent status transition; no pane text, agent name, or transition-log record was captured at the time.

## Reproducibility

- **Frequency**: sometimes
- **First seen**: 2026-09-19 (this occurrence; the report calls it "another" mismatch, earlier instance not recorded)
- **Last seen**: 2026-09-19
- **Notes**: no known trigger. Next occurrence: capture the agent name, the last non-blank pane line, and the matching `to: awaiting` record in `logs/transitions.jsonl` before the status changes again.

## Root Cause Analysis

Root-caused during triage on 2026-09-20 from `logs/transitions.jsonl` (2026-09-13 to 2026-09-20) plus a read of the detection code. Three defects combine:

1. **`scripts/monitor.sh:248-256` (busy case) and `:296-305` (idle case) test `AWAITING_PATTERN` with no `BUSY_PATTERN` guard.** A visibly working agent (pane shows `esc to interrupt`) is written to its state file as `awaiting` whenever any line in the last 8 non-blank pane lines matches the pattern. Evidence: 21 `busy -> awaiting` records with reason `state-file` had `esc to interrupt` in the recorded tail and no dialog footer; false episodes lasted a median of 8 s, max 29 s.
2. **`host-server/state.ts:473-480` reports `awaiting` from the state file with no busy check.** Its busy branch does guard (`state.ts:437`, `!grepMatches(busyPattern, tail)`), but the `state === 'awaiting'` branch only checks whether the pattern still matches, so the false state persists for as long as the offending line stays in the tail. The monitor's own revert (`monitor.sh:316-330`) has the same blind spot.
3. **`AWAITING_PATTERN`'s `\?\s*$` and `>\s*$` alternatives (`conductor.conf:100`) run over the last 8 lines, not the last non-blank line.** CLAUDE.md documents last-non-blank-line matching, and the comment at `state.ts:438` says so too, but `matchesAwaiting` does `tail.split('\n').slice(-8)` and monitor.sh uses `tail -8`. Any of these lines therefore counts as a prompt: HTML comments in file output (`### 1. Implement the fix <!-- agent: general-purpose -->`), assistant prose ending in `?`, typed input ending in `?`, `⎿ Interrupted · What should Claude do instead?`, and slash-command argument-hint placeholders (`❯ /research <topic or question to research>`).

Scale: 329 transitions into `awaiting` in the log, 178 (54%) with no dialog marker in the last 8 lines. Breakdown of the non-dialog `awaiting-pattern` rows by origin state and matching alternative: idle via `>` 50, idle via `?` 32, busy via `?` 55, busy via `>` 6, stalled 4.

Because monitor.sh returns "not idle" for an `awaiting` state file, the same false positives also stop queued-task dispatch to an otherwise idle agent (secondary impact, not previously reported).

Fix direction (not yet implemented): guard the awaiting checks in `monitor.sh` and the `awaiting` branch in `state.ts` with `BUSY_PATTERN`; match the awaiting alternatives against the last non-blank line only (or a bounded window that excludes the input box and slash-hint line); add regression tests to `state.test.ts` and `scripts/verify-*.sh`. Corrects the plausible-cause list: the trigger the report could not identify is a line-content match, not a timing race.

## Resolution

> Filled in on close — see `/bug-close`.

## Related

- `relates_to::[[BUG-0001]]` — same status-detection area (false idle while a background sub-agent runs); this bug is the false-awaiting counterpart. Neither blocks the other.
- Evidence source: `logs/transitions.jsonl` (`to: awaiting` records with `paneTail`).
