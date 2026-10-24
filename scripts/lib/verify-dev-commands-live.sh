# verify-dev-commands-live.sh — TASK-0208 Step 3: the --live scenario for
# scripts/verify-dev-commands.sh. Sourced ONLY when --live is passed (see that
# script's run_live()); never executed directly and never sourced in default
# mode, so a syntax slip here cannot affect the hermetic run.
#
# Stands up a throwaway host-server + private tmux world under
# ./tmp/verify-dev-commands/live/ (own conductor.conf, DB, logs/state, tmux
# socket dir, session) and runs the agent-driven bg-process-restart scenario
# from TASK-0208's Approach against it, through the real API, real tmux and
# the real dev-commands.sh client — never the operator's real conductor.conf,
# DB, tmux server/session, or port 8788/4321.
#
# Entry point: run_live_scenario, called by the parent script's run_live().
# Runs in the PARENT'S shell (sourced, not a subshell) so it shares the
# parent's `set -uo pipefail` and its pass()/fail()/FAILURES — a scenario
# assertion failure here folds into the same summary/exit code as the two
# sibling verifiers the parent already runs in default mode. Also shares the
# parent's SCRIPT_DIR/REPO/DEV_CMD/VERIFY_DIR globals; everything this file
# defines is prefixed `lv_`/`LV_` or `info`/`run_live_scenario` to avoid
# clashing with the parent script's own names.
#
# run_live_scenario's return code tells the caller what happened:
#   0  the scenario ran (pass()/fail() already recorded every assertion)
#   2  SKIPPED — a required tool is missing, deps aren't installed, or the
#      chosen port is busy. Not a failure.
#   3  REFUSED — an unsafe-environment guard tripped (should never happen;
#      the checks are a belt-and-suspenders sanity check on this file's own
#      constants, not on anything the caller controls). Counted as a failure
#      by run_live().
#
# Env overrides (never required): VERIFY_LIVE_PORT (default 18789),
# VERIFY_LIVE_SESSION (default verifydevcmds0208).

info() { echo "[verify-dev-commands:live] $*"; }

# ---------------------------------------------------------------------------
# tmux wrappers. lv_tmux always forces the PRIVATE socket (and unsets $TMUX,
# so an outer tmux this very script is running inside can never win). lv_dtmux
# always forces the operator's DEFAULT socket (read-only use: list-*), restoring
# whatever TMUX_TMPDIR this shell had before lv_export_private_env overwrote it.
# ---------------------------------------------------------------------------
lv_tmux() { env -u TMUX TMUX_TMPDIR="$LV_TMUXDIR" tmux "$@"; }
lv_dtmux() {
  (
    unset TMUX
    if [ -n "${LV_ORIG_TMUX_TMPDIR:-}" ]; then export TMUX_TMPDIR="$LV_ORIG_TMUX_TMPDIR"; else unset TMUX_TMPDIR; fi
    tmux "$@"
  )
}

lv_port_busy() {
  curl -s -m 2 -o /dev/null "http://127.0.0.1:$1/" 2>/dev/null && return 0
  command -v lsof > /dev/null 2>&1 && lsof -nP -iTCP:"$1" -sTCP:LISTEN > /dev/null 2>&1 && return 0
  return 1
}

# wait_until <secs> <cmd...> — bounded deadline loop; 0 when cmd succeeds in time.
lv_wait_until() {
  local end=$((SECONDS + $1))
  shift
  while :; do
    if "$@"; then return 0; fi
    if [ "$SECONDS" -ge "$end" ]; then return 1; fi
    sleep 0.3
  done
}

