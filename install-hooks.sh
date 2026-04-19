#!/usr/bin/env bash
# install-hooks.sh — Install tmux-conductor per-event hooks into Claude Code.
#
# Lives at the repo root. Usage:
#   ./install-hooks.sh [--hook-dir <path>] [--settings-file <path>] [--install-dir <path>]
#
# Copies the four per-event Node.js hook scripts (plus the shared
# lib/write-state.js helper) to a stable install dir under
# $HOME/.claude/hooks/tmux-conductor/ and merge-registers them in
# $HOME/.claude/settings.json. Uses a dedup-by-command jq filter that preserves
# foreign hook entries while replacing any prior tmux-conductor registrations
# (including stale repo-path entries and legacy .sh registrations from older
# installs). Also cleans up deprecated PreToolUse and Notification entries
# from earlier versions.
#
# Idempotent: running twice produces byte-identical settings.json.

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
# HOOK_DIR     = source directory containing the on-*.js scripts and the
#                lib/write-state.js helper (this repo's hooks/ by default —
#                resolved absolutely so `cp` works from any cwd).
# SETTINGS_FILE = the global Claude Code settings file we merge registrations
#                 into. Global (not project-local) so hooks fire regardless of
#                 which project a session starts in.
# INSTALL_DIR  = stable, vendor-neutral path the registered commands point at.
#                Copying scripts here decouples settings.json from the repo
#                checkout path, so users can move or delete the repo without
#                breaking their hooks.
HOOK_DIR="$(cd "$(dirname "$0")/hooks" && pwd)"
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
for script in on-session-start.js on-prompt-submit.js on-stop.js on-stop-failure.js; do
  cp "$HOOK_DIR/$script" "$INSTALL_DIR/$script"
  chmod +x "$INSTALL_DIR/$script"
done

# Copy the shared helper that the per-event scripts require() at runtime.
mkdir -p "$INSTALL_DIR/lib"
cp "$HOOK_DIR/lib/write-state.js" "$INSTALL_DIR/lib/write-state.js"

# ---------------------------------------------------------------------------
# Ensure every hook script under ~/.claude/hooks/ is executable
# ---------------------------------------------------------------------------
# Foreign hooks (e.g. serena-bash-grep-block.js) dropped in by other tools or
# rsynced from a host may lack +x, which makes Claude Code fail the hook with
# "Permission denied". We own the hooks directory at install time, so fix the
# whole tree — not just the files we copied.
HOOKS_ROOT="$(dirname "$INSTALL_DIR")"
if [ -d "$HOOKS_ROOT" ]; then
  find "$HOOKS_ROOT" -type f \( -name '*.js' -o -name '*.sh' \) -exec chmod +x {} +
fi

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
# The jq program itself (helper defs + pipeline) lives in
# hooks/register-hooks.jq alongside this script, so the bash file stays free
# of embedded DSL. For each event it:
#   1. Initialize .hooks and .hooks.<Event> to [] if missing.
#   2. Drop any top-level entry whose hooks[].command either
#        (a) equals the new command we're about to register, or
#        (b) matches .*/hooks/on-(session-start|prompt-submit|stop|stop-failure)\.(sh|js)$
#            AND does NOT start with "$install_dir/" (stale repo-path cleanup).
#   3. Append the freshly-built entry.
#
# SessionStart carries a matcher; the other three events don't.
#
# Writing to a temp file first and then `mv`-ing is an atomic-replace pattern:
# if jq errors out, the original settings.json is left intact.
JQ_PROGRAM="$(cd "$(dirname "$0")" && pwd)/hooks/register-hooks.jq"
TMP_FILE="$(mktemp)"
jq --arg install_dir "$INSTALL_DIR" -f "$JQ_PROGRAM" "$SETTINGS_FILE" > "$TMP_FILE"

# Atomic swap — only reached if jq exited 0 (set -e above).
mv "$TMP_FILE" "$SETTINGS_FILE"

echo "Conductor hooks installed to $INSTALL_DIR and registered in $SETTINGS_FILE"
