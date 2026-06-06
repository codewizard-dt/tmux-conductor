# 019 — Remove scaffold.sh (devcontainer scaffolding no longer needed)

> **Depends on**: none
> **Blocks**: none
> **Parallel-safe with**: [018-strip-container-mode](018-strip-container-mode.md), [016-ensure-container-up](016-ensure-container-up.md), [017-command-center-dashboard](017-command-center-dashboard.md), [014-scripts-readme-flowchart](014-scripts-readme-flowchart.md)

## Objective

Delete `scripts/scaffold.sh` and `scripts/agent_exec.sh` (both are devcontainer-only scripts now superseded by the local-agent model), and remove all references to them in documentation files. Since agents run as plain `claude` tmux windows there is no container to scaffold.

## Approach

Archive both scripts under `scripts/.archive/` via `git mv` so the history is preserved but they are out of the active scripts path. Then remove doc references in `scripts/README.md`, `CLAUDE.md`, and `conductor.conf`. No code-side references remain after task 018 removes `build_launch_cmd` and `agent_exec.sh` wrapping from `conductor.sh`/`spawn.sh`.

---

## Steps

### 1. Archive the deleted scripts  <!-- agent: general-purpose -->

- [ ] Create `scripts/.archive/` directory: `mkdir -p scripts/.archive`
- [ ] Move `scripts/scaffold.sh` to archive:
  ```bash
  git mv scripts/scaffold.sh scripts/.archive/scaffold.sh
  ```
- [ ] Move `scripts/agent_exec.sh` to archive:
  ```bash
  git mv scripts/agent_exec.sh scripts/.archive/agent_exec.sh
  ```
- [ ] Confirm both files no longer exist at their original paths; `scripts/.archive/` now contains them

### 2. Update `scripts/README.md`  <!-- agent: general-purpose -->

- [ ] Remove the `scaffold.sh` row from the scripts table (the row that describes devcontainer scaffolding)
- [ ] Remove the `agent_exec.sh` row from the scripts table
- [ ] If either script is mentioned in the mermaid flowchart, remove those nodes and edges
- [ ] Add a brief note in a `## Archived Scripts` section at the bottom:
  ```markdown
  ## Archived Scripts

  The following scripts are preserved in `scripts/.archive/` for reference but are no longer part of the active system:

  - `scaffold.sh` — generated `devcontainer-compose.yml` and `.devcontainer/devcontainer.json`; superseded by local-agent model (ROADMAP-001)
  - `agent_exec.sh` — host-side container exec wrapper; superseded by local-agent model (ROADMAP-001)
  ```

### 3. Update `CLAUDE.md`  <!-- agent: general-purpose -->

- [ ] Remove the `scaffold.sh` row from the "Core Scripts" table
- [ ] Remove the `agent_exec.sh` row from the "Core Scripts" table
- [ ] In "Key Design Decisions", remove any mention of `agent_exec.sh` wrapping or `scaffold.sh`
- [ ] Remove the paragraph about the base image (`ghcr.io/codewizard-dt/tmux-conductor-base` weekly rebuild) if it only makes sense in the container context; if it's still relevant for reference, leave it
- [ ] Search for any remaining references to `scaffold.sh`, `agent_exec.sh`, `EXEC_MODE`, `COMPOSE_FILE`, `COMPOSE_SERVICE`, or `devcontainer` in `CLAUDE.md` and remove them

### 4. Update `conductor.conf`  <!-- agent: general-purpose -->

- [ ] Confirm there are no remaining references to `scaffold.sh` or `agent_exec.sh` in `conductor.conf` (task 018 should already have removed EXEC_MODE, COMPOSE_FILE, COMPOSE_SERVICE)

### 5. Verification  <!-- agent: general-purpose -->

- [ ] `ls scripts/scaffold.sh scripts/agent_exec.sh` returns "No such file" for both
- [ ] `ls scripts/.archive/scaffold.sh scripts/.archive/agent_exec.sh` shows both present
- [ ] `grep -r "scaffold.sh\|agent_exec" scripts/ CLAUDE.md conductor.conf` returns no results outside of `.archive/`
- [ ] `bash -n scripts/conductor.sh scripts/spawn.sh scripts/monitor.sh scripts/teardown.sh` all pass syntax check
