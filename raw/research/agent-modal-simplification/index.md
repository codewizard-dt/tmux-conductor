---
topic: consider at least 4 or 5 ways to simplify the agent modal to improve the UI/UX
slug: agent-modal-simplification
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Simplifying the AgentDetailModal

> Two of the modal's three previously-researched simplifications (collapsing Details+Queued-Tasks into `<details>`, defaulting Direct Input on, double-click-to-fullscreen) are **already shipped** in the current codebase — the header action-row dropdown is the one still-open, fully-scoped item. Beyond that, the remaining noise is concentrated in two places the earlier research didn't touch: a **4-badge header** (Project/Status/Type/Role, all near-identical pill shapes) and **six independent stacked `<details>` accordions** (Details, Queued tasks, Skills — itself double-nested, Diff, Usage, Checkpoints) that each carry their own summary chrome and reset their open/closed state on every remount. Five concrete, low-risk simplifications are below.

## Research Questions
- What has already been recommended and/or implemented for this modal, so new suggestions don't duplicate prior work?
- Where does visual/interaction clutter concentrate in the modal today, beyond what's already been fixed?
- Which pieces of the header and body are structurally redundant and could be merged or removed outright?
- What's the lowest-risk way to reduce the number of independent disclosure widgets without hiding functionality?

## Current State (Codebase)

`AgentDetailModal` (`frontend/src/components/AgentList.tsx:514-926`, function body confirmed via `find_symbol`) is a full-viewport `createPortal` overlay with two consumers: `AgentList` and `InactiveAgentsPanel.tsx:154` [S1].

**Already implemented** (verified directly in the current source, not just recommended in the 2026-08-15 report [S5]):
- The former always-expanded "Details + Queued Tasks" two-column grid is now two `<details>` rows above the terminal (`AgentList.tsx:729-780`), auto-opened conditionally (`open={!agent.windowPresent}` for Details, `open={agent.queuedTasks > 0}` for Queued tasks) [S1].
- `LogTail` auto-arms Direct Input on mount via a one-shot ref-guarded effect (`LogTail.tsx:467-477`, comment: *"Default Direct Input to on once the terminal is actually ready to receive it"*), not just via the needs-attention CTA's `interactSignal` path [S4].
- Double-click on the terminal container already calls `onToggleExpand` (`LogTail.tsx:695`), reusing the `logExpanded` fullscreen mechanism [S4].

**Not yet implemented**: the header's three flat action buttons (Rename/Close agent/Remove agent, `AgentList.tsx:703-763`) are still separate buttons, not a dropdown — the 2026-09-13 report `agent-modal-actions-dropdown` [S6] scoped this in full (WAI-ARIA menu-button pattern, no new dependency) but it hasn't landed. The companion "Clone agent" feature it referenced (`TASK-134`) was **trashed**, not built [S7] — so any recommendation here should not resurrect Clone.

**Header composition** (`AgentList.tsx:528-620`): name + optional label, then four consecutive pill badges — `ProjectBadge`, `StatusBadge`, `AgentTypeBadge`, `RoleBadge` — followed by `ContextMeter` (detailed variant), a conditional needs-attention `!` flare, and a conditional "queued skill" confirmation chip, before the action buttons even start. `RoleBadge` (`AgentList.tsx:196-208`) and `AgentTypeBadge` (`AgentList.tsx:148-164`) are structurally identical: a colored dot + uppercase 10px pill text, differing only in the palette and the semantic field they read (`agent.role` vs. `inferAgentType(agent)`) [S2][S3]. Visually, the header reads as four near-identical chips before any actionable content appears.

**Body composition below the terminal**: `Skills` (`AgentList.tsx:817-845`), `DiffPanel` (`frontend/src/components/DiffPanel.tsx:76`), `UsageBreakdown` (`AgentList.tsx:365-424`), and `CheckpointList` (`frontend/src/components/CheckpointList.tsx:84`) are each their own top-level `<details className="mt-3 flex-shrink-0">` — four independent accordions stacked vertically, on top of the two (Details, Queued tasks) already above the terminal. That's **six independently-toggled disclosure widgets** in one modal, each with its own `<summary>` row, indent, and default open/closed state that is lost on every remount (switching agents via `⌘←/→` recreates the whole component tree since `key={agent.id}` is on `LogTail`, and the same key pattern implicitly applies to the modal's own remount when `expandedModalAgent` changes) [S1][S8].

