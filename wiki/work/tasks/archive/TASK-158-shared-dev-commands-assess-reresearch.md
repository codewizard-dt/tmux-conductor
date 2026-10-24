---
id: TASK-158
aliases: [TASK-158]
title: "Assess shared-dev-commands research assumptions + re-research the split-brain/project-scoping/UI-UX/skill-script gaps"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: []
parallel_safe_with: []
uat: ""
tags: [research, bg-processes, roadmap-020]
---

# TASK-158 — Assess shared-dev-commands research assumptions + re-research the gaps

## Objective

Execute ROADMAP-020 Phase 0 ("Assess & Re-research"): re-verify that every assumption in the original gap analysis (`raw/research/shared-dev-commands/index.md`) still holds against the current working tree, then run a deeper `/research` pass specifically on the four areas the roadmap's Phases 1-4 depend on — the `conductor.conf`/SQLite split-brain, `bg_processes` project-scoping, dashboard UI/UX parity with agents, and the agent-facing `dev-commands` skill/script — and produce a clear recommendation for how the Phase 1-4 implementation work should be split into tasks.

This is a research/assessment task with no runtime behavior to verify — there is nothing to UAT. `uat: ""` is intentional; no `/uat-skip` was needed since no UAT file was ever generated for a task whose only deliverable is a document.

Full findings: `raw/research/shared-dev-commands/index-3.md` and `sources-3.md` (this pass), building on the original `index.md`/`sources.md` and a concurrent narrower pass at `index-2.md`/`sources-2.md` (Phase 1 split-brain scoping, produced independently in this same working session).

## Approach

Re-verify each of the three gaps the original research identified (split-brain, no `project_id`, no agent-side discovery command) live against current code via Serena (symbol/reference lookups, not just re-reading the old report), then go deeper specifically on what the original research left shallow: the exact `project_id` migration shape and its interaction with `bg_processes.name`'s existing *global* uniqueness constraint, what "UI parity with agents" concretely requires in `BgProcessSection`/`AddBgProcessForm.tsx`, and whether this user's own `~/.claude/skills/` actually has any precedent for a bundled-`scripts/` skill (it does not — every one of 66 skills surveyed is `SKILL.md`-only). Close with an explicit single-task-vs-multi-task recommendation for Phases 1-4, cross-checked against what was already happening concurrently in this session (a separate agent had already started scoping Phase 1 as its own task before this task finished, confirming the multi-task recommendation independently).

## Steps

### 1. Re-verify prior assumptions live  <!-- agent: general-purpose --> <!-- Completed: 2026-09-13 -->

- [x] Re-check Gap 1 (split-brain): `host-server/index.ts`'s `POST/DELETE /bg-processes` still call `appendBgProcessToConf`/`removeBgProcessFromConf` from `config.ts`; `db.ts`'s `createBgProcess`/`listBgProcesses`/`deleteBgProcess` confirmed to have zero callers (`find_referencing_symbols` returned empty for all three). Unchanged. <!-- Completed: 2026-09-13 -->
- [x] Re-check Gap 2 (no `project_id`): `bg_processes` DDL (`host-server/db.ts:299-305`) confirmed still missing `project_id`, unlike `agents`/`tasks`/`schedules`. Unchanged. <!-- Completed: 2026-09-13 -->
- [x] Re-check Gap 3 (no agent-side discovery): `CONDUCTOR_STATE_DIR`/`CONDUCTOR_LOG_DIR` confirmed still unconditionally exported in `scripts/conductor.sh` (lines shifted from the original citation by 1-4 lines only, same behavior); no `~/.claude/skills/dev-commands` exists. Unchanged. <!-- Completed: 2026-09-13 -->

### 2. Deep-dive the four closing areas via /research  <!-- agent: general-purpose --> <!-- Completed: 2026-09-13 -->

