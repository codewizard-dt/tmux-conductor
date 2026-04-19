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

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
# HOOK_DIR     = source directory containing the on-*.sh scripts (this repo's
#                hooks/ by default — resolved absolutely so `cp` works from any
#                cwd).
# SETTINGS_FILE = the global Claude Code settings file we merge registrations
#                 into. Global (not project-local) so hooks fire regardless of
#                 which project a session starts in.
# INSTALL_DIR  = stable, vendor-neutral path the registered commands point at.
#                Copying scripts here decouples settings.json from the repo
#                checkout path, so users can move or delete the repo without
#                breaking their hooks.
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS_FILE="$HOME/.claude/settings.json"
INSTALL_DIR="$HOME/.claude/hooks/tmux-conductor"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
# All three defaults above are overridable via flags. Primary use cases:
#   --hook-dir      : running from a different source tree (tests, CI)
#   --settings-file : writing into a sandboxed settings.json (tests)
#   --install-dir   : installing to a non-default location (tests, dry runs)
# Unknown flags fail loudly rather than being silently ignored.
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

# ---------------------------------------------------------------------------
# Copy hook scripts to the stable install dir
# ---------------------------------------------------------------------------
# One script per Claude Code lifecycle event we care about. We copy (not
# symlink) so the installed hooks survive repo deletion/relocation, and we
# re-chmod +x because `cp` preserves source perms but we can't assume the
# working tree is executable (e.g. after a tarball extract).
mkdir -p "$INSTALL_DIR"
for script in on-session-start.sh on-prompt-submit.sh on-stop.sh on-stop-failure.sh; do
  cp "$HOOK_DIR/$script" "$INSTALL_DIR/$script"
  chmod +x "$INSTALL_DIR/$script"
done

# ---------------------------------------------------------------------------
# Ensure the settings directory and file exist
# ---------------------------------------------------------------------------
# jq requires valid JSON input, so on a fresh machine we seed an empty object.
# mkdir -p handles the case where ~/.claude itself doesn't yet exist.
mkdir -p "$(dirname "$SETTINGS_FILE")"
[ -f "$SETTINGS_FILE" ] || echo '{}' > "$SETTINGS_FILE"

# ---------------------------------------------------------------------------
# Merge hooks into settings.json via a single jq invocation
# ---------------------------------------------------------------------------
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
#
# Writing to a temp file first and then `mv`-ing is an atomic-replace pattern:
# if jq errors out, the original settings.json is left intact.
TMP_FILE="$(mktemp)"
jq --arg install_dir "$INSTALL_DIR" '
  # stale_cmd($new_cmd): predicate for the inner hooks[] entries.
  # Returns true if this command should be pruned before we append the new
  # registration. Two cases:
  #   (a) Exact duplicate of the command we are about to add — dedup so
  #       repeated runs of install-hooks.sh produce byte-identical output.
  #   (b) Looks like one of our per-event scripts (path ends in
  #       on-session-start.sh / on-prompt-submit.sh / on-stop.sh /
  #       on-stop-failure.sh) but is NOT under the current $install_dir —
  #       i.e. a stale registration pointing at an older install location
  #       (e.g. the repo checkout from a prior version). Purging these keeps
  #       us from leaving dangling commands when users move/delete the repo.
  # Foreign hooks (anything not matching the regex) are untouched.
  def stale_cmd($new_cmd):
    (.command == $new_cmd)
    or (
      (.command | test("/hooks/on-(session-start|prompt-submit|stop|stop-failure)\\.sh$"))
      and ((.command | startswith($install_dir + "/")) | not)
    );

  # purge($new_cmd): operates on the event-level array (e.g. .hooks.Stop).
  # For each top-level entry, filter out stale inner hooks; then drop any
  # entry that has been emptied as a result. This prevents us from leaving
  # behind shell matcher/hooks wrappers with empty hooks[] arrays.
  def purge($new_cmd):
    map(
      (.hooks |= (. // [] | map(select(stale_cmd($new_cmd) | not))))
      | select((.hooks | length) > 0)
    );

  # register_with_matcher: used for SessionStart, which requires a `matcher`
  # string to scope the hook to particular session-start reasons
  # ("startup|resume|clear"). Ensures .hooks and .hooks[$event] exist, purges
  # any stale/duplicate entries, then appends the fresh registration.
  def register_with_matcher($event; $matcher; $new_cmd):
    .hooks |= (. // {})
    | .hooks[$event] |= ((. // []) | purge($new_cmd))
    | .hooks[$event] += [{
        "matcher": $matcher,
        "hooks": [{ "type": "command", "command": $new_cmd }]
      }];

  # register: used for UserPromptSubmit / Stop / StopFailure, which do not
  # take a matcher (they fire on every occurrence of the event).
  def register($event; $new_cmd):
    .hooks |= (. // {})
    | .hooks[$event] |= ((. // []) | purge($new_cmd))
    | .hooks[$event] += [{
        "hooks": [{ "type": "command", "command": $new_cmd }]
      }];

  # Pipeline: register each of the four events in turn, then delete two
  # legacy event keys that earlier versions of tmux-conductor used. The
  # del() calls are unconditional — harmless if the keys are absent.
  register_with_matcher("SessionStart"; "startup|resume|clear"; $install_dir + "/on-session-start.sh")
  | register("UserPromptSubmit"; $install_dir + "/on-prompt-submit.sh")
  | register("Stop"; $install_dir + "/on-stop.sh")
  | register("StopFailure"; $install_dir + "/on-stop-failure.sh")
  | del(.hooks.PreToolUse)
  | del(.hooks.Notification)
' "$SETTINGS_FILE" > "$TMP_FILE"

# Atomic swap — only reached if jq exited 0 (set -e above).
mv "$TMP_FILE" "$SETTINGS_FILE"

echo "Conductor hooks installed to $INSTALL_DIR and registered in $SETTINGS_FILE"
