---
id: nav-bar
title: NavBar
aliases: [NavBar.tsx]
updated: 2026-09-18
sources:
  - ../../../raw/research/agents-page-sidebar-layout/index.md
confidence: extracted
tags: [frontend, component, navigation]
---

# NavBar

`NavBar` — `frontend/src/components/NavBar.tsx:9-54`. Sticky top bar (`h-12`, backdrop-blurred) rendered once at the app shell level, holding the app name/dot, `NavLink`s for `/` (Agents), `/projects`, and `/history`, and a right-aligned (`ml-auto`) dark/light theme toggle button. No agent- or form-related controls live here today.

**2026-09-18, `derived_from::[[agents-page-sidebar-layout]]`**: identified as the destination for the Agents page's "+ Add Agent" and "Add Background Process" triggers, which currently live inline on `AgentsPage` — `NavBar`'s existing `ml-auto`-anchored right-hand slot (currently just the theme toggle) is the natural place to add both buttons, each opening its form as a modal.

relates_to::[[agents-page-sidebar-layout]]
relates_to::[[add-bg-process-form]]
