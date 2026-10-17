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
TRANSITION_LOG="$LOG_DIR/transitions.jsonl"

# Globals set by is_idle() to expose detection context
LAST_DETECTION=""
LAST_STATE_VALUE=""
LAST_STATE_AGE=""

# Globals set by pop_task() to expose queue metadata
LAST_QUEUE_KIND=""
LAST_QUEUE_REMAINING=""

# TASK-144: per-agent last-observed state, for detecting transitions in the
# poll loop's hookless/regex-fallback path (mirrors host-server's
# transitions.jsonl emission on the TypeScript side — see TASK-143). Declared
# with declare -gA to match the associative-array pattern used for
# AGENT_DIRS/AGENT_CMDS/etc. in lib/db.sh's load_agents().
declare -gA PREV_TRANSITION_STATE

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"; }
debug() { [ "${DEBUG:-0}" != "0" ] && echo "[$(date +%H:%M:%S)] DEBUG: $*" | tee -a "$LOG_FILE" || true; }
rm -f "$PAUSED_FILE"
mkdir -p "$STATE_DIR"

# TASK-128: prevent two concurrent monitor.sh instances from racing dispatch
# against the same STATE_DIR — dispatch.sh's send-keys-then-sleep-then-Enter
# gap has no locking around the target pane, so two monitors dispatching to
# the same agent in close succession can interleave keystrokes. Lock file is
# keyed on STATE_DIR (not global), so two conductor.conf setups pointing at
# different STATE_DIRs never contend with each other.
LOCK_FILE="$STATE_DIR/monitor.pid"
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    # PID is alive - verify it is actually a monitor.sh process before
    # refusing to start; a recycled PID belonging to an unrelated process
    # must never block startup. `ps -p PID -o command=` (headerless full
    # command line) is supported by both BSD (macOS) and GNU (Linux) ps.
    LOCK_CMD="$(ps -p "$LOCK_PID" -o command= 2>/dev/null || true)"
    if [ -n "$LOCK_CMD" ]; then
      case "$LOCK_CMD" in
        *monitor.sh*)
          log "FATAL: another monitor.sh instance appears to be running (PID $LOCK_PID, lock file $LOCK_FILE). Confirm no other conductor is running against this STATE_DIR, then remove the lock file manually before restarting."
          exit 1
          ;;
        *)
          log "WARNING: lock file $LOCK_FILE names live PID $LOCK_PID, but its command ('$LOCK_CMD') does not look like monitor.sh (recycled PID) - overriding stale lock and proceeding."
          ;;
      esac
    else
      # ps failed, returned nothing, or the identity check is otherwise
      # inconclusive. Fail open: refuse to start only on a confident,
      # positively-verified conflict (PID alive AND positively identified as
      # monitor.sh) - an uncertain guard must never become a boot blocker.
      log "WARNING: lock file $LOCK_FILE names live PID $LOCK_PID, but its identity could not be verified (ps failed or returned nothing) - proceeding (fail-open)."
    fi
  else
    log "NOTICE: stale lock found (PID ${LOCK_PID:-unknown} not running), clearing"
  fi
fi
echo "$$" > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# Agent and background-process lists are loaded from SQLite via load_agents /
# load_bg (see lib/db.sh). These are re-invoked at the top of the poll loop so
# agents/bg-processes spawned via the dashboard are picked up on the next tick
# without restarting the monitor. Load once here too so the startup log below
# reports an accurate agent count.
load_agents
load_bg

move_to_backlog() {
  local agent_id="$1"
  if [[ -n "$agent_id" ]]; then
    sql "UPDATE tasks SET status='backlog' WHERE agent_id=$agent_id AND status='queued'"
  fi
}

pop_task() {
  local agent_id="$1"
  local project_id="${2:-}"
  pop_task_sql "$agent_id" "$project_id"  # sets POPPED_TASK, LAST_QUEUE_KIND, LAST_QUEUE_REMAINING
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

agent_type() {
  local launch="$1"
  local cmd_name
  cmd_name="$(basename "$(launch_cmd_name "$launch")" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  case "$cmd_name" in
    claude) printf 'claude' ;;
    codex) printf 'codex' ;;
    *) printf 'custom' ;;
  esac
}

