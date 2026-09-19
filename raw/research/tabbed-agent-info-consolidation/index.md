---
topic: Should AgentDetailModal consolidate Skills/Diff/Usage/Checkpoints into one tabbed "Agent info" panel instead of four stacked accordions?
slug: tabbed-agent-info-consolidation
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Tabbed "Agent info" panel vs. stacked accordions in AgentDetailModal

> **No-go.** Keep the four panels (Skills, Diff, Usage, Checkpoints) as independent stacked `<details>` accordions. The content is exactly the shape NN/g and LogRocket describe as accordion-favoring — many short, often-empty, non-comparative sections, not "a few long sections users switch between" — and three of the four panels already opt out of rendering entirely when they have nothing to show (`DiffPanel`/`UsageBreakdown` return `null`; `CheckpointList` is gated on worktree presence). Tabs would force those "sometimes absent" panels into an awkward always-present tab strip, would cost real hand-built ARIA/keyboard work with zero existing tab primitive in `frontend/package.json`, and would trade away the one thing accordions give for free today: every section's live count (`Skills (N)`, `Usage (N sessions)`) visible at a glance without opening anything. This is UI churn without a clear usability win for this modal's actual content shape.

## Research Questions
- How are the four panels structured and rendered today in `AgentList.tsx` and their own component files?
- What do tabs cost in accessibility/keyboard terms (ARIA roles, roving tabindex) compared to native `<details>`/`<summary>` accordions?
- Which pattern gives better discoverability for this specific content — four short, often-empty, non-comparative info panels?
- What would it cost to introduce a tab component given no tab/headless-UI library exists in `frontend/package.json`?
- Given the modal's current length/scroll behavior, is this worthwhile UI churn or a real usability win?

## Current State (Codebase)

`AgentDetailModal` (`frontend/src/components/AgentList.tsx:514-926`) renders, after the terminal (`LogTail`, `flex-1 min-h-0`), up to four independent `<details className="mt-3 flex-shrink-0">` blocks in fixed order: Skills, `DiffPanel`, `UsageBreakdown`, `CheckpointList` [S1]. All four are additionally gated on `!logExpanded` (hidden while the terminal is in fullscreen mode), and none of the four share any wrapper element today — each is a sibling `<details>` at the same indent level, each with its own `<summary>` styled identically (`text-[11px] font-semibold uppercase tracking-[0.08em] text-muted`) [S1].

Critically, **three of the four panels already opt out of existing at all** when there's nothing to show, rather than just rendering collapsed:
- `DiffPanel` returns `null` (no `<details>`, no summary line, nothing) once it has confirmed the agent has no git base branch — "this component owns its own visibility gating," per its own code comment [S2].
- `UsageBreakdown` returns `null` when the agent has zero usage sessions [S3].
- `CheckpointList` is only mounted by the parent at all when `effectiveWorktreePath` is truthy — an agent without an opted-in worktree never gets this panel rendered [S1][S4].
- Only the Skills panel is unconditionally present once `skills` has loaded, always showing a count in its summary (`Skills (N)`) [S1].

So on a typical agent (no worktree, maybe no usage yet), the modal today shows **one or two** of these four accordions, not four. This is not "four stacked accordions" in the worst-case sense the roadmap phrasing implies — it's a maximum of four, with the actual count varying per agent state.

No tab, disclosure-group, or headless-UI dependency exists in `frontend/package.json` — dependencies are React 19, react-router-dom, `@dnd-kit/*`, and `@xterm/*`; devDependencies are the standard Vite/Tailwind/Vitest/ESLint toolchain [S5]. Every existing multi-state UI element in this modal (`ConfirmDialog`, the rename input swap, the `<details>` panels themselves) is hand-built with plain React state and native HTML elements — there is no established "reach for a UI kit" convention to lean on.

This exact idea was already surfaced and explicitly deferred in same-day prior research on this modal (`agent-modal-simplification`, researched 2026-09-13): rated "Simplification #3," Medium effort / Medium risk, with the stated tradeoff being "loses the at-a-glance counts... unless the tab strip itself is redesigned to carry them" — deferred "pending a product decision" [S6]. This research is that product decision.

## Key Findings

