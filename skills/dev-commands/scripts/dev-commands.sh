#!/usr/bin/env bash
# dev-commands.sh — Query and restart registered background dev processes
# (list/status/tail/restart)
#
# This script ships as part of the ~/.claude/skills/dev-commands skill bundle.
# It runs standalone from any project directory and queries the conductor's
# background process state without requiring knowledge of tmux internals or file paths.
#
# Usage:
#   dev-commands.sh list [--all]
#   dev-commands.sh status <slug>
#   dev-commands.sh tail <slug> [-n N]
#   dev-commands.sh restart <name>
#
# A process is identified by its slug, "<projectName>-<name>" (the bare name
# when the row has no project). State/log files are bg-<slug>.state|log.
# status/tail/restart share one project-aware resolution (an exact slug wins;
# else a bare name within the caller's project; else a bare name matching exactly
# one process machine-wide). An ambiguous bare name lists the candidates on
# stderr and exits 2 for status/tail (1 for restart). An unknown argument exits 1
# and lists the closest slugs. Offline there is no project awareness: a bare
# name resolves against the bg-*.state basenames only.
#
# status <slug> is online-first: it prints BgStatus.liveness (running | exited |
# stopped, the authoritative signal), the window, the last restart and the
# poll-lagged state file, plus one sentence interpreting the liveness. Offline
# (host-server unreachable or jq missing) it prints the state file with the
# monitor's vocabulary (running | exited | dead) and a cross-check note.
#
# tail <slug> [-n N] reads GET /api/bg-processes/<slug>/tail?format=text: clean
# text (ANSI stripped, CR redraws collapsed, "--- restart <ts> ---" markers).
# N must be a positive integer; the host-server caps it at 1000, so larger values
# are clamped. Offline it reads bg-<slug>.log directly through a best-effort
# escape strip (sed).
#
# list defaults to the calling agent's own project: the host-server resolves it
# from GET /api/agents/whoami using the X-Conductor-Agent header, which carries
# CONDUCTOR_AGENT_NAME. --all lists every project (with project names). Whenever
# the project cannot be resolved (no CONDUCTOR_AGENT_NAME, unknown/ambiguous
# agent, agent without a project, host-server unreachable, jq missing), list
# shows all projects and prints a note on stderr. The offline state-file
# fallback has no project field, so offline it cannot filter by project.
#
# restart <name> is a thin client over POST /api/bg-processes/<slug>/restart: the
# host-server owns the same-project guard, the cooldown and the audit log. <name>
# is a slug or a bare name (exact slug wins; else a bare name within the caller's
# project; else a bare name matching exactly one process machine-wide). An
# ambiguous bare name exits 1 for restart (not 2) and lists the candidates.
# restart NEEDS the host-server (there is no offline fallback), and it never
# retries: a cooldown answer (exit 5) must not be looped on.
#
# restart exit codes:
#   0  restarted
#   1  usage error, unknown process, or ambiguous bare name
#   2  host-server unreachable (or curl timed out)
#   3  refused (process belongs to another project / caller identity unresolved)
#   4  the conductor tmux session is not running
#   5  cooldown (restarted too recently; do not retry in a loop)
#   6  restart failed on the server, or an unexpected response
#
# Environment:
#   CONDUCTOR_STATE_DIR  = directory containing bg-*.state files (required)
#   CONDUCTOR_LOG_DIR    = directory containing bg-*.log files (required)
#   BACKEND_PORT         = conductor host-server port (default: 8788)
#   CONDUCTOR_AGENT_NAME = tmux window name of the calling agent (<project>-<name>),
#                          set by conductor at spawn; optional

set -euo pipefail

# Validate required environment variables before any subcommand logic
if [[ -z "${CONDUCTOR_STATE_DIR:-}" ]]; then
  echo "FATAL: CONDUCTOR_STATE_DIR is not set or empty" >&2
  echo "  (This environment variable should have been exported by conductor.sh or spawn.sh)" >&2
  exit 1
fi

if [[ -z "${CONDUCTOR_LOG_DIR:-}" ]]; then
  echo "FATAL: CONDUCTOR_LOG_DIR is not set or empty" >&2
  echo "  (This environment variable should have been exported by conductor.sh or spawn.sh)" >&2
  exit 1
fi

BACKEND_PORT="${BACKEND_PORT:-8788}"
BASE_URL="http://127.0.0.1:${BACKEND_PORT}"
# Overall curl --max-time for `restart`: a restart is a tmux respawn plus the
# startup grace, so it gets longer than the read-only calls.
RESTART_TIMEOUT_S=60

