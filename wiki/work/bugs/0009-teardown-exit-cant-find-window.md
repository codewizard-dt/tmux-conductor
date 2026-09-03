---
id: BUG-0009
aliases: [BUG-0009]
title: "teardown.sh's per-agent /exit dispatch can't find the agent's tmux window (uses raw agent name instead of the window-name mapping)"
status: in-progress
severity: medium
priority: P2
created: 2026-09-02
updated: 2026-09-03
reporter: David Taylor
assignee: "—"
tags: scripts, teardown, tmux
linked_task: "—"
---

# BUG-0009 — teardown.sh's per-agent /exit dispatch can't find the agent's tmux window (uses raw agent name instead of the window-name mapping)

## Environment

- OS: macOS (Darwin 25.3.0)
- Runtime: `scripts/teardown.sh` (bash) + `scripts/monitor.sh`'s fleet-wide auto-teardown call site, against a live `conductor` tmux session
- App: tmux-conductor host-side orchestration scripts
- Config: default `conductor.conf`, 5 registered agents in the session, at least one with a project-scoped tmux window name distinct from its agent `name` (e.g. agent name `bootstrap-1` → tmux window `bootstrap-bootstrap-1`, per `agentWindowName`/`AGENT_WINDOW_NAMES`)

## Steps to Reproduce

1. Register at least one agent whose tmux window name differs from its bare agent `name` (any project-scoped agent — `AGENT_WINDOW_NAMES[$name]` maps to something other than `$name`).
2. Trigger `scripts/teardown.sh`, either directly or via `scripts/monitor.sh`'s fleet-wide "all agents idle + usage limit hit" auto-teardown path (`scripts/monitor.sh:477-479` calling `teardown.sh`).
3. Observe `teardown.sh`'s per-agent `/exit` loop output.

Reproduced live 2026-09-02 running UAT-121's UAT-EDGE-002 case against the real `conductor` session (5 registered agents, several project-scoped) by forcing a fleet-wide usage-limit hit.

## Expected Behavior

`teardown.sh` sends `/exit` to each agent's actual tmux window before the session is killed, giving each agent a chance for a graceful shutdown.

## Actual Behavior

`teardown.sh`'s per-agent loop calls `dispatch.sh "$SESSION_NAME:$name"` using the raw `AGENT_NAMES` entry, but the real tmux window for a project-scoped agent is `AGENT_WINDOW_NAMES[$name]` — the exact mapping `monitor.sh`'s main loop and `is_idle()` already resolve (`window_name="${AGENT_WINDOW_NAMES[$name]:-$name}"`) before targeting a pane. `teardown.sh` never applies that mapping, so every project-scoped agent's `/exit` send failed with `can't find window: <name>` during this run — 5 for 5. The subsequent `tmux kill-session` still succeeded regardless (it isn't scoped to individual windows), so the session tears down either way, but no agent ever actually receives `/exit` first.

Log excerpt from the reproducing run:
```
[23:42:11] Sending /exit to bootstrap-1...
can't find window: bootstrap-1
[23:42:11] Sending /exit to cryptwiz-1...
can't find window: cryptwiz-1
...
[23:42:21] Killing tmux session 'conductor'...
```

## Reproducibility

- **Frequency**: always (deterministic for any agent whose tmux window name differs from its bare name)
- **First seen**: 2026-09-02
- **Last seen**: 2026-09-02

## Root Cause Analysis

Confirmed exactly as filed. `teardown.sh`'s per-agent loop (`for name in "${AGENT_NAMES[@]}"`) called `dispatch.sh "$SESSION_NAME:$name"` using the raw agent name straight from `AGENT_NAMES`. `scripts/lib/db.sh`'s `load_agents` also populates a parallel `AGENT_WINDOW_NAMES["$name"]` map (the actual tmux window name, which differs from the bare agent name for any project-scoped agent). `scripts/monitor.sh`'s main loop and `is_idle()` already resolve `window_name="${AGENT_WINDOW_NAMES[$name]:-$name}"` before targeting a pane — `teardown.sh` was the one call site that never applied that mapping, despite already sourcing `db.sh` and having `AGENT_WINDOW_NAMES` populated and in scope.

## Resolution

Added the same `window_name="${AGENT_WINDOW_NAMES[$name]:-$name}"` resolution `monitor.sh` uses, and dispatched to `"$SESSION_NAME:$window_name"` instead of the raw name (`scripts/teardown.sh`, per-agent `/exit` loop). The `:-$name` fallback preserves existing behavior for any agent with no window-name mapping.

### Verification performed

- `bash -n scripts/teardown.sh` — clean.
- Live tmux verification (no automated harness exists for shell scripts in this repo): created a real tmux session with a window named `bootstrap-bootstrap-1` — reproducing a project-scoped agent whose window name differs from its bare agent name (`bootstrap-1`) — and confirmed `dispatch.sh "$SESSION_NAME:bootstrap-1"` (the pre-fix behavior) fails with `can't find window: bootstrap-1`, the exact error from the original report. Then confirmed the fixed resolution logic (`window_name="${AGENT_WINDOW_NAMES[bootstrap-1]:-bootstrap-1}"` → `bootstrap-bootstrap-1`) dispatches successfully against the same session.

### Regression test

Unlike BUG-0004/BUG-0006/BUG-0010 (blocked on `host-server/index.ts` having no HTTP-route test harness), `teardown.sh` is self-contained shell driving real tmux — so a repeatable regression test was buildable without new infrastructure. Added `scripts/verify-teardown-window-mapping.sh`: creates a scratch SQLite DB (schema-only, no backend boot — never touches port 8788) with a project-scoped agent, a scratch tmux session whose window is named per the same `project-agent` convention `db.sh`'s `load_agents` computes, then runs the real `scripts/teardown.sh` end-to-end against it (via a new `CONDUCTOR_SESSION_NAME` env override on `teardown.sh`, mirroring the override `conductor.sh` already had) and asserts no `can't find window` error, the correct window received the dispatch, and the session was killed.

Confirmed the test is meaningful, not tautological: temporarily reverted the `window_name` fix, re-ran the test — failed with the exact original `can't find window: agent1` error; restored the fix, re-ran — passed. Both runs archived in this cycle's verification log.

Root cause fixed, regression test added and validated against both the buggy and fixed code, `bash -n` clean on both scripts.

### Fix commit blocked (why this stays `in-progress`, not `closed`)

Attempted to commit the isolated diff (`scripts/teardown.sh`, `scripts/verify-teardown-window-mapping.sh`, this file) but the repo's pre-commit hook runs a repo-wide `eslint` across both workspaces, not scoped to staged files, and failed on 15 pre-existing lint errors in unrelated files this bug never touched — `host-server/capturePerfBaseline.test.ts`, `host-server/pendingAgents.ts`, `host-server/perfBudgets.test.ts` (untracked files from earlier, separately uncommitted session work). Did not bypass the hook (`--no-verify`) or fix those unrelated files out of this bug's scope, so the commit did not happen. The fix and regression test both exist correctly in the working tree; closing per the lifecycle gate (root cause + **fix commit** + regression test) is blocked purely on that repo-wide lint-vs-uncommitted-backlog conflict, not on this bug's own correctness.

## Related

> [[BUG-0004]], [[BUG-0006]], [[BUG-0010]] — share the same "no automated test harness for this surface" closing blocker (HTTP routes for those three, shell scripts for this one), unrelated code paths otherwise.
