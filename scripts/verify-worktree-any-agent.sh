#!/usr/bin/env bash
# verify-worktree-any-agent.sh — opt-in live harness for UAT-0218
# (wiki/work/uat/UAT-0218-worktree-menu-and-clone-flow.md): the "Create worktree"
# menu action and the "Clone into new worktree" flow, driven through the real
# host-server API, real git and real tmux.
#
# Everything is PRIVATE and lives under ./tmp/uat-0218/ (repo-local, gitignored):
#   conductor.conf   private conf (own SESSION_NAME, DB_PATH, LOG_DIR, STATE_DIR)
#   data/ logs/      private SQLite DB + logs/state
#   tmux/            private TMUX_TMPDIR (own tmux server + socket)
#   repo/ plain/     fixture git repo (one commit, packages/app) + non-git dir
#   repo-worktrees/  created by the code under test, never by this script
#   pids             `server <pid>` / `tmux-socket <dir>` / `port <n>` / `session <name>`
# It never touches the real conductor.conf, the real DB, port 8788 (GET only, to
# prove no uat0218* agent leaked there) or the default tmux socket.
#
# Usage:
#   bash scripts/verify-worktree-any-agent.sh                # hermetic full run
#   bash scripts/verify-worktree-any-agent.sh --setup-only   # leave stack + fixtures running (UI walk)
#   bash scripts/verify-worktree-any-agent.sh --cleanup      # tear down what --setup-only left
#   bash scripts/verify-worktree-any-agent.sh --stop-server  # kill only the private host-server
#   bash scripts/verify-worktree-any-agent.sh --start-server # restart it (same DB/port/socket)
# Env: UAT_PORT (default 18790), UAT_SESSION_NAME (default uatsess; must not be "conductor").
#
# Output: one `PASS: caseN <desc>` / `FAIL: caseN <desc>: <reasons>` line per case,
# then `ALL PASS` (exit 0) or `FAILED: k case(s)` (exit 1). `SKIPPED: <reason>`
# (exit 0) when a tool is missing / the port is busy — a SKIPPED run is NOT a pass.
# Exit 2 = refused (unsafe environment).
#
# macOS bash 3.2 compatible: no associative arrays, no mapfile, no ${var,,}.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd -P)"
UAT="$REPO/tmp/uat-0218"
REAL_WINDOWS_BEFORE="$REPO/tmp/uat-0218-real-windows.before"
PIDS_FILE="$UAT/pids"
CONF="$UAT/conductor.conf"
TMUXDIR="$UAT/tmux"
FIX_REPO="$UAT/repo"
FIX_PLAIN="$UAT/plain"
WT_ROOT="$UAT/repo-worktrees"
SERVER_LOG="$UAT/server.log"

# NOT "uat0218": host-server's spawnAgentWindow runs `tmux new-window -t <session>` with no
# trailing colon, and tmux resolves a bare target by window-name prefix first, so a session
# name that prefixes the fixture window names (uat0218-a, ...) makes the second agent fail
# with "create window failed: index 1 in use". See UAT-0218 findings.
SESSION="${UAT_SESSION_NAME:-uatsess}"
SRV_PORT="${UAT_PORT:-18790}"
ORIG_TMUX_TMPDIR="${TMUX_TMPDIR:-}"
REAL_PORT=8788

MODE=run
for arg in "$@"; do
  case "$arg" in
    --setup-only)   MODE=setup ;;
    --cleanup)      MODE=cleanup ;;
    --stop-server)  MODE=stop ;;
    --start-server) MODE=start ;;
    -h|--help)
      sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown argument: $arg (see --help)"; exit 2 ;;
  esac
done

info() { echo "[uat-0218] $*"; }

# ---------------------------------------------------------------------------
# Refusals (exit 2): never run against the operator's real stack.
# ---------------------------------------------------------------------------
case "$SRV_PORT" in
  ''|*[!0-9]*) echo "REFUSED: UAT_PORT must be a number (got '$SRV_PORT')"; exit 2 ;;
esac
if [ "$SRV_PORT" = "$REAL_PORT" ]; then
  echo "REFUSED: UAT_PORT=$SRV_PORT is the real host-server port; pick another port"
  exit 2
fi
if [ "$SESSION" = "conductor" ]; then
  echo "REFUSED: UAT_SESSION_NAME=conductor is the real session name; this harness must use a private session"
  exit 2
fi
if [ -n "${CONDUCTOR_CONF:-}" ]; then
  conf_dir="$(cd "$(dirname "$CONDUCTOR_CONF")" 2>/dev/null && pwd -P)"
  conf_resolved="${conf_dir:-?}/$(basename "$CONDUCTOR_CONF")"
  if [ "$conf_resolved" = "$REPO/conductor.conf" ]; then
    echo "REFUSED: CONDUCTOR_CONF is set and resolves to the repo's real conductor.conf ($conf_resolved); unset CONDUCTOR_CONF and re-run"
    exit 2
  fi
fi

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

valid_pid() {
  case "${1:-}" in
    ''|*[!0-9]*|0|1) return 1 ;;
  esac
  return 0
}
pid_alive() { valid_pid "${1:-}" && kill -0 "$1" 2>/dev/null; }
pid_gone() {
  pid_alive "$1" || return 0
  local st
  st="$(ps -p "$1" -o stat= 2>/dev/null)"
  case "$st" in Z*) return 0 ;; esac
  return 1
}

# wait_until <secs> <cmd...> — bounded deadline loop; 0 when cmd succeeds in time.
wait_until() {
  local end=$((SECONDS + $1))
  shift
  while :; do
    if "$@"; then return 0; fi
    if [ "$SECONDS" -ge "$end" ]; then return 1; fi
    sleep 0.3
  done
}

# Normalise a path (macOS /private prefix, symlinks). Non-existent leaf: normalise its parent.
norm() {
  local p=$1 d b
  if [ -d "$p" ]; then
    ( cd "$p" 2>/dev/null && pwd -P ) || printf '%s\n' "$p"
    return 0
  fi
  d="$(dirname "$p")"
  b="$(basename "$p")"
  if [ -d "$d" ]; then
    printf '%s/%s\n' "$(cd "$d" && pwd -P)" "$b"
  else
    printf '%s\n' "$p"
  fi
}
same_path() { [ -n "$1" ] && [ -n "$2" ] && [ "$(norm "$1")" = "$(norm "$2")" ]; }