# ============================================================================
# Helper: Attempt to fetch from the host-server, with graceful fallback
# ============================================================================
api_call() {
  # api_call <method> <path> [raw]   (path like /api/status)
  # Sends X-Conductor-Agent (this agent's tmux window name) only when
  # CONDUCTOR_AGENT_NAME is set and non-empty, so the host-server can resolve the
  # caller's project and audit who acted.
  #   default mode: prints the body and returns 0; returns 1 if the host-server is
  #     unreachable or answers non-2xx (curl -sf).
  #   raw mode: prints headers + body (curl -sS -i, no -f, --max-time
  #     $RESTART_TIMEOUT_S) for ANY HTTP status and returns 0; on a transport
  #     failure returns curl's own exit code (7 unreachable, 28 timeout, ...).
  local method="$1" path="$2" mode="${3:-}"
  # if/else rather than a header-args array: an empty array expansion trips
  # `set -u` on macOS's bash 3.2.
  if [[ "$mode" == "raw" ]]; then
    if [[ -n "${CONDUCTOR_AGENT_NAME:-}" ]]; then
      curl -sS -i --max-time "$RESTART_TIMEOUT_S" -X "$method" \
        -H "X-Conductor-Agent: ${CONDUCTOR_AGENT_NAME}" "$BASE_URL$path" 2>/dev/null || return $?
    else
      curl -sS -i --max-time "$RESTART_TIMEOUT_S" -X "$method" "$BASE_URL$path" 2>/dev/null || return $?
    fi
    return 0
  fi
  if [[ -n "${CONDUCTOR_AGENT_NAME:-}" ]]; then
    curl -sf -X "$method" -H "X-Conductor-Agent: ${CONDUCTOR_AGENT_NAME}" "$BASE_URL$path" 2>/dev/null || return 1
  else
    curl -sf -X "$method" "$BASE_URL$path" 2>/dev/null || return 1
  fi
}

api_get() {
  # GET wrapper kept for list/status/tail and the resolve helpers.
  api_call GET "$1"
}

fetch_api_status() {
  # Return exit code 0 and output JSON if successful; exit 1 if unreachable
  api_get /api/status
}

# ============================================================================
# Helper: print registered slugs, one per line.
# Online (host-server + jq): .bgProcesses[].slug. Otherwise (or when that
# yields nothing) the bg-*.state glob, whose basenames are already slugs.
# ============================================================================
list_slugs() {
  local json_output slugs="" f

  if command -v jq &> /dev/null && json_output=$(fetch_api_status); then
    slugs=$(echo "$json_output" | jq -r '.bgProcesses[]?.slug // empty' 2>/dev/null || true)
  fi

  if [[ -n "$slugs" ]]; then
    printf '%s\n' "$slugs"
    return 0
  fi

  for f in "$CONDUCTOR_STATE_DIR"/bg-*.state; do
    [[ -e "$f" ]] || continue
    f=$(basename "$f" .state)
    printf '%s\n' "${f#bg-}"
  done
}

# ============================================================================
# Helper: resolve a user-supplied argument to a slug (printed on stdout).
#   - exact slug match wins
#   - otherwise a bare name resolves when exactly one slug ends in "-<name>"
#   - several matches: candidates on stderr, return 2
#   - no match: the argument is echoed back unchanged, return 0 (the caller
#     reports the missing state/log file and calls suggest_candidates)
# ============================================================================
resolve_slug() {
  local name="$1"
  local slugs slug matches="" count=0

  slugs=$(list_slugs)

  while IFS= read -r slug; do
    [[ -n "$slug" ]] || continue
    if [[ "$slug" == "$name" ]]; then
      printf '%s\n' "$slug"
      return 0
    fi
  done <<< "$slugs"

  while IFS= read -r slug; do
    [[ -n "$slug" ]] || continue
    if [[ "$slug" == *"-$name" ]]; then
      matches="${matches}${slug}"$'\n'
      count=$((count + 1))
    fi
  done <<< "$slugs"

  if [[ $count -eq 1 ]]; then
    printf '%s\n' "${matches%%$'\n'*}"
    return 0
  fi

  if [[ $count -gt 1 ]]; then
    echo "Ambiguous name '$name' — matches $count registered slugs; use the full slug:" >&2
    while IFS= read -r slug; do
      [[ -n "$slug" ]] && echo "  $slug" >&2
    done <<< "$matches"
    return 2
  fi

  printf '%s\n' "$name"
  return 0
}

