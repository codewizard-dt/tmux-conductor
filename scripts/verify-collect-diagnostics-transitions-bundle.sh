#!/usr/bin/env bash
# scripts/verify-collect-diagnostics-transitions-bundle.sh — TASK-145 repeatable
# check for scripts/collect-diagnostics.sh's handling of logs/transitions.jsonl:
# it must be copied into the timestamped diagnostic bundle when present (same
# best-effort pattern already used for observability.jsonl/hooks.jsonl/
# dispatch.jsonl), and its absence must never fail the script.
#
# Runs the real collect-diagnostics.sh against a throwaway fixture directory
# (under ./tmp/, per repo convention) with its own logs/ subdir and an
# unreachable HOST_URL, so no live host-server or tmux session is required.
#
# Usage: bash scripts/verify-collect-diagnostics-transitions-bundle.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
COLLECT_SH="$REPO/scripts/collect-diagnostics.sh"
SCRATCH_DIR="$REPO/tmp/verify-collect-diagnostics-transitions-bundle"
rm -rf "$SCRATCH_DIR"
mkdir -p "$SCRATCH_DIR/fixture/logs" "$SCRATCH_DIR/out"

cleanup() { rm -rf "$SCRATCH_DIR"; }
trap cleanup EXIT

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

# Unreachable host so the curl-based perf-summary branch fails fast and
# harmlessly (collect-diagnostics.sh already treats that as non-fatal).
UNREACHABLE_HOST="http://127.0.0.1:1/api"

echo "dispatch-fixture" > "$SCRATCH_DIR/fixture/logs/dispatch.jsonl"
echo "hooks-fixture" > "$SCRATCH_DIR/fixture/logs/hooks.jsonl"
echo '{"ts":"2026-09-13T00:00:00Z","agent":"a","from":"busy","to":"idle"}' > "$SCRATCH_DIR/fixture/logs/transitions.jsonl"

# --- Case A: transitions.jsonl present alongside the other logs ---
OUT_A="$SCRATCH_DIR/out/case-a"
if (
  cd "$SCRATCH_DIR/fixture" && OUT_ROOT="$OUT_A" HOST_URL="$UNREACHABLE_HOST" bash "$COLLECT_SH" >/dev/null
); then
  check "collect-diagnostics.sh exits 0 when logs/transitions.jsonl is present" "pass"
else
  check "collect-diagnostics.sh exits 0 when logs/transitions.jsonl is present" "fail"
fi

BUNDLE_A="$(find "$OUT_A" -mindepth 1 -maxdepth 1 -type d | head -1)"
if [[ -n "$BUNDLE_A" && -f "$BUNDLE_A/transitions.jsonl" ]] \
  && diff -q "$BUNDLE_A/transitions.jsonl" "$SCRATCH_DIR/fixture/logs/transitions.jsonl" >/dev/null 2>&1; then
  check "logs/transitions.jsonl is copied into the bundle byte-for-byte when present" "pass"
else
  check "logs/transitions.jsonl is copied into the bundle byte-for-byte when present" "fail"
fi

if [[ -n "$BUNDLE_A" && -f "$BUNDLE_A/dispatch.jsonl" && -f "$BUNDLE_A/hooks.jsonl" ]]; then
  check "dispatch.jsonl/hooks.jsonl bundling is untouched (regression)" "pass"
else
  check "dispatch.jsonl/hooks.jsonl bundling is untouched (regression)" "fail"
fi

# --- Case B: logs/transitions.jsonl absent — must not fail the script and
# must not appear in the bundle ---
rm -f "$SCRATCH_DIR/fixture/logs/transitions.jsonl"
OUT_B="$SCRATCH_DIR/out/case-b"
if (
  cd "$SCRATCH_DIR/fixture" && OUT_ROOT="$OUT_B" HOST_URL="$UNREACHABLE_HOST" bash "$COLLECT_SH" >/dev/null
); then
  check "collect-diagnostics.sh exits 0 when logs/transitions.jsonl is absent (best-effort)" "pass"
else
  check "collect-diagnostics.sh exits 0 when logs/transitions.jsonl is absent (best-effort)" "fail"
fi

BUNDLE_B="$(find "$OUT_B" -mindepth 1 -maxdepth 1 -type d | head -1)"
if [[ -n "$BUNDLE_B" && ! -f "$BUNDLE_B/transitions.jsonl" && -f "$BUNDLE_B/dispatch.jsonl" ]]; then
  check "no transitions.jsonl appears in the bundle when the source file is absent" "pass"
else
  check "no transitions.jsonl appears in the bundle when the source file is absent" "fail"
fi

echo ""
echo "Passed: ${#PASS[@]}  Failed: ${#FAIL[@]}"
if [[ ${#FAIL[@]} -gt 0 ]]; then
  exit 1
fi