1. **Content shape favors accordions, not tabs, per UX guidance.** NN/g: "use accordions for content-heavy pages where users will not need to access content under several accordions... tabs suit a few long sections, while accordions fit many short ones" [S9]. LogRocket: "tabs are better suited to smaller amounts of content, whereas accordions are designed to handle larger volumes of information" [S10]. Skills/Diff/Usage/Checkpoints are four independent, non-comparative, often-empty info lookups — a user opens at most one at a time to check a specific fact, never flips between two to compare them side by side. That is the accordion use case, not the tabs use case, by both sources' own framing.
2. **Three of four panels are conditionally absent, which tabs handle worse than accordions.** An accordion that has nothing to show simply doesn't render (today's actual behavior, [S2][S3][S4]). A tab strip has no equally clean equivalent: either the tab is hidden (so the strip's item count silently changes per agent, which is visually jarring for a fixed-position UI element) or the tab stays visible and clicking it reveals an empty/placeholder state (extra "nothing here" UI that doesn't exist today). Neither is free, and both are new complexity accordions don't have.
3. **Tabs cost real accessibility implementation that accordions get from the browser for free.** Native `<details>`/`<summary>` is keyboard-operable (Enter/Space toggles, natively focusable, exposed correctly to assistive tech) with zero ARIA code — it is literally what the element is for. A tabs implementation must hand-build: `role="tablist"`/`role="tab"`/`role="tabpanel"`, `aria-selected`, `aria-controls`, a roving-tabindex arrow-key model (Left/Right/Home/End), and per APG's own recommended safe default, `tabindex="0"` on each panel so keyboard/screen-reader users don't skip past its content [S7][S8]. This is exactly the kind of hand-rolled ARIA composite widget work the sibling research on the header actions menu (`agent-modal-actions-dropdown`) already had to scope carefully for a *simpler* menu-button pattern — a tablist is a strictly larger surface to get right, with more failure modes (a real GitHub issue turned up during this research shows a shipped TabPills component missing exactly this roving-tabindex/arrow-key behavior — a common, easy-to-miss mistake) [S7].
4. **Tabs lose the free at-a-glance counts.** Today, `Skills (N)`, `Usage (N sessions)`, and similar summary text are visible without opening anything, for every present panel simultaneously, because accordions keep all summary rows visible at once. A tab strip's inactive labels can carry counts too, but that has to be deliberately designed in — it is not the default the way it is for `<summary>` text — and the mitigation was already flagged as a requirement, not a given, in the prior research [S6].
5. **The modal's scroll/length problem, if it is one, isn't really about accordion count.** The four panels are collapsed by default and stack below a terminal that already claims most of the vertical space (`flex-1 min-h-0`); on the common case (no worktree, no usage yet) there are only one or two panels rendered at all [S1][S2][S3][S4]. Tabbing would save, at most, a few `<summary>` row heights (maybe 1) once condensed to a strip with 1-4 collapsed items — height most of which is already reclaimed by `<details>` staying closed. There's no scroll-length pain being solved here that accordions haven't already mostly solved.
6. **Responsive/mobile framing works against tabs too.** As viewport narrows, tab rows are the pattern known to degrade (truncated/squeezed/horizontally-scrolling labels, a known source of missed content), while accordions degrade gracefully by simply stacking [S11]. The modal is explicitly responsive (`inset-4` on mobile vs. `md:inset-8`), so this cuts against tabs on this specific surface.

## Constraints

- `InactiveAgentsPanel.tsx` renders the same `AgentDetailModal`, so whichever pattern wins applies to both call sites with one change — no second surface to special-case [S1], per the prior research's own noted constraint [S6].
- No tab/menu/dropdown primitive exists in `frontend/package.json` today; any tabs implementation must be hand-built to match the existing hand-rolled convention (`ConfirmDialog`, `<details>`) — no library shortcut is available [S5].
- Three of the four candidate panels are conditionally rendered (absent, not just collapsed) depending on agent state (worktree presence, usage history, git base branch) — any consolidation design must account for panels that sometimes don't exist at all, not just panels that are sometimes empty [S2][S3][S4].
- This is a single-user, local-only tool (per `CLAUDE.md` project overview) — there is no broad user base whose aggregate behavior would justify the extra engineering/accessibility surface of a bespoke tabs widget; the cost/benefit bar for "worth building" is correspondingly higher, not lower.

## Solution Comparison

