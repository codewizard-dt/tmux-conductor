# 003 — Container Config Sharing & Serena MCP Init

## Objective

Share the host's global Claude Code config and MCP servers into each conductor container via a first-boot init-copy pattern, and auto-register Serena MCP at the container workspace path.

## Approach

Read-only bind-mount `~/.claude/` and `~/.claude.json` at `/host-claude-config/` inside the container, then an entrypoint script copies them into the conductor user's home on first boot (gated by a sentinel file) and registers Serena as a project-local MCP keyed to `/workspaces/<dirname>`. Dockerfile installs Node.js, npm, uv, and Python 3 so mounted MCP server commands can actually execute inside the container.

## Prerequisites

- [ ] Task 001 (Initial Scaffolding) completed — `scaffold.sh` exists and generates `.devcontainer/Dockerfile` + `conductor-compose.yml`
- [ ] Host has `~/.claude.json` populated with user-scope `mcpServers` (verify: `jq '.mcpServers | keys' ~/.claude.json`)
- [ ] Host has `CLAUDE_CODE_OAUTH_TOKEN` set in `~/.conductor_env` (from task 001 auth flow)

---

## Steps

### 1. Update Dockerfile generation in `scaffold.sh`  <!-- agent: general-purpose --> <!-- Completed: 2026-04-13 -->

- [x] In `scaffold.sh`, modify the Dockerfile heredoc so the base apt install includes runtimes needed by common MCP servers
- [x] Add `uv` installer + PATH extension for conductor user
- [x] Remove the old pre-seeded `.claude.json` onboarding seed
- [x] Add `COPY` + `chmod +x` for `init-claude-config.sh`
- [x] Keep the Dockerfile `USER conductor` directive
  - Acceptance: `bash -n scaffold.sh` passes, generated Dockerfile builds successfully with `docker build`

### 2. Generate `init-claude-config.sh` from `scaffold.sh`  <!-- agent: general-purpose --> <!-- Completed: 2026-04-13 -->

