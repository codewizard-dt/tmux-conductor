#!/usr/bin/env bash
# Usage: add-task.sh <command words...>
# Appends a scoped task entry to tasks.txt for the agent matching the current directory name.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASKS_FILE="$SCRIPT_DIR/../tasks.txt"
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

echo "${AGENT_NAME}: ${CMD}" >> "$TASKS_FILE"
echo "Added task for ${AGENT_NAME}: ${CMD}"
