#!/usr/bin/env bash
#
# scaffold.sh — Sets up a target project for conductor dev containers
#
# Usage: scaffold.sh <target-project-path> [--image <base-image>] [--service <service-name>] [--force]
#
# Generates conductor-compose.yml and .devcontainer/devcontainer.json
# in the target project directory.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────
IMAGE="ghcr.io/codewizard-dt/tmux-conductor-base:latest"
SERVICE="app"
FORCE=false
TARGET=""
AGENT_NAME=""

# Resolve conductor repo root (dir containing this script) at scaffold time,
# so the generated compose file bakes absolute paths for hook + state mounts.
CONDUCTOR_REPO="$(cd "$(dirname "$0")" && pwd)"
CONDUCTOR_STATE_DIR_DEFAULT="${CONDUCTOR_REPO}/logs/state"

# ── Usage ─────────────────────────────────────────────────────────────
usage() {
  cat <<'USAGE'
Usage: scaffold.sh <target-project-path> [OPTIONS]

Options:
  --image <base-image>     Base Docker image (default: ghcr.io/codewizard-dt/tmux-conductor-base:latest)
  --service <service-name> Service name in compose file (default: app)
  --agent-name <name>      Conductor agent name (default: target directory basename).
                           Baked into the generated compose as CONDUCTOR_AGENT_NAME
                           so per-event hook scripts write the correct state file.
  --force                  Overwrite existing files without warning
  -h, --help               Show this help message
USAGE
  exit "${1:-0}"
}

# ── Parse CLI arguments ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)
      [[ -z "${2:-}" ]] && { echo "Error: --image requires a value"; exit 1; }
      IMAGE="$2"
      shift 2
      ;;
    --service)
      [[ -z "${2:-}" ]] && { echo "Error: --service requires a value"; exit 1; }
      SERVICE="$2"
      shift 2
      ;;
    --agent-name)
      [[ -z "${2:-}" ]] && { echo "Error: --agent-name requires a value"; exit 1; }
      AGENT_NAME="$2"
      shift 2
      ;;
    --force)
      FORCE=true
      shift
      ;;
    -h|--help)
      usage 0
      ;;
    -*)
      echo "Error: unknown option '$1'"
      usage 1
      ;;
    *)
      if [[ -z "$TARGET" ]]; then
        TARGET="$1"
      else
        echo "Error: unexpected argument '$1'"
        usage 1
      fi
      shift
      ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────
# Returns 0 if the file should be (over)written, 1 if it should be skipped.
# When --force is set, always overwrites. Otherwise prompts for a single y/n.
should_write() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    return 0
  fi
  if [[ "$FORCE" == true ]]; then
    return 0
  fi
  local reply=""
  while true; do
    # Read a single character from the controlling TTY so piping the script
    # still gives the user a chance to answer.
    read -rsn1 -p "Overwrite existing $path? [y/n] " reply </dev/tty
    echo
    case "$reply" in
      y|Y) return 0 ;;
      n|N) echo "Skipping: $path"; return 1 ;;
      *)   echo "Please answer y or n." ;;
    esac
  done
}

# ── Validate target path ─────────────────────────────────────────────
if [[ -z "$TARGET" ]]; then
  echo "Error: target project path is required"
  usage 1
fi

if [[ ! -d "$TARGET" ]]; then
  echo "Error: '$TARGET' is not a directory or does not exist"
  exit 1
fi

# ── Derived values ────────────────────────────────────────────────────
DIRNAME="$(basename "$(cd "$TARGET" && pwd)")"

# Default agent name to target dir basename (one agent per project — see
# memory project_one_agent_per_project.md). Override via --agent-name.
if [[ -z "$AGENT_NAME" ]]; then
  AGENT_NAME="$DIRNAME"
fi

COMPOSE_FILE="$TARGET/conductor-compose.yml"
DEVCONTAINER_DIR="$TARGET/.devcontainer"
DEVCONTAINER_FILE="$DEVCONTAINER_DIR/devcontainer.json"
DOCKERFILE="$DEVCONTAINER_DIR/Dockerfile"

# ── Generate .devcontainer/Dockerfile ─────────────────────────────────
mkdir -p "$DEVCONTAINER_DIR"

if should_write "$DOCKERFILE"; then
  cat > "$DOCKERFILE" <<'DOCKERFILE'