- [ ] Add a new heredoc block in `scaffold.sh` (after the Dockerfile block, before the compose block) that writes `$DEVCONTAINER_DIR/init-claude-config.sh` with this behavior:
  - Shebang: `#!/usr/bin/env bash` with `set -euo pipefail`
  - Sentinel check at top: `if [[ -f "$HOME/.claude/.conductor-initialized" ]]; then exec "$@"; fi` — if already initialized, skip copy and exec the passed command
  - Ensure dirs exist: `mkdir -p "$HOME/.claude"`
  - If `/host-claude-config/.claude.json` exists, copy it to `$HOME/.claude.json` (overwriting whatever was seeded); otherwise write the fallback onboarding seed `{"hasCompletedOnboarding":true,"installMethod":"native"}`
  - If `/host-claude-config/.claude/` exists, `rsync -a --exclude='.credentials.json' --exclude='sessions/' --exclude='projects/' --exclude='history.jsonl' --exclude='shell-snapshots/' --exclude='telemetry/' --exclude='ide/' /host-claude-config/.claude/ "$HOME/.claude/"` — bring over `settings.json`, `CLAUDE.md`, `plugins/`, etc. but NOT live session/history state (those are container-local)
  - Explicitly remove any `$HOME/.claude/.credentials.json` (belt-and-suspenders; macOS hosts won't have one but Linux hosts might)
  - Rewrite `$HOME/.claude.json` to guarantee `hasCompletedOnboarding: true` and `installMethod: "native"` using `jq`:
    - `jq '.hasCompletedOnboarding = true | .installMethod = "native"' "$HOME/.claude.json" > /tmp/claude.json && mv /tmp/claude.json "$HOME/.claude.json"`
  - Register Serena MCP project-local, keyed to the container workspace path (which is `/workspaces/<DIRNAME>` — scaffold.sh must template `$DIRNAME` into this script at generation time):
    - `cd "/workspaces/${DIRNAME}"`
    - `claude mcp add serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project /workspaces/${DIRNAME} 2>&1 || echo "Serena already registered, skipping"`
  - Drop sentinel: `touch "$HOME/.claude/.conductor-initialized"`
  - Final line: `exec "$@"` — hand off to the container's main command
- [ ] Make sure the heredoc in `scaffold.sh` uses `<<EOF` (not `<<'EOF'`) so `${DIRNAME}` is interpolated at scaffold time, but uses `\$HOME` and `\$@` (escaped) so those remain literal shell variables in the generated script
- [ ] Respect `--force` flag: skip overwrite unless `FORCE=true`, matching existing scaffold.sh conventions
  - Acceptance: running `scaffold.sh <path> --force` produces `.devcontainer/init-claude-config.sh` with the container's actual project dirname baked into the Serena `--project` flag

### 3. Update compose generation in `scaffold.sh`  <!-- agent: general-purpose --> <!-- Completed: 2026-04-13 -->

- [ ] Modify the compose heredoc (currently at ~lines 121–133) to:
  - Restore the read-only host config mounts at a NEW path (not the previous `/home/conductor/.claude` destination):
    ```yaml
    - \${HOME}/.claude:/host-claude-config/.claude:ro
    - \${HOME}/.claude.json:/host-claude-config/.claude.json:ro
    ```
  - Keep the existing workspace mount: `- .:/workspaces/${DIRNAME}:cached`
  - Keep the existing `env_file: - ${HOME}/.conductor_env`
  - Replace `command: sleep infinity` with `command: ["/home/conductor/init-claude-config.sh", "sleep", "infinity"]` so the init script runs once on container start and then execs the keepalive
  - Keep `stdin_open: true`, `tty: true`, `working_dir: /workspaces/${DIRNAME}`
  - Acceptance: `docker compose -f conductor-compose.yml config` validates; no syntax errors

### 4. Update `conductor.sh` preflight  <!-- agent: general-purpose --> <!-- Completed: 2026-04-13 -->

- [ ] After the existing OAuth token + API key checks (around line 30–42), add an advisory check for MCP availability on the host:
  - If `command -v jq >/dev/null 2>&1` AND `~/.claude.json` exists, run `jq -e '.mcpServers | length > 0' ~/.claude.json >/dev/null 2>&1` and on failure print a non-fatal warning:
    - `"⚠ ~/.claude.json has no user-scope mcpServers — the container will start but no global MCPs will be shared."`
    - `"  Register one first: claude mcp add --scope user <name> -- <command>"`
  - Do not exit; this is informational only
- [ ] Verify the check does not run when `EXEC_MODE != "container"` — keep it inside the existing container-mode `if` block
  - Acceptance: `bash -n conductor.sh` passes; running conductor.sh on a host with no MCPs prints the warning but still launches

### 5. Update `README.md`  <!-- agent: general-purpose --> <!-- Completed: 2026-04-13 -->

- [ ] Locate the container-mode section that documents the scaffold flow
- [ ] Add a subsection "Shared configuration & MCPs" that documents:
  - The init-copy pattern (host config copied once into each container on first boot)
  - Which files are copied vs excluded (settings, CLAUDE.md, plugins copied; sessions/history/credentials NOT copied)
  - How to force a reset of a container's config: `docker compose exec app rm /home/conductor/.claude/.conductor-initialized` then restart
  - That Serena MCP is auto-registered per-container at the workspace path
  - That `CLAUDE_CODE_OAUTH_TOKEN` continues to be the auth source (credentials file is deliberately excluded)
- [ ] Update any step-by-step setup instructions to reflect that `nodejs`, `npm`, `uv`, `python3` are now part of the default container image
  - Acceptance: README has a clear "Shared config" heading under container-mode docs and references the init script

### 6. Verification  <!-- agent: general-purpose --> <!-- Partial: 2026-04-13 — automated checks pass; manual container build/run deferred to UAT -->

- [x] `bash -n scaffold.sh conductor.sh agent_exec.sh` — all three pass syntax check
- [x] Dry-run scaffold output inspected during step 2/3 sub-agent runs: Dockerfile COPYs `init-claude-config.sh`, generated init script has the project dirname baked into the Serena `--project` flag, compose mounts `/host-claude-config/.claude{,.json}` read-only and invokes the init script as its `command:`
- [ ] Build & run the test container: `docker compose -f conductor-compose.yml up -d --build` (user runs — manual, covered by UAT)
- [ ] Inside container: `docker compose exec app bash -c 'ls -la ~/.claude && cat ~/.claude/.conductor-initialized'` — sentinel exists (UAT)
- [ ] Inside container: `docker compose exec app claude mcp list` — shows host's user-scope MCPs plus `serena` (UAT)
- [ ] Inside container: `docker compose exec app claude /status` — `Auth token: CLAUDE_CODE_OAUTH_TOKEN`, no onboarding prompt (UAT)
- [ ] Rebuild (`docker compose up -d --force-recreate`) — init script short-circuits on sentinel (UAT)