# tmux on the PRIVATE socket only (TMUX unset so an outer tmux can never win).
ptmux() { env -u TMUX TMUX_TMPDIR="$TMUXDIR" tmux "$@"; }
# tmux on the operator's DEFAULT socket (read-only use: list-*).
dtmux() {
  (
    unset TMUX
    if [ -n "$ORIG_TMUX_TMPDIR" ]; then export TMUX_TMPDIR="$ORIG_TMUX_TMPDIR"; else unset TMUX_TMPDIR; fi
    tmux "$@"
  )
}

gitr() { git -C "$FIX_REPO" "$@"; }

pids_get() { # key -> value (rest of the line after the first field)
  [ -f "$PIDS_FILE" ] || return 0
  awk -v k="$1" '$1==k { v=$0; sub(/^[^ ]+ /, "", v); print v; exit }' "$PIDS_FILE"
}
write_pids() { # server_pid_or_dash
  {
    echo "server $1"
    echo "tmux-socket $TMUXDIR"
    echo "port $SRV_PORT"
    echo "session $SESSION"
  } >"$PIDS_FILE"
}

BASE="http://127.0.0.1:$SRV_PORT"

port_busy() {
  curl -s -m 2 -o /dev/null "http://127.0.0.1:$SRV_PORT/" 2>/dev/null && return 0
  if have nc && nc -z 127.0.0.1 "$SRV_PORT" >/dev/null 2>&1; then return 0; fi
  if have lsof && lsof -nP -iTCP:"$SRV_PORT" -sTCP:LISTEN >/dev/null 2>&1; then return 0; fi
  return 1
}

kill_server_pid() { # only ever the recorded/started host-server pid
  local pid=$1 cmd
  pid_alive "$pid" || return 0
  cmd="$(ps -p "$pid" -o command= 2>/dev/null)"
  case "$cmd" in
    *node*index.ts*) ;;
    *) info "refusing to kill pid $pid: it is not the recorded host-server ($cmd)"; return 1 ;;
  esac
  kill "$pid" 2>/dev/null
  wait_until 10 pid_gone "$pid" || kill -9 "$pid" 2>/dev/null
  return 0
}

kill_private_tmux() {
  have tmux || return 0
  [ -n "$TMUXDIR" ] || return 0
  env -u TMUX TMUX_TMPDIR="$TMUXDIR" tmux kill-server >/dev/null 2>&1 || true
}

safe_rm_uat() {
  case "$UAT" in
    "$REPO"/tmp/uat-0218) rm -rf "$UAT" ;;
    *) info "refusing to rm -rf unexpected path: $UAT" ;;
  esac
}

# The private host-server environment. Everything the host-server reads that could
# point at the real stack is overridden or unset.
export_private_env() {
  unset TMUX TMUX_PANE CONDUCTOR_DB PORT
  export CONDUCTOR_CONF="$CONF"
  export BACKEND_PORT="$SRV_PORT"
  export HOST=127.0.0.1
  export TMUX_TMPDIR="$TMUXDIR"
  # The host-server's default 100 ms tmux timeout is tight on a loaded machine.
  export TMUX_SYNC_TIMEOUT_MS=2000
}

# ---------------------------------------------------------------------------
# --stop-server / --start-server / --cleanup (operate on a recorded stack)
# ---------------------------------------------------------------------------
load_recorded_stack() {
  if [ ! -f "$PIDS_FILE" ]; then
    echo "no recorded stack ($PIDS_FILE missing); run --setup-only first"
    exit 1
  fi
  local p s
  p="$(pids_get port)"
  s="$(pids_get session)"
  if [ -n "$p" ]; then SRV_PORT="$p"; BASE="http://127.0.0.1:$SRV_PORT"; fi
  if [ -n "$s" ]; then SESSION="$s"; fi
}

start_server() {
  ( cd "$REPO/host-server" && exec nohup node --import tsx/esm index.ts ) >>"$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  disown "$SERVER_PID" 2>/dev/null || true
}

# wait_server <api path> — 0 ready, 1 timeout, 2 process died. Bounded (~90 s).
wait_server() {
  local end=$((SECONDS + 90))
  while :; do
    if curl -sf -m 2 -o /dev/null "$BASE$1" 2>/dev/null; then return 0; fi
    if ! pid_alive "${SERVER_PID:-}"; then return 2; fi
    if [ "$SECONDS" -ge "$end" ]; then return 1; fi
    sleep 0.5
  done
}

delete_all_uat_agents() { # via the API, so the code under test removes worktrees/branches
  local ids id
  ids="$(curl -sS -m 20 "$BASE/api/agents" 2>/dev/null | jq -r '.[] | select(.name | startswith("uat0218")) | .id' 2>/dev/null)" || ids=""
  for id in $ids; do
    curl -sS -m 30 -X DELETE -o /dev/null "$BASE/api/agents/$id" 2>/dev/null || true
  done
}

if [ "$MODE" = stop ]; then
  load_recorded_stack
  pid="$(pids_get server)"
  if pid_alive "$pid"; then
    kill_server_pid "$pid" || exit 1
    server_down() { ! curl -sf -m 1 -o /dev/null "$BASE/api/status" 2>/dev/null; }
    wait_until 15 server_down || { info "port $SRV_PORT still answers after kill"; exit 1; }
    info "private host-server (pid $pid) stopped"
  else
    info "private host-server is not running"
  fi
  write_pids "-"
  exit 0
fi

if [ "$MODE" = start ]; then
  load_recorded_stack
  pid="$(pids_get server)"
  if pid_alive "$pid"; then
    info "private host-server already running (pid $pid)"
    exit 0
  fi
  export_private_env
  start_server
  write_pids "$SERVER_PID"
  wait_server /api/agents
  rc=$?
  if [ "$rc" -ne 0 ]; then
    info "host-server did not answer /api/agents (rc=$rc); tail of $SERVER_LOG:"
    tail -n 30 "$SERVER_LOG" 2>/dev/null
    exit 1
  fi
  info "private host-server restarted (pid $SERVER_PID) on port $SRV_PORT"
  exit 0
