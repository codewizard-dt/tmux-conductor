# 029 — Add-agent Form

> **Depends on**: [026-scaffold-astro-react](026-scaffold-astro-react.md)
> **Blocks**: none
> **Parallel-safe with**: [027-agent-accordion-list](027-agent-accordion-list.md), [028-add-task-drag-reorder](028-add-task-drag-reorder.md), [033-wire-dashboard-conductor](033-wire-dashboard-conductor.md)

## Objective

Add an "Add Agent" form at the top of the dashboard page. The form collects a new agent name and working directory, calls `POST /agents`, and — if successful — causes the accordion list to show the new agent.

## Approach

Render the form above the `AgentList` component in `index.astro`. Keep its state local to an `AddAgentForm.tsx` React component. On successful `POST /agents`, the SSE stream will emit an `agent-update` event for the new agent within one poll cycle (≤2 s), which will add it to the `AgentList` automatically — no manual state wiring needed.

---

## Steps

### 1. Create `AddAgentForm.tsx`  <!-- agent: general-purpose -->

- [ ] Create `scripts/dashboard/ui/src/components/AddAgentForm.tsx`
- [ ] Renders two text inputs: **Name** (placeholder: `agent-name`, `^[a-z0-9_-]+$` pattern) and **Working directory** (placeholder: `/absolute/path`)
- [ ] An optional **Launch command** input (placeholder: `claude --dangerously-skip-permissions`) — collapsed behind a "Show advanced" toggle, pre-filled with the default
- [ ] A **Spawn Agent** button
- [ ] On submit:
  - Validate: name must match `^[a-z0-9_-]+$`; workdir must start with `/`
  - POST `{ name, workdir, launchCmd }` to `POST /agents`
  - On 201: clear the form, show a brief "Agent spawned" success message
  - On 409 (session not running or window exists): show the server's `error` field as an inline message
  - On other errors: show a generic "Failed to spawn agent" message

### 2. Wire into index page  <!-- agent: general-purpose -->

- [ ] Import `AddAgentForm` into `src/pages/index.astro`
- [ ] Render `<AddAgentForm client:load />` above the `<AgentList client:load />` element

### 3. Verification  <!-- agent: general-purpose -->

- [ ] The form renders above the accordion list
- [ ] Submitting an invalid name (spaces, uppercase) shows a validation error without making a network request
- [ ] When a conductor session is NOT running, submitting shows "session not running" error
- [ ] When a conductor session IS running, submitting spawns a new tmux window and, within 2 seconds, the new agent appears in the accordion list
- [ ] Submitting a duplicate name shows "window already exists" error

---
**UAT**: [`.docs/uat/029-add-agent-form.uat.md`](../uat/029-add-agent-form.uat.md)