# ---------------------------------------------------------------------------
# Cleanup. Idempotent and safe to call however far setup got: it only acts on
# whatever of LV_SERVER_PID/LV_TMUXDIR/LV_DIR is actually set, and only ever
# kills the pid it itself recorded (verified by command line) and only ever
# rm -rf's the exact expected path.
# ---------------------------------------------------------------------------
lv_cleanup() {
  if [ -n "${LV_SERVER_PID:-}" ] && kill -0 "$LV_SERVER_PID" 2> /dev/null; then
    local cmd
    cmd="$(ps -p "$LV_SERVER_PID" -o command= 2> /dev/null)"
    case "$cmd" in
      *node*index.ts*)
        kill "$LV_SERVER_PID" 2> /dev/null
        local tries=0
        while kill -0 "$LV_SERVER_PID" 2> /dev/null && [ "$tries" -lt 30 ]; do
          sleep 0.3
          tries=$((tries + 1))
        done
        kill -0 "$LV_SERVER_PID" 2> /dev/null && kill -9 "$LV_SERVER_PID" 2> /dev/null
        ;;
      *) info "refusing to kill pid $LV_SERVER_PID: it is not the recorded host-server ($cmd)" ;;
    esac
  fi
  if [ -n "${LV_TMUXDIR:-}" ] && command -v tmux > /dev/null 2>&1; then
    env -u TMUX TMUX_TMPDIR="$LV_TMUXDIR" tmux kill-server > /dev/null 2>&1 || true
  fi
  if [ -n "${LV_DIR:-}" ]; then
    case "$LV_DIR" in
      "$VERIFY_DIR"/live) rm -rf "$LV_DIR" ;;
      *) info "refusing to rm -rf unexpected path: $LV_DIR" ;;
    esac
  fi
}

lv_export_private_env() {
  unset TMUX TMUX_PANE CONDUCTOR_DB PORT
  export CONDUCTOR_CONF="$LV_CONF"
  export BACKEND_PORT="$LV_PORT"
  export HOST=127.0.0.1
  export TMUX_TMPDIR="$LV_TMUXDIR"
  # The host-server's default 100ms tmux timeout is tight on a loaded machine.
  export TMUX_SYNC_TIMEOUT_MS=2000
}

lv_write_conf() {
  mkdir -p "$LV_DIR/data" "$LV_STATE_DIR"
  {
    echo '# Private conductor.conf for verify-dev-commands.sh --live (TASK-0208). Safe to delete.'
    printf 'SESSION_NAME="%s"\n' "$LV_SESSION"
    cat << 'EOF'
CLAUDE_FLAGS=""
BG_PROCESSES=(
)
CLEAR_CMD="/clear"
IDLE_PATTERN="\\?[[:space:]]+for[[:space:]]+shortcuts|(accept edits|bypass permissions) on \\(shift\\+tab to cycle\\)"
BUSY_PATTERN="esc to interrupt"
AWAITING_PATTERN='(\?\s*$|\?\s+[A-Za-z]+(/[A-Za-z]+)+\s*$|\[Y/n\]|\[y/N\]|^\s*>\s*$|Enter to (select|confirm|submit)|Esc to (cancel|go back)|ctrl.g to edit|shift.tab to approve)'
POLL_INTERVAL=15
STALL_TIMEOUT=300
STATUS_POLL_MS=300
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
  } > "$LV_CONF"
}

lv_start_server() {
  ( cd "$REPO/host-server" && exec node --import tsx/esm index.ts ) >> "$LV_SERVER_LOG" 2>&1 &
  LV_SERVER_PID=$!
  disown "$LV_SERVER_PID" 2> /dev/null || true
}

# 0 ready, 1 timeout, 2 process died. Bounded (~60s).
lv_wait_server() {
  local end=$((SECONDS + 60))
  while :; do
    if curl -sf -m 2 -o /dev/null "$LV_BASE/api/status" 2> /dev/null; then return 0; fi
    if ! kill -0 "${LV_SERVER_PID:-}" 2> /dev/null; then return 2; fi
    if [ "$SECONDS" -ge "$end" ]; then return 1; fi
    sleep 0.5
  done
}