fi

if [ "$MODE" = cleanup ]; then
  if [ ! -e "$UAT" ] && [ ! -e "$REAL_WINDOWS_BEFORE" ]; then
    info "nothing to clean"
    exit 0
  fi
  if [ -f "$PIDS_FILE" ]; then
    load_recorded_stack
    pid="$(pids_get server)"
    if pid_alive "$pid" && have curl && have jq; then
      info "deleting uat0218* agents through the API (worktrees/branches are removed by the code under test)"
      delete_all_uat_agents
    fi
    if pid_alive "$pid"; then kill_server_pid "$pid"; fi
  fi
  kill_private_tmux
  safe_rm_uat
  rm -f "$REAL_WINDOWS_BEFORE"
  info "cleanup done"
  exit 0
fi

# ---------------------------------------------------------------------------
# Preflight (MODE run | setup): SKIPPED (exit 0) rather than a false failure.
# ---------------------------------------------------------------------------
skip() { echo "SKIPPED: $*"; exit 0; }

for tool in tmux git jq curl node; do
  have "$tool" || skip "required tool '$tool' is not on PATH"
done
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' 2>/dev/null \
  || skip "node >= 18 is required (found $(node -v 2>/dev/null))"
[ -d "$REPO/host-server/node_modules" ] || skip "host-server dependencies are not installed (run npm install in host-server/)"
case "$REPO" in
  *[[:space:]]*) skip "repo path contains whitespace; host-server sources the conf path unquoted" ;;
esac

# A live stack from an earlier --setup-only must be cleaned by the operator, never clobbered.
if [ -f "$PIDS_FILE" ]; then
  if pid_alive "$(pids_get server)"; then
    echo "REFUSED: a private stack is already running (pid $(pids_get server), $PIDS_FILE); run: bash scripts/verify-worktree-any-agent.sh --cleanup"
    exit 2
  fi
fi

if port_busy; then
  skip "port $SRV_PORT is busy (set UAT_PORT to a free port)"
fi

SOCK_PATH="$TMUXDIR/tmux-$(id -u)/default"
if [ "${#SOCK_PATH}" -gt 100 ]; then
  skip "private tmux socket path is ${#SOCK_PATH} chars (macOS limit ~104): $SOCK_PATH — run from a shorter checkout path"
fi

# ---------------------------------------------------------------------------
# Result bookkeeping: one PASS/FAIL line per case.
# ---------------------------------------------------------------------------
FAILS=0
CASE_ID=""
CASE_DESC=""
CASE_ERRS=""
API_CODE=""
API_BODY=""
SERVER_PID=""
SSE_PID=""
KEEP=0
STACK_STARTED=0

case_begin() { CASE_ID=$1; CASE_DESC=$2; CASE_ERRS=""; }
note_fail() { CASE_ERRS="${CASE_ERRS:+$CASE_ERRS; }$1"; }
case_end() {
  if [ -z "$CASE_ERRS" ]; then
    echo "PASS: $CASE_ID $CASE_DESC"
  else
    echo "FAIL: $CASE_ID $CASE_DESC: $CASE_ERRS"
    FAILS=$((FAILS + 1))
  fi
}
short() { printf '%s' "$1" | tr '\n' ' ' | cut -c1-160; }
eq() { if [ "$2" != "$3" ]; then note_fail "$1 (got '$(short "$2")', want '$(short "$3")')"; fi; }
matches() { if ! printf '%s' "$2" | grep -Eiq -- "$3"; then note_fail "$1 (got '$(short "$2")')"; fi; }
check() { local msg=$1; shift; if ! "$@" >/dev/null 2>&1; then note_fail "$msg"; fi; }

# ---------------------------------------------------------------------------
# API + tmux + SSE helpers
# ---------------------------------------------------------------------------
# api METHOD PATH [json] — sets API_CODE and API_BODY (the body is also left in $UAT/api.body).
# A Content-Type is only sent with a body: Fastify rejects an empty JSON body.
api() {
  local method=$1 path=$2 data="${3-}" out="$UAT/api.body"
  : >"$out"
  if [ -n "$data" ]; then
    API_CODE="$(curl -sS -m 60 -X "$method" -H 'Content-Type: application/json' --data "$data" -o "$out" -w '%{http_code}' "$BASE/api$path" 2>/dev/null)" || API_CODE=000
  else
    API_CODE="$(curl -sS -m 60 -X "$method" -o "$out" -w '%{http_code}' "$BASE/api$path" 2>/dev/null)" || API_CODE=000
  fi
  API_BODY="$(<"$out")"
}
is2xx() { case "$API_CODE" in 2??) return 0 ;; esac; return 1; }
expect_2xx() { if ! is2xx; then note_fail "$1: expected 2xx, got $API_CODE ($(short "$API_BODY"))"; fi; }
jb() { printf '%s' "$API_BODY" | jq -r "$@" 2>/dev/null; }

agents_json() { curl -sS -m 20 "$BASE/api/agents" 2>/dev/null; }
aid_of() { agents_json | jq -r --arg n "$1" '.[] | select(.name == $n) | .id' 2>/dev/null | head -n 1; }
agent_wt() { agents_json | jq -r --argjson i "$1" '.[] | select(.id == $i) | .worktreePath // ""' 2>/dev/null; }
agent_count() { agents_json | jq 'length' 2>/dev/null; }
window_names() { ptmux list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | sort; }
window_present() { window_names | grep -Fxq "$1"; }
branches_conductor() { gitr for-each-ref --format='%(refname:short)' refs/heads/conductor/ 2>/dev/null | sort; }
wt_registered() { gitr worktree list --porcelain 2>/dev/null | grep -Eq "^worktree .*$1\$"; }

