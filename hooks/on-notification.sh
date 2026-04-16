#!/usr/bin/env bash
# on-notification.sh — Claude Code hook for Notification event
#
# Routes the Notification subtype (notification_type field in JSON payload)
# to the appropriate monitor state:
#
#   idle_prompt        → done   Agent returned to idle; avoids overwriting Stop's "done"
#                                with "wait" when a Notification fires after Stop.
#   permission_prompt  → wait   Agent paused awaiting user approval; monitor treats as busy.
#   elicitation_dialog → wait   Agent paused for MCP user input; monitor treats as busy.
#   auth_success       → (nop)  Informational only; agent state is unchanged.
#   <unknown>          → (nop)  Logs full payload to $STATE_DIR/hook.log for investigation.

set -u

STATE_DIR="${CONDUCTOR_STATE_DIR:-/conductor-state}"
AGENT_NAME="${CONDUCTOR_AGENT_NAME:-}"

# Fallback if CONDUCTOR_AGENT_NAME wasn't injected: derive from tmux window name.
# In local (non-container) mode the hook runs inside the tmux pane, so TMUX is set.
if [ -z "$AGENT_NAME" ] && [ -n "${TMUX:-}" ]; then
  AGENT_NAME=$(tmux display-message -p '#W' 2>/dev/null || true)
fi

# Capture JSON payload from stdin (Claude Code sends event data there).
PAYLOAD=$(cat 2>/dev/null || true)

[ -n "$AGENT_NAME" ] || exit 0
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

state_file="$STATE_DIR/${AGENT_NAME}.state"

notif_type=$(printf '%s' "$PAYLOAD" | jq -r '.notification_type // empty' 2>/dev/null || true)
case "$notif_type" in
  idle_prompt)                          printf 'done\n' > "$state_file" ;;
  permission_prompt|elicitation_dialog) printf 'wait\n' > "$state_file" ;;
  auth_success)                         ;;  # known type, no state change needed
  *)
    # Unmapped notification type — info-log full payload for investigation, leave state unchanged
    printf '[%s] %s: Notification type=%s (no state mapping) payload=%s\n' \
      "$(date +%H:%M:%S)" "$AGENT_NAME" "${notif_type:-<empty>}" "$PAYLOAD" \
      >> "$STATE_DIR/hook.log" 2>/dev/null || true
    ;;
esac

exit 0
