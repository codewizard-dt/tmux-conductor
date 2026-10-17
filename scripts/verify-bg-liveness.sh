#!/usr/bin/env bash
# verify-bg-liveness.sh — Runtime check for TASK-0191's bg-process liveness rule.
#
# Proves that a bg process which crashed back to a plain shell classifies as
# `exited` while one still running classifies as `running`, and that a missing
# window is `dead`. Runs on a PRIVATE tmux server (socket under ./tmp/), so it
# never touches the operator's real conductor session.
#
# monitor.sh is NOT sourced: it runs its poll loop at top level, so sourcing it
# has side effects. Instead is_shell_cmd / launch_cmd_name / bg_pane_exited are
# replicated below VERBATIM from scripts/monitor.sh (the SHELL rule is the same
# `pane_current_command` rule as host-server/state.ts bgLiveness). If the rule
# in monitor.sh changes, update the replica here.
#
# Runtime behavior: this script is exercised in UAT (TASK-0191), not in CI.
#
# Usage: bash scripts/verify-bg-liveness.sh
# Artifacts land in ./tmp/verify-bg-liveness/ (gitignored).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
VERIFY_DIR="$REPO/tmp/verify-bg-liveness"
SOCK="$VERIFY_DIR/tmux.sock"
SESSION="bgliveness"

# Must exceed host-server BG_STARTUP_GRACE_MS (3s): the server applies a startup
# grace where a shell reads as `running`. monitor.sh has no grace, but waiting
# past it here keeps this check valid for both classifiers.
GRACE_WAIT_S=4

rm -rf "$VERIFY_DIR"
mkdir -p "$VERIFY_DIR"

# All tmux calls go through the private socket and an empty config.
t() { tmux -S "$SOCK" -f /dev/null "$@"; }

cleanup() {
  t kill-server 2>/dev/null || true
  rm -f "$SOCK"
}
trap cleanup EXIT

FAILURES=0
fail() {
  echo "[verify-bg-liveness] FAIL: $1"
  FAILURES=$((FAILURES + 1))
}
pass() {
  echo "[verify-bg-liveness] PASS: $1"
}

# ---------------------------------------------------------------------------
# Replica of scripts/monitor.sh is_shell_cmd / launch_cmd_name / bg_pane_exited
# (keep in sync). Differences: takes the launch command as a third argument
# instead of reading BG_CMDS, and targets the private socket via t().
# ---------------------------------------------------------------------------
is_shell_cmd() {
  case "$1" in
    sh|bash|zsh|fish|dash|ksh) return 0 ;;
    *) return 1 ;;
  esac
}

launch_cmd_name() {
  local w
  for w in $1; do
    case "$w" in
      [A-Za-z_]*=*) continue ;;
      *) printf '%s' "$w"; return 0 ;;
    esac
  done
}

# true (0) when the window's pane is back at a plain shell and the launch
# command is not itself a shell; an empty pane command fails toward "running".
bg_pane_exited() {
  local target="$1"
  local launch="$2"
  local cmd_name
  cmd_name="$(launch_cmd_name "$launch")"
  cmd_name="$(basename "$cmd_name" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  is_shell_cmd "$cmd_name" && return 1
  local cur
  cur=$(t display-message -p -t "$target" '#{pane_current_command}' 2>/dev/null || echo "")
  cur="$(basename "$cur" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  [ -z "$cur" ] && return 1
  is_shell_cmd "$cur"
}

# Mirrors the monitor's bg state write: dead / exited / running.
classify() {
  local name="$1" launch="$2"
  if ! t list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -qx "$name"; then
    echo "dead"
  elif bg_pane_exited "$SESSION:=$name" "$launch"; then
    echo "exited"
  else
    echo "running"
  fi
}

# ---------------------------------------------------------------------------
# Setup: same shape conductor.sh uses for bg processes — a window holding an
# interactive shell, with the launch command typed in via send-keys. A pinned
# bash (no rc files) keeps pane_current_command deterministic.
# ---------------------------------------------------------------------------
SHELL_CMD="bash --norc --noprofile"
t new-session -d -s "$SESSION" -n placeholder "$SHELL_CMD" || {
  echo "[verify-bg-liveness] FATAL: could not start private tmux server at $SOCK"
  exit 1
}

t new-window -d -t "$SESSION:" -n bg-run "$SHELL_CMD"
t send-keys -t "$SESSION:=bg-run" -l 'sleep 300'
t send-keys -t "$SESSION:=bg-run" Enter

t new-window -d -t "$SESSION:" -n bg-crash "$SHELL_CMD"
t send-keys -t "$SESSION:=bg-crash" -l 'false'
t send-keys -t "$SESSION:=bg-crash" Enter

# Launch commands as they would be registered in the bg_processes table.
RUN_LAUNCH="sleep 300"
CRASH_LAUNCH="npm run dev"   # non-shell launch whose process died back to the shell
SHELL_LAUNCH="bash -c 'exec bash'"

# Wait past the startup grace so the server-side classifier would agree.
sleep "$GRACE_WAIT_S"

# ---------------------------------------------------------------------------
# Test 1: a running process reads `running`
# ---------------------------------------------------------------------------
got="$(classify bg-run "$RUN_LAUNCH")"
if [[ "$got" == "running" ]]; then
  pass "running process (sleep 300) -> running"
else
  cur="$(t display-message -p -t "$SESSION:=bg-run" '#{pane_current_command}' 2>/dev/null)"
  fail "running process classified '$got' (pane_current_command='$cur'), expected running"
fi

# ---------------------------------------------------------------------------
# Test 2: a crashed process (pane back at a plain shell) reads `exited`
# ---------------------------------------------------------------------------
got="$(classify bg-crash "$CRASH_LAUNCH")"
if [[ "$got" == "exited" ]]; then
  pass "crashed process (shell prompt, window present) -> exited"
else
  cur="$(t display-message -p -t "$SESSION:=bg-crash" '#{pane_current_command}' 2>/dev/null)"
  fail "crashed process classified '$got' (pane_current_command='$cur'), expected exited"
fi

# ---------------------------------------------------------------------------
# Test 3: a launch command that is itself a shell reads `running` even at a
# shell prompt (a shell in the pane is normal for it)
# ---------------------------------------------------------------------------
got="$(classify bg-crash "$SHELL_LAUNCH")"
if [[ "$got" == "running" ]]; then
  pass "shell launch command at a shell prompt -> running"
else
  fail "shell launch command classified '$got', expected running"
fi

# ---------------------------------------------------------------------------
# Test 4: a missing window reads `dead`
# ---------------------------------------------------------------------------
got="$(classify bg-ghost "$RUN_LAUNCH")"
if [[ "$got" == "dead" ]]; then
  pass "missing window -> dead"
else
  fail "missing window classified '$got', expected dead"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [[ $FAILURES -eq 0 ]]; then
  echo "[verify-bg-liveness] PASS — bg liveness classification checks passed"
  exit 0
else
  echo "[verify-bg-liveness] FAIL — $FAILURES check(s) failed"
  exit 1
fi
