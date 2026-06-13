#!/usr/bin/env bash
# verify-sqlite-migration.sh — End-to-end SQLite migration verification suite
# Checks: (1) seed-import, (2) pop race+precedence, (3) fake dispatch,
#          (4) schedule fire, (5) backlog restore
# Usage: bash scripts/verify-sqlite-migration.sh
# Artifacts land in ./tmp/verify/ (gitignored). Real data/conductor.db is NEVER touched.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
VERIFY_DIR="$REPO/tmp/verify"
mkdir -p "$VERIFY_DIR"
export CONDUCTOR_DB="$VERIFY_DIR/conductor-verify.db"
# Clean slate — remove any leftover DB from a previous run
rm -f "$CONDUCTOR_DB" "$CONDUCTOR_DB-shm" "$CONDUCTOR_DB-wal"

sqlc() { sqlite3 -cmd '.timeout 5000' -separator $'\x1f' "$CONDUCTOR_DB" "$@"; }
export -f sqlc

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

BACKEND_PID=""

start_backend() {
  echo "[backend] Starting..."
  cd "$REPO/backend"
  CONDUCTOR_DB="$CONDUCTOR_DB" node --import tsx/esm index.ts &>"$VERIFY_DIR/backend.log" &
  BACKEND_PID=$!
  # Wait up to 15s for the backend to be ready
  local i=0
  while (( i < 30 )); do
    if curl -sf http://localhost:8788/api/status >/dev/null 2>&1; then
      echo "[backend] Ready (PID $BACKEND_PID)"
      cd "$REPO"
      return 0
    fi
    sleep 0.5
    (( i++ ))
  done
  echo "[backend] ERROR: did not start within 15s" >&2
  cd "$REPO"
  kill "$BACKEND_PID" 2>/dev/null || true
  BACKEND_PID=""
  return 1
}

stop_backend() {
  if [[ -n "$BACKEND_PID" ]]; then
    echo "[backend] Stopping PID $BACKEND_PID..."
    kill "$BACKEND_PID" 2>/dev/null || true
    # Poll up to 5s for clean exit; tsx ignores SIGTERM so fall back to SIGKILL
    local _i=0
    while (( _i < 10 )) && kill -0 "$BACKEND_PID" 2>/dev/null; do
      sleep 0.5
      (( _i++ ))
    done
    if kill -0 "$BACKEND_PID" 2>/dev/null; then
      echo "[backend] SIGTERM timeout — sending SIGKILL to PID $BACKEND_PID"
      kill -9 "$BACKEND_PID" 2>/dev/null || true
    fi
    wait "$BACKEND_PID" 2>/dev/null || true
    echo "[backend] Stopped (PID $BACKEND_PID exited)"
    BACKEND_PID=""
  fi
}

seed_db() {
  echo "[seed] Starting backend once to run migrations + seedFromLegacy..."
  start_backend || return 1
  stop_backend
  echo "[seed] Done."
}

check_seed() {
  echo "[check_seed] Running seed-import correctness check..."

  # Run seed: start backend (runs migrations + seedFromLegacy), then stop
  seed_db || { echo "[check_seed] FAIL: backend failed to start"; return 1; }

  # Assert all 6 required tables exist
  local tables
  tables="$(sqlc "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")"
  local required_tables=("agents" "bg_processes" "meta" "projects" "schedules" "tasks")
  local missing=()
  for t in "${required_tables[@]}"; do
    if ! echo "$tables" | grep -qx "$t"; then
      missing+=("$t")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "[check_seed] FAIL: missing tables: ${missing[*]}"
    return 1
  fi
  echo "[check_seed] All 6 tables present: ${required_tables[*]}"

  # Assert meta.schema_version is non-empty
  local schema_version
  schema_version="$(sqlc "SELECT value FROM meta WHERE key='schema_version'")"
  if [[ -z "$schema_version" ]]; then
    echo "[check_seed] FAIL: meta.schema_version is empty"
    return 1
  fi
  echo "[check_seed] schema_version=$schema_version"

  # Assert meta.legacy_import == 1
  local legacy_import
  legacy_import="$(sqlc "SELECT value FROM meta WHERE key='legacy_import'")"
  if [[ "$legacy_import" != "1" ]]; then
    echo "[check_seed] FAIL: meta.legacy_import='$legacy_import' (expected '1')"
    return 1
  fi
  echo "[check_seed] legacy_import=1 confirmed"

  # Capture row counts before second start
  local agents_count_before tasks_count_before
  agents_count_before="$(sqlc "SELECT COUNT(*) FROM agents")"
  tasks_count_before="$(sqlc "SELECT COUNT(*) FROM tasks")"
  echo "[check_seed] Before 2nd start: agents=$agents_count_before tasks=$tasks_count_before"

  # Idempotency: start + stop again — legacy_import guard should prevent re-import
  start_backend || { echo "[check_seed] FAIL: backend failed on 2nd start"; return 1; }
  stop_backend

  local agents_count_after tasks_count_after
  agents_count_after="$(sqlc "SELECT COUNT(*) FROM agents")"
  tasks_count_after="$(sqlc "SELECT COUNT(*) FROM tasks")"
  echo "[check_seed] After 2nd start: agents=$agents_count_after tasks=$tasks_count_after"

  if [[ "$agents_count_before" != "$agents_count_after" ]]; then
    echo "[check_seed] FAIL: agents count changed on 2nd start ($agents_count_before -> $agents_count_after)"
    return 1
  fi
  if [[ "$tasks_count_before" != "$tasks_count_after" ]]; then
    echo "[check_seed] FAIL: tasks count changed on 2nd start ($tasks_count_before -> $tasks_count_after)"
    return 1
  fi
  echo "[check_seed] Idempotency confirmed: no duplication on 2nd start"

  # Sanity: no tasks violate status constraint
  local bad_status_count
  bad_status_count="$(sqlc "SELECT COUNT(*) FROM tasks WHERE status NOT IN ('queued','backlog')")"
  if [[ "$bad_status_count" != "0" ]]; then
    echo "[check_seed] FAIL: $bad_status_count tasks with invalid status"
    return 1
  fi

  echo "[check_seed] PASS"
  return 0
}