# ---------------------------------------------------------------------------
# API helper. Sets LV_API_CODE/LV_API_BODY. 4-branch dispatch (no bash arrays)
# to stay macOS bash-3.2-safe, matching the other verify scripts in this repo.
# ---------------------------------------------------------------------------
LV_API_CODE=""
LV_API_BODY=""
lv_api() { # METHOD PATH [JSON_BODY] [X-Conductor-Agent VALUE]
  local method="$1" path="$2" data="${3-}" hdrval="${4-}" out="$LV_DIR/api.body"
  : > "$out"
  if [ -n "$hdrval" ] && [ -n "$data" ]; then
    LV_API_CODE="$(curl -sS -m 30 -X "$method" -H "X-Conductor-Agent: $hdrval" -H 'Content-Type: application/json' --data "$data" -o "$out" -w '%{http_code}' "$LV_BASE$path" 2> /dev/null)" || LV_API_CODE=000
  elif [ -n "$hdrval" ]; then
    LV_API_CODE="$(curl -sS -m 30 -X "$method" -H "X-Conductor-Agent: $hdrval" -o "$out" -w '%{http_code}' "$LV_BASE$path" 2> /dev/null)" || LV_API_CODE=000
  elif [ -n "$data" ]; then
    LV_API_CODE="$(curl -sS -m 30 -X "$method" -H 'Content-Type: application/json' --data "$data" -o "$out" -w '%{http_code}' "$LV_BASE$path" 2> /dev/null)" || LV_API_CODE=000
  else
    LV_API_CODE="$(curl -sS -m 30 -X "$method" -o "$out" -w '%{http_code}' "$LV_BASE$path" 2> /dev/null)" || LV_API_CODE=000
  fi
  LV_API_BODY="$(cat "$out" 2> /dev/null)"
}
lv_jb() { printf '%s' "$LV_API_BODY" | jq -r "$@" 2> /dev/null; }
lv_is2xx() { case "$LV_API_CODE" in 2??) return 0 ;; esac; return 1; }

# ---------------------------------------------------------------------------
# dev-commands.sh client wrapper. Sets LV_DC_OUT/LV_DC_ERR/LV_DC_RC.
# CONDUCTOR_STATE_DIR/LOG_DIR point at the private world (dev-commands.sh
# FATALs without them, even though `restart` itself never reads them).
# ---------------------------------------------------------------------------
LV_DC_OUT=""
LV_DC_ERR=""
LV_DC_RC=0
lv_dc() { # agent_window_or_empty subcmd args...
  local agent="$1" errf="$LV_DIR/dc-stderr.txt"
  shift
  if [ -n "$agent" ]; then
    LV_DC_OUT="$(CONDUCTOR_AGENT_NAME="$agent" CONDUCTOR_STATE_DIR="$LV_STATE_DIR" CONDUCTOR_LOG_DIR="$LV_LOG_DIR" BACKEND_PORT="$LV_PORT" bash "$DEV_CMD" "$@" 2> "$errf")"
  else
    LV_DC_OUT="$(env -u CONDUCTOR_AGENT_NAME CONDUCTOR_STATE_DIR="$LV_STATE_DIR" CONDUCTOR_LOG_DIR="$LV_LOG_DIR" BACKEND_PORT="$LV_PORT" bash "$DEV_CMD" "$@" 2> "$errf")"
  fi
  LV_DC_RC=$?
  LV_DC_ERR="$(cat "$errf" 2> /dev/null)"
}

# ---------------------------------------------------------------------------
# Small log/audit readers over the private world's own files.
# ---------------------------------------------------------------------------
lv_marker_count() { grep -c -- '--- restart ' "$1" 2> /dev/null || true; }
lv_marker_line_no() { grep -n -- '--- restart ' "$1" 2> /dev/null | tail -n 1 | cut -d: -f1; }
lv_has_line_after() { # file lineno needle
  awk -v n="$2" -v s="$3" 'NR>n && index($0,s){found=1} END{exit found?0:1}' "$1" 2> /dev/null
}
lv_restarts_log() { printf '%s' "$LV_LOG_DIR/bg-restarts.jsonl"; }
lv_audit_count() { # outcome bg
  local f
  f="$(lv_restarts_log)"
  [ -f "$f" ] || { echo 0; return; }
  jq -c --arg o "$1" --arg bg "$2" 'select(.outcome==$o and .bg==$bg)' "$f" 2> /dev/null | wc -l | tr -d ' '
}
lv_audit_last_field() { # outcome bg field
  local f
  f="$(lv_restarts_log)"
  [ -f "$f" ] || return 1
  jq -r --arg o "$1" --arg bg "$2" --arg fld "$3" 'select(.outcome==$o and .bg==$bg) | .[$fld]' "$f" 2> /dev/null | tail -n 1
}

# ---------------------------------------------------------------------------
# Seeding helpers, all through the real API.
# ---------------------------------------------------------------------------
LV_PROJECT_ID=""
lv_create_project() { # name workdir
  mkdir -p "$2"
  local body
  body="$(jq -nc --arg n "$1" --arg w "$2" '{name:$n, workdir:$w}')"
  lv_api POST /api/projects "$body"
  LV_PROJECT_ID="$(lv_jb '.id // ""')"
}

