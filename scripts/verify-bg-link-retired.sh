#!/usr/bin/env bash
# verify-bg-link-retired.sh — Runtime checks for TASK-0197 (bg-to-agent link retired).
#
# Two independent modes, each fully isolated from the operator's live conductor:
#
#   env  — runs the REAL scripts/conductor.sh and scripts/spawn.sh against a scratch
#          SQLite DB whose bg row still carries a populated legacy linked_agent_id,
#          with `tmux` replaced by a logging stub on PATH. Asserts no launch text
#          ever contains CONDUCTOR_BG_*, and that load_agents no longer defines
#          AGENT_BG. No tmux server (live or private) is touched.
#
#   api  — boots the REAL host-server from this working tree on a private port
#          (18797) with a scratch conductor.conf/DB and a PRIVATE tmux server
#          (TMUX_TMPDIR under ./tmp/), then drives POST/PATCH /api/bg-processes and
#          GET /api/status with stale `linkedAgent` / `linkedAgentId` fields. Asserts
#          they are ignored (nothing echoed, nothing persisted) and never appear in
#          the status payloads. The live :8788 server and the `conductor` tmux
#          session are never contacted.
#
# Usage: bash scripts/verify-bg-link-retired.sh [env|api|all]   (default: all)
# Artifacts land in ./tmp/verify-bg-link-retired/ (gitignored). Exit 0 = all PASS.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$REPO/tmp/verify-bg-link-retired"
MODE="${1:-all}"
TAG="[verify-bg-link-retired]"
FAILURES=0

pass() { echo "$TAG PASS: $1"; }
fail() { echo "$TAG FAIL: $1"; FAILURES=$((FAILURES + 1)); }

# --- env mode ---------------------------------------------------------------
phase_env() {
  local dir="$ROOT_DIR/env"
  rm -rf "$dir"
  mkdir -p "$dir/bin" "$dir/agent-wd/.git" "$dir/bg-wd"
  local db="$dir/conductor.db"

  sqlite3 "$db" "
CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, default_launch_cmd TEXT NOT NULL DEFAULT 'bash');
CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL);
CREATE TABLE bg_processes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, linked_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL, project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE);
INSERT INTO projects(id, name, workdir) VALUES (1, 'proj', '$dir/agent-wd');
INSERT INTO agents(id, name, workdir, launch_cmd, project_id) VALUES (1, 'agent1', '$dir/agent-wd', 'bash', 1);
INSERT INTO bg_processes(id, name, workdir, launch_cmd, linked_agent_id, project_id) VALUES (1, 'dev', '$dir/bg-wd', 'sleep 600', 1, 1);
"

  # Non-vacuity: the legacy link really is populated, so the pre-TASK-0197 code would have injected.
  if [[ "$(sqlite3 "$db" "SELECT linked_agent_id FROM bg_processes WHERE name='dev'")" == "1" ]]; then
    pass "env: fixture bg row carries a populated legacy linked_agent_id (check is non-vacuous)"
  else
    fail "env: fixture setup broken (linked_agent_id not populated)"
    return
  fi

  cat > "$dir/bin/tmux" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TMUX_STUB_LOG"
exit 0
STUB
  chmod +x "$dir/bin/tmux"

  local script log
  for script in conductor spawn; do
    log="$dir/$script.tmux.log"
    : > "$log"
    env -u TMUX PATH="$dir/bin:$PATH" TMUX_STUB_LOG="$log" CONDUCTOR_DB="$db" \
      CONDUCTOR_SESSION_NAME="t0197-stub" CONDUCTOR_NO_ATTACH=1 \
      bash "$REPO/scripts/$script.sh" > "$dir/$script.out" 2>&1
    local rc=$?
    if [[ $rc -ne 0 ]]; then
      fail "env: scripts/$script.sh exited $rc (see $dir/$script.out)"
      continue
    fi
    if grep -q "CONDUCTOR_AGENT_NAME=" "$log"; then
      pass "env: $script.sh launched the agent with CONDUCTOR_AGENT_NAME (positive control)"
    else
      fail "env: $script.sh never typed an agent launch line (see $log)"
    fi
    if grep -q "sleep 600" "$log"; then
      pass "env: $script.sh spawned the bg process"
    else
      fail "env: $script.sh never typed the bg launch command (see $log)"
    fi
    if grep -q "CONDUCTOR_BG_" "$log" "$dir/$script.out"; then
      fail "env: $script.sh output/launch text contains CONDUCTOR_BG_* (see $log)"
    else
      pass "env: $script.sh injects no CONDUCTOR_BG_* into any launch text"
    fi
  done

  local out
  out="$(CONDUCTOR_DB="$db" bash -c "
    source '$REPO/scripts/lib/db.sh'
    load_agents
    printf '%s|%s|%s\n' \"\${AGENT_NAMES[*]}\" \"\${AGENT_WINDOW_NAMES[agent1]}\" \"\${AGENT_PROJECT_IDS[agent1]}\"
    if declare -p AGENT_BG >/dev/null 2>&1; then echo HAS_AGENT_BG; else echo NO_AGENT_BG; fi
  " 2>&1)"
  if [[ "$out" == $'agent1|proj-agent1|1\nNO_AGENT_BG' ]]; then
    pass "env: load_agents still yields name/window/project and defines no AGENT_BG array"
  else
    fail "env: load_agents output unexpected: $out"
  fi
}

