---
id: TASK-0209
aliases: [TASK-0209]
title: "Add a Create worktree item to the agent actions menu with reasoned disabled states"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: []
blocks: [TASK-0210, TASK-0214, TASK-0216, TASK-0218]
parallel_safe_with: []
uat: "[[UAT-0209]]"
tags: [worktree, agents, dashboard, frontend, actions-menu]
---

# TASK-0209 — Add a Create worktree item to the agent actions menu with reasoned disabled states

relates_to::[[worktree-on-any-agent]]
blocks::[[TASK-0210]]
blocks::[[TASK-0214]]
blocks::[[TASK-0216]]
blocks::[[TASK-0218]]

> **Roadmap**: ROADMAP-0025 Phase 1, item 1. Research: `raw/research/worktree-on-any-agent/index.md`.
> **Collision note**: edits `AgentDetailView`'s `agentActionItems` in `frontend/src/components/AgentList.tsx` — the same array TASK-0214 and TASK-0216 edit, so those three must be sequenced. Also touches `host-server/index.ts` (status payload only), but TASK-0211 also edits `AgentList.tsx` (AgentDetailView props) and `index.ts` (`pollAndDiff`), so sequence 0209 before 0211.

## Objective

Make the existing opt-in worktree action (`POST /agents/:id/worktree` → `addWorktreeToAgent`) reachable from the agent actions (kebab) menu on the detail view, not only from the Details tab's Worktree row (which is rendered only while the agent has no branch). The menu item is always present; it is **disabled with a visible reason** when the agent already has a worktree, or when its workdir is not inside a git repo. Worktrees stay opt-in and user-initiated (ROADMAP-007): nothing here auto-creates one.

## Approach

- **Reuse, don't fork.** `handleCreateWorktree()` (`AgentList.tsx` ~715) already calls `createWorktreeForAgent`, stores the result in `worktreeOverride`, and exposes `creatingWorktree`/`worktreeError`. The new menu item just calls it.
- **Disabled reasons.** `AgentActionsMenu` items currently support only `disabled` + a native `title`, and native tooltips do not show on disabled buttons in every browser. Add an optional `description` string to `AgentActionsMenuItem`, rendered as a small muted second line under the label whenever it is set (used for the disabled reason), so the reason is visible without hovering. Keep `title` as well.
- **"Not in a git repo" signal.** The frontend `Agent` shape has no such flag. Add an `inGitRepo: boolean` field to the per-agent status payload, computed by a new TTL-cached helper in `host-server/git.ts` (`isInGitRepoCached(workdir)`, 30 s TTL, keyed by workdir) so the 2 s status tick does not spawn `git rev-parse` per agent per tick. A missing/`undefined` `inGitRepo` on the client (older payload, SSE partial) is treated as "unknown → enabled" so the backend stays the authority (its 400 reason is surfaced by TASK-0210).
- **Where the state comes from.** "Already has a worktree" = `effectiveWorktreePath`/`effectiveBranch` (already computed in `AgentDetailView`, includes the local override right after a create).
- **Error visibility.** From the menu path the Details tab may not be the active tab, so `worktreeError` must also appear in the shared error banner (`AgentList.tsx` ~1150, the `renameError ?? roleError ?? closeError ?? removeError ?? cloneError` chain). Full reason fidelity (real git messages) is TASK-0210; this task only makes sure a failure is not silent.
- **Out of scope**: a second/replacement worktree for an agent that already has one (needs a data-model decision, see the roadmap Notes); restarting the live pane (TASK-0216).

## Steps

<!-- Updated: 2026-09-20 Step 1 complete (typecheck clean, git.test.ts 21/21) -->
### 1. Backend: cached git-repo signal on the status payload  <!-- agent: general-purpose -->

- [x] `host-server/git.ts`: add `isInGitRepoCached(workdir: string, now = Date.now()): boolean` backed by a module-level `Map<string, { value: boolean; at: number }>` with a 30 000 ms TTL, delegating to `getGitRoot(workdir) !== null`. Export a `__resetGitRepoCacheForTests()` (or accept an injectable clock) so the test does not depend on wall time.
- [x] `host-server/index.ts`: add `inGitRepo: boolean` to the `agents` element type of the status snapshot (~line 673) and populate it in `buildSnapshot` next to `...resolveAgentWorktree(agent)` (~2628) and in the no-session fallback of `GET /status` (~826).
- [x] `host-server/index.ts`: include `inGitRepo: agent.inGitRepo` in the two hand-built full `agent-update` payloads (SSE connect replay ~2485 and the periodic `pollAndDiff` broadcast ~2749). Add it AFTER `usage: agent.usage,` (never between `worktreePath`/`branch`/`role`: `host-server/sseRolePayloadParity.test.ts` regex-asserts those three fields are adjacent in the periodic payload). Do NOT add it to the change-detection predicate (it is derived from the workdir and only changes when the directory does; the frontend merge keeps the last value). The clone/spawn one-shot payloads are left to TASK-0215.
- [x] `host-server/git.test.ts`: cover `isInGitRepoCached` true for a repo, false for a plain directory, and that a second call within the TTL does not re-spawn git (assert via the injected clock and by removing `.git` between calls: cached value is still returned inside the TTL, refreshed after it).