| Criteria | Tabbed "Agent info" panel | Keep 4 stacked accordions (status quo) |
|---|---|---|
| **Approach** | Wrap Skills/Diff/Usage/Checkpoints in one `<details>Agent info</details>` (or standalone panel) with a hand-built tab strip inside; each existing component renders unchanged inside its tab | No structural change; optionally apply the already-recommended, already-scoped low-risk cleanups from prior research (flatten Skills nesting — `TASK-153`, already on the roadmap) |
| **Pros** | Fewer top-level disclosure widgets when all four happen to be present; groups conceptually-related "more about this agent" info under one roof | Zero new UI code; browser-native keyboard/ARIA support; each panel's absence (no worktree, no usage, no diff) costs nothing — it just doesn't render; all present panels' counts stay visible simultaneously; degrades gracefully at mobile widths |
| **Cons** | Must hand-build ARIA tablist/roving-tabindex/arrow-key handling with no existing library; must design a fallback for tabs whose content is sometimes structurally absent; hides other panels' counts unless deliberately re-surfaced on tab labels; tab rows are the pattern known to degrade on narrow viewports | None of the four panels being independent still means up to 4 summary rows when all happen to be present — but per the "current state" finding, that's the uncommon case, not the common one |
| **Complexity** | Medium (new composite widget, new empty/absent-tab handling, new keyboard code) | None (no change) / Low (only if the already-planned Skills-flatten task is counted) |
| **Dependencies** | None required, but scope is a full hand-built ARIA tabs widget | None |
| **Codebase fit** | Breaks from the established "everything here is a native `<details>`" convention | Matches every existing pattern in this exact modal |
| **Maintenance** | Ongoing: keyboard-interaction correctness (a common source of shipped bugs, per the TabPills example found during research) is now this project's problem to keep correct | None beyond what already exists |

## Recommendation

**No-go: do not consolidate into tabs.** Keep Skills/Diff/Usage/Checkpoints as independent stacked accordions. The content — four short, non-comparative, frequently-absent info lookups — is the textbook accordion case, not the textbook tabs case, by the same UX sources that would be cited to justify either choice [S9][S10]. The concrete implementation cost (hand-built ARIA tablist + roving tabindex with no existing primitive, plus new handling for panels that are sometimes structurally absent) is real and ongoing, while the benefit (saving at most a couple of collapsed `<summary>` row-heights on the *uncommon* case where all four panels exist simultaneously) is marginal given the terminal already claims most of the modal's height and the panels are collapsed by default.

This also satisfies the framework's own risk/cost tie-breaker independent of the qualitative analysis above: keeping accordions requires no new dependency and no structural change, so even absent every other consideration it would win on cost grounds alone. Here the two lines of reasoning agree, so this is a confident go/no-go call, not a coin flip.

**If** the actual complaint driving Phase 4 is modal length rather than accordion-count per se, the lower-risk lever already sitting on the roadmap is `TASK-153` (flatten the Skills panel's nested `<details>`) plus the already-scoped header actions-dropdown (`agent-modal-actions-dropdown` research) — both do more for perceived clutter than tabs would, with a fraction of the implementation and accessibility risk.

## Risks and Mitigations

- **Risk**: dismissing tabs outright forecloses a genuinely nicer "Agent info" grouping if the four panels grow more numerous or more comparable in the future (e.g., if Usage and a future "Cost" panel become things a user wants to flip between). **Mitigation**: this is a reassess-later condition, not a reason to build it now — revisit if/when panel count or comparative use grows past what accordions handle well (NN/g's own threshold, "a few long sections users switch between").
- **Risk**: keeping four separate accordions still means up to 4 summary rows stacked when all happen to be present (worktree + usage + diff + skills all populated at once). **Mitigation**: this is already partially addressed by `TASK-153` (Skills flattening) and the roadmap's Phase 2/3 header work; no additional action needed from this decision.

## Next Steps

- File the go/no-go as a decision record (`/decision-create`) referencing this report — this is what triggered the research.
- No task-add is warranted from a "no-go": there is no build to schedule. If the roadmap wants a positive follow-up instead, the highest-leverage remaining lever is finishing the already-scoped, lower-risk items still open in `ROADMAP-021` (`TASK-148`, `TASK-150`, `TASK-152`, `TASK-153`) rather than adding new tabs work.