# ============================================================================
# Helper: print the closest registered slugs for an unknown argument (stderr).
# Closest = slugs containing the argument or contained in it; if none, all.
# ============================================================================
suggest_candidates() {
  local name="$1"
  local slugs slug close="" all=""

  slugs=$(list_slugs)

  while IFS= read -r slug; do
    [[ -n "$slug" ]] || continue
    all="${all}${slug}"$'\n'
    if [[ "$slug" == *"$name"* || "$name" == *"$slug"* ]]; then
      close="${close}${slug}"$'\n'
    fi
  done <<< "$slugs"

  if [[ -z "$all" ]]; then
    return 0
  fi

  if [[ -n "$close" ]]; then
    echo "Closest registered slugs:" >&2
  else
    close="$all"
    echo "Registered slugs:" >&2
  fi

  while IFS= read -r slug; do
    [[ -n "$slug" ]] && echo "  $slug" >&2
  done <<< "$close"
  return 0
}

# ============================================================================
# Helper: resolve the calling agent's project via GET /api/agents/whoami.
# Sets globals (always returns 0, so callers are safe under `set -e`):
#   CALLER_PROJECT_ID / CALLER_PROJECT_NAME  = the caller's project (else empty)
#   CALLER_UNRESOLVED_REASON                 = why it could not be resolved
#                                              (empty when resolved)
# ============================================================================
resolve_caller_project() {
  local body kind pid pname
  CALLER_PROJECT_ID=""
  CALLER_PROJECT_NAME=""
  CALLER_UNRESOLVED_REASON=""

  if [[ -z "${CONDUCTOR_AGENT_NAME:-}" ]]; then
    CALLER_UNRESOLVED_REASON="CONDUCTOR_AGENT_NAME is not set"
    return 0
  fi
  if ! command -v jq &> /dev/null; then
    CALLER_UNRESOLVED_REASON="jq is not installed"
    return 0
  fi
  if ! body=$(api_get /api/agents/whoami); then
    CALLER_UNRESOLVED_REASON="host-server did not answer /api/agents/whoami"
    return 0
  fi
  if ! kind=$(printf '%s' "$body" | jq -r '.kind // empty' 2>/dev/null) || [[ -z "$kind" ]]; then
    CALLER_UNRESOLVED_REASON="unparseable whoami response"
    return 0
  fi

  case "$kind" in
    agent) ;;
    unknown)
      CALLER_UNRESOLVED_REASON="not a registered agent (whoami kind: unknown)"
      return 0
      ;;
    ambiguous)
      CALLER_UNRESOLVED_REASON="ambiguous agent name (whoami kind: ambiguous)"
      return 0
      ;;
    *)
      CALLER_UNRESOLVED_REASON="whoami kind: $kind"
      return 0
      ;;
  esac

  if ! pid=$(printf '%s' "$body" | jq -r '.projectId // empty' 2>/dev/null); then
    CALLER_UNRESOLVED_REASON="unparseable whoami response"
    return 0
  fi
  if [[ -z "$pid" ]]; then
    CALLER_UNRESOLVED_REASON="agent has no project"
    return 0
  fi
  # The id is passed to jq --argjson later; accept only a plain integer.
  if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
    CALLER_UNRESOLVED_REASON="unparseable whoami response"
    return 0
  fi

  pname=$(printf '%s' "$body" | jq -r '.projectName // empty' 2>/dev/null || true)
  CALLER_PROJECT_ID="$pid"
  CALLER_PROJECT_NAME="${pname:-project $pid}"
  return 0
}

# ============================================================================
# Subcommand: list
# ============================================================================
cmd_list() {
  local all=0 arg json_output lines filter_pid="" offline_suffix=""

  for arg in "$@"; do
    case "$arg" in
      --all)
        all=1
        ;;
      *)
        echo "Unknown option: $arg" >&2
        echo "Usage: dev-commands.sh list [--all]" >&2
        return 1
        ;;
    esac
  done

  # The offline state-file glob has no project field, so it cannot be filtered.
  if [[ $all -eq 0 ]]; then
    offline_suffix=" (cannot filter by project offline)"
  fi

  # Try to fetch live data from the host-server
  if ! json_output=$(fetch_api_status); then
    # Host-server unreachable; fall back to globbing state files
    echo "Note: host-server unreachable; using offline state files instead.${offline_suffix}" >&2
    cmd_list_offline
    return $?
  fi

  if ! command -v jq &> /dev/null; then
    # jq not available; fall through to offline fallback
    echo "Note: jq not available; using offline state files instead.${offline_suffix}" >&2
    cmd_list_offline
    return $?
  fi

  # Default: scope to the caller's project. Every unresolved case falls back to
  # showing all projects (never less), with a note on stderr.
  if [[ $all -eq 0 ]]; then
    resolve_caller_project
    if [[ -n "$CALLER_PROJECT_ID" ]]; then
      filter_pid="$CALLER_PROJECT_ID"
    else
      echo "Note: could not resolve your project (${CALLER_UNRESOLVED_REASON}); showing all projects." >&2
    fi
  fi

  if [[ -n "$filter_pid" ]]; then
    echo "Background processes for project ${CALLER_PROJECT_NAME} (use --all for every project):"
    if ! lines=$(echo "$json_output" | jq -r --argjson pid "$filter_pid" \
      '[.bgProcesses[]? | select(.projectId == $pid)] | sort_by(.slug // "") | .[] | "\(.slug) — liveness: \(.liveness // "unknown"), state: \(.state), window: \(.windowPresent)"'); then
      echo "FATAL: jq filter failed (malformed API response?)" >&2
      return 1
    fi
    if [[ -z "$lines" ]]; then
      echo "No background processes registered for project ${CALLER_PROJECT_NAME}."
    else
      echo "$lines"
    fi
  else
    echo "Background processes (all projects):"
    if ! lines=$(echo "$json_output" | jq -r \
      '[.bgProcesses[]?] | sort_by([(.projectName // ""), (.slug // "")]) | .[] | "\(.slug) — liveness: \(.liveness // "unknown"), state: \(.state), window: \(.windowPresent), project: \(.projectName // "(none)")"'); then
      echo "FATAL: jq filter failed (malformed API response?)" >&2
      return 1
    fi
    if [[ -n "$lines" ]]; then
      echo "$lines"
    fi
  fi
  return 0
}

