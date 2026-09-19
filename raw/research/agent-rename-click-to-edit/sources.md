---
topic: Whether AgentDetailModal should replace its menu-triggered Rename flow with click-to-edit directly on the agent name text
slug: agent-rename-click-to-edit
researched: 2026-09-13
---

# Primary Sources — Click-to-edit vs. menu-triggered Rename in AgentDetailModal

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S0a | codebase | `frontend/src/components/AgentList.tsx::AgentDetailModal` (lines 530-799) | 2026-09-13 | Shows the header layout: name text at line 752, `AgentActionsMenu`/inline-rename-input swap at `ml-auto` (lines 768-799), and the `agentActionItems` "Rename" entry (lines 709-714) driving `showRenameInput`/`handleRename`. Confirms the rename input renders in the right-hand action slot, not at the name's position. |
| S0b | codebase | `frontend/src/components/AgentActionsMenu.tsx` (symbols overview) | 2026-09-13 | Confirms `AgentActionsMenu` is a single function component (`AgentActionsMenu`) with `AgentActionsMenuItem`/`AgentActionsMenuProps` interfaces — a plain dropdown, no external headless-UI/ARIA-composite dependency. |
| S0c | codebase | `wiki/work/decisions/archive/DEC-0002-agent-info-panel-tabs.md` | 2026-09-13 | Prior decision in the same modal rejecting a hand-built ARIA composite (tabs) over a zero-cost native alternative (accordions), citing "no tab, disclosure-group, or headless-UI dependency exists in `frontend/package.json`" and every existing multi-state control in this modal being "hand-built with plain React state and native HTML elements." Directly analogous reasoning applied to click-to-edit. |
| S0d | codebase | `wiki/work/roadmaps/ROADMAP-021-agent-modal-simplification.md` (Phase 4, lines 33-36) | 2026-09-13 | Confirms Phase 4 item 2's exact wording ("Decide whether to replace the Rename button with click-to-edit on the agent name (evaluate after Phase 2 ships)") and that item 1 (tabs, resolved by DEC-0002) is checked off as no-go. |
| S1 | web | https://www.uxpin.com/studio/blog/affordances-user-interaction/ | 2026-09-13 | "Hidden affordances reduce visual clutter and establish information hierarchy, but they carry a discoverability risk... Reserve hidden affordances for secondary or power-user actions — never for critical tasks or primary navigation paths." |
| S2 | web | https://coyleandrew.medium.com/the-inline-edit-design-pattern-e6d46c933804 | 2026-09-13 | "The discoverability of the inline edit function can be an issue. An affordance should be clearly presented. Facebook's inline edit feature... is presented within a list of other actions after a user clicks the small arrow... This may be challenging to find for inexperienced users." |
| S3 | web | https://ux.stackexchange.com/questions/14049/affordance-of-edit-in-place-functionality | 2026-09-13 | "So the simple answer is make it look like (or use) a standard input once in the inline edit mode... if the user wasn't frequent I would supply a stronger visual cue to let them know this field is editable (pencil icon is the classic choice)." |
| S4 | web | https://stackoverflow.com/questions/59074409/how-to-indicate-to-screen-readers-that-content-is-inline-editable | 2026-09-13 | "If your editable section does not contain HTML code... it seems useless to use a contenteditable section and you should use instead standard input or textarea elements... you don't have to do much other than styling which would be a good practice in terms of accessibility." Also notes the common pattern needs explicit handling: "have a div with the name and when the user clicks (or focuses and hits space bar), it turns into an input." |
| S5 | web | https://webaim.org/techniques/keyboard/ | 2026-09-13 | "All custom controls must still be accessible to keyboard users. You may need to use tabindex='0' to ensure an element can receive keyboard focus. ARIA may also be necessary... Links, buttons, and form controls are natively accessible to keyboard users, so should be used for interactivity whenever possible." |

## Excerpts

### S1 — Affordances in UX Design: 6 Types, Real-World Examples & Best Practices — UXPin
https://www.uxpin.com/studio/blog/affordances-user-interaction/
> Design consideration: Hidden affordances reduce visual clutter and establish information hierarchy, but they carry a discoverability risk. Users may never find them unless another signifier hints at their existence. Rule of thumb: Reserve hidden affordances for secondary or power-user actions — never for critical tasks or primary navigation paths.

### S2 — The Inline Edit Design Pattern — Andrew Coyle (Medium)
https://coyleandrew.medium.com/the-inline-edit-design-pattern-e6d46c933804
> The discoverability of the inline edit function can be an issue. An affordance should be clearly presented. Facebook's inline edit feature (shown above) is presented within a list of other actions after a user clicks the small arrow at the top of the post. This may be challenging to find for inexperienced users.

### S3 — Affordance of Edit In Place functionality — UX Stack Exchange
https://ux.stackexchange.com/questions/14049/affordance-of-edit-in-place-functionality
> So the simple answer is make it look like (or use) a standard input once in the inline edit mode... The other thing to consider... is how do I know what objects are editable. My favorite pattern for this is to provide the mouseover that exposes the input like style in a faded manner... If the user wasn't frequent I would supply a stronger visual cue to let them know this field is editable (pencil icon is the classic choice).

### S4 — How to indicate to screen readers that content is inline editable? — Stack Overflow
https://stackoverflow.com/questions/59074409/how-to-indicate-to-screen-readers-that-content-is-inline-editable
> In this case no button is needed. If your editable section does not contain HTML code (like links), it seems useless to use a contenteditable section and you should use instead standard input or textarea elements with appropriate CSS design, respectful of WCAG standards... We are trying to write accessible code... The way we are currently handling it in the code is to have a div with the name and when the user clicks (or focuses and hits space bar), it turns into an input.

### S5 — WebAIM: Keyboard Accessibility
https://webaim.org/techniques/keyboard/
> All custom controls must still be accessible to keyboard users. You may need to use tabindex="0" to ensure an element can receive keyboard focus. ARIA may also be necessary to ensure that the control or widget is presented correctly to screen reader users... Links, buttons, and form controls are natively accessible to keyboard users, so should be used for interactivity whenever possible.
