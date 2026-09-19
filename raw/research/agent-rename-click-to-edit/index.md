---
topic: Whether AgentDetailModal should replace its menu-triggered Rename flow with click-to-edit directly on the agent name text
slug: agent-rename-click-to-edit
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Click-to-edit vs. menu-triggered Rename in AgentDetailModal

> Recommendation: **no-go**. Keep Rename as an explicit "Rename" item in the shipped `AgentActionsMenu` (TASK-148), triggering the existing inline input. Click-to-edit directly on the agent-name text — whether as a *replacement* for the menu item or as an *additional* trigger alongside it — trades an already-discoverable, already-keyboard-accessible affordance for a hidden one, adds new custom-widget accessibility surface with no existing precedent in this codebase, and (as an addition) duplicates a control that already works without giving users any new capability.

## Research Questions
- What does the *shipped* TASK-148 design actually look like today, and where does the inline rename input render relative to the name text?
- How does click-to-edit-on-text compare to an explicit "Rename" menu item on discoverability?
- How does click-to-edit-on-text compare on keyboard-only accessibility?
- Is adding click-to-edit as an *additional* trigger (alongside, not instead of, the menu item) a genuine improvement or redundant complexity?
- Is there a directly relevant prior decision in this codebase to build on?

## Current State (Codebase)

`AgentDetailModal` (`frontend/src/components/AgentList.tsx:530-926`) renders its header as a flex row: agent name + label (lines 751-756), then a run of badges (`ProjectBadge`, `StatusBadge`, `AgentTypeBadge`, `RoleBadge`, `ContextMeter`), then an attention marker, then `ml-auto` on the right: either `AgentActionsMenu` (line 768-770) or — when `showRenameInput` is `true` — the inline rename `<input>` plus Save/Cancel buttons (lines 771-799).

Since TASK-148, `AgentActionsMenu` (`frontend/src/components/AgentActionsMenu.tsx`) is the single 3-dot dropdown that replaced the old row of flat header buttons. Its `Rename` entry (`agentActionItems[0]`, line 709-714 in `AgentList.tsx`) does `setRenameInput(agent.name); setShowRenameInput(true); setRenameError(null)` — it swaps the *entire menu component* for the inline input, both anchored at the far-right `ml-auto` slot. **The agent-name text itself (line 752) never moves and is never part of the edit control** — the input that appears is a separate element in a different part of the header, not an in-place edit of the name.

This matters directly for the "click-to-edit on the name" proposal: it is not a trivial trigger-swap on top of the existing input. Moving editing onto the name text itself would require relocating `showRenameInput`'s input from the right-hand action slot into the name `<span>` at line 752 — a small but real layout change, not just deleting the menu item.

