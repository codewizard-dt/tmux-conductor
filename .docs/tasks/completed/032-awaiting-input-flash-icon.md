# 032 — Awaiting-input Flash Icon

> **Depends on**: [027-agent-accordion-list](027-agent-accordion-list.md)
> **Blocks**: none
> **Parallel-safe with**: [030-error-state-red-highlight](030-error-state-red-highlight.md), [031-empty-queue-amber-highlight](031-empty-queue-amber-highlight.md)

## Objective

Surface a gently flashing `!` icon on an agent's accordion header when that agent is awaiting user input (i.e. it has paused and needs an interactive response before it can continue). This helps the user spot which agents need attention at a glance.

## Approach

Claude Code does not emit a dedicated "awaiting input" lifecycle event, so we detect the state via `capture-pane` pattern matching. The pattern is: the last line of the pane output matches a question prompt (e.g. ends with `?` or `[Y/n]`) while the state file still shows `busy`. Add a new `awaiting` state that the monitor can write when this heuristic fires, and surface it in the UI.

To keep this self-contained: add an `AWAITING_PATTERN` to `conductor.conf` (similar to `IDLE_PATTERN`), add detection logic to `monitor.sh`, and write `awaiting` to the state file when the pattern matches a busy agent.

---

## Steps

### 1. Add `AWAITING_PATTERN` to `conductor.conf`  <!-- agent: general-purpose -->

- [ ] Open `conductor.conf`
- [ ] Add a new config variable:
  ```bash
  AWAITING_PATTERN='(\?$|\[Y/n\]|\[y/N\]|>$)'
  ```
  (matches lines ending in `?`, `[Y/n]`, `[y/N]`, or `>`)

### 2. Detect awaiting state in `monitor.sh`  <!-- agent: general-purpose -->

- [ ] In the `check_agent` or equivalent poll function, after the busy/idle state check, add a secondary check:
  - If `state == busy` AND last line of `capture-pane -p` matches `$AWAITING_PATTERN`, write `awaiting` to the state file
- [ ] If the state is `awaiting` but a subsequent poll shows the pane output no longer matches, revert to `busy` (the agent is working again)

### 3. Update `AgentList.tsx` for the `awaiting` state  <!-- agent: general-purpose -->

- [ ] In `getStatusColor`, add `state === 'awaiting'` → `awaiting` (yellow, distinct from amber)
- [ ] Add a flashing `!` character next to the status badge when `status === 'awaiting'`:
  ```css
  @keyframes flash { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
  .flash { animation: flash 1s ease-in-out infinite; }
  ```
- [ ] Add `aria-live="polite"` and `aria-label="Awaiting user input"` to the flash icon for accessibility

### 4. Verification  <!-- agent: general-purpose -->

- [ ] Write `awaiting` to a state file: `echo awaiting > logs/state/jobfinder.state`
- [ ] Within 3 seconds, the accordion header shows a flashing `!` icon
- [ ] Write `busy` back: `echo busy > logs/state/jobfinder.state`
- [ ] Within 3 seconds, the flash icon disappears
- [ ] `bash -n scripts/monitor.sh` exits 0 (no syntax errors)

---
**UAT**: [`.docs/uat/completed/032-awaiting-input-flash-icon.uat.md`](../uat/completed/032-awaiting-input-flash-icon.uat.md)
