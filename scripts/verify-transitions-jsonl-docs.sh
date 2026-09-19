#!/usr/bin/env bash
# scripts/verify-transitions-jsonl-docs.sh — TASK-145 repeatable check that
# logs/transitions.jsonl is documented in CLAUDE.md, AGENTS.md, and README.md
# with the same level of detail as the pre-existing dispatch.jsonl/hooks.jsonl
# entries (per the task's Approach: mirror the exact existing pattern).
#
# Pure grep/string-presence check against the committed docs — no server,
# no tmux, no wall-clock dependency.
#
# Usage: bash scripts/verify-transitions-jsonl-docs.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

PASS=()
FAIL=()
check() {
  local name="$1" result="$2"
  if [[ "$result" == "pass" ]]; then
    PASS+=("$name")
    echo "  PASS: $name"
  else
    FAIL+=("$name")
    echo "  FAIL: $name"
  fi
}

has_all() {
  # $1: file, remaining args: substrings that must all be present
  local file="$1"
  shift
  for needle in "$@"; do
    grep -qF -- "$needle" "$file" || return 1
  done
  return 0
}

# --- CLAUDE.md: log-file table row ---
if has_all "$REPO/CLAUDE.md" \
  '`$LOG_DIR/transitions.jsonl`' \
  'pollAndDiff' \
  'poll loop'; then
  check "CLAUDE.md: transitions.jsonl table row present with pollAndDiff + poll-loop mention" "pass"
else
  check "CLAUDE.md: transitions.jsonl table row present with pollAndDiff + poll-loop mention" "fail"
fi

if has_all "$REPO/CLAUDE.md" \
  'ROADMAP-019' \
  '$LOG_DIR/transitions.jsonl' \
  'pollAndDiff' \
  'is_idle()'; then
  check "CLAUDE.md: Key Design Decisions sentence describes transitions.jsonl fields + both emitters" "pass"
else
  check "CLAUDE.md: Key Design Decisions sentence describes transitions.jsonl fields + both emitters" "fail"
fi

# --- AGENTS.md: mirrors CLAUDE.md exactly (same table row + design-decision sentence) ---
if has_all "$REPO/AGENTS.md" \
  '`$LOG_DIR/transitions.jsonl`' \
  'pollAndDiff' \
  'poll loop'; then
  check "AGENTS.md: transitions.jsonl table row present (mirrors CLAUDE.md)" "pass"
else
  check "AGENTS.md: transitions.jsonl table row present (mirrors CLAUDE.md)" "fail"
fi

if has_all "$REPO/AGENTS.md" \
  'ROADMAP-019' \
  '$LOG_DIR/transitions.jsonl' \
  'pollAndDiff' \
  'is_idle()'; then
  check "AGENTS.md: Key Design Decisions sentence mirrors CLAUDE.md's transitions.jsonl description" "pass"
else
  check "AGENTS.md: Key Design Decisions sentence mirrors CLAUDE.md's transitions.jsonl description" "fail"
fi

# --- README.md: Outputs/log-file bullet list ---
if has_all "$REPO/README.md" \
  'logs/transitions.jsonl' \
  "pollAndDiff"; then
  check "README.md: logs/transitions.jsonl added to the Data & Migrations bullet list" "pass"
else
  check "README.md: logs/transitions.jsonl added to the Data & Migrations bullet list" "fail"
fi

# --- README.md: Observability section, matching Dispatch/Hook log bullet style ---
if has_all "$REPO/README.md" \
  '**Transition log:**' \
  '`logs/transitions.jsonl`' \
  'agentId' \
  'stateFileAgeS'; then
  check "README.md: Observability section has a Transition log bullet matching Dispatch/Hook log style" "pass"
else
  check "README.md: Observability section has a Transition log bullet matching Dispatch/Hook log style" "fail"
fi

echo ""
echo "Passed: ${#PASS[@]}  Failed: ${#FAIL[@]}"
if [[ ${#FAIL[@]} -gt 0 ]]; then
  exit 1
fi
