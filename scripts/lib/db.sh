#!/usr/bin/env bash
# scripts/lib/db.sh — shared SQLite helper library for the conductor shell scripts.
# This is a library: source it, do not execute it directly.

set -euo pipefail

# Fail fast and clearly when sourced under a bash too old to run load_agents/
# load_bg below (declare -gA requires bash >= 4.2). Without this, the only
# symptom is bash's own cryptic "declare: -g: invalid option" with no mention
# of bash version or PATH — install.sh checks this once at install time
# (see install.sh's PATH-bash preflight), but nothing re-checks it at the
# moment a runtime script actually starts, and PATH can silently regress
# (explicit /bin/bash invocation, a minimal cron/launchd PATH, a pre-install
# environment). Every scripts/*.sh entry point sources this file before doing
# anything bash4-specific of its own, so one guard here covers all of them.
if [ -z "${BASH_VERSINFO:-}" ] || [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
  echo "FATAL: this script requires bash >= 4 (found: ${BASH_VERSION:-unknown})." >&2
  echo "  Remedy: install bash >= 4 via your package manager (macOS: brew install bash) and ensure it precedes any older bash on PATH." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. DB path resolution (at source time)
# ---------------------------------------------------------------------------
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_DIR="$(dirname "$LIB_DIR")"  # scripts/../ = repo root
# Resolve DB path: env > conf setting > default
if [[ -z "${CONDUCTOR_DB:-}" ]]; then
  # source conductor.conf temporarily to get DB_PATH
  _db_conf="${CONF_DIR}/../conductor.conf"
  if [[ -f "$_db_conf" ]]; then
    DB_PATH_FROM_CONF=$(bash -c "source \"$_db_conf\" 2>/dev/null && echo \"\${DB_PATH:-}\"")
  fi
  if [[ -n "${DB_PATH_FROM_CONF:-}" ]]; then
    if [[ "${DB_PATH_FROM_CONF}" == /* ]]; then
      CONDUCTOR_DB="${DB_PATH_FROM_CONF}"
    else
      CONDUCTOR_DB="$(cd "$CONF_DIR/.." && pwd)/${DB_PATH_FROM_CONF#./}"
    fi
  else
    CONDUCTOR_DB="${CONF_DIR}/../data/conductor.db"
  fi
fi

# ---------------------------------------------------------------------------
# 2. sql() wrapper + sql_one()
# ---------------------------------------------------------------------------
sql() {
  sqlite3 -cmd '.timeout 5000' -separator $'\x1f' "$CONDUCTOR_DB" "$@"
}

# sql_one — like sql, but returns only the first line of output (single row).
sql_one() {
  sql "$@" | head -n1
}

# ---------------------------------------------------------------------------
# 3. load_agents — populate AGENT_NAMES + AGENT_DIRS/AGENT_CMDS/AGENT_WINDOW_NAMES/...
# ---------------------------------------------------------------------------
load_agents() {
  AGENT_NAMES=()
  declare -gA AGENT_DIRS
  declare -gA AGENT_CMDS
  declare -gA AGENT_WINDOW_NAMES
  declare -gA AGENT_IDS
  declare -gA AGENT_PROJECT_IDS
  local name workdir cmd window_name agent_id project_id
  while IFS=$'\x1f' read -r name workdir cmd window_name agent_id project_id; do
    [[ -z "$name" ]] && continue
    AGENT_NAMES+=("$name")
    AGENT_DIRS["$name"]="$workdir"
    AGENT_CMDS["$name"]="$cmd"
    AGENT_WINDOW_NAMES["$name"]="$window_name"
    # Agent id + project id drive task dispatch directly. Names are only unique
    # per-project, so resolving tasks by name at dispatch time is ambiguous when
    # two projects share a short agent name — always match on these numeric ids.
    AGENT_IDS["$name"]="$agent_id"
    AGENT_PROJECT_IDS["$name"]="$project_id"
  done < <(sql "SELECT a.name, a.workdir, a.launch_cmd, COALESCE(p.name || '-' || a.name, a.name), a.id, COALESCE(a.project_id,'') FROM agents a LEFT JOIN projects p ON a.project_id=p.id ORDER BY a.name")
}

# ---------------------------------------------------------------------------
# 4. load_bg — populate BG_NAMES + BG_DIRS/BG_CMDS
#
# bg process names are only unique per project, so every value in BG_NAMES (and
# every key of BG_DIRS/BG_CMDS) is the derived slug `<projectName>-<name>` (the
# bare name when the row has no project) — identical to bgSlug() in
# host-server/db.ts. The slug is the tmux window name and the bg-<slug>.log|state
# file stem.
# ---------------------------------------------------------------------------
load_bg() {
  BG_NAMES=()
  declare -gA BG_DIRS
  declare -gA BG_CMDS
  local name workdir cmd
  while IFS=$'\x1f' read -r name workdir cmd; do
    [[ -z "$name" ]] && continue
    BG_NAMES+=("$name")
    BG_DIRS["$name"]="$workdir"
    BG_CMDS["$name"]="$cmd"
  done < <(sql "SELECT COALESCE(p.name || '-' || b.name, b.name), b.workdir, b.launch_cmd FROM bg_processes b LEFT JOIN projects p ON p.id=b.project_id ORDER BY 1")
}

# ---------------------------------------------------------------------------
# 5. pop_task_sql — atomically pop the next queued task for an agent
# ---------------------------------------------------------------------------
pop_task_sql() {
  local agent_id="$1"
  local project_id="${2:-}"
  POPPED_TASK=""
  LAST_QUEUE_KIND=""
  LAST_QUEUE_REMAINING=0

  # Atomic UPDATE…RETURNING (TASK-125: soft flip, was DELETE…RETURNING). The
  # popped row's status becomes 'done' with completed_at set instead of being
  # removed, so it stays queryable for task history. agent_id/project_id are
  # numeric ids resolved by load_agents, so they are safe to inline directly.
  # Matching on the id avoids the old `WHERE name='…'` subquery, which
  # silently picked one arbitrary row when two projects shared a short agent
  # name (now only unique per-project). When the agent has no project,
  # project_id is empty and that clause is dropped. The candidate-selection
  # subquery is unchanged: it still only matches status='queued' rows, so a
  # popped row can never be picked again once its status flips.
  local project_pred="0"
  if [[ -n "$project_id" ]]; then
    project_pred="(t.project_id = ${project_id})"
  fi
  local pop_sql
  pop_sql="UPDATE tasks SET status='done', completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = (
    SELECT t.id FROM tasks t
    WHERE t.status = 'queued' AND (
         (t.agent_id IS NOT NULL AND t.agent_id = ${agent_id})
      OR (t.project_id IS NOT NULL AND ${project_pred})
      OR (t.agent_id IS NULL AND t.project_id IS NULL))
    ORDER BY CASE WHEN t.agent_id IS NOT NULL THEN 0
                  WHEN t.project_id IS NOT NULL THEN 1 ELSE 2 END,
             t.position
    LIMIT 1)
  RETURNING id, command,
    CASE WHEN agent_id IS NOT NULL THEN 'scoped'
         WHEN project_id IS NOT NULL THEN 'project' ELSE 'global' END;"

  # The result may be empty (no rows popped). Guard so a non-zero read on empty
  # input does not abort the script under set -e.
  local _id
  local _result
  _result="$(sql "$pop_sql")" || true
  if [[ -n "$_result" ]]; then
    IFS=$'\x1f' read -r _id POPPED_TASK LAST_QUEUE_KIND <<<"$_result" || true
  fi

  LAST_QUEUE_REMAINING=$(sql "SELECT COUNT(*) FROM tasks WHERE status='queued'")

  [[ -n "$POPPED_TASK" ]]
}

# ---------------------------------------------------------------------------
# 6. checkpoint_agent — pre-dispatch git-stash snapshot of an agent's worktree
# ---------------------------------------------------------------------------
# Takes a `git stash push` snapshot of the agent's worktree (ROADMAP-007 Phase
# 3) and records the stash commit SHA in agent_checkpoints. Best-effort: an
# agent with no worktree_path, a clean worktree (nothing to stash), or any git
# failure logs a warning (stderr) and returns 0 so dispatch is never blocked.
#
# The stash entry's SHA is resolved from `stash@{0}` and stored rather than the
# literal `stash@{N}` name: checkpoints accumulate over time and every later
# stash shifts the numbering, so only the SHA remains a stable ref for rolling
# back to an *older* checkpoint (TASK-070's `git stash apply <stash_ref>`).
# Millisecond ts comes from node (portable) rather than `date +%s%3N`, which is
# a GNU-only extension that BSD/macOS date does not support.
checkpoint_agent() {
  local agent_id="$1"
  local worktree_path ts push_out stash_ref
  worktree_path="$(sql_one "SELECT COALESCE(worktree_path,'') FROM agents WHERE id=${agent_id}")" || return 0
  if [[ -z "$worktree_path" ]]; then
    return 0
  fi
  ts="$(node -e 'process.stdout.write(String(Date.now()))')" || return 0
  if ! push_out="$(git -C "$worktree_path" stash push -m "conductor-checkpoint-${ts}" 2>&1)"; then
    echo "WARN: checkpoint_agent: git stash failed for agent ${agent_id} (${worktree_path}): ${push_out}" >&2
    return 0
  fi
  if [[ "$push_out" == *"No local changes to save"* ]]; then
    echo "WARN: checkpoint_agent: clean worktree, nothing stashed for agent ${agent_id}" >&2
    return 0
  fi
  stash_ref="$(git -C "$worktree_path" rev-parse 'stash@{0}' 2>/dev/null)" || return 0
  if [[ -z "$stash_ref" ]]; then
    return 0
  fi
  sql "INSERT INTO agent_checkpoints (agent_id, ts, stash_ref) VALUES (${agent_id}, ${ts}, '${stash_ref}');" >/dev/null || true
}
