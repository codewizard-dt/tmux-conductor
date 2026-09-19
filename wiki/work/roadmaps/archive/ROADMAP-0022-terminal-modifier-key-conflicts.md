---
id: ROADMAP-0022
aliases: [ROADMAP-0022]
title: Resolve Modifier-Key Conflicts in the Direct Input Terminal
status: done
created: 2026-09-13
updated: 2026-09-18
owner: David Taylor
linked_requirements: —
linked_decisions: —
tags: [frontend, terminal, keyboard]
---

# ROADMAP-0022 — Resolve Modifier-Key Conflicts in the Direct Input Terminal

## Goal

TASK-141's agent-switch shortcut is verified working, Cmd/Ctrl/Option+Arrow do real terminal-appropriate things in the Direct Input terminal, and copy/paste both work reliably there — no more silent no-ops on any Cmd/Ctrl/Option chord in that surface.

## Phase 1: Agent-Switch Shortcut

- [x] [[TASK-141: Replace Cmd/Ctrl+Arrow agent-switch hotkey to stop conflicting with terminal cursor navigation]]

## Phase 2: Terminal Arrow Navigation

- [x] [[TASK-149: Fix Cmd/Ctrl/Option+Arrow cursor navigation in the Direct Input terminal]]

## Phase 3: Copy/Paste Reliability

- [x] [[TASK-0163: Fix copy/paste reliability in the Direct Input terminal]]

## Phase 4: Backspace Word/Line Deletion

- [x] [[TASK-0165: Handle Cmd+Backspace and Option+Backspace in the Direct Input terminal]]

## Notes

- Sequenced per `wiki/knowledge/sources/terminal-cmd-ctrl-execution-plan.md` (researched 2026-09-13): Phase 2 explicitly needs Phase 1's *final* live shortcut before it can safely claim Cmd+Arrow — `TASK-149`'s own file already flags this. Phase 3 is scoped last so `LogTail.tsx`'s modifier-key surface changes as one coherent wave, though the research found it largely independent of Phases 1-2 (different functions in the same file).
- Phase 3's item has no task file yet — `/roadmap-next` will create one via `/task-add` when this roadmap is worked.
