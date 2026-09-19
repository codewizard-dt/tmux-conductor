#!/usr/bin/env bash
# scripts/verify-transitions-jsonl-emit.sh — TASK-144 repeatable check for
# scripts/monitor.sh's emit_transition_jsonl() JSON shape/null-handling and
# the poll loop's per-agent transition-diff guard (PREV_TRANSITION_STATE).
#
# monitor.sh cannot be `source`d directly for isolated testing: it calls
# load_agents/load_bg at top level (require a live CONDUCTOR_DB) and ends in
# an unconditional `while true` poll loop that never returns; conductor.conf
# also hardcodes LOG_DIR/STATE_DIR/POLL_INTERVAL as plain assignments immune
# to pre-exported overrides. Per
# raw/research/monitor-sh-transition-emit-testability/index.md, this script
# structurally extracts the two argument-driven functions
# (emit_transition_jsonl, pane_tail_json) — verbatim, from the live file, not
# copy-pasted — into a throwaway harness with a stubbed `tmux`, and separately
# grep-extracts the literal poll-loop diff-guard line to test it against
# constructed PREV_TRANSITION_STATE states. No live tmux session, no DB, no
# wall-clock sleep.
#
# Usage: bash scripts/verify-transitions-jsonl-emit.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
MONITOR_SH="$REPO/scripts/monitor.sh"
SCRATCH_DIR="$REPO/tmp/verify-transitions-jsonl-emit"
rm -rf "$SCRATCH_DIR"
mkdir -p "$SCRATCH_DIR"

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

cleanup() { rm -rf "$SCRATCH_DIR"; }
trap cleanup EXIT

# --- Extract the two argument-driven functions verbatim from the live file ---
# A naive "line starts with }" boundary breaks here: emit_transition_jsonl's
# body embeds a python dict literal whose own closing "}" sits at column 0.
# Use a quote-aware brace-depth scan instead (only counts { / } when not
# inside a bash '...' or "..." string), so the boundary is the function's
# real closing brace regardless of what the python heredoc argument contains.
FUNCS_FILE="$SCRATCH_DIR/extracted-funcs.sh"
python3 -c "
import sys

path = sys.argv[1]
names = sys.argv[2:]
lines = open(path).read().split('\n')

def extract(name):
    target = name + '() {'
    start_idx = next((i for i, l in enumerate(lines) if l.strip() == target), None)
    if start_idx is None:
        return None
    depth = 0
    in_d = in_s = False
    collected = []
    for i in range(start_idx, len(lines)):
        line = lines[i]
        collected.append(line)
        j = 0
        while j < len(line):
            c = line[j]
            if in_d:
                if c == '\\\\':
                    j += 2
                    continue
                if c == '\"':
                    in_d = False
            elif in_s:
                if c == \"'\":
                    in_s = False
            else:
                if c == '\"':
                    in_d = True
                elif c == \"'\":
                    in_s = True
                elif c == '{':
                    depth += 1
                elif c == '}':
                    depth -= 1
                    if depth == 0:
                        return '\n'.join(collected)
            j += 1
    return None

for name in names:
    body = extract(name)
    if body is None:
        sys.stderr.write('EXTRACT_FAILED:' + name + '\n')
        sys.exit(1)
    print(body)
    print()
" "$MONITOR_SH" emit_transition_jsonl pane_tail_json emit_dispatch_jsonl > "$FUNCS_FILE"

if ! grep -q '^emit_transition_jsonl() {' "$FUNCS_FILE" || ! grep -q '^pane_tail_json() {' "$FUNCS_FILE" \
   || ! grep -q '^emit_dispatch_jsonl() {' "$FUNCS_FILE"; then
  echo "FAIL: could not extract emit_transition_jsonl/pane_tail_json/emit_dispatch_jsonl from $MONITOR_SH — function signatures may have changed"
  exit 1
fi

