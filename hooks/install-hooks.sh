#!/usr/bin/env bash
# install-hooks.sh — Register tmux-conductor per-event hooks into Claude Code settings.json
#
# Usage:
#   hooks/install-hooks.sh [--hook-dir <path>] [--settings-file <path>]
#
# Merges UserPromptSubmit, Stop, StopFailure, and Notification hook entries
# into the Claude Code settings file, cleans up stale PreToolUse entries,
# and preserves all other settings.

set -euo pipefail

# Defaults
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS_FILE="$HOME/.claude/settings.json"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hook-dir)
      HOOK_DIR="$2"
      shift 2
      ;;
    --settings-file)
      SETTINGS_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# Ensure the settings directory and file exist
mkdir -p "$(dirname "$SETTINGS_FILE")"
[ -f "$SETTINGS_FILE" ] || echo '{}' > "$SETTINGS_FILE"

# Merge hooks into settings.json using jq
# - Sets UserPromptSubmit, Stop, StopFailure, Notification hook arrays
# - Removes stale PreToolUse entries from older versions
# - Preserves all other settings
TMP_FILE="$(mktemp)"
jq --arg hook_dir "$HOOK_DIR" '
  .hooks.UserPromptSubmit = [{ "type": "command", "command": ($hook_dir + "/on-prompt-submit.sh") }] |
  .hooks.Stop = [{ "type": "command", "command": ($hook_dir + "/on-stop.sh") }] |
  .hooks.StopFailure = [{ "type": "command", "command": ($hook_dir + "/on-stop-failure.sh") }] |
  .hooks.Notification = [{ "type": "command", "command": ($hook_dir + "/on-notification.sh") }] |
  del(.hooks.PreToolUse)
' "$SETTINGS_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$SETTINGS_FILE"

echo "Conductor hooks registered in $SETTINGS_FILE"
