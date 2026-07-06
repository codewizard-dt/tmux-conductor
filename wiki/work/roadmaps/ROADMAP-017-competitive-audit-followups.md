---
id: ROADMAP-017
title: Competitive-audit follow-ups — dispatch latency, perf-budget calibration, UI/UX & task history
status: active
created: 2026-07-06
updated: 2026-07-06
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [latency, observability, ux]
---

# Roadmap 017: Competitive-audit follow-ups — dispatch latency, perf-budget calibration, UI/UX & task history

## Goal

Close the highest-value gaps identified by the 2026-07-06 competitive audit against popular multi-agent coding orchestrators (Claude Squad, Conductor, Crystal/Nimbalyst, Vibe Kanban, AgentsRoom, NTM): collapse the dispatch-loop latency mismatch between `monitor.sh` and the host-server, calibrate the still-placeholder `perfBudgets.ts` regression thresholds with real data, and round out the dashboard with dark mode, consistent modal styling, an agent search filter, and a persisted task history — without duplicating the token-tracking and role-template work already tracked in ROADMAP-010.

## Phase 1: Dispatch Latency

- [ ] Collapse `monitor.sh`'s 15s `POLL_INTERVAL` dispatch loop into the host-server's existing 2s status-poll loop, triggering dispatch on the idle transition instead of running a second independent poll
- [ ] Reuse the existing `mark_busy` pre-dispatch marker pattern to prevent double-dispatch races between the collapsed loop and any remaining monitor.sh polling
- [ ] Verify real task-start latency drops from ~15s worst-case to ~2s under a live agent session

## Phase 2: Perf Budget Calibration

- [ ] Capture a representative period of real production `liveUpdateMetrics` data from `/api/perf/live-updates`
- [ ] Calibrate `host-server/perfBudgets.ts`'s regression thresholds from the captured data, replacing the current "intentionally conservative" placeholder values
- [ ] Persist periodic `liveUpdateMetrics` snapshots to `observability.jsonl` so the metrics survive a host-server restart

## Phase 3: UI/UX & Task History

- [ ] Add dark mode to the dashboard using the existing centralized Tailwind tokens in `frontend/tailwind.config.js`
- [ ] Replace `window.confirm()` destructive-action dialogs (remove/close agent) with the app's existing custom modal styling
- [ ] Add a text filter to `AgentList` for scaling past small agent counts
- [ ] Change task pop from hard-`DELETE` to a soft status flip (`status='done'`, `completed_at`) in the `tasks` table
- [ ] Add a task history view in the dashboard reading completed tasks

## Notes

Derived from `raw/research/comprehensive-app-audit/index.md`. Two gaps from that research are deliberately excluded here because they're already tracked elsewhere: token/cost tracking and agent role templates both have an active home in [ROADMAP-010](ROADMAP-010-agent-observability-ux.md) (Phases 1 and 3) — consider filing a `/roadmap-add` refinement there suggesting the transcript-JSONL parsing approach (ccusage-style) in place of ROADMAP-010's current pane-regex plan, rather than duplicating the capability here.

A roadmap-status audit run immediately before this one found ROADMAP-002's index entry was stale (10/27 vs. an actual 25/27) and that the entire ROADMAP-015 task/UAT block (TASK-084–094) collided with unrelated ROADMAP-016 tasks assigned the same IDs on 2026-07-04; both were corrected the same day this roadmap was created — see `wiki/log.md`.
