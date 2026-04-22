#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../conductor.conf"

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

# Build list of agent window names
declare -a AGENT_NAMES=()
for entry in "${AGENTS[@]}"; do
  IFS=: read -r name _ _ <<< "$entry"
  AGENT_NAMES+=("$name")
done

# Build list of background-process window names (parallel to AGENT_NAMES)
declare -a BG_NAMES=()
if [ -n "${BG_PROCESSES+x}" ] && [ "${#BG_PROCESSES[@]}" -gt 0 ]; then
  for entry in "${BG_PROCESSES[@]}"; do
    [ -z "$entry" ] && continue
    IFS=: read -r bg_name _ _ <<< "$entry"
    BG_NAMES+=("$bg_name")
  done
fi

pop_task() {
  local agent_name="$1"
  LAST_QUEUE_KIND=""
  LAST_QUEUE_REMAINING=""
  POPPED_TASK=""
  debug "pop_task: checking queue for agent '$agent_name' (queue=$TASK_QUEUE)"
  if [ ! -f "$TASK_QUEUE" ]; then
    debug "pop_task: queue file does not exist"
    return 1
  fi
  if [ ! -s "$TASK_QUEUE" ]; then
    debug "pop_task: queue file is empty"
    return 1
  fi
  debug "pop_task: queue has $(wc -l < "$TASK_QUEUE" | tr -d ' ') line(s)"

  local match_line=""
  local match_cmd=""
  local match_kind=""

  # Priority 1: lines prefixed with this agent's name
  local line_num=0
  while IFS= read -r line; do
    line_num=$((line_num + 1))
    if [[ "$line" =~ ^${agent_name}:\ (.+) ]]; then
      match_line="$line_num"
      match_cmd="${BASH_REMATCH[1]}"
      match_kind="scoped"
      break
    fi
  done < "$TASK_QUEUE"

  # Priority 2: global/unscoped lines (no colon-space prefix pattern)
  if [ -z "$match_line" ]; then
    line_num=0
    while IFS= read -r line; do
      line_num=$((line_num + 1))
      if ! [[ "$line" =~ ^[a-zA-Z0-9_-]+:\ .+ ]]; then
        match_line="$line_num"
        match_cmd="$line"
        match_kind="global"
        break
      fi
    done < "$TASK_QUEUE"
  fi

  if [ -z "$match_line" ]; then
    debug "pop_task: no scoped or global match for '$agent_name'"
    return 1
  fi

  debug "pop_task: matched $match_kind line $match_line -> '$match_cmd'"
  LAST_QUEUE_KIND="$match_kind"
  POPPED_TASK="$match_cmd"
  sed -i.bak "${match_line}d" "$TASK_QUEUE" && rm -f "${TASK_QUEUE}.bak"
  debug "pop_task: removed line $match_line from queue"
  # Count remaining lines after removal
  if [ -f "$TASK_QUEUE" ]; then
    LAST_QUEUE_REMAINING=$(wc -l < "$TASK_QUEUE" | tr -d ' ')
  else
    LAST_QUEUE_REMAINING=0
  fi
  return 0
}

is_idle() {
  local target="$1"
  local name="${2:-}"
  local state_file="${STATE_DIR}/${name}.state"

  # Reset detection globals
  LAST_DETECTION=""
  LAST_STATE_VALUE=""
  LAST_STATE_AGE=""

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
        # Always trust busy — not subject to max_age.
        # on-stop.js clears this when the agent finishes; a long-running task must
        # never be re-dispatched just because the state file is "stale".
        LAST_DETECTION="state-file"
        LAST_STATE_VALUE="busy"
        LAST_STATE_AGE="$age"
        return 1
        ;;
      idle)
        # Only trust idle when fresh; a stale idle could mean the agent crashed
        # after going idle without a Stop hook firing.
        local max_age
        max_age=$(( POLL_INTERVAL * 2 ))
        if [ "$age" -le "$max_age" ]; then
          LAST_DETECTION="state-file"
          LAST_STATE_VALUE="idle"
          LAST_STATE_AGE="$age"
          return 0
        else
          debug "is_idle: target=$target state-file stale (age=${age}s > ${max_age}s), falling back to regex"
        fi
        ;;
      *)
        # unknown contents — record raw value, fall through to regex
        LAST_STATE_VALUE="$state"
        ;;
    esac
  fi

  # Fallback: footer regex
  LAST_DETECTION="regex"
  local last_lines
  last_lines=$(tmux capture-pane -t "$target" -p | grep -v '^[[:space:]]*$' | tail -5 || true)
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
log "Task queue: $TASK_QUEUE"
if [ "${DEBUG:-0}" != "0" ]; then
  log "DEBUG logging enabled (DEBUG=${DEBUG})"
fi

ITER=0
while true; do
  ITER=$((ITER + 1))
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
