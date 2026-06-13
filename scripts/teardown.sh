#!/usr/bin/env bash
# Usage: teardown.sh
# Gracefully shuts down all agents and kills the conductor tmux session.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Shared SQLite helper library: defines load_agents/load_bg (populating
# AGENT_NAMES/BG_NAMES). db.sh sources conductor.conf only in a subshell, so the
# explicit conf source below is still required for SESSION_NAME etc.
source "$SCRIPT_DIR/../conductor.conf"
source "$SCRIPT_DIR/lib/db.sh"
load_agents
load_bg

echo "=== tmux Conductor — Teardown ==="
echo "Session: $SESSION_NAME"
echo ""

# Send /exit to each agent pane (ignore errors — pane may already be gone)
for name in "${AGENT_NAMES[@]}"; do
  echo "[$(date +%H:%M:%S)] Sending /exit to $name..."
  "$SCRIPT_DIR/dispatch.sh" "$SESSION_NAME:$name" "/exit" || true
done

# Send C-c to each bg-process window (ignore errors — window may already be gone)
for name in "${BG_NAMES[@]}"; do
  echo "[$(date +%H:%M:%S)] Sending C-c to bg '$name'..."
  tmux send-keys -t "$SESSION_NAME:$name" C-c 2>/dev/null || true
done

echo ""
echo "[$(date +%H:%M:%S)] Waiting 10 seconds for graceful exit..."
sleep 10

# Kill the tmux session
echo "[$(date +%H:%M:%S)] Killing tmux session '$SESSION_NAME'..."
tmux kill-session -t "$SESSION_NAME"

echo "[$(date +%H:%M:%S)] Teardown complete."
