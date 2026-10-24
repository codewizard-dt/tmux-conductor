---
id: agent-detail-modal
title: AgentDetailModal
aliases: [AgentDetailModal.tsx]
updated: 2026-09-20
sources:
  - ../../../raw/research/project-file-tree/index.md
  - ../../../raw/research/worktree-on-any-agent/index.md
  - ../../../raw/research/agent-detail-modal-redesign/index.md
confidence: extracted
tags: [frontend, component, modal, ux]
---

# AgentDetailModal

`AgentDetailModal` — function inside `frontend/src/components/AgentList.tsx:514-869` (not a separate file). Full-viewport agent detail overlay, rendered via `createPortal` into `document.body`. Opened from an `AgentItem` card in `AgentList`, one instance at a time.

**Layout, top to bottom** (inside `<div className="flex flex-col flex-1 overflow-hidden p-5">`, `AgentList.tsx:733`):
1. Header row — name/label, `ProjectBadge`, `StatusBadge`, `AgentTypeBadge`, `RoleBadge`, `ContextMeter`, needs-attention flag, Rename/Close-agent/Remove-agent buttons, `⌘←/→` agent-nav hints, close button.
2. A `grid md:grid-cols-[1fr_1.5fr]` row holding **Details** (Command/Workdir/Window, `uses::[[mode-switcher]]`, conditional "Create window") and **Queued Tasks** (`TaskList` + `AddTaskForm`) — the only section in the modal that is *not* a collapsed `<details>`, unlike every panel below it.
3. `uses::[[log-tail]]` (`flex-1 min-h-0`) — gets whatever vertical space is left over after everything else above and below it.
4. Skills, `DiffPanel`, `UsageBreakdown`, `CheckpointList` — all already default-collapsed `<details>` one-liners.

**State it owns**:
- `logExpanded` (`useState(false)`) — "terminal fullscreen" mode: hides the Details/Queued-Tasks grid and all four `<details>` panels below the terminal, and drops LogTail's `mt-5 border-t` styling. Toggled by a document-level `keydown` listener matching `isLogExpandShortcut` (`⌥F`, `AgentList.tsx:74-76`) that runs *before* the Escape-closes-modal handler, plus whatever `LogTail`'s own `onToggleExpand` prop triggers (icon button, its own `⌥F` handler when `interacting`).
- `interacting` (mirrored from `LogTail` via `onInteractChange`) — used so Escape closes the modal only when the terminal isn't capturing keys directly.
- `armInteract` prop, computed into `interactSignal` (`armInteract ? 1 : 0`) passed to `LogTail` — the mechanism that auto-arms Direct Input when the modal is opened from the needs-attention "Direct Input — needs you" card CTA (`AgentItem`, `AgentList.tsx` ~L928-938).

**2026-08-15 redesign research** (`derived_from::[[agent-detail-modal-redesign]]`): recommends collapsing the Details+Queued-Tasks grid into the same `<details>` pattern already used by Skills/Diff/Usage/Checkpoints (freeing terminal space with no new components), making Direct Input the unconditional default on every `LogTail` mount rather than only on the CTA path, and adding `onDoubleClick={onToggleExpand}` on the terminal container to reuse the existing `logExpanded` fullscreen mechanism. Full citations and code-level proposal in `raw/research/agent-detail-modal-redesign/index.md`.

**2026-08-15 notification-banner research** (`relates_to::[[agent-status-notifications]]`): the planned dashboard notification-banner feature (fires on `awaiting`/`empty` transitions) reuses this exact `armInteract`/`interactSignal` mechanism for its click-to-focus behavior — same `setExpandedAgent({ id, armInteract: true })` call the needs-attention CTA already makes, no new modal-opening path.

**2026-09-13 re-ask, unresolved scope note**: the same feature re-surfaced as "toast messages... click switches to that agent," phrasing that doesn't specify whether the click should arm Direct Input (`armInteract: true`, the 08-15 assumption) or just open the modal plain (`armInteract: false`, the same call the ordinary `AgentItem` card click already makes). Still open pending product Q&A — see `uses::[[accessible-toast-notification-pattern]]` for the accessibility rules a click handler must obey either way (never auto-focus on toast *appearance*, only on explicit click).

