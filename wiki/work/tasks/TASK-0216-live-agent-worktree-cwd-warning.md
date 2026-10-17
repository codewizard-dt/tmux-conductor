---
id: TASK-0216
aliases: [TASK-0216]
title: "Warn, and offer a restart in the worktree, when adding a worktree to an agent whose window is live"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0209, TASK-0213]
blocks: [TASK-0218]
parallel_safe_with: [TASK-0217]
uat: "[[UAT-0216]]"
tags: [worktree, agents, dashboard, frontend, tmux, hazard]
---

# TASK-0216 — Warn, and offer a restart in the worktree, when adding a worktree to an agent whose window is live

relates_to::[[worktree-on-any-agent]]
depends_on::[[TASK-0209]]
depends_on::[[TASK-0213]]
blocks::[[TASK-0218]]

> **Roadmap**: ROADMAP-0025 Phase 3, item 1. Research: `raw/research/worktree-on-any-agent/index.md` (Key Findings: "Adding a worktree to a **running** agent updates only the DB row; the live tmux pane keeps its original cwd").
> **Collision note**: `frontend/src/components/AgentList.tsx` (`handleCreateWorktree`, `agentActionItems`, the shared banner and ConfirmDialog block) and `frontend/src/lib/api.ts`. Sequence 0209 → 0214 → 0216. Frontend-only, so parallel-safe with TASK-0217.

## Objective

