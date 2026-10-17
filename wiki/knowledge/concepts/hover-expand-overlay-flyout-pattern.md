---
id: hover-expand-overlay-flyout-pattern
title: Hover-Expand Collapsed Sidebar as an Overlay Flyout
aliases: [Hover Expand Sidebar, Sidebar Flyout]
updated: 2026-09-20
sources:
  - ../../../raw/research/sidebar-hover-expand/index.md
  - ../../../raw/research/sidebar-hover-expand/sources.md
confidence: extracted
tags: [frontend, accessibility, layout, sidebar, hover]
---

# Hover-Expand Collapsed Sidebar as an Overlay Flyout

The established shape for a collapsed sidebar that expands on hover is an **overlay**: the rail keeps its docked width in the layout and the full panel floats over the page content, so nothing reflows. A recent concrete proposal (Chatwoot #15710) states it directly — hover expands "the full sidebar over the page, without shifting conversation content", collapses "after a short delay", and *pinning* is the separate action that "reserves space in the layout and persists the user's preference." shadcn's `collapsible="icon"` mode centres on the same split: a fixed icon-width constant plus a persisted open/closed state.

**Mechanics that recur across sources:**
- **Hover-intent / unhover-intent**: react to hover-on after a short delay (or immediately) but delay hover-off, so grazing the edge doesn't flicker (CSS-Tricks).
- **`mouseenter`/`mouseleave`, not `mouseover`/`mouseout`**: the latter fire on child hover and break expand/collapse sidebars containing form fields (Stack Overflow). React's `onMouseEnter`/`onMouseLeave` have the enter/leave semantics.
- **Keyboard parity**: open on `:focus-within`/`onFocus`; never make navigation hover-only; expose `aria-expanded` on the toggle.
- **WCAG 1.4.13 (AA)**: hover/focus-revealed content that covers page content must be dismissible without moving pointer or focus (Esc), hoverable, and persistent.
- **Collapsed content must leave the tab order** — render a compact variant rather than clipping the full one with `overflow-hidden`.
- **Touch**: `:hover` doesn't fire on touchscreens; keep a click toggle.
- **Persistence**: minimized state in `localStorage` (guarded — it can throw or come back empty), motion via `motion-reduce:` variants (Tailwind v3).

Applied to this project: `uses::[[terminal-size-coupling-to-layout-width]]` is why overlay (not push) is mandatory here — see `derived_from::[[sidebar-hover-expand]]`. Relates to the other hand-built (no-library) accessibility patterns: `relates_to::[[accessible-dropdown-menu-pattern]]`, `relates_to::[[accessible-toast-notification-pattern]]`, `relates_to::[[accessible-tabs-pattern]]`.
