---
topic: Collapse the AgentDetailModal action buttons (Rename/Close agent/Remove agent) into a 3-dot dropdown, and add a new button that duplicates the current agent with the same settings
slug: agent-modal-actions-dropdown
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Collapsing Agent Modal Actions into a Dropdown + Adding Clone

> The "add duplicate" half of this request is **already fully scoped and unstarted** as [TASK-134](../../../wiki/work/tasks/TASK-134-clone-agent-button.md) ("Clone button in AgentDetailModal") — a `POST /agents/:id/clone` route plus a fourth flat button. The "collapse to a 3-dot menu" half has no existing plan and no existing dropdown/menu component anywhere in the frontend to reuse — it needs a small hand-rolled `role="menu"` component built to the WAI-ARIA Actions-Menu-Button pattern [S6]. The two should be done as one task: build the dropdown first, then land Clone as a menu item inside it (not as a fifth flat button), since TASK-134 as currently written would make the exact clutter problem this request is about to fix worse.

## Research Questions
- Where do the three current action buttons live, and what does each one currently do?
- Does a dropdown/menu UI pattern already exist anywhere in this frontend to reuse?
- Is "duplicate agent" already planned or implemented anywhere in the codebase?
- What agent fields/settings would a duplicate need to carry over, and does a create-agent code path already exist to reuse?
- What's the accessible, dependency-free way to build a 3-dot actions menu given this frontend's stack?

## Current State (Codebase)

**Component**: `AgentDetailModal` in `frontend/src/components/AgentList.tsx:514-869`, rendered via `createPortal` as a full-viewport modal (`role="dialog"`). The action row is the `<div className="ml-auto flex flex-shrink-0 items-center gap-2">` block at `AgentList.tsx:703-763`, immediately inside the modal header. `InactiveAgentsPanel.tsx:154` also renders this same `AgentDetailModal`, so any change to the action row automatically applies to agents opened from the inactive-agents view too — no second component to update.

Screenshot shows three buttons: **Rename** (blue outline), **Close agent** (amber outline), **Remove agent** (plain text). Verified against source:

```tsx
<div className="ml-auto flex flex-shrink-0 items-center gap-2">
  {/* Agent actions — each styled distinctly: rename (blue), close (amber), remove (red). */}
  {!showRenameInput ? (
    <button onClick={() => { setRenameInput(agent.name); setShowRenameInput(true); setRenameError(null) }}
      className="... border-accent-blue/30 bg-accent-blue/5 ... text-accent-blue ...">Rename</button>
  ) : (
    <> {/* inline <input> + Save + Cancel buttons, replaces the Rename button in place */} </>
  )}
  {agent.windowPresent && (
    <button onClick={() => { setConfirmingClose(true) }} disabled={closing}
      title="Kill the tmux window but keep the agent registered"
      className="... border-[#e0901a]/40 bg-[#e0901a]/5 ... text-[#c07a10] ...">
      {closing ? 'Closing…' : 'Close agent'}
    </button>
  )}
  <button onClick={() => { setConfirmingRemove(true) }} disabled={removing}
    title="Unregister the agent and remove it" className="...">
    {removing ? 'Removing…' : 'Remove agent'}
  </button>
  <span className="mx-0.5 h-5 w-px bg-line" aria-hidden="true" />
  {agentCount > 1 && ( /* prev/next agent-nav buttons, hidden below sm: */ )}
</div>
```
[S1]

Handlers, all inside `AgentDetailModal`:
- **Rename** — clicking swaps the button for an inline `<input>` (autofocus, `pattern="[A-Za-z0-9_-]+"`) + Save/Cancel. Save calls `handleRename()` (`AgentList.tsx:657-671`) → `renameAgent(agent.id, trimmed)` (a `frontend/src/lib/api.ts` client call, `PATCH /agents/:id`) → `onRenamed?.(agent.id, trimmed)` optimistic update. Enter/Escape are wired on the input itself. [S1]
- **Close agent** — only rendered when `agent.windowPresent`; sets `confirmingClose`, gated behind a `<ConfirmDialog>` (`AgentList.tsx:914-922`, message: *"Close agent "X"'s window? The agent stays registered and can be relaunched with 'Create window'."*) → `doCloseWindow()` → `DELETE /agents/:id/window`. [S1]
- **Remove agent** — sets `confirmingRemove`, gated behind a second `<ConfirmDialog>` (`AgentList.tsx:907-913`, message: *"Remove agent "X"? This kills its tmux window, deletes it from conductor.conf, and drops its queued tasks."*) → `doRemove()` (`AgentList.tsx:623-628`) → `DELETE /agents/${agent.id}`. [S1]

Both destructive actions route through the same `ConfirmDialog` component already, independent of which control triggers them — moving their triggers into dropdown menu items requires no new confirmation plumbing.

**No dropdown/menu/popover component exists anywhere in `frontend/src/components/`**, and no headless-UI dependency (Radix, Headless UI, etc.) is present in `frontend/package.json` — only `@dnd-kit/*`, `@xterm/*`, `react`, `react-dom`, `react-router-dom`. A 3-dot menu has to be hand-built. [S2][S3]

