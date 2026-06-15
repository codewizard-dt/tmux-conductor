#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# Shared SQLite helper library: defines sql/sql_one, load_agents, load_bg, and
# resolves CONDUCTOR_DB. db.sh sources conductor.conf only in a subshell (to
# extract DB_PATH), so it does NOT export conf vars into this scope — the
# explicit conf source below is still required for SESSION_NAME, LOG_DIR,
# STATE_DIR, etc.
source "$SCRIPT_DIR/lib/db.sh"
source "$SCRIPT_DIR/../conductor.conf"
# Allow CONDUCTOR_SESSION_NAME env var to override the conf value (used by test suite)
if [[ -n "${CONDUCTOR_SESSION_NAME:-}" ]]; then
  SESSION_NAME="$CONDUCTOR_SESSION_NAME"
fi

# Agent and background-process lists are loaded from SQLite via load_agents /
# load_bg (see lib/db.sh). load_agents populates AGENT_NAMES + AGENT_DIRS/
# AGENT_CMDS/AGENT_BG; load_bg populates BG_NAMES + BG_DIRS/BG_CMDS.
load_agents
load_bg

# Conf-relative paths resolve against the repo root. These values are exported
# into each agent's environment, where the agent's own cwd differs — they must
# be absolute.
case "$LOG_DIR"    in /*) ;; *) LOG_DIR="$REPO_ROOT/${LOG_DIR#./}" ;; esac
case "$STATE_DIR"  in /*) ;; *) STATE_DIR="$REPO_ROOT/${STATE_DIR#./}" ;; esac

mkdir -p "$LOG_DIR"
export CONDUCTOR_LOG_DIR="$LOG_DIR"

echo "=== tmux Conductor ==="
echo "Session:  $SESSION_NAME"
echo "Agents:   ${#AGENT_NAMES[@]}"
echo "BG procs: ${#BG_NAMES[@]}"
echo "Queue:    $(sql "SELECT COUNT(*) FROM tasks WHERE status='queued'" 2>/dev/null || echo '?') task(s) in DB"
echo ""

# Validate all agent workdirs are git repo roots
for _name in "${AGENT_NAMES[@]}"; do
  _workdir="${AGENT_DIRS["$_name"]}"
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
window_name="${AGENT_WINDOW_NAMES["$name"]}"
workdir="${AGENT_DIRS["$name"]}"
launch_cmd="${AGENT_CMDS["$name"]}"
tmux new-session -d -s "$SESSION_NAME" -c "$workdir" -n "$window_name"

_linked_bg="${AGENT_BG["$name"]}"
_bg_env=""
if [ -n "$_linked_bg" ]; then
  _bg_env=" CONDUCTOR_BG_NAME='$_linked_bg' CONDUCTOR_BG_LOG='$LOG_DIR/bg-$_linked_bg.log' CONDUCTOR_BG_STATE='$STATE_DIR/bg-$_linked_bg.state'"
fi
env_prefix="CONDUCTOR_AGENT_NAME='$window_name' CONDUCTOR_STATE_DIR='$STATE_DIR' CONDUCTOR_LOG_DIR='$LOG_DIR'$_bg_env"
tmux send-keys -t "$SESSION_NAME:$window_name" "$env_prefix $launch_cmd" Enter

echo "Spawned: $name (window: $window_name) ($launch_cmd) in $workdir"

# Spawn remaining agents as new windows
for (( i=1; i<${#AGENT_NAMES[@]}; i++ )); do
  name="${AGENT_NAMES[$i]}"
  window_name="${AGENT_WINDOW_NAMES["$name"]}"
  workdir="${AGENT_DIRS["$name"]}"
  launch_cmd="${AGENT_CMDS["$name"]}"
  tmux new-window -t "$SESSION_NAME" -n "$window_name" -c "$workdir"

  _linked_bg="${AGENT_BG["$name"]}"
  _bg_env=""
  if [ -n "$_linked_bg" ]; then
    _bg_env=" CONDUCTOR_BG_NAME='$_linked_bg' CONDUCTOR_BG_LOG='$LOG_DIR/bg-$_linked_bg.log' CONDUCTOR_BG_STATE='$STATE_DIR/bg-$_linked_bg.state'"
  fi
  env_prefix="CONDUCTOR_AGENT_NAME='$window_name' CONDUCTOR_STATE_DIR='$STATE_DIR' CONDUCTOR_LOG_DIR='$LOG_DIR'$_bg_env"
  tmux send-keys -t "$SESSION_NAME:$window_name" "$env_prefix $launch_cmd" Enter

  echo "Spawned: $name (window: $window_name) ($launch_cmd) in $workdir"
done

# Spawn background processes as additional windows (host-side, no container wrap)
if [ "${#BG_NAMES[@]}" -gt 0 ]; then
  for name in "${BG_NAMES[@]}"; do
    workdir="${BG_DIRS["$name"]}"
    launch_cmd="${BG_CMDS["$name"]}"
    tmux new-window -t "$SESSION_NAME" -n "$name" -c "$workdir"
    tmux send-keys -t "$SESSION_NAME:$name" "$launch_cmd" Enter
    tmux pipe-pane -t "$SESSION_NAME:$name" -o "cat >> '$LOG_DIR/bg-$name.log'"
    echo "Spawned bg: $name ($launch_cmd) in $workdir (logging to $LOG_DIR/bg-$name.log)"
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
