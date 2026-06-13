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

# Resolve the agent name to an agent_id. Escape single quotes for SQL by doubling
# (same idiom as TASK-010's move_to_backlog). A name is UNIQUE, so at most one row.
AGENT_SQL="${AGENT_NAME//\'/\'\'}"
AGENT_ID="$(sql "SELECT id FROM agents WHERE name='${AGENT_SQL}'")"

if [[ -z "$AGENT_ID" ]]; then
  echo "Warning: agent '${AGENT_NAME}' not found in DB; adding as a global (unscoped) task." >&2
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