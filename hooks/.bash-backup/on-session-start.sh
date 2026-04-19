#!/usr/bin/env bash
# on-session-start.sh — Claude Code hook for SessionStart event.
# Writes "idle" to $CONDUCTOR_STATE_DIR/<agent>.state so monitor.sh
# starts in the idle state on startup/resume/clear.

set -u

STATE_DIR="${CONDUCTOR_STATE_DIR:-/conductor-state}"
AGENT_NAME="${CONDUCTOR_AGENT_NAME:-}"

# Fallback if CONDUCTOR_AGENT_NAME wasn't injected: derive from tmux window name.
# In local (non-container) mode the hook runs inside the tmux pane, so TMUX is set.
if [ -z "$AGENT_NAME" ] && [ -n "${TMUX:-}" ]; then
  AGENT_NAME=$(tmux display-message -p '#W' 2>/dev/null || true)
fi

# Drain JSON payload from stdin (Claude Code sends event data there).
cat >/dev/null 2>&1 || true

[ -n "$AGENT_NAME" ] || exit 0
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

printf 'idle\n' > "$STATE_DIR/${AGENT_NAME}.state"

exit 0
