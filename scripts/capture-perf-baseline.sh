#!/usr/bin/env bash
# scripts/capture-perf-baseline.sh — poll GET /api/perf/live-updates on a
# fixed interval and append one JSONL sample per tick to
# ./tmp/roadmap-017-perf-capture/<run-id>.jsonl (TASK-117 step 1).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Port resolution: env > conductor.conf > default -----------------------
# conductor.conf is tuning-only and does not currently define BACKEND_PORT
# (the port is normally set via root .env / .env.example), but source it in a
# subshell anyway so a future BACKEND_PORT entry there is honored without
# polluting this script's scope.
if [[ -z "${BACKEND_PORT:-}" ]]; then
  _conf="$REPO_ROOT/conductor.conf"
  if [[ -f "$_conf" ]]; then
    BACKEND_PORT_FROM_CONF="$(bash -c "source \"$_conf\" 2>/dev/null && echo \"\${BACKEND_PORT:-}\"")"
  fi
  BACKEND_PORT="${BACKEND_PORT_FROM_CONF:-8788}"
fi

HOST="${HOST:-localhost}"
ENDPOINT="${ENDPOINT:-http://${HOST}:${BACKEND_PORT}/api/perf/live-updates}"

# --- Interval / duration: env, then CLI flags override ---------------------
INTERVAL_S="${INTERVAL_S:-10}"
DURATION_S="${DURATION_S:-7200}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--interval SECONDS] [--duration SECONDS]

Polls ${ENDPOINT} every INTERVAL_S seconds (default 10) for up to
DURATION_S seconds (default 7200 = 2h), or until Ctrl-C, appending one JSON
line per sample to ./tmp/roadmap-017-perf-capture/<run-id>.jsonl.

Env overrides: BACKEND_PORT, HOST, ENDPOINT, INTERVAL_S, DURATION_S.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval)
      INTERVAL_S="$2"; shift 2 ;;
    --duration)
      DURATION_S="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if ! [[ "$INTERVAL_S" =~ ^[0-9]+$ ]] || [[ "$INTERVAL_S" -le 0 ]]; then
  echo "INTERVAL_S must be a positive integer (got: $INTERVAL_S)" >&2
  exit 1
fi
if ! [[ "$DURATION_S" =~ ^[0-9]+$ ]] || [[ "$DURATION_S" -le 0 ]]; then
  echo "DURATION_S must be a positive integer (got: $DURATION_S)" >&2
  exit 1
fi

OUT_DIR="$REPO_ROOT/tmp/roadmap-017-perf-capture"
mkdir -p "$OUT_DIR"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$OUT_DIR/${RUN_ID}.jsonl"

log() { echo "[$(date +%H:%M:%S)] $*"; }

SAMPLE_COUNT=0
ERROR_COUNT=0
START_TS=$(date +%s)
STOP=0

on_stop() {
  STOP=1
}
trap on_stop SIGINT SIGTERM

log "Capturing ${ENDPOINT} every ${INTERVAL_S}s for up to ${DURATION_S}s -> ${OUT_FILE}"
log "Press Ctrl-C to stop early."

while [[ "$STOP" -eq 0 ]]; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - START_TS))
  if [[ "$ELAPSED" -ge "$DURATION_S" ]]; then
    break
  fi

  CAPTURED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  CURL_ERR_FILE="$OUT_DIR/.curl-err.$$"
  RESPONSE="$(curl -sS --max-time 10 "$ENDPOINT" 2>"$CURL_ERR_FILE")"
  CURL_RC=$?

  if [[ "$CURL_RC" -eq 0 && -n "$RESPONSE" ]]; then
    LINE="$(RESPONSE="$RESPONSE" CAPTURED_AT="$CAPTURED_AT" node -e '
      const response = process.env.RESPONSE;
      const capturedAt = process.env.CAPTURED_AT;
      let parsed;
      try {
        parsed = JSON.parse(response);
      } catch (err) {
        console.log(JSON.stringify({ capturedAt, error: `invalid JSON response: ${err.message}`, raw: response }));
        process.exit(0);
      }
      console.log(JSON.stringify({ capturedAt, response: parsed }));
    ')"
    printf '%s\n' "$LINE" >>"$OUT_FILE"
    SAMPLE_COUNT=$((SAMPLE_COUNT + 1))
  else
    ERR_MSG="$(cat "$CURL_ERR_FILE" 2>/dev/null)"
    log "WARN: sample failed (curl exit ${CURL_RC}): ${ERR_MSG}"
    printf '%s\n' "$(CAPTURED_AT="$CAPTURED_AT" ERR_MSG="$ERR_MSG" node -e '
      console.log(JSON.stringify({ capturedAt: process.env.CAPTURED_AT, error: process.env.ERR_MSG || "curl failed" }));
    ')" >>"$OUT_FILE"
    ERROR_COUNT=$((ERROR_COUNT + 1))
  fi
  rm -f "$CURL_ERR_FILE"

  if [[ $((SAMPLE_COUNT % 6)) -eq 0 || "$SAMPLE_COUNT" -eq 1 ]]; then
    log "samples=${SAMPLE_COUNT} errors=${ERROR_COUNT} elapsed=${ELAPSED}s"
  fi

  for ((i = 0; i < INTERVAL_S; i++)); do
    if [[ "$STOP" -ne 0 ]]; then
      break
    fi
    sleep 1
  done
done

TOTAL_ELAPSED=$(( $(date +%s) - START_TS ))
log "Stopped. samples=${SAMPLE_COUNT} errors=${ERROR_COUNT} elapsed=${TOTAL_ELAPSED}s -> ${OUT_FILE}"