FROM ${IMAGE}

# The base image (ghcr.io/codewizard-dt/tmux-conductor-base) already provides:
#   - apt packages: curl ca-certificates git sudo nodejs npm python3 python3-venv rsync jq vim chromium
#   - non-root `conductor` user
#   - Claude Code CLI (~/.local/bin/claude)
#   - uv (~/.cargo/bin/uv)
# See https://github.com/codewizard-dt/tmux-conductor/blob/main/Dockerfile.base

# Copy init script that seeds ~/.claude config from host copy (or generates defaults)
COPY --chown=conductor:conductor init-claude-config.sh /home/conductor/init-claude-config.sh
USER conductor
RUN chmod +x /home/conductor/init-claude-config.sh
DOCKERFILE
  # Re-expand IMAGE into the heredoc
  sed -i.bak "s|\${IMAGE}|${IMAGE}|g" "$DOCKERFILE" && rm -f "${DOCKERFILE}.bak"
  echo "Created: $DOCKERFILE"
fi

# ── Generate .devcontainer/init-claude-config.sh ──────────────────────
INIT_SCRIPT="$DEVCONTAINER_DIR/init-claude-config.sh"
if should_write "$INIT_SCRIPT"; then
  cat > "$INIT_SCRIPT" <<EOF
#!/usr/bin/env bash
set -euo pipefail

# Skip re-initialization if sentinel present
if [[ -f "\$HOME/.claude/.conductor-initialized" ]]; then
  exec "\$@"
fi

mkdir -p "\$HOME/.claude"

# Seed ~/.claude.json from host copy if present, else fallback onboarding seed
if [[ -f /host-claude-config/.claude.json ]]; then
  cp /host-claude-config/.claude.json "\$HOME/.claude.json"
else
  echo '{"hasCompletedOnboarding":true,"installMethod":"native"}' > "\$HOME/.claude.json"
fi

# Bring over ~/.claude/ contents (settings, CLAUDE.md, plugins) but NOT live session state
if [[ -d /host-claude-config/.claude/ ]]; then
  rsync -a \\
    --exclude='.credentials.json' \\
    --exclude='sessions/' \\
    --exclude='projects/' \\
    --exclude='history.jsonl' \\
    --exclude='shell-snapshots/' \\
    --exclude='telemetry/' \\
    --exclude='ide/' \\
    /host-claude-config/.claude/ "\$HOME/.claude/"
fi

# Belt-and-suspenders: never carry host credentials into the container
rm -f "\$HOME/.claude/.credentials.json"

# Guarantee onboarding + native install method so Claude Code won't prompt
jq '.hasCompletedOnboarding = true | .installMethod = "native"' "\$HOME/.claude.json" > /tmp/claude.json && mv /tmp/claude.json "\$HOME/.claude.json"

