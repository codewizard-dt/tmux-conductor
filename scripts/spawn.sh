#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Shared SQLite helper library: defines sql/sql_one, load_agents, load_bg, and
# resolves CONDUCTOR_DB. db.sh sources conductor.conf only in a subshell (to
# extract DB_PATH), so it does NOT export conf vars into this scope — the
# explicit conf source below is still required for SESSION_NAME, LOG_DIR,
# STATE_DIR, TASK_QUEUE, etc.
source "$SCRIPT_DIR/lib/db.sh"
source "$SCRIPT_DIR/../conductor.conf"

# Agent and background-process lists are loaded from SQLite via load_agents /
# load_bg (see lib/db.sh). load_agents populates AGENT_NAMES + AGENT_DIRS/
# AGENT_CMDS/AGENT_BG; load_bg populates BG_NAMES + BG_DIRS/BG_CMDS.
load_agents
load_bg

# Conf-relative paths resolve against the repo root — exported into each
# agent's environment, so they must be absolute.
case "$LOG_DIR"    in /*) ;; *) LOG_DIR="$REPO_ROOT/${LOG_DIR#./}" ;; esac
case "$STATE_DIR"  in /*) ;; *) STATE_DIR="$REPO_ROOT/${STATE_DIR#./}" ;; esac
case "$TASK_QUEUE" in /*) ;; *) TASK_QUEUE="$REPO_ROOT/${TASK_QUEUE#./}" ;; esac

mkdir -p "$LOG_DIR"

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

echo "=== tmux Conductor (split-pane mode) ==="
echo "Session:  $SESSION_NAME"
echo "Agents:   ${#AGENT_NAMES[@]}"
echo "Queue:    $TASK_QUEUE ($(wc -l < "$TASK_QUEUE" 2>/dev/null || echo 0) tasks)"
echo ""

# Validate all agent workdirs are git repo roots
for _name in "${AGENT_NAMES[@]}"; do
  _workdir="${AGENT_DIRS[$_name]}"
  if [ ! -e "$_workdir/.git" ]; then
    echo "Error: workdir '$_workdir' for agent '$_name' is not the root of a git repository (no .git found)" >&2
    exit 1
  fi
done
unset _name _workdir

# Kill existing session if present
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

# Create session with first agent
name="${AGENT_NAMES[0]}"
workdir="${AGENT_DIRS[$name]}"
launch_cmd="${AGENT_CMDS[$name]}"
tmux new-session -d -s "$SESSION_NAME" -c "$workdir"

_linked_bg="${AGENT_BG[$name]}"
_bg_env=""
if [ -n "$_linked_bg" ]; then
  _bg_env=" CONDUCTOR_BG_NAME='$_linked_bg' CONDUCTOR_BG_LOG='$LOG_DIR/bg-$_linked_bg.log' CONDUCTOR_BG_STATE='$STATE_DIR/bg-$_linked_bg.state'"
fi
env_prefix="CONDUCTOR_AGENT_NAME='$name' CONDUCTOR_STATE_DIR='$STATE_DIR' CONDUCTOR_LOG_DIR='$LOG_DIR'$_bg_env"
tmux send-keys -t "$SESSION_NAME" "$env_prefix $launch_cmd" Enter

echo "Spawned: $name ($launch_cmd) in $workdir"

# Split for remaining agents
for (( i=1; i<${#AGENT_NAMES[@]}; i++ )); do
  name="${AGENT_NAMES[$i]}"
  workdir="${AGENT_DIRS[$name]}"
  launch_cmd="${AGENT_CMDS[$name]}"
  tmux split-window -t "$SESSION_NAME" -c "$workdir"

  _linked_bg="${AGENT_BG[$name]}"
  _bg_env=""
  if [ -n "$_linked_bg" ]; then
    _bg_env=" CONDUCTOR_BG_NAME='$_linked_bg' CONDUCTOR_BG_LOG='$LOG_DIR/bg-$_linked_bg.log' CONDUCTOR_BG_STATE='$STATE_DIR/bg-$_linked_bg.state'"
  fi
  env_prefix="CONDUCTOR_AGENT_NAME='$name' CONDUCTOR_STATE_DIR='$STATE_DIR' CONDUCTOR_LOG_DIR='$LOG_DIR'$_bg_env"
  tmux send-keys -t "$SESSION_NAME" "$env_prefix $launch_cmd" Enter
  tmux select-layout -t "$SESSION_NAME" tiled  # rebalance after each split

  echo "Spawned: $name ($launch_cmd) in $workdir"
done

# Split for background processes (host-side, no container wrap)
if [ "${#BG_NAMES[@]}" -gt 0 ]; then
  for name in "${BG_NAMES[@]}"; do
    workdir="${BG_DIRS[$name]}"
    launch_cmd="${BG_CMDS[$name]}"
    tmux split-window -t "$SESSION_NAME" -c "$workdir"
    tmux send-keys -t "$SESSION_NAME" "$launch_cmd" Enter
    tmux pipe-pane -t "$SESSION_NAME" -o "cat >> '$LOG_DIR/bg-$name.log'"
    tmux select-layout -t "$SESSION_NAME" tiled
    echo "Spawned bg: $name ($launch_cmd) in $workdir (logging to $LOG_DIR/bg-$name.log)"
  done
fi

echo ""
if [ "${#BG_NAMES[@]}" -gt 0 ]; then
  echo "All ${#AGENT_NAMES[@]} agents + ${#BG_NAMES[@]} bg processes launched in split-pane layout."
else
  echo "All ${#AGENT_NAMES[@]} agents launched in split-pane layout."
fi
echo ""

# Attach (or print instructions if already in tmux)
if [ -n "${TMUX:-}" ]; then
  echo "Already in tmux. Switch with: tmux switch-client -t $SESSION_NAME"
else
  tmux attach-session -t "$SESSION_NAME"
fi