cmd_list_offline() {
  local state_files
  state_files=("$CONDUCTOR_STATE_DIR"/bg-*.state)

  if [[ ! -e "${state_files[0]}" ]]; then
    echo "No background processes registered yet."
    return 0
  fi

  echo "Background processes (from state files):"
  for state_file in "${state_files[@]}"; do
    if [[ -e "$state_file" ]]; then
      local name
      name=$(basename "$state_file" .state | sed 's/^bg-//')
      local state
      state=$(cat "$state_file")
      echo "$name — state: $state"
    fi
  done
}

# ============================================================================
# Subcommand: status <slug>
# ============================================================================
cmd_status() {
  local name="${1:-}"

  if [[ -z "$name" ]]; then
    echo "Usage: dev-commands.sh status <slug>" >&2
    return 1
  fi

  local slug rc=0
  slug=$(resolve_target_slug "$name") || rc=$?
  if [[ $rc -ne 0 ]]; then
    return "$rc"
  fi
  if [[ "$slug" != "$name" ]]; then
    echo "Resolved '$name' to '$slug'" >&2
  fi

  # Online first: the host-server knows the process (liveness, window, last
  # restart) even when no state file exists.
  local json_output="" api_ok=0 have_jq=0 entry=""
  if command -v jq &> /dev/null; then
    have_jq=1
  fi
  if json_output=$(fetch_api_status); then
    api_ok=1
  fi
  if [[ $api_ok -eq 1 && $have_jq -eq 1 ]]; then
    entry=$(printf '%s' "$json_output" | jq -c --arg slug "$slug" \
      '[.bgProcesses[]? | select(.slug == $slug)] | .[0] // empty' 2>/dev/null || true)
    if [[ -n "$entry" ]]; then
      print_bg_status_online "$slug" "$entry"
      return 0
    fi
  fi

  # Offline (host-server unreachable or jq missing), or the host-server does not
  # know this slug: report the state file, labelled poll-lagged.
  local state_file="$CONDUCTOR_STATE_DIR/bg-$slug.state"
  if [[ ! -f "$state_file" ]]; then
    if [[ $api_ok -eq 1 && $have_jq -eq 1 ]]; then
      echo "No such background process '$name' (not registered on the host-server, and no state file)." >&2
    else
      echo "No state file for '$name' — was it ever registered?" >&2
    fi
    suggest_candidates "$name"
    return 1
  fi

  local state
  state=$(cat "$state_file")
  echo "State file (bg-$slug.state, may lag up to one poll interval):"
  echo "  $state  ($(describe_bg_state_value "$state"))"

  echo ""
  if [[ $api_ok -eq 0 ]]; then
    echo "Live cross-check unavailable (host-server unreachable)"
  elif [[ $have_jq -eq 0 ]]; then
    echo "Live cross-check unavailable (jq not installed)"
  else
    echo "Live window status: process '$slug' not found in host-server response"
  fi
  return 0
}