# Rewrite host path prefixes in hook commands: anything before "/.claude/" is replaced
# with the container's \$HOME so foreign hooks (e.g. LSP enforcement kit) installed
# under ~/.claude/hooks/ still resolve inside the container. install-hooks.sh will
# separately dedup-merge tmux-conductor's own entries below.
if [[ -f "\$HOME/.claude/settings.json" ]]; then
  jq --arg home "\$HOME" '
    if .hooks then
      .hooks |= with_entries(
        .value |= map(
          .hooks |= map(
            if (.command // "") | test("/\\\\.claude/") then
              .command |= sub("^.*/\\\\.claude/"; \$home + "/.claude/")
            else . end
          )
        )
      )
    else . end
  ' "\$HOME/.claude/settings.json" > /tmp/settings-rehomed.json \\
    && mv /tmp/settings-rehomed.json "\$HOME/.claude/settings.json"
fi

# Register Serena MCP project-local, keyed to the container workspace path
cd "/workspaces/${DIRNAME}"
claude mcp add serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project /workspaces/${DIRNAME} 2>&1 || echo "Serena already registered, skipping"

# Register conductor per-event hooks into ~/.claude/settings.json.
# Hook command prefixes were rewritten to the container's \$HOME above, so foreign
# hooks (e.g. LSP enforcement) keep working alongside tmux-conductor's dedup-merged entries.
# install-hooks.sh copies scripts into ~/.claude/hooks/tmux-conductor/ and merges hook
# entries into settings.json with dedup-by-command (preserves foreign hook entries).
# The /conductor-hooks bind-mount is only needed at init time as the copy source;
# runtime hook execution reads from ~/.claude/hooks/tmux-conductor/.
# Idempotency: the sentinel file \$HOME/.claude/.conductor-initialized (touched below) short-circuits
# re-runs of this whole script, so install-hooks.sh runs exactly once per container lifetime — safe.
/conductor-hooks/install-hooks.sh

# Drop sentinel so subsequent container restarts skip this work
touch "\$HOME/.claude/.conductor-initialized"

exec "\$@"
EOF
  chmod +x "$INIT_SCRIPT"
  echo "Created: $INIT_SCRIPT"
fi

# ── Generate conductor-compose.yml ────────────────────────────────────
if should_write "$COMPOSE_FILE"; then
  # Ensure the state dir exists on the host before compose tries to bind-mount it
  # (otherwise Docker creates it as root-owned).
  mkdir -p "${CONDUCTOR_STATE_DIR_DEFAULT}"

  cat > "$COMPOSE_FILE" <<EOF
services:
  ${SERVICE}:
    build:
      context: .devcontainer
      dockerfile: Dockerfile
    command: ["/home/conductor/init-claude-config.sh", "sleep", "infinity"]
    stdin_open: true
    tty: true
    volumes:
      - .:/workspaces/${DIRNAME}:cached
      - \${HOME}/.claude:/host-claude-config/.claude:ro
      - \${HOME}/.claude.json:/host-claude-config/.claude.json:ro
      - ${CONDUCTOR_REPO}/hooks:/conductor-hooks:ro
      - ${CONDUCTOR_STATE_DIR_DEFAULT}:/conductor-state
    working_dir: /workspaces/${DIRNAME}
    env_file:
      - \${HOME}/.conductor_env
    environment:
      - CONDUCTOR_STATE_DIR=/conductor-state
      - CONDUCTOR_AGENT_NAME=${AGENT_NAME}
      - PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
      - PUPPETEER_SKIP_DOWNLOAD=true
      - PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
    extra_hosts:
      - "host.docker.internal:host-gateway"
EOF
  echo "Created: $COMPOSE_FILE"
fi

# ── Generate .devcontainer/devcontainer.json ──────────────────────────
if should_write "$DEVCONTAINER_FILE"; then
  cat > "$DEVCONTAINER_FILE" <<EOF
{
  "name": "conductor-agent",
  "dockerComposeFile": "../conductor-compose.yml",
  "service": "${SERVICE}",
  "workspaceFolder": "/workspaces/${DIRNAME}",
  "customizations": { "vscode": { "extensions": [] } }
}
EOF
  echo "Created: $DEVCONTAINER_FILE"
fi

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo "Scaffold complete for: $TARGET"
echo "  Image:       $IMAGE"
echo "  Service:     $SERVICE"
echo "  Agent name:  $AGENT_NAME"
echo "  Hooks mount: $CONDUCTOR_REPO/hooks -> /conductor-hooks (ro)"
echo "  State dir:   $CONDUCTOR_STATE_DIR_DEFAULT -> /conductor-state"
echo ""
echo "Next steps:"
echo "  Base image: $IMAGE"
echo "  1. Generate a token (once, valid 1 year):  claude setup-token"
echo "  2. Save it:  echo 'CLAUDE_CODE_OAUTH_TOKEN=<token>' >> ~/.conductor_env"
echo "  3. cd $TARGET"
echo "  4. docker compose -f conductor-compose.yml up -d --build"
echo "  5. Verify: docker compose -f conductor-compose.yml exec $SERVICE claude --version"
echo ""
echo "Auth: ~/.conductor_env is loaded as the container's env_file."
echo "      Token persists across reboots — regenerate only if revoked."
echo ""
echo "Host networking:"
echo "  Reach host services from inside the container at host.docker.internal:<port>."
echo "  Host dev servers MUST bind to 0.0.0.0 (not 127.0.0.1) to be reachable —"
echo "  e.g. 'astro dev --host' or 'vite --host 0.0.0.0'."
echo ""
echo "Browser automation:"
echo "  Chromium is pre-installed at /usr/bin/chromium in the base image."
echo "  Puppeteer uses it automatically via PUPPETEER_EXECUTABLE_PATH."
echo '  Pass args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]'
echo "  on puppeteer_launch when running as root in the container."