LV_AGENT_WIN=""
lv_create_project_agent() { # projectId name launchCmd -> LV_AGENT_WIN
  local body
  body="$(jq -nc --arg n "$2" --arg c "$3" '{name:$n, launchCmd:$c}')"
  lv_api POST "/api/projects/$1/agents" "$body"
  LV_AGENT_WIN="$(lv_jb '.name // ""')"
  if [ -n "$LV_AGENT_WIN" ]; then
    local pn
    pn="$(lv_jb '.projectName // ""')"
    [ -n "$pn" ] && LV_AGENT_WIN="${pn}-${LV_AGENT_WIN}"
  fi
}

LV_BG_SLUG=""
lv_create_bg() { # name workdir launchCmd projectId -> LV_BG_SLUG
  mkdir -p "$2"
  local body
  body="$(jq -nc --arg n "$1" --arg w "$2" --arg c "$3" --argjson pid "$4" '{name:$n, workdir:$w, launchCmd:$c, projectId:$pid}')"
  lv_api POST /api/bg-processes "$body"
  LV_BG_SLUG="$(lv_jb '.bg.slug // ""')"
}

# ---------------------------------------------------------------------------
# Predicates for lv_wait_until.
# ---------------------------------------------------------------------------
lv_dc_status_has() { # agent name grep-E-pattern (not a literal needle, so
  # exact column spacing in dev-commands.sh's aligned output never matters)
  lv_dc "$1" status "$2"
  [ "$LV_DC_RC" -eq 0 ] && printf '%s' "$LV_DC_OUT" | grep -qE -- "$3"
}
lv_file_has() { # file needle
  [ -f "$1" ] && grep -qF -- "$2" "$1" 2> /dev/null
}
lv_status_lastrestart_caller_is() { # slug expected ("null" for dashboard/none)
  lv_api GET /api/status
  lv_is2xx || return 1
  local caller
  caller="$(printf '%s' "$LV_API_BODY" | jq -r --arg s "$1" '([.bgProcesses[]? | select(.slug==$s)][0].lastRestart.caller) // "null"' 2> /dev/null)"
  [ "$caller" = "$2" ]
}
lv_status_has_bg() { # slug — true once GET /api/status's cached snapshot
  # (populated by the server's own poll loop, not a live query) lists it.
  lv_api GET /api/status
  lv_is2xx || return 1
  printf '%s' "$LV_API_BODY" | jq -e --arg s "$1" '[.bgProcesses[]? | select(.slug==$s)] | length>0' > /dev/null 2>&1
}
lv_new_tick_after_marker() { # file
  local mline
  mline="$(lv_marker_line_no "$1")"
  [ -n "$mline" ] || return 1
  lv_has_line_after "$1" "$mline" tick
}

