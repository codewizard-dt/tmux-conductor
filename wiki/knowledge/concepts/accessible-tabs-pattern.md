---
id: accessible-tabs-pattern
title: Accessible Tabs Pattern (WAI-ARIA, No Library) vs. Native Accordion
updated: 2026-09-13
sources:
  - ../../raw/research/tabbed-agent-info-consolidation/index.md
confidence: extracted
tags: [frontend, accessibility, ux, pattern]
---

# Accessible Tabs Pattern (WAI-ARIA, No Library) vs. Native Accordion

The frontend (`frontend/package.json`) has no tab/headless-UI dependency, same gap already documented for menus in `relates_to::[[accessible-dropdown-menu-pattern]]`. A hand-built tabs widget must implement the **W3C WAI-ARIA Authoring Practices "Tabs" pattern**: a `role="tablist"` container of `role="tab"` elements with `aria-selected`, each `aria-controls`-linked to a `role="tabpanel"`, plus a **roving-tabindex arrow-key model** (Left/Right, Home/End) since Tab itself should move past the whole tablist as one stop. APG's own recommended safe default adds `tabindex="0"` on each panel so keyboard/screen-reader users don't skip past its content when tabbing through the page.

This is meaningfully more implementation surface than the native `<details>`/`<summary>` element already used throughout this project's accordions, which is keyboard-operable (Enter/Space toggles, natively focusable, correctly exposed to assistive tech) with zero ARIA code — a browser default, not something to get right by hand. A real-world example found during research (a GitHub issue on an unrelated project's shipped `TabPills` component) shows roving-tabindex/arrow-key support is an easy, common thing to omit even when the rest of a tabs widget looks complete.

**When tabs beat accordions**: per Nielsen Norman Group, tabs suit "a few long sections" a user actively switches between to compare; per LogRocket, tabs fit "smaller amounts of content" than accordions do. Accordions are the better fit for **many short, often-empty, non-comparative sections** — exactly `derived_from::[[tabbed-agent-info-consolidation]]`'s finding for `AgentDetailModal`'s Skills/Diff/Usage/Checkpoints panels, three of which are conditionally absent per-agent (no worktree, no usage, no diff), not just collapsed. Tabs also degrade worse than accordions at narrow/mobile viewports (squeezed, truncated, or horizontally-scrolling labels) — relevant for any tab strip on a responsive surface.

relates_to::[[accessible-dropdown-menu-pattern]]
relates_to::[[tabbed-agent-info-consolidation]]
relates_to::[[agent-detail-modal]]
