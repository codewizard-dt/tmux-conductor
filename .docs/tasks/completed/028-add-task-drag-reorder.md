# 028 — Add-task Form + Drag-to-Reorder

> **Depends on**: [026-scaffold-astro-react](026-scaffold-astro-react.md)
> **Blocks**: none
> **Parallel-safe with**: [027-agent-accordion-list](027-agent-accordion-list.md), [029-add-agent-form](029-add-agent-form.md), [033-wire-dashboard-conductor](033-wire-dashboard-conductor.md)

## Objective

Add two interaction features inside each agent's accordion section: (1) an inline form to add a new task to that agent's queue, and (2) drag handles on each task item to reorder the queue entries via drag-and-drop.

## Approach

Use `@dnd-kit/core` and `@dnd-kit/sortable` for drag-to-reorder — these are lightweight, pointer/touch-friendly, and work well with React. The add-task form calls `POST /queue/:agent`. The reorder operation calls `PUT /queue/:agent/reorder` with the new index array. Both calls use the `PUBLIC_API_URL` env var.

---

## Steps

### 1. Install dnd-kit  <!-- agent: general-purpose -->

- [ ] In `scripts/dashboard/ui/`, run:
  ```bash
  npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
  ```

### 2. Create `TaskList.tsx` with drag-to-reorder  <!-- agent: general-purpose -->

- [ ] Create `scripts/dashboard/ui/src/components/TaskList.tsx`
- [ ] Accept props: `agentName: string`, `tasks: string[]`, `onReorder: (newOrder: number[]) => void`
- [ ] Wrap items in `<DndContext>` + `<SortableContext>` from `@dnd-kit/sortable`
- [ ] Each `SortableItem` renders the task text plus a drag handle icon (≡ or ⋮⋮)
- [ ] On `onDragEnd`, compute the new index array and call `onReorder`
- [ ] `onReorder` should call `PUT /queue/:agent/reorder` and, on success, update parent state

### 3. Create `AddTaskForm.tsx`  <!-- agent: general-purpose -->

- [ ] Create `scripts/dashboard/ui/src/components/AddTaskForm.tsx`
- [ ] Accept props: `agentName: string`, `onAdded: (task: string) => void`
- [ ] Renders a text `<input>` and an "Add" `<button>`
- [ ] On submit (button click or Enter key), calls `POST /queue/:agent` with `{ task }` body
- [ ] On success, clears the input and calls `onAdded(task)` to let the parent optimistically update its list
- [ ] On error, shows a brief inline error message

### 4. Integrate into AgentList accordion sections  <!-- agent: general-purpose -->

- [ ] Import `TaskList` and `AddTaskForm` into `AgentList.tsx`
- [ ] Replace the plain `<li>` task list with `<TaskList agentName={...} tasks={...} onReorder={...} />`
- [ ] Render `<AddTaskForm agentName={...} onAdded={...} />` below the task list inside each accordion section

### 5. Verification  <!-- agent: general-purpose -->

- [ ] Adding a task via the form appends it to the queue and the UI updates without page reload
- [ ] Dragging a task item changes its position; the `PUT /queue/:agent/reorder` request succeeds
- [ ] After reorder, refreshing the page shows the new order (confirming the server persisted it)
- [ ] Empty task string is rejected (button disabled or validation error shown)

---
**UAT**: [`.docs/uat/028-add-task-drag-reorder.uat.md`](../uat/028-add-task-drag-reorder.uat.md)
