---
id: ROADMAP-020
title: Shared Dev Commands — Full Implementation
aliases: [ROADMAP-020]
status: done
created: 2026-09-13
updated: 2026-09-13
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [host-server, frontend, skills, bg-processes]
---

# Roadmap 020: Shared Dev Commands — Full Implementation

## Goal

Close the gaps found in the shared-dev-commands research (`raw/research/shared-dev-commands/`) so "vital dev commands" is a fully implemented, project-scoped feature with good UI/UX: one source of truth for bg-process definitions, project scoping, dashboard UI parity with agents, and an agent-facing skill+script for discovery.

## Phase 0: Assess & Re-research

- [x] [[TASK-158: Assess shared-dev-commands research assumptions + re-research the split-brain/project-scoping/UI-UX/skill-script gaps]]

## Phase 1: Fix the split-brain

- [x] [[TASK-159: Make SQLite the sole source of truth for bg-process definitions and links]]

## Phase 2: Project scoping

- [x] [[TASK-156: Add project_id to bg_processes and a project-filtered listing endpoint]]

## Phase 3: UI/UX

- [x] [[TASK-161: Extend AddBgProcessForm.tsx with a required project selector and group BgProcessSection by project]]

## Phase 4: Agent-side skill + script

- [x] [[TASK-160: Create the ~/.claude/skills/dev-commands skill + bash script (list/status/tail)]]

## Notes

