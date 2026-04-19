#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/conductor.conf"

mkdir -p "$LOG_DIR"
export CONDUCTOR_LOG_DIR="$LOG_DIR"

echo "=== tmux Conductor ==="
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

# Pre-flight: check auth for container mode
if [[ "$EXEC_MODE" == "container" ]]; then
  if [[ ! -f "$HOME/.conductor_env" ]] || ! grep -q "CLAUDE_CODE_OAUTH_TOKEN" "$HOME/.conductor_env" 2>/dev/null; then
    echo "⚠ Missing CLAUDE_CODE_OAUTH_TOKEN in ~/.conductor_env"
    echo "  1. Run:   claude setup-token"
    echo "  2. Save:  echo 'CLAUDE_CODE_OAUTH_TOKEN=<token>' >> ~/.conductor_env"
    exit 1
  fi
  # Reject conflicting credentials that would take precedence over the OAuth token.
  # Precedence: ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY > apiKeyHelper > CLAUDE_CODE_OAUTH_TOKEN
  if grep -qE '^[[:space:]]*(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN)=' "$HOME/.conductor_env"; then
    echo "⚠ ~/.conductor_env contains ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN."
    echo "  These override CLAUDE_CODE_OAUTH_TOKEN and route through the API instead of your subscription."
    echo "  Remove those lines, then retry."
    exit 1
  fi
  echo "Auth:     ✓ (token found in ~/.conductor_env)"

  # Advisory: check that the host has user-scope MCP servers registered to share into the container
  if command -v jq >/dev/null 2>&1 && [[ -f "$HOME/.claude.json" ]]; then
    if ! jq -e '.mcpServers | length > 0' "$HOME/.claude.json" >/dev/null 2>&1; then
      echo "⚠ ~/.claude.json has no user-scope mcpServers — the container will start but no global MCPs will be shared."
      echo "  Register one first: claude mcp add --scope user <name> -- <command>"
    fi
  fi
  echo ""
fi

# Create session with first agent
IFS=: read -r name workdir launch_cmd <<< "${AGENTS[0]}"
tmux new-session -d -s "$SESSION_NAME" -c "$workdir" -n "$name"

cmd="$(build_launch_cmd "$launch_cmd")"
env_prefix="CONDUCTOR_AGENT_NAME='$name' CONDUCTOR_STATE_DIR='$STATE_DIR'"
tmux send-keys -t "$SESSION_NAME:$name" "$env_prefix $cmd" Enter

echo "Spawned: $name ($cmd) in $workdir"

# Spawn remaining agents as new windows
for (( i=1; i<${#AGENTS[@]}; i++ )); do
  IFS=: read -r name workdir launch_cmd <<< "${AGENTS[$i]}"
  tmux new-window -t "$SESSION_NAME" -n "$name" -c "$workdir"

  cmd="$(build_launch_cmd "$launch_cmd")"
  env_prefix="CONDUCTOR_AGENT_NAME='$name' CONDUCTOR_STATE_DIR='$STATE_DIR'"
  tmux send-keys -t "$SESSION_NAME:$name" "$env_prefix $cmd" Enter

  echo "Spawned: $name ($cmd) in $workdir"
done

# Create conductor/monitor window
tmux new-window -t "$SESSION_NAME" -n "monitor" -c "$SCRIPT_DIR"
tmux send-keys -t "$SESSION_NAME:monitor" "$SCRIPT_DIR/monitor.sh" Enter

echo ""
echo "All agents launched. Attaching to session..."
echo "  Manual controls: see CONDUCTOR.md § Manual Controls"
echo ""

# Attach (or print instructions if already in tmux)
if [ -n "${TMUX:-}" ]; then
  echo "Already in tmux. Switch with: tmux switch-client -t $SESSION_NAME"
else
  tmux attach-session -t "$SESSION_NAME"
fi
