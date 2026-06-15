#!/usr/bin/env bash
# Usage: add-task.sh <command words...>
# Inserts a queued task row into the SQLite `tasks` table for the agent matching
# the current directory name (CWD basename). The command is the positional args.
# Scope: the basename is resolved to an agent_id; if it is unknown, the task is
# added as a global (unscoped) task so it remains dispatchable.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Brings in sql()/sql_one() and resolves CONDUCTOR_DB (env > conf DB_PATH > default).
source "$SCRIPT_DIR/lib/db.sh"

AGENT_NAME="$(basename "$PWD")"

if [[ $# -lt 1 ]]; then
  echo "Usage: add-task.sh <command words...>" >&2
  exit 1
fi

CMD="$*"

# Resolve the agent to an agent_id. Agent names are only unique per-project, so a
# bare name lookup can return several rows. Disambiguate by also matching this
# working directory (the dir the task is added from); fall back to name-only, and
# bail to a global task if the name is still ambiguous. Escape single quotes for
# SQL by doubling (same idiom as move_to_backlog).
AGENT_SQL="${AGENT_NAME//\'/\'\'}"
PWD_SQL="${PWD//\'/\'\'}"
AGENT_ID="$(sql "SELECT id FROM agents WHERE name='${AGENT_SQL}' AND workdir='${PWD_SQL}' LIMIT 1")"
if [[ -z "$AGENT_ID" ]]; then
  MATCHES="$(sql "SELECT id FROM agents WHERE name='${AGENT_SQL}'")"
  MATCH_COUNT="$(printf '%s' "$MATCHES" | grep -c '[0-9]' || true)"
  if [[ "$MATCH_COUNT" == "1" ]]; then
    AGENT_ID="$MATCHES"
  elif [[ "$MATCH_COUNT" -gt 1 ]]; then
    echo "Warning: agent name '${AGENT_NAME}' is ambiguous (${MATCH_COUNT} agents share it, none in $PWD); adding as a global (unscoped) task." >&2
  fi
fi

if [[ -z "$AGENT_ID" ]]; then
  [[ "${MATCH_COUNT:-0}" -gt 1 ]] || echo "Warning: agent '${AGENT_NAME}' not found in DB; adding as a global (unscoped) task." >&2
  AGENT_ID_SQL="NULL"
else
  AGENT_ID_SQL="$AGENT_ID"
fi

# Compute the next tail position, matching the backend addTask 'tail' convention:
# position = MAX(position over queued rows) + 1.0, with MAX of empty set => 0.
POSITION="$(sql "SELECT COALESCE(MAX(position), 0) + 1.0 FROM tasks WHERE status='queued'")"

# Escape the command for SQL by doubling single quotes.
CMD_SQL="${CMD//\'/\'\'}"

# Insert the task. project_id stays NULL per CHECK (agent_id IS NULL OR project_id IS NULL).
sql "INSERT INTO tasks (command, agent_id, project_id, position, status, source)
     VALUES ('${CMD_SQL}', ${AGENT_ID_SQL}, NULL, ${POSITION}, 'queued', 'manual')"

if [[ -z "$AGENT_ID" ]]; then
  echo "Added global task: ${CMD}"
else
  echo "Added task for ${AGENT_NAME}: ${CMD}"
fi