---
id: tabbed-agent-info-consolidation
title: Tabbed "Agent info" Panel vs. Stacked Accordions in AgentDetailModal
updated: 2026-09-13
sources:
  - ../../raw/research/tabbed-agent-info-consolidation/index.md
confidence: extracted
tags: [frontend, accessibility, ux, decision]
---

# Tabbed "Agent info" Panel vs. Stacked Accordions in AgentDetailModal

Resolves `ROADMAP-021` Phase 4's deferred go/no-go: should `AgentDetailModal`'s Skills/Diff/Usage/Checkpoints panels consolidate into one tabbed "Agent info" panel instead of four stacked `<details>` accordions? **No-go — keep the stacked accordions.**

Three of the four candidate panels already opt out of rendering entirely rather than just collapsing: `DiffPanel` and `UsageBreakdown` (`frontend/src/components/*`) return `null` when they have no data, and `CheckpointList` is only mounted at all when the agent has an opted-in worktree. On the common case (no worktree, no usage history yet), the modal shows one or two of these panels, not four. **This content shape — short, often-empty, non-comparative info lookups — is the textbook accordion use case, not the tabs use case**, per Nielsen Norman Group ("tabs suit a few long sections, while accordions fit many short ones") and LogRocket ("tabs are better suited to smaller amounts of content, whereas accordions are designed to handle larger volumes"). A hand-built tabs implementation would also cost real, ongoing accessibility work — WAI-ARIA `tablist`/`tab`/`tabpanel` roles, `aria-selected`, `aria-controls`, and a roving-tabindex arrow-key model — that native `<details>`/`<summary>` gets for free from the browser, with no tab/headless-UI dependency existing in `frontend/package.json` to shortcut it. `uses::[[accessible-tabs-pattern]]` for the reference spec.

This exact idea had already been surfaced and explicitly deferred pending product sign-off in same-day prior research on this same modal (`derived_from::[[agent-modal-simplification]]`), which rated it Medium effort/Medium risk. This research is the resolving product decision, filed as `ADR-0002#D1` (`wiki/work/decisions/`).

relates_to::[[agent-detail-modal]]
relates_to::[[agent-modal-simplification]]
relates_to::[[accessible-tabs-pattern]]
relates_to::[[accessible-dropdown-menu-pattern]]
