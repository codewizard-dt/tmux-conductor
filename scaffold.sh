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

# ── Generate conductor-compose.yml ────────────────────────────────────
if [[ -f "$COMPOSE_FILE" ]] && [[ "$FORCE" != true ]]; then
  echo "Warning: $COMPOSE_FILE already exists — skipping (use --force to overwrite)"
else
  cat > "$COMPOSE_FILE" <<EOF
services:
  ${SERVICE}:
    image: ${IMAGE}
    command: sleep infinity
    volumes:
      - .:/workspaces/${DIRNAME}:cached
    working_dir: /workspaces/${DIRNAME}
EOF
  echo "Created: $COMPOSE_FILE"
fi

# ── Generate .devcontainer/devcontainer.json ──────────────────────────
if [[ -f "$DEVCONTAINER_FILE" ]] && [[ "$FORCE" != true ]]; then
  echo "Warning: $DEVCONTAINER_FILE already exists — skipping (use --force to overwrite)"
else
  mkdir -p "$DEVCONTAINER_DIR"
  cat > "$DEVCONTAINER_FILE" <<EOF
{
  "name": "conductor-agent",
  "dockerComposeFile": "../conductor-compose.yml",
  "service": "${SERVICE}",
  "workspaceFolder": "/workspaces/${DIRNAME}",
  "postCreateCommand": "echo 'conductor devcontainer ready'",
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
echo "  1. cd $TARGET"
echo "  2. docker compose -f conductor-compose.yml up -d"
echo "  3. Open in VS Code with Dev Containers extension, or run:"
echo "     docker compose -f conductor-compose.yml exec $SERVICE bash"
