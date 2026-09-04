---
title: Hot Cache
updated: 2026-09-04
---

# Hot Cache

Always-read-first summary of what changed most recently in this wiki. Regenerated in full on every wiki write — never appended.

_Last updated: 2026-09-04_

## Key Recent Facts

- **All bugs closed except BUG-0001.** BUG-0009 (teardown.sh window-name mapping), BUG-0004 + BUG-0010 (diff endpoint worktreePath + uncommitted-changes fixes, shared one regression test), and BUG-0006 (SSE role-payload, two regression tests for its two call sites) all closed with real regression tests this session, following a pattern of building self-contained `scripts/verify-*.sh` live-subprocess tests (booting a real host-server on a scratch port, never the live dev server's 8788) rather than waiting on an in-process Fastify HTTP-route harness that doesn't exist.
- **BUG-0001 is the sole active bug, `in-progress`, P1** — and its shipped fix (event-driven sentinel on the `Notification` hook's `agent_needs_input`/`agent_completed`) is now confirmed (via current docs, not just inference) to miss the scenario that motivated the bug report: `agent_needs_input` fires only when a background agent genuinely needs input, never as a "still running" ping, so an autonomous background sub-agent that never needs input gets no sentinel. See `wiki/knowledge/sources/bug-0001-background-agent-detection.md` for the full research and `wiki/work/bugs/0001-false-idle-during-subagent-wait.md`'s dated Update section.
- **New candidate signal found for BUG-0001**: the interactive prompt footer's `←` hint (`← N agents` / `← for agents` / `← N done`) — pane-observable, same class of mechanism as this repo's existing `AWAITING_PATTERN`. Its behavior with zero background agents ever dispatched isn't confirmed by docs; one live look (no global config needed) is the next step before writing a pattern. User is deciding next steps — not yet implemented.
- **Repo-wide pre-commit hook is a recurring friction point**: `npm run lint`/`typecheck` runs across the *entire* working tree at commit time, not just staged files — any pre-existing error anywhere blocks every commit. Hit this closing BUG-0009 (had to fix 15 lint + 2 typecheck errors in unrelated untracked files first). Flagged as worth scoping to staged-only (e.g. lint-staged) but not yet done.
- **Large pre-existing uncommitted backlog remains** in the repo from sessions well before this one (most `frontend/src/components/*.tsx`, `host-server/index.ts`, `config.ts`, `conductor.conf`, several `wiki/work/*` files, loose screenshot PNGs at repo root) — this session's commits were deliberately scoped to touch only the specific files each fix needed, never swept up in that backlog.

## Recent Changes

- **Fixed & committed**: `scripts/teardown.sh` (`e770dfe`), `host-server/index.ts` diff endpoint + SSE builders (`602f996`, `502bb72`), `wiki/work/bugs/0001-*.md` docs-only update (`ed424f7`).
- **Created**: `scripts/verify-teardown-window-mapping.sh`, `scripts/verify-diff-endpoint-worktree-and-uncommitted.sh`, `scripts/verify-sse-role-payload.sh`, `host-server/sseRolePayloadParity.test.ts` — all committed. `raw/research/bug-0001-background-agent-detection/` (index.md + sources.md) — new research, just ingested.
- **Updated (this ingest)**: `wiki/knowledge/sources/bug-0001-background-agent-detection.md` (new), `wiki/knowledge/entities/tools/claude-code-cli.md`, `wiki/knowledge/entities/components/claude-code-hooks.md` (fixed staleness: `on-notification.js` was re-added, page still said only 4 hooks exist), `wiki/knowledge/concepts/idle-detection-vs-async-background-work.md` (contradiction/refinement flagged, `confidence: ambiguous`).
- **Bug bookkeeping**: `wiki/work/bugs/index.md` now lists only BUG-0001; BUG-0004/0006/0009/0010 all flipped to `closed`.

## Active Threads

- **BUG-0001** (`in-progress`, P1): waiting on the user's decision — pane-text heuristic (footer hint), live payload capture (needs global `~/.claude/settings.json` hook install, explicit go-ahead required), or both. See the source page above for the full comparison.
- **Pre-commit hook scoping**: unresolved friction, worth a future task (lint-staged or equivalent) — not yet filed as a task or bug.
- Carried forward, not touched this session: **TASK-135** (dark-mode surface-literal sweep, `todo`), **TASK-134** (Clone button in AgentDetailModal, `todo`), **TASK-132** (context-window limit accuracy, `todo`), **TASK-128/129** (monitor.sh single-instance lock; verify-sqlite-migration.sh port hazard, `todo`) — status not re-verified this session, may be stale.
