#!/usr/bin/env bash
# scripts/verify-last-payload.sh — TASK-0229 hermetic round-trip check for the
# dashboard's "last payload" feature (ROADMAP-0027).
#
# Part 1 (hook): pipes representative Claude Code hook payloads into the REAL
# hooks/on-prompt-submit.js / on-stop.js / on-session-start.js / on-stop-failure.js
# (not copies) against a throwaway state + log dir under ./tmp/ and asserts the
# resulting <agent>.meta.json `last_prompt` behavior: persisted, multi-line
# verbatim, paste wrapper unwrapped, replaced by a later prompt, retained across
# non-prompt events, never overwritten by an empty/whitespace/missing/non-string
# prompt, capped at 2000 chars, never copied into hooks.jsonl, and hooks always
# exit 0 (non-JSON stdin, corrupt pre-existing meta.json).
#
# Part 2 (suites): runs the host-server and frontend unit suites for the modules
# the roadmap touched (existence-checked; a missing file fails loudly). Only
# last-payload suites are executed, so a red in an unrelated file elsewhere in
# the tree can never be blamed on this feature; a failure here always is one.
# A failed suite is retried once to rule out a transient red caused by another
# session editing files mid-run; a retry-pass is reported explicitly.
#
# Hermeticity: no tmux (TMUX is unset for every hook run), no DB, no network,
# no live logs/state, and ~/.claude is never read or written. The script refuses
# to run unless its state dir resolves under $REPO/tmp/. Safe to run while the
# agent fleet is up. The human live recipe (install-hooks, restart agents, type,
# Enter, reload) is documented in hooks/README.md ("Verifying last_prompt") and
# is NOT performed here.
#
# Usage: bash scripts/verify-last-payload.sh [--skip-suites]
set -euo pipefail

SKIP_SUITES=0
for arg in "$@"; do
  case "$arg" in
    --skip-suites) SKIP_SUITES=1 ;;
    -h|--help) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d'; exit 0 ;;
    *) echo "unknown argument: $arg (usage: verify-last-payload.sh [--skip-suites])" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRATCH_DIR="$REPO/tmp/verify-last-payload"
STATE_DIR="$SCRATCH_DIR/state"
LOG_DIR="$SCRATCH_DIR/logs"
AGENT="verify-agent"

rm -rf "$SCRATCH_DIR"
mkdir -p "$STATE_DIR" "$LOG_DIR"

