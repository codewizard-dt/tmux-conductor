#!/usr/bin/env bash
# Usage: teardown.sh
# Gracefully shuts down all agents and kills the conductor tmux session.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../conductor.conf"

echo "=== tmux Conductor — Teardown ==="
echo "Session: $SESSION_NAME"
echo ""

# Send /exit to each agent pane (ignore errors — pane may already be gone)
for entry in "${AGENTS[@]}"; do
  IFS=: read -r name _workdir _launch_cmd <<< "$entry"
  echo "[$(date +%H:%M:%S)] Sending /exit to $name..."
  "$SCRIPT_DIR/dispatch.sh" "$SESSION_NAME:$name" "/exit" || true
done

echo ""
echo "[$(date +%H:%M:%S)] Waiting 10 seconds for graceful exit..."
sleep 10

# Kill the tmux session
echo "[$(date +%H:%M:%S)] Killing tmux session '$SESSION_NAME'..."
tmux kill-session -t "$SESSION_NAME"

echo "[$(date +%H:%M:%S)] Teardown complete."