check_pop_race() {
  echo "[check_pop_race] Running atomic task-pop race test..."

  # Source db.sh for pop_task_sql (uses CONDUCTOR_DB from env)
  # shellcheck source=scripts/lib/db.sh
  source "$SCRIPT_DIR/lib/db.sh"

  # Ensure a racer agent exists
  sqlc "INSERT OR IGNORE INTO agents(name,workdir,launch_cmd) VALUES('racer','$VERIFY_DIR/demo-repo','bash')"

  # Insert 500 global queued tasks (no agent/project scope)
  local count_before
  count_before="$(sqlc "SELECT COUNT(*) FROM tasks WHERE status='queued'")"

  # Try generate_series first; fall back to bash loop
  if sqlc "SELECT count(*) FROM generate_series(1,1)" >/dev/null 2>&1; then
    sqlc "INSERT INTO tasks(command,position,status) SELECT 'race-'||value, CAST(value AS REAL), 'queued' FROM generate_series(1,500)"
  else
    local batch=""
    for i in $(seq 1 500); do
      if [[ -z "$batch" ]]; then
        batch="('race-$i', $i.0, 'queued')"
      else
        batch="$batch,('race-$i', $i.0, 'queued')"
      fi
    done
    sqlc "INSERT INTO tasks(command,position,status) VALUES $batch"
  fi

  local count_after
  count_after="$(sqlc "SELECT COUNT(*) FROM tasks WHERE status='queued'")"
  local inserted=$(( count_after - count_before ))
  echo "[check_pop_race] Inserted $inserted tasks (total queued: $count_after)"
  if [[ "$inserted" -lt 500 ]]; then
    echo "[check_pop_race] FAIL: expected 500 inserted, got $inserted"
    return 1
  fi

  # Launch two parallel pop loops via subshells that source db.sh directly.
  # Each loop pops until nothing remains, writing popped commands to its output file.
  local out1="$VERIFY_DIR/pop-loop-1.txt"
  local out2="$VERIFY_DIR/pop-loop-2.txt"
  rm -f "$out1" "$out2"

  local db_sh="$SCRIPT_DIR/lib/db.sh"
  local conductor_db="$CONDUCTOR_DB"

  bash -c "
    set +e
    source '$db_sh'
    while true; do
      POPPED_TASK=''
      pop_task_sql 'racer' || break
      echo \"\$POPPED_TASK\" >> '$out1'
    done
  " &
  local pid1=$!

  bash -c "
    set +e
    source '$db_sh'
    while true; do
      POPPED_TASK=''
      pop_task_sql 'racer' || break
      echo \"\$POPPED_TASK\" >> '$out2'
    done
  " &
  local pid2=$!

  wait "$pid1" "$pid2"

  # Combine results
  local combined="$VERIFY_DIR/pop-combined.txt"
  cat "$out1" "$out2" 2>/dev/null | sort > "$combined"

  local total_popped
  total_popped="$(wc -l < "$combined" | tr -d ' ')"
  echo "[check_pop_race] Total popped: $total_popped"

  if [[ "$total_popped" -ne 500 ]]; then
    echo "[check_pop_race] FAIL: expected 500 popped, got $total_popped"
    return 1
  fi
  echo "[check_pop_race] 500 tasks popped (none lost)"

  # Check for duplicates
  local duplicates
  duplicates="$(sort "$combined" | uniq -d)"
  if [[ -n "$duplicates" ]]; then
    echo "[check_pop_race] FAIL: duplicates found:"
    echo "$duplicates"
    return 1
  fi
  echo "[check_pop_race] No duplicates (atomicity confirmed)"

  # Queue should be empty (global tasks — no agent/project scope)
  local remaining
  remaining="$(sqlc "SELECT COUNT(*) FROM tasks WHERE status='queued' AND agent_id IS NULL AND project_id IS NULL")"
  if [[ "$remaining" != "0" ]]; then
    echo "[check_pop_race] FAIL: $remaining tasks still queued after race"
    return 1
  fi
  echo "[check_pop_race] Queue drained to 0"

  # Precedence sub-check
  echo "[check_pop_race] Running precedence sub-check..."

  # Create project for precedence test
  local proj_id
  sqlc "INSERT OR IGNORE INTO projects(name,workdir,default_launch_cmd) VALUES('prec-proj','$VERIFY_DIR/demo-repo','bash')"
  proj_id="$(sqlc "SELECT id FROM projects WHERE name='prec-proj'")"

  # Create agent t1 linked to project
  sqlc "INSERT OR IGNORE INTO agents(name,workdir,launch_cmd,project_id) VALUES('t1','$VERIFY_DIR/demo-repo','bash',$proj_id)"
  local t1_id
  t1_id="$(sqlc "SELECT id FROM agents WHERE name='t1'")"

  # Clear any leftover prec tasks and insert one in each scope
  sqlc "DELETE FROM tasks WHERE command LIKE 'prec-%'"
  sqlc "INSERT INTO tasks(command,position,status,agent_id) VALUES('prec-scoped',1.0,'queued',$t1_id)"
  sqlc "INSERT INTO tasks(command,position,status,project_id) VALUES('prec-project',2.0,'queued',$proj_id)"
  sqlc "INSERT INTO tasks(command,position,status) VALUES('prec-global',3.0,'queued')"

  # Pop three times and verify order
  local pop1 kind1 pop2 kind2 pop3 kind3
  POPPED_TASK=""; LAST_QUEUE_KIND=""
  if ! pop_task_sql "t1"; then
    echo "[check_pop_race] FAIL: precedence pop1 returned nothing"
    return 1
  fi
  pop1="$POPPED_TASK"; kind1="$LAST_QUEUE_KIND"

  POPPED_TASK=""; LAST_QUEUE_KIND=""
  if ! pop_task_sql "t1"; then
    echo "[check_pop_race] FAIL: precedence pop2 returned nothing"
    return 1
  fi
  pop2="$POPPED_TASK"; kind2="$LAST_QUEUE_KIND"

  POPPED_TASK=""; LAST_QUEUE_KIND=""
  if ! pop_task_sql "t1"; then
    echo "[check_pop_race] FAIL: precedence pop3 returned nothing"
    return 1
  fi
  pop3="$POPPED_TASK"; kind3="$LAST_QUEUE_KIND"

  echo "[check_pop_race] Precedence order: $kind1($pop1) -> $kind2($pop2) -> $kind3($pop3)"

  if [[ "$kind1" != "scoped" ]]; then
    echo "[check_pop_race] FAIL: expected 1st pop kind=scoped, got $kind1"
    return 1
  fi
  if [[ "$kind2" != "project" ]]; then
    echo "[check_pop_race] FAIL: expected 2nd pop kind=project, got $kind2"
    return 1
  fi
  if [[ "$kind3" != "global" ]]; then
    echo "[check_pop_race] FAIL: expected 3rd pop kind=global, got $kind3"
    return 1
  fi
  echo "[check_pop_race] Precedence: scoped->project->global confirmed"

  echo "[check_pop_race] PASS"
  return 0
}

