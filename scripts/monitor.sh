#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Shared SQLite helper library: defines sql/sql_one, load_agents, load_bg,
# pop_task_sql, and resolves CONDUCTOR_DB. db.sh sources conductor.conf only in
# a subshell (to extract DB_PATH), so it does NOT export conf vars into this
# scope — the explicit conf source below is still required for POLL_INTERVAL,
# LOG_DIR, STATE_DIR, AGENTS, BG_PROCESSES, etc.
source "$SCRIPT_DIR/lib/db.sh"
source "$SCRIPT_DIR/../conductor.conf"

# Conf-relative paths (./logs, ./logs/state) resolve against the conf file's
# directory (the repo root), never the caller's cwd. The task queue store is the
# SQLite DB ($CONDUCTOR_DB), resolved by db.sh.
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
case "$LOG_DIR"    in /*) ;; *) LOG_DIR="$REPO_ROOT/${LOG_DIR#./}" ;; esac
case "$STATE_DIR"  in /*) ;; *) STATE_DIR="$REPO_ROOT/${STATE_DIR#./}" ;; esac

LOG_FILE="$LOG_DIR/monitor-$(date +%Y%m%d-%H%M%S).log"
PAUSED_FILE="$LOG_DIR/.paused"
DISPATCH_LOG="$LOG_DIR/dispatch.jsonl"

# Globals set by is_idle() to expose detection context
LAST_DETECTION=""
LAST_STATE_VALUE=""
LAST_STATE_AGE=""

# Globals set by pop_task() to expose queue metadata
LAST_QUEUE_KIND=""
LAST_QUEUE_REMAINING=""

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"; }
debug() { [ "${DEBUG:-0}" != "0" ] && echo "[$(date +%H:%M:%S)] DEBUG: $*" | tee -a "$LOG_FILE" || true; }
rm -f "$PAUSED_FILE"
mkdir -p "$STATE_DIR"

# Agent and background-process lists are loaded from SQLite via load_agents /
# load_bg (see lib/db.sh). These are re-invoked at the top of the poll loop so
# agents/bg-processes spawned via the dashboard are picked up on the next tick
# without restarting the monitor. Load once here too so the startup log below
# reports an accurate agent count.
load_agents
load_bg

move_to_backlog() {
  local agent_name="$1"
  local agent_id
  agent_id=$(sql "SELECT id FROM agents WHERE name='${agent_name//\'/''}'")
  if [[ -n "$agent_id" ]]; then
    sql "UPDATE tasks SET status='backlog' WHERE agent_id=$agent_id AND status='queued'"
  fi
}

pop_task() {
  local agent_name="$1"
  pop_task_sql "$agent_name"  # sets POPPED_TASK, LAST_QUEUE_KIND, LAST_QUEUE_REMAINING
}

# True for plain shell process names (what a pane shows after its agent exits)
is_shell_cmd() {
  case "$1" in
    sh|bash|zsh|fish|dash|ksh) return 0 ;;
    *) return 1 ;;
  esac
}

# First word of a launch command, skipping leading VAR=value env assignments
launch_cmd_name() {
  local w
  for w in $1; do
    case "$w" in
      [A-Za-z_]*=*) continue ;;
      *) printf '%s' "$w"; return 0 ;;
    esac
  done
  return 0
}

# True when the pane has fallen back to a plain shell while the agent's launch
# command is not itself a shell — i.e. the agent process exited or crashed.
# Dispatching into a dead pane would execute the task as a shell command.
pane_dead() {
  local target="$1"
  local name="$2"
  local launch="${AGENT_CMDS[$name]:-}"
  local cmd_name
  cmd_name="$(launch_cmd_name "$launch")"
  [ -z "$cmd_name" ] && return 1
  is_shell_cmd "$cmd_name" && return 1   # shell agents are always "alive"
  local cur
  cur=$(tmux display-message -p -t "$target" '#{pane_current_command}' 2>/dev/null || echo "")
  is_shell_cmd "$cur"
}

# Last 5 non-blank lines of a pane (regex matching input)
pane_tail5() {
  tmux capture-pane -t "$1" -p 2>/dev/null | grep -v '^[[:space:]]*$' | tail -5 || true
}

is_idle() {
  local target="$1"
  local name="${2:-}"
  local state_file="${STATE_DIR}/${name}.state"

  # Reset detection globals
  LAST_DETECTION=""
  LAST_STATE_VALUE=""
  LAST_STATE_AGE=""

  # An exited agent is neither idle nor busy — never dispatch into its shell.
  if [ -n "$name" ] && pane_dead "$target" "$name"; then
    LAST_DETECTION="pane-dead"
    debug "is_idle: target=$target agent process exited (pane shows a shell) — not idle"
    return 1
  fi

  # Primary: hook-written state file
  if [ -n "$name" ] && [ -f "$state_file" ]; then
    local now mtime age state
    now=$(date +%s)
    # macOS (BSD stat) vs Linux (GNU stat) compatibility
    mtime=$(stat -f %m "$state_file" 2>/dev/null || stat -c %Y "$state_file" 2>/dev/null || echo 0)
    age=$(( now - mtime ))
    # Strip carriage returns in case of CRLF line endings from Node.js on some platforms
    state=$(tr -d '\r' < "$state_file" 2>/dev/null | head -1 | tr -d '\n' || echo "")
    debug "is_idle: target=$target state-file='$state' (age=${age}s)"

    case "$state" in
      busy)
        # Trust busy by default — on-stop.js clears it when the agent finishes;
        # a long-running task must never be re-dispatched just because the
        # state file is "stale".
        LAST_DETECTION="state-file"
        LAST_STATE_VALUE="busy"
        LAST_STATE_AGE="$age"
        # Hook-failure safety net: if the busy file is old enough to rule out
        # the dispatch race (mark_busy fires right before send-keys) and the
        # pane footer reads idle (IDLE_PATTERN matches, BUSY_PATTERN doesn't),
        # the Stop hook never fired — recover the state file to idle.
        local busy_min_age
        busy_min_age=$(( POLL_INTERVAL * 2 ))
        if [ "$age" -gt "$busy_min_age" ]; then
          local tail_busy
          tail_busy=$(pane_tail5 "$target")
          if { [ -z "${BUSY_PATTERN:-}" ] || ! printf '%s\n' "$tail_busy" | grep -qE "$BUSY_PATTERN"; } \
             && printf '%s\n' "$tail_busy" | grep -qE "$IDLE_PATTERN"; then
            log "$name — busy state (age=${age}s) but pane reads idle; Stop hook likely missed — recovering to idle"
            printf 'idle\n' > "$state_file" 2>/dev/null || true
            LAST_DETECTION="busy-recovered"
            LAST_STATE_VALUE="idle"
            return 0
          fi
        fi
        # Secondary: check if the pane is awaiting interactive input
        if [ -n "${AWAITING_PATTERN:-}" ]; then
          local last_line
          last_line=$(tmux capture-pane -t "$target" -p 2>/dev/null | grep -v '^[[:space:]]*$' | tail -1 || true)
          if printf '%s\n' "$last_line" | grep -qE "$AWAITING_PATTERN"; then
            debug "is_idle: target=$target awaiting-input pattern matched — writing 'awaiting'"
            printf 'awaiting\n' > "$state_file" 2>/dev/null || true
          fi
        fi
        return 1
        ;;
      idle)
        # Trust idle regardless of age: an idle agent's state file is naturally
        # old because nothing rewrites it while the agent waits for work. The
        # crashed-agent case is covered by the pane_dead check above. Override
        # to busy only when the pane shows the BUSY_PATTERN indicator (covers
        # an agent relaunched without hook env on top of an old idle file).
        LAST_DETECTION="state-file"
        LAST_STATE_VALUE="idle"
        LAST_STATE_AGE="$age"
        if [ -n "${BUSY_PATTERN:-}" ]; then
          local tail_lines
          tail_lines=$(pane_tail5 "$target")
          if printf '%s\n' "$tail_lines" | grep -qE "$BUSY_PATTERN"; then
            debug "is_idle: target=$target state-file idle but BUSY_PATTERN matched — treating as busy"
            return 1
          fi
        fi
        return 0
        ;;
      awaiting)
        # Agent is awaiting interactive input. Re-check the pane; if the prompt
        # is gone, the agent resumed on its own — revert the state file to busy.
        LAST_DETECTION="state-file"
        LAST_STATE_VALUE="awaiting"
        LAST_STATE_AGE="$age"
        if [ -n "${AWAITING_PATTERN:-}" ]; then
          local last_line_aw
          last_line_aw=$(tmux capture-pane -t "$target" -p 2>/dev/null | grep -v '^[[:space:]]*$' | tail -1 || true)
          if ! printf '%s\n' "$last_line_aw" | grep -qE "$AWAITING_PATTERN"; then
            debug "is_idle: target=$target awaiting state but prompt gone — reverting to 'busy'"
            printf 'busy\n' > "$state_file" 2>/dev/null || true
          fi
        fi
        return 1
        ;;
      *)
        # unknown contents — record raw value, fall through to regex
        LAST_STATE_VALUE="$state"
        ;;
    esac
  fi

  # Fallback: footer regex. BUSY_PATTERN wins over IDLE_PATTERN because current
  # Claude Code keeps the permission-mode footer visible while working.
  LAST_DETECTION="regex"
  local last_lines
  last_lines=$(pane_tail5 "$target")
  if [ -n "${BUSY_PATTERN:-}" ] && printf '%s\n' "$last_lines" | grep -qE "$BUSY_PATTERN"; then
    debug "is_idle: target=$target BUSY_PATTERN matched — busy"
    return 1
  fi
  if printf '%s\n' "$last_lines" | grep -qE "$IDLE_PATTERN"; then
    debug "is_idle: target=$target regex MATCHED"
    return 0
  fi
  debug "is_idle: target=$target regex no match"
  return 1
}

check_usage() {
  debug "check_usage: running USAGE_CHECK_CMD in subshell"
  # Run the user-supplied command in a subshell so any `exit` inside
  # USAGE_CHECK_CMD terminates only the subshell, not monitor.sh itself.
  # Also disable -e inside the subshell so intermediate non-zero exits
  # (e.g. from a failing pipeline element) don't kill the check prematurely.
  local rc=0
  local output
  output=$( set +e; eval "$USAGE_CHECK_CMD" 2>&1 )
  rc=$?
  log "check_usage output: $output"
  if [ "$rc" -eq 0 ]; then
    debug "check_usage: OK (rc=0)"
    return 0  # usage OK
  else
    debug "check_usage: limit hit (rc=$rc)"
    return 1  # limit hit
  fi
}

mark_busy() {
  local name="$1"
  [ -n "$name" ] || return 0
  local state_file="${STATE_DIR}/${name}.state"
  printf 'busy\n' > "$state_file" 2>/dev/null || true
  debug "mark_busy: wrote 'busy' to $state_file"
}

dispatch() {
  local target="$1"
  local cmd="$2"
  debug "dispatch: target=$target cmd=$cmd"
  "$SCRIPT_DIR/dispatch.sh" "$target" "$cmd" 2>&1 | tee -a "$LOG_FILE"
}

# Capture last 10 non-blank lines of a pane as a JSON array of strings
pane_tail_json() {
  local target="$1"
  local lines
  lines=$(tmux capture-pane -t "$target" -p 2>/dev/null | grep -v '^[[:space:]]*$' | tail -10 || true)
  python3 -c "
import sys, json
lines = sys.stdin.read().splitlines()
print(json.dumps(lines))
" <<< "$lines"
}

# Append one JSONL record to $DISPATCH_LOG
# Usage: emit_dispatch_jsonl <agent> <command> <queue_kind> <queue_remaining> <target>
emit_dispatch_jsonl() {
  local agent="$1"
  local command="$2"
  local queue_kind="$3"
  local queue_remaining="$4"
  local target="$5"

  local ts state_val state_age_json queue_remaining_json pane_tail
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # state_age_s: null if empty, else integer
  if [ -n "$LAST_STATE_AGE" ]; then
    state_age_json="$LAST_STATE_AGE"
  else
    state_age_json="null"
  fi

  # queue_remaining: null if empty, else integer
  if [ -n "$queue_remaining" ]; then
    queue_remaining_json="$queue_remaining"
  else
    queue_remaining_json="null"
  fi

  pane_tail=$(pane_tail_json "$target" 2>/dev/null || echo "[]")

  python3 -c "
import sys, json
data = {
    'ts': sys.argv[1],
    'agent': sys.argv[2],
    'command': sys.argv[3],
    'state': sys.argv[4] if sys.argv[4] else None,
    'state_age_s': int(sys.argv[5]) if sys.argv[5] != 'null' else None,
    'detection': sys.argv[6] if sys.argv[6] else None,
    'queue': sys.argv[7],
    'queue_remaining': int(sys.argv[8]) if sys.argv[8] != 'null' else None,
    'pane_tail': json.loads(sys.argv[9]),
}
print(json.dumps(data, separators=(',', ':')))
" "$ts" "$agent" "$command" "${LAST_STATE_VALUE:-}" "$state_age_json" "${LAST_DETECTION:-}" "$queue_kind" "$queue_remaining_json" "$pane_tail" >> "$DISPATCH_LOG" 2>/dev/null || true
}

log "Monitor started. Watching ${#AGENT_NAMES[@]} agents. Poll interval: ${POLL_INTERVAL}s"
log "Idle pattern: $IDLE_PATTERN"
log "Usage check: $USAGE_CHECK_CMD"
log "Task queue: $CONDUCTOR_DB"
if [ "${DEBUG:-0}" != "0" ]; then
  log "DEBUG logging enabled (DEBUG=${DEBUG})"
fi

ITER=0
while true; do
  ITER=$((ITER + 1))
  # Reload agents/bg-processes from SQLite each tick so dashboard-spawned
  # additions are picked up without restarting the monitor. Both reset their
  # name arrays (AGENT_NAMES/BG_NAMES) on each call, so this is idempotent.
  load_agents
  load_bg
  debug "loop: iteration $ITER starting (agents=${#AGENT_NAMES[@]})"
  # Check for manual stop signal
  if [ -f "$PAUSED_FILE" ]; then
    log "Paused (manual stop). Remove $PAUSED_FILE to resume."
    sleep "$POLL_INTERVAL"
    continue
  fi

  all_idle=true
  all_usage_hit=true

  for name in "${AGENT_NAMES[@]}"; do
    target="$SESSION_NAME:$name"
    debug "loop: checking agent '$name' (target=$target)"

    # Skip if pane doesn't exist (agent crashed or was closed)
    if ! tmux has-session -t "$target" 2>/dev/null; then
      log "WARN: $name — pane not found, skipping"
      move_to_backlog "$name"
      continue
    fi

    if is_idle "$target" "$name"; then
      log "$name — idle detected (detection=$LAST_DETECTION state=${LAST_STATE_VALUE:-n/a} age=${LAST_STATE_AGE:-n/a}s)"

      # Check usage before dispatching
      if ! check_usage; then
        log "$name — usage limit hit, pausing this agent"
        continue
      fi
      all_usage_hit=false

      # Pop next task — if queue is empty, agent stays idle (no fallback)
      if pop_task "$name"; then
        task="$POPPED_TASK"
        log "$name — dispatching task [queue=$LAST_QUEUE_KIND remaining=$LAST_QUEUE_REMAINING detection=$LAST_DETECTION]: $task"
        emit_dispatch_jsonl "$name" "$task" "$LAST_QUEUE_KIND" "$LAST_QUEUE_REMAINING" "$target"
        mark_busy "$name"
        dispatch "$target" "$task"
      else
        log "$name — queue empty, no task. Agent stays idle."
        emit_dispatch_jsonl "$name" "" "none" "" "$target"
      fi
    else
      all_idle=false
      all_usage_hit=false
    fi
  done

  # Liveness check for bg processes — warn only, do not affect shutdown decision
  for bg_name in "${BG_NAMES[@]}"; do
    bg_target="$SESSION_NAME:$bg_name"
    if ! tmux has-session -t "$bg_target" 2>/dev/null; then
      log "WARN: bg '$bg_name' — window not found"
      echo "dead" > "$STATE_DIR/bg-$bg_name.state"
      move_to_backlog "$bg_name"
    else
      echo "alive" > "$STATE_DIR/bg-$bg_name.state"
    fi
  done

  # If usage is hit on all agents, shut down
  if $all_usage_hit && $all_idle; then
    log "All agents idle + usage limit hit. Shutting down."
    "$SCRIPT_DIR/teardown.sh"
    exit 0
  fi

  sleep "$POLL_INTERVAL"
done
