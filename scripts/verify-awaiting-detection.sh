#!/usr/bin/env bash
# scripts/verify-awaiting-detection.sh — TASK-0231 / BUG-0013 repeatable check
# that scripts/monitor.sh's is_idle() classifies every pane in the shared
# fixture manifest (host-server/fixtures/awaiting-panes/manifest.json) the
# same way host-server/state.ts's detectAgentStatus does (that side is pinned
# by host-server/state.test.ts against the same manifest).
#
# monitor.sh cannot be `source`d directly: it calls load_agents/load_bg at
# top level (requires a live CONDUCTOR_DB) and ends in an unconditional
# `while true` poll loop. Like scripts/verify-transitions-jsonl-emit.sh, this
# script structurally extracts the functions is_idle() transitively needs —
# verbatim, from the live file, with a quote-aware brace-depth scan — into a
# throwaway harness. `tmux` is a stub executable placed first on PATH: it
# prints the fixture pane for `capture-pane` and the launch command name for
# `display-message`, and records (and fails the run on) any other invocation.
# It never touches a real tmux server. Scratch lives under ./tmp/ and is
# removed on exit. AWAITING_PATTERN / BUSY_PATTERN / IDLE_PATTERN are loaded
# by extracting the literal assignment lines from conductor.conf.
#
# Mapping of manifest expectations onto is_idle():
#   expected awaiting -> state file contains `awaiting` afterwards AND return 1
#   expected busy     -> state file NOT `awaiting` afterwards AND return 1
#   expected idle     -> return 0
#
# Usage: bash scripts/verify-awaiting-detection.sh
# Requires bash >= 4 (associative arrays) — same as monitor.sh itself.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
MONITOR_SH="$REPO/scripts/monitor.sh"
CONF="$REPO/conductor.conf"
FIXTURE_DIR="$REPO/host-server/fixtures/awaiting-panes"
MANIFEST="$FIXTURE_DIR/manifest.json"
SCRATCH_DIR="$REPO/tmp/verify-awaiting-detection"

if (( BASH_VERSINFO[0] < 4 )); then
  echo "FAIL: bash >= 4 required (found $BASH_VERSION); run with e.g. /opt/homebrew/bin/bash"
  exit 1
fi

rm -rf "$SCRATCH_DIR"
mkdir -p "$SCRATCH_DIR/bin" "$SCRATCH_DIR/state"
cleanup() { rm -rf "$SCRATCH_DIR"; }
trap cleanup EXIT

PASS=()
FAIL=()
check() {
  local name="$1" result="$2" detail="${3:-}"
  if [[ "$result" == "pass" ]]; then
    PASS+=("$name")
    echo "  PASS: $name"
  else
    FAIL+=("$name")
    echo "  FAIL: $name${detail:+ — $detail}"
  fi
}

# --- Extract the needed functions verbatim from the live monitor.sh ---------
# Quote-aware (bash '...' / "..." strings) and comment-aware ('#' at a token
# start outside quotes skips the rest of the line, so an apostrophe in a
# comment such as "agent's" cannot flip the quote state).
EXTRACTOR="$SCRATCH_DIR/extract.py"
cat > "$EXTRACTOR" <<'PYEOF'
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
                if c == '\\':
                    j += 2
                    continue
                if c == '"':
                    in_d = False
            elif in_s:
                if c == "'":
                    in_s = False
            else:
                if c == '\\':
                    j += 2
                    continue
                if c == '"':
                    in_d = True
                elif c == "'":
                    in_s = True
                elif c == '#' and (j == 0 or line[j - 1] in ' \t'):
                    break
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
PYEOF

FUNCS=(is_shell_cmd launch_cmd_name agent_type agent_idle_pattern agent_busy_pattern
       agent_awaiting_pattern pane_dead pane_tail5 awaiting_window busy_visible is_idle)
FUNCS_FILE="$SCRATCH_DIR/extracted-funcs.sh"
if ! python3 "$EXTRACTOR" "$MONITOR_SH" "${FUNCS[@]}" > "$FUNCS_FILE"; then
  echo "FAIL: could not extract ${FUNCS[*]} from $MONITOR_SH — function signatures may have changed"
  exit 1
fi
for f in "${FUNCS[@]}"; do
  if ! grep -q "^${f}() {" "$FUNCS_FILE"; then
    echo "FAIL: extracted file is missing ${f}()"
    exit 1
  fi
done
if ! bash -n "$FUNCS_FILE"; then
  echo "FAIL: extracted functions do not parse (extractor boundary error)"
  exit 1
fi

# --- Load the real patterns from conductor.conf (literal assignment lines) --
for var in AWAITING_PATTERN BUSY_PATTERN IDLE_PATTERN; do
  line="$(grep -E "^${var}=" "$CONF" | head -1)"
  if [[ -z "$line" ]]; then
    echo "FAIL: could not find a literal ${var}= line in $CONF"
    exit 1
  fi
  eval "$line"
