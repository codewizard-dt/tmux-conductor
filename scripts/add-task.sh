#!/usr/bin/env bash
# Usage: add-task.sh <command words...>
# Appends a scoped task entry to tasks.txt for the agent matching the current directory name.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASKS_FILE="$SCRIPT_DIR/../tasks.txt"
CONF_FILE="$SCRIPT_DIR/../conductor.conf"
AGENT_NAME="$(basename "$PWD")"

if [[ $# -lt 1 ]]; then
  echo "Usage: add-task.sh <command words...>" >&2
  exit 1
fi

CMD="$*"

if [[ ! -d "$(dirname "$TASKS_FILE")" ]]; then
  echo "Error: tasks.txt parent directory not found: $(dirname "$TASKS_FILE")" >&2
  exit 1
fi

# Check whether AGENT_NAME already has an entry in conductor.conf's AGENTS=(...) array.
# Matches lines starting (after optional whitespace and optional quote) with "<agent>:".
agent_defined() {
  grep -Eq "^[[:space:]]*\"?${AGENT_NAME}:" "$CONF_FILE"
}

if [[ -f "$CONF_FILE" ]] && ! agent_defined; then
  if [[ -t 0 ]]; then
    printf 'Agent "%s" is not defined in conductor.conf. Add it? [Y/n] ' "$AGENT_NAME"
    read -r reply
    reply="${reply:-Y}"
    if [[ "$reply" =~ ^[Yy] ]]; then
      NEW_ENTRY="  \"${AGENT_NAME}:${PWD}:claude --dangerously-skip-permissions\""
      awk -v entry="$NEW_ENTRY" '
        /^AGENTS=\(/ { in_block=1; print; next }
        in_block && /^\)/ { print entry; in_block=0; print; next }
        { print }
      ' "$CONF_FILE" > "$CONF_FILE.tmp" && mv "$CONF_FILE.tmp" "$CONF_FILE"
      echo "Registered agent '${AGENT_NAME}' in conductor.conf"
    else
      echo "Skipped registration; '${AGENT_NAME}' is not in AGENTS so the task will not be dispatched until added." >&2
    fi
  else
    echo "Warning: agent '${AGENT_NAME}' not in conductor.conf and no TTY for prompt; task may not be dispatched." >&2
  fi
fi

echo "${AGENT_NAME}: ${CMD}" >> "$TASKS_FILE"
echo "Added task for ${AGENT_NAME}: ${CMD}"