# ============================================================================
# Subcommand: tail <slug> [-n N]
# ============================================================================
cmd_tail() {
  local name=""
  local lines=50

  # Parse arguments: accept both "tail <slug> -n N" and "tail -n N <slug>"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -n)
        shift
        if [[ $# -gt 0 ]]; then
          lines="$1"
          shift
        else
          echo "Usage: dev-commands.sh tail <slug> [-n N]" >&2
          return 1
        fi
        ;;
      *)
        if [[ -z "$name" ]]; then
          name="$1"
        fi
        shift
        ;;
    esac
  done

  if [[ -z "$name" ]]; then
    echo "Usage: dev-commands.sh tail <slug> [-n N]" >&2
    return 1
  fi

  # -n must be a positive integer; the host-server caps it at 1000, so clamp
  # locally rather than let a larger request quietly return fewer lines.
  if [[ ! "$lines" =~ ^[0-9]+$ ]] || [[ "$lines" =~ ^0+$ ]]; then
    echo "Usage: dev-commands.sh tail <slug> [-n N]  (N must be a positive integer, got '$lines')" >&2
    return 1
  fi
  if [[ ${#lines} -gt 6 ]] || [[ $((10#$lines)) -gt 1000 ]]; then
    echo "Note: -n is capped at 1000 lines (the host-server maximum)." >&2
    lines=1000
  else
    lines=$((10#$lines))
  fi

  local slug rc=0
  slug=$(resolve_target_slug "$name") || rc=$?
  if [[ $rc -ne 0 ]]; then
    return "$rc"
  fi
  if [[ "$slug" != "$name" ]]; then
    echo "Resolved '$name' to '$slug'" >&2
  fi

  # Online: the host-server returns ANSI-stripped text (CR redraws collapsed,
  # restart markers included), printed as-is.
  local resp crc=0 offline_reason=""
  resp=$(api_call GET "/api/bg-processes/$(urlencode "$slug")/tail?lines=${lines}&format=text" raw) || crc=$?
  if [[ $crc -eq 0 ]]; then
    parse_http_response "$resp"
    case "$HTTP_CODE" in
      200)
        if [[ -z "${HTTP_BODY//[[:space:]]/}" ]]; then
          echo "(no output yet for $slug)"
        else
          printf '%s\n' "$HTTP_BODY"
        fi
        return 0
        ;;
      404)
        echo "No such background process: ${slug}" >&2
        suggest_candidates "$name"
        return 1
        ;;
      *)
        offline_reason="host-server answered HTTP ${HTTP_CODE:-unknown} for the tail request"
        ;;
    esac
  else
    offline_reason="host-server unreachable"
  fi

  # Offline fallback: read the log directly, best-effort escape strip.
  local log_file="$CONDUCTOR_LOG_DIR/bg-$slug.log"

  if [[ ! -f "$log_file" ]]; then
    echo "No log file for '$name' — has it printed output yet?" >&2
    suggest_candidates "$name"
    return 1
  fi

  echo "Note: ${offline_reason}; showing the raw log with a best-effort escape strip." >&2
  tail -n "$lines" "$log_file" | strip_terminal_escapes
}

# ============================================================================
# Helpers for restart
# ============================================================================

# Percent-encode a string for use as a URL path segment (byte-wise, bash 3.2 safe).
urlencode() {
  local LC_ALL=C
  local s="$1" out="" c i
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in
      [A-Za-z0-9._~-]) out="${out}${c}" ;;
      *) out="${out}$(printf '%%%02X' "'$c")" ;;
    esac
  done
  printf '%s' "$out"
}

# Print the value of a flat top-level JSON key (empty when missing or null).
# Uses jq when present, otherwise a small sed extraction (string or number
# values only; good enough for the flat server error bodies).
json_field() {
  local body="$1" key="$2" v=""
  if command -v jq &> /dev/null; then
    v=$(printf '%s' "$body" | jq -r --arg k "$key" \
      'if type == "object" then (.[$k] | if . == null then empty else tostring end) else empty end' 2>/dev/null || true)
  else
    v=$(printf '%s' "$body" | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1 || true)
    if [[ -z "$v" ]]; then
      v=$(printf '%s' "$body" | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\\([-0-9.][0-9.]*\\).*/\\1/p" | head -n 1 || true)
    fi
  fi
  printf '%s' "$v"
}

# ISO-8601 UTC timestamp (e.g. 2026-09-20T10:11:12.345Z) -> epoch seconds.
# Returns 1 when it cannot be parsed (BSD date on macOS, then GNU date).
iso_to_epoch() {
  local ts="$1" base e
  base="${ts%%.*}"
  base="${base%Z}"
  e=$(TZ=UTC date -j -f '%Y-%m-%dT%H:%M:%S' "$base" +%s 2>/dev/null) \
    || e=$(date -u -d "${base}Z" +%s 2>/dev/null) \
    || return 1
  [[ "$e" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$e"
}

# Split the output of `api_call ... raw` (curl -i: headers + body) into the
# globals HTTP_CODE, HTTP_HDR (the LAST header block, 1xx interim blocks skipped)
# and HTTP_BODY. Note: $(...) strips trailing newlines, so a body-less response
# can end in a bare CR; a missing separator therefore means "no body".
parse_http_response() {
  local crlf2=$'\r\n\r\n' rest="$1" first
  HTTP_CODE=""
  HTTP_HDR=""
  HTTP_BODY=""
  while :; do
    if [[ "$rest" == *"$crlf2"* ]]; then
      HTTP_HDR="${rest%%"$crlf2"*}"
      rest="${rest#*"$crlf2"}"
    else
      HTTP_HDR="$rest"
      rest=""
    fi
    first="${HTTP_HDR%%$'\n'*}"
    first="${first%$'\r'}"
    HTTP_CODE="${first#* }"
    HTTP_CODE="${HTTP_CODE%% *}"
    if [[ "$HTTP_CODE" == 1* && -n "$rest" ]]; then
      continue
    fi
    break
  done
  HTTP_BODY="$rest"
}

# Project-aware slug resolution shared by `restart`, `status` and `tail`
# (resolved slug printed on stdout). Order:
#   1. exact slug match wins
#   2. bare name within the caller's project (never crosses projects)
#   3. bare name (or the "-<name>" slug suffix) matching exactly one process machine-wide
# Several matches at a step: candidates on stderr, return 1 (restart exits 1 on
# that; status/tail map it to their historical exit 2 via resolve_target_slug).
# No match, jq missing or host-server unreachable: the argument is echoed back
# unchanged (return 0) and the caller reports the outcome (404 or unreachable).
resolve_project_slug() {
  local arg="$1" json matches count slug

  if ! command -v jq &> /dev/null; then
    echo "Note: jq is not installed; using '$arg' as the exact slug (no bare-name or project-scoped matching)." >&2
    printf '%s\n' "$arg"
    return 0
  fi
  if ! json=$(fetch_api_status); then
    printf '%s\n' "$arg"
    return 0
  fi

  # 1. exact slug
  if printf '%s' "$json" | jq -e --arg s "$arg" \
    '[.bgProcesses[]? | select(.slug == $s)] | length > 0' > /dev/null 2>&1; then
    printf '%s\n' "$arg"
    return 0
  fi

  # 2. bare name within the caller's project only
  resolve_caller_project
  matches=""
  if [[ -n "$CALLER_PROJECT_ID" ]]; then
    matches=$(printf '%s' "$json" | jq -r --arg n "$arg" --argjson pid "$CALLER_PROJECT_ID" \
      '[.bgProcesses[]? | select(.name == $n and .projectId == $pid) | .slug] | unique | .[]' 2>/dev/null || true)
  fi

  # 3. bare name machine-wide (only when step 2 found nothing)
  if [[ -z "$matches" ]]; then
    matches=$(printf '%s' "$json" | jq -r --arg n "$arg" \
      '[.bgProcesses[]? | select(.name == $n or ((.slug // "") | endswith("-" + $n))) | .slug] | unique | .[]' 2>/dev/null || true)
  fi

  count=0
  while IFS= read -r slug; do
    [[ -n "$slug" ]] || continue
    count=$((count + 1))
  done <<< "$matches"

  if [[ $count -eq 1 ]]; then
    printf '%s\n' "${matches%%$'\n'*}"
    return 0
  fi
  if [[ $count -gt 1 ]]; then
    echo "Ambiguous name '$arg' — matches $count registered processes; use the full slug:" >&2
    while IFS= read -r slug; do
      [[ -n "$slug" ]] && echo "  $slug" >&2
    done <<< "$matches"
    return 1
  fi

  printf '%s\n' "$arg"
  return 0
}

# Slug resolution for `status` and `tail` (resolved slug printed on stdout).
# Online (jq present and the host-server answers): the same project-aware
# resolution as `restart` (resolve_project_slug), so `status dev`, `tail dev` and
# `restart dev` agree; an ambiguous bare name keeps status/tail's historical
# exit 2 (restart uses 1). Offline: resolve_slug over the bg-*.state basenames
# (no project awareness, since state files carry no project field).
resolve_target_slug() {
  local arg="$1" rc=0
  if command -v jq &> /dev/null && fetch_api_status > /dev/null 2>&1; then
    resolve_project_slug "$arg" || rc=$?
    if [[ $rc -ne 0 ]]; then
      return 2
    fi
    return 0
  fi
  resolve_slug "$arg"
}

# Best-effort terminal-escape cleaner for the offline `tail` fallback (stdin ->
# stdout). Strips OSC sequences (ESC ] ... BEL) and CSI sequences (ESC [ ...
# final byte), drops CR from CRLF line endings, then keeps only the text after
# the last CR on a line (a progress redraw). Only BSD/GNU-compatible sed syntax;
# LC_ALL=C so stray non-UTF-8 bytes cannot make BSD sed abort.
strip_terminal_escapes() {
  local esc=$'\033' bel=$'\007' cr=$'\r'
  LC_ALL=C sed -E \
    -e "s/${esc}\\][^${bel}]*${bel}//g" \
    -e "s/${esc}\\[[0-9;?<=>]*[ -/]*[@-~]//g" \
    -e "s/${cr}+\$//" \
    -e "s/.*${cr}//"
}

# One-line meaning of a bg-<slug>.state value (written by monitor.sh:
# running | exited | dead). Anything else is a legacy value from before TASK-0191.
describe_bg_state_value() {
  case "$1" in
    running) printf 'alive in its window at the last poll' ;;
    exited) printf 'window open but the process is gone (crashed or finished)' ;;
    dead) printf 'window not found' ;;
    *) printf 'legacy value' ;;
  esac
}

