---
id: dispatch-path-parity
title: Dispatch-Path Parity (Two Dispatchers, One Gate)
aliases: [Dual Dispatcher, monitor.sh vs pollAndDiff]
updated: 2026-09-19
sources:
  - ../../../raw/research/multi-agent-infrastructure-requirements/index.md
confidence: inferred
tags: [dispatch, monitor, host-server, bash, drift, BUG-0001]
---

# Dispatch-Path Parity (Two Dispatchers, One Gate)

Task dispatch happens in **two independent implementations** that share a database but not their safety gates. The host-server's `pollAndDiff` pops on idle transitions (`popTask`, TypeScript) behind the `usage-limited` file and the BUG-0001 pending-agents sentinel (`hasPendingBackgroundAgents`, called from exactly two sites, both in `host-server/index.ts`). Separately, `scripts/monitor.sh` pops via `pop_task_sql` (bash, `scripts/lib/db.sh`), and the host-server itself re-creates the `monitor` tmux window running that script (`healMonitorWindow`), so it is a live second dispatcher, not legacy code. A pattern search found **no reference to the pending-agents sentinel anywhere under `scripts/`**.

**What the atomic claim does and does not protect.** Both paths select with the same shape of single `UPDATE … RETURNING` under WAL with matching 5000 ms busy timeouts (Node `busy_timeout`, bash `.timeout`), so a task cannot be popped twice. That prevents duplicate *delivery*; it does not make the two paths apply the *same conditions* before delivering. If the bash path can dispatch into an agent the host-server path would have held back for a false idle, BUG-0001's protection is partial, and any new routing tier must land in both places in the same order or the two will drift — the same failure class as the `bg_processes` split-brain bug (`DEC-0006`'s constraint that role matching be implemented in both `popTask` and `pop_task_sql`).

> **Unverified:** the bash-path gap is inferred from an absence-of-match search and from reading call sites, not from a runtime test. It is assumption A4 in the source's register; the verifying experiment is to hold an agent in a false-idle state and observe whether `monitor.sh` dispatches. CLAUDE.md's phrase "gates both dispatch call sites" refers to the two host-server sites, not to `monitor.sh` — easy to over-read.

**Resolution options** (from the report, not decided): make the gates a shared module both paths call; retire one dispatcher; or at minimum add a parity check (the existing `scripts/verify-*` harness pattern) asserting identical tier ordering and gate conditions.

The same "two implementations, one fixture set" discipline now applies to awaiting detection: `monitor.sh` and `host-server/state.ts` are both checked against `host-server/fixtures/awaiting-panes/manifest.json` (via `scripts/verify-awaiting-detection.sh` and `state.test.ts`), the BUG-0013 fix ([TASK-0231](../../work/tasks/TASK-0231-fix-false-awaiting-busy-guard-and-pattern-tightening.md)); see [[Agent State Determination]].

derived_from::[[Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)]]
relates_to::[[Pane-Idle Detection Cannot See Async Background Agent Work]]
relates_to::[[Task Lifecycle and Completion Semantics for an Agent Queue]]
relates_to::[[Background Process Registry (bg_processes) — Mechanism and Gaps]]
relates_to::[[Host Server]]
