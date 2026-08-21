---
id: agent-detail-modal-redesign
title: AgentDetail Modal Redesign Research
updated: 2026-08-15
sources:
  - ../../raw/research/agent-detail-modal-redesign/index.md
confidence: extracted
tags: [frontend, component, modal, ux, terminal]
---

# AgentDetail Modal Redesign Research

Research into making `AgentDetailModal` (`frontend/src/components/AgentList.tsx:514-869`) terminal-first: a larger, more prominent `LogTail`, less always-visible chrome, a smaller Queued Tasks block, Direct Input as the default state on open, and double-click-to-fullscreen on the terminal.

**Key finding**: the modal's collapsible-panel pattern (`<details>` summary rows) is *already* applied to Skills, DiffPanel (`derived_from::[[log-tail]]` sibling panel), UsageBreakdown, and CheckpointList — all default-collapsed one-liners. The actual source of visual noise is the one block that does **not** follow that pattern: an always-fully-expanded two-column grid (`md:grid-cols-[1fr_1.5fr]`) holding **Details** (Command/Workdir/Window/`ModeSwitcher`) and **Queued Tasks** (`TaskList` + `AddTaskForm`), sitting directly above the terminal and consuming its default vertical space. The recommendation is to convert that grid into two of the same collapsed `<details>` rows used elsewhere — no new components, reusing a pattern already proven four times over.

**Direct Input default-on**: `interacting` state lives entirely inside `uses::[[log-tail]]` (`useState(false)` at LogTail.tsx ~157) and is only auto-armed today via an `interactSignal` prop that increments when the modal is opened from the needs-attention card CTA (`armInteract`, gated on `needsAttention(status)`). `LogTail` has exactly one render call site in the whole `components/` tree (`AgentList.tsx:807`), so there is no other consumer to protect — the mount effect can be changed to fire unconditionally on every mount rather than only on `interactSignal` increments, and because the modal renders `<LogTail key={agent.id} .../>`, switching agents already remounts it, so Direct Input re-arms on every navigation too.

**Double-click-to-fullscreen**: `logExpanded` (owned by `AgentDetailModal`, AgentList.tsx ~540) already does exactly "give the terminal the whole modal" — it's driven today by a global `⌥F` keydown listener (`isLogExpandShortcut`, AgentList.tsx:74-76, duplicated as `isExpandShortcut` in LogTail.tsx:12-14) and an icon button. No `onDoubleClick` exists anywhere in `LogTail.tsx` today; adding one to the `xtermContainerRef` div that calls the existing `onToggleExpand` prop reuses the mechanism exactly, with no new state.

See the full report at `raw/research/agent-detail-modal-redesign/index.md` for line-by-line citations, the constraints list (must not hide "Create window" for closed agents; `⌘←/→` agent-nav must keep working once the terminal auto-focuses), and the suggested `/task-add` scope.

relates_to::[[log-tail]]
relates_to::[[agent-detail-modal]]
