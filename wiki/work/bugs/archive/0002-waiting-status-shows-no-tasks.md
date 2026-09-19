---
id: BUG-0002
aliases: [BUG-0002]
title: "Agent status badge shows 'no tasks' instead of 'waiting' while blocked on a UAT verdict prompt"
status: closed
severity: high
priority: P2
created: 2026-08-17
updated: 2026-08-26
reporter: David Taylor
assignee: "—"
tags: frontend, dashboard, status-detection
linked_task: "—"
impact: "Affects any agent blocked on a prompt whose last line doesn't match AWAITING_PATTERN's trailing-?/[Y/n]/> shapes (observed with /uat-walk's 'Verdict? P/F/Fix/Skip'), while its queue is empty. Risk: the dashboard's primary needs-attention signal is wrong, so an operator scanning the agent list could miss an agent that is actually blocked waiting on them."
workaround: "None known — operator must open the agent's terminal/log directly to notice it's actually waiting on input, since the badge doesn't reflect it."
---

# BUG-0002 — Agent status badge shows 'no tasks' instead of 'waiting' while blocked on a UAT verdict prompt

## Environment

- OS: macOS (Darwin 25.3.0)
- Browser: Chrome
- App: tmux-conductor dashboard
- Runtime: host-server (Fastify) + `monitor.sh`
- Config: default `conductor.conf`, no overrides mentioned

## Steps to Reproduce

1. Start an agent running `/uat-walk` (a UAT test-case walkthrough) with no other tasks queued for that agent.
2. Let the skill present a test case and prompt for a verdict, ending with the line `Verdict? P/F/Fix/Skip` as the last non-blank line in the pane — the agent is now blocked waiting for the operator to type P/F/Fix/Skip.
3. Observe the agent's status badge on the dashboard while this prompt is showing.

## Expected Behavior

While the agent is blocked on the `Verdict? P/F/Fix/Skip` prompt (waiting on a human decision), the dashboard status badge should read "WAITING", the same as it does for other recognized prompts.

## Actual Behavior

The status badge read "NO TASKS" (the `empty` status, orange) instead of "WAITING", while the terminal/log was actively displaying the `Verdict? P/F/Fix/Skip` prompt and the Queued Tasks panel showed `(0)`. A transient elapsed-time footer readout ("Sautéed for 18s") was also visible at the same time but is not itself the relevant signal — the reporter confirmed the actual indicator that the agent was blocked-on-input is the `Verdict? P/F/Fix/Skip` prompt line, not the elapsed-time text.

Screenshot: `/Users/davidtaylor/Desktop/Screenshot 2026-08-15 at 9.07.34 PM.png`.

## Reproducibility

- **Frequency**: sometimes (reporter believes this likely happens every time this prompt pattern appears, but has not yet systematically verified across multiple occurrences)
- **First seen**: 2026-08-15
- **Last seen**: 2026-08-15

## Root Cause Analysis

`AWAITING_PATTERN` in `conductor.conf` (read by both `scripts/monitor.sh` and `host-server/state.ts`'s `detectAgentStatus`, matched per-line via `grep -qE` against the pane's last 8 non-blank lines) had a `\?\s*$` alternative that only matches a `?` at the **end** of a line. That anchor was itself a deliberate prior fix (see `conductor/usage-check-and-detection-bugs` memory / the comment directly above `AWAITING_PATTERN`): a bare `\?` previously matched a `?` anywhere in the tail, misfiring on git-aware shell prompts' untracked-file indicator (e.g. `repo ?2 ~`, as rendered by powerlevel10k/starship/oh-my-zsh).

`/uat-walk`'s verdict prompt, `Verdict? P/F/Fix/Skip`, has its `?` in the **middle** of the line — the options list trails it on the same line — so neither the trailing-`?` case nor any other existing alternative (`[Y/n]`, `[y/N]`, trailing `>`, the two Claude Code dialog-footer phrases) matched it. With no alternative matching, `detectAgentStatus`/`monitor.sh`'s regex fallback never wrote/reported `awaiting`, and with the queue empty the dashboard fell through to its default "no tasks" (`empty`) badge instead of "WAITING".

## Resolution

Added one alternative to `AWAITING_PATTERN` in `conductor.conf`: `\?\s+[A-Za-z]+(/[A-Za-z]+)+\s*$` — a `?` followed by whitespace and an inline slash-separated option list running to end of line. Requiring whitespace immediately after the `?` and at least one `/` in the trailing token keeps the fix from reopening the git-prompt false positive the trailing-anchor fix was for: `repo ?2 ~` has no space after `?` and no `/`, so it still does not match. `AWAITING_PATTERN` is the single conf-driven source read by both `scripts/monitor.sh` (`agent_awaiting_pattern`'s default case) and `host-server/state.ts` (via `config.ts`'s `awaitingPattern`) — no duplicate hardcoded copy existed to fix separately.

### Verification performed

- `cd host-server && npm run typecheck && npm test` — clean, 101/101 pass, including 3 new cases in `host-server/awaitingPattern.test.ts` (new file) that read the **live** `AWAITING_PATTERN` value out of the repo-root `conductor.conf` via `readConductorConf` and run it through the real `grep -qE` binary — the same call path `monitor.sh`/`state.ts` use — asserting: (1) `Verdict? P/F/Fix/Skip` and a second slash-option example now match, (2) every previously-documented case (bare trailing `?`, `[Y/n]`, bare `>`, the two Claude Code dialog footers) still matches, (3) the git-prompt false positive (`myproject ?2 ~`) and the lowercase busy-spinner text still do NOT match.
- Ad hoc `grep -qE` checks against ~12 additional sample lines (both positive and negative cases) confirmed the same before landing the test file.
- Not verified live in a real tmux session against an actual running `/uat-walk` prompt — the regex-level verification above is considered sufficient given the bug's own root cause was purely a static pattern gap, not a dynamic/timing issue.

## Related

> _(none yet)_