Creating a worktree for an agent whose tmux window is running must not silently mislead. The user is (1) warned **before** creating it that the running agent stays in its current directory, (2) after creating it, shown a persistent notice that the agent is not yet working in the worktree, and (3) offered a one-click **Restart in worktree** (with its own confirmation) that stops and relaunches the window so it starts inside the worktree. Agents with no window need no warning: the next window start already lands in the worktree (TASK-0213's `agentPaneCwd`).

## Approach

- **The hazard, precisely.** `addWorktreeToAgent` only writes `worktree_path`/`branch`. The live pane keeps its cwd, so the agent keeps editing the shared workdir while the dashboard now reports the worktree branch, diffs the worktree (`GET /agents/:id/diff` uses `worktreePath || workdir`), and takes pre-dispatch checkpoints of the worktree (`stashCheckpoint(agent.worktreePath)`), i.e. of a tree the agent is not touching. The agent's own changes therefore go undiffed and unprotected — worse than a cosmetic badge.
- **Chosen UX: warn-first + post-create restart offer (decided autonomously, per the roadmap's "product decision").** Alternatives considered: (a) auto-restart on create — rejected, it kills a possibly-busy session without consent, violating the opt-in principle; (b) block creation while the window is live — rejected, too restrictive when the user plans to restart anyway; (c) probe `#{pane_current_path}` to detect a mismatch — rejected as over-engineering for a one-shot action. ConfirmDialog supports a single confirm action, so the flow is two small dialogs rather than a bespoke one.
- **Single entry wrapper.** Both entry points (menu item from TASK-0209 and the Details tab button) call a new `requestCreateWorktree()`: if `agent.windowPresent` → open a `ConfirmDialog` ("`<name>` is running in `<workdir>`. A new worktree will not move the running agent; it keeps editing that directory until its window is restarted. Create the worktree anyway?" confirm label `Create worktree`); else call `handleCreateWorktree()` directly.
- **Persistent notice.** When a worktree is created while the window is live, set `worktreeNeedsRestart` and render a notice near the shared banner: "Worktree created, but `<name>` is still running in `<workdir>`. Restart its window to work inside `<worktreePath>`." with a **Restart in worktree** button. The notice clears on a successful restart, when the window disappears, or when the agent view is replaced (the view is `key`ed by agent id).
- **Restart in worktree.** New `restartAgentWindow(agentId)` in `api.ts`: `DELETE /api/agents/:id/window` then `POST /api/agents/:id/window` (existing routes; the POST respawns using `agentPaneCwd`, TASK-0213). Do **not** reuse `doCloseWindow()` — it calls `onClose()` and deselects the agent. Its confirmation states plainly that the running agent process is stopped and relaunched, in-flight work and conversation context are lost, and adds a stronger line when the agent status is `busy`/`awaiting`/`stalled`. If the DELETE succeeds and the POST fails, surface the POST error and leave the window-missing state to the existing "Create window" affordance.
- **Reuse hook-state behaviour.** The relaunched agent fires `SessionStart` (idle) as for any new window; no monitor/state-file changes are needed.

## Steps

### 1. API helper  <!-- agent: general-purpose -->

- [x] `frontend/src/lib/api.ts`: add `export async function restartAgentWindow(agentId: number): Promise<void>` — `DELETE ${API_BASE}/agents/${id}/window`, then `POST` the same URL; on any non-OK response throw `new Error(body.error ?? \`HTTP ${status}\`)` (same pattern as `cloneAgent`), with the stage in the message when the second call fails ("Window stopped but relaunch failed: …").
- [x] Add/extend `frontend/src/lib/api.test.ts` (create if absent, following how other helpers are tested or mocked): success sequence DELETE then POST; DELETE failure short-circuits (no POST); POST failure surfaces the staged message.

### 2. Warn-first wrapper and notice in AgentDetailView  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.tsx`: add state `confirmingWorktree`, `worktreeNeedsRestart`, `confirmingRestart`, `restarting`, `restartError`. Add `requestCreateWorktree()` (live window → `setConfirmingWorktree(true)`, else `void handleCreateWorktree()`); point the menu item's `onSelect` (TASK-0209) and the Details-tab button `onClick` at it. `handleCreateWorktree` sets `worktreeNeedsRestart` to `agent.windowPresent` on success.
- [x] Add the two `ConfirmDialog`s next to the existing ones (~1166–1179): create-anyway (message above, `confirmLabel="Create worktree"`, `onConfirm` closes then `void handleCreateWorktree()`), and restart (`confirmLabel="Restart"`, message per the approach, extra busy-state sentence built from `deriveStatus`/`agent.state`).
- [x] Render the persistent notice (amber/warning tone using existing token classes, `role="status"`) with the **Restart in worktree** button, placed with the shared error banner (~1150). `restartError` joins the banner chain. On success: clear `worktreeNeedsRestart` and the confirm state; do not call `onClose`.
- [x] Clear `worktreeNeedsRestart` when `agent.windowPresent` becomes false (implemented as a render-time state adjustment rather than an effect, to satisfy the repo's `react-hooks/set-state-in-effect` rule).

### 3. Tests  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.test.tsx` (mock `createWorktreeForAgent`, `restartAgentWindow`): (a) live window + menu "Create worktree" → the warning dialog appears and `createWorktreeForAgent` is **not** called until confirmed; cancelling leaves no call; (b) confirming creates the worktree and shows the notice with the Restart button; (c) no window (`windowPresent: false`) → no dialog, creation is immediate, no notice; (d) Restart → its confirm dialog (busy agent shows the extra warning) → `restartAgentWindow(agent.id)` called once, notice cleared, the view stays selected (no `onClose`); (e) restart failure shows the message in the banner and keeps the notice; (f) the Details-tab button follows the same warn-first path as the menu item.

### 4. Verify  <!-- agent: general-purpose -->

- [x] `cd frontend && npm run typecheck && npm run lint && npx vitest run src/components/AgentList.test.tsx src/lib/api.test.ts`.
- [DEFERRED-TO-UAT] Deferred to TASK-0218 (live tmux): on a running agent, create a worktree, confirm the warning, restart in worktree, then `tmux display -p -t <window> '#{pane_current_path}'` shows the worktree path and the Diff tab reflects edits the agent makes afterwards.

## Files expected to be touched

`frontend/src/components/AgentList.tsx`, `frontend/src/components/AgentList.test.tsx`, `frontend/src/lib/api.ts`, `frontend/src/lib/api.test.ts` (new if absent).

## Dependencies

- **Depends on** TASK-0209 (the menu item and `handleCreateWorktree` surface it wraps), TASK-0213 (`agentPaneCwd` in `spawnAgentWindow` is what makes a restart actually land in the worktree; without it this task's restart would relaunch in the same directory).
- **Blocks** TASK-0218 (UAT).
- Parallel-safe with TASK-0217 (host-server only). Not parallel-safe with TASK-0209/0214 (same `AgentList.tsx` regions).
