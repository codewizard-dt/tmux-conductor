#!/usr/bin/env bash
# verify-dev-commands-skill-frontmatter.sh — Regression test for TASK-160's
# design intent: "a SKILL.md Claude reaches for autonomously, not a
# /slash-command" (task Objective, line 19).
#
# Claude Code's `disable-model-invocation` frontmatter key gates autonomous
# (model-initiated) invocation. Both reference skills this task's Approach
# section points at for convention (~/.claude/skills/lint/SKILL.md,
# ~/.claude/skills/now/SKILL.md) set `disable-model-invocation: false` to
# stay autonomously reachable. This check asserts skills/dev-commands/SKILL.md
# does the same, per the task's own explicit design goal.
#
# Usage: bash scripts/verify-dev-commands-skill-frontmatter.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_MD="$REPO/skills/dev-commands/SKILL.md"

if [[ ! -f "$SKILL_MD" ]]; then
  echo "[verify-dev-commands-skill-frontmatter] FAIL: $SKILL_MD not found"
  exit 1
fi

frontmatter="$(awk '/^---$/{n++; next} n==1' "$SKILL_MD")"

if echo "$frontmatter" | grep -qE '^disable-model-invocation:[[:space:]]*false[[:space:]]*$'; then
  echo "[verify-dev-commands-skill-frontmatter] PASS — disable-model-invocation: false (autonomously reachable, per task design intent)"
  exit 0
elif echo "$frontmatter" | grep -qE '^disable-model-invocation:[[:space:]]*true[[:space:]]*$'; then
  echo "[verify-dev-commands-skill-frontmatter] FAIL: disable-model-invocation: true — this blocks autonomous invocation," \
       "contradicting the task's explicit design ('Claude reaches for autonomously, not a /slash-command') and the" \
       "convention in the reference skills (lint, now), which both use disable-model-invocation: false."
  exit 1
else
  echo "[verify-dev-commands-skill-frontmatter] FAIL: disable-model-invocation key not found in SKILL.md frontmatter"
  exit 1
fi
