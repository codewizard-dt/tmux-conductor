#!/usr/bin/env bash
# verify-sse-role-payload.sh — Regression test for BUG-0006 (initial-connect half)
#
# GET /api/events' initial-connect resend must include `role` in each
# agent-update payload, at parity with buildSnapshot()/REST GET /api/status —
# BUG-0006 found it silently omitted. (The periodic diff-tick broadcast's own
# `role` field is pinned separately and statically in
# host-server/sseRolePayloadParity.test.ts, since it fires on an internal
# polling interval this script can't trigger deterministically.)
#
# Usage: bash scripts/verify-sse-role-payload.sh
# Runs its own host-server instance on a scratch BACKEND_PORT (not 8788), so it
# never touches a live `make dev` session. Artifacts land in
# ./tmp/verify-sse-role/ (gitignored).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
VERIFY_DIR="$REPO/tmp/verify-sse-role"
rm -rf "$VERIFY_DIR"
mkdir -p "$VERIFY_DIR"

export CONDUCTOR_DB="$VERIFY_DIR/conductor-verify.db"
BACKEND_PORT="18790"
BASE_URL="http://127.0.0.1:$BACKEND_PORT"

sqlc() { sqlite3 -cmd '.timeout 5000' -separator $'\x1f' "$CONDUCTOR_DB" "$@"; }

BACKEND_PID=""

start_backend() {
  echo "[verify-sse] Starting scratch host-server on port $BACKEND_PORT..."
  ( cd "$REPO/host-server" && exec env CONDUCTOR_DB="$CONDUCTOR_DB" BACKEND_PORT="$BACKEND_PORT" \
      node --import tsx/esm index.ts ) &>"$VERIFY_DIR/backend.log" &
  BACKEND_PID=$!
  local i=0
  while (( i < 90 )); do
    curl -sf "$BASE_URL/api/status" >/dev/null 2>&1 && { echo "[verify-sse] Ready (PID $BACKEND_PID)"; return 0; }
    sleep 1
    (( i++ ))
  done
  echo "[verify-sse] ERROR: backend did not become ready within 90s"
  cat "$VERIFY_DIR/backend.log" 2>/dev/null || true
  return 1
}

stop_backend() {
  if [[ -n "$BACKEND_PID" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
    local i=0
    while (( i < 10 )) && kill -0 "$BACKEND_PID" 2>/dev/null; do sleep 0.5; (( i++ )); done
    kill -9 "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
    BACKEND_PID=""
  fi
  local i=0
  while (( i < 20 )); do
    curl -sf -m 1 "$BASE_URL/api/status" >/dev/null 2>&1 || return 0
    sleep 0.5
    (( i++ ))
  done
}

cleanup() { stop_backend; }
trap cleanup EXIT

echo "[verify-sse] Seeding scratch DB schema (boot once, no fixture data)..."
start_backend || exit 1
stop_backend

echo "[verify-sse] Seeding a role='security' agent..."
sqlc "INSERT INTO projects(name, workdir, default_launch_cmd) VALUES ('sseverify', '$VERIFY_DIR', 'bash')"
PROJ_ID="$(sqlc "SELECT id FROM projects WHERE name='sseverify'")"
sqlc "INSERT INTO agents(name, workdir, launch_cmd, project_id, role) VALUES ('agent1', '$VERIFY_DIR', 'bash', $PROJ_ID, 'security')"
AGENT_ID="$(sqlc "SELECT id FROM agents WHERE name='agent1'")"
echo "[verify-sse] Agent id=$AGENT_ID"

echo "[verify-sse] Starting backend again to serve /api/events..."
start_backend || exit 1

echo "[verify-sse] Waiting for the first status-poll tick to populate the server's snapshot..."
sleep 4

echo "[verify-sse] Connecting to GET /api/events and capturing the initial connect-resend..."
sse_capture="$VERIFY_DIR/sse-capture.txt"
curl -sN -m 3 "$BASE_URL/api/events" > "$sse_capture" 2>/dev/null || true

fail=0
if ! grep -q "\"id\":$AGENT_ID" "$sse_capture"; then
  echo "[verify-sse] FAIL: no agent-update event found for agent id=$AGENT_ID in the SSE capture"
  echo "--- capture ---"
  cat "$sse_capture"
  fail=1
else
  agent_event="$(grep "\"id\":$AGENT_ID" "$sse_capture")"
  echo "[verify-sse] agent-update payload: $agent_event"
  if echo "$agent_event" | grep -q '"role":"security"'; then
    echo "[verify-sse] Payload includes role:\"security\" — BUG-0006 confirmed fixed (initial-connect resend)"
  else
    echo "[verify-sse] FAIL: agent-update payload is missing role:\"security\" — BUG-0006 regression"
    fail=1
  fi
fi

stop_backend

if [[ "$fail" -eq 1 ]]; then
  echo ""
  echo "[verify-sse] FAIL"
  exit 1
fi

echo ""
echo "[verify-sse] PASS — GET /api/events' initial-connect resend carries role (BUG-0006, initial-connect half)"
