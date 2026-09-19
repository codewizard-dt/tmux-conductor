---
topic: consider at least 4 or 5 ways to simplify the agent modal to improve the UI/UX
slug: agent-modal-simplification
researched: 2026-09-13
---

# Primary Sources — Simplifying the AgentDetailModal

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `frontend/src/components/AgentList.tsx::AgentDetailModal` (lines 514-926, read via `find_symbol` include_body) | 2026-09-13 | Full current layout: header badges/actions, the two `<details>` rows above the terminal, the four stacked `<details>` below it, the double-nested Skills panel |
| S2 | codebase | `frontend/src/components/AgentList.tsx::RoleBadge` (lines 196-208) | 2026-09-13 | Confirmed pill-badge structure: colored dot + uppercase text, reads `agent.role` |
| S3 | codebase | `frontend/src/components/AgentList.tsx::AgentTypeBadge` (lines 148-164) | 2026-09-13 | Confirmed identical pill-badge structure to RoleBadge, reads `inferAgentType(agent)` — basis for the merge recommendation |
| S4 | codebase | `frontend/src/components/LogTail.tsx` (search for `interacting`/`onDoubleClick`, lines ~467-477, ~695) | 2026-09-13 | Confirmed Direct-Input-default-on effect and double-click-to-fullscreen are already implemented, not just recommended |
| S5 | raw research | `raw/research/agent-detail-modal-redesign/index.md` (2026-08-15) | 2026-09-13 | Prior recommendation set (collapse Details+Queued-Tasks grid, default Direct Input on, double-click fullscreen) — verified against S1/S4 as already shipped |
| S6 | raw research | `raw/research/agent-modal-actions-dropdown/index.md` (2026-09-13) | 2026-09-13 | Fully-scoped, unimplemented recommendation to collapse Rename/Close/Remove into a WAI-ARIA dropdown menu; basis for recommendation #1 |
| S7 | wiki task | `wiki/work/tasks/archive/TASK-134-clone-agent-button.md` | 2026-09-13 | Confirms `status: trashed` — the Clone-agent feature referenced by S6 was rejected, not built; used to scope recommendation #1 down (no Clone menu item) |
| S8 | codebase | `frontend/src/components/DiffPanel.tsx`, `frontend/src/components/CheckpointList.tsx` (via `get_symbols_overview`) | 2026-09-13 | Confirmed both are small, independent, single-purpose components each wrapped in their own top-level `<details>` — basis for the six-accordion count and the tabbed-consolidation idea |

## Excerpts

### S1 — `AgentDetailModal` (lines ~729-780, two `<details>` rows above the terminal)
`frontend/src/components/AgentList.tsx`
> `<details className={\`flex-shrink-0${logExpanded ? ' hidden' : ''}\`} open={!agent.windowPresent}>` … `<summary>Details</summary>` … `<details className={\`mt-3 flex-shrink-0${logExpanded ? ' hidden' : ''}\`} open={agent.queuedTasks > 0}>` … `<summary>Queued tasks ({agent.queuedTasks})</summary>`

### S1 — Skills panel double-nesting (lines ~817-845)
`frontend/src/components/AgentList.tsx`
> `<details className="mt-3 flex-shrink-0"> <summary>Skills ({skills.project.length + skills.user.length})</summary> ... <details> <summary>User ({skills.user.length})</summary> ... </details> </details>`

### S4 — Direct Input default-on (lines 467-477)
`frontend/src/components/LogTail.tsx`
> "Default Direct Input to on once the terminal is actually ready to receive it: LogTail's sole consumer is AgentDetailModal, so arming interact mode makes the modal terminal-first without an extra gating prop."

### S6 — Dropdown recommendation summary
`raw/research/agent-modal-actions-dropdown/index.md`
> "Build one small accessible dropdown component and route all four actions (Rename, Close agent, Remove agent, Clone) through it, superseding TASK-134's literal 'add a fourth flat button' step with 'add a fourth menu item.'"

### S7 — TASK-134 status
`wiki/work/tasks/archive/TASK-134-clone-agent-button.md`
> `status: trashed`