# --- Regression check: emit_dispatch_jsonl (dispatch.jsonl) must be
# untouched by this task — same original field set, no leakage of the new
# from/to/reason/TRANSITION_LOG concepts this task added as a sibling. Uses
# the same brace-depth-aware extraction, run standalone against the live
# file, so it isn't tripped up by the other two functions' embedded braces.
DISPATCH_BODY=$(python3 -c "
import sys
path = sys.argv[1]
name = 'emit_dispatch_jsonl'
lines = open(path).read().split('\n')
target = name + '() {'
start_idx = next((i for i, l in enumerate(lines) if l.strip() == target), None)
depth = 0
in_d = in_s = False
collected = []
for i in range(start_idx, len(lines)):
    line = lines[i]
    collected.append(line)
    j = 0
    while j < len(line):
        c = line[j]
        if in_d:
            if c == '\\\\':
                j += 2
                continue
            if c == '\"':
                in_d = False
        elif in_s:
            if c == \"'\":
                in_s = False
        else:
            if c == '\"':
                in_d = True
            elif c == \"'\":
                in_s = True
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    print('\n'.join(collected))
                    sys.exit(0)
        j += 1
" "$MONITOR_SH")

if [[ "$DISPATCH_BODY" == *"TRANSITION_LOG"* ]]; then
  check "emit_dispatch_jsonl is untouched — no TRANSITION_LOG/from-to-reason leakage" "fail"
elif [[ "$DISPATCH_BODY" == *"'state_age_s'"* && "$DISPATCH_BODY" == *"'pane_tail'"* && "$DISPATCH_BODY" == *"'queue_remaining'"* && "$DISPATCH_BODY" == *"DISPATCH_LOG"* ]]; then
  check "emit_dispatch_jsonl is untouched — no TRANSITION_LOG/from-to-reason leakage" "pass"
else
  check "emit_dispatch_jsonl is untouched — no TRANSITION_LOG/from-to-reason leakage" "fail"
fi

# Stub tmux so pane_tail_json needs no live session — deterministic pane tail.
tmux() {
  if [[ "$1" == "capture-pane" ]]; then
    printf 'line one\nline two\nline three\n'
  fi
}

# shellcheck disable=SC1090
source "$FUNCS_FILE"

TRANSITION_LOG="$SCRATCH_DIR/transitions.jsonl"

# --- Case A: normal transition, non-empty from/age ---
LAST_STATE_AGE="42"
LAST_DETECTION="state-file"
rm -f "$TRANSITION_LOG"
emit_transition_jsonl "verify-agent" "busy" "idle" "conductor:verify-agent"

python3 -c "
import json, re
with open('$TRANSITION_LOG') as f:
    rec = json.loads(f.readline())
assert rec['agent'] == 'verify-agent', rec
assert rec['from'] == 'busy', rec
assert rec['to'] == 'idle', rec
assert rec['reason'] == 'state-file', rec
assert rec['stateFileAgeS'] == 42, rec
assert rec['paneTail'] == ['line one', 'line two', 'line three'], rec
assert re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\$', rec['ts']), rec
" \
  && check "emit_transition_jsonl: normal transition has correct agent/from/to/reason/stateFileAgeS/paneTail/ts" "pass" \
  || check "emit_transition_jsonl: normal transition has correct agent/from/to/reason/stateFileAgeS/paneTail/ts" "fail"

# --- Case B: empty "from" (agent's first-ever observed value) -> JSON null ---
LAST_STATE_AGE="10"
LAST_DETECTION="regex"
rm -f "$TRANSITION_LOG"
emit_transition_jsonl "verify-agent" "" "busy" "conductor:verify-agent"

python3 -c "
import json
with open('$TRANSITION_LOG') as f:
    rec = json.loads(f.readline())
assert rec['from'] is None, rec
assert rec['to'] == 'busy', rec
" \
  && check "emit_transition_jsonl: empty from-state serializes as JSON null" "pass" \
  || check "emit_transition_jsonl: empty from-state serializes as JSON null" "fail"

# --- Case C: empty stateFileAgeS/to -> JSON null ---
LAST_STATE_AGE=""
LAST_DETECTION="pane-dead"
rm -f "$TRANSITION_LOG"
emit_transition_jsonl "verify-agent" "busy" "" "conductor:verify-agent"

python3 -c "
import json
with open('$TRANSITION_LOG') as f:
    rec = json.loads(f.readline())
assert rec['stateFileAgeS'] is None, rec
assert rec['to'] is None, rec
assert rec['reason'] == 'pane-dead', rec
" \
  && check "emit_transition_jsonl: empty stateFileAgeS/to-state serialize as JSON null" "pass" \
  || check "emit_transition_jsonl: empty stateFileAgeS/to-state serialize as JSON null" "fail"

# --- Case D: a write failure to TRANSITION_LOG must never abort the caller
# (matches the `>> "$TRANSITION_LOG" ... || true` convention). Point at a
# path whose parent directory does not exist, run the call in a subshell
# under this script's own `set -euo pipefail`, and check the subshell's own
# exit status — an unswallowed failure here would abort the subshell (caught
# below) rather than silently passing.
if (
    TRANSITION_LOG="$SCRATCH_DIR/no-such-subdir/transitions.jsonl"
    LAST_STATE_AGE="5"
    LAST_DETECTION="state-file"
    emit_transition_jsonl "verify-agent" "busy" "idle" "conductor:verify-agent"
  ) 2>/dev/null; then
  check "emit_transition_jsonl: a write failure (missing parent dir) never aborts the caller" "pass"
else
  check "emit_transition_jsonl: a write failure (missing parent dir) never aborts the caller" "fail"
fi

# --- Diff-guard: extract the literal poll-loop conditional and test it in
# isolation, against constructed PREV_TRANSITION_STATE states. Not copied by
# hand — grep-extracted from the live file so this can't silently drift from
# the real guard.
RAW_GUARD_LINE=$(grep -F '${PREV_TRANSITION_STATE[$name]+set}' "$MONITOR_SH" | head -1)
if [[ -z "$RAW_GUARD_LINE" ]]; then
  echo "FAIL: could not find the PREV_TRANSITION_STATE diff-guard line in $MONITOR_SH"
  exit 1
fi
read -r GUARD_LINE <<< "$RAW_GUARD_LINE"
GUARD_COND="${GUARD_LINE#if }"
GUARD_COND="${GUARD_COND%; then}"

would_emit() {
  # $1: key-state (unset|empty|value:<v>), $2: agent name, $3: this tick's LAST_STATE_VALUE
  local key_state="$1" name="$2" LAST_STATE_VALUE="$3"
  local -A PREV_TRANSITION_STATE=()
  case "$key_state" in
    unset) : ;;
    empty) PREV_TRANSITION_STATE[$name]="" ;;
    value:*) PREV_TRANSITION_STATE[$name]="${key_state#value:}" ;;
  esac
  if eval "$GUARD_COND"; then
    echo "yes"
  else
    echo "no"
  fi
}