<!-- Updated: 2026-09-20 Step 2 complete (typecheck clean, AgentActionsMenu.test.tsx 9/9; button JSX in .map() under-indented by one level, lint-clean) -->
### 2. Menu component: visible reason line  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentActionsMenu.tsx`: add `description?: string` to `AgentActionsMenuItem`; when present render it inside the item button as a second `<span className="mt-0.5 block whitespace-normal text-[11px] font-normal text-muted-2">` under the label (raise the item's `min-w` only if needed; keep `whitespace-nowrap` on the label line). Include it in the button's accessible description via `aria-describedby` (unique id per item) so screen readers announce why it is disabled.
- [x] `frontend/src/components/AgentActionsMenu.test.tsx`: add a case asserting a disabled item with `description` renders the text, is `disabled`, keeps the roving-focus behaviour of skipping disabled items (existing helpers), and exposes the description through `aria-describedby`.

<!-- Updated: 2026-09-20 Step 3 complete (typecheck clean; view is key={selectedAgent.id} so worktreeError resets on agent change; removed Details tab's inline worktreeError span to avoid a duplicate render with the banner; TASK-0210 finalises single render; Step 4 tests must not assert that inline span) -->
### 3. Wire the menu item in AgentDetailView  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.tsx` `Agent` interface (~44): add `inGitRepo?: boolean`.
- [x] In `agentActionItems` (~824) add, between `clone` and `add-bg-process`, `{ key: 'create-worktree', label: creatingWorktree ? 'Creating worktree…' : 'Create worktree', onSelect: () => { void handleCreateWorktree() }, disabled, description }` where:
  - `hasWorktree = Boolean(effectiveWorktreePath ?? effectiveBranch)`; when true: `disabled: true`, `description: 'Already has a worktree (' + effectiveBranch + ')'`, `title` the same text.
  - else when `agent.inGitRepo === false`: `disabled: true`, `description: 'Workdir is not inside a git repository'`.
  - else `disabled: creatingWorktree`, no description; `title: 'Opt in to an isolated git worktree + branch for this agent'` (same copy as the Details button).
- [x] Include `worktreeError` in the shared error banner chain at ~1150/1152 so a failure from the menu path is visible regardless of the active tab; clear it (`setWorktreeError(null)`) at the start of `handleCreateWorktree` (already done) and when the selected agent changes (the view is `key`ed by agent id, so this is automatic — confirm).
- [x] Leave the Details tab's inline "Create worktree" button in place (still useful context next to the Worktree row); both call the same handler and share `creatingWorktree`, so they cannot double-fire.

<!-- Updated: 2026-09-20 Step 4 complete (5 new tests + 2 existing menu-item-list assertions updated; vitest 184/184) -->
### 4. Frontend tests  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.test.tsx` (follow the existing AgentDetailView/actions-menu describe blocks, and mock `createWorktreeForAgent` in `../lib/api`): (a) an agent with no worktree and `inGitRepo: true` → open the menu, "Create worktree" is enabled, clicking it calls `createWorktreeForAgent(agent.id)` once and the branch badge (`⎇ conductor/<id>`) appears; (b) agent with `worktreePath`/`branch` set → item disabled and its description names the branch; (c) `inGitRepo: false` → disabled with the not-a-repo reason; (d) `inGitRepo` undefined → enabled; (e) a rejected `createWorktreeForAgent` shows the error text in the banner while the Details tab is NOT active.

<!-- Updated: 2026-09-20 Step 5 complete (host-server typecheck clean + 240/240 tests; frontend typecheck clean, lint 0 errors, vitest 184/184) -->
### 5. Verify  <!-- agent: general-purpose -->

- [x] `cd host-server && npm run typecheck && npm test` (targeted: `node --import tsx/esm --test git.test.ts`), `cd frontend && npm run typecheck && npm run lint && npx vitest run src/components/AgentActionsMenu.test.tsx src/components/AgentList.test.tsx`.
- [x] [DEFERRED-TO-UAT] Note for UAT (TASK-0218): confirm in a browser that the disabled reason line is readable in light and dark themes.

## Files expected to be touched

`host-server/git.ts`, `host-server/git.test.ts`, `host-server/index.ts`, `frontend/src/components/AgentActionsMenu.tsx`, `frontend/src/components/AgentActionsMenu.test.tsx`, `frontend/src/components/AgentList.tsx`, `frontend/src/components/AgentList.test.tsx`.

## Dependencies

- None blocking. **Blocks** TASK-0210 (same component/handler; the error-reason work builds on this surface), TASK-0214 (reuses the `inGitRepo` disabled reason and edits the same `agentActionItems`), TASK-0216 (edits `handleCreateWorktree`), TASK-0218 (UAT).
- Not parallel-safe with TASK-0211 (both edit `frontend/src/components/AgentList.tsx` and `host-server/index.ts`) or TASK-0212 (`host-server/git.ts`, downstream of TASK-0210). Run it first in Phase 1.
