#!/usr/bin/env bash
# Usage: dispatch.sh <target> <command>
# Example: dispatch.sh conductor:backend "/clear"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TARGET="$1"
CMD="$2"

# -l = literal mode (preserves special chars in the prompt)
# Enter is ALWAYS a separate argument — never embed \n in the string
tmux send-keys -t "$TARGET" -l "$CMD"
sleep 0.3  # let the UI render before submitting
tmux send-keys -t "$TARGET" Enter

echo "[$(date +%H:%M:%S)] Dispatched to $TARGET: $CMD"