pane_cwd() { ptmux display -p -t "$SESSION:=$1" '#{pane_current_path}' 2>/dev/null; }
pane_cwd_matches() { # window expected...
  local w=$1 cur e
  shift
  cur="$(pane_cwd "$w")"
  [ -n "$cur" ] || return 1
  cur="$(norm "$cur")"
  for e in "$@"; do
    if [ "$cur" = "$(norm "$e")" ]; then return 0; fi
  done
  return 1
}
expect_cwd() { # msg window expected...
  local msg=$1 w=$2
  shift 2
  if ! wait_until 10 pane_cwd_matches "$w" "$@"; then
    note_fail "$msg (pane cwd '$(pane_cwd "$w")', want '$1')"
  fi
}

sse_start() { # file — background listener (bounded by curl -m 10), waits for the connect banner
  SSE_FILE=$1
  : >"$SSE_FILE"
  curl -sN -m 10 "$BASE/api/events" -o "$SSE_FILE" >/dev/null 2>&1 &
  SSE_PID=$!
  disown "$SSE_PID" 2>/dev/null || true
  wait_until 5 grep -q '^: connected' "$SSE_FILE"
}
sse_stop() {
  if [ -n "${SSE_PID:-}" ]; then kill "$SSE_PID" 2>/dev/null || true; fi
  SSE_PID=""
}
sse_updates() { awk '/^event: /{ev=substr($0,8)} /^data: /{if(ev=="agent-update")print substr($0,7)}' "$1"; }
sse_first_for() { sse_updates "$2" | jq -c --argjson i "$1" 'select(.id == $i)' 2>/dev/null | head -n 1; }
sse_has_first() { [ -n "$(sse_first_for "$1" "$2")" ]; }
sse_has_full_worktree_event() { # id file
  [ -n "$(sse_updates "$2" | jq -c --argjson i "$1" \
    'select(.id == $i and .worktreePath != null and .branch != null and has("status") and has("mode") and has("windowPresent") and has("inGitRepo"))' 2>/dev/null | head -n 1)" ]
}

create_agent() { # name workdir [worktree]  -> API_* ; NEW_ID
  local body
  body="$(jq -nc --arg n "$1" --arg w "$2" --arg wt "${3:-}" \
    '{name:$n, workdir:$w, launchCmd:"sleep 3600"} + (if $wt == "true" then {useWorktree:true} else {} end)')"
  api POST /agents "$body"
  NEW_ID="$(jb '.agent.id // ""')"
}

# ---------------------------------------------------------------------------
# Stack lifecycle
# ---------------------------------------------------------------------------
write_conf() {
  mkdir -p "$UAT/data" "$UAT/logs/state"
  {
    echo '# Private conductor.conf for UAT-0218 (generated; safe to delete).'
    printf 'SESSION_NAME="%s"\n' "$SESSION"
    cat <<'EOF'
CLAUDE_FLAGS=""
BG_PROCESSES=(
)
CLEAR_CMD="/clear"
IDLE_PATTERN="\\?[[:space:]]+for[[:space:]]+shortcuts|(accept edits|bypass permissions) on \\(shift\\+tab to cycle\\)"
BUSY_PATTERN="esc to interrupt"
AWAITING_PATTERN='(\?\s*$|\?\s+[A-Za-z]+(/[A-Za-z]+)+\s*$|\[Y/n\]|\[y/N\]|^\s*>\s*$|Enter to (select|confirm|submit)|Esc to (cancel|go back)|ctrl.g to edit|shift.tab to approve)'
POLL_INTERVAL=15
STALL_TIMEOUT=300
STATUS_POLL_MS=1000
TERMINAL_POLL_MS=2000
FOCUSED_TERMINAL_POLL_MS=250
FOCUSED_TERMINAL_WS_POLL_MS=250
TERMINAL_TAIL_LINES=100
FOCUSED_TERMINAL_TAIL_LINES=300
TERMINAL_LOG_MAX_ROWS_PER_AGENT=500
METRICS_SNAPSHOT_INTERVAL_MS=60000
CONTEXT_WINDOW=200000
USAGE_CHECK_CMD='true'
DB_PATH="./data/conductor.db"
LOG_DIR="./logs"
PENDING_AGENT_STALE_S=3600
BG_RESTART_COOLDOWN_S=30
STATE_DIR="./logs/state"
EOF
  } >"$CONF"
}

seed_repo_fixtures() {
  mkdir -p "$FIX_REPO/packages/app" "$FIX_PLAIN"
  echo "app entry" >"$FIX_REPO/packages/app/index.txt"
  echo "uat-0218 fixture" >"$FIX_REPO/README.md"
  git -C "$FIX_REPO" init -q
  git -C "$FIX_REPO" symbolic-ref HEAD refs/heads/main
  git -C "$FIX_REPO" add -A
  git -C "$FIX_REPO" -c user.name=uat0218 -c user.email=uat0218@example.invalid -c commit.gpgsign=false commit -q -m "init"
  echo "not a git repo" >"$FIX_PLAIN/note.txt"
}

ID_A=""; ID_SUB=""; ID_PLAIN=""; ID_WT=""; ID_GONE=""
seed_agents() {
  local pair name dir wt
  for pair in "uat0218-a:$FIX_REPO:" "uat0218-sub:$FIX_REPO/packages/app:" "uat0218-plain:$FIX_PLAIN:" \
              "uat0218-wt:$FIX_REPO:true" "uat0218-gone:$FIX_REPO:"; do
    name="${pair%%:*}"
    dir="${pair#*:}"; wt="${dir##*:}"; dir="${dir%:*}"
    create_agent "$name" "$dir" "$wt"
    if ! is2xx; then
      info "fixture $name: POST /agents -> $API_CODE $(short "$API_BODY")"
      return 1
    fi
  done
  ID_A="$(aid_of uat0218-a)"; ID_SUB="$(aid_of uat0218-sub)"; ID_PLAIN="$(aid_of uat0218-plain)"
  ID_WT="$(aid_of uat0218-wt)"; ID_GONE="$(aid_of uat0218-gone)"
  [ -n "$ID_A" ] && [ -n "$ID_SUB" ] && [ -n "$ID_PLAIN" ] && [ -n "$ID_WT" ] && [ -n "$ID_GONE" ]
}

