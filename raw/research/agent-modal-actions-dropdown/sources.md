---
topic: Collapse the AgentDetailModal action buttons (Rename/Close agent/Remove agent) into a 3-dot dropdown, and add a new button that duplicates the current agent with the same settings
slug: agent-modal-actions-dropdown
researched: 2026-09-13
---

# Primary Sources — Agent Modal Actions Dropdown + Clone

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `frontend/src/components/AgentList.tsx::AgentDetailModal` (lines 514-869, action row 703-763, `handleRename` 657-671, `doRemove` 623-628, `ConfirmDialog` usages ~907-922) | 2026-09-13 | Exact current action-row markup, per-button click handlers, and how Close/Remove already route through `ConfirmDialog` independent of the trigger control |
| S2 | codebase | `frontend/package.json` | 2026-09-13 | Confirms no headless-UI/menu dependency (Radix, Headless UI, etc.) is installed — only `@dnd-kit/*`, `@xterm/*`, `react`, `react-dom`, `react-router-dom` |
| S3 | codebase | `frontend/src/components/` (directory-wide search for existing dropdown/menu/popover patterns) | 2026-09-13 | No existing dropdown/menu component anywhere in the frontend to reuse |
| S4 | codebase | `wiki/work/tasks/TASK-134-clone-agent-button.md` | 2026-09-13 | Full existing (unstarted, status `todo`) plan for the duplicate-agent feature: naming-collision helper in `db.ts`, `POST /agents/:id/clone` route reusing `createAgent()`, `cloneAgent()` API client, and a literal "add a fourth flat button" UI step |
| S5 | codebase | `host-server/db.ts` (`Agent` type / `agents` table, lines 17-28) and `frontend/src/components/AddAgentForm.tsx` | 2026-09-13 | Full field set an agent clone needs (`workdir`, `launchCmd`, `role`, `projectId`, `worktreePath`) and confirmation that `AddAgentForm` collects exactly that same set, nothing more |
| S6 | web | https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/ | 2026-09-13 | WAI-ARIA Authoring Practices Menu Button pattern: `aria-haspopup="true"` on the trigger, keyboard behavior (Enter/Space open and focus first item), and the general accessible-menu structure to follow |
| S7 | web | https://www.w3.org/TR/wai-aria-practices/examples/menu-button/menu-button-actions.html | 2026-09-13 | "Actions Menu Button" worked example — the specific ARIA APG pattern variant for a button that opens a menu of actions/commands (as opposed to navigation links), directly matching this use case |

## Excerpts

### S4 — TASK-134-clone-agent-button.md
`wiki/work/tasks/TASK-134-clone-agent-button.md`
> Clone is structurally a pre-filled call into the existing `createAgent()`/`POST /agents` machinery, not a new data model. A new `POST /agents/:id/clone` route loads the source `Agent` via `getAgentById`, derives a unique name by appending `-copy` (bumping to `-copy-2`, `-copy-3`, … on collision, scoped the same way existing per-project/global uniqueness is enforced), and calls `createAgent()` with `useWorktree` set to whether the source agent has a `worktreePath`

> In `frontend/src/components/AgentList.tsx`, add a "Clone" button to `AgentDetailModal`'s header action row (alongside Rename/Close agent/Remove agent, ~lines 700-770), using the same `inline-flex h-7 ... rounded-[7px]` button classes as the existing actions with its own distinct accent color (blue/amber/red are taken — use a green or teal accent).

### S6 — Menu Button Pattern | APG | WAI | W3C
https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
> The menu button design pattern is used for a button that provides access to a menu of actions. When an element with role button has `aria-haspopup="true"`, browsers inform assistive technologies that the button is a menu button. A menu button is often styled as a typical push button with a downward pointing arrow or triangle to hint that activating the button will display a menu.

### S7 — Actions Menu Button Example | APG | WAI | W3C
https://www.w3.org/TR/wai-aria-practices/examples/menu-button/menu-button-actions.html
> With focus on the button, `Enter` opens the menu and places focus on the first menu item; `Space` also opens the menu and places focus on the first menu item. The keyboard behaviors needed after the menu is open are described in the Menu and Menubar Pattern.