**"Duplicate agent" is already fully planned, not yet implemented**: [TASK-134](../../../wiki/work/tasks/TASK-134-clone-agent-button.md), status `todo`, created 2026-08-15, still active (not archived, no PR against it found). It specifies, in full:
- `host-server/db.ts`: a `<name>-copy` / `-copy-2` / … unique-name helper modeled on the existing `nextAgentName()` (~line 514), scoped the same way as the existing `idx_agents_project_name` / `idx_agents_null_name` uniqueness indexes.
- `host-server/index.ts`: new `POST /agents/:id/clone` route (near `POST /agents` ~line 915 and `PATCH`/`DELETE /agents/:id`) that loads the source via `getAgentById`, derives the new name, and calls the existing `createAgent(db, { name, workdir, launchCmd, projectId, role, useWorktree })` — i.e. clone is "a pre-filled call into the existing create-agent machinery, not a new data model." `useWorktree` is set to `Boolean(source.worktreePath)` so a worktree-backed agent clones into a fresh worktree + branch, a plain agent clones into the same shared workdir.
- `frontend/src/lib/api.ts`: new `cloneAgent(id)` calling the route.
- `frontend/src/components/AgentList.tsx`: a **fifth flat button** ("Clone", green/teal accent) in the same action row, fired immediately on click (no `ConfirmDialog` — cloning is non-destructive), with an open question about whether `InactiveAgentsPanel` should show it too. [S4]

**Agent fields a clone must carry** (`host-server/db.ts:17-28`, `Agent` type / `agents` table): `id, name, workdir, launchCmd, projectId, projectName, worktreePath, branch, role, createdAt`. Everything a clone needs (`workdir`, `launchCmd`, `role`, `projectId`, worktree flag) is already exposed on the in-memory `Agent` object the modal already holds — no extra fetch required before calling `cloneAgent(agent.id)`. `AddAgentForm.tsx` confirms this is the complete settings surface: it collects exactly `name/workdir/launchCmd/role/useWorktree`, nothing else. [S5]

## Key Findings

1. The duplicate-agent backend/API work is a solved design problem already (TASK-134) — the only genuinely new engineering here is the dropdown UI itself. [S4]
2. TASK-134's own plan, if executed as literally written, **adds a fourth flat button**, which runs directly against this request's actual goal (fewer buttons, not more). The two pieces of work should be sequenced as one: build the dropdown, then implement Clone as a menu item in it. [S4]
3. Close/Remove already fire through `ConfirmDialog`, decoupled from the trigger control — no new confirmation plumbing needed when moving them into a menu. [S1]
4. Rename is the odd one out: today it swaps the button itself for an inline input+Save/Cancel in place. Inside a closed dropdown there's no "in place" to swap to, so Rename needs a different treatment than Close/Remove/Clone (see Recommendation). [S1]
5. `InactiveAgentsPanel.tsx` reuses `AgentDetailModal` directly, so the dropdown lands there automatically — it is not a second component to touch, unlike the open question TASK-134 raised (that question applies to whether Clone should be *enabled* there, not whether it needs separate UI code). [S1]
6. No dependency exists today to build a menu from (no Radix/Headless UI) — WAI-ARIA's Actions Menu Button pattern is the reference spec: `aria-haspopup="true"` on the trigger, `role="menu"`/`role="menuitem"` on the panel/items, Enter/Space open and focus the first item, Up/Down/Home/End/Escape drive the open menu, click-outside and Escape close it. [S6][S7]

## Constraints

- Any new dropdown must not disturb the modal's existing global `keydown` listener (Escape-closes-modal, `⌥F` expand toggle) — a menu's own Escape handler needs to stop propagation while open, the same way `LogTail`'s own keydown handling already coexists with the modal-level listener for `⌥F` (established pattern; see the related `agent-detail-modal-redesign` report [S1] for how that coexistence works today).
- `agent.windowPresent` currently conditionally hides "Close agent" entirely rather than disabling it — a menu item should reproduce this (omit the item, or show and disable it with the same title text) rather than always showing all four actions regardless of state.
- Rename's current UX (inline input replacing the button) has no natural equivalent inside a closed menu; a design decision is needed here (see Recommendation).
- No new npm dependency is required or justified for a single 3-4-item menu in a small local single-user dashboard — pulling in Radix/Headless UI for this would be disproportionate.

## Solution Comparison

