#!/usr/bin/env bash
# verify-diff-endpoint-worktree-and-uncommitted.sh — Regression test for BUG-0004 + BUG-0010
#
# GET /agents/:id/diff (host-server/index.ts) has two related, previously-fixed
# defects on the same code path:
#   BUG-0004: for a worktree-backed agent, must diff entry.worktreePath (where the
#             agent's real live changes are), not entry.workdir (the original repo).
#   BUG-0010: must use `git diff <base>` (single ref), which reads the current
#             working tree, not `git diff <base>..HEAD` (two refs), which can only
#             ever see committed history and never uncommitted changes — the
#             normal state of an in-progress agent's worktree.
#
# One fixture proves both at once: two independent git repos, each with an
# uncommitted change carrying a distinct marker. If either defect regresses,
# the wrong marker (or no marker) comes back from the API.
#
# Usage: bash scripts/verify-diff-endpoint-worktree-and-uncommitted.sh
# Runs its own host-server instance on a scratch BACKEND_PORT (not 8788), so it
# never touches a live `make dev` session. Artifacts land in
# ./tmp/verify-diff-endpoint/ (gitignored).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
VERIFY_DIR="$REPO/tmp/verify-diff-endpoint"
rm -rf "$VERIFY_DIR"
mkdir -p "$VERIFY_DIR"

export CONDUCTOR_DB="$VERIFY_DIR/conductor-verify.db"
BACKEND_PORT="18788"
BASE_URL="http://127.0.0.1:$BACKEND_PORT"

sqlc() { sqlite3 -cmd '.timeout 5000' -separator $'\x1f' "$CONDUCTOR_DB" "$@"; }

BACKEND_PID=""

start_backend() {
  echo "[verify-diff] Starting scratch host-server on port $BACKEND_PORT..."
  # `exec` inside the subshell replaces it with the node process itself (same
  # PID, no fork) — otherwise `$!` would name the cd-then-node subshell, and
  # killing that PID later would leave the real node process (its child)
  # running and still holding the port.
  ( cd "$REPO/host-server" && exec env CONDUCTOR_DB="$CONDUCTOR_DB" BACKEND_PORT="$BACKEND_PORT" \
      node --import tsx/esm index.ts ) &>"$VERIFY_DIR/backend.log" &
  BACKEND_PID=$!
  local i=0
  while (( i < 90 )); do
    curl -sf "$BASE_URL/api/status" >/dev/null 2>&1 && { echo "[verify-diff] Ready (PID $BACKEND_PID)"; return 0; }
    sleep 1
    (( i++ ))
  done
  echo "[verify-diff] ERROR: backend did not become ready within 90s"
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
  # Process exit doesn't guarantee the listening socket is immediately
  # reusable — poll until the port actually stops accepting connections
  # before treating the backend as fully stopped.
  local i=0
  while (( i < 20 )); do
    curl -sf -m 1 "$BASE_URL/api/status" >/dev/null 2>&1 || return 0
    sleep 0.5
    (( i++ ))
  done
}

cleanup() {
  stop_backend
}
trap cleanup EXIT

echo "[verify-diff] Seeding scratch DB schema (boot once, no fixture data)..."
start_backend || exit 1
stop_backend

echo "[verify-diff] Building two independent git fixture repos..."
REPO_A="$VERIFY_DIR/repo-a-workdir"     # entry.workdir — must NOT be diffed for a worktree agent
REPO_B="$VERIFY_DIR/repo-b-worktree"    # entry.worktreePath — must be diffed instead
mkdir -p "$REPO_A" "$REPO_B"

git -C "$REPO_A" init -q -b main
git -C "$REPO_A" -c user.email=verify@example.com -c user.name=verify commit -q --allow-empty -m "init"
echo "WRONG-REPO-DIFF-MARKER" > "$REPO_A/file.txt"
git -C "$REPO_A" add file.txt

git -C "$REPO_B" init -q -b main
git -C "$REPO_B" -c user.email=verify@example.com -c user.name=verify commit -q --allow-empty -m "init"
echo "CORRECT-WORKTREE-DIFF-MARKER" > "$REPO_B/file.txt"
git -C "$REPO_B" add file.txt

echo "[verify-diff] Seeding a worktree-backed agent (workdir=repo-a, worktreePath=repo-b)..."
sqlc "INSERT INTO projects(name, workdir, default_launch_cmd) VALUES ('diffverify', '$REPO_A', 'bash')"
PROJ_ID="$(sqlc "SELECT id FROM projects WHERE name='diffverify'")"
sqlc "INSERT INTO agents(name, workdir, launch_cmd, project_id, worktree_path, branch) VALUES ('agent1', '$REPO_A', 'bash', $PROJ_ID, '$REPO_B', 'main')"
AGENT_ID="$(sqlc "SELECT id FROM agents WHERE name='agent1'")"
echo "[verify-diff] Agent id=$AGENT_ID"

echo "[verify-diff] Starting backend again to serve the diff endpoint..."
start_backend || exit 1

resp="$(curl -sf "$BASE_URL/api/agents/$AGENT_ID/diff")"
echo "[verify-diff] GET /api/agents/$AGENT_ID/diff -> $resp"

fail=0

if ! echo "$resp" | grep -q '"base":"main"'; then
  echo "[verify-diff] FAIL: expected base branch 'main', got: $resp"
  fail=1
fi

if ! echo "$resp" | grep -q "CORRECT-WORKTREE-DIFF-MARKER"; then
  echo "[verify-diff] FAIL: diff is missing the worktreePath's uncommitted change (BUG-0010 regression: uncommitted changes not diffed, or BUG-0004 regression: wrong directory diffed)"
  fail=1
else
  echo "[verify-diff] Diff includes the worktreePath's uncommitted change — BUG-0010 confirmed fixed"
fi

if echo "$resp" | grep -q "WRONG-REPO-DIFF-MARKER"; then
  echo "[verify-diff] FAIL: diff leaked content from entry.workdir instead of entry.worktreePath — BUG-0004 regression"
  fail=1
else
  echo "[verify-diff] Diff does not contain the workdir's content — BUG-0004 confirmed fixed"
fi

stop_backend

if [[ "$fail" -eq 1 ]]; then
  echo ""
  echo "[verify-diff] FAIL"
  exit 1
fi

echo ""
echo "[verify-diff] PASS — GET /agents/:id/diff's worktreePath routing (BUG-0004) and uncommitted-diff (BUG-0010) both verified"