# --- api mode ---------------------------------------------------------------
API_PORT=18797
SERVER_PID=""
API_DIR="$ROOT_DIR/api"

api_cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  env -u TMUX TMUX_TMPDIR="$API_DIR/tmux" tmux kill-server 2>/dev/null || true
}

phase_api() {
  rm -rf "$API_DIR"
  mkdir -p "$API_DIR/tmux" "$API_DIR/wd"
  trap api_cleanup EXIT
  local base="http://127.0.0.1:$API_PORT/api"

  if curl -sS -o /dev/null --max-time 2 "$base/status" 2>/dev/null; then
    fail "api: port $API_PORT already answers — refusing to run against an unknown server"
    return
  fi

  # Scratch conf: the real tuning values, with every path/name overridden (later assignment wins).
  cp "$REPO/conductor.conf" "$API_DIR/conductor.conf"
  cat >> "$API_DIR/conductor.conf" <<CONF
SESSION_NAME="t0197-scratch"
DB_PATH="./conductor.db"
STATE_DIR="./state"
LOG_DIR="./logs"
CONF

  local tm=(env -u TMUX TMUX_TMPDIR="$API_DIR/tmux" tmux -f /dev/null)
  "${tm[@]}" new-session -d -s t0197-scratch -c "$API_DIR/wd" "sleep 900" || { fail "api: could not start private tmux session"; return; }

  # `exec` so $! is the node process itself (not a wrapper subshell that would survive the kill).
  ( cd "$REPO/host-server" || exit 1
    exec env -u TMUX TMUX_TMPDIR="$API_DIR/tmux" CONDUCTOR_CONF="$API_DIR/conductor.conf" \
      PORT="$API_PORT" HOST=127.0.0.1 node --import tsx/esm index.ts > "$API_DIR/server.log" 2>&1 ) &
  SERVER_PID=$!

  local i ready=0
  for i in $(seq 1 60); do
    if curl -sS -o /dev/null --max-time 2 "$base/status" 2>/dev/null; then ready=1; break; fi
    sleep 0.5
  done
  if [[ $ready -ne 1 ]]; then
    fail "api: private host-server did not come up on :$API_PORT (see $API_DIR/server.log)"
    return
  fi
  pass "api: private host-server (working tree) is up on :$API_PORT with a private tmux server"

  local db="$API_DIR/conductor.db"
  local pid
  pid="$(curl -sS -X POST "$base/projects" -H 'Content-Type: application/json' \
    -d "{\"name\":\"t0197-proj\",\"workdir\":\"$API_DIR/wd\"}" | jq -r '.id')"
  if ! [[ "$pid" =~ ^[0-9]+$ ]]; then fail "api: could not create scratch project (id='$pid')"; return; fi
  sqlite3 "$db" "INSERT INTO agents(name, workdir, launch_cmd, project_id) VALUES ('agent1', '$API_DIR/wd', 'bash', $pid)"
  local aid
  aid="$(sqlite3 "$db" "SELECT id FROM agents WHERE name='agent1'")"

  # linked_agent_id may already be dropped by TASK-0198; only assert NULL when it still exists.
  legacy_link() {
    if [[ "$(sqlite3 "$db" "SELECT COUNT(*) FROM pragma_table_info('bg_processes') WHERE name='linked_agent_id'")" == "0" ]]; then
      echo "NULL"
    else
      local v
      v="$(sqlite3 "$db" "SELECT COALESCE(CAST(linked_agent_id AS TEXT),'NULL') FROM bg_processes WHERE name='dev'")"
      echo "$v"
    fi
  }

  # 1. POST with stale link fields.
  local resp code
  resp="$(curl -sS -w '\n%{http_code}' -X POST "$base/bg-processes" -H 'Content-Type: application/json' \
    -d "{\"name\":\"dev\",\"workdir\":\"$API_DIR/wd\",\"launchCmd\":\"sleep 600\",\"projectId\":$pid,\"linkedAgent\":\"agent1\",\"linkedAgentId\":$aid}")"
  code="${resp##*$'\n'}"; resp="${resp%$'\n'*}"
  if [[ "$code" == "201" ]]; then pass "api: POST /bg-processes with stale linkedAgent/linkedAgentId -> 201"; else fail "api: POST returned $code: $resp"; fi
  if [[ "$(echo "$resp" | jq -r '.bg | has("linkedAgent") or has("linkedAgentId")')" == "false" ]]; then
    pass "api: POST 201 body does not echo any link field"
  else
    fail "api: POST 201 body echoes a link field: $resp"
  fi
  if [[ "$(legacy_link)" == "NULL" ]]; then pass "api: stale link from POST body was not persisted"; else fail "api: linked_agent_id persisted as '$(legacy_link)'"; fi

  # 2. Status payload carries no link fields on bg rows or agent rows.
  # /status serves the poll-loop snapshot; until the first tick lands it answers a bare
  # fallback with no bgProcesses. Wait (bounded) for the snapshot to include the new row.
  local status
  for i in $(seq 1 40); do
    status="$(curl -sS "$base/status")"
    [[ "$(echo "$status" | jq '.bgProcesses | length')" -gt 0 ]] && break
    sleep 0.5
  done
  if [[ "$(echo "$status" | jq '[.bgProcesses[] | select(.name=="dev")] | length')" == "1" ]]; then
    pass "api: /status lists the created bg process (positive control)"
  else
    fail "api: /status does not list the created bg process: $status"
  fi
  if [[ "$(echo "$status" | jq '[.bgProcesses[] | has("linkedAgent")] | any')" == "false" ]]; then
    pass "api: /status bgProcesses[] have no linkedAgent"
  else
    fail "api: /status bg rows still carry linkedAgent"
  fi
  if [[ "$(echo "$status" | jq '(.agents | length) > 0 and ([.agents[] | has("linkedBg")] | any | not)')" == "true" ]]; then
    pass "api: /status agents[] have no linkedBg (and at least one agent was checked)"
  else
    fail "api: /status agents[] carry linkedBg or none present"
  fi

  # 3. PATCH with stale linkedAgentId is ignored; the real field change still lands.
  local slug="t0197-proj-dev"
  resp="$(curl -sS -w '\n%{http_code}' -X PATCH "$base/bg-processes/$slug" -H 'Content-Type: application/json' \
    -d "{\"launchCmd\":\"sleep 601\",\"linkedAgentId\":$aid,\"linkedAgent\":\"agent1\"}")"
  code="${resp##*$'\n'}"; resp="${resp%$'\n'*}"
  if [[ "$code" == "200" ]]; then pass "api: PATCH with stale link fields -> 200"; else fail "api: PATCH returned $code: $resp"; fi
  if [[ "$(sqlite3 "$db" "SELECT launch_cmd FROM bg_processes WHERE name='dev'")" == "sleep 601" ]]; then
    pass "api: PATCH applied launchCmd (positive control)"
  else
    fail "api: PATCH did not apply launchCmd"
  fi
  if [[ "$(legacy_link)" == "NULL" ]]; then pass "api: stale link from PATCH body was not persisted"; else fail "api: linked_agent_id persisted as '$(legacy_link)' after PATCH"; fi
  if [[ "$(echo "$resp" | jq -r 'tostring | test("linkedAgent")')" == "false" ]]; then
    pass "api: PATCH response carries no link field"
  else
    fail "api: PATCH response carries a link field: $resp"
  fi
}

case "$MODE" in
  env) phase_env ;;
  api) phase_api ;;
  all) phase_env; phase_api ;;
  *) echo "usage: $0 [env|api|all]"; exit 2 ;;
esac

echo
if [[ $FAILURES -eq 0 ]]; then
  echo "$TAG PASS — bg-to-agent link is retired ($MODE)"
  exit 0
fi
echo "$TAG FAIL — $FAILURES check(s) failed ($MODE)"
exit 1