| Criteria | A: Ship TASK-134 as-is, dropdown separately/never | B: Dropdown first, Clone lands inside it (recommended) | C: Hybrid — keep Rename visible, dropdown only for Close/Remove/Clone |
|----------|----|----|----|
| **Approach** | Add Clone as a 4th flat button per TASK-134's literal spec; collapsing is a separate, independent future task | Build a hand-rolled `role="menu"` actions dropdown; move Rename/Close/Remove into it; add Clone as a 4th menu item, not a button | Keep "Rename" as the one visible button (most common, has its own inline-edit UX); collapse Close/Remove/Clone into a 3-dot menu next to it |
| **Pros** | Zero new UI risk; matches an already-approved task exactly | Solves both halves of the request in one pass; fewer total controls in the header; matches the user's literal ask | Rename keeps its existing inline-edit interaction untouched; smaller diff on the trickiest button |
| **Cons** | Makes the header row more cluttered, the opposite of what was asked | Rename's inline-edit UX must be adapted (see below) | Still 2 visible controls instead of 1; doesn't fully match "collapse these action buttons" (plural) from the request |
| **Complexity** | Low | Medium (new accessible menu component + Rename UX rework) | Medium (same menu component, smaller Rename rework) |
| **Dependencies** | None | None (hand-rolled, no new npm package) | None |
| **Codebase fit** | Fits `createAgent()`/route conventions perfectly; UI fit is poor | Fits — `ConfirmDialog` already decouples trigger from action for 2 of 3 existing actions | Fits |
| **Maintenance** | Low now, more later when collapsing is eventually done anyway | One coherent change | Slightly more surface (two interaction patterns: menu + standalone button) |

## Recommendation

**Go with Option B.** Build one small accessible dropdown component and route all four actions (Rename, Close agent, Remove agent, Clone) through it, superseding TASK-134's literal "add a fourth flat button" step with "add a fourth menu item."

Implementation outline:
1. **New component**, e.g. `frontend/src/components/AgentActionsMenu.tsx`: a trigger `<button aria-haspopup="true" aria-expanded={open} aria-label="Agent actions">⋮</button>` plus a `role="menu"` panel, following the WAI-ARIA Actions Menu Button pattern [S6][S7]: click/Enter/Space toggles and focuses the first `role="menuitem"`; Up/Down moves focus (roving `tabIndex`); Escape and outside-click close it and return focus to the trigger; the component takes an `items: {label, onSelect, disabled?, title?}[]` prop so it stays generic.
2. **Rename**: since there's no "in place" swap available from a closed menu, on selecting "Rename" close the menu and re-render the *existing* inline input+Save/Cancel UI in the same header slot the trigger occupies (i.e. `showRenameInput` continues to control an inline edit affordance, just no longer nested under a visible "Rename" button — the menu item becomes the only way to reach it). This reuses `handleRename()`/`renameAgent()` unchanged.
3. **Close agent / Remove agent**: menu items call the existing `setConfirmingClose(true)` / `setConfirmingRemove(true)`, unchanged — both `ConfirmDialog`s already render independently of the trigger control, so no rework needed beyond wiring the `onSelect`. Preserve the `agent.windowPresent` gate (omit or disable-with-title the Close item when no window exists).
4. **Clone** (from TASK-134, adapted): implement TASK-134 Steps 1–2 unchanged (`host-server/db.ts` naming helper + `getAgentById`, `POST /agents/:id/clone` route, `cloneAgent()` API client). For Step 3, add "Clone" as a menu item instead of a flat button, firing `cloneAgent(agent.id)` immediately (non-destructive, no `ConfirmDialog`), same as TASK-134 already specifies for the click behavior itself — only the *presentation* (menu item vs. button) changes from the original task text.
5. Keep the divider (`<span className="mx-0.5 h-5 w-px bg-line" />`) and prev/next agent-nav controls outside the menu — those aren't "actions" on the agent, they're modal navigation, and collapsing them in would bury a frequently-used control behind an extra click.

## Risks and Mitigations

- **Focus management bugs are the most common source of inaccessible custom menus** — mitigate by following the WAI-ARIA APG example structure closely [S6][S7] rather than improvising, and test keyboard-only (Tab to trigger, Enter to open, arrows to move, Enter to activate, Escape to close and return focus to trigger).
- **Escape-key conflict**: the modal already closes on Escape via a global listener; the menu's own Escape handler must `stopPropagation()` while open so Escape closes the menu first, then the modal on a second press — mirror how `⌥F` handling already coexists with the modal-level listener today.
- **Rename regression**: verify the reworked Rename entry point still supports Enter-to-save/Escape-to-cancel on the inline input exactly as today, since that keyboard path is unrelated to the new menu's own keyboard handling and must keep working independently.
- **TASK-134 scope drift**: update TASK-134's Step 3 (or supersede it with a new task) before implementation so it says "menu item" not "button," to avoid someone implementing it literally and re-cluttering the row this work just cleaned up.

## Next Steps

- `/task-add Build an accessible 3-dot actions dropdown in AgentDetailModal (WAI-ARIA menu-button pattern) collapsing Rename/Close agent/Remove agent, and implement TASK-134's clone-agent feature (POST /agents/:id/clone + cloneAgent() client) as a fourth menu item instead of a flat button` — implementation-ready scope combining both halves of this request.
- Alternatively, since TASK-134 is unstarted and fully scoped for the backend/API half, consider amending it directly (`/task-update TASK-134`) to fold in the dropdown-collapse requirement rather than creating a net-new task, since most of its Steps 1–2 (host-server route + API client) carry over unchanged.
- Manually verify in the browser after implementation: keyboard-only operation of the new menu (Tab/Enter/Arrows/Escape), Rename still works via its inline input reached through the menu, Close/Remove still show their existing `ConfirmDialog`s, Clone creates a new agent visible via the existing `agent-update` SSE broadcast with no local state patching needed.