done
POLL_INTERVAL=15

# --- Stub tmux: never touches a real server --------------------------------
STUB_CALLS="$SCRATCH_DIR/tmux-calls.log"
: > "$STUB_CALLS"
cat > "$SCRATCH_DIR/bin/tmux" <<'STUBEOF'
#!/usr/bin/env bash
case "${1:-}" in
  capture-pane)
    cat "$FIXTURE_PANE_FILE"
    ;;
  display-message)
    printf '%s\n' "$FIXTURE_CMD_NAME"
    ;;
  *)
    printf '%s\n' "UNEXPECTED: $*" >> "$STUB_CALLS_FILE"
    ;;
esac
exit 0
STUBEOF
chmod +x "$SCRATCH_DIR/bin/tmux"
export STUB_CALLS_FILE="$STUB_CALLS"
export PATH="$SCRATCH_DIR/bin:$PATH"
if [[ "$(command -v tmux)" != "$SCRATCH_DIR/bin/tmux" ]]; then
  echo "FAIL: stub tmux is not first on PATH (got $(command -v tmux)); refusing to run"
  exit 1
fi

# Harness globals is_idle reads.
STATE_DIR="$SCRATCH_DIR/state"
LOG_FILE="$SCRATCH_DIR/monitor.log"
log() { :; }
debug() { :; }
declare -A AGENT_CMDS=()

# shellcheck disable=SC1090
source "$FUNCS_FILE"

set_mtime_ago() {
  # $1: file, $2: seconds ago (macOS/Linux portable via python3)
  python3 -c "
import os, sys, time
p, age = sys.argv[1], float(sys.argv[2])
t = time.time() - age
os.utime(p, (t, t))
" "$1" "$2"
}

# --- Run every manifest case through is_idle --------------------------------
CASES_TSV="$SCRATCH_DIR/cases.tsv"
python3 -c "
import json, sys
for c in json.load(open(sys.argv[1])):
    sf = c['stateFile'] if c['stateFile'] is not None else '-'
    print('\t'.join([c['name'], c['launch'], sf, str(c['ageS']), c['pane'], c['expected']['state']]))
" "$MANIFEST" > "$CASES_TSV"

TOTAL=0
while IFS=$'\t' read -r name launch state_file age_s pane expected; do
  TOTAL=$((TOTAL + 1))
  sf_path="$STATE_DIR/agent-x.state"
  rm -f "$sf_path"
  if [[ "$state_file" != "-" ]]; then
    printf '%s\n' "$state_file" > "$sf_path"
    set_mtime_ago "$sf_path" "$age_s"
  fi
  AGENT_CMDS=([agent-x]="$launch")
  export FIXTURE_PANE_FILE="$FIXTURE_DIR/$pane"
  export FIXTURE_CMD_NAME="$launch"

  is_idle "conductor:=agent-x" agent-x agent-x
  rc=$?
  after=""
  [[ -f "$sf_path" ]] && after="$(tr -d '\r\n' < "$sf_path")"

  label="$name ($launch, state-file ${state_file/#-/absent} -> $expected)"
  case "$expected" in
    awaiting)
      if [[ $rc -eq 1 && "$after" == "awaiting" ]]; then
        check "$label" pass
      else
        check "$label" fail "rc=$rc state-file-after='${after}' (want rc=1, 'awaiting')"
      fi
      ;;
    busy)
      if [[ $rc -eq 1 && "$after" != "awaiting" ]]; then
        check "$label" pass
      else
        check "$label" fail "rc=$rc state-file-after='${after}' (want rc=1, not 'awaiting')"
      fi
      ;;
    idle)
      if [[ $rc -eq 0 ]]; then
        check "$label" pass
      else
        check "$label" fail "rc=$rc state-file-after='${after}' (want rc=0)"
      fi
      ;;
    *)
      check "$label" fail "unsupported expected state '$expected'"
      ;;
  esac
done < "$CASES_TSV"

if [[ $TOTAL -eq 0 ]]; then
  check "manifest yielded at least one case" fail "no cases parsed from $MANIFEST"
fi

# The stub must only ever have been asked for capture-pane / display-message.
if [[ -s "$STUB_CALLS" ]]; then
  check "stub tmux saw only capture-pane/display-message" fail "$(head -3 "$STUB_CALLS" | tr '\n' ';')"
else
  check "stub tmux saw only capture-pane/display-message" pass
fi

echo ""
echo "Passed: ${#PASS[@]}  Failed: ${#FAIL[@]}"
if [[ ${#FAIL[@]} -gt 0 ]]; then
  exit 1
fi
