#!/usr/bin/env bash
# verify-dev-commands.sh — Regression tests for
# skills/dev-commands/scripts/dev-commands.sh's four subcommands
# (list/status/tail/restart).
#
# Modes:
#   (no flags)  Default, fully hermetic — no network, no tmux. Exercises the
#               deterministic parts of the standalone script directly: the
#               CONDUCTOR_STATE_DIR/CONDUCTOR_LOG_DIR FATAL guards, the
#               offline list/status/tail fallback paths (BACKEND_PORT points
#               at a port nothing listens on so curl fails deterministically),
#               tail's -n argument-order flexibility and escape stripping,
#               slug resolution (TASK-0196), list [--all] project scoping
#               (TASK-0202, offline paths only), and static text assertions
#               on dev-commands.sh/SKILL.md that catch cheap regressions
#               (the restart dispatch, the four-subcommand usage line, the
#               retired idle/busy/running vocabulary, and --all plus the
#               restart exit codes being documented). This mode also runs
#               two sibling verifiers as sub-steps and folds their pass/fail
#               into this script's own summary:
#                 - scripts/verify-dev-commands-restart.sh — the online
#                   `restart`/`status`/`tail` subcommands against a Node
#                   stub server (still hermetic: no real network or tmux)
#                 - scripts/verify-dev-commands-skill-frontmatter.sh —
#                   SKILL.md's disable-model-invocation frontmatter
#               scripts/verify-dev-commands-install.sh and
#               scripts/verify-bg-liveness.sh are standalone siblings and are
#               NOT folded in here (the latter touches a real, if private,
#               tmux socket); see scripts/README.md for how to run them.
#   --live      Opt-in (TASK-0208 Step 3). Stands up an isolated throwaway
#               host-server + private tmux world under
#               ./tmp/verify-dev-commands/live/ (its own conductor.conf,
#               DB_PATH, STATE_DIR, LOG_DIR, SESSION_NAME and tmux socket dir,
#               via scripts/lib/verify-dev-commands-live.sh's run_live_scenario)
#               and runs the agent-driven bg-process-restart scenario end to
#               end through the real API, real tmux and the real
#               dev-commands.sh client: project-scoped list/list --all, a
#               killed process reading exited, escape-free tail, a successful
#               agent restart (marker + audit + liveness), an immediate
#               cooldown-skipped retry (exit 5, no second marker), a
#               cross-project restart by slug (exit 3, denied audit), an
#               unknown X-Conductor-Agent header (403), a header-less
#               dashboard restart inside the agent cooldown (audited
#               callerKind:dashboard), a launchCmd containing a double quote,
#               $HOME and a backtick running literally (TASK-0190's quoting
#               fix), and GET /api/status reporting lastRestart with the
#               right caller. Never touches the user's real conductor.conf,
#               DB, tmux server/session, or port 8788/4321 — see that file's
#               header for the isolation and refusal guards. Prints
#               "SKIPPED" (exit 0, not a failure) when tmux/node/jq is
#               missing, host-server deps aren't installed, or the chosen
#               port (default 18789, override via VERIFY_LIVE_PORT) is busy.
#               An unknown flag prints usage and exits 2.
#
# Usage: bash scripts/verify-dev-commands.sh [--live]
# Artifacts land in ./tmp/verify-dev-commands/ (gitignored), never /tmp.
set -uo pipefail

# ---------------------------------------------------------------------------
# Flag parsing. The only recognized flag is --live (TASK-0208); anything else
# is a usage error. This runs before any side effects so a bad flag fails
# fast. --live itself is not yet implemented (see header comment) — it is
# just recognized here so the flag plumbing is in place ahead of Step 3.
# ---------------------------------------------------------------------------
LIVE_MODE=0
for arg in "$@"; do
  case "$arg" in
    --live)
      LIVE_MODE=1
      ;;
    *)
      echo "Usage: bash scripts/verify-dev-commands.sh [--live]" >&2
      echo "Unknown flag: $arg" >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_CMD="$REPO/skills/dev-commands/scripts/dev-commands.sh"
VERIFY_DIR="$REPO/tmp/verify-dev-commands"
STATE_DIR="$VERIFY_DIR/state"
LOG_DIR="$VERIFY_DIR/log"

