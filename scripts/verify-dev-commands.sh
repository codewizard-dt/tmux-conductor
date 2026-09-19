#!/usr/bin/env bash
# verify-dev-commands.sh — Regression tests for TASK-160's
# skills/dev-commands/scripts/dev-commands.sh (list/status/tail).
#
# Exercises the deterministic parts of the standalone script: the
# CONDUCTOR_STATE_DIR/CONDUCTOR_LOG_DIR FATAL guards, the offline
# list/status fallback paths (no live host-server required — BACKEND_PORT
# points at a port nothing listens on so curl fails deterministically),
# and tail's -n argument-order flexibility. The live host-server round trip
# (real /api/status, real bg process, real make dev session) is
# runtime/e2e behavior and is covered by UAT, not here.
#
# Usage: bash scripts/verify-dev-commands.sh
# Artifacts land in ./tmp/verify-dev-commands/ (gitignored).
set -uo pipefail

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
echo -n "idle" > "$STATE_DIR/bg-vite.state"
out="$(bash "$DEV_CMD" list 2>&1)"
if [[ "$out" == *"npm-dev — state: running"* && "$out" == *"vite — state: idle"* ]]; then
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
   && "$out" == *"Live cross-check unavailable (host-server unreachable)"* ]]; then
  pass "status for registered name prints state file + labeled offline cross-check"
else
  fail "status for registered name did not print expected labeled output (out=$out)"
fi

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
out="$(bash "$DEV_CMD" tail npm-dev 2>&1)"
if [[ "$out" == "$(printf 'line1\nline2\nline3\nline4\nline5')" ]]; then
  pass "tail with no -n prints the whole (short) log via default -n 50"
else
  fail "tail default output did not match the log file contents (out=$out)"
fi

# ---------------------------------------------------------------------------
# Test 9: `tail <name> -n N` accepts -n in either argument order
# ---------------------------------------------------------------------------
seq 1 10 > "$LOG_DIR/bg-npm-dev.log"
expected="$(printf '8\n9\n10')"

out_after="$(bash "$DEV_CMD" tail npm-dev -n 3 2>&1)"
if [[ "$out_after" == "$expected" ]]; then
  pass "tail <name> -n N (options after name) returns the last N lines"
else
  fail "tail <name> -n N (options after name) mismatch (out=$out_after)"
fi

out_before="$(bash "$DEV_CMD" tail -n 3 npm-dev 2>&1)"
if [[ "$out_before" == "$expected" ]]; then
  pass "tail -n N <name> (options before name) returns the last N lines"
else
  fail "tail -n N <name> (options before name) mismatch (out=$out_before)"
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
