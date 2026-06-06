# 033 — Wire Dashboard into conductor.sh + teardown.sh

> **Depends on**: [026-scaffold-astro-react](026-scaffold-astro-react.md)
> **Blocks**: none
> **Parallel-safe with**: [027-agent-accordion-list](027-agent-accordion-list.md), [028-add-task-drag-reorder](028-add-task-drag-reorder.md), [029-add-agent-form](029-add-agent-form.md)

## Objective

Wire the dashboard into the conductor lifecycle: spawn the dashboard server and UI dev server as tmux windows when `conductor.sh` starts, and send `C-c` to gracefully stop them during `teardown.sh`.

## Approach

Use the existing `BG_PROCESSES` mechanism in `conductor.conf` to declare the two dashboard processes (server + UI). Both are already host-side processes (no container), already have named windows, and already get `C-c` during teardown — exactly what `BG_PROCESSES` provides. No changes to `conductor.sh` or `teardown.sh` are needed; only `conductor.conf` needs two new entries.

---

## Steps

### 1. Add dashboard processes to `conductor.conf`  <!-- agent: general-purpose -->

- [ ] Open `conductor.conf`
- [ ] Add two entries to `BG_PROCESSES`:
  ```bash
  BG_PROCESSES=(
    "dashboard-server:$(pwd)/scripts/dashboard/server:node index.js"
    "dashboard-ui:$(pwd)/scripts/dashboard/ui:npm run dev"
  )
  ```
  (Use the actual repo-root-relative paths; `$(pwd)` evaluated at session start is fine since `conductor.sh` runs from the repo root)

### 2. Verify BG_PROCESSES behavior in conductor.sh  <!-- agent: general-purpose -->

- [ ] Read `scripts/conductor.sh` to confirm that `BG_PROCESSES` entries are:
  - Spawned as named tmux windows with the given `workdir` and `cmd`
  - Excluded from the idle-poll loop
  - Sent `C-c` during teardown
- [ ] If any gap exists between the spec and implementation, fix `conductor.sh` before closing this task

### 3. Verification  <!-- agent: general-purpose -->

- [ ] Start a conductor session with `./scripts/conductor.sh`
- [ ] `tmux list-windows` shows windows named `dashboard-server` and `dashboard-ui` alongside agent windows
- [ ] `curl http://127.0.0.1:8788/healthz` returns `{"ok":true}` (server is running)
- [ ] `curl http://localhost:4321/` returns HTML with "tmux Conductor Dashboard" (UI is running)
- [ ] Run `./scripts/teardown.sh` — both dashboard windows close cleanly

---
**UAT**: [`.docs/uat/033-wire-dashboard-conductor.uat.md`](../uat/033-wire-dashboard-conductor.uat.md)
