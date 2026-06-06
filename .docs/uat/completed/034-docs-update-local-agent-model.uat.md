# UAT: Docs Update — Local-Agent Model

> **Source task**: [`.docs/tasks/034-docs-update-local-agent-model.md`](../tasks/034-docs-update-local-agent-model.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Working directory is `/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] The three target files exist: `CLAUDE.md`, `README.md`, `scripts/README.md`

---

## Static Content Tests

These tests verify the documentation content directly by reading the files. No running server or live session is required.

---

### UAT-STATIC-001: CLAUDE.md — No stale container/Docker/EXEC_MODE references

- **File**: `CLAUDE.md`
- **Description**: Verify all container-era references (Docker, containers as product feature, EXEC_MODE, scaffold.sh as active script, devcontainers as active feature) have been removed. References that remain in the Shell Command Conventions section about `./tmp/` vs. container `/tmp/` are intentional guidance and acceptable.
- **Steps**:
  1. Read `CLAUDE.md` and scan for the following forbidden strings in the Project Overview, Architecture, Prerequisites, and Core Scripts sections: `Docker Desktop`, `container execution mode`, `EXEC_MODE`, `scaffold.sh` (as an active script entry), `devcontainer` (as an active feature)
  2. Confirm none appear in those sections
- **Expected Result**: None of the forbidden strings appear in the Project Overview, Architecture table, Prerequisites, or Key Design Decisions sections. The only permissible `container` references are in the Shell Command Conventions `./tmp/` note (describing container-internal `/tmp/` behaviour, which is intentional).
- [x] Pass <!-- 2026-06-06 -->

---

### UAT-STATIC-002: CLAUDE.md — Project Overview describes local-agent model

- **File**: `CLAUDE.md`
- **Description**: Verify the Project Overview paragraph reflects the current local-only agent model.
- **Steps**:
  1. Read the Project Overview section of `CLAUDE.md`
  2. Confirm it states that agents run directly in tmux windows on the host (no Docker/containers)
  3. Confirm it mentions the Astro+React dashboard and Fastify server
- **Expected Result**: The overview contains language equivalent to "each agent runs directly in its own tmux window on the host" and references the Fastify dashboard backend and Astro+React UI.
- [x] Pass <!-- 2026-06-06 -->

---

### UAT-STATIC-003: CLAUDE.md — Architecture table includes dashboard scripts

- **File**: `CLAUDE.md`
- **Description**: Verify the Core Scripts architecture table includes both dashboard components.
- **Steps**:
  1. Read the Architecture → Core Scripts table in `CLAUDE.md`
  2. Confirm `scripts/dashboard/server/index.js` is listed with port 8788 and the endpoints `/status`, `/agents`, `/queue/:agent`, `/events`
  3. Confirm `scripts/dashboard/ui/` is listed with port 4321 and described as the Astro+React frontend
- **Expected Result**: Both rows are present in the table with accurate port numbers and descriptions.
- [x] Pass <!-- 2026-06-06 -->

---

### UAT-STATIC-004: CLAUDE.md — Prerequisites includes Node.js >= 18

- **File**: `CLAUDE.md`
- **Description**: Verify the Prerequisites section lists Node.js as a requirement.
- **Steps**:
  1. Read the Prerequisites section of `CLAUDE.md`
  2. Confirm Node.js >= 18 (or equivalent) is listed
  3. Confirm Docker Desktop is NOT listed
- **Expected Result**: Node.js >= 18 is present; Docker Desktop is absent.
- [x] Pass <!-- 2026-06-06 -->

---

### UAT-STATIC-005: README.md — No Docker prerequisite; Node.js listed

- **File**: `README.md`
- **Description**: Verify the Prerequisites section no longer mentions Docker and now lists Node.js.
- **Steps**:
  1. Read the Prerequisites section of `README.md`
  2. Confirm `Docker Desktop` (or any Docker prerequisite) is absent
  3. Confirm Node.js >= 18 (or equivalent) is present
- **Expected Result**: Docker is absent; Node.js >= 18 is present.
- [x] Pass <!-- 2026-06-06 -->

---

### UAT-STATIC-006: README.md — Project description uses local-agent language

- **File**: `README.md`
- **Description**: Verify the opening description removes container language and reflects the local model.
- **Steps**:
  1. Read the top paragraph of `README.md`
  2. Confirm it does not mention Docker, container execution, or EXEC_MODE as active features
  3. Confirm it describes agents running directly in tmux windows and mentions the dashboard
- **Expected Result**: The description says agents run on the host (no containers) and references the Astro+React dashboard.
- [x] Pass <!-- 2026-06-06 -->

---

### UAT-STATIC-007: README.md — Dashboard section exists with quick-start commands

- **File**: `README.md`
- **Description**: Verify a Dashboard section is present with startup commands and endpoint table.
- **Steps**:
  1. Read `README.md` and locate the "Dashboard" section
  2. Confirm it exists as a top-level `##` section
  3. Confirm it lists port 8788 for the Fastify backend
  4. Confirm it lists port 4321 for the Astro+React UI
  5. Confirm it includes commands to start each component (`node index.js` for server, `npm run dev` for UI)
  6. Confirm it includes the endpoint table covering at minimum: `/status`, `/agents`, `/queue/:agent`, `/events`
- **Expected Result**: Dashboard section is present with both ports, both start commands, and a table of API endpoints.
- [x] Pass <!-- 2026-06-06 -->

---

### UAT-STATIC-008: scripts/README.md — scaffold.sh and agent_exec.sh only in Archived section

- **File**: `scripts/README.md`
- **Description**: Verify `scaffold.sh` and `agent_exec.sh` are not documented as active scripts and only appear in the Archived Scripts section.
- **Steps**:
  1. Read `scripts/README.md`
  2. Confirm neither `scaffold.sh` nor `agent_exec.sh` has a top-level `##` section describing it as an active script
  3. Confirm both appear under the "Archived Scripts" section (or equivalent)
- **Expected Result**: Both scripts are referenced only in the archived/deprecated context, not as active scripts with their own usage sections.
- [x] Pass <!-- 2026-06-06 -->

---

### UAT-STATIC-009: scripts/README.md — dashboard/server/ section documents port 8788

- **File**: `scripts/README.md`
- **Description**: Verify the `dashboard/server/` section is present and accurate.
- **Steps**:
  1. Read the `dashboard/server/` section of `scripts/README.md`
  2. Confirm the port is 8788 (not 8787)
  3. Confirm `index.js`, `config.js`, and `state.js` are listed with descriptions
  4. Confirm a usage command is provided (`node index.js` or equivalent)
- **Expected Result**: Section present, port is 8788, all three server files documented, usage command present.
- [x] Pass <!-- 2026-06-06 -->

---

### UAT-STATIC-010: scripts/README.md — dashboard/ui/ section is present

- **File**: `scripts/README.md`
- **Description**: Verify a `dashboard/ui/` section exists describing the Astro+React frontend.
- **Steps**:
  1. Read `scripts/README.md` and locate the `dashboard/ui/` section
  2. Confirm it exists with a description of the Astro+React SPA
  3. Confirm it mentions port 4321
  4. Confirm a usage command is provided (`npm run dev` or equivalent)
- **Expected Result**: Section present, port 4321 mentioned, Astro+React described, usage command provided.
- [x] Pass <!-- 2026-06-06 -->

---

### UAT-STATIC-011: scripts/README.md — Setup/Entry mermaid flowchart includes dashboard nodes

- **File**: `scripts/README.md`
- **Description**: Verify the Setup / Entry mermaid flowchart has been updated to include the dashboard server and UI nodes.
- **Steps**:
  1. Read the Setup / Entry flowchart in `scripts/README.md`
  2. Confirm a node for `dashboard/server/index.js` (or `DashServer`) with port 8788 is present
  3. Confirm a node for `dashboard/ui/` (or `DashUI`) with port 4321 is present
  4. Confirm edges show `conductor.sh` spawning both dashboard nodes via `BG_PROCESSES`
- **Expected Result**: Both dashboard nodes appear in the flowchart with correct port labels and edges from `conductor.sh`.
- [x] Pass <!-- 2026-06-06 -->

---

### UAT-STATIC-012: scripts/README.md — Going-forward summary table includes dashboard/ui/

- **File**: `scripts/README.md`
- **Description**: Verify the going-forward summary table at the bottom of `scripts/README.md` lists both dashboard components as Active.
- **Steps**:
  1. Read the Going-forward summary table in `scripts/README.md`
  2. Confirm `dashboard/server/*.js` is listed as Active
  3. Confirm `dashboard/ui/` is listed as Active
- **Expected Result**: Both dashboard rows present and marked Active.
- [x] Pass <!-- 2026-06-06 -->
