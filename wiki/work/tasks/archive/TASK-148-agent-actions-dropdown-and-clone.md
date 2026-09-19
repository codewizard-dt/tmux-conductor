---
id: TASK-148
aliases: [TASK-148]
title: "Collapse AgentDetailModal actions into a 3-dot dropdown and add Clone"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-148]]"
tags: [frontend, host-server, accessibility]
---

# TASK-148 — Collapse AgentDetailModal actions into a 3-dot dropdown and add Clone

## Objective

Replace the three flat header buttons in `AgentDetailModal` (Rename, Close agent, Remove agent — `frontend/src/components/AgentList.tsx:703-763`) with a single accessible 3-dot actions dropdown, and add a **Clone** action that duplicates the open agent (same workdir, launch command, role, project, and worktree setting) as a fourth item in that same menu. This absorbs `wiki/work/tasks/TASK-134-clone-agent-button.md`'s backend/API design in full — TASK-134 is being trashed as part of this task since its own UI step ("add a fourth flat button") is superseded by "add as a menu item." Full research backing this task: `raw/research/agent-modal-actions-dropdown/index.md`.

## Approach

**No dropdown/menu component or icon library exists anywhere in `frontend/src/components/` today** — every existing icon (the ✕ close button and ⌥F expand/collapse icons, both already in this exact modal) is a hand-inlined `<svg>`, and `frontend/package.json` has no UI-menu dependency (only `@dnd-kit/*`, `@xterm/*`, react-family, `react-router-dom`). Per explicit user decision, this task adds `lucide-react` as the frontend's first icon-library dependency (used for the 3-dot trigger icon), and hand-builds the menu itself following the **W3C WAI-ARIA Authoring Practices "Actions Menu Button" pattern** (`https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/`): trigger with `aria-haspopup="true"`/`aria-expanded`, panel with `role="menu"`, items with `role="menuitem"`, `Enter`/`Space` opens and focuses the first item, `Up`/`Down` move a roving focus, `Escape`/outside-click close and return focus to the trigger.

Per-action wiring inside the new menu:
- **Close agent** / **Remove agent** already route through the existing `<ConfirmDialog>` component independent of their trigger control (`AgentList.tsx:907-922`) — moving their `onClick` into a menu item's `onSelect` needs no new confirmation plumbing. Preserve the current `agent.windowPresent` gate on Close agent (currently the whole button is omitted when no window exists — reproduce this by omitting or disabling that menu item with its existing title text).
- **Rename** currently swaps its own button for an inline `<input>` + Save/Cancel in place (`AgentList.tsx:705-742`) — a closed menu has no "in place" to swap into. On selecting "Rename," close the menu and render that same existing inline input in the header slot the trigger now occupies (reuse `handleRename()`/`renameAgent()`/`showRenameInput` state unchanged — only the entry point changes).
- **Clone** is non-destructive — no `ConfirmDialog` — fires `cloneAgent(agent.id)` immediately on selection, mirroring `POST /agents`'s existing spawn-window + immediate-SSE-broadcast pattern (`host-server/index.ts:993-1060`) so the new agent appears via the existing `agent-update` SSE event with no local state patching needed.
- `InactiveAgentsPanel.tsx:154` renders this same `AgentDetailModal` — the dropdown change covers both call sites with this one edit; no second component to touch.

A new document-level `Escape` handler inside the menu component must `stopPropagation()` while the menu is open, so `Escape` closes the menu first and the modal's own Escape-closes listener fires only on a second press (mirrors how the existing `⌥F` handling already coexists with that same modal-level listener today).

## Steps

<!-- Updated: 2026-09-13 15:30 -->

### 1. Add lucide-react dependency <!-- agent: general-purpose -->

