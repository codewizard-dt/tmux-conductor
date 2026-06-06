# UAT: Wire Dashboard into conductor.sh + teardown.sh

> **Source task**: [`.docs/tasks/033-wire-dashboard-conductor.md`](../tasks/033-wire-dashboard-conductor.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] tmux is installed and available on `$PATH`
- [ ] `node` (v22+) is available on `$PATH`
- [ ] `npm` is available on `$PATH`
- [ ] `scripts/dashboard/server/node_modules` is populated (`npm install` run in `scripts/dashboard/server/`)
- [ ] `scripts/dashboard/ui/node_modules` is populated (`npm install` run in `scripts/dashboard/ui/`)
- [ ] No pre-existing tmux session named `conductor` is running
- [ ] Working directory is the repo root (`/Users/davidtaylor/Repositories/tmux-conductor`)

---

## Static Config Tests

### UAT-CFG-001: conductor.conf declares dashboard-server in BG_PROCESSES

- **Description**: Verify `conductor.conf` contains the `dashboard-server` entry pointing at the correct workdir and start command.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -c 'dashboard-server:/Users/davidtaylor/Repositories/tmux-conductor/scripts/dashboard/server:node index.js' conductor.conf
  ```
- **Expected Result**: Output is `1` (exactly one matching line)
- [x] Pass <!-- 2026-06-06 -->

### UAT-CFG-002: conductor.conf declares dashboard-ui in BG_PROCESSES

- **Description**: Verify `conductor.conf` contains the `dashboard-ui` entry pointing at the correct workdir and start command.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -c 'dashboard-ui:/Users/davidtaylor/Repositories/tmux-conductor/scripts/dashboard/ui:npm run dev' conductor.conf
  ```
- **Expected Result**: Output is `1` (exactly one matching line)
- [x] Pass <!-- 2026-06-06 -->

---

## Live Session Tests

> **Note**: These tests require starting a real conductor session. They are human-verified. Run `./scripts/conductor.sh` before proceeding with UAT-SESSION-001 through UAT-API-002, then run `./scripts/teardown.sh` for UAT-TEARDOWN-001.

### UAT-SESSION-001: dashboard-server window is present after conductor starts

- **Description**: Verify that `conductor.sh` spawns a tmux window named `dashboard-server`.
- **Steps**:
  1. Start the conductor session: `./scripts/conductor.sh`
  2. Wait ~5 seconds for all processes to start
  3. Run the command below
- **Command**:
  ```bash
  tmux list-windows -t conductor -F '#{window_name}'
  ```
- **Expected Result**: Output includes a line `dashboard-server`
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

### UAT-SESSION-002: dashboard-ui window is present after conductor starts

- **Description**: Verify that `conductor.sh` spawns a tmux window named `dashboard-ui`.
- **Steps**:
  1. Conductor session must already be running (see UAT-SESSION-001)
  2. Run the command below
- **Command**:
  ```bash
  tmux list-windows -t conductor -F '#{window_name}'
  ```
- **Expected Result**: Output includes a line `dashboard-ui`
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

---

## API Tests

> **Note**: These tests require the conductor session to be running (dashboard-server started). Wait ~5 seconds after `conductor.sh` for the server to be ready.

### UAT-API-001: dashboard-server health check responds OK

- **Description**: Verify the dashboard server started by `BG_PROCESSES` is reachable and healthy at port 8788.
- **Steps**:
  1. Conductor session must be running (UAT-SESSION-001 passed)
  2. Run the command below
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/healthz'
  ```
- **Expected Result**: `{"ok":true}`
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

### UAT-API-002: dashboard UI responds with correct page title

- **Description**: Verify the Astro dev server started by `BG_PROCESSES` serves the dashboard at port 4321 with the expected HTML title.
- **Steps**:
  1. Conductor session must be running and `dashboard-ui` window has started (UAT-SESSION-002 passed). Wait up to 15 seconds for `astro dev` to compile on first start.
  2. Run the command below
- **Command**:
  ```bash
  curl -sS 'http://localhost:4321/' | grep -c '<title>tmux Conductor Dashboard</title>'
  ```
- **Expected Result**: Output is `1`
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

---

## Teardown Tests

### UAT-TEARDOWN-001: teardown.sh stops both dashboard windows cleanly

- **Description**: Verify that running `teardown.sh` sends `C-c` to both `dashboard-server` and `dashboard-ui` windows and the tmux session is fully killed.
- **Steps**:
  1. Conductor session must be running (UAT-SESSION-001 and UAT-SESSION-002 passed)
  2. Run `./scripts/teardown.sh` and observe output
  3. Run the verification command below after teardown completes
- **Command**:
  ```bash
  tmux has-session -t conductor 2>&1; echo "exit:$?"
  ```
- **Expected Result**:
  - `teardown.sh` output includes lines like `Sending C-c to bg 'dashboard-server'...` and `Sending C-c to bg 'dashboard-ui'...`
  - Verification command outputs `exit:1` (session no longer exists)
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->