rm -rf "$VERIFY_DIR"
mkdir -p "$STATE_DIR" "$LOG_DIR"

# A port nothing listens on, so every curl call in this script fails fast
# and deterministically exercises the offline fallback path regardless of
# whether a real host-server happens to be running on the dev machine.
UNUSED_PORT=18788

FAILURES=0
fail() {
  echo "[verify-dev-commands] FAIL: $1"
  FAILURES=$((FAILURES + 1))
}
pass() {
  echo "[verify-dev-commands] PASS: $1"
}

# ---------------------------------------------------------------------------
# Test 1: FATAL guard when CONDUCTOR_STATE_DIR is unset
# ---------------------------------------------------------------------------
out="$(env -u CONDUCTOR_STATE_DIR CONDUCTOR_LOG_DIR="$LOG_DIR" BACKEND_PORT="$UNUSED_PORT" bash "$DEV_CMD" list 2>&1)"
rc=$?
if [[ $rc -ne 0 && "$out" == *"FATAL: CONDUCTOR_STATE_DIR"* ]]; then
  pass "missing CONDUCTOR_STATE_DIR -> FATAL message + nonzero exit"
else
  fail "missing CONDUCTOR_STATE_DIR did not produce the expected FATAL message (rc=$rc, out=$out)"
fi

# ---------------------------------------------------------------------------
# Test 2: FATAL guard when CONDUCTOR_LOG_DIR is unset
# ---------------------------------------------------------------------------
out="$(env -u CONDUCTOR_LOG_DIR CONDUCTOR_STATE_DIR="$STATE_DIR" BACKEND_PORT="$UNUSED_PORT" bash "$DEV_CMD" list 2>&1)"
rc=$?
if [[ $rc -ne 0 && "$out" == *"FATAL: CONDUCTOR_LOG_DIR"* ]]; then
  pass "missing CONDUCTOR_LOG_DIR -> FATAL message + nonzero exit"
else
  fail "missing CONDUCTOR_LOG_DIR did not produce the expected FATAL message (rc=$rc, out=$out)"
fi

# From here on, both env vars are set; export for the rest of the script.
export CONDUCTOR_STATE_DIR="$STATE_DIR"
export CONDUCTOR_LOG_DIR="$LOG_DIR"
export BACKEND_PORT="$UNUSED_PORT"

# ---------------------------------------------------------------------------
# Test 3: `list` offline with no state files registered
# ---------------------------------------------------------------------------
out="$(bash "$DEV_CMD" list 2>&1)"
if [[ "$out" == *"No background processes registered yet."* ]]; then
  pass "list with empty state dir -> 'no bg processes registered' message"
else
  fail "list with empty state dir did not print the empty-registry message (out=$out)"
fi

# ---------------------------------------------------------------------------
# Test 4: `list` offline glob fallback with fake state files
# ---------------------------------------------------------------------------
echo -n "running" > "$STATE_DIR/bg-npm-dev.state"
echo -n "exited" > "$STATE_DIR/bg-vite.state"
out="$(bash "$DEV_CMD" list 2>&1)"
if [[ "$out" == *"npm-dev — state: running"* && "$out" == *"vite — state: exited"* ]]; then
  pass "list offline fallback globs bg-*.state and prints name + state"
else
  fail "list offline fallback did not print expected name/state pairs (out=$out)"
fi

# ---------------------------------------------------------------------------
# Test 5: `status <name>` for a name with no state file
# ---------------------------------------------------------------------------
out="$(bash "$DEV_CMD" status ghost 2>&1)"
rc=$?
if [[ $rc -ne 0 && "$out" == *"No state file for 'ghost'"* ]]; then
  pass "status for unregistered name -> clear message + nonzero exit"
else
  fail "status for unregistered name did not produce the expected message (rc=$rc, out=$out)"
fi

