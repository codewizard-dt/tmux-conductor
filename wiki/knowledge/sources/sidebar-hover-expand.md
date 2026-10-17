---
id: sidebar-hover-expand
title: Sidebar Hover-to-Expand When Minimized (Research)
aliases: [Sidebar Hover Expand, Minimized Sidebar Hover]
updated: 2026-09-20
sources:
  - ../../../raw/research/sidebar-hover-expand/index.md
  - ../../../raw/research/sidebar-hover-expand/sources.md
confidence: extracted
tags: [frontend, layout, sidebar, accessibility, terminal, agents-page]
---

# Sidebar Hover-to-Expand When Minimized (Research)

Research on the request "when the sidebar is minimized, but then it gains a hover, it should expand." The premise does not yet hold in the codebase: `derived_from::[[agent-sidebar]]` is a fixed 320 px `<aside>` (`SIDEBAR_WIDTH_PX = 320`) with **no minimized state and no toggle**, so the work is two features — a minimize control that docks the sidebar to a narrow rail, and hover-to-expand on that rail. Neither the ROADMAP-0023 research (`relates_to::[[agents-page-sidebar-layout]]`) nor any tracked wiki/raw document plans a minimized state.

**Hover-expand must be an overlay flyout, not a reflow.** The rail keeps its docked width in the flex layout and the full-width panel is absolutely positioned over the detail pane. A push-style expansion would resize the xterm container on every hover — `LogTail`'s `ResizeObserver` refits the local terminal — while the size last synced to the host-server (`terminalSizeProbe`, which hard-codes `left: SIDEBAR_WIDTH_PX` and only re-runs on window `resize`) would go stale. See `uses::[[terminal-size-coupling-to-layout-width]]` and `uses::[[hover-expand-overlay-flyout-pattern]]`. A dock-width change (the minimize toggle itself) *does* reflow and therefore must re-probe; hover-open/close must not. Note the coupling analysis is code-path inference — no external source states it.

**Recommended approach (Option A):** React-state-driven flyout with hover-intent delays (open ~100 ms, close ~250–300 ms, `mouseenter`/`mouseleave` semantics), `focus-within` opening plus Esc-to-dismiss (WCAG 1.4.13), a persisted-in-`localStorage` minimize toggle (try/catch-guarded), `motion-reduce:transition-none`, and a compact `'rail'` row mode so filter/badges/`InactiveAgentsPanel` are not left in the tab order. Alternatives compared: push-on-hover (rejected — terminal refit and probe desync) and CSS-only `group-hover` (rejected — no hover-intent, not Esc-dismissible without JS). Open question for the user: does "minimized" mean an icon rail (assumed) or fully hidden with an ~8 px edge hot-zone?

**Status (2026-09-20):** the recommendation was implemented as TASK-0179 (`relates_to::[[TASK-0179]]`; implemented, `pending-uat`), documented on `[[agent-sidebar]]`. Deviations from the research: the typing guard is a longer hover open delay (450 ms) rather than a block; a sticky sidebar header (toggle, filter, inactive-agents panel) was added; a focus-restore subtask was added after tests surfaced keyboard focus loss on rail-to-flyout transitions; and an Escape/focus re-open loop was fixed.

relates_to::[[log-tail]]
relates_to::[[inactive-agents-panel]]
relates_to::[[tmux-headless-window-sizing]]