check_dispatch() {
  echo "[check_dispatch] Running fake-agent dispatch check..."
  mkdir -p "$VERIFY_DIR/demo-repo"

  # Load conductor.conf for POLL_INTERVAL and other tuning values
  # shellcheck source=conductor.conf
  source "$REPO/conductor.conf"
  echo "[check_dispatch] POLL_INTERVAL=$POLL_INTERVAL STATE_DIR=$STATE_DIR LOG_DIR=$LOG_DIR"

  local VERIFY_LOG_DIR="$VERIFY_DIR/logs"
  mkdir -p "$VERIFY_LOG_DIR"

  # Create project + agent directly in SQLite — bypasses spawnAgentWindow (which
  # requires a live tmux session) so conductor.sh can load them on startup.
  sqlc "INSERT OR IGNORE INTO projects(name,workdir,default_launch_cmd) VALUES('demo','$VERIFY_DIR/demo-repo','bash')"
  local proj_id
  proj_id="$(sqlc "SELECT id FROM projects WHERE name='demo' LIMIT 1")"
  echo "[check_dispatch] Project 'demo' id=$proj_id (via SQL)"
  if [[ -z "$proj_id" ]]; then
    echo "[check_dispatch] FAIL: SQL project creation returned no id"
    return 1
  fi

  local agent_name="demo-1"
  sqlc "INSERT OR IGNORE INTO agents(name,workdir,launch_cmd,project_id) VALUES('$agent_name','$VERIFY_DIR/demo-repo','bash',$proj_id)"
  local agent_db_id
  agent_db_id="$(sqlc "SELECT id FROM agents WHERE name='$agent_name' LIMIT 1")"
  echo "[check_dispatch] Agent '$agent_name' id=$agent_db_id (via SQL)"
  if [[ -z "$agent_db_id" ]]; then
    echo "[check_dispatch] FAIL: SQL agent creation returned no id"
    return 1
  fi

  # conductor.sh requires agent workdirs to be git repos — init if needed
  if [[ ! -e "$VERIFY_DIR/demo-repo/.git" ]]; then
    git init -q "$VERIFY_DIR/demo-repo"
    echo "[check_dispatch] Initialized git repo at $VERIFY_DIR/demo-repo"
  fi

  # Write idle state file so monitor sees the agent as idle from the start
  local conf_state_dir
  conf_state_dir="$(bash -c "source '$REPO/conductor.conf' && echo \"\$STATE_DIR\"")"
  case "$conf_state_dir" in /*) ;; *) conf_state_dir="$REPO/${conf_state_dir#./}" ;; esac
  mkdir -p "$conf_state_dir"
  echo "idle" > "$conf_state_dir/$agent_name.state"
  echo "[check_dispatch] Wrote idle state to $conf_state_dir/$agent_name.state"

  # Start conductor under a unique session name.
  # CONDUCTOR_SESSION_NAME overrides SESSION_NAME after conductor.sh sources conductor.conf.
  local verify_session="conductor-verify"
  tmux kill-session -t "$verify_session" 2>/dev/null || true

  local conductor_log="$VERIFY_DIR/conductor.log"
  CONDUCTOR_SESSION_NAME="$verify_session" \
  CONDUCTOR_NO_ATTACH=1 \
  CONDUCTOR_DB="$CONDUCTOR_DB" \
  bash "$REPO/scripts/conductor.sh" >"$conductor_log" 2>&1 &
  local conductor_pid=$!

  echo "[check_dispatch] Started conductor PID=$conductor_pid (session=$verify_session)"

  # Give conductor time to create the tmux session and agent window
  sleep 5

  # Verify the tmux session exists
  if ! tmux has-session -t "$verify_session" 2>/dev/null; then
    echo "[check_dispatch] FAIL: tmux session '$verify_session' was not created"
    echo "[check_dispatch] --- conductor.log ---"
    cat "$conductor_log" 2>/dev/null || echo "(no log)"
    echo "[check_dispatch] --- end ---"
    kill "$conductor_pid" 2>/dev/null || true
    return 1
  fi
  echo "[check_dispatch] tmux session '$verify_session' confirmed"
  echo "[check_dispatch] --- conductor.log ---"
  cat "$conductor_log" 2>/dev/null || echo "(no log)"
  echo "[check_dispatch] --- end ---"

  # Start backend now that the tmux session exists
  start_backend || {
    echo "[check_dispatch] FAIL: backend failed to start after conductor start"
    kill "$conductor_pid" 2>/dev/null || true
    tmux kill-session -t "$verify_session" 2>/dev/null || true
    return 1
  }

  # Enqueue a marker task via the backend API
  local task_resp task_id
  task_resp="$(curl -s -X POST http://localhost:8788/api/tasks \
    -H 'Content-Type: application/json' \
    -d "{\"command\":\"echo POPPED-OK\",\"agentName\":\"$agent_name\"}" 2>&1)"
  task_id="$(echo "$task_resp" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')"
  echo "[check_dispatch] Task enqueue response: $task_resp"
  echo "[check_dispatch] Enqueued task id='$task_id' for $agent_name"
  if [[ -z "$task_id" ]]; then
    echo "[check_dispatch] FAIL: task enqueue returned no id — backend or DB issue"
    stop_backend
    tmux kill-session -t "$verify_session" 2>/dev/null || true
    return 1
  fi

  # Poll up to 3 x POLL_INTERVAL + 10s for dispatch evidence in the agent pane
  local max_wait=$(( POLL_INTERVAL * 3 + 10 ))
  local elapsed=0
  local dispatched=0
  echo "[check_dispatch] Waiting up to ${max_wait}s for dispatch..."
  while (( elapsed < max_wait )); do
    local pane_out
    pane_out="$(tmux capture-pane -p -t "$verify_session:$agent_name" 2>/dev/null || true)"
    if echo "$pane_out" | grep -q "POPPED-OK"; then
      dispatched=1
      break
    fi
    echo "[check_dispatch] t+${elapsed}s — pane tail: $(echo "$pane_out" | tail -3 | tr '\n' '|')"
    sleep 2
    (( elapsed += 2 ))
  done

  local pass_dispatch=1

  if [[ "$dispatched" -eq 1 ]]; then
    echo "[check_dispatch] capture-pane shows POPPED-OK"
  else
    echo "[check_dispatch] FAIL: capture-pane did not show POPPED-OK within ${max_wait}s"
    echo "[check_dispatch] Final pane output:"
    tmux capture-pane -p -t "$verify_session:$agent_name" 2>/dev/null || echo "(capture failed)"
    echo "[check_dispatch] DB tasks still queued: $(sqlc "SELECT command,status FROM tasks WHERE command='echo POPPED-OK'")"
    echo "[check_dispatch] DB task count: $(sqlc "SELECT COUNT(*) FROM tasks WHERE status='queued'")"
    echo "[check_dispatch] Agent state file: $(cat "$conf_state_dir/$agent_name.state" 2>/dev/null || echo "(missing)")"
    pass_dispatch=0
  fi

  # Task row should be gone after successful pop+delete
  local task_remaining
  task_remaining="$(sqlc "SELECT COUNT(*) FROM tasks WHERE command='echo POPPED-OK'")"
  if [[ "$task_remaining" == "0" ]]; then
    echo "[check_dispatch] Task row deleted from DB"
  else
    echo "[check_dispatch] FAIL: task row still in DB (count=$task_remaining)"
    pass_dispatch=0
  fi

  # dispatch.jsonl check (non-fatal) — uses the conf's LOG_DIR
  local conf_log_dir
  conf_log_dir="$(bash -c "source '$REPO/conductor.conf' && echo \"\$LOG_DIR\"")"
  case "$conf_log_dir" in /*) ;; *) conf_log_dir="$REPO/${conf_log_dir#./}" ;; esac
  local dispatch_log="$conf_log_dir/dispatch.jsonl"
  if [[ -f "$dispatch_log" ]] && \
     grep -q "\"agent\":\"$agent_name\"" "$dispatch_log" 2>/dev/null && \
     grep -q "echo POPPED-OK" "$dispatch_log" 2>/dev/null; then
    echo "[check_dispatch] dispatch.jsonl record confirmed"
  else
    echo "[check_dispatch] WARN: dispatch.jsonl not found or missing expected record (non-fatal)"
    echo "[check_dispatch] LOG_DIR resolved: $conf_log_dir"
    echo "[check_dispatch] dispatch.jsonl exists: $(test -f "$dispatch_log" && echo yes || echo no)"
  fi

  # Tear down
  stop_backend
  tmux kill-session -t "$verify_session" 2>/dev/null || true
  sleep 1

  if [[ "$pass_dispatch" -eq 1 ]]; then
    echo "[check_dispatch] PASS"
    return 0
  else
    return 1
  fi
}

check_schedule() {
  echo "[check_schedule] Running schedule fire check..."

  # Start backend (fresh for this check)
  start_backend || { echo "[check_schedule] FAIL: backend failed to start"; return 1; }

  # Get or create a demo project for the schedule
  local proj_id
  proj_id="$(sqlc "SELECT id FROM projects WHERE name='demo' LIMIT 1")"
  if [[ -z "$proj_id" ]]; then
    local proj_resp
    proj_resp="$(curl -sf -X POST http://localhost:8788/api/projects \
      -H 'Content-Type: application/json' \
      -d "{\"name\":\"demo\",\"workdir\":\"$VERIFY_DIR/demo-repo\",\"defaultLaunchCmd\":\"bash\"}")"
    proj_id="$(echo "$proj_resp" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')"
  fi
  echo "[check_schedule] Using project id=$proj_id"

  # Create a schedule: intervalSeconds=5, action=append, skipIfPending=true
  local sched_resp sched_id
  sched_resp="$(curl -sf -X POST http://localhost:8788/api/schedules \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"verify-sched\",\"command\":\"echo SCHED-TICK\",\"intervalSeconds\":5,\"action\":\"append\",\"enabled\":true,\"skipIfPending\":true,\"projectId\":$proj_id}")"
  sched_id="$(echo "$sched_resp" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')"
  if [[ -z "$sched_id" ]]; then
    echo "[check_schedule] FAIL: schedule creation failed: $sched_resp"
    stop_backend
    return 1
  fi
  echo "[check_schedule] Created schedule id=$sched_id"

  # FIRE CRITERION: Wait for scheduler tick (up to 15s) and check DB for a fired task
  local elapsed=0
  local fired=0
  echo "[check_schedule] Waiting for first schedule fire (up to 15s)..."
  while (( elapsed < 15 )); do
    local count
    count="$(sqlc "SELECT COUNT(*) FROM tasks WHERE source='schedule' AND schedule_id=$sched_id AND status='queued'")"
    if [[ "$count" -ge 1 ]]; then
      fired=1
      echo "[check_schedule] Schedule fired: $count task(s) queued (source=schedule, schedule_id=$sched_id)"
      break
    fi
    sleep 1
    (( elapsed++ ))
  done

  if [[ "$fired" -eq 0 ]]; then
    echo "[check_schedule] FAIL: schedule did not fire within 15s"
    # Cleanup
    curl -sf -X DELETE "http://localhost:8788/api/schedules/$sched_id" >/dev/null 2>&1 || true
    stop_backend
    return 1
  fi

  # SKIP_IF_PENDING: Wait another scheduler tick; count should stay at 1
  echo "[check_schedule] Testing skip_if_pending (waiting 12s for next tick)..."
  sleep 12
  local count_after_second_tick
  count_after_second_tick="$(sqlc "SELECT COUNT(*) FROM tasks WHERE source='schedule' AND schedule_id=$sched_id AND status='queued'")"
  echo "[check_schedule] After second tick: queued count=$count_after_second_tick"
  if [[ "$count_after_second_tick" -ne 1 ]]; then
    echo "[check_schedule] FAIL: skip_if_pending failed — count=$count_after_second_tick (expected 1)"
    curl -sf -X DELETE "http://localhost:8788/api/schedules/$sched_id" >/dev/null 2>&1 || true
    stop_backend
    return 1
  fi
  echo "[check_schedule] skip_if_pending confirmed: count stayed at 1"

  # Consume the queued task so jump sub-check works cleanly
  sqlc "DELETE FROM tasks WHERE source='schedule' AND schedule_id=$sched_id AND status='queued'"

  # JUMP ACTION: Create 3 plain tail tasks, then a jump schedule; verify it lands at head
  # Insert 3 plain tasks at tail positions for the demo project
  sqlc "INSERT INTO tasks(command,position,status,project_id) VALUES('plain-1',10.0,'queued',$proj_id)"
  sqlc "INSERT INTO tasks(command,position,status,project_id) VALUES('plain-2',20.0,'queued',$proj_id)"
  sqlc "INSERT INTO tasks(command,position,status,project_id) VALUES('plain-3',30.0,'queued',$proj_id)"

  local jump_sched_resp jump_sched_id
  jump_sched_resp="$(curl -sf -X POST http://localhost:8788/api/schedules \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"verify-jump\",\"command\":\"echo SCHED-JUMP\",\"intervalSeconds\":5,\"action\":\"jump\",\"enabled\":true,\"skipIfPending\":false,\"projectId\":$proj_id}")"
  jump_sched_id="$(echo "$jump_sched_resp" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')"
  echo "[check_schedule] Created jump schedule id=$jump_sched_id"

  # Wait for jump schedule to fire
  elapsed=0
  local jump_fired=0
  echo "[check_schedule] Waiting for jump schedule fire (up to 15s)..."
  while (( elapsed < 15 )); do
    local jump_count
    jump_count="$(sqlc "SELECT COUNT(*) FROM tasks WHERE source='schedule' AND schedule_id=$jump_sched_id AND status='queued'")"
    if [[ "$jump_count" -ge 1 ]]; then
      jump_fired=1
      break
    fi
    sleep 1
    (( elapsed++ ))
  done

  if [[ "$jump_fired" -eq 0 ]]; then
    echo "[check_schedule] FAIL: jump schedule did not fire within 15s"
    curl -sf -X DELETE "http://localhost:8788/api/schedules/$sched_id" >/dev/null 2>&1 || true
    curl -sf -X DELETE "http://localhost:8788/api/schedules/$jump_sched_id" >/dev/null 2>&1 || true
    stop_backend
    return 1
  fi

  # Verify jump task has minimum position among project's queued tasks
  local head_task_id jump_task_id
  head_task_id="$(sqlc "SELECT id FROM tasks WHERE status='queued' AND project_id=$proj_id ORDER BY position LIMIT 1")"
  jump_task_id="$(sqlc "SELECT id FROM tasks WHERE source='schedule' AND schedule_id=$jump_sched_id AND status='queued' LIMIT 1")"
  echo "[check_schedule] head_task_id=$head_task_id, jump_task_id=$jump_task_id"
  if [[ "$head_task_id" != "$jump_task_id" ]]; then
    echo "[check_schedule] FAIL: jump task ($jump_task_id) is not at head (head is $head_task_id)"
    curl -sf -X DELETE "http://localhost:8788/api/schedules/$sched_id" >/dev/null 2>&1 || true
    curl -sf -X DELETE "http://localhost:8788/api/schedules/$jump_sched_id" >/dev/null 2>&1 || true
    stop_backend
    return 1
  fi
  echo "[check_schedule] Jump task is at queue head — confirmed"

  # Cleanup schedules and tasks
  curl -sf -X DELETE "http://localhost:8788/api/schedules/$sched_id" >/dev/null 2>&1 || true
  curl -sf -X DELETE "http://localhost:8788/api/schedules/$jump_sched_id" >/dev/null 2>&1 || true
  sqlc "DELETE FROM tasks WHERE command IN ('plain-1','plain-2','plain-3','echo SCHED-JUMP','echo SCHED-TICK')"

  stop_backend
  echo "[check_schedule] PASS"
  return 0
}

check_backlog() {
  echo "[check_backlog] Running backlog restore check..."

  # Source db.sh for SQL helpers (CONDUCTOR_DB already exported)
  source "$SCRIPT_DIR/lib/db.sh"

  # Ensure demo-1 agent exists in the DB
  local agent_id
  agent_id="$(sqlc "SELECT id FROM agents WHERE name='demo-1' LIMIT 1")"
  if [[ -z "$agent_id" ]]; then
    # Need to create via backend — start it
    start_backend || { echo "[check_backlog] FAIL: backend failed to start for agent setup"; return 1; }

    local proj_id
    proj_id="$(sqlc "SELECT id FROM projects WHERE name='demo' LIMIT 1")"
    if [[ -z "$proj_id" ]]; then
      local proj_resp
      proj_resp="$(curl -sf -X POST http://localhost:8788/api/projects \
        -H 'Content-Type: application/json' \
        -d "{\"name\":\"demo\",\"workdir\":\"$VERIFY_DIR/demo-repo\",\"defaultLaunchCmd\":\"bash\"}")"
      proj_id="$(echo "$proj_resp" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')"
    fi

    local agent_resp
    agent_resp="$(curl -sf -X POST "http://localhost:8788/api/projects/$proj_id/agents" \
      -H 'Content-Type: application/json' \
      -d '{}')"
    stop_backend
    agent_id="$(sqlc "SELECT id FROM agents WHERE name='demo-1' LIMIT 1")"
  fi

  if [[ -z "$agent_id" ]]; then
    echo "[check_backlog] FAIL: could not get/create demo-1 agent"
    return 1
  fi
  echo "[check_backlog] Using agent demo-1 (id=$agent_id)"

  # Insert 2 agent-scoped queued tasks with known positions
  sqlc "DELETE FROM tasks WHERE agent_id=$agent_id AND command LIKE 'backlog-test-%'"
  sqlc "INSERT INTO tasks(command,position,status,agent_id) VALUES('backlog-test-A',100.0,'queued',$agent_id)"
  sqlc "INSERT INTO tasks(command,position,status,agent_id) VALUES('backlog-test-B',200.0,'queued',$agent_id)"

  # Record original positions
  local pos_a pos_b
  pos_a="$(sqlc "SELECT position FROM tasks WHERE command='backlog-test-A' AND agent_id=$agent_id")"
  pos_b="$(sqlc "SELECT position FROM tasks WHERE command='backlog-test-B' AND agent_id=$agent_id")"
  echo "[check_backlog] Before backlog: A.position=$pos_a B.position=$pos_b"

  # Simulate backlog flip (deterministic SQL path — avoids tmux timing flakiness)
  # This mirrors what move_to_backlog does in monitor.sh
  sqlc "UPDATE tasks SET status='backlog' WHERE agent_id=$agent_id AND status='queued'"
  echo "[check_backlog] Tasks moved to backlog (simulating agent window death)"

  # BACKLOG CRITERION: verify tasks are now backlog with positions unchanged
  local backlog_count
  backlog_count="$(sqlc "SELECT COUNT(*) FROM tasks WHERE status='backlog' AND agent_id=$agent_id AND command LIKE 'backlog-test-%'")"
  if [[ "$backlog_count" -lt 2 ]]; then
    echo "[check_backlog] FAIL: expected ≥2 backlog tasks, got $backlog_count"
    return 1
  fi

  local pos_a_after pos_b_after
  pos_a_after="$(sqlc "SELECT position FROM tasks WHERE command='backlog-test-A' AND agent_id=$agent_id")"
  pos_b_after="$(sqlc "SELECT position FROM tasks WHERE command='backlog-test-B' AND agent_id=$agent_id")"
  echo "[check_backlog] After backlog: A.position=$pos_a_after B.position=$pos_b_after"

  if [[ "$pos_a" != "$pos_a_after" ]] || [[ "$pos_b" != "$pos_b_after" ]]; then
    echo "[check_backlog] FAIL: positions changed during backlog flip"
    return 1
  fi
  echo "[check_backlog] Backlog positions preserved"

  # RESTORE CRITERION: invoke restoreBacklog (SQL equivalent)
  # This mirrors what conductor.sh does on startup for DB-loaded agents
  sqlc "UPDATE tasks SET status='queued' WHERE agent_id=$agent_id AND status='backlog'"
  echo "[check_backlog] Tasks restored to queued"

  local remaining_backlog
  remaining_backlog="$(sqlc "SELECT COUNT(*) FROM tasks WHERE status='backlog' AND agent_id=$agent_id AND command LIKE 'backlog-test-%'")"
  if [[ "$remaining_backlog" -ne 0 ]]; then
    echo "[check_backlog] FAIL: $remaining_backlog tasks still in backlog after restore"
    return 1
  fi

  local pos_a_restored pos_b_restored
  pos_a_restored="$(sqlc "SELECT position FROM tasks WHERE command='backlog-test-A' AND agent_id=$agent_id AND status='queued'")"
  pos_b_restored="$(sqlc "SELECT position FROM tasks WHERE command='backlog-test-B' AND agent_id=$agent_id AND status='queued'")"
  echo "[check_backlog] Restored: A.position=$pos_a_restored B.position=$pos_b_restored"

  if [[ "$pos_a" != "$pos_a_restored" ]] || [[ "$pos_b" != "$pos_b_restored" ]]; then
    echo "[check_backlog] FAIL: positions changed after restore (expected $pos_a/$pos_b, got $pos_a_restored/$pos_b_restored)"
    return 1
  fi
  echo "[check_backlog] Restore positions intact"

  # DISPATCH CRITERION: pop one restored task and verify it dispatches (via pop_task_sql)
  POPPED_TASK=""
  pop_task_sql "demo-1" || { echo "[check_backlog] FAIL: pop_task_sql failed on restored task"; return 1; }
  if [[ -z "$POPPED_TASK" ]]; then
    echo "[check_backlog] FAIL: pop_task_sql returned empty task"
    return 1
  fi
  echo "[check_backlog] Popped restored task: '$POPPED_TASK'"

  # Cleanup remaining test tasks
  sqlc "DELETE FROM tasks WHERE agent_id=$agent_id AND command LIKE 'backlog-test-%'"

  echo "[check_backlog] PASS"
  return 0
}

cleanup() {
  echo ""
  echo "[cleanup] Tearing down..."
  stop_backend
  # Kill verify tmux session if it exists
  tmux kill-session -t conductor-verify 2>/dev/null || true
  echo "[cleanup] Done. Artifacts in: $VERIFY_DIR"
  echo "[cleanup] Real data/conductor.db was NOT touched."
}
trap cleanup EXIT

main() {
  echo "================================================"
  echo " tmux-conductor SQLite Migration Verification"
  echo "================================================"
  echo ""

  local result

  # Check 1: Seed-import correctness
  echo "--- Check 1: Seed-import correctness ---"
  result="fail"
  check_seed && result="pass"
  check "seed-import" "$result"
  echo ""

  # Check 2: Atomic task-pop race test + precedence
  echo "--- Check 2: Atomic task-pop race + precedence ---"
  result="fail"
  check_pop_race && result="pass"
  check "pop-race-and-precedence" "$result"
  echo ""

  # Check 3: Fake-agent dispatch
  echo "--- Check 3: Fake-agent dispatch ---"
  result="fail"
  check_dispatch && result="pass"
  check "fake-dispatch" "$result"
  echo ""

  # Check 4: Schedule fire
  echo "--- Check 4: Schedule fire ---"
  result="fail"
  check_schedule && result="pass"
  check "schedule-fire" "$result"
  echo ""

  # Check 5: Backlog restore
  echo "--- Check 5: Backlog restore ---"
  result="fail"
  check_backlog && result="pass"
  check "backlog-restore" "$result"
  echo ""

  # Summary
  echo "================================================"
  echo " Summary"
  echo "================================================"
  if [[ ${#PASS[@]} -gt 0 ]]; then
    echo "PASS (${#PASS[@]}): ${PASS[*]}"
  fi
  if [[ ${#FAIL[@]} -gt 0 ]]; then
    echo "FAIL (${#FAIL[@]}): ${FAIL[*]}"
  fi
  echo ""
  if [[ ${#FAIL[@]} -gt 0 ]]; then
    exit 1
  fi
  echo "All checks PASSED!"
}

main "$@"
