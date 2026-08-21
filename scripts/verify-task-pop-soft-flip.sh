#!/usr/bin/env bash
# scripts/verify-task-pop-soft-flip.sh — TASK-125 repeatable check for the bash
# pop path (pop_task_sql in scripts/lib/db.sh). Builds a from-scratch v8 scratch
# DB (never touches ./data/conductor.db), seeds one fixture agent + one queued
# task, and asserts pop_task_sql soft-flips the row (status='done',
# completed_at set, row count unchanged) and never re-pops it on a second call.
#
# Deliberately does NOT spin up a live host-server or tmux session — unlike
# scripts/verify-sqlite-migration.sh (currently broken: it still references a
# pre-rename `backend/` directory that no longer holds the host-server source;
# `host-server/` is the real location today). This script only needs `sqlite3`
# + `bash`, so it stays fast and independently repeatable.
#
# Usage: bash scripts/verify-task-pop-soft-flip.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRATCH_DIR="$REPO/tmp"
SCRATCH_DB="$SCRATCH_DIR/verify-task-pop-soft-flip.db"
mkdir -p "$SCRATCH_DIR"
rm -f "$SCRATCH_DB" "$SCRATCH_DB-shm" "$SCRATCH_DB-wal"

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

cleanup() {
  rm -f "$SCRATCH_DB" "$SCRATCH_DB-shm" "$SCRATCH_DB-wal"
}
trap cleanup EXIT

# Build a real v8-schema scratch DB via the production migration path (openDb),
# never a hand-rolled copy of the schema.
(
  cd "$REPO/host-server"
  node --import tsx/esm --input-type=module -e "
    import { openDb } from './db.ts'
    const db = openDb('$SCRATCH_DB')
    db.close()
  " >/dev/null
)

AGENT_ID=$(sqlite3 "$SCRATCH_DB" "INSERT INTO agents (name, workdir, launch_cmd) VALUES ('verify-pop-agent', '$SCRATCH_DIR/verify-pop-nonexistent', 'true') RETURNING id;")
TASK_ID=$(sqlite3 "$SCRATCH_DB" "INSERT INTO tasks (command, agent_id, position, status, source) VALUES ('echo verify-pop', $AGENT_ID, 1.0, 'queued', 'manual') RETURNING id;")

export CONDUCTOR_DB="$SCRATCH_DB"
# shellcheck disable=SC1091
source "$REPO/scripts/lib/db.sh"

pop_task_sql "$AGENT_ID" || true
if [[ "$POPPED_TASK" == "echo verify-pop" ]]; then
  check "pop_task_sql pops the queued task and returns its command" "pass"
else
  check "pop_task_sql pops the queued task and returns its command" "fail"
fi

ROW_COUNT=$(sqlite3 "$SCRATCH_DB" "SELECT COUNT(*) FROM tasks WHERE id=$TASK_ID;")
if [[ "$ROW_COUNT" == "1" ]]; then
  check "popped row survives (soft flip, not DELETE)" "pass"
else
  check "popped row survives (soft flip, not DELETE)" "fail"
fi

STATUS_AND_COMPLETED=$(sqlite3 -separator '|' "$SCRATCH_DB" "SELECT status, completed_at IS NOT NULL FROM tasks WHERE id=$TASK_ID;")
if [[ "$STATUS_AND_COMPLETED" == "done|1" ]]; then
  check "popped row has status=done and completed_at set" "pass"
else
  check "popped row has status=done and completed_at set" "fail"
fi

if [[ "$LAST_QUEUE_REMAINING" == "0" ]]; then
  check "LAST_QUEUE_REMAINING excludes the just-flipped done row" "pass"
else
  check "LAST_QUEUE_REMAINING excludes the just-flipped done row" "fail"
fi

POPPED_TASK=""
pop_task_sql "$AGENT_ID" || true
if [[ -z "$POPPED_TASK" ]]; then
  check "a second pop for the same agent never re-pops the done row" "pass"
else
  check "a second pop for the same agent never re-pops the done row" "fail"
fi

echo ""
echo "Passed: ${#PASS[@]}  Failed: ${#FAIL[@]}"
if [[ ${#FAIL[@]} -gt 0 ]]; then
  exit 1
fi