[[ "$(would_emit unset agent1 idle)" == "no" ]] \
  && check "diff-guard: unset PREV_TRANSITION_STATE (agent's first tick) never emits" "pass" \
  || check "diff-guard: unset PREV_TRANSITION_STATE (agent's first tick) never emits" "fail"

[[ "$(would_emit value:idle agent1 idle)" == "no" ]] \
  && check "diff-guard: unchanged state (idle -> idle) never emits" "pass" \
  || check "diff-guard: unchanged state (idle -> idle) never emits" "fail"

[[ "$(would_emit value:busy agent1 idle)" == "yes" ]] \
  && check "diff-guard: changed state (busy -> idle) emits" "pass" \
  || check "diff-guard: changed state (busy -> idle) emits" "fail"

[[ "$(would_emit empty agent1 idle)" == "yes" ]] \
  && check "diff-guard: previously set-but-empty state (e.g. pane-dead) differing from current emits" "pass" \
  || check "diff-guard: previously set-but-empty state (e.g. pane-dead) differing from current emits" "fail"

[[ "$(would_emit empty agent1 '')" == "no" ]] \
  && check "diff-guard: set-but-empty state unchanged (both empty) never emits" "pass" \
  || check "diff-guard: set-but-empty state unchanged (both empty) never emits" "fail"

echo ""
echo "Passed: ${#PASS[@]}  Failed: ${#FAIL[@]}"
if [[ ${#FAIL[@]} -gt 0 ]]; then
  exit 1
fi