agent_idle_pattern() {
  case "$(agent_type "$1")" in
    codex) printf '%s' '^codex[>›]|OpenAI Codex|^[[:space:]]*gpt-[^[:space:]]+[[:space:]].*~/|^[[:space:]]*[›❯][[:space:]]*$|^[[:space:]]*>[[:space:]]*$' ;;
    *) printf '%s' "${IDLE_PATTERN:-}" ;;
  esac
}

agent_busy_pattern() {
  case "$(agent_type "$1")" in
    codex) printf '%s' 'esc to interrupt|ctrl.c to interrupt|[Ww]orking|[Tt]hinking|[Rr]unning|[Ee]xecuting|[Aa]pplying' ;;
    *) printf '%s' "${BUSY_PATTERN:-}" ;;
  esac
}

agent_awaiting_pattern() {
  case "$(agent_type "$1")" in
    # A bare Codex ">" line is normal idle prompt chrome, not a blocked
    # interactive prompt. Awaiting should only mean an explicit dialog or
    # confirmation is open; a free-floating "?" is usually just user text.
    codex) printf '%s' '(\[Y/n\]|\[y/N\]|Enter to (select|confirm|submit)|Esc to (cancel|go back))' ;;
    *) printf '%s' "${AWAITING_PATTERN:-}" ;;
  esac
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

# Bg-process analogue of pane_dead(): true when the bg window's pane has fallen
# back to a plain shell while its launch command (BG_CMDS) is not itself a
# shell — i.e. the dev server / watcher exited and only the shell remains.
# Mirrors host-server/state.ts bgLiveness (minus its startup grace: monitor
# polls every POLL_INTERVAL and this is warn/state-only, never a dispatch gate).
# An empty pane_current_command fails toward "running" (not exited).
bg_pane_exited() {
  local target="$1"
  local name="$2"
  local launch="${BG_CMDS[$name]:-}"
  local cmd_name
  cmd_name="$(launch_cmd_name "$launch")"
  cmd_name="$(basename "$cmd_name" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  is_shell_cmd "$cmd_name" && return 1   # shell-launched bg is always "running"
  local cur
  cur=$(tmux display-message -p -t "$target" '#{pane_current_command}' 2>/dev/null || echo "")
  cur="$(basename "$cur" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  [ -z "$cur" ] && return 1
  is_shell_cmd "$cur"
}

# Last 5 non-blank lines of a pane (regex matching input)
pane_tail5() {
  tmux capture-pane -t "$1" -p 2>/dev/null | grep -v '^[[:space:]]*$' | tail -5 || true
}

# BUG-0013: last 8 non-blank lines of a pane, excluding "❯ <text>" prompt-box
# lines (typed input / placeholder hints) so they cannot trip the awaiting
# pattern; a bare "❯" line is kept.
awaiting_window() {
  tmux capture-pane -t "$1" -p 2>/dev/null | grep -v '^[[:space:]]*$' | grep -Ev '^[[:space:]]*❯[[:space:]]+[^[:space:]]' | tail -8 || true
}

# BUG-0013: true (0) only when the busy footer is visible in the last 15
# non-blank lines. Claude's "esc to interrupt" footer never appears while a
# real dialog is open, so it vetoes an awaiting match. Codex is exempt (its
# busy pattern is broad and its chrome can linger); empty pattern => false.
busy_visible() {
  local target="$1" busy_pattern="${2:-}" launch="${3:-}"
  if [ "$(agent_type "$launch")" = "codex" ]; then
    return 1
  fi
  if [ -z "$busy_pattern" ]; then
    return 1
  fi
  if tmux capture-pane -t "$target" -p 2>/dev/null | grep -v '^[[:space:]]*$' | tail -15 | grep -qE "$busy_pattern"; then
    return 0
  fi
  return 1
}