# ---------------------------------------------------------------------------
# Test 6: `status <name>` for a registered name, host-server unreachable
# ---------------------------------------------------------------------------
out="$(bash "$DEV_CMD" status npm-dev 2>&1)"
if [[ "$out" == *"State file (bg-npm-dev.state, may lag up to one poll interval):"* \
   && "$out" == *"running"* \
   && "$out" == *"alive in its window at the last poll"* \
   && "$out" == *"Live cross-check unavailable (host-server unreachable)"* ]]; then
  pass "status for registered name prints state file + labeled offline cross-check"
else
  fail "status for registered name did not print expected labeled output (out=$out)"
fi

# Offline status interprets each state value in the real vocabulary (TASK-0204);
# a pre-TASK-0191 value (alive/idle/busy) is printed as-is and flagged legacy.
out="$(bash "$DEV_CMD" status vite 2>&1)"
if [[ "$out" == *"  exited  (window open but the process is gone"* ]]; then
  pass "status offline interprets state 'exited'"
else
  fail "status offline did not interpret 'exited' (out=$out)"
fi
echo -n "dead" > "$STATE_DIR/bg-zombie.state"
out="$(bash "$DEV_CMD" status zombie 2>&1)"
if [[ "$out" == *"  dead  (window not found)"* ]]; then
  pass "status offline interprets state 'dead'"
else
  fail "status offline did not interpret 'dead' (out=$out)"
fi
echo -n "busy" > "$STATE_DIR/bg-zombie.state"
out="$(bash "$DEV_CMD" status zombie 2>&1)"
if [[ "$out" == *"  busy  (legacy value)"* ]]; then
  pass "status offline flags a pre-TASK-0191 value as legacy"
else
  fail "status offline did not flag 'busy' as legacy (out=$out)"
fi
rm -f "$STATE_DIR/bg-zombie.state"

# ---------------------------------------------------------------------------
# Test 7: `tail <name>` for a name with no log file
# ---------------------------------------------------------------------------
out="$(bash "$DEV_CMD" tail ghost 2>&1)"
rc=$?
if [[ $rc -ne 0 && "$out" == *"No log file for 'ghost'"* ]]; then
  pass "tail for unregistered name -> clear message + nonzero exit"
else
  fail "tail for unregistered name did not produce the expected message (rc=$rc, out=$out)"
fi

# ---------------------------------------------------------------------------
# Test 8: `tail <name>` default line count
# ---------------------------------------------------------------------------
printf 'line1\nline2\nline3\nline4\nline5\n' > "$LOG_DIR/bg-npm-dev.log"
out="$(bash "$DEV_CMD" tail npm-dev 2>/dev/null)"
if [[ "$out" == "$(printf 'line1\nline2\nline3\nline4\nline5')" ]]; then
  pass "tail with no -n prints the whole (short) log via default -n 50"
else
  fail "tail default output did not match the log file contents (out=$out)"
fi

# Offline tail announces the raw-log fallback on stderr (stdout stays the log).
err="$(bash "$DEV_CMD" tail npm-dev 2>&1 >/dev/null)"
if [[ "$err" == *"Note: host-server unreachable; showing the raw log with a best-effort escape strip."* ]]; then
  pass "tail offline prints the best-effort-strip note on stderr"
else
  fail "tail offline did not print the fallback note (err=$err)"
fi

# ---------------------------------------------------------------------------
# Test 9: `tail <name> -n N` accepts -n in either argument order
# ---------------------------------------------------------------------------
seq 1 10 > "$LOG_DIR/bg-npm-dev.log"
expected="$(printf '8\n9\n10')"

out_after="$(bash "$DEV_CMD" tail npm-dev -n 3 2>/dev/null)"
if [[ "$out_after" == "$expected" ]]; then
  pass "tail <name> -n N (options after name) returns the last N lines"
else
  fail "tail <name> -n N (options after name) mismatch (out=$out_after)"
fi

out_before="$(bash "$DEV_CMD" tail -n 3 npm-dev 2>/dev/null)"
if [[ "$out_before" == "$expected" ]]; then
  pass "tail -n N <name> (options before name) returns the last N lines"
else
  fail "tail -n N <name> (options before name) mismatch (out=$out_before)"
fi

