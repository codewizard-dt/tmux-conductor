# 031 — Empty-queue Amber Highlight

> **Depends on**: [027-agent-accordion-list](027-agent-accordion-list.md)
> **Blocks**: none
> **Parallel-safe with**: [030-error-state-red-highlight](030-error-state-red-highlight.md), [032-awaiting-input-flash-icon](032-awaiting-input-flash-icon.md)

## Objective

When an agent has no pending tasks (`queuedTasks === 0`) and is idle, its accordion header should show an amber/yellow highlight to signal that it is available but has nothing to do. This makes it immediately obvious which agents need work without scanning the task lists.

## Approach

The `queuedTasks` field is already returned in both the `/status` snapshot and in `agent-update` SSE events. TASK-027's `getStatusColor` helper already maps `state === 'idle' && queuedTasks === 0` → `empty` (amber). This task confirms that mapping is correct, adds the amber styling, and adds a tooltip or label for clarity.

---

## Steps

### 1. Confirm/implement `empty` status in `AgentList.tsx`  <!-- agent: general-purpose -->

- [ ] In `getStatusColor`, ensure the `empty` case returns an amber/yellow CSS class (e.g. `text-yellow-500` if using Tailwind, or a CSS variable)
- [ ] The `<summary>` element applies this class to the status badge when `status === 'empty'`
- [ ] Add an `aria-label` or `title` attribute of `"No queued tasks"` to the badge for accessibility

### 2. Add a plain CSS stylesheet if Tailwind is not set up  <!-- agent: general-purpose -->

- [ ] If the project does not already use Tailwind, create `scripts/dashboard/ui/src/styles/dashboard.css` with minimal status color variables:
  ```css
  .status-empty  { color: #d97706; } /* amber-600 */
  .status-idle   { color: #16a34a; } /* green-600 */
  .status-busy   { color: #2563eb; } /* blue-600 */
  .status-error  { color: #dc2626; } /* red-600 */
  .status-unknown { color: #9ca3af; } /* gray-400 */
  ```
- [ ] Import this stylesheet in `index.astro`

### 3. Verification  <!-- agent: general-purpose -->

- [ ] With the dashboard server running and an agent that has no queued tasks, the accordion header badge shows amber
- [ ] Add a task to the queue via the API (`POST /queue/:agent`) → within 3 seconds the badge changes from amber to the appropriate active color
- [ ] Remove all tasks → within 3 seconds the badge returns to amber

---
**UAT**: [`.docs/uat/031-empty-queue-amber-highlight.uat.md`](../uat/031-empty-queue-amber-highlight.uat.md)
