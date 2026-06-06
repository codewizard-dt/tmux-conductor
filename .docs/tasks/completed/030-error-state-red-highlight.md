# 030 — Error State Detection + Red Highlight

> **Depends on**: [027-agent-accordion-list](027-agent-accordion-list.md)
> **Blocks**: none
> **Parallel-safe with**: [031-empty-queue-amber-highlight](031-empty-queue-amber-highlight.md), [032-awaiting-input-flash-icon](032-awaiting-input-flash-icon.md)

## Objective

Detect when an agent has entered an unrecoverable error state and surface a red highlight on its accordion header in the dashboard UI. Also add a new `error` state value to the hooks so `on-stop-failure.js` writes `error` instead of `idle`.

## Approach

Currently `on-stop-failure.js` writes `idle` on `StopFailure`. Change it to write `error` so the server's state reader can surface this distinct state. The `AgentList` component already has a `getStatusColor` helper from TASK-027 — update it to map `state === 'error'` → red badge. The server already returns `state` verbatim from the state file, so no server changes are needed.

---

## Steps

### 1. Update `on-stop-failure.js` to write `error`  <!-- agent: general-purpose -->

- [ ] Open `hooks/on-stop-failure.js`
- [ ] Change the state value written from `'idle'` to `'error'`
- [ ] Update `install-hooks.sh` or any hook registration that references the old value if needed
- [ ] Verify `node --check hooks/on-stop-failure.js` passes

### 2. Update `AgentList.tsx` status color logic  <!-- agent: general-purpose -->

- [ ] In `getStatusColor` (from TASK-027), add `state === 'error'` → red class
- [ ] The accordion section `<summary>` should show the red badge when the agent state is `error`
- [ ] Optionally add a brief "Error" label next to the badge for accessibility

### 3. Recovery: clear error state  <!-- agent: general-purpose -->

- [ ] When an agent recovers (e.g. user sends a new prompt and `on-prompt-submit.js` writes `busy`), the state file is overwritten and the red highlight clears automatically
- [ ] No additional UI action needed — the SSE poll cycle handles it

### 4. Verification  <!-- agent: general-purpose -->

- [ ] Write `error` to a state file: `echo error > logs/state/jobfinder.state`
- [ ] Within 3 seconds, the accordion header for that agent shows a red highlight
- [ ] Write `idle` to the state file: `echo idle > logs/state/jobfinder.state`
- [ ] Within 3 seconds, the red highlight disappears and the normal status badge reappears
- [ ] `node --check hooks/on-stop-failure.js` exits 0

---
**UAT**: [`.docs/uat/030-error-state-red-highlight.uat.md`](../uat/030-error-state-red-highlight.uat.md)