The **Skills panel is double-nested**: the outer `<details>Skills (N)</details>` contains an always-rendered "Project" sub-list *and* a second, nested `<details>User (N)</details>` inside it (`AgentList.tsx:833-844`) — two levels of expand/collapse to reach what's usually a handful of skill rows [S1].

**Rename's current interaction**: clicking "Rename" swaps the button itself, in place, for an inline `<input>` + Save + Cancel (`AgentList.tsx:706-729`) — this reflows the entire header action row width every time Rename is entered or exited, and is the one action that doesn't fit cleanly into a dropdown per the 2026-09-13 report's own finding [S6].

## Key Findings

1. Two of three earlier recommendations for this exact modal are done; only the dropdown-actions-menu remains open and is fully spec'd already [S5][S6].
2. Four header badges are visually redundant in *shape* (colored-dot pill) even though distinct in *meaning* — this is header clutter the prior research never examined, since it focused on the body layout, not the header. [S1][S2][S3]
3. Six independent accordions is a lot of repeated chrome for one modal; four of them (Skills/Diff/Usage/Checkpoints) are conceptually "more about this agent" info rather than primary controls, and are candidates to consolidate into one place. [S1][S8]
4. The Skills section's double-nesting is disproportionate complexity for what's typically a short list. [S1]
5. Rename's in-place button-swap is the header's one remaining source of layout shift and the one action the planned dropdown can't cleanly absorb. [S6]

## Constraints