`AgentActionsMenu` renders native, keyboard-operable `<button>` elements for each item (per `get_symbols_overview`, it's a single function component with no custom ARIA composite) — consistent with the rest of this codebase's convention (confirmed independently by [[DEC-0002]]'s Shared Context: "Every existing multi-state UI element in this modal … is hand-built with plain React state and native HTML elements").

## Key Findings

1. **A prior decision in this exact codebase already resolved an analogous question with the same reasoning shape.** [[DEC-0002]] (`wiki/work/decisions/archive/DEC-0002-agent-info-panel-tabs.md`) chose *not* to build a hand-rolled ARIA composite widget (a tabbed panel) over the zero-cost native alternative (stacked `<details>`), specifically because "no tab, disclosure-group, or headless-UI dependency exists in `frontend/package.json`" and any such widget "is new bespoke code with its own correctness surface." The same fact pattern applies here: click-to-edit-on-text is also a bespoke, hand-rolled interactive-text widget with no existing precedent or library in this codebase, versus the already-shipped, native-button-based menu item. *(codebase inference, cross-referenced against DEC-0002)*

2. **Discoverability: click-to-edit on plain text is a textbook "hidden affordance."** UX literature is consistent that inline-edit-on-text has no visible affordance by default and needs a deliberate signifier (hover state, pencil icon, tinted background) to be discoverable at all — without one, users simply don't know the text is editable [S2] [S3]. A dedicated affordances guide states the general rule: "Reserve hidden affordances for secondary or power-user actions — never for critical tasks or primary navigation paths" [S1]. Renaming an agent is an infrequent but not-trivial action (it changes the agent's identity across the queue, logs, and dispatch); an explicit "Rename" label in a menu the user already opened to find actions is the more conservative, more discoverable choice by the same rule this guide states.

3. **Keyboard/screen-reader accessibility: click-to-edit-on-text requires new custom-widget plumbing; the menu item gets keyboard support for free.** WCAG 2.1.1 requires all interactive elements to be fully keyboard-operable; native `<button>`/`<a>`/form elements get this automatically, while a `<span>` or `<div>` made "clickable" needs manual `tabindex="0"`, `Enter`/`Space` key handling, and — per a Stack Overflow discussion on exactly this pattern — either avoid `contenteditable` entirely and swap in a real `<input>` on activation, or accept the extra ARIA burden of signaling "this text is editable" to screen readers [S4] [S5]. The existing menu-item trigger has none of this cost: `AgentActionsMenu`'s items are native buttons, keyboard-focusable and screen-reader-labeled ("Rename") automatically.

4. **The inline-edit pattern's own literature flags discoverability as its central risk, even in mature products.** A dedicated write-up of Facebook's inline-edit-in-a-menu pattern notes: "This may be challenging to find for inexperienced users" [S2] — i.e., even hiding the edit *trigger* inside an already-explicit menu (which is what this codebase does today) is called out as a discoverability risk in the literature; hiding it as an affordance-less click target on the name text itself is a materially larger step in the same risky direction, not a smaller one.

5. **As an *additional* trigger alongside the menu item, click-to-edit gives no new capability** — the menu item already reaches the same `showRenameInput`/`handleRename` state with a fully accessible, fully discoverable control. Adding a second entry point to the same feature means: a second hover/focus state to design and maintain on the name `<span>`, a second code path that must stay in sync with `showRenameInput`, and (per the layout note above) either duplicate input UI or a relocation of the existing input to the name's position — for a marginal gain of "one click instead of two" on an infrequent action, in a single-user local tool.

## Constraints

- No tabs/headless-UI/interactive-text library exists in `frontend/package.json` (React 19, `react-router-dom`, `@dnd-kit/*`, `@xterm/*`, standard Vite/Tailwind/Vitest/ESLint tooling) — any click-to-edit-on-text implementation is new bespoke code, same constraint DEC-0002 identified for tabs.
- `showRenameInput`'s input currently renders in the header's right-hand action slot, not at the name's location — relocating it to achieve true click-to-edit is a layout change, not a one-line trigger swap.
- This is a single-user, local-only tool (per `CLAUDE.md`: "fully local and single-user — two runnable pieces, no daemon, no Docker, no deployment, no auth") — the cost/benefit bar for adding a second, less-accessible entry point to an already-working feature is high, not low, echoing DEC-0002's Driver 5.

## Solution Comparison

| Criteria | A. Replace menu item with click-to-edit on name | B. Keep menu-item-triggered inline input (status quo) | C. Add click-to-edit as an *additional* trigger alongside the menu item |
|---|---|---|---|
| **Approach** | Remove "Rename" from `AgentActionsMenu`; make the name `<span>` (line 752) itself the edit trigger | No change — `AgentActionsMenu` → "Rename" → existing `showRenameInput` swap | Keep the menu item; also wire the name text as a second trigger into the same state |
| **Discoverability** | ❌ hidden affordance; needs a hover/pencil-icon signifier to be found at all [S1][S2][S3] | ✅ explicit, labeled menu item | ⚠️ same hidden-affordance problem *added on top of* an already-discoverable path |
| **Keyboard accessibility** | ❌ new custom-widget surface: manual `tabindex`, key handling, edit-state announcement [S4][S5] | ✅ native button, keyboard-operable for free | ❌ same new surface, purely additive cost |
| **Layout impact** | Medium — input must move from the right-hand action slot to the name's position | None | Medium — same relocation, or duplicate input UI |
| **New capability delivered** | None (same rename action, different trigger) | — | None — same action reachable a second way |
| **Codebase precedent** | None; no interactive-text pattern exists anywhere in this codebase | ✅ matches every existing multi-state control (native buttons/inputs, per DEC-0002) | None |
| **Implementation cost** | Medium | None | Medium (two triggers to build and keep in sync) |
| **Risk** | Regression in discoverability + a11y for a rarely-used action | None | New a11y/discoverability surface for zero net benefit |

## Recommendation

**No-go.** Keep Rename exactly as TASK-148 shipped it: an explicit "Rename" entry in `AgentActionsMenu` that swaps in the existing inline `showRenameInput`/`handleRename` input. Do not replace it with click-to-edit on the agent-name text, and do not add click-to-edit as a second, parallel trigger.

Reasoning, in order of weight:
1. Click-to-edit-on-text is a textbook hidden affordance for an infrequent action; the explicit "Rename" label the menu already provides is the safer, more discoverable choice per UX-affordance guidance [S1][S2][S3].
2. It introduces new keyboard/screen-reader accessibility surface (manual focus/key handling, or `contenteditable`'s ARIA burden) where the current menu-button trigger has none — the same "no existing primitive, so it's all new bespoke a11y work" cost structure that this codebase's own [[DEC-0002]] already used to reject a hand-built tabs widget for the same modal.
3. As an *addition* rather than a replacement, it delivers zero new capability — the feature is already reachable, already accessible, already discoverable — while adding a second code path and layout complexity to maintain.
4. TASK-148's shipped layout renders the rename input in the header's action slot, not at the name's position, so true click-to-edit is not a free trigger-swap; it requires relocating that input, adding implementation cost on top of the UX/a11y regression.

**Implementation outline** (for completeness, though the recommendation is not to build this): none — recommend no code change.

**Risks and mitigations**: none material — this is a no-op relative to shipped behavior.

**Alternative if constraints change**: If this ever becomes a genuinely high-frequency action (e.g., bulk-renaming many agents in a workflow), a hover-revealed pencil-icon affordance directly on the name — built to the Stack Overflow-recommended pattern (a real `<input>` swapped in on activation, not `contenteditable`, with visible focus and keyboard activation) — would be the way to revisit it, not a bare unlabeled clickable span.

## Next Steps

- `/decision-create` — file this as a single-decision go/no-go record in `wiki/work/decisions/`, tagged `frontend, ux, accessibility`, resolving `ROADMAP-021` Phase 4 item 2.
- `/decision-finalize` — the recommendation above is conclusive enough to finalize immediately as `accepted` rather than leaving it `proposed`.
- No `/task-add` — this is a no-go; no implementation follows.