# Hermeticity guard: the resolved state/log dirs must live under $REPO/tmp/.
for d in "$STATE_DIR" "$LOG_DIR"; do
  resolved="$(cd "$d" && pwd -P)"
  case "$resolved" in
    "$(cd "$REPO/tmp" && pwd -P)"/*) ;;
    *) echo "FAIL: refusing to run, $d resolves outside $REPO/tmp/ ($resolved)" >&2; exit 1 ;;
  esac
done

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

# run_hook <hook-script> <agent> <stdin-string>; echoes nothing, returns the hook's exit code.
run_hook() {
  local script="$1" agent="$2" input="$3"
  printf '%s' "$input" | env -u TMUX \
    CONDUCTOR_AGENT_NAME="$agent" \
    CONDUCTOR_STATE_DIR="$STATE_DIR" \
    CONDUCTOR_LOG_DIR="$LOG_DIR" \
    node "$REPO/hooks/$script" >/dev/null 2>&1
}

# meta_eval <agent> <js-expr over m>; prints JSON.stringify(result), or NOFILE / ERROR.
meta_eval() {
  local agent="$1" expr="$2" file="$STATE_DIR/$1.meta.json"
  [[ -f "$file" ]] || { echo "NOFILE"; return 0; }
  node -e '
    const fs = require("fs");
    let m;
    try { m = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (e) { console.log("ERROR"); process.exit(0); }
    const v = new Function("m", "return (" + process.argv[2] + ")")(m);
    console.log(JSON.stringify(v === undefined ? null : v));
  ' "$file" "$expr" 2>/dev/null || echo "ERROR"
}

# meta_true <agent> <js-expr>: success iff the expression is truthy.
meta_true() { [[ "$(meta_eval "$1" "$2")" == "true" ]]; }

state_of() { tr -d '\n' < "$STATE_DIR/$1.state" 2>/dev/null || true; }

echo "== Part 1: hook -> sidecar (real hooks, temp dir $SCRATCH_DIR) =="

# (a) normal prompt
run_hook on-prompt-submit.js "$AGENT" '{"prompt":"hello world","session_id":"s1","transcript_path":"/x.jsonl"}' && rc=0 || rc=$?
[[ $rc -eq 0 ]] && meta_true "$AGENT" 'm.last_prompt && m.last_prompt.text === "hello world"' \
  && check "normal prompt: last_prompt.text persisted" "pass" \
  || check "normal prompt: last_prompt.text persisted" "fail"
meta_true "$AGENT" '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(m.last_prompt.ts) && !isNaN(Date.parse(m.last_prompt.ts))' \
  && check "normal prompt: last_prompt.ts is an ISO-8601 timestamp" "pass" \
  || check "normal prompt: last_prompt.ts is an ISO-8601 timestamp" "fail"
meta_true "$AGENT" 'm.session_id === "s1" && m.transcript_path === "/x.jsonl"' \
  && check "normal prompt: session_id / transcript_path preserved alongside" "pass" \
  || check "normal prompt: session_id / transcript_path preserved alongside" "fail"
[[ "$(state_of "$AGENT")" == "busy" ]] \
  && check "normal prompt: .state file reads busy" "pass" \
  || check "normal prompt: .state file reads busy" "fail"

# (b) multi-line prompt stored verbatim
run_hook on-prompt-submit.js "$AGENT" '{"prompt":"line one\nline two"}' || true
meta_true "$AGENT" 'm.last_prompt.text === "line one\nline two"' \
  && check "multi-line prompt stored verbatim" "pass" \
  || check "multi-line prompt stored verbatim" "fail"

# (c) real paste-wrapped prompt is unwrapped
run_hook on-prompt-submit.js "$AGENT" '{"prompt":"\n\n<pasted_content id=\"1\">\nline one\nline two\n</pasted_content id=\"1\">\n"}' || true
meta_true "$AGENT" 'm.last_prompt.text === "line one\nline two"' \
  && check "paste-wrapped prompt: wrapper stripped, inner text kept" "pass" \
  || check "paste-wrapped prompt: wrapper stripped, inner text kept" "fail"

# (d) a later prompt replaces an earlier one (and prompt_id is kept when supplied)
run_hook on-prompt-submit.js "$AGENT" '{"prompt":"first prompt"}' || true
FIRST_TS="$(meta_eval "$AGENT" 'm.last_prompt.ts')"
run_hook on-prompt-submit.js "$AGENT" '{"prompt":"second prompt","prompt_id":"pid-2"}' || true
meta_true "$AGENT" 'm.last_prompt.text === "second prompt"' \
  && check "later prompt replaces the earlier one" "pass" \
  || check "later prompt replaces the earlier one" "fail"
SECOND_TS="$(meta_eval "$AGENT" 'm.last_prompt.ts')"
[[ "$SECOND_TS" == \"* && "$FIRST_TS" == \"* && ( "$SECOND_TS" == "$FIRST_TS" || "$SECOND_TS" > "$FIRST_TS" ) ]] \
  && check "later prompt: ts is not older than the earlier one" "pass" \
  || check "later prompt: ts is not older than the earlier one" "fail"
meta_true "$AGENT" 'm.last_prompt.prompt_id === "pid-2"' \
  && check "later prompt: prompt_id stored when the payload carries one" "pass" \
  || check "later prompt: prompt_id stored when the payload carries one" "fail"

# (e) non-prompt events leave last_prompt untouched
BEFORE="$(meta_eval "$AGENT" 'm.last_prompt')"
run_hook on-stop.js "$AGENT" '{"session_id":"s1","transcript_path":"/x.jsonl","hook_event_name":"Stop"}' && rc=0 || rc=$?
AFTER="$(meta_eval "$AGENT" 'm.last_prompt')"
[[ $rc -eq 0 && "$BEFORE" == "$AFTER" && "$BEFORE" != "NOFILE" && "$BEFORE" != "null" ]] \
  && check "on-stop.js (no prompt) leaves last_prompt deep-equal" "pass" \
  || check "on-stop.js (no prompt) leaves last_prompt deep-equal" "fail"
[[ "$(state_of "$AGENT")" == "idle" ]] \
  && check "on-stop.js writes idle" "pass" \
  || check "on-stop.js writes idle" "fail"
run_hook on-session-start.js "$AGENT" '{"session_id":"s2","transcript_path":"/y.jsonl","model":"claude-test"}' && rc=0 || rc=$?
AFTER="$(meta_eval "$AGENT" 'm.last_prompt')"
[[ $rc -eq 0 && "$BEFORE" == "$AFTER" ]] \
  && check "on-session-start.js leaves last_prompt deep-equal" "pass" \
  || check "on-session-start.js leaves last_prompt deep-equal" "fail"
run_hook on-stop-failure.js "$AGENT" '{"session_id":"s2"}' && rc=0 || rc=$?
AFTER="$(meta_eval "$AGENT" 'm.last_prompt')"
[[ $rc -eq 0 && "$BEFORE" == "$AFTER" ]] \
  && check "on-stop-failure.js leaves last_prompt deep-equal" "pass" \
  || check "on-stop-failure.js leaves last_prompt deep-equal" "fail"

# (f) empty / whitespace / missing / non-string prompts never overwrite
OK=1
for payload in '{"prompt":""}' '{"prompt":"   \n\t  "}' '{"session_id":"s3"}' '{"prompt":123}' '{"prompt":null}' '{"prompt":["a"]}'; do
  run_hook on-prompt-submit.js "$AGENT" "$payload" && rc=0 || rc=$?
  AFTER="$(meta_eval "$AGENT" 'm.last_prompt')"
  if [[ $rc -ne 0 || "$AFTER" != "$BEFORE" ]]; then
    OK=0
    echo "    (payload $payload changed last_prompt: $AFTER)"
  fi
done
[[ $OK -eq 1 ]] \
  && check "empty / whitespace / missing / non-string prompts do not overwrite last_prompt" "pass" \
  || check "empty / whitespace / missing / non-string prompts do not overwrite last_prompt" "fail"

FRESH="verify-fresh"
for payload in '{"prompt":""}' '{"prompt":"  "}' '{"prompt":123}' '{"session_id":"s9"}'; do
  run_hook on-prompt-submit.js "$FRESH" "$payload" || true
done
[[ "$(meta_eval "$FRESH" 'm.last_prompt === undefined')" == "true" ]] \
  && check "fresh state dir: empty/non-string prompts do not create last_prompt" "pass" \
  || check "fresh state dir: empty/non-string prompts do not create last_prompt" "fail"

# (g) cap: 2500 chars -> 2000 (1999 + the ellipsis marker)
LONG_PAYLOAD="$(node -e 'process.stdout.write(JSON.stringify({ prompt: "a".repeat(2500) }))')"
run_hook on-prompt-submit.js "$AGENT" "$LONG_PAYLOAD" || true
meta_true "$AGENT" 'm.last_prompt.text.length === 2000 && m.last_prompt.text.endsWith("…") && m.last_prompt.text.slice(0, 1999) === "a".repeat(1999)' \
  && check "over-long prompt capped at 2000 chars (1999 + ellipsis)" "pass" \
  || check "over-long prompt capped at 2000 chars (1999 + ellipsis)" "fail"

# (h) the prompt text never reaches hooks.jsonl
MARKER="SYNTHETIC-PROMPT-MARKER-7f3a"
run_hook on-prompt-submit.js "$AGENT" "{\"prompt\":\"$MARKER do not log me\"}" || true
meta_true "$AGENT" "m.last_prompt.text.startsWith(\"$MARKER\")" \
  && check "marker prompt reached the sidecar (precondition for the audit-log check)" "pass" \
  || check "marker prompt reached the sidecar (precondition for the audit-log check)" "fail"
if [[ -s "$LOG_DIR/hooks.jsonl" ]] && ! grep -rqF "$MARKER" "$LOG_DIR" \
   && ! grep -qF "hello world" "$LOG_DIR/hooks.jsonl"; then
  check "hooks.jsonl carries no prompt text" "pass"
else
  check "hooks.jsonl carries no prompt text" "fail"
fi
node -e '
  const lines = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
  const keys = ["agent", "event", "new_state", "prev_state", "ts"];
  const okShape = lines.every(r => JSON.stringify(Object.keys(r).sort()) === JSON.stringify(keys));
  const sawPrompt = lines.some(r => r.event === "prompt-submit" && r.new_state === "busy");
  process.exit(okShape && sawPrompt ? 0 : 1);
' "$LOG_DIR/hooks.jsonl" 2>/dev/null \
  && check "hooks.jsonl records prompt-submit transitions with the unchanged 5-field shape" "pass" \
  || check "hooks.jsonl records prompt-submit transitions with the unchanged 5-field shape" "fail"

# (i) hooks always exit 0: non-JSON stdin, empty stdin, corrupt pre-existing meta.json
OK=1
run_hook on-prompt-submit.js "$AGENT" 'this is not json' && rc=0 || rc=$?; [[ $rc -eq 0 ]] || OK=0
run_hook on-prompt-submit.js "$AGENT" '' && rc=0 || rc=$?; [[ $rc -eq 0 ]] || OK=0
CORRUPT="verify-corrupt"
printf '{not valid json' > "$STATE_DIR/$CORRUPT.meta.json"
run_hook on-prompt-submit.js "$CORRUPT" '{"prompt":"after corruption"}' && rc=0 || rc=$?; [[ $rc -eq 0 ]] || OK=0
[[ $OK -eq 1 ]] \
  && check "hooks exit 0 on non-JSON stdin, empty stdin and a corrupt pre-existing meta.json" "pass" \
  || check "hooks exit 0 on non-JSON stdin, empty stdin and a corrupt pre-existing meta.json" "fail"
meta_true "$CORRUPT" 'm.last_prompt && m.last_prompt.text === "after corruption"' \
  && check "corrupt meta.json is recovered: new last_prompt written" "pass" \
  || check "corrupt meta.json is recovered: new last_prompt written" "fail"

# --- Part 2: related unit suites ---------------------------------------------
HOST_SUITES=(
  hookLastPrompt.test.ts
  lastPrompt.test.ts
  sseLastPromptParity.test.ts
  lastPromptContract.test.ts
  agentDiff.test.ts
)
FRONTEND_LIB_SUITES=(
  src/lib/lastPayload.test.ts
  src/components/AddTaskForm.test.tsx
)
FRONTEND_AGENTLIST_SUITE="src/components/AgentList.test.tsx"
# vitest -t is a regex over "describe > test" names; it applies to every file in
# the run, so AgentList (scoped) is run separately from the whole-file suites.
FRONTEND_AGENTLIST_FILTER='last[- ]payload|lastPrompt|TASK-022[5-8]'

# run_suite <label> <dir> <cmd...>: runs the command, retries once on failure,
# records a check, and echoes the summary lines (or the output tail on failure).
run_suite() {
  local label="$1" dir="$2"
  shift 2
  local out="$SCRATCH_DIR/suite-${label//[^A-Za-z0-9]/_}.log" attempt=1 status=fail
  while [[ $attempt -le 2 ]]; do
    if (cd "$dir" && NO_COLOR=1 FORCE_COLOR=0 "$@") >"$out" 2>&1; then
      status=pass
      break
    fi
    attempt=$((attempt + 1))
  done
  if [[ "$status" == "pass" ]]; then
    local note=""
    [[ $attempt -eq 2 ]] && note=" (passed on retry, first run was red: possible transient edit by another session)"
    grep -E '^(# |ℹ )(tests|pass|fail)|Test Files|^\s*Tests ' "$out" | sed 's/^/      /' || true
    check "suite: $label$note" "pass"
  else
    echo "      --- last 25 lines of $label ---"
    tail -n 25 "$out" | sed 's/^/      /'
    check "suite: $label (last-payload suite FAILED; both attempts red)" "fail"
  fi
}

if [[ $SKIP_SUITES -eq 1 ]]; then
  echo ""
  echo "== Part 2: suites SKIPPED (--skip-suites) =="
else
  echo ""
  echo "== Part 2: related unit suites =="
  MISSING=0
  for f in "${HOST_SUITES[@]}"; do
    [[ -f "$REPO/host-server/$f" ]] || { echo "  MISSING suite file: host-server/$f"; MISSING=1; }
  done
  for f in "${FRONTEND_LIB_SUITES[@]}" "$FRONTEND_AGENTLIST_SUITE"; do
    [[ -f "$REPO/frontend/$f" ]] || { echo "  MISSING suite file: frontend/$f"; MISSING=1; }
  done
  if [[ $MISSING -eq 1 ]]; then
    check "all listed suite files exist (update HOST_SUITES/FRONTEND_* if a task renamed one)" "fail"
  else
    check "all listed suite files exist" "pass"
    run_suite "host-server: ${HOST_SUITES[*]}" "$REPO/host-server" \
      node --import tsx/esm --test "${HOST_SUITES[@]}"
    run_suite "frontend: lastPayload + AddTaskForm" "$REPO/frontend" \
      npx --no-install vitest run "${FRONTEND_LIB_SUITES[@]}"
    run_suite "frontend: AgentList (-t last-payload/lastPrompt)" "$REPO/frontend" \
      npx --no-install vitest run "$FRONTEND_AGENTLIST_SUITE" -t "$FRONTEND_AGENTLIST_FILTER"
  fi
fi

echo ""
echo "Passed: ${#PASS[@]}  Failed: ${#FAIL[@]}"
if [[ ${#FAIL[@]} -gt 0 ]]; then
  echo "Failed checks:"
  printf '  - %s\n' "${FAIL[@]}"
  exit 1
fi
