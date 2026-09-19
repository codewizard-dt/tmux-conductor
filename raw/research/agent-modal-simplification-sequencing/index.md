---
topic: sequencing the 5 AgentDetailModal simplification steps from the agent-modal-simplification report (actions dropdown, AgentTypeBadge+RoleBadge merge, Skills-panel flatten, tabbed accordion consolidation, click-to-rename) into an execution-ordered roadmap, accounting for overlap/dependencies with TASK-148 (actions dropdown + Clone) and TASK-150 (cohesive color palette, which touches RoleBadge/AgentTypeBadge/ProjectBadge coloring)
slug: agent-modal-simplification-sequencing
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Sequencing the AgentDetailModal Simplification Steps

> Builds on [agent-modal-simplification](../agent-modal-simplification/index.md) (the 5 candidate simplifications) and cross-references two tasks filed independently the same day. Two real sequencing constraints emerged: (1) **TASK-150 must land before the AgentTypeBadge+RoleBadge merge** — TASK-150 rewrites both components' internals (`resolveRoleBadge`'s return shape, `AgentTypeBadge`'s inline color literals) to reference new CSS tokens, so merging the two components first would either conflict with or throw away that work; (2) **click-to-rename should be evaluated after TASK-148 ships**, not before — TASK-148 already re-plumbs Rename's entry point into a dropdown menu item, and doing click-to-rename first would mean re-doing that wiring a second time.

## Research Questions
- Does TASK-150 (color palette unification) touch the same code as the proposed AgentTypeBadge+RoleBadge merge, and if so, in what order should they run?
- Does TASK-148 (actions dropdown) touch the same code as the proposed click-to-rename idea, and in what order should they run?
- Is the Skills-panel-flatten idea independent of both tasks, or does it have a dependency too?
- What phase structure best reflects these constraints without overstating them?

## Current State (Codebase / Tasks)

**TASK-150** (`wiki/work/tasks/TASK-150-cohesive-color-palette.md`, status `todo`, filed 2026-09-13) directly rewrites:
- `resolveRoleBadge`'s return type (`AgentList.tsx:187-194`) from `{ role, className, dot }` to `{ role, bg, text, dot }`, and `RoleBadge` (`AgentList.tsx:196-208`) to consume `bg`/`text` via inline `style` instead of Tailwind classes.
- `AgentTypeBadge`'s (`AgentList.tsx:148-160`) non-Claude branch, replacing its inline `rgba(20,126,105,0.10)`/`#0f766e`/`#14a38b` literals with `var(--color-badge-type-codex-bg)`/`-text` token references.

This is **the exact same two components** (`RoleBadge`, `AgentTypeBadge`) the `agent-modal-simplification` report recommends merging into one combined pill [S1][S2].

**TASK-148** (`wiki/work/tasks/TASK-148-agent-actions-dropdown-and-clone.md`, status `todo`, filed 2026-09-13) Step 5 explicitly re-wires Rename's trigger: *"replace the three-button block... keeping the existing inline-rename `<input>`/Save/Cancel markup... rendered instead of the trigger whenever `showRenameInput` is true"* — i.e. Rename's entry point moves from a standalone button to a dropdown menu item, reusing `handleRename()`/`renameAgent()`/`showRenameInput` unchanged [S3].

**Skills-panel flatten** (removing the nested `<details><summary>User (N)</summary></details>` inside the outer Skills `<details>`, `AgentList.tsx:817-845`) touches neither `RoleBadge`/`AgentTypeBadge` nor the header action row — no file-level or state overlap with either task [S4].

## Key Findings

1. **Badge-merge → TASK-150 dependency is real, not speculative**: TASK-150's Step 2 literally changes `resolveRoleBadge`'s return shape and `RoleBadge`'s render body; a badge-merge task written against the *current* (pre-TASK-150) shape would need to be rewritten once TASK-150 lands, or would conflict with it if built in parallel. Sequencing TASK-150 first means the merge consumes already-tokenized `bg`/`text` values from both components — a pure structural consolidation with no color rework needed. [S1][S2]
2. **Click-to-rename → TASK-148 dependency is softer but still real**: TASK-148 already changes *how* Rename is triggered (menu item → same inline input). Click-to-rename changes it again (name text → same inline input). Doing click-to-rename first would mean TASK-148 has to re-adapt to whatever new trigger click-to-rename introduces; doing it after means click-to-rename is evaluated against the dropdown's already-reduced header, which may lower its perceived value (Rename is already one click away via the menu, not a dedicated button) — this is itself useful information for the go/no-go decision, not just a scheduling nicety. [S3]
3. **Skills-flatten has no dependency on either task** and can run in any phase, including in parallel with Phase 1/2 work. [S4]
4. **TASK-150's own notes already establish it's safe to run independently of two *other* in-flight tasks** (`TASK-135`, `TASK-140`, both `pending-uat`, same files, different concern) — the same "same file, different concern, no wait needed" reasoning does **not** extend to the badge-merge, because TASK-150 and the merge both change the *same* two functions' actual output shape, not just different lines in the same file. [S1]

## Constraints

- Neither the badge-merge nor the Skills-flatten idea has a task file yet — the roadmap should carry them as inline placeholders (per `/roadmap-create` convention) rather than invented task links, to be converted to real task files by `/roadmap-next` or `/task-add --roadmap` when the phase is reached.
- The two "deferred" ideas (tabbed accordion consolidation, click-to-rename) were already flagged in the source report as needing product sign-off before scoping as tasks — sequencing them into a final phase rather than a task-ready phase preserves that gate.

## Recommendation

Structure the roadmap as 4 dependency-ordered phases:
1. **Color Foundation** — TASK-150 alone (already a real task, `todo`).
2. **Header Consolidation** — TASK-148 (dropdown + Clone, no dependency on Phase 1) and the new badge-merge item, the latter depending on Phase 1 having landed.
3. **Body Cleanup** — Skills-panel flatten, independent of everything, can move earlier if desired but grouped here for narrative clarity (header-then-body).
4. **Deferred Ideas** — both go/no-go decisions, with the click-to-rename decision explicitly framed as "evaluate after Phase 2 ships" so the dropdown's effect on Rename's perceived friction is visible before deciding.

## Next Steps

- Proceed with `/roadmap-create` using this phase structure.
- Once Phase 1 (TASK-150) is `done`, file the badge-merge task with `depends_on: [TASK-150]` in its frontmatter.
- Once Phase 2 (TASK-148) is `done`, revisit the click-to-rename go/no-go with fresh eyes on whether the header still feels crowded.
