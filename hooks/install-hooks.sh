#!/usr/bin/env bash
# install-hooks.sh — Install tmux-conductor per-event hooks into Claude Code.
#
# Usage:
#   hooks/install-hooks.sh [--hook-dir <path>] [--settings-file <path>] [--install-dir <path>]
#
# Copies the four per-event hook scripts to a stable install dir under
# $HOME/.claude/hooks/tmux-conductor/ and merge-registers them in
# $HOME/.claude/settings.json. Uses a dedup-by-command jq filter that preserves
# foreign hook entries while replacing any prior tmux-conductor registrations
# (including stale repo-path entries from older installs). Also cleans up
# deprecated PreToolUse and Notification entries from earlier versions.
#
# Idempotent: running twice produces byte-identical settings.json.

set -euo pipefail

# Defaults
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS_FILE="$HOME/.claude/settings.json"
INSTALL_DIR="$HOME/.claude/hooks/tmux-conductor"

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
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# Copy hook scripts to the stable install dir
mkdir -p "$INSTALL_DIR"
for script in on-session-start.sh on-prompt-submit.sh on-stop.sh on-stop-failure.sh; do
  cp "$HOOK_DIR/$script" "$INSTALL_DIR/$script"
  chmod +x "$INSTALL_DIR/$script"
done

# Ensure the settings directory and file exist
mkdir -p "$(dirname "$SETTINGS_FILE")"
[ -f "$SETTINGS_FILE" ] || echo '{}' > "$SETTINGS_FILE"

# Merge hooks into settings.json via a single jq invocation.
#
# For each event:
#   1. Initialize .hooks and .hooks.<Event> to [] if missing.
#   2. Drop any top-level entry whose hooks[].command either
#        (a) equals the new command we're about to register, or
#        (b) matches .*/hooks/on-(session-start|prompt-submit|stop|stop-failure)\.sh$
#            AND does NOT start with "$install_dir/" (stale repo-path cleanup).
#   3. Append the freshly-built entry.
#
# SessionStart carries a matcher; the other three events don't.
# Deprecated .hooks.PreToolUse and .hooks.Notification entries from older
# installs are deleted.
TMP_FILE="$(mktemp)"
jq --arg install_dir "$INSTALL_DIR" '
  def stale_cmd($new_cmd):
    (.command == $new_cmd)
    or (
      (.command | test("/hooks/on-(session-start|prompt-submit|stop|stop-failure)\\.sh$"))
      and ((.command | startswith($install_dir + "/")) | not)
    );

  def purge($new_cmd):
    map(
      (.hooks |= (. // [] | map(select(stale_cmd($new_cmd) | not))))
      | select((.hooks | length) > 0)
    );

  def register_with_matcher($event; $matcher; $new_cmd):
    .hooks |= (. // {})
    | .hooks[$event] |= ((. // []) | purge($new_cmd))
    | .hooks[$event] += [{
        "matcher": $matcher,
        "hooks": [{ "type": "command", "command": $new_cmd }]
      }];

  def register($event; $new_cmd):
    .hooks |= (. // {})
    | .hooks[$event] |= ((. // []) | purge($new_cmd))
    | .hooks[$event] += [{
        "hooks": [{ "type": "command", "command": $new_cmd }]
      }];

  register_with_matcher("SessionStart"; "startup|resume|clear"; $install_dir + "/on-session-start.sh")
  | register("UserPromptSubmit"; $install_dir + "/on-prompt-submit.sh")
  | register("Stop"; $install_dir + "/on-stop.sh")
  | register("StopFailure"; $install_dir + "/on-stop-failure.sh")
  | del(.hooks.PreToolUse)
  | del(.hooks.Notification)
' "$SETTINGS_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$SETTINGS_FILE"

echo "Conductor hooks installed to $INSTALL_DIR and registered in $SETTINGS_FILE"
