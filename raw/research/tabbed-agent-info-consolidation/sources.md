---
topic: Should AgentDetailModal consolidate Skills/Diff/Usage/Checkpoints into one tabbed "Agent info" panel instead of four stacked accordions?
slug: tabbed-agent-info-consolidation
researched: 2026-09-13
---

# Primary Sources — Tabbed "Agent info" panel consolidation

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `frontend/src/components/AgentList.tsx::AgentDetailModal` (lines 514-926) | 2026-09-13 | Full current structure: Skills/DiffPanel/UsageBreakdown/CheckpointList are each an independent top-level `<details className="mt-3 flex-shrink-0">`, rendered conditionally (`!logExpanded`, and CheckpointList additionally gated on `effectiveWorktreePath`) |
| S2 | codebase | `frontend/src/components/DiffPanel.tsx::DiffPanel` (lines 11-106) | 2026-09-13 | Component returns `null` entirely (renders no `<details>` at all) when the agent has no git base branch (`loaded && !error && diff === null && base === null`) — the panel is not just "collapsed," it can be structurally absent |
| S3 | codebase | `frontend/src/components/AgentList.tsx::UsageBreakdown` (lines 365-436) | 2026-09-13 | Returns `null` when `sessions` is empty — same "structurally absent, not just collapsed" behavior as DiffPanel; summary line shows a live count (`Usage (N sessions)`) when present |
| S4 | codebase | `frontend/src/components/CheckpointList.tsx::CheckpointList` (lines 28-137) | 2026-09-13 | Structural mirror of DiffPanel per its own header comment; only mounted when `effectiveWorktreePath` is truthy (worktree opt-in), so absent for the common case of an agent with no worktree |
| S5 | codebase | `frontend/package.json` | 2026-09-13 | Confirms no tab/headless-UI/menu primitive exists in `dependencies` or `devDependencies` (React 19, Tailwind, dnd-kit, xterm — nothing else); any tab strip must be hand-built, matching the existing hand-built `ConfirmDialog`/`<details>` conventions |
| S6 | raw research (prior) | `raw/research/agent-modal-simplification/index.md` | 2026-09-13 | Prior 2026-09-13 research on this same modal explicitly proposed this exact tabbed-consolidation idea as "Simplification #3," rated it Medium effort / Medium risk, and deferred it pending product sign-off — this /research call resolves that deferral |
| S7 | web | https://accessibility.build/guides/accessible-tabs | 2026-09-13 | WAI-ARIA APG tabs pattern requires `role="tablist"`/`role="tab"`/`role="tabpanel"`, `aria-selected`, `aria-controls`, a roving-tabindex arrow-key model, and (per APG's recommended safe default) `tabindex="0"` on the panel itself so keyboard/screen-reader users don't skip past it |
| S8 | web | https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/ | 2026-09-13 | W3C APG keyboard-interface guidance: composite widgets like tabs need either a roving tabindex or `aria-activedescendant` management — this is manual keyboard-handling work, not something that falls out of semantic HTML the way `<details>`/`<summary>` does |
| S9 | web | https://www.nngroup.com/videos/tabs-vs-accordions/ | 2026-09-13 | Nielsen Norman Group guidance: "use accordions for content-heavy pages where users will not need to access content under several accordions... Tabs suit a few long sections, while accordions fit many short ones" |
| S10 | web | https://blog.logrocket.com/ux-design/accordion-ui-design/ | 2026-09-13 | "Tabs are better suited to smaller amounts of content, whereas accordions are designed to handle larger volumes of information"; also flags accordions' own known discoverability/accessibility costs when built without care |
| S11 | web | https://www.onething.design/post/tabs-vs-accordions | 2026-09-13 | "As the viewport narrows, the case for accordions strengthens, and the case for tabs weakens... horizontally scrolling tabs are a known source of missed content" — relevant since the dashboard modal is responsive (`md:inset-8` / mobile-narrower layout in `AgentList.tsx`) |

## Excerpts

### S7 — Accessible Tabs: The WAI-ARIA Tabs Pattern Guide
https://accessibility.build/guides/accessible-tabs
> Without that, a keyboard user pressing Tab would skip straight past the panel to the next control on the page, and someone relying on a screen reader's Tab key could miss the panel content. When in doubt, adding tabindex="0" to the panel is the safe default recommended by the APG.

### S9 — Tabs vs. Accordions: When to Use Each (Video) - NN/G
https://www.nngroup.com/videos/tabs-vs-accordions/
> On desktop, use accordions for content-heavy pages where users will not need to access content under several accordions... Tabs and accordions organize and layer content on the same page. Tabs suit a few long sections, while accordions fit many short ones.

### S10 — Designing effective accordion UIs — LogRocket Blog
https://blog.logrocket.com/ux-design/accordion-ui-design/
> While both organize information, tabs are better suited to smaller amounts of content, whereas accordions are designed to handle larger volumes of information... Users are less likely to discover hidden content, particularly if the click interaction is not enticing enough for the user — Accessibility issues — For accessibility, accordions have to be programmed for access via keyboard or ARIA attributes.

### S11 — Tabs vs Accordions: When to Use Each in UX Design
https://www.onething.design/post/tabs-vs-accordions
> As the viewport narrows, the case for accordions strengthens, and the case for tabs weakens. A tab row that looks elegant on a desktop monitor often turns into squeezed, truncated, or horizontally scrolling labels on a phone, and horizontally scrolling tabs are a known source of missed content because users simply don't realize there's more to the right.
