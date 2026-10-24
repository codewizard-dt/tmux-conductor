---
id: accessible-dropdown-menu-pattern
title: Accessible Dropdown/Actions-Menu Pattern (No Library)
updated: 2026-09-13
sources:
  - ../../raw/research/agent-modal-actions-dropdown/index.md
confidence: extracted
tags: [frontend, accessibility, ux, pattern]
---

# Accessible Dropdown/Actions-Menu Pattern (No Library)

The frontend (`frontend/package.json`) has **no headless-UI or menu dependency** — no Radix, no Headless UI, nothing beyond `@dnd-kit/*`, `@xterm/*`, `react`, `react-dom`, `react-router-dom`. As of 2026-09-13, no dropdown/menu/popover component exists anywhere in `frontend/src/components/` either, so the first feature that needs a "3-dot actions menu" (`derived_from::[[agent-modal-actions-dropdown]]`) has to hand-build one rather than reuse or import one.

The reference spec for this is the **W3C WAI-ARIA Authoring Practices "Menu Button" pattern**, specifically the **Actions Menu Button** variant (as opposed to the Navigation/Links variant): a trigger with `aria-haspopup="true"` and `aria-expanded`, a panel with `role="menu"` containing `role="menuitem"` children. Keyboard behavior: `Enter`/`Space` on the trigger opens the menu and focuses the first item; `Up`/`Down` move a roving focus between items; `Escape` and outside-click close the menu and return focus to the trigger. See the excerpts in `raw/research/agent-modal-actions-dropdown/sources.md` (S6/S7) for the exact APG pages.

Practical integration notes discovered while researching this for `uses::[[agent-detail-modal]]`:
- Destructive actions gated behind a separate confirm dialog (this project's `ConfirmDialog` component) don't need rework to move into a menu item — the dialog already renders independent of whatever triggered it.
- An action that today swaps its own trigger control for inline UI (e.g. an inline rename `<input>` replacing a "Rename" button) does need rework once that trigger moves inside a closed menu, since there's no "in place" left to swap into.
- A custom menu's own `Escape` handler must `stopPropagation()` when the host surface (e.g. a modal) already has its own global `Escape`-closes listener, so `Escape` closes the menu first and the host surface second on a repeated press.

**2026-09-13 confirmation** (`derived_from::[[agent-rename-click-to-edit]]`): once `AgentActionsMenu` shipped (TASK-148), a follow-up go/no-go asked whether Rename should move off the menu entirely onto click-to-edit-on-the-name-text. Confirms the note above played out exactly as predicted — the rename `<input>` still swaps in at the menu's own slot (`ml-auto`, not "in place" on the name), and the decision (`ADR-0004#D1`, accepted) kept the menu-item trigger rather than moving to a hidden, less keyboard-accessible click-to-edit affordance on the name text.

relates_to::[[agent-modal-actions-dropdown]]
relates_to::[[agent-detail-modal]]
relates_to::[[agent-rename-click-to-edit]]