# Print the online `status` report for one BgStatus JSON object ($2, compact) of
# slug $1. The caller has verified jq is installed.
print_bg_status_online() {
  local slug="$1" entry="$2"
  local project liveness window has_restart last_at last_by state

  project=$(printf '%s' "$entry" | jq -r '.projectName // empty' 2>/dev/null || true)
  liveness=$(printf '%s' "$entry" | jq -r '.liveness // empty' 2>/dev/null || true)
  window=$(printf '%s' "$entry" | jq -r 'if .windowPresent == true then "present" elif .windowPresent == false then "absent" else "unknown" end' 2>/dev/null || echo unknown)
  has_restart=$(printf '%s' "$entry" | jq -r 'has("lastRestart")' 2>/dev/null || echo false)
  last_at=$(printf '%s' "$entry" | jq -r '.lastRestart.at // empty' 2>/dev/null || true)
  last_by=$(printf '%s' "$entry" | jq -r '.lastRestart.caller // empty' 2>/dev/null || true)
  state=$(printf '%s' "$entry" | jq -r '.state // empty' 2>/dev/null || true)
  if [[ -z "$state" && -f "$CONDUCTOR_STATE_DIR/bg-$slug.state" ]]; then
    state=$(cat "$CONDUCTOR_STATE_DIR/bg-$slug.state")
  fi

  if [[ -n "$project" ]]; then
    echo "$slug (project $project)"
  else
    echo "$slug (no project)"
  fi
  if [[ -n "$liveness" ]]; then
    echo "  liveness:     $liveness"
  else
    echo "  liveness:     unknown (host-server predates liveness reporting)"
  fi
  echo "  window:       $window"
  if [[ "$has_restart" == "true" ]]; then
    if [[ -n "$last_at" ]]; then
      echo "  last restart: $last_at by ${last_by:-the dashboard}"
    else
      echo "  last restart: never"
    fi
  fi
  echo "  state file:   ${state:-(none)}  (poll-lagged, may be up to one poll interval old)"

  # One plain sentence interpreting the liveness (falls back to the window
  # signal for a host-server that predates liveness reporting).
  local verdict="$liveness"
  if [[ -z "$verdict" ]]; then
    if [[ "$window" == "absent" ]]; then
      verdict="stopped"
    else
      verdict="unknown"
    fi
  fi
  case "$verdict" in
    running)
      echo "The process is running (its window is open and a process is in the pane)."
      ;;
    exited)
      echo "The process is not running (window is at a shell prompt); check 'tail', then 'restart' if appropriate."
      ;;
    stopped)
      echo "No tmux window; 'restart' will start it."
      ;;
    *)
      echo "This host-server cannot tell whether the process inside the window is still running; check 'tail'."
      ;;
  esac
}

