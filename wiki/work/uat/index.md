---
title: UAT Index
updated: 2026-09-13
---

# UAT — Active Items

Lists **only active** UAT files (`pending`, `in-progress`, `failed`). When a UAT leaves the active set (`passed`, `skipped`, `trashed`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [UAT-NNN — Title](UAT-NNN-slug.md) — verifies TASK-NNN · status`

- [UAT-001 — UAT: Skill detection — backend scanner + dashboard surfacing](UAT-001-skill-detection.md) — verifies TASK-001 · failed
- [UAT-005 — UAT: DB-backed agent and bg-process routes with spawnAgentWindow helper](UAT-005-backend-routes-db.md) — verifies TASK-005 · pending
- [UAT-006 — UAT: ID-based /api/tasks routes and SSE events](UAT-006-task-queue-routes.md) — verifies TASK-006 · pending
- [UAT-011 — UAT: Immediate dispatch for tasks enqueued to an idle agent with an empty queue](UAT-011-immediate-dispatch.md) — verifies TASK-011 · pending
- [UAT-0180 — UAT: Make queued-task text selectable and add a per-task 'scope to project' button](UAT-0180-queued-task-selectable-text-and-scope-to-project.md) — verifies TASK-0180 · pending
- [UAT-128 — UAT: monitor.sh single-instance startup guard — PID lockfile keyed on STATE_DIR](UAT-128-monitor-single-instance-lock.md) — verifies TASK-128 · pending
- [UAT-012 — UAT: Replace tail polling with SSE push for terminal output](UAT-012-sse-tail-stream.md) — verifies TASK-012 · failed
- [UAT-130 — UAT: Dynamic tmux pane sizing from the browser terminal's full-width probe](UAT-130-dynamic-terminal-pane-sizing.md) — verifies TASK-130 · pending
- [UAT-140 — UAT: Audit and fix button/badge contrast ratios in light and dark themes](UAT-140-badge-button-contrast-audit.md) — verifies TASK-140 · pending
- [UAT-0167 — UAT: Allow switching an agent's role directly from the agent detail modal](UAT-0167-agent-role-switcher-modal.md) — verifies TASK-0167 · pending
- [UAT-151 — UAT: Convert the Add Agent form into a modal](UAT-151-add-agent-form-modal.md) — verifies TASK-151 · pending
- [UAT-0164 — UAT: Make the Direct Input terminal border permanent (color-only state change, no layout shift)](UAT-0164-direct-input-border-no-shift.md) — verifies TASK-0164 · pending
- [UAT-162 — UAT: Move the Details and Queued Tasks accordions into the AgentInfoTabs structure](UAT-162-details-queued-tasks-into-tabs.md) — verifies TASK-162 · pending
- [UAT-0185 — UAT: Fix dispatched task text never submitting: add render-settle delays to sendTextToPane and the /clear chain](UAT-0185-dispatch-render-settle-delay.md) — verifies TASK-0185 · pending
- [UAT-0209 — UAT: Add a Create worktree item to the agent actions menu with reasoned disabled states](UAT-0209-create-worktree-menu-item.md) — verifies TASK-0209 · pending
- [UAT-0210 — UAT: Surface the backend's real worktree-creation error reason instead of a generic message](UAT-0210-worktree-real-error-reasons.md) — verifies TASK-0210 · pending
- [UAT-0211 — UAT: Propagate a newly created worktree/branch to all clients without a reload](UAT-0211-propagate-new-worktree-to-all-clients.md) — verifies TASK-0211 · pending
- [UAT-0224 — UAT: Add a lib/lastPayload.ts per-agent localStorage store with tests](UAT-0224-last-payload-localstorage-store.md) — verifies TASK-0224 · pending
- [UAT-0221 — UAT: Persist the submitted prompt as last_prompt in the hook sidecar merge](UAT-0221-hook-persist-last-prompt.md) — verifies TASK-0221 · pending
- [UAT-0214 — UAT: Add a Clone into new worktree item to the agent actions menu on every agent](UAT-0214-clone-into-new-worktree-menu-item.md) — verifies TASK-0214 · pending
- [UAT-0213 — UAT: Add a force-worktree option to POST /agents/:id/clone and start the clone's window inside the worktree](UAT-0213-clone-force-worktree-option.md) — verifies TASK-0213 · pending
- [UAT-0222 — UAT: Read the hook sidecar's last_prompt in the host-server and expose agent.lastPrompt on the snapshot, both SSE builders and the change-diff predicate](UAT-0222-server-last-prompt-field.md) — verifies TASK-0222 · pending
- [UAT-0215 — UAT: Include worktreePath and branch in the clone agent-update SSE payload](UAT-0215-clone-sse-payload-worktree-fields.md) — verifies TASK-0215 · pending
- [UAT-0216 — UAT: Warn, and offer a restart in the worktree, when adding a worktree to an agent whose window is live](UAT-0216-live-agent-worktree-cwd-warning.md) — verifies TASK-0216 · pending
- [UAT-0218 — UAT: Run UAT for the Create worktree menu action and the Clone into new worktree flow](UAT-0218-worktree-menu-and-clone-flow.md) — verifies TASK-0218 · pending
- [UAT-0223 — UAT: Record Add Task box submissions in the per-agent last-payload store at submit time](UAT-0223-add-task-submit-records-last-payload.md) — verifies TASK-0223 · pending
- [UAT-0226 — UAT: Replace activeTask with the last payload in the detail-pane strip](UAT-0226-detail-pane-strip-shows-last-payload.md) — verifies TASK-0226 · pending
- [UAT-0225 — UAT: Mirror incoming lastPrompt SSE values into the per-agent store, newest timestamp wins](UAT-0225-mirror-last-prompt-sse-into-store.md) — verifies TASK-0225 · pending
- [UAT-0227 — UAT: Replace activeTask with the last payload in the sidebar agent card](UAT-0227-sidebar-card-shows-last-payload.md) — verifies TASK-0227 · pending
- [UAT-0228 — UAT: Clear an agent's stored last payload when the agent is deleted, and verify clones keep separate payloads](UAT-0228-clear-last-payload-on-agent-delete.md) — verifies TASK-0228 · pending
- [UAT-0205 — UAT: Add a Background tab to the agent detail tablist listing the agent's project's bg processes](UAT-0205-agent-detail-background-tab.md) — verifies TASK-0205 · pending
- [UAT-0206 — UAT: Add a Restart action with confirmation on each process in the Background tab and on the bg process tile](UAT-0206-bg-restart-action-with-confirmation.md) — verifies TASK-0206 · pending
- [UAT-0231 — UAT: Fix false 'awaiting' (BUG-0013): guard awaiting with the busy footer and tighten AWAITING_PATTERN in monitor.sh and state.ts](UAT-0231-fix-false-awaiting-busy-guard-and-pattern-tightening.md) — verifies TASK-0231 · pending
- [UAT-0234 — UAT: Add a Read-Only Human-Audit Sampler for logs/transitions.jsonl](UAT-0234-human-audit-sampler-transitions-log.md) — verifies TASK-0234 · pending
- [UAT-0208 — UAT: Agent-driven bg-process restart — list, crash, tail, restart, cooldown, guard, audit, dashboard](UAT-0208-agent-driven-bg-restart.md) — verifies TASK-0208 · pending
- [UAT-0235 — UAT: Extend the Shared Pane-Fixture Harness to Cover stalled/exited (Beyond awaiting)](UAT-0235-fixture-harness-beyond-awaiting.md) — verifies TASK-0235 · pending
- [UAT-0233 — UAT: Stop stale .env vars (DATABASE_URL etc.) leaking into every tmux agent window](UAT-0233-stop-env-leak-into-tmux-windows.md) — verifies TASK-0233 · pending
