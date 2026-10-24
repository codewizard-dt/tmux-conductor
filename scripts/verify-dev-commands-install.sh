#!/usr/bin/env bash
# verify-dev-commands-install.sh — Regression test for TASK-160's install-hooks.sh
# --skills-dir wiring (installing the skills/dev-commands/ bundle).
#
# Runs the real install-hooks.sh against entirely scratch paths (--skills-dir,
# --install-dir, --settings-file, --codex-install-dir, --codex-hooks-file all
# pointed under ./tmp/) so this never touches the real ~/.claude or ~/.codex.
# Confirms: SKILL.md + dev-commands.sh land at the target, the script is
# executable, and a second run is idempotent (byte-identical skill files).
#
# Usage: bash scripts/verify-dev-commands-install.sh
# Artifacts land in ./tmp/verify-dev-commands-install/ (gitignored).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
VERIFY_DIR="$REPO/tmp/verify-dev-commands-install"

rm -rf "$VERIFY_DIR"
mkdir -p "$VERIFY_DIR"

SKILLS_DIR="$VERIFY_DIR/skills/dev-commands"
INSTALL_DIR="$VERIFY_DIR/hooks/tmux-conductor"
SETTINGS_FILE="$VERIFY_DIR/settings.json"
CODEX_INSTALL_DIR="$VERIFY_DIR/codex-hooks/tmux-conductor"
CODEX_HOOKS_FILE="$VERIFY_DIR/codex-hooks.json"

FAILURES=0
fail() {
  echo "[verify-dev-commands-install] FAIL: $1"
  FAILURES=$((FAILURES + 1))
}
pass() {
  echo "[verify-dev-commands-install] PASS: $1"
}

run_install() {
  bash "$REPO/install-hooks.sh" \
    --skills-dir "$SKILLS_DIR" \
    --install-dir "$INSTALL_DIR" \
    --settings-file "$SETTINGS_FILE" \
    --codex-install-dir "$CODEX_INSTALL_DIR" \
    --codex-hooks-file "$CODEX_HOOKS_FILE"
}

echo "[verify-dev-commands-install] Running install-hooks.sh against scratch paths (first run)..."
first_log="$VERIFY_DIR/install-run1.log"
if run_install >"$first_log" 2>&1; then
  pass "install-hooks.sh exited 0 on first run"
else
  fail "install-hooks.sh exited nonzero on first run"
  cat "$first_log"
fi

if [[ -f "$SKILLS_DIR/SKILL.md" ]]; then
  pass "SKILL.md landed at $SKILLS_DIR/SKILL.md"
else
  fail "SKILL.md missing at $SKILLS_DIR/SKILL.md"
fi

if [[ -x "$SKILLS_DIR/scripts/dev-commands.sh" ]]; then
  pass "dev-commands.sh landed and is executable"
else
  fail "dev-commands.sh missing or not executable at $SKILLS_DIR/scripts/dev-commands.sh"
fi

if diff -q "$REPO/skills/dev-commands/SKILL.md" "$SKILLS_DIR/SKILL.md" >/dev/null 2>&1; then
  pass "installed SKILL.md is byte-identical to the repo source"
else
  fail "installed SKILL.md differs from the repo source"
fi

if diff -q "$REPO/skills/dev-commands/scripts/dev-commands.sh" "$SKILLS_DIR/scripts/dev-commands.sh" >/dev/null 2>&1; then
  pass "installed dev-commands.sh is byte-identical to the repo source"
else
  fail "installed dev-commands.sh differs from the repo source"
fi

echo "[verify-dev-commands-install] Snapshotting installed skill files, then re-running (idempotency check)..."
skill_md_before="$(cat "$SKILLS_DIR/SKILL.md" 2>/dev/null)"
script_before="$(cat "$SKILLS_DIR/scripts/dev-commands.sh" 2>/dev/null)"

second_log="$VERIFY_DIR/install-run2.log"
if run_install >"$second_log" 2>&1; then
  pass "install-hooks.sh exited 0 on second (idempotent) run"
else
  fail "install-hooks.sh exited nonzero on second run"
  cat "$second_log"
fi

skill_md_after="$(cat "$SKILLS_DIR/SKILL.md" 2>/dev/null)"
script_after="$(cat "$SKILLS_DIR/scripts/dev-commands.sh" 2>/dev/null)"

if [[ "$skill_md_before" == "$skill_md_after" && "$script_before" == "$script_after" ]]; then
  pass "second run is idempotent — installed skill files are unchanged"
else
  fail "second run changed the installed skill files — not idempotent"
fi

if [[ -x "$SKILLS_DIR/scripts/dev-commands.sh" ]]; then
  pass "dev-commands.sh is still executable after the second run"
else
  fail "dev-commands.sh lost its executable bit after the second run"
fi

# ---------------------------------------------------------------------------
# TASK-0208: the installed bundle must include the `restart` subcommand
# (TASK-0203) and SKILL.md must document it (TASK-0202/0203/0204), not just
# be byte-identical to whatever the repo source happens to contain.
# ---------------------------------------------------------------------------
if grep -q 'restart)' "$SKILLS_DIR/scripts/dev-commands.sh" 2>/dev/null \
  && grep -q 'cmd_restart "\$@"' "$SKILLS_DIR/scripts/dev-commands.sh" 2>/dev/null; then
  pass "installed dev-commands.sh dispatches the 'restart' subcommand"
else
  fail "installed dev-commands.sh does not dispatch the 'restart' subcommand"
fi

if grep -q '{list|status|tail|restart}' "$SKILLS_DIR/scripts/dev-commands.sh" 2>/dev/null; then
  pass "installed dev-commands.sh usage text lists all four subcommands"
else
  fail "installed dev-commands.sh usage text is missing one or more subcommands"
fi

if grep -q 'Restart a process' "$SKILLS_DIR/SKILL.md" 2>/dev/null \
  && grep -q 'Exit codes:' "$SKILLS_DIR/SKILL.md" 2>/dev/null; then
  pass "installed SKILL.md documents the restart subcommand and its exit codes"
else
  fail "installed SKILL.md does not document the restart subcommand/exit codes"
fi

echo ""
if [[ $FAILURES -eq 0 ]]; then
  echo "[verify-dev-commands-install] PASS — install-hooks.sh --skills-dir wiring verified"
  exit 0
else
  echo "[verify-dev-commands-install] FAIL — $FAILURES check(s) failed"
  exit 1
fi
