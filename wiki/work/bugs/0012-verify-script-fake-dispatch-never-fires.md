---
id: BUG-0012
aliases: [BUG-0012]
title: "scripts/verify-sqlite-migration.sh's fake-dispatch check: enqueued task never reaches the spawned agent's pane within 55s"
status: triaged
severity: low
priority: P3
created: 2026-09-17
updated: 2026-09-20
reporter: David Taylor
assignee: "—"
tags: scripts, verification, dispatch, host-server
impact: "Only affects this one verify-script self-check's own coverage of the live dispatch path (host-server enqueue → dispatch → tmux send-keys → pane echo). Does not affect production data (confirmed via before/after row-count checks on ./data/conductor.db across every run in this investigation). Two of three suspected causes were confirmed and fixed as verify-script bugs (see Root Cause Analysis); after fixing both, the check still fails with correct targeting confirmed, narrowing this to a real open question about host-server's own dispatch-triggering behavior for this specific scenario (a freshly-spawned, always-idle agent given a task via POST), not something further fixable in the verify script alone."
linked_task: "—"
---

# BUG-0012 — scripts/verify-sqlite-migration.sh's fake-dispatch check: enqueued task never reaches the spawned agent's pane within 55s

## Environment

- OS: macOS (Darwin 25.3.0)
- App: tmux-conductor @ `ac0bf01` (main branch)
- Runtime: `scripts/verify-sqlite-migration.sh`'s `check_dispatch` function, run via `bash scripts/verify-sqlite-migration.sh`
- Config: default, `VERIFY_PORT` at its new default (18788, per TASK-129's port-isolation fix, confirmed unrelated to this failure)

## Steps to Reproduce

1. Run `bash scripts/verify-sqlite-migration.sh` from the repo root.
2. Observe "--- Check 3: Fake-agent dispatch ---" in the output.

## Expected Behavior

After a task is enqueued for agent `demo-1` via `POST /api/tasks`, the live host-server should dispatch it into the spawned `demo-1` tmux window (`demo-demo-1`) within the 55-second poll window, and `capture-pane` should show the `POPPED-OK` marker the enqueued command (`echo POPPED-OK`) would print.

## Actual Behavior

```
[check_dispatch] Waiting up to 55s for dispatch...
[check_dispatch] t+0s — pane tail: |
  ... (identical empty pane tail every 2s through t+54s) ...
[check_dispatch] FAIL: capture-pane did not show POPPED-OK within 55s
[check_dispatch] Final pane output:
(capture failed)
[check_dispatch] DB tasks still queued: echo POPPED-OKqueued
[check_dispatch] DB task count: 2
[check_dispatch] Agent state file: idle
[check_dispatch] FAIL: task row still in DB (count=1)
[check_dispatch] dispatch.jsonl record confirmed
```

Two distinct oddities in the same output, not yet disambiguated:
1. The pane tail is empty (`|`) for the entire 55s wait, and the final capture reports `(capture failed)` — suggesting either the tmux window (`demo-demo-1`) isn't the one being captured (a window-name mismatch between what `conductor.sh` spawned it as and what the check polls), or the capture-pane call itself is failing for an unrelated reason.
2. The diagnostic line `DB tasks still queued: echo POPPED-OKqueued` concatenates the task's `command` value (`echo POPPED-OK`) directly against its `status` value (`queued`) with no separator — this looks like a missing delimiter in the `sqlc`/print logic for that specific diagnostic query, independent of the dispatch failure itself, and should be fixed alongside root-causing the real issue so future debugging output is trustworthy.

Also noted: `[check_dispatch] dispatch.jsonl record confirmed` appears to pass despite the pane never showing the expected output — worth checking whether that assertion is actually meaningful (does it verify the *specific* enqueued task's dispatch record, or just that *a* dispatch.jsonl entry exists at all) before trusting it as partial evidence dispatch attempted correctly.

## Reproducibility

`always` (observed consistently across 2 separate full runs during the same session that also fixed the sibling `pop-race-and-precedence`/`backlog-restore` issues tracked in `[[BUG-0011]]`).

## Root Cause Analysis

Two confirmed, fixed bugs in the verify script itself, plus one confirmed-but-unresolved question in host-server's actual behavior:

1. **Wrong request field (fixed)**: `check_dispatch` (`scripts/verify-sqlite-migration.sh`, was ~line 467) enqueued the marker task via `curl -d '{"command":"echo POPPED-OK","agentName":"demo-1"}'` — but the real `POST /api/tasks` route (`host-server/index.ts:905`) only recognizes `agentId` (an integer); it has no `agentName` field at all. Fastify silently ignores unrecognized body fields rather than rejecting them, so the task was created successfully (got a real id) but as a fully **unscoped/global** task, never actually targeted at the agent. This skipped the `agentId`-gated immediate-dispatch fast path entirely. **Fixed**: changed the payload to `{"agentId":$agent_db_id}` using the already-resolved numeric id.

2. **Wrong capture-pane target (fixed)**: both the wait-loop's `capture-pane` (was ~line 495) and the failure diagnostic's `capture-pane` (was ~line 511) targeted `"$verify_session:$agent_name"` — the bare agent name `demo-1`. But `conductor.sh` actually spawns project-scoped agents under a `${project}-${agent}` window name (confirmed directly in the same run's own `conductor.log`: `Spawned: demo-1 (window: demo-demo-1)`), matching `agentWindowName`/`load_agents`'s `AGENT_WINDOW_NAMES` convention elsewhere in this codebase. The check was polling a window that never existed, so the pane tail was empty for the entire 55s wait every time. **Fixed**: compute the real window name via the same `COALESCE(p.name || '-' || a.name, a.name)` query `load_agents()` uses, and target that.

3. **Still open — task genuinely never dispatches even with both fixes applied**: after fixing (1) and (2), the task enqueue response now correctly shows `"agentId":3` (not global), and `capture-pane` now correctly reads the real pane content (previously always empty) — the agent's shell is visibly sitting at an idle `bash-5.3$` prompt for the full 55s wait, having never received the `echo POPPED-OK` command via `send-keys`. The task remains `status='queued'` the entire time, the agent's state file stays `idle` throughout (no busy/idle transition ever recorded), and the enqueue response shows `"dispatched":false`. This means neither the immediate-dispatch fast path (`host-server/index.ts`'s idle+empty-queue check on `POST /api/tasks`) nor the regular poll loop's idle-transition trigger fired for this specific scenario — a freshly-spawned agent that starts and stays idle (never transitions), then receives a task via direct API POST. Not yet determined whether this is a genuine host-server dispatch-condition bug (worth checking the fast path's actual live-idle check against what the pane looked like at POST time — it was still mid-startup, printing nvm/node-version-switch banners, which might fail whatever IDLE_PATTERN/liveness check the fast path uses) or an artifact specific to this test's rapid spawn-then-immediately-enqueue timing that wouldn't reproduce in normal usage. Needs live investigation into `host-server/index.ts`'s actual fast-path condition check and `state.ts`'s idle-detection pattern matching, cross-referenced against what the pane's content actually was at the moment of the POST.

## Resolution

Partial: 2 of 3 sub-causes fixed in `scripts/verify-sqlite-migration.sh` (same session as [[BUG-0011]]'s fix, same file) — see items 1-2 above. Verified live (multiple full script runs, `sqlite3` row-count + `lsof` port/PID checks before/after each) with zero production impact throughout. Item 3 remains open and is the reason this bug stays `open`, not `closed` — the two fixes materially improved diagnosability (a future investigator now gets real pane content and correct agent targeting instead of a false "nothing happened" signal) but did not make the check pass.

**Fix commit**: not yet committed, same as [[BUG-0011]] — reserved for the user's own commit action.

## Related

- Discovered alongside [[BUG-0011]] (same investigation session, same script, same class of "verify script passes the wrong value" mistake for items 1-2) — that bug's two sub-issues were fixed separately.
- Item 3 may be worth cross-referencing against [[BUG-0001]]'s own findings on idle/busy state-transition timing, since both concern host-server's dispatch-triggering conditions, even though the specific mechanisms differ (BUG-0001 is about background sub-agents; this is about a freshly-spawned agent that never transitions at all).
