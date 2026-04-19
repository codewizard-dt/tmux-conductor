#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: agent_exec.sh <mode> <target> -- <cmd...>

Modes:
  compose   Run via docker compose exec (uses COMPOSE_FILE env or conductor-compose.yml)
  docker    Run via docker exec

Examples:
  agent_exec.sh compose myservice -- bash -c "echo hello"
  agent_exec.sh docker mycontainer -- ls /app
EOF
  exit 2
}

if [[ $# -lt 3 ]]; then
  usage
fi

MODE="$1"
TARGET="$2"
shift 2

# Consume the -- separator
if [[ "${1:-}" != "--" ]]; then
  usage
fi
shift

if [[ $# -eq 0 ]]; then
  usage
fi

case "$MODE" in
  compose)
    COMPOSE_FILE="${COMPOSE_FILE:-conductor-compose.yml}"
    exec docker compose -f "$COMPOSE_FILE" exec \
      -e ANTHROPIC_API_KEY= \
      -e ANTHROPIC_AUTH_TOKEN= \
      -e CONDUCTOR_AGENT_NAME \
      -e CONDUCTOR_STATE_DIR=/conductor-state \
      -e CONDUCTOR_LOG_DIR=/conductor-logs \
      "$TARGET" "$@"
    ;;
  docker)
    exec docker exec -i \
      -e CONDUCTOR_AGENT_NAME \
      -e CONDUCTOR_STATE_DIR=/conductor-state \
      -e CONDUCTOR_LOG_DIR=/conductor-logs \
      "$TARGET" "$@"
    ;;
  *)
    echo "Error: unknown mode '$MODE'" >&2
    usage
    ;;
esac
