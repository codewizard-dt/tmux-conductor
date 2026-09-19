---
id: agent-rename-click-to-edit
title: Click-to-Edit vs. Menu-Triggered Rename in AgentDetailModal
updated: 2026-09-13
sources:
  - ../../raw/research/agent-rename-click-to-edit/index.md
confidence: extracted
tags: [frontend, ux, accessibility]
---

# Click-to-Edit vs. Menu-Triggered Rename in AgentDetailModal

Research resolving `ROADMAP-021` Phase 4 item 2: whether `AgentDetailModal`'s Rename flow should move from an explicit "Rename" entry in `uses::[[agent-detail-modal]]`'s shipped `AgentActionsMenu` (TASK-148) to click-to-edit directly on the agent-name text. **Recommendation: no-go**, filed and accepted as `DEC-0004#D1`.

**Current shipped shape**: the name text (`AgentList.tsx:752`) and the rename trigger are in different places — the menu (or the inline `showRenameInput` input it swaps to) sits at the header's far-right `ml-auto` slot, while the name renders on the left. True click-to-edit would require relocating that input to the name's position, not just deleting the menu entry — a real layout change, not a free trigger-swap.

**Why no-go**: click-to-edit on plain text is a textbook hidden affordance — UX sources are consistent that inline-edit needs a deliberate signifier (hover state, pencil icon) to be discoverable at all, and even a menu-hidden edit trigger (what this codebase already has) is flagged in the literature as hard for inexperienced users to find, let alone an affordance-less clickable span. It also introduces new keyboard/screen-reader accessibility surface — WCAG 2.1.1 keyboard operability is free on a native `<button>` (what `AgentActionsMenu`'s items already are) but requires manual `tabindex`/key-handling work on a clickable text element. This mirrors `derived_from::[[tabbed-agent-info-consolidation]]`'s reasoning in this same modal: no existing primitive in `frontend/package.json` means any custom interactive-text widget is new bespoke accessibility surface, and the cost isn't offset by any new capability — the action is already reachable, accessible, and discoverable via the menu item. Adding click-to-edit as a *second*, parallel trigger alongside the menu item fares no better: it duplicates the feature for zero net gain while adding the same discoverability/a11y liability.

Full comparison table, sources, and reasoning: `raw/research/agent-rename-click-to-edit/index.md` (primary sources in `raw/research/agent-rename-click-to-edit/sources.md`).

relates_to::[[agent-detail-modal]]
relates_to::[[accessible-dropdown-menu-pattern]]
relates_to::[[tabbed-agent-info-consolidation]]
relates_to::[[agent-modal-actions-dropdown]]