**2026-09-13 header action-row research** (`derived_from::[[agent-modal-actions-dropdown]]`): the header's Rename/Close-agent/Remove-agent buttons (`AgentList.tsx:703-763`) have no dropdown/menu equivalent anywhere in the frontend today. Research recommends collapsing them into a hand-built 3-dot `role="menu"` (WAI-ARIA Actions Menu Button pattern — see `uses::[[accessible-dropdown-menu-pattern]]`), and implementing the already-planned `wiki/work/tasks/TASK-134-clone-agent-button.md` Clone feature as a fourth **menu item** rather than the fifth flat button TASK-134's UI step currently specifies. `InactiveAgentsPanel.tsx` renders this same modal, so the change covers both call sites with one edit. Full detail in `raw/research/agent-modal-actions-dropdown/index.md`.

**2026-09-13 further-simplification research** (`derived_from::[[agent-modal-simplification]]`): confirms the 08-15 redesign's three recommendations are now all shipped in the current source (collapsed `<details>` rows above the terminal, Direct-Input default-on via a one-shot effect in `LogTail`, double-click-to-fullscreen wired on the terminal container). Finds two fresh, previously-unexamined sources of clutter: the header's four near-identical pill badges (`AgentTypeBadge` and `RoleBadge`, `AgentList.tsx:148-164` and `196-208`, are structurally identical colored-dot components differing only in the field read) and six independently-toggled `<details>` accordions in one modal, with the Skills panel double-nesting a second `<details>` for its User-skills sub-list. Recommends (low-risk first): ship the still-unimplemented actions dropdown minus the trashed Clone feature, merge `AgentTypeBadge`+`RoleBadge` into one pill, and flatten the Skills panel's nested disclosure; defers a riskier tabbed consolidation of the four bottom accordions pending product sign-off.

**2026-09-13 tabbed-consolidation go/no-go** (`derived_from::[[tabbed-agent-info-consolidation]]`): resolved ROADMAP-021 Phase 4's deferred question — **no-go**. Skills/Diff/Usage/Checkpoints stay four independent stacked `<details>` accordions rather than merging into a tabbed "Agent info" panel. Three of the four (`DiffPanel`, `UsageBreakdown`, `CheckpointList`) already return `null`/aren't mounted at all when they have nothing to show, so on the common case only one or two panels render — the content shape (many short, often-empty, non-comparative sections) is the textbook accordion case per UX guidance (NN/g, LogRocket), and a hand-built tabs widget would cost real WAI-ARIA/roving-tabindex work with no existing tab primitive in `frontend/package.json`. Filed as `ADR-0002#D1`, status `accepted`. **Reversed same day** — see the entry directly below.

**2026-09-13 tabbed-consolidation reversal, Terminal tab added**: the owner gave explicit direction reversing `ADR-0002#D1` — tabs are wanted after all, now with a fifth tab, **Terminal**, that the original research never considered. Confirmed explicitly: the terminal (`LogTail`) moves *into* the tab set as the default-active tab, replacing its current always-visible position, rather than staying always-visible alongside a merely-additional Terminal tab. This is a materially bigger change than `ADR-0002` evaluated — it touches the modal's primary interaction model (terminal-first, per `TASK-131`), not just the four secondary info panels — so `TASK-131`'s Direct-Input-default-on-mount behavior and the notification/CTA `armInteract`/`interactSignal` auto-focus flow both need to force the Terminal tab active on open, or their auto-focus lands on a hidden panel. Filed as `ADR-0005#D1` (supersedes `ADR-0002#D1`), status `accepted`. Implementation tracked as `TASK-157` (`ROADMAP-021` Phase 5) — the highest-risk task this roadmap has produced, since a live-verification regression that can't be cleanly fixed should be raised as a fresh decision rather than shipped as a degraded terminal experience.

