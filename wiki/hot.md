---
title: Hot Cache
updated: 2026-09-04
---

# Hot Cache

Always-read-first summary of what changed most recently in this wiki. Regenerated in full on every wiki write — never appended.

_Last updated: 2026-09-04_

## Key Recent Facts

- **All bugs closed except BUG-0001.** BUG-0009, BUG-0004 + BUG-0010, and BUG-0006 all closed this session with real regression tests, building self-contained `scripts/verify-*.sh` live-subprocess tests (real host-server on a scratch port, never the live dev server's 8788) rather than waiting on an in-process Fastify HTTP-route harness that doesn't exist.
- **BUG-0001's shipped fix is confirmed incomplete**: `agent_needs_input` fires only when a background agent genuinely needs input, never as a "still running" ping — an autonomous background sub-agent that never needs input gets no sentinel.
- **The proposed fallback (footer-hint pane-text pattern) is now disqualified by a live check, not just theorized as risky.** `tmux capture-pane` against 4 unrelated live agent panes all showed the identical `← 1 agent` footer at once — it's global/account-wide, not scoped to the pane displaying it. Would gate dispatch on unrelated machine-wide activity. **Do not implement this pattern.**
- **New candidate found while investigating the above**: `~/.claude/jobs/<id>/state.json` — Claude Code's own internal per-background-job state (`state`/`linkScanPath`/`fan` fields), directly correlatable to a specific project and its outstanding sub-tasks. Structurally solves the gap, but is undocumented private internal state (no public API, no stability contract) — a materially different risk than either option originally researched. Not implemented; needs the user's explicit go-ahead given that risk, same class as the earlier global-config-change flag.
- **Repo-wide pre-commit hook** (`npm run lint`/`typecheck`) runs across the *entire* working tree at commit time, not just staged files — any pre-existing error anywhere blocks every commit. Hit closing BUG-0009. Worth scoping to staged-only (lint-staged or equivalent); not yet done or filed as a task.
- **Large pre-existing uncommitted backlog remains** in the repo from sessions well before this one — this session's commits were deliberately scoped to touch only the specific files each fix needed.

## Recent Changes

- **Fixed & committed**: `scripts/teardown.sh` (`e770dfe`), `host-server/index.ts` diff endpoint + SSE builders (`602f996`, `502bb72`), `wiki/work/bugs/0001-*.md` docs updates (`ed424f7`, `b1c9d43`).
- **Created**: `scripts/verify-teardown-window-mapping.sh`, `scripts/verify-diff-endpoint-worktree-and-uncommitted.sh`, `scripts/verify-sse-role-payload.sh`, `host-server/sseRolePayloadParity.test.ts`, `raw/research/bug-0001-background-agent-detection/` — all committed.
- **Wiki**: `wiki/knowledge/sources/bug-0001-background-agent-detection.md` (new, then self-corrected same day — its own footer-hint recommendation superseded by the live-check finding, `confidence: ambiguous`); `claude-code-cli.md`, `claude-code-hooks.md` (fixed staleness re: `on-notification.js`), `idle-detection-vs-async-background-work.md` (contradiction flagged, `confidence: ambiguous`).
- **Bug bookkeeping**: `wiki/work/bugs/index.md` now lists only BUG-0001.

## Active Threads

- **BUG-0001** (`in-progress`, P1): waiting on the user's decision between (a) accept the known gap, no new work, (b) poll `~/.claude/jobs/*/state.json` with a loud fallback if the format looks unexpected, or (c) something else. The footer-hint pattern is ruled out — don't revisit it without new evidence.
- **Pre-commit hook scoping**: unresolved friction, worth a future task (lint-staged or equivalent) — not yet filed.
- Carried forward, not touched this session: **TASK-135** (dark-mode surface-literal sweep, `todo`), **TASK-134** (Clone button in AgentDetailModal, `todo`), **TASK-132** (context-window limit accuracy, `todo`), **TASK-128/129** (monitor.sh single-instance lock; verify-sqlite-migration.sh port hazard, `todo`) — status not re-verified this session, may be stale.