# -n must be a positive integer (TASK-0204): anything else is a usage error.
for bad in abc 0 -2 1.5; do
  out="$(bash "$DEV_CMD" tail npm-dev -n "$bad" 2>&1)"
  rc=$?
  if [[ $rc -eq 1 && "$out" == *"positive integer"* ]]; then
    pass "tail -n '$bad' -> usage error, exit 1"
  else
    fail "tail -n '$bad' did not exit 1 with the positive-integer message (rc=$rc, out=$out)"
  fi
done

# Offline tail strips terminal escapes (best-effort): an SGR colour, a
# cursor-move/erase CSI, an OSC window title, a "\r" progress redraw and CRLF.
# Plain lines (checked above) stay byte-identical.
printf 'plain\n\033[31mred\033[0m text\n\033[2K\033[1Acursor\n\033]0;title\007after-osc\nprog 10%%\rprog 50%%\rprog 100%%\ncrlf line\r\n' > "$LOG_DIR/bg-npm-dev.log"
expected_clean="$(printf 'plain\nred text\ncursor\nafter-osc\nprog 100%%\ncrlf line')"
out="$(bash "$DEV_CMD" tail npm-dev 2>/dev/null)"
if [[ "$out" == "$expected_clean" ]]; then
  pass "tail offline strips SGR/CSI/OSC escapes, keeps the last \\r redraw, keeps CRLF lines"
else
  fail "tail offline escape strip mismatch (got: $(printf '%s' "$out" | od -c | head -n 6))"
fi

# ---------------------------------------------------------------------------
# Test 10-14: slug resolution (TASK-0196). Fixtures: two projects each with a
# "dev" process plus a uniquely named "web" process. Existing fixtures
# (npm-dev, vite) are already slugs and must keep resolving exactly.
# ---------------------------------------------------------------------------
echo -n "running" > "$STATE_DIR/bg-projA-dev.state"
echo -n "running" > "$STATE_DIR/bg-projB-dev.state"
echo -n "running" > "$STATE_DIR/bg-projA-web.state"
printf 'web1\nweb2\n' > "$LOG_DIR/bg-projA-web.log"

# Exact slug wins even though other slugs end in "-dev".
out="$(bash "$DEV_CMD" status projA-dev 2>&1)"
rc=$?
if [[ $rc -eq 0 && "$out" == *"State file (bg-projA-dev.state"* ]]; then
  pass "status <slug> resolves an exact slug"
else
  fail "status <slug> did not resolve an exact slug (rc=$rc, out=$out)"
fi

# Unique suffix: bare "web" resolves to projA-web.
out="$(bash "$DEV_CMD" tail web 2>&1)"
rc=$?
if [[ $rc -eq 0 && "$out" == *"web2"* ]]; then
  pass "tail <bare name> resolves when exactly one slug ends in -<name>"
else
  fail "tail <bare name> unique-suffix resolution failed (rc=$rc, out=$out)"
fi

# Ambiguous: bare "dev" matches npm-dev, projA-dev, projB-dev -> exit 2 + candidates.
out="$(bash "$DEV_CMD" status dev 2>&1)"
rc=$?
if [[ $rc -eq 2 && "$out" == *"Ambiguous name 'dev'"* && "$out" == *"projA-dev"* && "$out" == *"projB-dev"* ]]; then
  pass "status <ambiguous name> -> exit 2 + candidate slugs listed"
else
  fail "status <ambiguous name> did not exit 2 with candidates (rc=$rc, out=$out)"
fi

out="$(bash "$DEV_CMD" tail dev 2>&1)"
rc=$?
if [[ $rc -eq 2 && "$out" == *"projA-dev"* ]]; then
  pass "tail <ambiguous name> -> exit 2 + candidate slugs listed"
else
  fail "tail <ambiguous name> did not exit 2 with candidates (rc=$rc, out=$out)"
fi

# Unknown argument: exit 1, missing-file message, closest candidates.
out="$(bash "$DEV_CMD" status vit 2>&1)"
rc=$?
if [[ $rc -eq 1 && "$out" == *"No state file for 'vit'"* && "$out" == *"Closest registered slugs:"* && "$out" == *"vite"* ]]; then
  pass "status <unknown> -> exit 1 + closest candidate slugs"
else
  fail "status <unknown> did not exit 1 with closest candidates (rc=$rc, out=$out)"
