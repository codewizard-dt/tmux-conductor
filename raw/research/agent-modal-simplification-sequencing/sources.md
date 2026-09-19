---
topic: sequencing the 5 AgentDetailModal simplification steps from the agent-modal-simplification report into an execution-ordered roadmap, accounting for overlap/dependencies with TASK-148 and TASK-150
slug: agent-modal-simplification-sequencing
researched: 2026-09-13
---

# Primary Sources — Sequencing the AgentDetailModal Simplification Steps

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | wiki task | `wiki/work/tasks/TASK-150-cohesive-color-palette.md` | 2026-09-13 | Confirmed TASK-150 rewrites `resolveRoleBadge`'s return shape and `RoleBadge`'s render body (Step 2) and `AgentTypeBadge`'s non-Claude color literals (Step 4) — the same components the badge-merge idea targets |
| S2 | raw research | `raw/research/agent-modal-simplification/index.md` | 2026-09-13 | The original badge-merge recommendation (#2) and confirmation that `RoleBadge`/`AgentTypeBadge` are structurally near-identical |
| S3 | wiki task | `wiki/work/tasks/TASK-148-agent-actions-dropdown-and-clone.md` | 2026-09-13 | Confirmed Step 5 re-wires Rename's trigger from a standalone button to a dropdown menu item, reusing the existing inline-input state unchanged — basis for sequencing click-to-rename after this task |
| S4 | codebase | `frontend/src/components/AgentList.tsx::AgentDetailModal` (Skills panel, lines ~817-845, previously read via `find_symbol`) | 2026-09-13 | Confirmed the Skills panel's nested `<details>` has no code overlap with the header action row or the badge components |

## Excerpts

### S1 — TASK-150 Step 2
`wiki/work/tasks/TASK-150-cohesive-color-palette.md`
> "In `frontend/src/components/AgentList.tsx`, change `ROLE_CONFIG`... from `className: 'bg-pink-100 text-pink-700...'`-style Tailwind classes to inline `style={{ background: 'var(--role-badge-<role>-bg)', color: 'var(--role-badge-<role>-text)' }}` on `RoleBadge`... Update `resolveRoleBadge`'s return type... from `{ role, className, dot }` to `{ role, bg, text, dot }`"

### S3 — TASK-148 Step 5
`wiki/work/tasks/TASK-148-agent-actions-dropdown-and-clone.md`
> "replace the three-button block... keeping the existing inline-rename `<input>`/Save/Cancel markup... rendered instead of the trigger whenever `showRenameInput` is true (same conditional structure as today, just no longer nested under a visible 'Rename' button)"
