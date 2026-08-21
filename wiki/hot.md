---
title: Hot Cache
updated: 2026-08-15
---

# Hot Cache

Always-read-first summary of what changed most recently in this wiki. Regenerated in full on every wiki write — never appended.

_Last updated: 2026-08-15_

## Key Recent Facts

- **Agent status notification banners — research done, roadmap in progress.** New dashboard feature: dismissible top-right banners when an agent transitions into `awaiting` ("waiting") or `empty` ("no tasks") status, grace-period debounced against flicker, auto-dismiss on status-exit, click opens the agent's modal with the terminal focused for input. Both target statuses already exist and are already labeled exactly this way in `frontend/src/components/AgentList.tsx::STATUS_CONFIG`. Reuses two existing mechanisms directly: (1) the `agent-update` SSE handler's `prevStatusRef` transition tracker (currently drives the doorbell/chime sounds; `needsAttention()` = `awaiting || stalled` does NOT include `empty`, so the new feature needs its own transition predicate), and (2) `AgentDetailModal`'s `armInteract`→`interactSignal` mechanism for click-to-focus (`setExpandedAgent({ id, armInteract: true })` — same call the existing needs-attention card CTA makes). No toast library warranted — bespoke component, matches the codebase's hand-rolled-overlay convention (`ConfirmDialog`). Full report: `raw/research/agent-status-notifications/index.md`; wiki source page: `wiki/knowledge/sources/agent-status-notifications.md`.
- **TASK-134 created (`todo`, 2026-08-15)** — user-requested "Clone" button in `AgentDetailModal`'s header row (alongside Rename/Close agent/Remove agent). New `POST /agents/:id/clone` loads the source agent, derives a unique `<name>-copy` name (bumping on collision, scoped like the existing `idx_agents_project_name`/`idx_agents_null_name` uniqueness), and calls the existing `createAgent()` with `useWorktree` mirroring whether the source agent has a `worktreePath` — so a worktree-backed agent clones into a fresh worktree + `conductor/<id>` branch, a plain agent clones into the shared workdir. No confirmation dialog (non-destructive), no new modal. No dependencies on other active tasks; not linked to a decision or roadmap. Next step `/tackle wiki/work/tasks/TASK-134-clone-agent-button.md`.
- **TASK-133 (`todo`)** — BUG-0001's fix task, behaviorally confirmed via a 3-screenshot live repro: a `/power-mode roadmap 7` agent legitimately goes idle mid-run while its own background `/uat-auto` sub-agents are still running, and the conductor dispatches the next queued task into the **same pane**, interleaving two roadmap runs. Scope: (1) narrow `hooks/on-notification.js`, log-only first, to confirm live `agent_needs_input`/`agent_completed` payload shapes; (2) per-outstanding-agent sentinel file under `$STATE_DIR/<agent>.pending-agents/`; (3) gate `scripts/monitor.sh`'s dispatch call site (`monitor.sh:425-447`) on it, generous staleness fallback — explicitly not a fixed grace period. No hard dependency on TASK-120/121. Next step `/tackle wiki/work/tasks/TASK-133-sentinel-gate-background-agent-dispatch.md`.
- **BUG-0001**: `in-progress`, P1/critical. Root cause: Claude Code's background/async agents (v2.1.198+) legitimately end the outer turn while spawned work continues. Do not `/bug-close` until TASK-133's UAT verifies the fix.
- **TASK-132 (`todo`)**: context-window badge false "333k/200k" overflow for Sonnet 5 (actually 1M unconditionally) — `host-server/context.ts`'s `modelContextLimit()` only special-cases `"opus"`. Next step `/tackle wiki/work/tasks/TASK-132-context-window-limit-accuracy.md`.
- **Agent record shape** (`host-server/db.ts` `Agent` interface): `id, name, workdir, launchCmd, projectId, projectName, worktreePath, branch, role, createdAt`. No existing clone/duplicate concept anywhere in the codebase before TASK-134.
- **User preference learned**: when a small bug is reported alongside a `/tackle` invocation, add it as a task step rather than reflexively running `/bug-file`.
- **No `*.test.tsx` files exist anywhere in this repo yet.**
- **`Cmd+←`/`→`** reserved for previous/next agent; **`Alt+F`** reserved for expand/collapse.
- **DEC-0001 (Conductor Usage-Check Hardening)** fully `accepted`/archived — `USAGE_CHECK_CMD='true'` is correct.
- **Filed but not implemented**: TASK-128 (monitor.sh single-instance lock), TASK-129 (verify-sqlite-migration.sh port 8788 hazard).
- **ROADMAP-010 Phase 3** nearly closed — only TASK-114/115 UATs remain.
- Hot-file discipline: `host-server/index.ts`, `host-server/db.ts`, `frontend/src/components/AgentList.tsx`, `frontend/src/lib/api.ts`, `host-server/context.ts`, `scripts/monitor.sh`, and `hooks/` — re-read immediately before every edit.

## Recent Changes

- Created: `raw/research/agent-status-notifications/index.md` + `sources.md`, `wiki/knowledge/sources/agent-status-notifications.md`.
- Updated: `wiki/knowledge/entities/components/agent-detail-modal.md` (cross-link to the new research), `wiki/index.md`, `wiki/log.md`.
- Earlier today: TASK-134 created (Clone button); TASK-133 created (BUG-0001 fix); `wiki/work/bugs/0001-false-idle-during-subagent-wait.md` filed + triaged; `raw/research/stop-hook-subagent-detection/` + its wiki pages added; TASK-132 created; context-window-accuracy research/wiki pages added; TASK-131/UAT-131 archived.

## Active Threads

- **Agent status notification banners**: research complete (`wiki/knowledge/sources/agent-status-notifications.md`), roadmap creation in progress via `/roadmap-create` — no roadmap file written yet as of this hot-cache refresh.
- **TASK-134**: `todo` — Clone button in AgentDetailModal. Next step `/tackle wiki/work/tasks/TASK-134-clone-agent-button.md`.
- **TASK-133**: `todo` — BUG-0001's fix (investigation + sentinel gate). Next step `/tackle wiki/work/tasks/TASK-133-sentinel-gate-background-agent-dispatch.md`. Do not run `/bug-close BUG-0001` until this task's UAT verifies the fix.
- **TASK-132**: `todo` — context-window limit accuracy fix. Next step `/tackle wiki/work/tasks/TASK-132-context-window-limit-accuracy.md`.
- **Interact-mode input fix**: root-caused in `raw/research/terminal-keyboard-clipboard/index.md`; no task filed yet.
- **Dual-monitor race**: TASK-128 (`todo`). **verify-sqlite-migration.sh port hazard**: TASK-129 (`todo`).
- **ROADMAP-010**: only TASK-114/115 UATs remain. **ROADMAP-007**: TASK-062/066/071 open. **ROADMAP-017**: Phase 1/2 pending, TASK-122/124/126 `todo`.