on_exit() {
  sse_stop
  if [ "$KEEP" = 1 ] || [ "$STACK_STARTED" != 1 ]; then return 0; fi
  if [ -n "$SERVER_PID" ]; then kill_server_pid "$SERVER_PID" || true; fi
  kill_private_tmux
  safe_rm_uat
}
trap on_exit EXIT
trap 'exit 130' INT TERM

teardown_stack() {
  sse_stop
  if [ -n "$SERVER_PID" ]; then kill_server_pid "$SERVER_PID" || true; SERVER_PID=""; fi
  kill_private_tmux
  safe_rm_uat
}

bring_up_stack() {
  export_private_env
  STACK_STARTED=1
  rm -rf "$UAT"
  mkdir -p "$UAT" "$TMUXDIR"
  write_conf
  seed_repo_fixtures
  # -f /dev/null: never load the operator's tmux.conf (plugins!) into the private server.
  if ! ptmux -f /dev/null new-session -d -s "$SESSION" -n keeper -c "$UAT" 'sleep 86400'; then
    echo "FAIL: case1 setup: could not start the private tmux server/session"
    return 1
  fi
  ptmux set-option -g default-command 'bash --norc --noprofile' >/dev/null 2>&1 || true
  start_server
  write_pids "$SERVER_PID"
  local rc
  wait_server /api/status
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "FAIL: case1 setup: host-server did not answer GET /api/status (rc=$rc: 1=timeout, 2=exited); tail of $SERVER_LOG:"
    tail -n 30 "$SERVER_LOG" 2>/dev/null
    return 1
  fi
  if ! seed_agents; then
    echo "FAIL: case1 setup: could not seed the five fixture agents"
    return 1
  fi
  return 0
}

finish() {
  if [ "$FAILS" -eq 0 ]; then
    echo "ALL PASS"
    exit 0
  fi
  echo "FAILED: $FAILS case(s)"
  exit 1
}

# ---------------------------------------------------------------------------
# Cases (mirror UAT-0218)
# ---------------------------------------------------------------------------
WT_A=""; WT_SUB=""; WT_NOWIN=""
ID_SRC8=""; ID_CLONE8=""; NAME_CLONE8=""; ID_RETRY=""

case_1_setup() {
  case_begin case1 "setup"
  local n names real cnt fixture
  n="$(gitr rev-list --count HEAD 2>/dev/null)"
  eq "fixture repo commit count" "${n:-?}" 1
  eq "fixture repo branch" "$(gitr rev-parse --abbrev-ref HEAD 2>/dev/null)" main
  check "packages/app/index.txt is committed" gitr ls-files --error-unmatch packages/app/index.txt
  check "README.md is committed" gitr ls-files --error-unmatch README.md
  check "plain dir is not a git repo" test ! -e "$FIX_PLAIN/.git"
  names="$(agents_json | jq -r '[.[].name] | sort | join(",")' 2>/dev/null)"
  eq "private server agents" "$names" "uat0218-a,uat0218-gone,uat0218-plain,uat0218-sub,uat0218-wt"
  for fixture in uat0218-a uat0218-sub uat0218-plain uat0218-wt uat0218-gone; do
    window_present "$fixture" || note_fail "no window '$fixture' in the private tmux session"
  done
  check "fixture uat0218-wt has a worktree at add time" test -n "$(agent_wt "$ID_WT")"
  # The real server (if running) is only ever READ.
  real="$(curl -s -m 2 "http://127.0.0.1:$REAL_PORT/api/agents" 2>/dev/null)" || real=""
  if [ -n "$real" ]; then
    cnt="$(printf '%s' "$real" | jq '[.[] | select(.name | startswith("uat0218"))] | length' 2>/dev/null)"
    eq "uat0218* agents on the real server ($REAL_PORT)" "${cnt:-0}" 0
  fi
  case_end
}

case_4_api() {
  case_begin case4-api "worktree API returns git's real reason and the right statuses"
  local err
  gitr branch "conductor/$ID_SUB" >/dev/null 2>&1 || note_fail "could not pre-create conflicting branch conductor/$ID_SUB"
  api POST "/agents/$ID_SUB/worktree"
  if is2xx; then note_fail "conflicting branch: expected non-2xx, got $API_CODE"; fi
  err="$(jb '.error // ""')"
  matches "error names the failed creation" "$err" 'failed to create git worktree'
  matches "error carries git's own 'already exists' reason" "$err" 'already exists'
  gitr branch -D "conductor/$ID_SUB" >/dev/null 2>&1 || note_fail "could not delete pre-created branch"
  api POST "/agents/$ID_PLAIN/worktree"
  eq "plain agent status" "$API_CODE" 400
  matches "plain agent error" "$(jb '.error // ""')" 'not inside a git repository'
  api POST /agents/999999/worktree
  eq "unknown agent status" "$API_CODE" 404
  matches "unknown agent error" "$(jb '.error // ""')" 'not found'
  api POST /agents/abc/worktree
  eq "non-numeric id status" "$API_CODE" 400
  matches "non-numeric id error" "$(jb '.error // ""')" 'invalid agent id'
  case_end
}

case_5() {
  case_begin case5 "worktree for a subdirectory workdir lands in a new sibling dir, repo stays clean"
  local pre=0 exp
  if [ -e "$WT_ROOT" ]; then pre=1; fi
  eq "repo-worktrees must not exist before the first worktree" "$pre" 0
  api POST "/agents/$ID_SUB/worktree"
  eq "POST /worktree status" "$API_CODE" 201
  WT_SUB="$(jb '.agent.worktreePath // ""')"
  exp="$WT_ROOT/$ID_SUB"
  same_path "$WT_SUB" "$exp" || note_fail "worktreePath '$WT_SUB' != '$exp'"
  eq "branch" "$(jb '.agent.branch // ""')" "conductor/$ID_SUB"
  check "worktree directory exists" test -d "$exp"
  check "worktree is registered in git" wt_registered "/repo-worktrees/$ID_SUB"
  eq "git status --porcelain in the repo" "$(gitr status --porcelain 2>&1)" ""
  check "no worktrees dir inside the repo" test ! -e "$FIX_REPO/worktrees"
  case_end
}