# ---------------------------------------------------------------------------
# Main entry point.
# ---------------------------------------------------------------------------
run_live_scenario() {
  LV_PORT="${VERIFY_LIVE_PORT:-18789}"
  LV_SESSION="${VERIFY_LIVE_SESSION:-verifydevcmds0208}"
  LV_DIR="$VERIFY_DIR/live"
  LV_CONF="$LV_DIR/conductor.conf"
  LV_TMUXDIR="$LV_DIR/tmux"
  LV_STATE_DIR="$LV_DIR/logs/state"
  LV_LOG_DIR="$LV_DIR/logs"
  LV_BASE="http://127.0.0.1:$LV_PORT"
  LV_SERVER_LOG="$LV_DIR/server.log"
  LV_SERVER_PID=""
  LV_ORIG_TMUX_TMPDIR="${TMUX_TMPDIR:-}"
  local REAL_PORT=8788
  local REAL_CONF="$REPO/conductor.conf"

  # --- Preflight: SKIPPED (exit 2), never a false failure --------------------
  local tool
  for tool in tmux node jq curl; do
    command -v "$tool" > /dev/null 2>&1 || { info "SKIPPED: required tool '$tool' is not on PATH"; return 2; }
  done
  [ -d "$REPO/host-server/node_modules" ] || { info "SKIPPED: host-server dependencies are not installed (run npm install in host-server/)"; return 2; }
  case "$REPO" in
    *[[:space:]]*) info "SKIPPED: repo path contains whitespace; host-server sources the conf path unquoted"; return 2 ;;
  esac

  # --- Refusals (exit 3): a belt-and-suspenders sanity check on this file's
  # own constants, never on anything the caller controls (the chosen port and
  # session name are this file's own LV_PORT/LV_SESSION defaults/env
  # overrides, and the scratch conf path is computed above) ------------------
  case "$LV_PORT" in
    '' | *[!0-9]*) info "REFUSED: the live port must be a number (got '$LV_PORT')"; return 3 ;;
  esac
  if [ "$LV_PORT" = "$REAL_PORT" ]; then
    info "REFUSED: the live port ($LV_PORT) is the real host-server port"
    return 3
  fi
  if [ "$LV_SESSION" = "conductor" ]; then
    info "REFUSED: the live SESSION_NAME must not be the real session name 'conductor'"
    return 3
  fi
  # The scratch conf this harness is about to write and export as
  # CONDUCTOR_CONF must never resolve to the repo's real conductor.conf.
  # $LV_DIR/live doesn't exist yet at this point (mkdir happens below), so
  # resolve VERIFY_DIR (which does exist) and append "live" as a string
  # rather than `cd`-ing into a path that isn't there yet.
  local live_conf_dir real_conf_dir
  live_conf_dir="$(cd "$VERIFY_DIR" 2> /dev/null && pwd -P)/live"
  real_conf_dir="$(cd "$(dirname "$REAL_CONF")" 2> /dev/null && pwd -P)"
  if [ "$live_conf_dir" = "/live" ] || [ -z "$real_conf_dir" ] || [ "$live_conf_dir/conductor.conf" = "$real_conf_dir/conductor.conf" ]; then
    info "REFUSED: the scratch CONDUCTOR_CONF path resolves to the real conductor.conf (or could not be resolved)"
    return 3
  fi
  # An inherited CONDUCTOR_CONF pointing at the real conf would also leak
  # through if the export below were ever skipped — guard the inherited value
  # too, even though lv_export_private_env is about to override it.
  if [ -n "${CONDUCTOR_CONF:-}" ]; then
    local inherited_dir
    inherited_dir="$(cd "$(dirname "${CONDUCTOR_CONF}")" 2> /dev/null && pwd -P)"
    if [ -n "$inherited_dir" ] && [ "$inherited_dir/$(basename "$CONDUCTOR_CONF")" = "$real_conf_dir/conductor.conf" ]; then
      info "REFUSED: the inherited CONDUCTOR_CONF resolves to the real conductor.conf; unset it and re-run"
      return 3
    fi
  fi

  if lv_port_busy "$LV_PORT"; then
    info "SKIPPED: port $LV_PORT is busy (set VERIFY_LIVE_PORT to a free port)"
    return 2
  fi
  local sock_path="$LV_TMUXDIR/tmux-$(id -u)/default"
  if [ "${#sock_path}" -gt 100 ]; then
    info "SKIPPED: private tmux socket path is ${#sock_path} chars (macOS limit ~104): $sock_path"
    return 2
  fi

  # --- Bring up the private world --------------------------------------------
  trap lv_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  rm -rf "$LV_DIR"
  mkdir -p "$LV_DIR" "$LV_TMUXDIR"
  lv_write_conf

  if ! lv_tmux -f /dev/null new-session -d -s "$LV_SESSION" -n keeper -c "$LV_DIR" 'sleep 86400'; then
    fail "live: could not start the private tmux server/session"
    return 0
  fi
  lv_tmux set-option -g default-command 'bash --norc --noprofile' > /dev/null 2>&1 || true

  lv_export_private_env
  lv_start_server
  if ! lv_wait_server; then
    fail "live: host-server did not answer GET /api/status in time"
    info "tail of $LV_SERVER_LOG:"
    tail -n 40 "$LV_SERVER_LOG" 2> /dev/null
    return 0
  fi
  pass "live: private host-server + tmux world is up (port $LV_PORT, session $LV_SESSION)"

  # --- Seed: two projects, one agent + one 'dev' bg process each -------------
  mkdir -p "$LV_DIR/work/alpha" "$LV_DIR/work/beta"
  local alpha_id="" beta_id="" alpha_win="" beta_win="" alpha_dev="" beta_dev=""
  local dev_launch='while true; do echo tick; sleep 2; done'

  lv_create_project alpha "$LV_DIR/work/alpha"; alpha_id="$LV_PROJECT_ID"
  lv_create_project beta "$LV_DIR/work/beta"; beta_id="$LV_PROJECT_ID"
  if [ -z "$alpha_id" ] || [ -z "$beta_id" ]; then
    fail "live: could not seed the alpha/beta projects"
    return 0
  fi

  lv_create_project_agent "$alpha_id" agent "sleep 3600"; alpha_win="$LV_AGENT_WIN"
  lv_create_project_agent "$beta_id" agent "sleep 3600"; beta_win="$LV_AGENT_WIN"
  if [ "$alpha_win" != "alpha-agent" ] || [ "$beta_win" != "beta-agent" ]; then
    fail "live: alpha/beta agent windows did not come up as expected (got '$alpha_win'/'$beta_win')"
    return 0
  fi

  lv_create_bg dev "$LV_DIR/work/alpha" "$dev_launch" "$alpha_id"; alpha_dev="$LV_BG_SLUG"
  lv_create_bg dev "$LV_DIR/work/beta" "$dev_launch" "$beta_id"; beta_dev="$LV_BG_SLUG"
  if [ "$alpha_dev" != "alpha-dev" ] || [ "$beta_dev" != "beta-dev" ]; then
    fail "live: alpha-dev/beta-dev bg processes did not come up as expected (got '$alpha_dev'/'$beta_dev')"
    return 0
  fi
  pass "live: seeded projects alpha/beta, agents $alpha_win/$beta_win, bg processes $alpha_dev/$beta_dev"

  local alpha_log="$LV_LOG_DIR/bg-$alpha_dev.log"
  local beta_log="$LV_LOG_DIR/bg-$beta_dev.log"

  # GET /api/status (which list/status/tail all read through) is served from
  # the server's own cached poll-and-diff snapshot, not a live query — give it
  # one poll tick (STATUS_POLL_MS=300 in the private conf) to pick up the bg
  # processes just created before relying on it below.
  lv_wait_until 10 lv_status_has_bg "$alpha_dev" || true
  lv_wait_until 10 lv_status_has_bg "$beta_dev" || true

  # --- Case (TASK-0202): list is scoped to the caller's project --------------
  lv_dc "$alpha_win" list
  if [ "$LV_DC_RC" -eq 0 ] && printf '%s' "$LV_DC_OUT" | grep -q "$alpha_dev" \
    && ! printf '%s' "$LV_DC_OUT" | grep -q "$beta_dev"; then
    pass "live: list (CONDUCTOR_AGENT_NAME=$alpha_win) shows only alpha's dev process"
  else
    fail "live: list scoped to alpha did not show only $alpha_dev (rc=$LV_DC_RC out=$LV_DC_OUT)"
  fi

  # --- Case (TASK-0202): list --all shows both projects -----------------------
  lv_dc "$alpha_win" list --all
  if [ "$LV_DC_RC" -eq 0 ] && printf '%s' "$LV_DC_OUT" | grep -q "$alpha_dev" \
    && printf '%s' "$LV_DC_OUT" | grep -q "$beta_dev"; then
    pass "live: list --all shows both alpha's and beta's dev processes"
  else
    fail "live: list --all did not show both $alpha_dev and $beta_dev (rc=$LV_DC_RC out=$LV_DC_OUT)"
  fi

  # --- Case (TASK-0190 quoting fix): a launchCmd with a double quote, $HOME
  # and a backtick runs literally — typed into the pane's own shell exactly as
  # written, not re-parsed through an intermediate shell layer. -------------
  local weird_launch='printf "Q=%s H=%s T=%s\n" "a\"b" "$HOME" "`echo tick-ok`"; sleep 3600'
  lv_create_bg weird "$LV_DIR/work/alpha" "$weird_launch" "$alpha_id"
  local weird_slug="$LV_BG_SLUG" weird_log=""
  if [ "$weird_slug" != "alpha-weird" ]; then
    fail "live: the quoting-fixture bg process did not come up as 'alpha-weird' (got '$weird_slug')"
  else
    weird_log="$LV_LOG_DIR/bg-$weird_slug.log"
    if lv_wait_until 10 lv_file_has "$weird_log" 'T=tick-ok'; then
      if grep -qF "Q=a\"b H=$HOME T=tick-ok" "$weird_log" 2> /dev/null; then
        pass "live: a launchCmd containing a double quote, \$HOME and a backtick ran literally in the pane"
      else
        fail "live: quoting fixture log did not contain the exact literal line (got: $(cat "$weird_log" 2> /dev/null))"
      fi
    else
      fail "live: quoting fixture bg process never produced its output within 10s"
    fi
  fi

  # --- Case (TASK-0191): kill alpha's dev process; status reports exited -----
  lv_tmux send-keys -t "$LV_SESSION:=$alpha_dev" C-c
  if lv_wait_until 15 lv_dc_status_has "$alpha_win" dev 'liveness:[[:space:]]+exited'; then
    pass "live: killing alpha's dev process makes status report liveness: exited"
  else
    fail "live: status for alpha's dev process never reported exited after kill (last: $LV_DC_OUT)"
  fi

  # --- Case (TASK-0192/0204): tail returns escape-free text -------------------
  lv_dc "$alpha_win" tail dev
  if [ "$LV_DC_RC" -eq 0 ] && printf '%s' "$LV_DC_OUT" | grep -q tick \
    && ! printf '%s' "$LV_DC_OUT" | grep -qF $'\x1b' \
    && ! printf '%s' "$LV_DC_OUT" | grep -qF $'\r'; then
    pass "live: tail dev (as alpha) returns escape-free text"
  else
    fail "live: tail dev (as alpha) was not clean escape-free text (rc=$LV_DC_RC out=$LV_DC_OUT)"
  fi

  # --- Case (TASK-0190/0203): agent-driven restart --------------------------
  lv_dc "$alpha_win" restart dev
  if [ "$LV_DC_RC" -eq 0 ]; then
    pass "live: restart dev (as alpha) exits 0"
  else
    fail "live: restart dev (as alpha) did not exit 0 (rc=$LV_DC_RC out=$LV_DC_OUT err=$LV_DC_ERR)"
  fi
  local markers_after_restart1
  markers_after_restart1="$(lv_marker_count "$alpha_log")"
  if [ "$markers_after_restart1" = "1" ]; then
    pass "live: $alpha_dev's log gained exactly one restart marker"
  else
    fail "live: $alpha_dev's log has $markers_after_restart1 restart marker(s), expected exactly 1"
  fi
  if lv_wait_until 10 lv_new_tick_after_marker "$alpha_log"; then
    pass "live: new output ('tick') follows the restart marker in $alpha_dev's log"
  else
    fail "live: no new output appeared after the restart marker in $alpha_dev's log within 10s"
  fi
  if lv_wait_until 15 lv_dc_status_has "$alpha_win" dev 'liveness:[[:space:]]+running'; then
    pass "live: status for $alpha_dev reports liveness: running after the restart"
  else
    fail "live: status for $alpha_dev never reported running after the restart"
  fi
  if [ "$(lv_audit_count restarted "$alpha_dev")" = "1" ]; then
    local caller_field
    caller_field="$(lv_audit_last_field restarted "$alpha_dev" caller)"
    if [ "$caller_field" = "$alpha_win" ]; then
      pass "live: bg-restarts.jsonl gained one outcome:restarted line for $alpha_dev naming $alpha_win"
    else
      fail "live: bg-restarts.jsonl restarted line for $alpha_dev named caller '$caller_field', expected '$alpha_win'"
    fi
  else
    fail "live: bg-restarts.jsonl does not have exactly one outcome:restarted line for $alpha_dev"
  fi

  # --- Case (TASK-0207): GET /api/status shows lastRestart with the caller --
  if lv_wait_until 15 lv_status_lastrestart_caller_is "$alpha_dev" "$alpha_win"; then
    pass "live: GET /api/status reports $alpha_dev's lastRestart.caller as $alpha_win"
  else
    fail "live: GET /api/status never reported $alpha_dev's lastRestart.caller as $alpha_win"
  fi

  # --- Case (TASK-0193): immediate second restart -> cooldown ----------------
  lv_dc "$alpha_win" restart dev
  if [ "$LV_DC_RC" -eq 5 ]; then
    pass "live: an immediate second restart dev (as alpha) exits 5 (cooldown)"
  else
    fail "live: an immediate second restart dev (as alpha) did not exit 5 (rc=$LV_DC_RC out=$LV_DC_OUT err=$LV_DC_ERR)"
  fi
  if [ "$(lv_marker_count "$alpha_log")" = "1" ]; then
    pass "live: the cooldown-skipped restart added no second marker to $alpha_dev's log"
  else
    fail "live: $alpha_dev's log marker count changed after the cooldown-skipped restart (now $(lv_marker_count "$alpha_log"))"
  fi
  if [ "$(lv_audit_count cooldown "$alpha_dev")" = "1" ]; then
    pass "live: bg-restarts.jsonl gained one outcome:cooldown line for $alpha_dev"
  else
    fail "live: bg-restarts.jsonl does not have exactly one outcome:cooldown line for $alpha_dev"
  fi

  # --- Case (TASK-0194): cross-project restart by slug -> denied -------------
  lv_dc "$alpha_win" restart "$beta_dev"
  if [ "$LV_DC_RC" -eq 3 ]; then
    pass "live: alpha restarting $beta_dev by slug exits 3 (refused)"
  else
    fail "live: alpha restarting $beta_dev by slug did not exit 3 (rc=$LV_DC_RC out=$LV_DC_OUT err=$LV_DC_ERR)"
  fi
  if [ "$(lv_marker_count "$beta_log")" = "0" ]; then
    pass "live: $beta_dev's log is untouched after the denied cross-project restart"
  else
    fail "live: $beta_dev's log gained a marker despite the restart being denied"
  fi
  if [ "$(lv_audit_count denied "$beta_dev")" = "1" ] && [ "$(lv_audit_last_field denied "$beta_dev" reason)" = "project-mismatch" ]; then
    pass "live: bg-restarts.jsonl gained one outcome:denied/project-mismatch line for $beta_dev"
  else
    fail "live: bg-restarts.jsonl does not have exactly one project-mismatch denial for $beta_dev"
  fi

  # --- Case (TASK-0194): an unknown X-Conductor-Agent header -> 403 ----------
  lv_api POST "/api/bg-processes/$alpha_dev/restart" "" "totally-unknown-caller-xyz"
  if [ "$LV_API_CODE" = 403 ]; then
    pass "live: an unknown X-Conductor-Agent header gets 403 on restart"
  else
    fail "live: an unknown X-Conductor-Agent header got HTTP $LV_API_CODE, expected 403 (body=$LV_API_BODY)"
  fi
  if [ "$(lv_marker_count "$alpha_log")" = "1" ]; then
    pass "live: the unknown-caller 403 added no marker to $alpha_dev's log"
  else
    fail "live: $alpha_dev's log marker count changed after the unknown-caller 403"
  fi

  # --- Case (TASK-0193): a header-less (dashboard) restart inside the agent
  # cooldown still succeeds and is audited callerKind:dashboard --------------
  lv_api POST "/api/bg-processes/$alpha_dev/restart"
  if lv_is2xx; then
    pass "live: a header-less (dashboard) restart of $alpha_dev succeeds inside the agent cooldown"
  else
    fail "live: a header-less restart of $alpha_dev did not succeed (HTTP $LV_API_CODE, body=$LV_API_BODY)"
  fi
  if [ "$(lv_marker_count "$alpha_log")" = "2" ]; then
    pass "live: the dashboard restart added its own (second) marker to $alpha_dev's log"
  else
    fail "live: $alpha_dev's log has $(lv_marker_count "$alpha_log") marker(s) after the dashboard restart, expected 2"
  fi
  if [ "$(lv_audit_count restarted "$alpha_dev")" = "2" ] && [ "$(lv_audit_last_field restarted "$alpha_dev" callerKind)" = "dashboard" ]; then
    pass "live: bg-restarts.jsonl's newest $alpha_dev restarted line is callerKind:dashboard"
  else
    fail "live: bg-restarts.jsonl does not show a second, dashboard-attributed restarted line for $alpha_dev"
  fi

  # --- Final safety check: nothing leaked onto the operator's real tmux ------
  if command -v tmux > /dev/null 2>&1; then
    local leaked
    leaked="$(lv_dtmux list-windows -a -F '#{session_name}:#{window_name}' 2> /dev/null | grep -E ":(alpha-agent|beta-agent|$alpha_dev|$beta_dev|$weird_slug)\$" || true)"
    if [ -z "$leaked" ]; then
      pass "live: no alpha/beta/weird fixture window exists on the operator's real (default-socket) tmux server"
    else
      fail "live: fixture windows leaked onto the real tmux server: $leaked"
    fi
  fi

  return 0
}
