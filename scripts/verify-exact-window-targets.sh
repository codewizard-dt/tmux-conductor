#!/usr/bin/env bash
# verify-exact-window-targets.sh — Regression test for TASK-0182
#
# A bare tmux target `-t sess:win` PREFIX-matches window names (`foo` resolves to
# `foo-copy`), so a missing agent window silently read/typed into another agent's
# pane. The `=` form (`sess:=win`) is exact-only. This script documents the hazard
# and pins the exact-match behavior against a throwaway session.
#
# Usage: bash scripts/verify-exact-window-targets.sh
# Only ever touches its own uniquely named scratch session — never the live
# conductor session.
set -uo pipefail

S="tc-verify-exact-$$-$(date +%s)"

cleanup() {
  tmux kill-session -t "=$S" 2>/dev/null || true
}
trap cleanup EXIT

fail() {
  echo "[verify-exact-window-targets] FAIL: $1"
  exit 1
}

echo "[verify-exact-window-targets] Creating scratch session '$S' with a single window 'foo-copy'..."
tmux new-session -d -s "$S" -n foo-copy || fail "could not create scratch tmux session"

if tmux has-session -t "$S:=foo-copy" 2>/dev/null; then
  echo "[verify-exact-window-targets] ok: '$S:=foo-copy' resolves (exact name)"
else
  fail "'$S:=foo-copy' should resolve but did not"
fi

if tmux has-session -t "$S:=foo" 2>/dev/null; then
  fail "'$S:=foo' resolved — exact-match target must NOT prefix-match 'foo-copy'"
fi
echo "[verify-exact-window-targets] ok: '$S:=foo' does not resolve (no prefix match)"

# Documents the hazard the '=' form guards against. If a future tmux stops
# prefix-matching, this is informational only rather than a failure of our code.
if tmux has-session -t "$S:foo" 2>/dev/null; then
  echo "[verify-exact-window-targets] hazard confirmed: bare '$S:foo' DOES prefix-match 'foo-copy'"
else
  echo "[verify-exact-window-targets] note: bare '$S:foo' no longer prefix-matches on this tmux version"
fi

echo ""
echo "[verify-exact-window-targets] PASS — exact-match window targets (TASK-0182) verified"