- `InactiveAgentsPanel.tsx` renders the same `AgentDetailModal`, so any change here applies to both call sites automatically — no second place to update, but also no way to special-case one call site without an explicit prop [S1].
- `agent.windowPresent` currently gates whether "Close agent" renders at all (not just its enabled state) — any consolidation must preserve that conditional, not just visually merge it away.
- No dropdown/menu/tabs primitive exists anywhere in `frontend/src/components/`, and no headless-UI dependency (Radix, Headless UI, etc.) is in `frontend/package.json` — every recommendation below must be hand-built with plain React state, consistent with how the existing `<details>` and `ConfirmDialog` patterns already work [S6].
- `ContextMeter` in `detailed` mode is already deliberately verbose (it's the one place that shows full context-window usage), so it should be relocated rather than shrunk if it needs to move out of the header.

## Solution Comparison

| # | Simplification | What changes | Effort | Risk | Codebase fit |
|---|---|---|---|---|---|
| 1 | Actions → 3-dot dropdown (carry over `agent-modal-actions-dropdown` [S6], **minus** Clone) | Rename/Close/Remove become menu items; Rename opens the existing inline input in the header slot on select | Medium (new small `role="menu"` component) | Low — `ConfirmDialog` already decouples trigger from action for 2 of 3 | High — already fully scoped, no new dependency |
| 2 | Merge `AgentTypeBadge` + `RoleBadge` into one combined badge, keep `ProjectBadge`/`StatusBadge` visible | One pill showing `type · role` (e.g. "claude · reviewer") instead of two separate dot-pills | Low (one new small component, delete two call sites) | Low — both already read from `agent`, no new data | High — same pill-badge visual language, just one fewer element |
| 3 | Consolidate Skills/Diff/Usage/Checkpoints into one tabbed "Agent info" `<details>` (or a single non-modal side panel) instead of 4 separate accordions | One `<summary>Agent info</summary>` wrapping a small tab strip (Skills / Diff / Usage / Checkpoints), each already-built component rendered unchanged inside its tab | Medium (tab strip is new UI, but each panel's internals are untouched) | Medium — loses the "glance at N badges without opening anything" affordance the counts (`Skills (N)`, queued tasks count) currently give for free | Medium — no tab primitive exists yet, but it's a small hand-rolled one like the planned dropdown |
| 4 | Flatten the Skills panel's nested `<details>` into a single list with a "Show N more (user skills)" inline toggle, not a second disclosure widget | Removes one level of nesting; same information, one fewer click to see everything | Low | Low — purely internal to the Skills block | High — small, isolated change |
| 5 | Replace the Rename button with click/double-click-to-edit directly on the agent name text in the header | Clicking the name swaps it in place for the same input+Save/Cancel that exists today; no dedicated "Rename" trigger needed at all (dropdown or otherwise) | Low–Medium (same state machine, different trigger; needs a discoverable affordance like a pencil icon on hover) | Medium — inline-edit-on-click is a less standard affordance than a labeled button; needs a hover hint so it's discoverable | Medium — reuses 100% of existing rename state/logic, only the trigger element changes |

## Recommendation

Do **#1, #2, and #4 first** — each is low-risk, small, and independently shippable with no interaction between them:

1. **Ship the already-scoped dropdown** from `agent-modal-actions-dropdown` [S6] for Rename/Close/Remove — it was fully designed down to the WAI-ARIA pattern and component sketch; only build the menu, skip its Clone-menu-item step since Clone (`TASK-134`) was trashed [S7]. This alone removes 2 of the header's ~7 visible elements (two flat buttons collapse into one `⋮` trigger) with zero functional loss.
2. **Merge `AgentTypeBadge` + `RoleBadge`** into a single combined pill (`{type} · {role}`, or stack the two dots side by side inside one pill) — both are 10-line, single-purpose components reading independent fields with identical visual structure, so this is a pure presentation merge, not a data change [S2][S3].
3. **Flatten the Skills panel's inner nested `<details>`** into a flat list, e.g. show all Project skills plus the first 3–5 User skills with a plain "+N more" text toggle rather than a second `<summary>` — removes the double-disclosure without losing any skill.

**Defer #3 and #5** pending a product decision:
- #3 (tabbed "Agent info") is the highest-leverage structural change (6 accordions → far fewer) but changes the modal's information architecture meaningfully — worth a quick mockup/discussion before building, since it trades away the current at-a-glance counts in each `<summary>` line unless the tab strip itself is redesigned to carry them (e.g. badge counts on each tab label).
- #5 (rename-by-clicking-the-name) is a nice-to-have once #1 ships, since after the dropdown lands, Rename becomes a menu item anyway and there's less urgency to also change *how* it's triggered — reassess after #1 is in and see whether the header still feels crowded.

## Risks and Mitigations

- **Discoverability of click-to-rename (#5)**: mitigate with a hover-revealed pencil icon or subtle underline on the name text, tested manually before shipping — a bare click target with no visual cue is easy to miss.
- **Losing at-a-glance counts if accordions are tabbed (#3)**: mitigate by carrying each panel's existing count (Skills N, queued tasks N) onto its tab label instead of dropping it.
- **Combined type+role badge (#2) could get long** for verbose role names — verify against the actual `ROLE_CONFIG`/`resolveRoleBadge` value set (`AgentList.tsx`) before committing to a single-line format; fall back to stacking the two dots in one pill with two tooltips if text length is an issue.

## Next Steps

- `/task-add Build the AgentDetailModal actions dropdown (Rename/Close agent/Remove agent) per the agent-modal-actions-dropdown research, without the Clone menu item` — the highest-confidence, already-designed piece.
- `/task-add Merge AgentTypeBadge and RoleBadge into a single combined badge in AgentDetailModal's header` and `/task-add Flatten the nested User-skills <details> in AgentDetailModal's Skills panel into a flat list with a plain "+N more" toggle` — both small, independent, low-risk.
- If a tabbed "Agent info" consolidation (#3) or click-to-rename (#5) is interesting, treat those as a follow-up product conversation rather than direct task-adds — both trade off an existing affordance and deserve a quick sign-off first.
