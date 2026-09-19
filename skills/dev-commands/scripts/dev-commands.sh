#!/usr/bin/env bash
# dev-commands.sh — Query registered background dev processes (list/status/tail)
#
# This script ships as part of the ~/.claude/skills/dev-commands skill bundle.
# It runs standalone from any project directory and queries the conductor's
# background process state without requiring knowledge of tmux internals or file paths.
#
# Usage:
#   dev-commands.sh list
#   dev-commands.sh status <name>
#   dev-commands.sh tail <name> [-n N]
#
# Environment:
#   CONDUCTOR_STATE_DIR  = directory containing bg-*.state files (required)
#   CONDUCTOR_LOG_DIR    = directory containing bg-*.log files (required)
#   BACKEND_PORT         = conductor host-server port (default: 8788)

set -euo pipefail

# Validate required environment variables before any subcommand logic
if [[ -z "${CONDUCTOR_STATE_DIR:-}" ]]; then
  echo "FATAL: CONDUCTOR_STATE_DIR is not set or empty" >&2
  echo "  (This environment variable should have been exported by conductor.sh or spawn.sh)" >&2
  exit 1
fi

if [[ -z "${CONDUCTOR_LOG_DIR:-}" ]]; then
  echo "FATAL: CONDUCTOR_LOG_DIR is not set or empty" >&2
  echo "  (This environment variable should have been exported by conductor.sh or spawn.sh)" >&2
  exit 1
fi

BACKEND_PORT="${BACKEND_PORT:-8788}"
BASE_URL="http://127.0.0.1:${BACKEND_PORT}"

# ============================================================================
# Helper: Attempt to fetch from the host-server, with graceful fallback
# ============================================================================
fetch_api_status() {
  # Return exit code 0 and output JSON if successful; exit 1 if unreachable
  curl -sf "$BASE_URL/api/status" 2>/dev/null || return 1
}

# ============================================================================
# Subcommand: list
# ============================================================================
cmd_list() {
  local json_output

  # Try to fetch live data from the host-server
  if json_output=$(fetch_api_status); then
    # Extract and pretty-print the bgProcesses array
    if command -v jq &> /dev/null; then
      echo "Background processes (from host-server):"
      echo "$json_output" | jq -r '.bgProcesses[] | "\(.name) — state: \(.state), window: \(.windowPresent)"' || {
        echo "FATAL: jq filter failed (malformed API response?)" >&2
        return 1
      }
    else
      # jq not available; fall through to offline fallback
      echo "Note: jq not available; using offline state files instead." >&2
      cmd_list_offline
      return $?
    fi
  else
    # Host-server unreachable; fall back to globbing state files
    echo "Note: host-server unreachable; using offline state files instead." >&2
    cmd_list_offline
    return $?
  fi
}

cmd_list_offline() {
  local state_files
  state_files=("$CONDUCTOR_STATE_DIR"/bg-*.state)

  if [[ ! -e "${state_files[0]}" ]]; then
    echo "No background processes registered yet."
    return 0
  fi

  echo "Background processes (from state files):"
  for state_file in "${state_files[@]}"; do
    if [[ -e "$state_file" ]]; then
      local name
      name=$(basename "$state_file" .state | sed 's/^bg-//')
      local state
      state=$(cat "$state_file")
      echo "$name — state: $state"
    fi
  done
}

# ============================================================================
# Subcommand: status <name>
# ============================================================================
cmd_status() {
  local name="$1"

  if [[ -z "$name" ]]; then
    echo "Usage: dev-commands.sh status <name>" >&2
    return 1
  fi

  local state_file="$CONDUCTOR_STATE_DIR/bg-$name.state"

  # Report the state file
  if [[ -f "$state_file" ]]; then
    local state
    state=$(cat "$state_file")
    echo "State file (bg-$name.state, may lag up to one poll interval):"
    echo "  $state"
  else
    echo "No state file for '$name' — was it ever registered?" >&2
    return 1
  fi

  # Try to fetch live data from the host-server
  echo ""
  if fetch_api_status > /dev/null 2>&1; then
    local json_output
    json_output=$(fetch_api_status)

    if command -v jq &> /dev/null; then
      local window_present
      window_present=$(echo "$json_output" | jq -r ".bgProcesses[] | select(.name == \"$name\") | .windowPresent" 2>/dev/null || echo "")

      if [[ -n "$window_present" ]]; then
        echo "Live window status (from host-server):"
        echo "  windowPresent: $window_present"
      else
        echo "Live window status: process '$name' not found in host-server response"
      fi
    else
      echo "Live cross-check unavailable (jq not installed)"
    fi
  else
    echo "Live cross-check unavailable (host-server unreachable)"
  fi
}

# ============================================================================
# Subcommand: tail <name> [-n N]
# ============================================================================
cmd_tail() {
  local name=""
  local lines=50

  # Parse arguments: accept both "tail <name> -n N" and "tail <name> N"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -n)
        shift
        if [[ $# -gt 0 ]]; then
          lines="$1"
          shift
        else
          echo "Usage: dev-commands.sh tail <name> [-n N]" >&2
          return 1
        fi
        ;;
      *)
        if [[ -z "$name" ]]; then
          name="$1"
        fi
        shift
        ;;
    esac
  done

  if [[ -z "$name" ]]; then
    echo "Usage: dev-commands.sh tail <name> [-n N]" >&2
    return 1
  fi

  local log_file="$CONDUCTOR_LOG_DIR/bg-$name.log"

  if [[ ! -f "$log_file" ]]; then
    echo "No log file for '$name' — has it printed output yet?" >&2
    return 1
  fi

  tail -n "$lines" "$log_file"
}

# ============================================================================
# Main dispatch
# ============================================================================
case "${1:-}" in
  list)
    cmd_list
    ;;
  status)
    shift || true
    cmd_status "$@"
    ;;
  tail)
    shift || true
    cmd_tail "$@"
    ;;
  *)
    echo "Usage: dev-commands.sh {list|status|tail} [options]" >&2
    echo "" >&2
    echo "Subcommands:" >&2
    echo "  list                 List all registered background processes and their state" >&2
    echo "  status <name>        Show state and live status for a specific process" >&2
    echo "  tail <name> [-n N]   Print the last N lines (default 50) of a process's log" >&2
    exit 1
    ;;
esac
