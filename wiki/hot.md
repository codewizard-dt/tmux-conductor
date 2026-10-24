---
title: Hot Cache
updated: 2026-10-17
---

# Hot Cache

Always-read-first summary of what changed most recently in this wiki. Regenerated in full on every wiki write — never appended.

_Last updated: 2026-10-17_

## Key Recent Facts

- **Three follow-up tasks filed from the "How to Evaluate Agent State Transitions" research** (`raw/research/agent-state-transition-evaluation/`): `TASK-0236` (sequential-poll / 1-switch tests for `busy-recovered` and `inventory-timeout` in `state.test.ts`), `TASK-0234` (interactive human-audit sampler to calibrate `report-false-awaiting.mjs`'s heuristic), `TASK-0235` (extend the shared pane-fixture manifest and both consumers to `stalled`/`exited`/`busy-recovered`). `TASK-0235` and `TASK-0236` both edit `host-server/state.test.ts` — sequence them, don't tackle concurrently. `stalled` is host-server-only: `monitor.sh` has no stall branch, so the bash-side assertion for a stalled fixture checks ordinary busy behavior.
- **Task-ID collision handled**: the sequence-test task was planned as `TASK-0233`, but a concurrent session claimed that number for the env-leak task, so it became `TASK-0236`. Concurrent sessions are claiming task numbers; re-scan right before writing.
- **`BUG-0013`/`TASK-0231` (false `awaiting` over-reporting) has shipped** — `agent-state-determination.md` documents the fix as done (busy-footer guard, tightened `AWAITING_PATTERN`, shared fixture manifest, `report-false-awaiting.mjs`). Treat as closed.
- **Merge decision (2026-10-17): dropped a redundant sidebar-flyout implementation from worktree branch `conductor/15`** (reused `TASK-0179`/`UAT-0179` IDs collided with main's shipped push-collapse, `TASK-0201`). Kept main's version.
- **`ROADMAP-0024`** (bg-process restart/liveness/cooldown) is still `active`; `TASK-0205` closed 2026-10-17, `TASK-0191/0192/0193/0202/0203/0204/0206/0207/0208/0197` remain open.
- Older snapshots referenced `ROADMAP-0027` (last-user-payload, paused) and `ROADMAP-0026` (orchestrator role, not started) — **unverified**; check `wiki/work/roadmaps/index.md` before relying on either.

## Recent Changes

- **Created (2026-10-17)**: `TASK-0234`, `TASK-0235`, `TASK-0236` (all `todo`, indexed in `wiki/work/tasks/index.md`).
- **Created (2026-10-17)**: `TASK-0233` (todo) — stop stale `.env` vars (`DATABASE_URL` etc.) leaking into every tmux agent window via `Makefile`'s bare `export` and host-server's `{...process.env}` spawn.
- **Created**: `wiki/knowledge/sources/agent-state-transition-evaluation.md`; `wiki/knowledge/concepts/state-detector-evaluation-tiers.md`; `raw/research/agent-state-transition-evaluation/`.
- **Updated**: `agent-state-determination.md`, `dispatch-path-parity.md`, `wiki/index.md`, `wiki/log.md`.
- **Earlier today**: merged `conductor/15` with the flyout work dropped; `TASK-0205`/`UAT-0205` archived. `ROADMAP-0023` and its `TASK-0169`-`0178` family were archived (confirm via `wiki/work/roadmaps/archive/index.md`).

## Active Threads

- **`TASK-0233`** (env leak): todo, not roadmap-linked. Live leak of a DigitalOcean DB credential via `tmux show-environment -g`; user must unset it, clean `.env`, and rotate the password (Step 1) before or alongside the Makefile and spawn-env fixes.
- **`TASK-0234` / `TASK-0235` / `TASK-0236`**: todo, independent of other active tasks. Tackle `0235` and `0236` one after the other (shared `state.test.ts`); `0234` is independent.
- **`ROADMAP-0024`**: multiple tasks open — check `wiki/work/roadmaps/index.md` for per-task status before resuming.
- **Re-verify stale threads from before 2026-09-20**: `ROADMAP-0027` and `ROADMAP-0026`.
- Golden-fixture expansion beyond `awaiting` beyond what `TASK-0235` covers stays an ongoing practice, triggered by future false-transition findings.
