#!/usr/bin/env bash
# verify-teardown-window-mapping.sh — Regression test for BUG-0009
#
# teardown.sh's per-agent /exit loop must dispatch to the AGENT_WINDOW_NAMES-mapped
# tmux window (e.g. "myproject-myagent" for a project-scoped agent), not the raw
# agent name — mirroring the mapping monitor.sh's main loop already applies.
#
# Usage: bash scripts/verify-teardown-window-mapping.sh
# Artifacts land in ./tmp/verify-teardown/ (gitignored). Runs the real teardown.sh
# end-to-end against a scratch tmux session (via CONDUCTOR_SESSION_NAME) and a
# scratch SQLite DB (schema only, no backend boot — port 8788 is never touched).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
VERIFY_DIR="$REPO/tmp/verify-teardown"
mkdir -p "$VERIFY_DIR"
export CONDUCTOR_DB="$VERIFY_DIR/conductor-verify.db"
rm -f "$CONDUCTOR_DB" "$CONDUCTOR_DB-shm" "$CONDUCTOR_DB-wal"

sqlc() { sqlite3 -cmd '.timeout 5000' -separator $'\x1f' "$CONDUCTOR_DB" "$@"; }

export CONDUCTOR_SESSION_NAME="teardown-verify-$$"
PROJECT_NAME="tdverify"
AGENT_NAME="agent1"
EXPECTED_WINDOW="${PROJECT_NAME}-${AGENT_NAME}"

cleanup() {
  tmux kill-session -t "$CONDUCTOR_SESSION_NAME" 2>/dev/null || true
}
trap cleanup EXIT

echo "[verify-teardown] Creating minimal scratch schema (agents + projects + bg_processes)..."
sqlc "
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  workdir TEXT NOT NULL,
  default_launch_cmd TEXT NOT NULL DEFAULT 'bash'
);
CREATE TABLE agents (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  workdir TEXT NOT NULL,
  launch_cmd TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
);
CREATE TABLE bg_processes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  workdir TEXT NOT NULL,
  launch_cmd TEXT NOT NULL,
  linked_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL
);
"

echo "[verify-teardown] Seeding a project-scoped agent (window name != bare agent name)..."
sqlc "INSERT INTO projects(name, workdir) VALUES ('$PROJECT_NAME', '$VERIFY_DIR')"
sqlc "INSERT INTO agents(name, workdir, launch_cmd, project_id) VALUES ('$AGENT_NAME', '$VERIFY_DIR', 'bash', (SELECT id FROM projects WHERE name='$PROJECT_NAME'))"

echo "[verify-teardown] Creating scratch tmux session '$CONDUCTOR_SESSION_NAME' with window '$EXPECTED_WINDOW' (simulating a live project-scoped agent pane)..."
tmux kill-session -t "$CONDUCTOR_SESSION_NAME" 2>/dev/null || true
tmux new-session -d -s "$CONDUCTOR_SESSION_NAME" -n "$EXPECTED_WINDOW" -c "$VERIFY_DIR" "bash --noprofile --norc"
sleep 0.3

echo "[verify-teardown] Running the real scripts/teardown.sh against the scratch session..."
teardown_log="$VERIFY_DIR/teardown.log"
CONDUCTOR_DB="$CONDUCTOR_DB" CONDUCTOR_SESSION_NAME="$CONDUCTOR_SESSION_NAME" \
  bash "$SCRIPT_DIR/teardown.sh" >"$teardown_log" 2>&1

cat "$teardown_log"

if grep -q "can't find window" "$teardown_log"; then
  echo ""
  echo "[verify-teardown] FAIL: teardown.sh failed to find the mapped window '$EXPECTED_WINDOW' — regression of BUG-0009"
  exit 1
fi
echo ""
echo "[verify-teardown] No 'can't find window' error — teardown.sh's /exit dispatch targeted the mapped window"

if ! grep -q "Sending /exit to $AGENT_NAME" "$teardown_log"; then
  echo "[verify-teardown] FAIL: teardown.sh never attempted to dispatch /exit to '$AGENT_NAME' — test setup is broken, not a BUG-0009 regression"
  exit 1
fi

if tmux has-session -t "$CONDUCTOR_SESSION_NAME" 2>/dev/null; then
  echo "[verify-teardown] FAIL: teardown.sh did not kill the tmux session"
  exit 1
fi
echo "[verify-teardown] tmux session was killed as expected"

echo ""
echo "[verify-teardown] PASS — teardown.sh's window-name mapping (BUG-0009) verified"