- [x] In `frontend/`, run `npm install lucide-react` (latest is `1.44.0` as of 2026-09-13; verify React 19 peer-compatibility during install, it should resolve cleanly against `react@^19.2.7`). (Installed directly by David after the package-install consent gate refused it from any agent context; `"lucide-react": "^1.44.0"` confirmed in package.json.)
- [x] Confirm `npm run typecheck` and `npm run lint` still pass with the new dependency present but unused (sanity check before using it in Step 4). (typecheck clean; lint has 3 pre-existing errors + 3 warnings in `AgentList.test.tsx`/`AgentList.tsx`/`LogTail.tsx` unrelated to lucide-react, which isn't imported anywhere yet — confirmed via `npm list lucide-react`: resolved cleanly at `1.44.0`, no ERESOLVE/peer conflicts with React 19.)

### 2. Host-server: clone-name helper + POST /agents/:id/clone route <!-- agent: general-purpose -->

- [x] In `host-server/db.ts`, add an exported helper (e.g. `deriveCloneName(db: Database.Database, source: Agent): string`) near `nextAgentName` (~line 516): starting from `${source.name}-copy`, check for a collision the same way `createAgent` ultimately validates uniqueness — query existing agent names scoped the same way (`WHERE project_id = ?` when `source.projectId` is set, `WHERE project_id IS NULL` otherwise) — and if taken, try `-copy-2`, `-copy-3`, … until a free name is found. `getAgentById(db, id)` already exists (`host-server/db.ts:547`) — no need to add it, TASK-134's note that it might be missing does not apply.
- [x] In `host-server/index.ts`, add `api.post<{ Params: { id: string } }>('/agents/:id/clone', async (req, reply) => { ... })` near the existing agent routes (`POST /agents` at line 993, `DELETE /agents/:id` at line 1345, `PATCH /agents/:id` at line 1397). Handler:
  - Parses `id`, 400s on `isNaN`.
  - Loads the source via `getAgentById(db, agentId)`; 404s with `{ error: 'agent <id> not found' }` if missing (matches the existing 404 shape used by `DELETE /agents/:id`).
  - Derives the new name via the Step 2 helper.
  - Calls `createAgent(db, { name: derivedName, workdir: source.workdir, launchCmd: source.launchCmd, projectId: source.projectId ?? undefined, role: source.role, useWorktree: Boolean(source.worktreePath) })` — this is the same call `POST /agents` makes (`host-server/index.ts:1039`), just pre-filled from `source` instead of the request body.
  - Spawns the tmux window (`spawnAgentWindow(newAgent, conf)`) and broadcasts the `agent-update` SSE event immediately, copying `POST /agents`'s exact post-create block (`host-server/index.ts:1040-1057`) so the clone appears live without waiting for the next poll tick.
  - Returns `reply.status(201).send({ ok: true, agent: newAgent })`, matching `POST /agents`'s response shape exactly so the frontend client can reuse the same response type.

### 3. Frontend API client <!-- agent: general-purpose -->

- [x] In `frontend/src/lib/api.ts`, add `cloneAgent(agentId: number): Promise<ApiAgent>` following the exact style of `renameAgent` (`api.ts:311-322`): `POST ${API_BASE}/agents/${agentId}/clone`, no body, parse `{ agent: ApiAgent }` from the response and return `.agent`, throw `Error(body.error ?? 'HTTP <status>')` on a non-ok response.

### 4. New AgentActionsMenu component <!-- agent: general-purpose -->

- [x] Create `frontend/src/components/AgentActionsMenu.tsx`: a generic accessible actions-menu component taking `items: { key: string; label: string; onSelect: () => void; disabled?: boolean; title?: string; tone?: 'default' | 'danger' | 'warning' }[]`.
  - Trigger: `<button type="button" aria-haspopup="true" aria-expanded={open} aria-label="Agent actions">` rendering lucide-react's `MoreVertical` (or `EllipsisVertical`, whichever ships in `1.44.0` — verify the exact export name after install) icon, sized to match the existing `h-7` action-button row height.
  - Panel: `<div role="menu">` with `<button role="menuitem" tabIndex={...}>` children using roving `tabIndex` (0 on the currently-focused item, -1 on the rest), positioned `absolute` under the trigger.
  - Keyboard: `Enter`/`Space` on the trigger opens the menu and focuses the first item; `ArrowDown`/`ArrowUp` move focus between items (wrapping); `Escape` closes the menu, calls `event.stopPropagation()`, and returns focus to the trigger; `Home`/`End` jump to first/last item.
  - Click-outside: a `document` `mousedown` listener (attached only while open) that closes the menu when the click target is outside a wrapper `ref`.
  - No new npm dependency beyond `lucide-react` from Step 1 — everything else is plain React state/refs.

### 5. Wire the menu into AgentDetailModal <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, replace the three-button block (`AgentList.tsx:703-763`, from the `{/* Agent actions ... */}` comment through the closing of the Remove-agent button) with a single `<AgentActionsMenu items={...} />`, keeping the existing inline-rename `<input>`/Save/Cancel markup (`AgentList.tsx:713-741`) rendered instead of the trigger whenever `showRenameInput` is true (same conditional structure as today, just no longer nested under a visible "Rename" button).
  - `items` array, in order: Rename (`onSelect: () => { setRenameInput(agent.name); setShowRenameInput(true); setRenameError(null) }`), Close agent (`onSelect: () => { setConfirmingClose(true) }`, omitted/disabled when `!agent.windowPresent`, `disabled: closing`), Remove agent (`onSelect: () => { setConfirmingRemove(true) }`, `disabled: removing`), Clone (`onSelect: () => { void handleClone() }`).
  - Add `const [cloning, setCloning] = useState(false)` and `const [cloneError, setCloneError] = useState<string | null>(null)` near the other action state (`AgentList.tsx:531-540`), and `async function handleClone() { ... }` near `handleRename`/`doRemove` (`AgentList.tsx:623-671`) calling `cloneAgent(agent.id)` inside try/catch, setting `cloneError` on failure — no dialog, no local state patch needed (the SSE `agent-update` broadcast from Step 2 updates `AgentList`'s grid the same way the existing needs-attention/rename paths already rely on SSE + optimistic patching).
  - Keep the divider (`<span className="mx-0.5 h-5 w-px bg-line" />`) and the `agentCount > 1` prev/next nav buttons (`AgentList.tsx:743-763` region, adjust exact line numbers after Step 4/5 edits land) **outside** the new menu — those are modal navigation, not agent actions, and burying them behind a click would regress a frequently-used control.

### 6. Manual verification <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Via `/run` or `make dev`: open an agent's modal, verify the 3-dot trigger renders, keyboard-only operation works (Tab → trigger, Enter opens + focuses first item, Arrow keys move focus, Enter activates, Escape closes and returns focus to trigger, a second Escape then closes the modal).
- [DEFERRED-TO-UAT] Verify Rename still works end-to-end via its inline input reached through the menu (Enter to save, Escape to cancel).
- [DEFERRED-TO-UAT] Verify Close agent (only present when a window exists) and Remove agent still show their existing `ConfirmDialog`s with unchanged messages.
- [DEFERRED-TO-UAT] Verify Clone creates a new `<name>-copy` agent visible in the agent grid via the SSE broadcast, with no page reload.
- [DEFERRED-TO-UAT] Verify `InactiveAgentsPanel.tsx`'s agents also show the new dropdown (same modal, same code path).

## Notes

- Supersedes and absorbs `wiki/work/tasks/TASK-134-clone-agent-button.md` in full — TASK-134 is trashed as part of filing this task (per explicit user decision), not left open alongside it.
- Agent name uniqueness is enforced per-project (`idx_agents_project_name`) or globally when `projectId IS NULL` (`idx_agents_null_name`) — the Step 2 naming helper must respect this scoping, and `createAgent()`'s own tmux-window-name collision guard (`host-server/db.ts:560-566`) provides a second, independent layer of protection against an unaddressable duplicate window name.
- `lucide-react` is a net-new frontend dependency — this is the first icon library in the project; verify its bundle-size impact is acceptable (tree-shakeable per-icon imports, e.g. `import { MoreVertical } from 'lucide-react'`, not a barrel import of the whole set) during Step 1.
- **Renumbered from TASK-147 to TASK-148** immediately after creation: a concurrent session independently created a different, unrelated `TASK-147-fix-modifier-arrow-terminal-navigation.md` at the same time, so the original TASK-147 id assigned to this task collided and was bumped to the next free number.
