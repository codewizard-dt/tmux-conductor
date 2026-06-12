#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
source "$SCRIPT_DIR/../conductor.conf"

mkdir -p "$LOG_DIR"
export CONDUCTOR_LOG_DIR="$LOG_DIR"

# Restore backlog from previous run (prepend so rescued tasks get highest priority)
_backlog_file="$(dirname "$TASK_QUEUE")/tasks.backlog.txt"
if [ -f "$_backlog_file" ] && [ -s "$_backlog_file" ]; then
  _backlog_count=$(wc -l < "$_backlog_file" | tr -d ' ')
  _tmp_queue=$(mktemp)
  cat "$_backlog_file" "$TASK_QUEUE" 2>/dev/null > "$_tmp_queue" || true
  mv "$_tmp_queue" "$TASK_QUEUE"
  : > "$_backlog_file"
  echo "Restored ${_backlog_count} task(s) from tasks.backlog.txt"
fi
unset _backlog_file _backlog_count _tmp_queue

echo "=== tmux Conductor ==="
echo "Session:  $SESSION_NAME"
echo "Agents:   ${#AGENTS[@]}"
echo "BG procs: ${#BG_PROCESSES[@]}"
echo "Queue:    $TASK_QUEUE ($(wc -l < "$TASK_QUEUE" 2>/dev/null || echo 0) tasks)"
echo ""

# Kill existing session if present
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

# Create session with first agent
IFS=: read -r name workdir launch_cmd <<< "${AGENTS[0]}"
tmux new-session -d -s "$SESSION_NAME" -c "$workdir" -n "$name"

env_prefix="CONDUCTOR_AGENT_NAME='$name' CONDUCTOR_STATE_DIR='$STATE_DIR'"
tmux send-keys -t "$SESSION_NAME:$name" "$env_prefix $launch_cmd" Enter

echo "Spawned: $name ($launch_cmd) in $workdir"

# Spawn remaining agents as new windows
for (( i=1; i<${#AGENTS[@]}; i++ )); do
  IFS=: read -r name workdir launch_cmd <<< "${AGENTS[$i]}"
  tmux new-window -t "$SESSION_NAME" -n "$name" -c "$workdir"

  env_prefix="CONDUCTOR_AGENT_NAME='$name' CONDUCTOR_STATE_DIR='$STATE_DIR'"
  tmux send-keys -t "$SESSION_NAME:$name" "$env_prefix $launch_cmd" Enter

  echo "Spawned: $name ($launch_cmd) in $workdir"
done

# Spawn background processes as additional windows (host-side, no container wrap)
if [ "${#BG_PROCESSES[@]}" -gt 0 ]; then
  for entry in "${BG_PROCESSES[@]}"; do
    IFS=: read -r name workdir launch_cmd <<< "$entry"
    tmux new-window -t "$SESSION_NAME" -n "$name" -c "$workdir"
    tmux send-keys -t "$SESSION_NAME:$name" "$launch_cmd" Enter
    echo "Spawned bg: $name ($launch_cmd) in $workdir"
  done
fi

# Create conductor/monitor window
tmux new-window -t "$SESSION_NAME" -n "monitor" -c "$REPO_ROOT"
tmux send-keys -t "$SESSION_NAME:monitor" "$SCRIPT_DIR/monitor.sh" Enter

echo ""
echo "All agents launched. Attaching to session..."
echo "  Manual controls: see CONDUCTOR.md § Manual Controls"
echo ""

# Skip attach when launched by daemon
if [ -n "${CONDUCTOR_NO_ATTACH:-}" ]; then
  exit 0
fi

# Attach (or print instructions if already in tmux)
if [ -n "${TMUX:-}" ]; then
  echo "Already in tmux. Switch with: tmux switch-client -t $SESSION_NAME"
else
  tmux attach-session -t "$SESSION_NAME"
fi
