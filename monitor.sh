#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/conductor.conf"

LOG_FILE="$LOG_DIR/monitor-$(date +%Y%m%d-%H%M%S).log"
PAUSED_FILE="$LOG_DIR/.paused"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"; }
debug() { [ "${DEBUG:-0}" != "0" ] && echo "[$(date +%H:%M:%S)] DEBUG: $*" | tee -a "$LOG_FILE" || true; }
rm -f "$PAUSED_FILE"

# Build list of agent window names
declare -a AGENT_NAMES=()
for entry in "${AGENTS[@]}"; do
  IFS=: read -r name _ _ <<< "$entry"
  AGENT_NAMES+=("$name")
done

pop_task() {
  local agent_name="$1"
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
  echo "$match_cmd"
  sed -i.bak "${match_line}d" "$TASK_QUEUE" && rm -f "${TASK_QUEUE}.bak"
  debug "pop_task: removed line $match_line from queue"
  return 0
}

is_idle() {
  local target="$1"
  local last_lines
  last_lines=$(tmux capture-pane -t "$target" -p | grep -v '^[[:space:]]*$' | tail -5 || true)
  local line_count
  line_count=$(printf '%s\n' "$last_lines" | grep -c . || true)
  debug "is_idle: target=$target captured $line_count non-empty line(s)"
  if [ "${DEBUG:-0}" != "0" ]; then
    # Emit the captured tail lines with a prefix so they're easy to scan
    printf '%s\n' "$last_lines" | sed 's/^/[DEBUG is_idle>] /' | tee -a "$LOG_FILE" >/dev/null || true
  fi
  if printf '%s\n' "$last_lines" | grep -qE "$IDLE_PATTERN"; then
    debug "is_idle: target=$target MATCHED idle pattern"
    return 0
  else
    debug "is_idle: target=$target no match"
    return 1
  fi
}

check_usage() {
  debug "check_usage: running USAGE_CHECK_CMD in subshell"
  # Run the user-supplied command in a subshell so any `exit` inside
  # USAGE_CHECK_CMD terminates only the subshell, not monitor.sh itself.
  # Also disable -e inside the subshell so intermediate non-zero exits
  # (e.g. from a failing pipeline element) don't kill the check prematurely.
  local rc=0
  ( set +e; eval "$USAGE_CHECK_CMD" ) >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then
    debug "check_usage: OK (rc=0)"
    return 0  # usage OK
  else
    debug "check_usage: limit hit (rc=$rc)"
    return 1  # limit hit
  fi
}

dispatch() {
  local target="$1"
  local cmd="$2"
  debug "dispatch: target=$target cmd=$cmd"
  "$SCRIPT_DIR/dispatch.sh" "$target" "$cmd" 2>&1 | tee -a "$LOG_FILE"
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

    if is_idle "$target"; then
      log "$name — idle detected"

      # Check usage before dispatching
      if ! check_usage; then
        log "$name — usage limit hit, pausing this agent"
        continue
      fi
      all_usage_hit=false

      # Pop next task or use default command
      if task=$(pop_task "$name"); then
        log "$name — dispatching task: $task"
        dispatch "$target" "/clear"
        sleep 2  # let /clear complete
        dispatch "$target" "$task"
      elif [ -n "${TASK_CMD:-}" ]; then
        log "$name — queue empty, sending default: $TASK_CMD"
        dispatch "$target" "/clear"
        sleep 2
        dispatch "$target" "$TASK_CMD"
      else
        log "$name — queue empty, no default command. Agent stays idle."
      fi
    else
      all_idle=false
      all_usage_hit=false
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
