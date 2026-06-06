# 027 — Agent Accordion List

> **Depends on**: [026-scaffold-astro-react](026-scaffold-astro-react.md)
> **Blocks**: [030-error-state-red-highlight](030-error-state-red-highlight.md), [031-empty-queue-amber-highlight](031-empty-queue-amber-highlight.md), [032-awaiting-input-flash-icon](032-awaiting-input-flash-icon.md)
> **Parallel-safe with**: [028-add-task-drag-reorder](028-add-task-drag-reorder.md), [029-add-agent-form](029-add-agent-form.md), [033-wire-dashboard-conductor](033-wire-dashboard-conductor.md)

## Objective

Build the main `AgentList` React component for the dashboard: a vertically stacked accordion list where each agent gets its own collapsible section. Each section header shows the agent name and a status badge; the body lists the agent's pending tasks. Status color-coding: **amber** = empty queue, **red** = error, **flashing `!`** = awaiting user input, **green** = idle with tasks, **blue** = busy.

## Approach

Subscribe to the SSE stream (`GET /events`) via the browser's `EventSource` API. On connect, fetch the initial snapshot from `GET /status`. Merge incoming `agent-update` and `session-update` events into local React state. Render each agent as a `<details>`/`<summary>` accordion or a custom controlled component. Use Tailwind CSS classes (or plain CSS modules) for color coding — no third-party component library needed.

---

## Steps

### 1. Create `AgentList.tsx` component  <!-- agent: general-purpose -->

- [ ] Create `scripts/dashboard/ui/src/components/AgentList.tsx`
- [ ] On mount, fetch `GET /status` from `PUBLIC_API_URL` to populate initial agent list
- [ ] Open an `EventSource` to `GET /events`; on `agent-update` merge the changed agent into state; on `session-update` update `sessionAlive` state
- [ ] Close the `EventSource` on component unmount
- [ ] Render each agent as a collapsible `<details>` element with `<summary>` showing agent name + status badge
- [ ] The task list inside each accordion section shows each pending task as a `<li>` item
- [ ] If `agents` is empty and `sessionAlive` is `false`, show a "Session not running" banner

### 2. Status badge with color coding  <!-- agent: general-purpose -->

- [ ] Derive a `status` value for each agent:
  - `state === 'busy'` → `busy` (blue)
  - `state === 'idle'` && `queuedTasks > 0` → `idle` (green)
  - `state === 'idle'` && `queuedTasks === 0` → `empty` (amber)
  - `state === 'error'` → `error` (red)
  - anything else → `unknown` (gray)
- [ ] Render a colored dot/pill badge next to the agent name using the derived status
- [ ] Export a `getStatusColor(status)` helper for reuse in tasks 030–032

### 3. Wire into index page  <!-- agent: general-purpose -->

- [ ] Replace the `Placeholder` component import in `src/pages/index.astro` with `AgentList`
- [ ] Pass `client:load` directive so React hydrates immediately

### 4. Verification  <!-- agent: general-purpose -->

- [ ] `npm run dev` (in `scripts/dashboard/ui/`) starts without error
- [ ] Browser at `http://localhost:4321` shows the accordion list
- [ ] With the dashboard server running (`node scripts/dashboard/server/index.js`), the list reflects actual agents from `conductor.conf`
- [ ] Manually write `busy` to a state file → the corresponding agent badge updates within 3 seconds without page reload
- [ ] Collapsing/expanding an accordion section works

---
**UAT**: [`.docs/uat/027-agent-accordion-list.uat.md`](../uat/027-agent-accordion-list.uat.md)
