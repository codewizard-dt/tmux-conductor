---
id: agent-detail-modal
title: AgentDetailModal
aliases: [AgentDetailModal.tsx]
updated: 2026-08-15
sources:
  - ../../../raw/research/agent-detail-modal-redesign/index.md
confidence: extracted
tags: [frontend, component, modal, ux]
---

# AgentDetailModal

`AgentDetailModal` — function inside `frontend/src/components/AgentList.tsx:514-869` (not a separate file). Full-viewport agent detail overlay, rendered via `createPortal` into `document.body`. Opened from an `AgentItem` card in `AgentList`, one instance at a time.

**Layout, top to bottom** (inside `<div className="flex flex-col flex-1 overflow-hidden p-5">`, `AgentList.tsx:733`):
1. Header row — name/label, `ProjectBadge`, `StatusBadge`, `AgentTypeBadge`, `RoleBadge`, `ContextMeter`, needs-attention flag, Rename/Close-agent/Remove-agent buttons, `⌘←/→` agent-nav hints, close button.
2. A `grid md:grid-cols-[1fr_1.5fr]` row holding **Details** (Command/Workdir/Window, `uses::[[mode-switcher]]`, conditional "Create window") and **Queued Tasks** (`TaskList` + `AddTaskForm`) — the only section in the modal that is *not* a collapsed `<details>`, unlike every panel below it.
3. `uses::[[log-tail]]` (`flex-1 min-h-0`) — gets whatever vertical space is left over after everything else above and below it.
4. Skills, `DiffPanel`, `UsageBreakdown`, `CheckpointList` — all already default-collapsed `<details>` one-liners.

**State it owns**:
- `logExpanded` (`useState(false)`) — "terminal fullscreen" mode: hides the Details/Queued-Tasks grid and all four `<details>` panels below the terminal, and drops LogTail's `mt-5 border-t` styling. Toggled by a document-level `keydown` listener matching `isLogExpandShortcut` (`⌥F`, `AgentList.tsx:74-76`) that runs *before* the Escape-closes-modal handler, plus whatever `LogTail`'s own `onToggleExpand` prop triggers (icon button, its own `⌥F` handler when `interacting`).
- `interacting` (mirrored from `LogTail` via `onInteractChange`) — used so Escape closes the modal only when the terminal isn't capturing keys directly.
- `armInteract` prop, computed into `interactSignal` (`armInteract ? 1 : 0`) passed to `LogTail` — the mechanism that auto-arms Direct Input when the modal is opened from the needs-attention "Direct Input — needs you" card CTA (`AgentItem`, `AgentList.tsx` ~L928-938).

**2026-08-15 redesign research** (`derived_from::[[agent-detail-modal-redesign]]`): recommends collapsing the Details+Queued-Tasks grid into the same `<details>` pattern already used by Skills/Diff/Usage/Checkpoints (freeing terminal space with no new components), making Direct Input the unconditional default on every `LogTail` mount rather than only on the CTA path, and adding `onDoubleClick={onToggleExpand}` on the terminal container to reuse the existing `logExpanded` fullscreen mechanism. Full citations and code-level proposal in `raw/research/agent-detail-modal-redesign/index.md`.

**2026-08-15 notification-banner research** (`relates_to::[[agent-status-notifications]]`): the planned dashboard notification-banner feature (fires on `awaiting`/`empty` transitions) reuses this exact `armInteract`/`interactSignal` mechanism for its click-to-focus behavior — same `setExpandedAgent({ id, armInteract: true })` call the needs-attention CTA already makes, no new modal-opening path.

relates_to::[[log-tail]]
relates_to::[[agent-detail-modal-redesign]]
relates_to::[[agent-status-notifications]]
