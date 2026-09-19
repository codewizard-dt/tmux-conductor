#!/usr/bin/env bash
# install-hooks.sh — Install tmux-conductor per-event hooks into Claude Code and Codex.
#
# Lives at the repo root. Usage:
#   ./install-hooks.sh [--hook-dir <path>] [--settings-file <path>] [--install-dir <path>]
#                      [--codex-hooks-file <path>] [--codex-install-dir <path>]
#
# Copies the five per-event Node.js hook scripts (plus the shared
# lib/write-state.js helper) to a stable install dir under
# $HOME/.claude/hooks/tmux-conductor/ and merge-registers them in
# $HOME/.claude/settings.json and registers the supported Codex lifecycle
# events in $HOME/.codex/hooks.json. Uses dedup-by-command jq filters that preserve
# foreign hook entries while replacing any prior tmux-conductor registrations
# (including stale repo-path entries and legacy .sh registrations from older
# installs). Also cleans up deprecated PreToolUse entries from earlier
# versions. (Notification was deprecated and removed in April 2026, then
# reintroduced narrowly by BUG-0001's fix — see hooks/on-notification.js.)
#
# Idempotent: running twice produces byte-identical hook config files.

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
# HOOK_DIR      = source directory containing the on-*.js scripts and the
#                 lib/write-state.js helper (this repo's hooks/ by default —
#                 resolved absolutely so `cp` works from any cwd).
# SETTINGS_FILE = the global Claude Code settings file we merge registrations
#                 into. Global (not project-local) so hooks fire regardless of
#                 which project a session starts in.
# INSTALL_DIR   = stable, vendor-neutral path the registered commands point at.
#                 Copying scripts here decouples settings.json from the repo
#                 checkout path, so users can move or delete the repo without
#                 breaking their hooks.
# SKILLS_DIR    = stable path where Claude Code discovers skills by directory
#                 presence. Skills need no registration (unlike hooks).
HOOK_DIR="$(cd "$(dirname "$0")/hooks" && pwd)"
SETTINGS_FILE="$HOME/.claude/settings.json"
INSTALL_DIR="$HOME/.claude/hooks/tmux-conductor"
CODEX_HOOKS_FILE="$HOME/.codex/hooks.json"
CODEX_INSTALL_DIR="$HOME/.codex/hooks/tmux-conductor"
SKILLS_DIR="$HOME/.claude/skills/dev-commands"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
# All defaults above are overridable via flags. Primary use cases:
#   --hook-dir       : running from a different source tree (tests, CI)
#   --settings-file  : writing into a sandboxed settings.json (tests)
#   --install-dir    : installing to a non-default location (tests, dry runs)
#   --codex-hooks-file : writing into a sandboxed Codex hooks.json (tests)
#   --codex-install-dir: installing Codex hooks to a non-default location
#   --skills-dir     : installing skills to a non-default location (tests, dry runs)
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
    --codex-hooks-file)
      CODEX_HOOKS_FILE="$2"
      shift 2
      ;;
    --codex-install-dir)
      CODEX_INSTALL_DIR="$2"
      shift 2
      ;;
    --skills-dir)
      SKILLS_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Concern 1: install + register the Claude Code and Codex hooks
