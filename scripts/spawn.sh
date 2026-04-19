#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../conductor.conf"

mkdir -p "$LOG_DIR"

echo "=== tmux Conductor (split-pane mode) ==="
echo "Session:  $SESSION_NAME"
echo "Agents:   ${#AGENTS[@]}"
echo "Queue:    $TASK_QUEUE ($(wc -l < "$TASK_QUEUE" 2>/dev/null || echo 0) tasks)"
echo ""

# Kill existing session if present
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

# Helper: build the launch command, wrapping with agent_exec.sh for container mode
build_launch_cmd() {
  local launch_cmd="$1"
  if [[ "$EXEC_MODE" == "container" ]]; then
    echo "$SCRIPT_DIR/agent_exec.sh compose \"$COMPOSE_SERVICE\" -- $launch_cmd"
  else
    echo "$launch_cmd"
  fi
}

# Create session with first agent
IFS=: read -r name workdir launch_cmd <<< "${AGENTS[0]}"
tmux new-session -d -s "$SESSION_NAME" -c "$workdir"

cmd="$(build_launch_cmd "$launch_cmd")"
env_prefix="CONDUCTOR_AGENT_NAME='$name' CONDUCTOR_STATE_DIR='$STATE_DIR'"
tmux send-keys -t "$SESSION_NAME" "$env_prefix $cmd" Enter

echo "Spawned: $name ($cmd) in $workdir"

# Split for remaining agents
for (( i=1; i<${#AGENTS[@]}; i++ )); do
  IFS=: read -r name workdir launch_cmd <<< "${AGENTS[$i]}"
  tmux split-window -t "$SESSION_NAME" -c "$workdir"

  cmd="$(build_launch_cmd "$launch_cmd")"
  env_prefix="CONDUCTOR_AGENT_NAME='$name' CONDUCTOR_STATE_DIR='$STATE_DIR'"
  tmux send-keys -t "$SESSION_NAME" "$env_prefix $cmd" Enter
  tmux select-layout -t "$SESSION_NAME" tiled  # rebalance after each split

  echo "Spawned: $name ($cmd) in $workdir"
done

echo ""
echo "All ${#AGENTS[@]} agents launched in split-pane layout."
echo ""

# Attach (or print instructions if already in tmux)
if [ -n "${TMUX:-}" ]; then
  echo "Already in tmux. Switch with: tmux switch-client -t $SESSION_NAME"
else
  tmux attach-session -t "$SESSION_NAME"
fi