case_6_sse() {
  case_begin case6-sse "worktree creation reaches SSE as a full-shaped agent-update"
  sse_start "$UAT/sse-a.txt" || note_fail "SSE listener never reported connected"
  api POST "/agents/$ID_A/worktree"
  eq "POST /worktree status" "$API_CODE" 201
  WT_A="$(jb '.agent.worktreePath // ""')"
  wait_until 9 sse_has_full_worktree_event "$ID_A" "$UAT/sse-a.txt" \
    || note_fail "no agent-update for $ID_A with worktreePath+branch and status/mode/windowPresent/inGitRepo within 9s"
  sse_stop
  case_end
}

restart_window() { # id label
  api DELETE "/agents/$1/window"
  expect_2xx "$2: DELETE /window"
  api POST "/agents/$1/window"
  expect_2xx "$2: POST /window"
}

case_7() {
  case_begin case7 "restart/respawn windows start inside the worktree"
  local wt_wt
  wt_wt="$(agent_wt "$ID_WT")"
  [ -n "$WT_A" ] || note_fail "uat0218-a has no recorded worktree (case6 failed?)"
  [ -n "$wt_wt" ] || note_fail "uat0218-wt has no worktree"
  [ -n "$WT_SUB" ] || note_fail "uat0218-sub has no recorded worktree (case5 failed?)"

  restart_window "$ID_A" uat0218-a
  expect_cwd "uat0218-a pane cwd after restart" uat0218-a "$WT_A"

  restart_window "$ID_WT" uat0218-wt
  expect_cwd "uat0218-wt pane cwd after restart" uat0218-wt "$wt_wt"

  restart_window "$ID_SUB" uat0218-sub
  expect_cwd "uat0218-sub pane cwd after restart (worktree root or packages/app)" uat0218-sub "$WT_SUB" "$WT_SUB/packages/app"

  # An agent with no window: no warning path in the API; worktree then window.
  create_agent uat0218-nowin "$FIX_REPO"
  expect_2xx "create uat0218-nowin"
  local nowin="$NEW_ID"
  if [ -z "$nowin" ]; then
    note_fail "uat0218-nowin was not created"
    case_end
    return
  fi
  api DELETE "/agents/$nowin/window"
  expect_2xx "uat0218-nowin: first DELETE /window"
  api DELETE "/agents/$nowin/window"
  if is2xx; then note_fail "second DELETE /window on a missing window returned $API_CODE, expected non-2xx"; fi
  matches "second DELETE /window error" "$(jb '.error // ""')" 'not present'
  check "server still answers after the second DELETE /window" curl -sf -m 5 -o /dev/null "$BASE/api/agents"
  api POST "/agents/$nowin/worktree"
  eq "uat0218-nowin POST /worktree status" "$API_CODE" 201
  WT_NOWIN="$(jb '.agent.worktreePath // ""')"
  api POST "/agents/$nowin/window"
  expect_2xx "uat0218-nowin: POST /window"
  expect_cwd "uat0218-nowin pane cwd after Create window" uat0218-nowin "$WT_NOWIN"
  case_end
}

case_8() {
  case_begin case8 "forced clone of a worktree-less source; plain clone unchanged"
  create_agent uat0218-src8 "$FIX_REPO"
  expect_2xx "create uat0218-src8"
  ID_SRC8="$NEW_ID"
  if [ -z "$ID_SRC8" ]; then
    note_fail "uat0218-src8 was not created"
    case_end
    return
  fi
  eq "src8 starts without a worktree" "$(jb '.agent.worktreePath // "null"')" null

  sse_start "$UAT/sse-clone.txt" || note_fail "SSE listener never reported connected"
  api POST "/agents/$ID_SRC8/clone" '{"forceWorktree":true}'
  eq "forced clone status" "$API_CODE" 201
  ID_CLONE8="$(jb '.agent.id // ""')"
  NAME_CLONE8="$(jb '.agent.name // ""')"
  local wt exp
  wt="$(jb '.agent.worktreePath // ""')"
  exp="$WT_ROOT/$ID_CLONE8"
  same_path "$wt" "$exp" || note_fail "clone worktreePath '$wt' != '$exp'"
  eq "clone branch" "$(jb '.agent.branch // ""')" "conductor/$ID_CLONE8"
  if wait_until 9 sse_has_first "${ID_CLONE8:-0}" "$UAT/sse-clone.txt"; then
    local ev
    ev="$(sse_first_for "$ID_CLONE8" "$UAT/sse-clone.txt")"
    eq "first SSE event worktreePath non-null" "$(printf '%s' "$ev" | jq -r '(.worktreePath != null)')" true
    eq "first SSE event branch non-null" "$(printf '%s' "$ev" | jq -r '(.branch != null)')" true
    eq "first SSE event inGitRepo" "$(printf '%s' "$ev" | jq -r '.inGitRepo')" true
    eq "first SSE event has mode and state" "$(printf '%s' "$ev" | jq -r 'has("mode") and has("state")')" true
  else
    note_fail "no agent-update for clone $ID_CLONE8 within 9s"
  fi
  sse_stop
  expect_cwd "clone pane cwd" "$NAME_CLONE8" "$wt"
  eq "source worktreePath still null" "$(agent_wt "$ID_SRC8")" ""
  expect_cwd "source pane cwd unchanged" uat0218-src8 "$FIX_REPO"

  # Plain clone (no body): worktreePath/branch keys PRESENT with null values in the first event.
  sse_start "$UAT/sse-plain.txt" || note_fail "SSE listener (plain clone) never reported connected"
  api POST "/agents/$ID_SRC8/clone"
  eq "plain clone status" "$API_CODE" 201
  local plain_id
  plain_id="$(jb '.agent.id // ""')"
  eq "plain clone worktreePath" "$(jb '.agent.worktreePath // "null"')" null
  if wait_until 9 sse_has_first "${plain_id:-0}" "$UAT/sse-plain.txt"; then
    eq "plain clone first event carries worktreePath+branch keys as null" \
      "$(sse_first_for "$plain_id" "$UAT/sse-plain.txt" | jq -r 'has("worktreePath") and has("branch") and .worktreePath == null and .branch == null')" true
  else
    note_fail "no agent-update for plain clone $plain_id within 9s"
  fi
  sse_stop
  case_end
}

