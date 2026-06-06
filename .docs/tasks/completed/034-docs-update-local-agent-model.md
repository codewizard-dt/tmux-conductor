# 034 — Docs Update: Local-agent Model

> **Depends on**: [033-wire-dashboard-conductor](033-wire-dashboard-conductor.md), [027-agent-accordion-list](027-agent-accordion-list.md)
> **Blocks**: none
> **Parallel-safe with**: none

## Objective

Update `CLAUDE.md`, the root `README.md`, and `scripts/README.md` to reflect the completed local-only agent model: no Docker, no containers, Claude Code running directly in tmux windows, with the Astro+React dashboard for management.

## Approach

Read each file, identify stale references to containers/Docker/EXEC_MODE, and replace with accurate descriptions. Add a "Dashboard" section covering the Fastify backend and Astro frontend. Update the architecture table and script inventory.

---

## Steps

### 1. Update `CLAUDE.md`  <!-- agent: general-purpose -->

- [ ] Remove all references to Docker, containers, `EXEC_MODE`, `scaffold.sh`, devcontainers
- [ ] Update the "Project Overview" to reflect local tmux windows + Claude directly
- [ ] Add a "Dashboard" subsection to the Architecture section:
  - `scripts/dashboard/server/index.js` — Fastify backend on port 8788 with `/status`, `/queue/:agent`, `/agents`, `/events`
  - `scripts/dashboard/ui/` — Astro+React single-page app on port 4321

### 2. Update root `README.md`  <!-- agent: general-purpose -->

- [ ] Update the project description to remove container language
- [ ] Add a "Dashboard" quick-start section with commands to start the server and UI
- [ ] Update the "Prerequisites" section (remove Docker, add Node.js v18+)
- [ ] Update architecture diagram or overview if present

### 3. Update `scripts/README.md`  <!-- agent: general-purpose -->

- [ ] Remove or archive documentation for removed scripts (`scaffold.sh`, `agent_exec.sh`)
- [ ] Add entries for the dashboard directory:
  - `scripts/dashboard/server/` — Fastify backend
  - `scripts/dashboard/ui/` — Astro+React frontend
- [ ] Update the mermaid flowchart to include the dashboard server and UI as nodes

### 4. Verification  <!-- agent: general-purpose -->

- [ ] `grep -r 'docker\|container\|EXEC_MODE\|scaffold\.sh\|devcontainer' CLAUDE.md README.md scripts/README.md` returns no false-positive matches (only references that legitimately remain, e.g. in changelog context or .archive notes)
- [ ] Both `CLAUDE.md` and `README.md` describe the local-agent model accurately
- [ ] The architecture table in `CLAUDE.md` includes the two dashboard scripts

---
**UAT**: [`.docs/uat/completed/034-docs-update-local-agent-model.uat.md`](../uat/completed/034-docs-update-local-agent-model.uat.md)
