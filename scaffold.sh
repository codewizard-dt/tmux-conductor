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
IMAGE="ubuntu:24.04"
SERVICE="app"
FORCE=false
TARGET=""

# ── Usage ─────────────────────────────────────────────────────────────
usage() {
  cat <<'USAGE'
Usage: scaffold.sh <target-project-path> [OPTIONS]

Options:
  --image <base-image>    Base Docker image (default: ubuntu:24.04)
  --service <service-name> Service name in compose file (default: app)
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
COMPOSE_FILE="$TARGET/conductor-compose.yml"
DEVCONTAINER_DIR="$TARGET/.devcontainer"
DEVCONTAINER_FILE="$DEVCONTAINER_DIR/devcontainer.json"
DOCKERFILE="$DEVCONTAINER_DIR/Dockerfile"

# ── Generate .devcontainer/Dockerfile ─────────────────────────────────
mkdir -p "$DEVCONTAINER_DIR"

if [[ -f "$DOCKERFILE" ]] && [[ "$FORCE" != true ]]; then
  echo "Warning: $DOCKERFILE already exists — skipping (use --force to overwrite)"
else
  cat > "$DOCKERFILE" <<'DOCKERFILE'
FROM ${IMAGE}

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git sudo nodejs npm python3 python3-venv rsync jq \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (claude --dangerously-skip-permissions refuses root)
RUN useradd -m -s /bin/bash conductor

# Install Claude Code via native installer (not npm — avoids migration warning)
USER conductor
RUN curl -fsSL https://claude.ai/install.sh | bash

# Install uv (Python package/CLI runner used by many MCP servers)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/home/conductor/.local/bin:/home/conductor/.cargo/bin:${PATH}"

# Copy init script that seeds ~/.claude config from host copy (or generates defaults)
COPY --chown=conductor:conductor init-claude-config.sh /home/conductor/init-claude-config.sh
RUN chmod +x /home/conductor/init-claude-config.sh
DOCKERFILE
  # Re-expand IMAGE into the heredoc
  sed -i.bak "s|\${IMAGE}|${IMAGE}|g" "$DOCKERFILE" && rm -f "${DOCKERFILE}.bak"
  echo "Created: $DOCKERFILE"
fi

# ── Generate .devcontainer/init-claude-config.sh ──────────────────────
INIT_SCRIPT="$DEVCONTAINER_DIR/init-claude-config.sh"
if [[ -f "$INIT_SCRIPT" ]] && [[ "$FORCE" != true ]]; then
  echo "Warning: $INIT_SCRIPT already exists — skipping (use --force to overwrite)"
else
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

# Register Serena MCP project-local, keyed to the container workspace path
cd "/workspaces/${DIRNAME}"
claude mcp add serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project /workspaces/${DIRNAME} 2>&1 || echo "Serena already registered, skipping"

# Drop sentinel so subsequent container restarts skip this work
touch "\$HOME/.claude/.conductor-initialized"

exec "\$@"
EOF
  chmod +x "$INIT_SCRIPT"
  echo "Created: $INIT_SCRIPT"
fi

# ── Generate conductor-compose.yml ────────────────────────────────────
if [[ -f "$COMPOSE_FILE" ]] && [[ "$FORCE" != true ]]; then
  echo "Warning: $COMPOSE_FILE already exists — skipping (use --force to overwrite)"
else
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
    working_dir: /workspaces/${DIRNAME}
    env_file:
      - \${HOME}/.conductor_env
EOF
  echo "Created: $COMPOSE_FILE"
fi

# ── Generate .devcontainer/devcontainer.json ──────────────────────────
if [[ -f "$DEVCONTAINER_FILE" ]] && [[ "$FORCE" != true ]]; then
  echo "Warning: $DEVCONTAINER_FILE already exists — skipping (use --force to overwrite)"
else
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
echo "  Image:   $IMAGE"
echo "  Service: $SERVICE"
echo ""
echo "Next steps:"
echo "  1. Generate a token (once, valid 1 year):  claude setup-token"
echo "  2. Save it:  echo 'CLAUDE_CODE_OAUTH_TOKEN=<token>' >> ~/.conductor_env"
echo "  3. cd $TARGET"
echo "  4. docker compose -f conductor-compose.yml up -d --build"
echo "  5. Verify: docker compose -f conductor-compose.yml exec $SERVICE claude --version"
echo ""
echo "Auth: ~/.conductor_env is loaded as the container's env_file."
echo "      Token persists across reboots — regenerate only if revoked."