fi

# ---------------------------------------------------------------------------
# Test 15-19: `list [--all]` project scoping (TASK-0202), offline paths only.
# BACKEND_PORT points at an unused port, so the host-server is unreachable and
# `list` takes the offline state-file fallback. CONDUCTOR_AGENT_NAME is not set
# by this script; each invocation controls it explicitly.
# The live project-filtering round trip (whoami + /api/status filtered by
# projectId) is [DEFERRED-TO-UAT] and consolidated by TASK-0208.
# ---------------------------------------------------------------------------

# `list --all` offline: works, lists fixtures, and does NOT claim it cannot filter.
out="$(env -u CONDUCTOR_AGENT_NAME bash "$DEV_CMD" list --all 2>&1)"
rc=$?
if [[ $rc -eq 0 && "$out" == *"projA-dev"* && "$out" != *"cannot filter by project offline"* ]]; then
  pass "list --all offline -> exit 0, lists state files, no project-filter note"
else
  fail "list --all offline did not exit 0 with fixtures and no filter note (rc=$rc, out=$out)"
fi

# `list --bogus`: exit 1 with the usage line.
out="$(env -u CONDUCTOR_AGENT_NAME bash "$DEV_CMD" list --bogus 2>&1)"
rc=$?
if [[ $rc -eq 1 && "$out" == *"Unknown option: --bogus"* && "$out" == *"Usage:"* && "$out" == *"list [--all]"* ]]; then
  pass "list --bogus -> exit 1 + usage with list [--all]"
else
  fail "list --bogus did not exit 1 with usage (rc=$rc, out=$out)"
fi

# `list` with no CONDUCTOR_AGENT_NAME and host-server unreachable: note + still lists.
out="$(env -u CONDUCTOR_AGENT_NAME bash "$DEV_CMD" list 2>&1)"
rc=$?
if [[ $rc -eq 0 && "$out" == *"cannot filter by project offline"* && "$out" == *"projA-dev"* ]]; then
  pass "list (no CONDUCTOR_AGENT_NAME, offline) -> 'cannot filter by project offline' note + still lists"
else
  fail "list (no CONDUCTOR_AGENT_NAME, offline) did not print the note and list (rc=$rc, out=$out)"
fi

# `list` with CONDUCTOR_AGENT_NAME set but host-server unreachable: same fallback.
out="$(CONDUCTOR_AGENT_NAME=projA-agent bash "$DEV_CMD" list 2>&1)"
rc=$?
if [[ $rc -eq 0 && "$out" == *"cannot filter by project offline"* && "$out" == *"projA-dev"* ]]; then
  pass "list (CONDUCTOR_AGENT_NAME set, host-server unreachable) -> same offline note + still lists"
else
  fail "list (CONDUCTOR_AGENT_NAME set, offline) did not print the note and list (rc=$rc, out=$out)"
fi

# [DEFERRED-TO-UAT] Live smoke recipe (consolidated by TASK-0208). Needs a running
# host-server with two projects, each owning a bg process; <window> is a project
# A agent's tmux window name:
#   1. CONDUCTOR_AGENT_NAME=<project A agent window> dev-commands.sh list
#        -> header "Background processes for project <A> ...", only A's processes
#   2. CONDUCTOR_AGENT_NAME=<project A agent window> dev-commands.sh list --all
#        -> header "Background processes (all projects):", both projects' processes,
#           each line ending ", project: <name>"
#   3. curl -s -H 'X-Conductor-Agent: <window>' localhost:8788/api/agents/whoami
#        -> kind "agent" with the same projectId/projectName that step 1 filtered by
#   4. CONDUCTOR_AGENT_NAME=<unknown value> dev-commands.sh list
#        -> falls back to all projects, stderr "Note: could not resolve your project
#           (not a registered agent ...); showing all projects."

# ---------------------------------------------------------------------------
# Test 20-23: static text assertions on dev-commands.sh / SKILL.md. Cheap
# regression guards for things a live run would otherwise be the only way to
# catch — the restart dispatch, the usage line, the retired bg-process
# vocabulary, and the --all/exit-codes documentation.
# ---------------------------------------------------------------------------
SKILL_MD="$REPO/skills/dev-commands/SKILL.md"