is_idle() {
  local target="$1"
  local window_name="${2:-}"
  local name="${3:-$window_name}"
  local state_file="${STATE_DIR}/${window_name}.state"
  local launch="${AGENT_CMDS[$name]:-}"
  local idle_pattern busy_pattern awaiting_pattern
  idle_pattern="$(agent_idle_pattern "$launch")"
  busy_pattern="$(agent_busy_pattern "$launch")"
  awaiting_pattern="$(agent_awaiting_pattern "$launch")"

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
        # Interactive prompts beat idle recovery. Codex panes often keep idle
        # chrome in scrollback/header areas, so check awaiting before treating
        # a stale busy file as an idle Stop-hook miss.
        # BUG-0013: skip the awaiting check entirely while the busy footer is
        # visible (it never appears with a real dialog; codex is exempt).
        # Flow then continues into the stale-busy recovery below, which
        # returns 1 while BUSY_PATTERN matches the pane tail.
        if [ -n "$awaiting_pattern" ] && ! busy_visible "$target" "$busy_pattern" "$launch"; then
          local last_lines_aw
          last_lines_aw=$(awaiting_window "$target")
          if printf '%s\n' "$last_lines_aw" | grep -qE "$awaiting_pattern"; then
            debug "is_idle: target=$target awaiting-input pattern matched — writing 'awaiting'"
            printf 'awaiting\n' > "$state_file" 2>/dev/null || true
            return 1
          fi
        fi
        # Hook-failure safety net: if the busy file is old enough to rule out
        # the dispatch race (mark_busy fires right before send-keys) and the
        # pane footer reads idle (IDLE_PATTERN matches, BUSY_PATTERN doesn't),
        # the Stop hook never fired — recover the state file to idle.
        local busy_min_age
        busy_min_age=$(( POLL_INTERVAL * 2 ))
        if [ "$age" -gt "$busy_min_age" ]; then
          local tail_busy
          tail_busy=$(pane_tail5 "$target")
          if [ "$(agent_type "$launch")" = "codex" ] \
             && { [ -z "$busy_pattern" ] || ! printf '%s\n' "$tail_busy" | grep -qE "$busy_pattern"; } \
             && [ -n "$idle_pattern" ] \
             && printf '%s\n' "$tail_busy" | grep -qE "$idle_pattern"; then
            log "$name — Codex busy state (age=${age}s) but pane reads idle; recovering to idle"
            printf 'idle\n' > "$state_file" 2>/dev/null || true
            LAST_DETECTION="busy-recovered"
            LAST_STATE_VALUE="idle"
            return 0
          elif { [ -z "$busy_pattern" ] || ! printf '%s\n' "$tail_busy" | grep -qE "$busy_pattern"; } \
               && [ -n "$idle_pattern" ] \
               && printf '%s\n' "$tail_busy" | grep -qE "$idle_pattern"; then
            log "$name — busy state (age=${age}s) but pane reads idle; Stop hook likely missed — recovering to idle"
            printf 'idle\n' > "$state_file" 2>/dev/null || true
            LAST_DETECTION="busy-recovered"
            LAST_STATE_VALUE="idle"
            return 0
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
        # BUG-0013: the busy footer never appears alongside a real dialog, so if
        # it is visible the agent is working — return busy without writing
        # 'awaiting' (LAST_STATE_VALUE stays "idle", mirroring the BUSY_PATTERN
        # override below). Codex is exempt (busy_visible returns 1 for codex).
        if busy_visible "$target" "$busy_pattern" "$launch"; then
          debug "is_idle: target=$target state-file idle but busy footer visible — treating as busy"
          return 1
        fi
        if [ -n "$awaiting_pattern" ]; then
          local last_lines_idle_aw
          last_lines_idle_aw=$(awaiting_window "$target")
          if printf '%s\n' "$last_lines_idle_aw" | grep -qE "$awaiting_pattern"; then
            debug "is_idle: target=$target idle state but awaiting-input pattern matched — writing 'awaiting'"
            printf 'awaiting\n' > "$state_file" 2>/dev/null || true
            LAST_STATE_VALUE="awaiting"
            return 1
          fi
        fi
        if [ -n "$busy_pattern" ]; then
          local tail_lines
          tail_lines=$(pane_tail5 "$target")
          if printf '%s\n' "$tail_lines" | grep -qE "$busy_pattern"; then
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
        # BUG-0013: a visible busy footer ("esc to interrupt") never coexists
        # with a real dialog (it only shows while the agent is working), so
        # revert to busy when it is visible even if the pattern still matches
        # stale scrollback. Codex is exempt (busy_visible returns 1 for codex).
        if busy_visible "$target" "$busy_pattern" "$launch"; then
          debug "is_idle: target=$target awaiting state but busy footer visible — reverting to 'busy'"
          printf 'busy\n' > "$state_file" 2>/dev/null || true
        elif [ -n "$awaiting_pattern" ]; then
          local last_lines_aw2
          last_lines_aw2=$(awaiting_window "$target")
          if ! printf '%s\n' "$last_lines_aw2" | grep -qE "$awaiting_pattern"; then
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
  if [ -n "$busy_pattern" ] && printf '%s\n' "$last_lines" | grep -qE "$busy_pattern"; then
    debug "is_idle: target=$target BUSY_PATTERN matched — busy"
    return 1
  fi
  # BUG-0013: match awaiting against awaiting_window (8 non-blank lines with the
  # empty-prompt-box chrome filtered), not the 5-line idle tail. The busy check
  # above already ran first, so a visible busy footer never reaches this point.
  if [ -n "$awaiting_pattern" ]; then
    local last_lines_fb_aw
    last_lines_fb_aw=$(awaiting_window "$target")
    if printf '%s\n' "$last_lines_fb_aw" | grep -qE "$awaiting_pattern"; then
      debug "is_idle: target=$target AWAITING_PATTERN matched — writing 'awaiting'"
      printf 'awaiting\n' > "$state_file" 2>/dev/null || true
      LAST_STATE_VALUE="awaiting"
      return 1
    fi
  fi
  if [ -n "$idle_pattern" ] && printf '%s\n' "$last_lines" | grep -qE "$idle_pattern"; then
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
  local window_name="$1"
  [ -n "$window_name" ] || return 0
  local state_file="${STATE_DIR}/${window_name}.state"
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


# TASK-144 step 2: sibling to emit_dispatch_jsonl, but fires on every observed
# state transition (not just at dispatch time) so hookless/regex-fallback
# agents get the same transitions.jsonl coverage TASK-143 gives the
# host-server's TypeScript detector. Reads LAST_DETECTION/LAST_STATE_AGE from
# the caller's current globals (set by is_idle() and still current at the
# call site), same as emit_dispatch_jsonl does.
emit_transition_jsonl() {
  local agent="$1"
  local from_state="$2"
  local to_state="$3"
  local target="$4"

  local ts state_age_json pane_tail
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # state_age_s: null if empty, else integer
  if [ -n "$LAST_STATE_AGE" ]; then
    state_age_json="$LAST_STATE_AGE"
  else
    state_age_json="null"
  fi

  pane_tail=$(pane_tail_json "$target" 2>/dev/null || echo "[]")

  python3 -c "
import sys, json
data = {
    'ts': sys.argv[1],
    'agent': sys.argv[2],
    'from': sys.argv[3] if sys.argv[3] else None,
    'to': sys.argv[4] if sys.argv[4] else None,
    'reason': sys.argv[5] if sys.argv[5] else None,
    'stateFileAgeS': int(sys.argv[6]) if sys.argv[6] != 'null' else None,
    'paneTail': json.loads(sys.argv[7]),
}
print(json.dumps(data, separators=(',', ':')))
" "$ts" "$agent" "$from_state" "$to_state" "${LAST_DETECTION:-}" "$state_age_json" "$pane_tail" >> "$TRANSITION_LOG" 2>/dev/null || true
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
  # TASK-120: fleet-wide usage-hit flag; also written to STATE_DIR/usage-limited
  # below so host-server's fast idle-transition dispatch path can skip a
  # usage-limited agent via a cheap existsSync check instead of re-implementing
  # USAGE_CHECK_CMD in TypeScript.
  all_usage_hit=true

  for name in "${AGENT_NAMES[@]}"; do
    window_name="${AGENT_WINDOW_NAMES[$name]:-$name}"
    target="$SESSION_NAME:=$window_name"
    debug "loop: checking agent '$name' (window=$window_name target=$target)"

    # Skip if pane doesn't exist (agent crashed or was closed)
    if ! tmux has-session -t "$target" 2>/dev/null; then
      log "WARN: $name — pane not found (window=$window_name), skipping"
      move_to_backlog "${AGENT_IDS[$name]}"
      # BUG FIX: a missing pane must not vacuously satisfy the
      # all-idle + all-usage-hit auto-teardown check below — an agent
      # we can't observe is neither confirmed idle nor confirmed
      # usage-limited. Without this, a fleet where every pane is
      # transiently absent (e.g. right after a session restart, before
      # windows finish spawning) leaves both flags at their initial
      # `true` default and triggers an immediate, mislabeled
      # "usage limit hit" shutdown of the session it just started.
      all_idle=false
      all_usage_hit=false
      continue
    fi

    if is_idle "$target" "$window_name" "$name"; then
      idle_rc=0
    else
      idle_rc=1
    fi

    # TASK-144 step 1: emit a transition record when this tick's observed
    # state (LAST_STATE_VALUE, set by is_idle() above regardless of its
    # return code) differs from the last tick's for this agent. Skip the
    # agent's first tick, when PREV_TRANSITION_STATE[$name] is still unset and
    # there is nothing yet to diff against. This mirrors transitions.jsonl
    # logging (TASK-143, host-server side) for the hookless/regex-fallback
    # path that only monitor.sh's is_idle() runs. emit_transition_jsonl is
    # added in step 2 of this task — the call site is wired up now so it
    # plugs in once that function lands.
    if [ -n "${PREV_TRANSITION_STATE[$name]+set}" ] && [ "${PREV_TRANSITION_STATE[$name]}" != "$LAST_STATE_VALUE" ]; then
      emit_transition_jsonl "$name" "${PREV_TRANSITION_STATE[$name]}" "$LAST_STATE_VALUE" "$target"
    fi
    PREV_TRANSITION_STATE[$name]="$LAST_STATE_VALUE"

    if [ "$idle_rc" -eq 0 ]; then
      log "$name — idle detected (detection=$LAST_DETECTION state=${LAST_STATE_VALUE:-n/a} age=${LAST_STATE_AGE:-n/a}s)"

      # Check usage before dispatching
      if ! check_usage; then
        log "$name — usage limit hit, pausing this agent"
        continue
      fi
      all_usage_hit=false

    else
      all_idle=false
      all_usage_hit=false
    fi
  done

  # TASK-120: fleet-wide usage-limited marker for host-server's fast
  # idle-transition dispatch path — checked via existsSync so host-server
  # doesn't need to re-implement USAGE_CHECK_CMD evaluation.
  if $all_usage_hit; then
    touch "${STATE_DIR}/usage-limited"
  else
    rm -f "${STATE_DIR}/usage-limited"
  fi

  # Liveness check for bg processes — warn only, do not affect shutdown decision.
  # BG_NAMES holds slugs (<projectName>-<name>, see load_bg in lib/db.sh): the
  # tmux window name and the bg-<slug>.state stem, matching host-server bgSlug().
  for bg_name in "${BG_NAMES[@]}"; do
    bg_target="$SESSION_NAME:=$bg_name"
    if ! tmux has-session -t "$bg_target" 2>/dev/null; then
      log "WARN: bg '$bg_name' — window not found"
      echo "dead" > "$STATE_DIR/bg-$bg_name.state"
      # No move_to_backlog here: bg processes are keyed by slug, not agents.id,
      # and never receive queue dispatches, so there is nothing to backlog.
    elif bg_pane_exited "$bg_target" "$bg_name"; then
      # Window exists but the pane is back at a plain shell: process exited.
      echo "exited" > "$STATE_DIR/bg-$bg_name.state"
    else
      echo "running" > "$STATE_DIR/bg-$bg_name.state"
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
