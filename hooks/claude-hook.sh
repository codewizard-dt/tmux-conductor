#!/usr/bin/env bash
# claude-hook.sh — Claude Code lifecycle hook for tmux-conductor
#
# Installed into the agent container's ~/.claude/settings.json (see Step 6).
# Writes the agent's current state to $CONDUCTOR_STATE_DIR/<agent>.state so
# monitor.sh on the host can tell working vs. idle without scraping the TUI.
#
# Invoked by Claude Code with the event name as $1. JSON event payload arrives
# on stdin — we drain and ignore it.

set -u

STATE_DIR="${CONDUCTOR_STATE_DIR:-/conductor-state}"
AGENT_NAME="${CONDUCTOR_AGENT_NAME:-}"

# Fallback if CONDUCTOR_AGENT_NAME wasn't injected: derive from tmux session.
# In local (non-container) mode the hook runs inside the tmux pane, so TMUX is set.
if [ -z "$AGENT_NAME" ] && [ -n "${TMUX:-}" ]; then
  AGENT_NAME=$(tmux display-message -p '#W' 2>/dev/null || true)
fi

# Drain JSON payload from stdin (Claude Code sends event data there).
cat >/dev/null 2>&1 || true

[ -n "$AGENT_NAME" ] || exit 0
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

state_file="$STATE_DIR/${AGENT_NAME}.state"

case "${1:-}" in
  UserPromptSubmit|PreToolUse) printf 'working\n' > "$state_file" ;;
  Stop)                        printf 'done\n'    > "$state_file" ;;
  Notification)                printf 'wait\n'    > "$state_file" ;;
  *) ;;  # unknown event — leave state unchanged
esac

exit 0