- [x] Split-brain: cross-referenced the concurrent `index-2.md` pass (already line-cited, including the `AGENT_BG_LINKS` half the original research missed) rather than duplicating it. <!-- Completed: 2026-09-13 -->
- [x] Project-scoping: determined `bg_processes.project_id` must be nullable and classificatory-only — NOT a uniqueness scope, because `bg_processes.name` is globally unique today (cross-checked against agent window names too, since tmux window names are session-global), unlike `agents.name`'s per-project uniqueness. The `agents_v2` migration (`db.ts:335-357`) is a *counter*-example for the uniqueness-index part, not a template. <!-- Completed: 2026-09-13 -->
- [x] UI/UX: found `BgProcessSection` has no empty-state message (unlike `AgentList`'s "No agents registered." branch) and no grouping; `AddBgProcessForm.tsx` has zero project awareness today (only fetches `{name}[]`, not `projectId`); documented the exact `groupByProject`-style pattern (`AgentList.tsx:1595-1604`) and `AddAgentForm.tsx`'s project-select pattern (`:192-215`) to mirror. <!-- Completed: 2026-09-13 -->
- [x] Skill/script: surveyed all 66 of this user's `~/.claude/skills/*` entries plus this repo's own `.claude/skills/typecheck/` — confirmed zero precedent for a bundled `scripts/` subdirectory; the prior research's "System Skill Pattern" citation is Anthropic's documented convention, not a locally-established one. Identified `install-hooks.sh` as the closest local precedent *if* a bundled script is chosen anyway. <!-- Completed: 2026-09-13 -->

### 3. Produce and record the Phase 1-4 task-structure recommendation  <!-- agent: general-purpose --> <!-- Completed: 2026-09-13 -->

- [x] Compared one-task-per-phase vs. one mega-task vs. a backend/frontend split; recommended one task per phase, `depends_on`-chained (2→1, 3→2, 4→1, with 4 `parallel_safe_with` 2/3). <!-- Completed: 2026-09-13 -->
- [x] Cross-checked the recommendation against what was actually happening in this session: a sibling research pass (`index-2.md`) had already begun scoping Phase 1 as a standalone task before this task completed, and the orchestrating session confirmed five parallel agents were independently filing one task per phase — confirming the recommendation matches the execution already in flight rather than proposing a new structure to adopt later. <!-- Completed: 2026-09-13 -->

## Acceptance Criteria

- [x] `raw/research/shared-dev-commands/index-3.md` + `sources-3.md` written, cross-referencing (not duplicating) `index.md`/`sources.md` and `index-2.md`/`sources-2.md`. <!-- Completed: 2026-09-13 -->
- [x] Every assumption from the original research is either reconfirmed or explicitly updated with what changed. <!-- Completed: 2026-09-13 -->
- [x] A concrete, actionable recommendation exists for how to file the Phase 1-4 tasks (one per phase, dependency order, and the Phase 4 skill-shape decision). <!-- Completed: 2026-09-13 -->

## Notes

- **TASK-156 id collision observed during this task**, not caused by it and out of scope to fix here: two sibling agents in this same session each independently created a task file using id `TASK-156` — `TASK-156-bg-processes-project-scoping.md` (Phase 2) and `TASK-156-dev-commands-skill-script.md` (Phase 4). Both exist on disk under different filenames (no file was overwritten), but they share a duplicate `id`/`aliases` value, which will break id-based references (roadmap links, `depends_on`, `index.md` entries) until one is renumbered. Flagged to the orchestrating session; whoever finalizes the Phase 1-4 task set should renumber one of the two before linking them from the roadmap.
- This task intentionally documents a completed research/assessment deliverable rather than pending implementation work — it is the roadmap's Phase 0 item, and Phases 1-4 are tracked as their own separate tasks (filed concurrently by sibling agents in this same session; see the Notes above for the one known id collision to resolve before roadmap-linking them).

### Roadmap

Implements ROADMAP-020 Phase 0 — `wiki/work/roadmaps/ROADMAP-020-shared-dev-commands-implementation.md`.
