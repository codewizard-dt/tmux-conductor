---
id: agent-modal-simplification-sequencing
title: Sequencing the AgentDetailModal Simplification Steps
updated: 2026-09-13
sources:
  - ../../../raw/research/agent-modal-simplification-sequencing/index.md
confidence: extracted
tags: [frontend, component, modal, ux, planning]
---

# Sequencing the AgentDetailModal Simplification Steps

Follow-up to `uses::[[agent-modal-simplification]]`, run to order its 5 candidate simplifications into `uses::[[roadmap-021-agent-modal-simplification]]`. Found two real sequencing constraints by cross-referencing the two tasks filed the same day: **TASK-150** (color-token unification) rewrites `resolveRoleBadge`'s return shape and `RoleBadge`'s/`AgentTypeBadge`'s render internals directly, so the proposed `AgentTypeBadge`+`RoleBadge` merge must wait for TASK-150 to land — merging first would either conflict with or discard that work, while merging after lets the consolidation consume already-tokenized colors as a pure structural change. **TASK-148** (actions dropdown + Clone) already re-plumbs Rename's trigger from a standalone button into a menu item, so the deferred click-to-rename idea is better evaluated *after* TASK-148 ships — partly to avoid re-wiring Rename's entry point twice, and partly because the dropdown's reduced header may itself lower how urgent click-to-rename still feels.

The Skills-panel-flatten idea has no dependency on either task and can run at any point. The resulting phase order — Color Foundation (TASK-150) → Header Consolidation (TASK-148 + badge merge) → Body Cleanup (Skills flatten) → Deferred Ideas (tabbed consolidation + click-to-rename go/no-go) — is recorded in `uses::[[roadmap-021-agent-modal-simplification]]`.

relates_to::[[agent-modal-simplification]]
relates_to::[[agent-detail-modal]]
