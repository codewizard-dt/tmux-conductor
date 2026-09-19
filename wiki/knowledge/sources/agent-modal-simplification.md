---
id: agent-modal-simplification
title: Simplifying the AgentDetailModal
updated: 2026-09-13
sources:
  - ../../../raw/research/agent-modal-simplification/index.md
confidence: ambiguous
tags: [frontend, component, modal, ux]
---

# Simplifying the AgentDetailModal

Follow-up research auditing `uses::[[agent-detail-modal]]` for further UI/UX simplification, after confirming that two of the three recommendations from the earlier `derived_from::[[agent-detail-modal-redesign]]` report are **already shipped**: the Details+Queued-Tasks grid is now collapsed `<details>` rows, `LogTail` auto-arms Direct Input on mount via a one-shot ref-guarded effect, and double-click on the terminal already calls `onToggleExpand` to reuse the `logExpanded` fullscreen mechanism. Only the header actions-dropdown from `derived_from::[[agent-modal-actions-dropdown]]` remains unimplemented, and its companion Clone feature (`wiki/work/tasks/archive/TASK-134-clone-agent-button.md`) was trashed, not built — so any dropdown work should drop the Clone menu item.

Beyond the already-covered body layout, this pass found two fresh sources of clutter the earlier research didn't examine: the header's **four near-identical pill badges** (`ProjectBadge`/`StatusBadge`/`AgentTypeBadge`/`RoleBadge` — the latter two are structurally identical colored-dot components differing only in which field they read), and **six independently-toggled `<details>` accordions** in one modal (Details, Queued tasks, Skills, Diff, Usage, Checkpoints), with the Skills panel itself double-nesting a second `<details>` for its User-skills sub-list.

**Recommended, low-risk first cuts**: ship the already-scoped actions dropdown (minus Clone); merge `AgentTypeBadge` + `RoleBadge` into one combined pill; flatten the Skills panel's nested `<details>` into a flat list with a plain "+N more" toggle. A higher-leverage but riskier idea — consolidating the four bottom accordions into a single tabbed "Agent info" panel — is deferred pending a product decision, since it trades away the at-a-glance per-panel counts unless those counts move onto tab labels instead.

> **Contradiction / superseded-by-events:** this report's recommendation to build the dropdown "minus the Clone menu item" is already overtaken. `wiki/work/tasks/TASK-148-agent-actions-dropdown-and-clone.md` (filed the same day, status `todo`, see `wiki/log.md` `[2026-09-13] task | TASK-148 …`) was created *after* the `agent-modal-actions-dropdown` report this one built on, and per an explicit user decision it deliberately **includes** Clone as a fourth menu item (absorbing the now-trashed `TASK-134`) plus a new `lucide-react` icon dependency for the trigger. Treat TASK-148 as the current source of truth for the dropdown+Clone scope; this report's Clone-omission stance reflects only what was known before TASK-148 existed, not a live disagreement to resolve.

relates_to::[[agent-detail-modal]]
relates_to::[[agent-detail-modal-redesign]]
relates_to::[[agent-modal-actions-dropdown]]
relates_to::[[accessible-dropdown-menu-pattern]]
