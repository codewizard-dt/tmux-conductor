#!/usr/bin/env bash
# Usage: broadcast.sh <command>
# Sends a command to all agent panes via dispatch.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# db.sh sources conductor.conf only in a subshell (to extract DB_PATH), so the
# explicit conf source below is still required for SESSION_NAME etc.
source "$SCRIPT_DIR/../conductor.conf"
# Agent list is loaded from SQLite via load_agents (see lib/db.sh), which fills
# AGENT_NAMES. No load_bg — broadcast only targets agents.
source "$SCRIPT_DIR/lib/db.sh"
load_agents

if [[ $# -lt 1 ]]; then
  echo "Usage: broadcast.sh <command>"
  exit 1
fi

CMD="$1"

sent=0
skipped=0

for name in "${AGENT_NAMES[@]}"; do
  target="$SESSION_NAME:$name"

  if tmux has-session -t "$target" 2>/dev/null; then
    "$SCRIPT_DIR/dispatch.sh" "$target" "$CMD"
    (( sent++ ))
  else
    echo "[$(date +%H:%M:%S)] Skipped $target (pane not found)"
    (( skipped++ ))
  fi
done

echo "[$(date +%H:%M:%S)] Broadcast complete: $sent sent, $skipped skipped"