**2026-09-13 click-to-edit-rename go/no-go** (`derived_from::[[agent-rename-click-to-edit]]`): resolves ROADMAP-021 Phase 4's second deferred question — **no-go**. Rename stays exactly as TASK-148 shipped it: an explicit "Rename" entry in `AgentActionsMenu` that swaps in the existing `showRenameInput`/`handleRename` inline input, both anchored at the header's right-hand `ml-auto` slot. The name text itself (line 752) is never part of the edit control today, so true click-to-edit would require relocating that input to the name's position, not a free trigger-swap. Click-to-edit-on-text is a textbook hidden affordance with no signifier, and would add new keyboard/screen-reader accessibility surface that the current native-button menu item gets for free — the same "no existing primitive, so it's bespoke a11y work" cost structure `ADR-0002` already used to reject a hand-built tabs widget in this same modal. Filed as `ADR-0004#D1`, status `accepted`.

**2026-09-18 sidebar-layout relocation research** (`derived_from::[[agents-page-sidebar-layout]]`): a roadmap is being scoped to remove the Agents page's Kanban board entirely, replacing it with a project-grouped sidebar (status shown via a colored right border) and relocating this modal's content out of its full-viewport overlay into the main content area — a routed (`/agents/:agentId`) or locally-stated "list + detail pane" layout, per `uses::[[react-router-outlet-sidebar-layout]]`. The modal's internal state/effects are assessed as reusable largely as-is; the `document.body.style.overflow` lock effect and the global-`Escape`-closes listener are flagged as needing reconsideration once this is no longer an overlay. Both current call sites (`AgentList`'s active-agent flow and `InactiveAgentsPanel`'s inactive-agent flow) will need to move to whatever new mechanism is adopted.

**2026-09-20 worktree-action research** (`derived_from::[[worktree-on-any-agent]]`): the Details panel already carries a "Create worktree" button (`handleCreateWorktree` → `createWorktreeForAgent` → `POST /agents/:id/worktree`, result held in local `worktreeOverride` state because the route emits no SSE), but it renders only when the agent has no branch and is **not** an `AgentActionsMenu` item. Clone has since shipped as a menu item (`handleClone` → `cloneAgent`), superseding the 2026-09-13 "minus trashed Clone" recommendation above. Research recommends surfacing the worktree action from the actions menu and adding a "Clone into new worktree" item. See `relates_to::[[agent-worktree-lifecycle]]`.

**2026-09-20 file-tree research** (`derived_from::[[project-file-tree]]`): the detail view's `tabs: AgentInfoTabDef[]` array in `AgentList.tsx` currently reads `terminal | skills | details | queued-tasks | diff | usage | checkpoints`; a **Files** tab would slot in beside `diff`, backed by a new `GET /agents/:id/files` route (git-index-sourced paths) and a `FilesPanel` component. Constraint from `AgentInfoTabs`: every present tab's content is mounted on every render with only `hidden` toggled, so a fetching panel must gate its request on the active tab id (see `[[accessible-tabs-pattern]]`). `ROADMAP-0024` also plans a Background tab in the same tablist, so sequence the two, and `TASK-0199`/`TASK-0200` already touch `AgentList.tsx`. Library and security details: `[[file-tree-ui-library-options]]`, `[[local-server-cors-wildcard-exposure]]`.

relates_to::[[project-file-tree]]
relates_to::[[worktree-on-any-agent]]
relates_to::[[agent-worktree-lifecycle]]
relates_to::[[log-tail]]
relates_to::[[agent-detail-modal-redesign]]
relates_to::[[agent-status-notifications]]
relates_to::[[agent-modal-actions-dropdown]]
relates_to::[[agent-modal-simplification]]
relates_to::[[agent-modal-simplification-sequencing]]
relates_to::[[accessible-dropdown-menu-pattern]]
relates_to::[[accessible-toast-notification-pattern]]
relates_to::[[tabbed-agent-info-consolidation]]
relates_to::[[accessible-tabs-pattern]]
relates_to::[[agent-rename-click-to-edit]]
