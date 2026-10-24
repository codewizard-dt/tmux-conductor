---
id: ROADMAP-021
aliases: [ROADMAP-021]
title: Simplify the AgentDetailModal
status: done
created: 2026-09-13
updated: 2026-09-13
owner: David Taylor
linked_requirements: —
linked_decisions: —
tags: [frontend, ux, accessibility]
---

# ROADMAP-021 — Simplify the AgentDetailModal

## Goal

AgentDetailModal has a consolidated header (one actions menu, one collision-free badge set) and a flatter body consolidated into one tabbed "Agent info" panel (Terminal/Skills/Diff/Usage/Checkpoints); the click-to-rename idea has an explicit go/no-go decision recorded.

## Phase 1: Color Foundation

- [x] [[TASK-150: Unify badge/status colors into one cohesive, collision-free palette]]

## Phase 2: Header Consolidation

- [x] [[TASK-148: Collapse AgentDetailModal actions into a 3-dot dropdown and add Clone]]
- [x] [[TASK-152: Merge AgentTypeBadge and RoleBadge into one combined header pill in AgentDetailModal]]
- [x] [[TASK-154: Emphasize agent/project name in the modal header and surface the most recent dispatched command]]

## Phase 3: Body Cleanup

- [x] [[TASK-153: Flatten the Skills panel's nested details into a flat list with a +N more toggle]]

## Phase 4: Deferred Ideas (needs product go/no-go)

- [x] Decide whether to consolidate Skills/Diff/Usage/Checkpoints into one tabbed "Agent info" panel instead of four stacked accordions — resolved [[ADR-0002#D1]]: **no-go**, keep the four stacked accordions — **reversed 2026-09-13** by explicit owner direction, see [[ADR-0005#D1]]: **go**, tabs (now five, adding a Terminal tab); tracked as Phase 5 below
- [x] Decide whether to replace the Rename button with click-to-edit on the agent name (evaluate after Phase 2 ships) — resolved [[ADR-0004#D1]]: **no-go**, keep Rename as TASK-148 shipped it (menu item → inline input)

## Phase 5: Tabbed Agent Info Panel (reverses Phase 4 item 1's original no-go)

- [x] [[TASK-157: Consolidate Terminal/Skills/Diff/Usage/Checkpoints into one tabbed panel in AgentDetailModal]]

## Notes

- **ADR-0002#D1** (`wiki/work/decisions/archive/ADR-0002-agent-info-panel-tabs.md`): originally no-go on tabs — **superseded 2026-09-13**, see ADR-0005#D1 below. Three of the four candidate panels (`DiffPanel`, `UsageBreakdown`, `CheckpointList`) already return `null`/don't mount when empty, so the modal's actual content shape is short/often-empty/non-comparative — the textbook accordion case, not the tabs case — and a hand-built tabs widget would need real WAI-ARIA tablist work with no existing tab primitive in `frontend/package.json`. This analysis is preserved as historical record; it was not wrong, the owner's preference simply changed once the ask grew to include a Terminal tab.
- **ADR-0005#D1** (`wiki/work/decisions/archive/ADR-0005-agent-info-panel-tabs-with-terminal.md`): reverses ADR-0002#D1 per explicit owner direction — **go** on tabs, five in total (Terminal, Skills, Diff, Usage, Checkpoints), Terminal default-active on open. The live terminal moves from "always visible" to "visible only when its tab is active" — a real UX cost not present in ADR-0002's original scope (which never touched the terminal), accepted explicitly as the price of this reversal. Implementation tracked as TASK-157 (Phase 5), which also has to make `TASK-131`'s Direct-Input-default-on behavior and the notification/CTA `armInteract` auto-focus flow correctly force the Terminal tab active rather than firing on a hidden panel.
- **ADR-0004#D1** (`wiki/work/decisions/archive/ADR-0004-agent-rename-click-to-edit.md`): no-go on click-to-edit. Click-to-edit on plain text is a hidden affordance with no discoverability parity to the explicit "Rename" menu item TASK-148 already shipped, and it would add bespoke keyboard/screen-reader accessibility work (the name text has no native interactive semantics) that the existing native `<button>` menu item already gets for free — same "no primitive, bespoke a11y cost" reasoning as ADR-0002#D1's original analysis. Adding it alongside the menu item was also rejected as pure duplication for no capability gain.