case_9() {
  case_begin case9 "forced clone of a worktree-backed source; plain clones unchanged"
  local wt_src br_src wt_f br_f wt_p id_f id_p dup
  wt_src="$(agent_wt "$ID_WT")"
  br_src="conductor/$ID_WT"

  api POST "/agents/$ID_WT/clone" '{"forceWorktree":true}'
  eq "forced clone of uat0218-wt status" "$API_CODE" 201
  id_f="$(jb '.agent.id // ""')"
  wt_f="$(jb '.agent.worktreePath // ""')"
  br_f="$(jb '.agent.branch // ""')"
  if [ -z "$wt_f" ] || [ "$wt_f" = "$wt_src" ]; then note_fail "forced clone worktreePath '$wt_f' must differ from source '$wt_src'"; fi
  if [ -z "$br_f" ] || [ "$br_f" = "$br_src" ]; then note_fail "forced clone branch '$br_f' must differ from source '$br_src'"; fi
  case "$(norm "$wt_f")" in "$(norm "$WT_ROOT")"/*) ;; *) note_fail "forced clone worktree '$wt_f' is not under repo-worktrees" ;; esac
  case "$(norm "$wt_src")" in "$(norm "$WT_ROOT")"/*) ;; *) note_fail "source worktree '$wt_src' is not under repo-worktrees" ;; esac
  eq "forced clone branch is conductor/<cloneId>" "$br_f" "conductor/$id_f"

  api POST "/agents/$ID_SRC8/clone"
  eq "plain clone of worktree-less status" "$API_CODE" 201
  eq "plain clone of worktree-less worktreePath" "$(jb '.agent.worktreePath // "null"')" null
  eq "plain clone shares the source workdir" "$(jb '.agent.workdir // ""')" "$(agents_json | jq -r --argjson i "$ID_SRC8" '.[] | select(.id == $i) | .workdir')"

  api POST "/agents/$ID_WT/clone"
  eq "plain clone of uat0218-wt status" "$API_CODE" 201
  id_p="$(jb '.agent.id // ""')"
  wt_p="$(jb '.agent.worktreePath // ""')"
  if [ -z "$wt_p" ] || [ "$wt_p" = "$wt_src" ] || [ "$wt_p" = "$wt_f" ]; then
    note_fail "plain clone of a worktree-backed agent must get its own worktree (got '$wt_p')"
  fi
  eq "plain clone branch" "$(jb '.agent.branch // ""')" "conductor/$id_p"

  dup="$(agents_json | jq -r '[.[].worktreePath | select(. != null)] | (length - (unique | length))' 2>/dev/null)"
  eq "agents sharing a worktreePath" "${dup:-?}" 0
  case_end
}

case_10() {
  case_begin case10 "failed forced clone fails loudly and leaves no residue"
  local cnt0 win0 br0 next
  cnt0="$(agent_count)"; win0="$(window_names)"; br0="$(branches_conductor)"

  api POST "/agents/$ID_PLAIN/clone" '{"forceWorktree":true}'
  eq "forced clone of the non-git agent status" "$API_CODE" 400
  matches "forced clone of the non-git agent error" "$(jb '.error // ""')" 'not inside a git repository'
  eq "agent count after 400" "$(agent_count)" "$cnt0"
  eq "tmux windows after 400" "$(window_names)" "$win0"
  eq "conductor/* branches after 400" "$(branches_conductor)" "$br0"

  next="$(agents_json | jq '[.[].id] | max + 1' 2>/dev/null)"
  if [ -z "$next" ]; then
    note_fail "could not compute the next agent id"
    case_end
    return
  fi
  gitr branch "conductor/$next" >/dev/null 2>&1 || note_fail "could not pre-create conductor/$next"
  api POST "/agents/$ID_A/clone" '{"forceWorktree":true}'
  if is2xx; then note_fail "forced clone with a conflicting branch returned $API_CODE, expected non-2xx"; fi
  matches "forced clone error" "$(jb '.error // ""')" 'failed to create git worktree'
  eq "agent count after failed clone" "$(agent_count)" "$cnt0"
  eq "tmux windows after failed clone" "$(window_names)" "$win0"
  eq "conductor/* branches after failed clone (only the pre-created one added)" \
    "$(branches_conductor)" "$(printf '%s\nconductor/%s\n' "$br0" "$next" | sed '/^$/d' | sort)"
  check "no worktree dir left for the failed clone" test ! -e "$WT_ROOT/$next"

  gitr branch -D "conductor/$next" >/dev/null 2>&1 || note_fail "could not delete pre-created conductor/$next"
  api POST "/agents/$ID_A/clone" '{"forceWorktree":true}'
  eq "retry after clearing the conflict status" "$API_CODE" 201
  ID_RETRY="$(jb '.agent.id // ""')"
  eq "retry took the id whose branch was cleared" "$ID_RETRY" "$next"
  case_end
}

case_11() {
  case_begin case11 "deleting a clone tears down only its own worktree and branch"
  local cid cname cwt cbr src_wt
  src_wt="$(agent_wt "$ID_A")"

  api POST "/agents/$ID_A/clone" '{"forceWorktree":true}'
  eq "forced clone of uat0218-a status" "$API_CODE" 201
  cid="$(jb '.agent.id // ""')"; cname="$(jb '.agent.name // ""')"
  cwt="$(jb '.agent.worktreePath // ""')"; cbr="$(jb '.agent.branch // ""')"
  if [ -z "$cid" ] || [ -z "$cwt" ]; then
    note_fail "forced clone did not return an id/worktreePath"
  else
    check "clone worktree dir exists before delete" test -d "$cwt"
    api DELETE "/agents/$cid"
    eq "DELETE clone status" "$API_CODE" 200
    eq "DELETE clone body .removed" "$(jb '.removed // ""')" "$cname"
    check "clone worktree dir is gone" test ! -e "$cwt"
    if wt_registered "/repo-worktrees/$cid"; then note_fail "clone worktree still in git worktree list"; fi
    if branches_conductor | grep -Fxq "$cbr"; then note_fail "branch $cbr still exists"; fi
    eq "source row survives" "$(aid_of uat0218-a)" "$ID_A"
    eq "source worktreePath unchanged" "$(agent_wt "$ID_A")" "$src_wt"
    check "source worktree dir intact" test -d "$src_wt"
    if ! branches_conductor | grep -Fxq "conductor/$ID_A"; then note_fail "source branch conductor/$ID_A was removed"; fi
    window_present uat0218-a || note_fail "source window uat0218-a was killed"
  fi

  # Hand-deleted worktree: the delete must still prune the registration and drop the branch.
  api POST "/agents/$ID_WT/clone"
  eq "plain clone of uat0218-wt status" "$API_CODE" 201
  cid="$(jb '.agent.id // ""')"; cwt="$(jb '.agent.worktreePath // ""')"; cbr="$(jb '.agent.branch // ""')"
  if [ -z "$cid" ] || [ -z "$cwt" ]; then
    note_fail "worktree-backed clone did not return an id/worktreePath"
  else
    rm -rf "$cwt"
    api DELETE "/agents/$cid"
    eq "DELETE hand-deleted-worktree agent status" "$API_CODE" 200
    if branches_conductor | grep -Fxq "$cbr"; then note_fail "branch $cbr leaked after hand-deleted worktree"; fi
    if wt_registered "/repo-worktrees/$cid"; then note_fail "stale worktree registration for $cid still listed"; fi
    check "server still answers" curl -sf -m 5 -o /dev/null "$BASE/api/agents"
  fi
  case_end
}

case_12() {
  case_begin case12 "Add Agent with and without useWorktree"
  local id wt n=0 d dirs nonnull
  create_agent uat0218-new "$FIX_REPO" true
  eq "uat0218-new status" "$API_CODE" 201
  id="$(jb '.agent.id // ""')"
  wt="$(jb '.agent.worktreePath // ""')"
  same_path "$wt" "$WT_ROOT/$id" || note_fail "uat0218-new worktreePath '$wt' != '$WT_ROOT/$id'"
  expect_cwd "uat0218-new pane cwd" uat0218-new "$wt"

  create_agent uat0218-new2 "$FIX_REPO"
  eq "uat0218-new2 status" "$API_CODE" 201
  eq "uat0218-new2 worktreePath" "$(jb '.agent.worktreePath // "null"')" null
  expect_cwd "uat0218-new2 pane cwd" uat0218-new2 "$FIX_REPO"

  for d in "$WT_ROOT"/*; do
    if [ -e "$d" ]; then n=$((n + 1)); fi
  done
  dirs="$n"
  nonnull="$(agents_json | jq '[.[] | select(.worktreePath != null)] | length' 2>/dev/null)"
  eq "repo-worktrees entries vs agents with a worktree" "$dirs" "${nonnull:-?}"
  case_end
}

case_13() {
  case_begin case13 "cleanup leaves no residue and never touches real agents"
  local ids id left real_after
  ids="$(agents_json | jq -r '.[] | select(.name | startswith("uat0218")) | .id' 2>/dev/null)"
  for id in $ids; do
    api DELETE "/agents/$id"
    if [ "$API_CODE" != 200 ]; then note_fail "DELETE agent $id returned $API_CODE"; fi
  done
  eq "agents left on the private server" "$(agent_count)" 0
  eq "conductor/* branches left" "$(branches_conductor)" ""
  eq "worktrees registered besides the main one" "$(gitr worktree list --porcelain 2>/dev/null | grep -c '^worktree ')" 1
  left=0
  for id in "$WT_ROOT"/*; do
    if [ -e "$id" ]; then left=$((left + 1)); fi
  done
  eq "entries left in repo-worktrees" "$left" 0
  eq "private tmux windows left" "$(window_names | tr '\n' ',')" "keeper,"

  teardown_stack
  check "./tmp/uat-0218 is gone" test ! -e "$UAT"
  if dtmux list-sessions -F '#{session_name}' 2>/dev/null | grep -Fxq "$SESSION"; then
    note_fail "session '$SESSION' exists on the DEFAULT tmux socket"
  fi
  if dtmux list-windows -a -F '#{session_name}:#{window_name}' 2>/dev/null | grep -Eq "^${SESSION}:|:uat0218"; then
    note_fail "a uat0218 window exists on the DEFAULT tmux socket"
  fi
  if [ -f "$REAL_WINDOWS_BEFORE" ]; then
    real_after="$(dtmux list-windows -a -F '#{session_name}:#{window_name}' 2>/dev/null | sort)"
    if [ "$real_after" != "$(sort "$REAL_WINDOWS_BEFORE")" ]; then
      note_fail "real tmux window list differs from ./tmp/uat-0218-real-windows.before (may be unrelated activity)"
    fi
    rm -f "$REAL_WINDOWS_BEFORE"
  fi
  case_end
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if ! bring_up_stack; then
  FAILS=1
  echo "FAILED: $FAILS case(s)"
  exit 1
fi

if [ "$MODE" = setup ]; then
  case_1_setup
  if [ "$FAILS" -ne 0 ]; then
    echo "FAILED: $FAILS case(s)"
    exit 1
  fi
  KEEP=1
  info "private stack is up and left running:"
  info "  host-server pid $SERVER_PID on $BASE (session '$SESSION', tmux socket dir $TMUXDIR)"
  info "  recorded in $PIDS_FILE"
  info "dashboard (second terminal):"
  echo "cd frontend && FRONTEND_PORT=4322 BACKEND_PORT=$SRV_PORT npm run dev"
  info "then open http://localhost:4322/agents"
  info "stop with: bash scripts/verify-worktree-any-agent.sh --cleanup"
  exit 0
fi

case_1_setup
case_4_api
case_5
case_6_sse
case_7
case_8
case_9
case_10
case_11
case_12
case_13
finish
