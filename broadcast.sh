#!/usr/bin/env bash
# Usage: broadcast.sh <command>
# Sends a command to all agent panes via dispatch.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/conductor.conf"

if [[ $# -lt 1 ]]; then
  echo "Usage: broadcast.sh <command>"
  exit 1
fi

CMD="$1"

sent=0
skipped=0

for entry in "${AGENTS[@]}"; do
  IFS=: read -r name _workdir _launch_cmd <<< "$entry"
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
