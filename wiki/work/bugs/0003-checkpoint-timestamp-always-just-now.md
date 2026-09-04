---
id: BUG-0003
aliases: [BUG-0003]
title: "CheckpointList relative timestamps always show 'just now' (ms/seconds unit mismatch)"
status: closed
severity: medium
priority: "—"
created: 2026-08-24
updated: 2026-08-26
reporter: David Taylor
assignee: "—"
tags: "—"
linked_task: "[[TASK-071]]"
---

# BUG-0003 — CheckpointList relative timestamps always show 'just now' (ms/seconds unit mismatch)

## Environment

- OS: macOS (Darwin 25.3.0)
- Browser: Chromium (Playwright)
- App: tmux-conductor dashboard
- Runtime: host-server (Fastify) + frontend (Vite dev server)
- Config: default `conductor.conf`, no overrides

## Steps to Reproduce

1. Create a git-worktree-backed agent and take at least one checkpoint (e.g. via a task dispatch, which triggers the pre-dispatch checkpoint).
2. Open the agent's detail modal in the dashboard and expand the "Checkpoints" section.
3. Wait more than a minute (or observe a checkpoint that is known to be older than a minute), then re-observe the checkpoint row's relative-time label.

## Expected Behavior

Each checkpoint row shows a relative timestamp that advances with real elapsed time — e.g. "2m ago", "1h ago" — reflecting how long ago the checkpoint was actually taken.

## Actual Behavior

Every checkpoint's relative-time label always reads "just now", regardless of how old the checkpoint actually is. Root cause (found via source read during live verification, not yet fixed): `frontend/src/components/CheckpointList.tsx`'s `formatRelativeTimestamp` helper treats the checkpoint's `ts` field as if it were in seconds and multiplies it by 1000 before computing the elapsed delta, but the host-server's `agent_checkpoints` API actually returns `ts` already in milliseconds — so the computed "elapsed" delta is inflated by 1000x, pushing every real checkpoint's apparent age far into the future relative to `Date.now()`, which the formatter's own bounds-clamping then collapses back down to the "just now" bucket.

Found during live Playwright-driven verification of UAT-071 (checkpoint UI) on 2026-08-22 — created a fixture agent, took a real checkpoint via the API, waited, and the relative-time label never advanced past "just now".

## Reproducibility

- **Frequency**: always
- **First seen**: 2026-08-22
- **Last seen**: 2026-08-22

## Root Cause Analysis

`frontend/src/components/CheckpointList.tsx:10-21`'s `formatRelativeTimestamp(tsSeconds: number)` computed `deltaMs = Date.now() - tsSeconds * 1000`, i.e. it assumed the checkpoint's `ts` field was in seconds. It is not: `host-server/db.ts`'s `agent_checkpoints` table stores `ts` as an `INTEGER` populated from `Date.now()` (milliseconds) at insert time (`insertCheckpoint(db, agentId, ts: number, stashRef)`, confirmed by `db.migration.test.ts`'s `insertCheckpoint(db, agent.id, Date.now(), 'stash@{0}')`). Multiplying an already-millisecond value by 1000 inflated `deltaMs` by 1000x — e.g. a checkpoint 2 minutes old (120,000 ms real delta) computed as ~120,000,000 ms (~139 days) — which is far outside the function's realistic bounds. Because `deltaMs < 0` was the only clamp (guarding against clock skew, not against wildly-oversized-but-positive deltas), the huge delta passed through the day-bucket unclamped, but the reporter's — and the fixture in `CheckpointList.test.tsx`'s pre-existing rollback test — own mock data used `Math.floor(Date.now() / 1000)` for `ts` (compounding the same seconds-vs-ms confusion in the test fixture, which is why the bug had gone unnoticed by the test suite: a "seconds" `ts` fed into a "multiply by 1000" formatter reconstructs something close to the real current time, always rendering "just now").

## Resolution

Fixed `formatRelativeTimestamp` in `frontend/src/components/CheckpointList.tsx:10` to treat its argument (renamed `tsMs`) as already being in milliseconds — removed the erroneous `* 1000`. Corrected the pre-existing test fixture in `frontend/src/components/CheckpointList.test.tsx` (the UAT-123 rollback-confirmation test) from `ts: Math.floor(Date.now() / 1000)` to `ts: Date.now()`. Added a regression test (`CheckpointList relative timestamp — BUG-0003 regression`) asserting a checkpoint 2 minutes old renders as `"2m ago"`, not `"just now"`. `cd frontend && npm run typecheck && npm test` — 65/65 tests pass, typecheck clean.

## Related

> [[BUG-0004]] — found by the same UAT-071 verification pass, unrelated code paths