# ---------------------------------------------------------------------------
# Run in a subshell so a failure here (missing HOOK_DIR file, jq error, etc.)
# does not abort the whole script — dev-commands skill install (Concern 2,
# below) is independent and must still be attempted regardless. `set -euo
# pipefail` inside the subshell preserves fail-fast behavior *within* this
# concern; the subshell boundary keeps that failure from propagating out.
hooks_status=0
(
  set -euo pipefail

  # -------------------------------------------------------------------------
  # Copy hook scripts to the stable install dir
  # -------------------------------------------------------------------------
  # One script per Claude Code lifecycle event we care about. We copy (not
  # symlink) so the installed hooks survive repo deletion/relocation, and we
  # re-chmod +x because `cp` preserves source perms but we can't assume the
  # working tree is executable (e.g. after a tarball extract).
  mkdir -p "$INSTALL_DIR"
  for script in on-session-start.js on-prompt-submit.js on-stop.js on-stop-failure.js on-notification.js; do
    cp "$HOOK_DIR/$script" "$INSTALL_DIR/$script"
    chmod +x "$INSTALL_DIR/$script"
  done

  # Copy the shared helper that the per-event scripts require() at runtime.
  mkdir -p "$INSTALL_DIR/lib"
  cp "$HOOK_DIR/lib/write-state.js" "$INSTALL_DIR/lib/write-state.js"

  # -------------------------------------------------------------------------
  # Ensure every hook script under ~/.claude/hooks/ is executable
  # -------------------------------------------------------------------------
  # Foreign hooks (e.g. serena-bash-grep-block.js) dropped in by other tools or
  # rsynced from a host may lack +x, which makes Claude Code fail the hook with
  # "Permission denied". We own the hooks directory at install time, so fix the
  # whole tree — not just the files we copied.
  HOOKS_ROOT="$(dirname "$INSTALL_DIR")"
  if [ -d "$HOOKS_ROOT" ]; then
    find "$HOOKS_ROOT" -type f \( -name '*.js' -o -name '*.sh' \) -exec chmod +x {} +
  fi

  # -------------------------------------------------------------------------
  # Ensure the settings directory and file exist
  # -------------------------------------------------------------------------
  # jq requires valid JSON input, so on a fresh machine we seed an empty object.
  # mkdir -p handles the case where ~/.claude itself doesn't yet exist.
  mkdir -p "$(dirname "$SETTINGS_FILE")"
  [ -f "$SETTINGS_FILE" ] || echo '{}' > "$SETTINGS_FILE"

  # -------------------------------------------------------------------------
  # Merge hooks into settings.json via a single jq invocation
  # -------------------------------------------------------------------------
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
  INSTALL_DIR_CMD="${INSTALL_DIR/#$HOME/\~}"
  jq --arg install_dir "$INSTALL_DIR" --arg install_dir_cmd "$INSTALL_DIR_CMD" -f "$JQ_PROGRAM" "$SETTINGS_FILE" > "$TMP_FILE"

  # Atomic swap — only reached if jq exited 0 (set -e above).
  mv "$TMP_FILE" "$SETTINGS_FILE"

  echo "Conductor hooks installed to $INSTALL_DIR and registered in $SETTINGS_FILE"

  # -------------------------------------------------------------------------
  # Install and register Codex hooks
  # -------------------------------------------------------------------------
  # Codex supports the lifecycle events we need for status tracking:
  # SessionStart(startup|resume|clear), UserPromptSubmit, and Stop.
  mkdir -p "$CODEX_INSTALL_DIR"
  for script in on-session-start.js on-prompt-submit.js on-stop.js; do
    cp "$HOOK_DIR/$script" "$CODEX_INSTALL_DIR/$script"
    chmod +x "$CODEX_INSTALL_DIR/$script"
  done

  mkdir -p "$CODEX_INSTALL_DIR/lib"
  cp "$HOOK_DIR/lib/write-state.js" "$CODEX_INSTALL_DIR/lib/write-state.js"

  CODEX_HOOKS_ROOT="$(dirname "$CODEX_INSTALL_DIR")"
  if [ -d "$CODEX_HOOKS_ROOT" ]; then
    find "$CODEX_HOOKS_ROOT" -type f \( -name '*.js' -o -name '*.sh' \) -exec chmod +x {} +
  fi

  mkdir -p "$(dirname "$CODEX_HOOKS_FILE")"
  [ -f "$CODEX_HOOKS_FILE" ] || echo '{}' > "$CODEX_HOOKS_FILE"

  CODEX_JQ_PROGRAM="$(cd "$(dirname "$0")" && pwd)/hooks/register-codex-hooks.jq"
  CODEX_TMP_FILE="$(mktemp)"
  CODEX_INSTALL_DIR_CMD="${CODEX_INSTALL_DIR/#$HOME/\~}"
  jq --arg install_dir "$CODEX_INSTALL_DIR" --arg install_dir_cmd "$CODEX_INSTALL_DIR_CMD" -f "$CODEX_JQ_PROGRAM" "$CODEX_HOOKS_FILE" > "$CODEX_TMP_FILE"
  mv "$CODEX_TMP_FILE" "$CODEX_HOOKS_FILE"

  echo "Conductor Codex hooks installed to $CODEX_INSTALL_DIR and registered in $CODEX_HOOKS_FILE"
) || hooks_status=$?

if [[ $hooks_status -ne 0 ]]; then
  echo "Warning: hook installation failed (exit $hooks_status) — continuing to attempt dev-commands skill installation independently" >&2
fi

# ---------------------------------------------------------------------------
# Concern 2: install the dev-commands skill
# ---------------------------------------------------------------------------
# The dev-commands skill is a read-only bundle of documentation (SKILL.md)
# and a standalone bash script (scripts/dev-commands.sh) that agents invoke
# proactively to query background process state. Skills require no registration
# in settings.json — Claude Code discovers them by directory presence alone.
# This installation step is independent of hook installation — it runs in its
# own subshell below, and its success/failure is tracked separately, so
# neither concern can abort the other.
skill_status=0
(
  set -euo pipefail

  SKILLS_SOURCE_DIR="$(cd "$(dirname "$0")/skills/dev-commands" && pwd)"

  # Ensure the target directory exists
  mkdir -p "$SKILLS_DIR"

  # Copy SKILL.md (the skill metadata and documentation)
  if [ -f "$SKILLS_SOURCE_DIR/SKILL.md" ]; then
    cp "$SKILLS_SOURCE_DIR/SKILL.md" "$SKILLS_DIR/SKILL.md"
  else
    echo "Warning: SKILL.md not found at $SKILLS_SOURCE_DIR/SKILL.md (skipping skill installation)" >&2
    exit 1
  fi

  # Copy the scripts directory (containing dev-commands.sh)
  if [ -d "$SKILLS_SOURCE_DIR/scripts" ]; then
    mkdir -p "$SKILLS_DIR/scripts"
    cp "$SKILLS_SOURCE_DIR/scripts"/* "$SKILLS_DIR/scripts/"
    # Ensure all scripts are executable
    chmod +x "$SKILLS_DIR/scripts"/*
  else
    echo "Warning: scripts directory not found at $SKILLS_SOURCE_DIR/scripts (skipping script installation)" >&2
    exit 1
  fi

  echo "Dev-commands skill installed to $SKILLS_DIR"
) || skill_status=$?

if [[ $skill_status -ne 0 ]]; then
  echo "Warning: dev-commands skill installation failed (exit $skill_status)" >&2
fi

if [[ $hooks_status -ne 0 || $skill_status -ne 0 ]]; then
  exit 1
fi
