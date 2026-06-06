# UAT: Update conductor.conf for local-agent model

> **Source task**: [`.docs/tasks/020-update-conductor-conf.md`](../../tasks/020-update-conductor-conf.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Working directory is the repo root of `tmux-conductor`
- [ ] Task 018 (strip-container-mode) changes are applied — `conductor.conf` is the post-018 version
- [ ] `bash --version` is available (bash 4+ preferred, but syntax check runs with system bash)

---

## Static / File-Content Checks

### UAT-STATIC-001: No container/Docker/Compose variables present
- **Description**: `conductor.conf` must not contain `EXEC_MODE`, `COMPOSE_FILE`, `COMPOSE_SERVICE`, or any reference to Docker or compose infrastructure
- **Steps**:
  1. Run the grep command below from the repo root
- **Command**:
  ```bash
  grep -iE "docker|container|compose|EXEC_MODE|COMPOSE_FILE|COMPOSE_SERVICE" conductor.conf && echo "FAIL: found forbidden references" || echo "PASS: no forbidden references"
  ```
- **Expected Result**: Prints `PASS: no forbidden references` — the grep matches nothing
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-002: CLAUDE_FLAGS is present
- **Description**: `conductor.conf` must define `CLAUDE_FLAGS` so operators can customise agent launch flags in one place
- **Steps**:
  1. Run the grep command below
- **Command**:
  ```bash
  grep -n 'CLAUDE_FLAGS' conductor.conf
  ```
- **Expected Result**: At least one line showing `CLAUDE_FLAGS` assigned a value (e.g. `CLAUDE_FLAGS="--dangerously-skip-permissions"`)
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-003: Agents section header comment is present and complete
- **Description**: The `# --- Agents ---` block must include the polished multi-line comment explaining the `<name>:<working_dir>:<launch_cmd>` format and calling out `claude --dangerously-skip-permissions` as the Claude Code example
- **Steps**:
  1. Run the grep commands below
- **Command**:
  ```bash
  grep -n "launch_cmd" conductor.conf && grep -n "dangerously-skip-permissions" conductor.conf
  ```
- **Expected Result**: At least one line showing `launch_cmd` in the comment block, and at least one line showing `--dangerously-skip-permissions` (either in the comment or in an AGENTS entry)
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-004: CONDUCTOR_LOG_DIR comment does not reference containers
- **Description**: If a `CONDUCTOR_LOG_DIR` comment exists in the file it must not say "inside the container" or use container-specific wording
- **Steps**:
  1. Run the grep command below
- **Command**:
  ```bash
  grep -i "CONDUCTOR_LOG_DIR" conductor.conf | grep -i "container" && echo "FAIL: stale container wording found" || echo "PASS: no stale container wording"
  ```
- **Expected Result**: Prints `PASS: no stale container wording`
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-005: conductor.conf passes bash syntax check
- **Description**: The file must be sourceable (or at least parse cleanly) without bash errors. We substitute an empty AGENTS array to avoid unbound-variable errors from unexpanded paths.
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  bash -n conductor.conf && echo "PASS: syntax OK" || echo "FAIL: syntax error"
  ```
- **Expected Result**: Prints `PASS: syntax OK` with no error output on stderr
- [x] Pass <!-- 2026-06-06 -->

---

## Content Integrity Checks

### UAT-CONTENT-001: AGENTS array is non-empty and uses local paths
- **Description**: The `AGENTS` array must contain at least one entry and each entry must follow the `name:path:cmd` format without any `docker exec` or `docker-compose exec` wrapper
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -A 10 '^AGENTS=(' conductor.conf | grep -v '^#' | grep -v '^AGENTS' | grep -v '^)' | grep -v '^$'
  ```
- **Expected Result**: One or more quoted strings in `"name:/path/to/dir:launch_cmd"` format. None of them should contain `docker` or `compose`
- [x] Pass <!-- 2026-06-06 -->

### UAT-CONTENT-002: Required top-level variables are all present
- **Description**: The file must define `SESSION_NAME`, `AGENTS`, `CLAUDE_FLAGS`, `IDLE_PATTERN`, `POLL_INTERVAL`, `USAGE_CHECK_CMD`, `TASK_QUEUE`, `LOG_DIR`, and `STATE_DIR`
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  for var in SESSION_NAME AGENTS CLAUDE_FLAGS IDLE_PATTERN POLL_INTERVAL USAGE_CHECK_CMD TASK_QUEUE LOG_DIR STATE_DIR; do
    grep -q "^${var}" conductor.conf && echo "OK: $var" || echo "MISSING: $var"
  done
  ```
- **Expected Result**: Every line reads `OK: <varname>` — no `MISSING:` lines
- [x] Pass <!-- 2026-06-06 -->