if grep -q 'restart)' "$DEV_CMD" && grep -q 'cmd_restart "\$@"' "$DEV_CMD"; then
  pass "dev-commands.sh dispatches 'restart' to cmd_restart"
else
  fail "dev-commands.sh does not appear to dispatch 'restart' to cmd_restart"
fi

if grep -q '{list|status|tail|restart}' "$DEV_CMD"; then
  pass "dev-commands.sh usage text lists all four subcommands (list|status|tail|restart)"
else
  fail "dev-commands.sh usage text is missing one or more of list|status|tail|restart"
fi

if grep -qE 'idle/busy/running|idle\|busy\|running|idle, busy, running' "$SKILL_MD"; then
  fail "SKILL.md still contains the stale idle/busy/running vocabulary for bg processes"
else
  pass "SKILL.md does not contain the stale idle/busy/running vocabulary for bg processes"
fi

if grep -q -- '--all' "$SKILL_MD"; then
  pass "SKILL.md documents the --all flag"
else
  fail "SKILL.md does not document the --all flag"
fi

if grep -q 'Exit codes:' "$SKILL_MD" && grep -qE '\|[[:space:]]*5[[:space:]]*\|.*[Cc]ooldown' "$SKILL_MD"; then
  pass "SKILL.md documents the restart exit codes (including cooldown, exit 5)"
else
  fail "SKILL.md does not document the restart exit codes table"
fi

# ---------------------------------------------------------------------------
# Sibling verifiers: run as sub-steps and fold their pass/fail into this
# script's own FAILURES count/exit code. Both are hermetic (no real network,
# no real tmux) — verify-dev-commands-install.sh and verify-bg-liveness.sh
# are deliberately NOT folded in here (see header comment / scripts/README.md).
# ---------------------------------------------------------------------------
run_sibling() {
  local desc="$1" script="$2"
  echo ""
  echo "[verify-dev-commands] --- Running sibling: $script ($desc) ---"
  if bash "$SCRIPT_DIR/$script"; then
    pass "sibling $script passed"
  else
    fail "sibling $script failed (see its PASS/FAIL output above)"
  fi
}

run_sibling "restart + online status/tail against a Node stub server, TASK-0203/0204" \
  "verify-dev-commands-restart.sh"
run_sibling "SKILL.md disable-model-invocation frontmatter" \
  "verify-dev-commands-skill-frontmatter.sh"

# ---------------------------------------------------------------------------
# --live mode dispatch point (TASK-0208 Step 3). Sourced only when --live is
# passed: scripts/lib/verify-dev-commands-live.sh defines run_live_scenario,
# which stands up an isolated host-server + private tmux world under
# ./tmp/verify-dev-commands/live/ and runs the agent-driven restart scenario,
# recording every assertion through this script's own pass()/fail() (so a
# scenario failure folds into FAILURES/the final exit code exactly like the
# sibling verifiers above). Default (no-flag) hermetic checks above always
# run regardless of LIVE_MODE; --live only adds to them.
# ---------------------------------------------------------------------------
run_live() {
  echo ""
  echo "[verify-dev-commands] --- Running --live scenario (TASK-0208 Step 3) ---"
  # shellcheck source=scripts/lib/verify-dev-commands-live.sh
  source "$SCRIPT_DIR/lib/verify-dev-commands-live.sh"
  local rc=0
  run_live_scenario || rc=$?
  case $rc in
    0) : ;; # scenario ran to completion; pass()/fail() already recorded every assertion
    2) echo "[verify-dev-commands] --live SKIPPED" ;;
    3) fail "live: refused to run (unsafe-environment guard tripped — see REFUSED message above)" ;;
    *) fail "live: scenario aborted unexpectedly (rc=$rc)" ;;
  esac
}

if [[ $LIVE_MODE -eq 1 ]]; then
  run_live
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [[ $FAILURES -eq 0 ]]; then
  echo "[verify-dev-commands] PASS — all dev-commands.sh behavioral checks passed"
  exit 0
else
  echo "[verify-dev-commands] FAIL — $FAILURES check(s) failed"
  exit 1
fi