# ============================================================================
# Subcommand: restart <name>
# Thin client over POST /api/bg-processes/<slug>/restart. Never retries.
# ============================================================================
cmd_restart() {
  local name="${1:-}"

  if [[ -z "$name" ]]; then
    echo "Usage: dev-commands.sh restart <name>" >&2
    return 1
  fi

  local slug rc=0
  slug=$(resolve_project_slug "$name") || rc=$?
  if [[ $rc -ne 0 ]]; then
    return 1
  fi
  if [[ "$slug" != "$name" ]]; then
    echo "Resolved '$name' to '$slug'" >&2
  fi

  # One request; headers + body captured in a single variable (no temp files).
  local resp crc=0
  resp=$(api_call POST "/api/bg-processes/$(urlencode "$slug")/restart" raw) || crc=$?
  if [[ $crc -ne 0 ]]; then
    echo "Cannot reach the conductor host-server on port ${BACKEND_PORT}; restart needs it (there is no offline fallback)." >&2
    return 2
  fi

  parse_http_response "$resp"
  local hdr="$HTTP_HDR" body="$HTTP_BODY" code="$HTTP_CODE"

  local retry_hdr="" hline
  while IFS= read -r hline; do
    hline="${hline%$'\r'}"
    if [[ "$hline" =~ ^[Rr][Ee][Tt][Rr][Yy]-[Aa][Ff][Tt][Ee][Rr]:[[:space:]]*([0-9]+) ]]; then
      retry_hdr="${BASH_REMATCH[1]}"
    fi
  done <<< "$hdr"

  local err step
  case "$code" in
    200)
      local restarted_at
      restarted_at=$(json_field "$body" restartedAt)
      echo "Restarted ${slug} at ${restarted_at:-(time unknown)}. Use 'dev-commands.sh tail ${slug}' to watch it come back up."
      return 0
      ;;
    403)
      local bg_pid caller_pid
      bg_pid=$(json_field "$body" bgProjectId)
      caller_pid=$(json_field "$body" callerProjectId)
      err=$(json_field "$body" error)
      echo "Refused: ${slug} belongs to project ${bg_pid:-(none)}, you are in project ${caller_pid:-(none)} (or your agent identity could not be resolved)." >&2
      if [[ -n "$err" ]]; then
        echo "Server said: ${err}" >&2
      else
        echo "Server response: ${body}" >&2
      fi
      echo "Do not retry; only processes in your own project can be restarted." >&2
      return 3
      ;;
    404)
      echo "No such background process: ${slug}" >&2
      suggest_candidates "$name"
      return 1
      ;;
    409)
      echo "The conductor tmux session is not running; nothing to restart." >&2
      return 4
      ;;
    429)
      local last_at last_by retry_s ago="" now epoch
      last_at=$(json_field "$body" lastRestartAt)
      last_by=$(json_field "$body" lastRestartBy)
      retry_s=$(json_field "$body" retryAfterS)
      if [[ -z "$retry_s" ]]; then
        retry_s="$retry_hdr"
      fi
      if [[ -n "$last_at" ]] && epoch=$(iso_to_epoch "$last_at"); then
        now=$(date +%s)
        ago=$((now - epoch))
        if [[ $ago -lt 0 ]]; then
          ago=0
        fi
      fi
      if [[ -n "$ago" ]]; then
        echo "Restart skipped: ${slug} was restarted ${ago}s ago by ${last_by:-the dashboard}. Retry in ${retry_s:-?}s (or check its output with 'tail' first)." >&2
      else
        echo "Restart skipped: ${slug} was restarted recently by ${last_by:-the dashboard}. Retry in ${retry_s:-?}s (or check its output with 'tail' first)." >&2
      fi
      echo "Do NOT retry in a loop: the cooldown exists to stop restart loops. Check 'dev-commands.sh tail ${slug}' and wait." >&2
      return 5
      ;;
    500)
      local status
      err=$(json_field "$body" error)
      step=$(json_field "$body" step)
      status=$(json_field "$body" status)
      echo "Restart of ${slug} failed on the host-server: ${err:-$body}" >&2
      if [[ -n "$step" ]]; then
        echo "  step: ${step}" >&2
      fi
      if [[ -n "$status" ]]; then
        echo "  status: ${status}" >&2
      fi
      return 6
      ;;
    *)
      echo "Unexpected response from the host-server (HTTP ${code:-unknown}): ${body:-$resp}" >&2
      return 6
      ;;
  esac
}

