#!/usr/bin/env bash
# scripts/lib/db.sh — shared SQLite helper library for the conductor shell scripts.
# This is a library: source it, do not execute it directly.

set -euo pipefail

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
# 3. load_agents — populate AGENT_NAMES + AGENT_DIRS/AGENT_CMDS/AGENT_BG
# ---------------------------------------------------------------------------
load_agents() {
  AGENT_NAMES=()
  declare -gA AGENT_DIRS
  declare -gA AGENT_CMDS
  declare -gA AGENT_BG
  declare -gA AGENT_WINDOW_NAMES
  declare -gA AGENT_IDS
  declare -gA AGENT_PROJECT_IDS
  local name workdir cmd bg_name window_name agent_id project_id
  while IFS=$'\x1f' read -r name workdir cmd bg_name window_name agent_id project_id; do
    [[ -z "$name" ]] && continue
    AGENT_NAMES+=("$name")
    AGENT_DIRS["$name"]="$workdir"
    AGENT_CMDS["$name"]="$cmd"
    AGENT_BG["$name"]="$bg_name"
    AGENT_WINDOW_NAMES["$name"]="$window_name"
    # Agent id + project id drive task dispatch directly. Names are only unique
    # per-project, so resolving tasks by name at dispatch time is ambiguous when
    # two projects share a short agent name — always match on these numeric ids.
    AGENT_IDS["$name"]="$agent_id"
    AGENT_PROJECT_IDS["$name"]="$project_id"
  done < <(sql "SELECT a.name, a.workdir, a.launch_cmd, COALESCE(b.name,''), COALESCE(p.name || '-' || a.name, a.name), a.id, COALESCE(a.project_id,'') FROM agents a LEFT JOIN bg_processes b ON b.linked_agent_id=a.id LEFT JOIN projects p ON a.project_id=p.id ORDER BY a.name")
}

# ---------------------------------------------------------------------------
# 4. load_bg — populate BG_NAMES + BG_DIRS/BG_CMDS
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
  done < <(sql "SELECT name, workdir, launch_cmd FROM bg_processes ORDER BY name")
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

  # Atomic DELETE…RETURNING. agent_id/project_id are numeric ids resolved by
  # load_agents, so they are safe to inline directly. Matching on the id avoids
  # the old `WHERE name='…'` subquery, which silently picked one arbitrary row
  # when two projects shared a short agent name (now only unique per-project).
  # When the agent has no project, project_id is empty and that clause is dropped.
  local project_pred="0"
  if [[ -n "$project_id" ]]; then
    project_pred="(t.project_id = ${project_id})"
  fi
  local pop_sql
  pop_sql="DELETE FROM tasks WHERE id = (
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
