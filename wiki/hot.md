---
title: Hot Cache
updated: 2026-09-20
---

# Hot Cache

Always-read-first summary of what changed most recently in this wiki. Regenerated in full on every wiki write — never appended.

_Last updated: 2026-09-20_

## Key Recent Facts

- **`TASK-0179` created (2026-09-20)**, added to `ROADMAP-0023`: sidebar minimize toggle (56px icon rail) with a 320px hover/focus **overlay flyout**, plus a **sticky sidebar header** (toggle, text filter, Inactive Agents section) with only the agent list scrolling. Key constraint: hover must not change the docked width — `LogTail`'s ResizeObserver refits xterm on any width change and `terminalSizeProbe` only re-syncs the host on window resize — so only the toggle re-probes, via a new `setSidebarDockedWidth`. Typing guard is a longer hover delay (450ms vs 100ms) when focus is in the detail pane, not a block (Direct Input is armed by default). Depends on TASK-0170/0173/0177 (shipped in code, UAT pending). Backing research: `raw/research/sidebar-hover-expand/` + wiki `sidebar-hover-expand`. Next step: `/tackle wiki/work/tasks/TASK-0179-sidebar-minimize-hover-flyout.md`.
- **`TASK-0168`** (2026-09-18): scopes a Phase 1 wiki correction of 3 stale ROADMAP-019 pages, then a Phase 2 audit of agent status observability. Next: `/tackle wiki/work/tasks/TASK-0168-audit-agent-status-observability.md`.
- **`ROADMAP-0023`**: `git log` shows commit 6957b9c "Complete ROADMAP-0023", yet the roadmap is still `active` with TASK-0169..0178 `pending-uat` and now TASK-0179 open — status pages not reconciled.
- **`BUG-0011`/`BUG-0012`/`TASK-0166`/`TASK-133` — unchanged**, all waiting on human input.

## Recent Changes

- **Created**: `wiki/work/tasks/TASK-0179-sidebar-minimize-hover-flyout.md`; earlier today the sidebar-hover-expand research (`raw/research/sidebar-hover-expand/`, wiki source + 2 concepts + `agent-sidebar` component page).
- **Updated**: `wiki/work/tasks/index.md` (TASK-0179 row); `wiki/work/roadmaps/ROADMAP-0023-...` (TASK-0179 item under Phase 4); `wiki/log.md`.
- **Noted, not mine**: this working tree has unrelated uncommitted state (`CLAUDE.md` modified) — left untouched.

## Active Threads

- **`TASK-0179`**: `todo`, not started — six steps (constants/probe, `useHoverExpand` hook, rail row + sidebar restructure, AgentList state/shortcut, tests, live verification).
- **`TASK-0168`**: `todo`, not started — Phase 1 (correct 3 stale wiki pages) precedes Phase 2 (verification scripts, `DetectionReason` cross-check, pane-text spot-check).
- **`ROADMAP-0023`**: `active`; 0169-0178 `pending-uat`; reconcile with git history.
- **Wiki lint follow-ups** (need a human decision): document `pending-uat` in `tasks/lifecycle.md`; decide whether to merge `completed/` into `archive/`; verify/ingest remaining flagged `raw/research/` topics.
- **`BUG-0012`**: `open`, P3. **`BUG-0011`**: `in-progress`, fix verified — needs review/commit then `/bug-close`. **`BUG-0001`**: `in-progress`, P1 — awaiting user decision (`TASK-133`).
- **`TASK-0166`**: `in-progress`, blocked on a human decision to run `scripts/backfill-agent-teams-flag.mjs`.
- **`ROADMAP-0022`**: `active`, 4 tasks `pending-uat` — next `/uat-walk` each.
- **Pending-UAT tasks**: `TASK-001`, `TASK-011`, `TASK-012`, `TASK-0164`, `TASK-151`, `TASK-132`, `TASK-0167`, `TASK-162`, `TASK-0178` (partial auto run).
- **Orchestrator/task-routing research**: two rounds ingested, no task or decision filed yet.
- **`DEC-0003#D1`/`#D2`** (remote access): both `proposed` — deliberately left open.