# ============================================================================
# Main dispatch
# ============================================================================
case "${1:-}" in
  list)
    shift || true
    # A non-zero return (e.g. unknown option -> 1) exits the script via set -e
    cmd_list "$@"
    ;;
  status)
    shift || true
    cmd_status "$@"
    ;;
  tail)
    shift || true
    cmd_tail "$@"
    ;;
  restart)
    shift || true
    cmd_restart "$@"
    ;;
  *)
    echo "Usage: dev-commands.sh {list|status|tail|restart} [options]" >&2
    echo "" >&2
    echo "Subcommands:" >&2
    echo "  list [--all]         List background processes for your project (all projects with --all)" >&2
    echo "  status <slug>        Show liveness (running|exited|stopped), window, last restart and state for a process" >&2
    echo "  tail <slug> [-n N]   Print the last N lines (default 50, max 1000) of a process's clean output" >&2
    echo "  restart <name>       Restart a process in your project (needs the host-server; never retry a cooldown)" >&2
    echo "" >&2
    echo "<slug> is <projectName>-<name>. A bare <name> works when it matches exactly one slug;" >&2
    echo "an ambiguous name exits 2 (status/tail) or 1 (restart) and lists the candidates." >&2
    echo "restart exit codes: 0 ok, 1 not found/usage/ambiguous, 2 host-server unreachable, 3 refused," >&2
    echo "4 no tmux session, 5 cooldown, 6 other failure." >&2
    exit 1
    ;;
esac
