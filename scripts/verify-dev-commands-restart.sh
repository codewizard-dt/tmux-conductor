#!/usr/bin/env bash
# verify-dev-commands-restart.sh — Stub-server regression tests for the online
# subcommands of skills/dev-commands/scripts/dev-commands.sh: `restart <name>`
# (TASK-0203) plus the online `status`/`tail`/`list` output (TASK-0204: liveness,
# lastRestart, the clean-text tail endpoint). The filename keeps its TASK-0203 name.
#
# `restart` is a thin client over POST /api/bg-processes/<slug>/restart. This
# script exercises it against a tiny Node stub HTTP server that listens on a
# private ephemeral port (127.0.0.1, port 0) and answers /api/status,
# /api/agents/whoami, /api/bg-processes/<slug>/tail and the restart route with a
# status/body chosen by the slug. It never touches the real host-server (:8788),
# tmux, or any real bg process. TASK-0204 additions: `status` prints liveness
# (running/exited/stopped), the exited/stopped interpretive sentences, a degraded
# line for a server without `liveness`, and lastRestart; `tail` passes the text
# body through unchanged, forwards -n as lines= (clamped to 1000), rejects a
# non-integer -n, prints "(no output yet ...)" for an empty body and exits 1 with
# candidates on 404; `list` carries the liveness value. Restart-era assertions: the exit code and message for every HTTP status, the
# X-Conductor-Agent header being forwarded verbatim (and omitted when the env
# var is unset or empty), NO retry on 429 (the stub counts requests), bare-name
# resolution within the caller's project, an ambiguous bare name exiting 1 with
# candidates, an unreachable port exiting 2, and a no-argument call exiting 1
# with usage. The jq-less fallback is exercised with a PATH that has no jq.
#
# Requires: node (stub server). jq is needed for the resolution tests; when it
# is missing those are reported as SKIP rather than FAIL.
#
# Usage: bash scripts/verify-dev-commands-restart.sh
# Artifacts land in ./tmp/verify-dev-commands-restart/ (gitignored) and are
# removed on exit; the stub server is always killed on EXIT/INT/TERM.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_CMD="$REPO/skills/dev-commands/scripts/dev-commands.sh"
WORK="$REPO/tmp/verify-dev-commands-restart"
STATE_DIR="$WORK/state"
LOG_DIR="$WORK/log"
REQ_LOG="$WORK/requests.jsonl"
PORT_FILE="$WORK/port"
STUB_JS="$WORK/stub-server.js"
NOJQ_BIN="$WORK/nojq-bin"
BASH_BIN="$(command -v bash)"

FAILURES=0
CHECKS=0
SKIPS=0
fail() {
  echo "[verify-dev-commands-restart] FAIL: $1"
  FAILURES=$((FAILURES + 1))
  CHECKS=$((CHECKS + 1))
}
pass() {
  echo "[verify-dev-commands-restart] PASS: $1"
  CHECKS=$((CHECKS + 1))
}
skip() {
  echo "[verify-dev-commands-restart] SKIP: $1"
  SKIPS=$((SKIPS + 1))
}

STUB_PID=""
stop_stub() {
  if [[ -n "$STUB_PID" ]]; then
    kill "$STUB_PID" 2> /dev/null || true
    wait "$STUB_PID" 2> /dev/null || true
    STUB_PID=""
  fi
}
cleanup() {
  stop_stub
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

rm -rf "$WORK"
mkdir -p "$STATE_DIR" "$LOG_DIR" "$NOJQ_BIN"

# dev-commands.sh FATALs without these two; they only need to point at existing
# fixtures. restart never reads them (it is an online-only subcommand).
export CONDUCTOR_STATE_DIR="$STATE_DIR"
export CONDUCTOR_LOG_DIR="$LOG_DIR"

OUT=""
ERR=""
RC=0
# run_dc [-u VAR | VAR=value]... -- run dev-commands.sh with a controlled env.
# CONDUCTOR_AGENT_NAME is always unset first (this script may itself run inside
# a real conductor agent), so a test only sends the header when it asks to.
# Sets OUT (stdout), ERR (stderr), RC. Extra args are `env` assignments followed
# by the command to run.
run_dc() {
  local errf="$WORK/stderr.txt"
  OUT="$(env -u CONDUCTOR_AGENT_NAME NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost "$@" 2> "$errf")"
  RC=$?
  ERR="$(cat "$errf")"
}

expect_rc() { # desc expected
  if [[ "$RC" == "$2" ]]; then
    pass "$1 (exit $2)"
  else
    fail "$1: expected exit $2, got $RC (stdout=$OUT | stderr=$ERR)"
  fi
}
expect_in() { # desc haystack needle
  if [[ "$2" == *"$3"* ]]; then
    pass "$1"
  else
    fail "$1: expected to contain '$3' (got: $2)"
  fi
}
expect_not_in() { # desc haystack needle
  if [[ "$2" != *"$3"* ]]; then
    pass "$1"
  else
    fail "$1: expected NOT to contain '$3' (got: $2)"
  fi
}
expect_eq() { # desc actual expected
  if [[ "$2" == "$3" ]]; then
    pass "$1"
  else
    fail "$1: expected '$3', got '$2'"
  fi
}

reset_reqs() { : > "$REQ_LOG"; }
# Number of recorded POSTs to the restart route for a slug.
posts_for() {
  local n
  n=$(grep -c "\"method\":\"POST\",\"path\":\"/api/bg-processes/$1/restart\"" "$REQ_LOG" 2> /dev/null)
  echo "${n:-0}"
}
total_posts() {
  local n
  n=$(grep -c '"method":"POST"' "$REQ_LOG" 2> /dev/null)
  echo "${n:-0}"
}
# The first recorded POST line for a slug (empty when none).
post_line() {
  grep "\"method\":\"POST\",\"path\":\"/api/bg-processes/$1/restart\"" "$REQ_LOG" 2> /dev/null | head -n 1
}

# ---------------------------------------------------------------------------
# Offline/argument check: no argument prints usage and exits 1. Needs neither
# node nor a server; BACKEND_PORT is a port nothing listens on regardless.
# ---------------------------------------------------------------------------
run_dc BACKEND_PORT=1 "$BASH_BIN" "$DEV_CMD" restart
expect_rc "restart with no argument" 1
expect_in "restart with no argument prints usage" "$ERR" "Usage: dev-commands.sh restart <name>"

# ---------------------------------------------------------------------------
# Stub server (needs node)
# ---------------------------------------------------------------------------
if ! command -v node > /dev/null 2>&1; then
  skip "node is not installed; all stub-server restart tests skipped"
  echo ""
  echo "[verify-dev-commands-restart] $CHECKS check(s), $SKIPS skipped, $FAILURES failed"
  [[ $FAILURES -eq 0 ]] && exit 0 || exit 1
fi

# The stub is generated here so this verify script stays self-contained.
cat > "$STUB_JS" << 'STUB_EOF'
'use strict';
// Stub conductor host-server for verify-dev-commands-restart.sh. Records every
// request as one JSON line: {"method","path","agent"} where agent is the
// X-Conductor-Agent header value (null when absent).
const http = require('http');
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const REQ_LOG = path.join(dir, 'requests.jsonl');
const PORT_FILE = path.join(dir, 'port');

const bg = (slug, name, projectId, projectName) => ({
  slug, name, projectId, projectName, state: 'running', windowPresent: true,
});
const PROCS = [
  bg('alpha-dev', 'dev', 1, 'alpha'),
  bg('beta-dev', 'dev', 2, 'beta'),
  ...['ok-proc', 'other-proj', 'nosession', 'cool', 'cool-hdr', 'boom', 'teapot']
    .map((s) => bg(s, s, 1, 'alpha')),
];
// Processes with liveness / lastRestart for the status tests (TASK-0204). The
// ones above carry NEITHER field, which stands in for a host-server that
// predates liveness reporting.
const bgx = (slug, extra) => Object.assign(bg(slug, slug, 1, 'alpha'), extra);
PROCS.push(
  bgx('run-proc', { liveness: 'running', lastRestart: { at: '2026-09-20T09:00:00.000Z', caller: 'agent-alpha' } }),
  bgx('crash-proc', { liveness: 'exited', lastRestart: null }),
  bgx('stop-proc', { liveness: 'stopped', windowPresent: false, state: 'dead', lastRestart: { at: '2026-09-20T08:00:00.000Z', caller: null } }),
  bgx('quiet-proc', { liveness: 'running', lastRestart: null }),
);
// `missing` is deliberately NOT registered: its restart route answers 404.

const AGENTS = {
  'agent-alpha': { kind: 'agent', agentId: 'a1', agentName: 'agent-alpha', projectId: 1, projectName: 'alpha' },
  'agent-beta': { kind: 'agent', agentId: 'a2', agentName: 'agent-beta', projectId: 2, projectName: 'beta' },
};

function send(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    Connection: 'close',
  }, extraHeaders || {}));
  res.end(body);
}

function restartRoute(slug, res) {
  switch (slug) {
    case 'ok-proc':
    case 'alpha-dev':
    case 'beta-dev':
      return send(res, 200, { ok: true, name: slug, restartedAt: '2026-09-20T10:00:00.000Z', mechanism: 'respawn-window' });
    case 'other-proj':
      return send(res, 403, { error: 'restart denied: project-mismatch', reason: 'project-mismatch', callerProjectId: 1, bgProjectId: 2 });
    case 'nosession':
      return send(res, 409, { error: 'session not running', sessionAlive: false });
    case 'cool':
      return send(res, 429, {
        error: 'restart cooldown',
        retryAfterS: 42,
        lastRestartAt: new Date(Date.now() - 30000).toISOString(),
        lastRestartBy: 'agent-beta',
      }, { 'Retry-After': '42' });
    case 'cool-hdr':
      // Body without retryAfterS: the client must fall back to the header.
      return send(res, 429, { error: 'restart cooldown' }, { 'Retry-After': '17' });
    case 'boom':
      return send(res, 500, { error: 'restart failed', step: 'respawn-window', status: 1 });
    case 'teapot':
      return send(res, 418, { error: 'i am a teapot' });
    default:
      return send(res, 404, { error: 'no such background process: ' + slug });
  }
}

// GET /api/bg-processes/:slug/tail?lines=N&format=text. Registered slugs answer
// 200 text/plain (`quiet-proc` with an empty body); anything else is a 404.
function tailRoute(slug, res) {
  if (!PROCS.some((p) => p.slug === slug)) {
    return send(res, 404, { error: "bg process '" + slug + "' not found" });
  }
  const body = slug === 'quiet-proc'
    ? ''
    : slug + ' output line 1\n--- restart 2026-09-20T09:00:00.000Z ---\n' + slug + ' output line 2\n';
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Connection: 'close' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const agent = req.headers['x-conductor-agent'];
  const [url, query] = req.url.split('?');
  fs.appendFileSync(REQ_LOG, JSON.stringify({ method: req.method, path: url, agent: agent === undefined ? null : agent, query: query || '' }) + '\n');

  if (req.method === 'GET' && url === '/api/status') {
    return send(res, 200, { bgProcesses: PROCS });
  }
  if (req.method === 'GET' && url === '/api/agents/whoami') {
    return send(res, 200, AGENTS[agent] || { kind: 'unknown' });
  }
  const t = /^\/api\/bg-processes\/([^/]+)\/tail$/.exec(url);
  if (req.method === 'GET' && t) {
    return tailRoute(decodeURIComponent(t[1]), res);
  }
  const m = /^\/api\/bg-processes\/([^/]+)\/restart$/.exec(url);
  if (req.method === 'POST' && m) {
    return restartRoute(decodeURIComponent(m[1]), res);
  }
  return send(res, 404, { error: 'not found' });
});

server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(PORT_FILE, String(server.address().port));
});
STUB_EOF

: > "$REQ_LOG"
node "$STUB_JS" "$WORK" > "$WORK/stub.log" 2>&1 &
STUB_PID=$!

PORT=""
for _ in $(seq 1 100); do
  if [[ -s "$PORT_FILE" ]]; then
    PORT="$(cat "$PORT_FILE")"
    break
  fi
  if ! kill -0 "$STUB_PID" 2> /dev/null; then
    break
  fi
  sleep 0.1
done
if [[ ! "$PORT" =~ ^[0-9]+$ ]]; then
  fail "stub server did not come up (port='$PORT', log=$(cat "$WORK/stub.log" 2> /dev/null))"
  echo "[verify-dev-commands-restart] FAIL — stub server unavailable; $FAILURES check(s) failed"
  exit 1
fi
pass "stub server listening on ephemeral port $PORT"

HAVE_JQ=0
command -v jq > /dev/null 2>&1 && HAVE_JQ=1
# What the stub answers for `tail run-proc` (the trailing newline is stripped by $(...)).
RUN_TAIL_EXPECTED="$(printf 'run-proc output line 1\n--- restart 2026-09-20T09:00:00.000Z ---\nrun-proc output line 2')"

# ---------------------------------------------------------------------------
# Status mapping: exit code and message per HTTP status (caller: agent-alpha).
# ---------------------------------------------------------------------------
reset_reqs
run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" restart ok-proc
expect_rc "200 -> restart succeeds" 0
expect_in "200 message names the slug" "$OUT" "Restarted ok-proc"
expect_in "200 message carries restartedAt" "$OUT" "2026-09-20T10:00:00.000Z"
expect_in "200 message has the tail hint" "$OUT" "dev-commands.sh tail ok-proc"
expect_eq "200: exactly one POST for ok-proc" "$(posts_for ok-proc)" "1"
expect_in "200: header X-Conductor-Agent forwarded verbatim" "$(post_line ok-proc)" '"agent":"agent-alpha"'

run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" restart other-proj
expect_rc "403 -> refused" 3
expect_in "403 message says Refused" "$ERR" "Refused: other-proj belongs to project 2, you are in project 1"
expect_in "403 message includes the server error text" "$ERR" "restart denied: project-mismatch"
expect_in "403 message says do not retry" "$ERR" "Do not retry"

run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" restart missing
expect_rc "404 -> unknown process" 1
expect_in "404 message names the slug" "$ERR" "No such background process: missing"
expect_in "404 message lists candidate slugs" "$ERR" "ok-proc"

run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" restart nosession
expect_rc "409 -> tmux session not running" 4
expect_in "409 message" "$ERR" "The conductor tmux session is not running; nothing to restart."

reset_reqs
run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" restart cool
expect_rc "429 -> cooldown" 5
expect_in "429 message names the slug and who restarted it" "$ERR" "Restart skipped: cool was restarted"
expect_in "429 message names lastRestartBy" "$ERR" "by agent-beta"
expect_in "429 message carries retryAfterS 42" "$ERR" "Retry in 42s"
expect_in "429 message forbids retrying in a loop" "$ERR" "Do NOT retry in a loop"
if [[ "$ERR" =~ was\ restarted\ ([0-9]+)s\ ago ]] && (( BASH_REMATCH[1] >= 25 && BASH_REMATCH[1] <= 60 )); then
  pass "429 message reports the elapsed seconds from lastRestartAt (~30s, got ${BASH_REMATCH[1]}s)"
else
  fail "429 message did not report ~30s elapsed (stderr=$ERR)"
fi
expect_eq "429: NO retry, the stub saw exactly one POST for cool" "$(posts_for cool)" "1"

reset_reqs
run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" restart cool-hdr
expect_rc "429 without body retryAfterS -> cooldown" 5
expect_in "429 falls back to the Retry-After header (17)" "$ERR" "Retry in 17s"
expect_in "429 without lastRestartBy names the dashboard" "$ERR" "by the dashboard"
expect_eq "429 (header fallback): exactly one POST for cool-hdr" "$(posts_for cool-hdr)" "1"

run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" restart boom
expect_rc "500 -> restart failed" 6
expect_in "500 message prints the server error" "$ERR" "restart failed"
expect_in "500 message prints the step" "$ERR" "step: respawn-window"
expect_in "500 message prints the status" "$ERR" "status: 1"

run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" restart teapot
expect_rc "unexpected status (418) -> exit 6" 6
expect_in "unexpected status message prints the status and body" "$ERR" "HTTP 418"

# ---------------------------------------------------------------------------
# X-Conductor-Agent header: forwarded verbatim when set; omitted when unset or
# empty. `agent` is null in the stub's record when the header was absent.
# ---------------------------------------------------------------------------
reset_reqs
run_dc BACKEND_PORT="$PORT" "CONDUCTOR_AGENT_NAME=weird name.1-x" "$BASH_BIN" "$DEV_CMD" restart ok-proc
expect_in "header forwarded verbatim (unregistered/odd value)" "$(post_line ok-proc)" '"agent":"weird name.1-x"'

reset_reqs
run_dc BACKEND_PORT="$PORT" "$BASH_BIN" "$DEV_CMD" restart ok-proc
expect_rc "restart with CONDUCTOR_AGENT_NAME unset still works" 0
expect_in "header NOT sent when CONDUCTOR_AGENT_NAME is unset" "$(post_line ok-proc)" '"agent":null'

reset_reqs
run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME= "$BASH_BIN" "$DEV_CMD" restart ok-proc
expect_in "header NOT sent when CONDUCTOR_AGENT_NAME is empty" "$(post_line ok-proc)" '"agent":null'

# ---------------------------------------------------------------------------
# Bare-name resolution (needs jq). alpha-dev (project 1) and beta-dev
# (project 2) both have a process named "dev".
# ---------------------------------------------------------------------------
if [[ $HAVE_JQ -eq 1 ]]; then
  reset_reqs
  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" restart dev
  expect_rc "bare 'dev' as agent-alpha resolves within its project" 0
  expect_eq "bare 'dev' as agent-alpha POSTs to alpha-dev" "$(posts_for alpha-dev)" "1"
  expect_eq "bare 'dev' as agent-alpha never POSTs to beta-dev" "$(posts_for beta-dev)" "0"
  expect_eq "bare 'dev' as agent-alpha sends exactly one POST" "$(total_posts)" "1"
  expect_in "bare-name resolution is announced on stderr" "$ERR" "Resolved 'dev' to 'alpha-dev'"

  reset_reqs
  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-beta "$BASH_BIN" "$DEV_CMD" restart dev
  expect_eq "bare 'dev' as agent-beta POSTs to beta-dev" "$(posts_for beta-dev)" "1"
  expect_eq "bare 'dev' as agent-beta never POSTs to alpha-dev" "$(posts_for alpha-dev)" "0"

  # An exact slug wins even across projects: the script decides no policy, the
  # server's guard answers (the stub answers 200 here).
  reset_reqs
  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" restart beta-dev
  expect_eq "exact slug beta-dev is sent as-is (server enforces the guard)" "$(posts_for beta-dev)" "1"

  # Ambiguous bare name, no caller project: exit 1, candidates listed, no POST.
  reset_reqs
  run_dc BACKEND_PORT="$PORT" "$BASH_BIN" "$DEV_CMD" restart dev
  expect_rc "ambiguous bare 'dev' with no caller project" 1
  expect_in "ambiguous bare name says Ambiguous" "$ERR" "Ambiguous name 'dev'"
  expect_in "ambiguous bare name lists alpha-dev" "$ERR" "alpha-dev"
  expect_in "ambiguous bare name lists beta-dev" "$ERR" "beta-dev"
  expect_eq "ambiguous bare name sends no POST" "$(total_posts)" "0"

  # Same when the caller identity is unknown to whoami.
  reset_reqs
  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=not-an-agent "$BASH_BIN" "$DEV_CMD" restart dev
  expect_rc "ambiguous bare 'dev' with an unresolvable caller" 1
  expect_eq "unresolvable caller + ambiguous name sends no POST" "$(total_posts)" "0"
else
  skip "jq is not installed; bare-name/caller-project resolution tests skipped"
fi

# ---------------------------------------------------------------------------
# No-jq fallback: a PATH holding only the tools restart needs (no jq). The
# resolution step degrades to the exact slug; messages come from sed parsing.
# ---------------------------------------------------------------------------
NOJQ_OK=1
for t in curl sed head date; do
  p="$(command -v "$t" 2> /dev/null)"
  if [[ -n "$p" ]]; then
    ln -s "$p" "$NOJQ_BIN/$t"
  else
    NOJQ_OK=0
  fi
done
if [[ $NOJQ_OK -eq 1 ]]; then
  reset_reqs
  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "PATH=$NOJQ_BIN" "$BASH_BIN" "$DEV_CMD" restart ok-proc
  expect_rc "no-jq: 200 -> restart succeeds" 0
  expect_in "no-jq: 200 message carries restartedAt (sed extraction)" "$OUT" "Restarted ok-proc at 2026-09-20T10:00:00.000Z"
  expect_in "no-jq: says jq is not installed" "$ERR" "jq is not installed"

  reset_reqs
  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "PATH=$NOJQ_BIN" "$BASH_BIN" "$DEV_CMD" restart cool
  expect_rc "no-jq: 429 -> cooldown" 5
  expect_in "no-jq: 429 message carries retryAfterS 42" "$ERR" "Retry in 42s"
  expect_in "no-jq: 429 message names lastRestartBy" "$ERR" "by agent-beta"
  expect_eq "no-jq: 429 sends exactly one POST" "$(posts_for cool)" "1"

  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "PATH=$NOJQ_BIN" "$BASH_BIN" "$DEV_CMD" restart other-proj
  expect_rc "no-jq: 403 -> refused" 3
  expect_in "no-jq: 403 message carries both project ids" "$ERR" "belongs to project 2, you are in project 1"

  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "PATH=$NOJQ_BIN" "$BASH_BIN" "$DEV_CMD" restart boom
  expect_rc "no-jq: 500 -> restart failed" 6
  expect_in "no-jq: 500 message carries the step" "$ERR" "step: respawn-window"

  # Without jq a bare name is not resolved: it is sent as the slug, the stub
  # does not know it, and the 404 is mapped to exit 1.
  reset_reqs
  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "PATH=$NOJQ_BIN" "$BASH_BIN" "$DEV_CMD" restart dev
  expect_rc "no-jq: bare name is not resolved -> 404 -> exit 1" 1
  expect_eq "no-jq: bare 'dev' is POSTed verbatim" "$(posts_for dev)" "1"

  # tail needs only curl online: the body is printed as-is without jq.
  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "PATH=$NOJQ_BIN" "$BASH_BIN" "$DEV_CMD" tail run-proc
  expect_rc "no-jq: tail of a registered slug succeeds" 0
  expect_eq "no-jq: tail prints the server text body" "$OUT" "$RUN_TAIL_EXPECTED"
else
  skip "curl/sed/head/date not all found; no-jq fallback tests skipped"
fi

# ---------------------------------------------------------------------------
# `status <name>` (TASK-0204): online-first report on BgStatus.liveness /
# windowPresent / lastRestart. STATE_DIR is empty here, so every result below
# also proves status works with no state file when the host-server is up.
# ---------------------------------------------------------------------------
if [[ $HAVE_JQ -eq 1 ]]; then
  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" status run-proc
  expect_rc "status of a running process" 0
  expect_in "status header names slug and project" "$OUT" "run-proc (project alpha)"
  expect_in "status prints liveness: running" "$OUT" "liveness:     running"
  expect_in "status prints window: present" "$OUT" "window:       present"
  expect_in "status renders lastRestart (timestamp by caller)" "$OUT" "last restart: 2026-09-20T09:00:00.000Z by agent-alpha"
  expect_in "status labels the state file as poll-lagged" "$OUT" "state file:   running  (poll-lagged, may be up to one poll interval old)"
  expect_in "status interprets running" "$OUT" "The process is running"

  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" status crash-proc
  expect_rc "status of an exited process still exits 0" 0
  expect_in "status prints liveness: exited" "$OUT" "liveness:     exited"
  expect_in "status prints window: present for an exited process" "$OUT" "window:       present"
  expect_in "status prints 'never' when lastRestart is null" "$OUT" "last restart: never"
  expect_in "status interprets exited" "$OUT" "The process is not running (window is at a shell prompt); check 'tail', then 'restart' if appropriate."

  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" status stop-proc
  expect_rc "status of a stopped process" 0
  expect_in "status prints liveness: stopped" "$OUT" "liveness:     stopped"
  expect_in "status prints window: absent" "$OUT" "window:       absent"
  expect_in "status names the dashboard when lastRestart.caller is null" "$OUT" "last restart: 2026-09-20T08:00:00.000Z by the dashboard"
  expect_in "status shows the server-reported state value" "$OUT" "state file:   dead"
  expect_in "status interprets stopped" "$OUT" "No tmux window; 'restart' will start it."

  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" status ok-proc
  expect_rc "status against a server without liveness exits 0" 0
  expect_in "status degrades when liveness is absent" "$OUT" "liveness:     unknown (host-server predates liveness reporting)"
  expect_in "status still reports the window when liveness is absent" "$OUT" "window:       present"
  expect_not_in "status omits the last-restart line when the field is absent" "$OUT" "last restart"

  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" status dev
  expect_rc "status <bare name> resolves in the caller's project" 0
  expect_in "status <bare name> announces the resolution" "$ERR" "Resolved 'dev' to 'alpha-dev'"
  expect_in "status <bare name> reports alpha-dev" "$OUT" "alpha-dev (project alpha)"

  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-beta "$BASH_BIN" "$DEV_CMD" status dev
  expect_in "status <bare name> as agent-beta reports beta-dev" "$OUT" "beta-dev (project beta)"

  run_dc BACKEND_PORT="$PORT" "$BASH_BIN" "$DEV_CMD" status dev
  expect_rc "status <ambiguous bare name> keeps exit 2 (restart uses 1)" 2
  expect_in "status <ambiguous bare name> lists candidates" "$ERR" "alpha-dev"
  expect_in "status <ambiguous bare name> lists every candidate" "$ERR" "beta-dev"

  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" status ghost
  expect_rc "status <unknown> -> exit 1" 1
  expect_in "status <unknown> says no such process" "$ERR" "No such background process 'ghost'"
  expect_in "status <unknown> lists registered slugs" "$ERR" "run-proc"

  # `list` carries the liveness value (TASK-0204); older tokens keep their order.
  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" list
  expect_in "list line carries liveness ahead of state and window" "$OUT" "run-proc — liveness: running, state: running, window: true"
  expect_in "list shows an exited process" "$OUT" "crash-proc — liveness: exited, state: running, window: true"
  expect_in "list shows a stopped process" "$OUT" "stop-proc — liveness: stopped, state: dead, window: false"
  expect_in "list shows 'unknown' liveness for a server without the field" "$OUT" "ok-proc — liveness: unknown, state: running, window: true"
  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" list --all
  expect_in "list --all keeps the project suffix after window" "$OUT" "run-proc — liveness: running, state: running, window: true, project: alpha"
else
  skip "jq is not installed; status tests skipped"
fi

run_dc BACKEND_PORT="$PORT" "$BASH_BIN" "$DEV_CMD" status
expect_rc "status with no argument" 1
expect_in "status with no argument prints usage" "$ERR" "Usage: dev-commands.sh status <slug>"

# ---------------------------------------------------------------------------
# `tail <name> [-n N]` (TASK-0204): online it prints the server's ANSI-stripped
# text body as-is. The stub records the query string of every request.
# ---------------------------------------------------------------------------
# Query string of the first recorded tail request for a slug (empty when none).
tail_query() {
  grep "\"method\":\"GET\",\"path\":\"/api/bg-processes/$1/tail\"" "$REQ_LOG" 2> /dev/null | head -n 1 | grep -o '"query":"[^"]*"'
}
tail_gets() {
  local n
  n=$(grep -c '"path":"/api/bg-processes/[^"]*/tail"' "$REQ_LOG" 2> /dev/null)
  echo "${n:-0}"
}
reset_reqs
run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" tail run-proc
expect_rc "tail of a registered process" 0
expect_eq "tail prints the server text body unchanged (restart marker included)" "$OUT" "$RUN_TAIL_EXPECTED"
expect_in "tail requests format=text" "$(tail_query run-proc)" "format=text"
expect_in "tail defaults to lines=50" "$(tail_query run-proc)" "lines=50"

reset_reqs
run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" tail run-proc -n 7
expect_in "tail <name> -n 7 forwards lines=7" "$(tail_query run-proc)" "lines=7"
reset_reqs
run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" tail -n 7 run-proc
expect_in "tail -n 7 <name> forwards lines=7" "$(tail_query run-proc)" "lines=7"

reset_reqs
run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" tail run-proc -n 5000
expect_rc "tail -n above the cap still succeeds" 0
expect_in "tail clamps -n to the server maximum (1000)" "$(tail_query run-proc)" "lines=1000"
expect_in "tail says it capped -n" "$ERR" "capped at 1000"

for bad in abc 0 -3 1.5 ""; do
  reset_reqs
  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" tail run-proc -n "$bad"
  expect_rc "tail -n '$bad' is a usage error" 1
  expect_in "tail -n '$bad' explains the positive-integer rule" "$ERR" "positive integer"
  expect_eq "tail -n '$bad' sends no request" "$(tail_gets)" "0"
done

run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" tail quiet-proc
expect_rc "tail of a process with no output yet exits 0" 0
expect_eq "tail of an empty body prints the no-output line" "$OUT" "(no output yet for quiet-proc)"

run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" tail missing
expect_rc "tail <unknown> -> 404 -> exit 1" 1
expect_in "tail 404 names the slug" "$ERR" "No such background process: missing"
expect_in "tail 404 lists candidate slugs" "$ERR" "run-proc"

if [[ $HAVE_JQ -eq 1 ]]; then
  reset_reqs
  run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" tail dev
  expect_rc "tail <bare name> resolves in the caller's project" 0
  expect_in "tail <bare name> announces the resolution" "$ERR" "Resolved 'dev' to 'alpha-dev'"
  expect_in "tail <bare name> prints alpha-dev's output" "$OUT" "alpha-dev output line 1"
  expect_eq "tail <bare name> never requests beta-dev" "$(tail_query beta-dev)" ""

  run_dc BACKEND_PORT="$PORT" "$BASH_BIN" "$DEV_CMD" tail dev
  expect_rc "tail <ambiguous bare name> keeps exit 2" 2
  expect_in "tail <ambiguous bare name> lists candidates" "$ERR" "beta-dev"
else
  skip "jq is not installed; tail bare-name resolution tests skipped"
fi

run_dc BACKEND_PORT="$PORT" "$BASH_BIN" "$DEV_CMD" tail
expect_rc "tail with no argument" 1
expect_in "tail with no argument prints usage" "$ERR" "Usage: dev-commands.sh tail <slug> [-n N]"

# ---------------------------------------------------------------------------
# Unreachable host-server: stop the stub, then reuse its (now free) port.
# ---------------------------------------------------------------------------
STUB_PID_WAS="$STUB_PID"
stop_stub
if kill -0 "$STUB_PID_WAS" 2> /dev/null; then
  fail "stub server (pid $STUB_PID_WAS) is still running after stop_stub"
else
  pass "stub server stopped (pid $STUB_PID_WAS is gone)"
fi

run_dc BACKEND_PORT="$PORT" CONDUCTOR_AGENT_NAME=agent-alpha "$BASH_BIN" "$DEV_CMD" restart ok-proc
expect_rc "unreachable port -> exit 2" 2
expect_in "unreachable message names the port" "$ERR" "Cannot reach the conductor host-server on port $PORT"
expect_in "unreachable message says there is no offline fallback" "$ERR" "no offline fallback"

# ---------------------------------------------------------------------------
# [DEFERRED-TO-UAT] Live smoke recipe (owned by TASK-0208's UAT). Needs a running
# host-server + tmux conductor session with two projects, and a throwaway bg
# process in the caller's project (e.g. `sleep 600` registered as <name>); never
# run this against a process anyone depends on. <window> is a project A agent's
# tmux window name; <name>/<slug> is the throwaway process:
#   1. CONDUCTOR_AGENT_NAME=<window> dev-commands.sh restart <name>
#        -> exit 0, "Restarted <slug> at <ts>. Use 'dev-commands.sh tail <slug>' ..."
#           and `dev-commands.sh tail <slug>` shows a "--- restart <ts> ---" marker
#   2. run step 1 again immediately (inside the cooldown)
#        -> exit 5, "Restart skipped: ... Retry in <n>s ...", "Do NOT retry in a loop"
#   3. CONDUCTOR_AGENT_NAME=<window> dev-commands.sh restart <slug of a process in project B>
#        -> exit 3, "Refused: <slug> belongs to project B, you are in project A ..."
#   4. wc -l logs/bg-restarts.jsonl (before and after steps 1-3)
#        -> exactly one new line per attempt (success, cooldown skip, refusal),
#           each carrying the caller from X-Conductor-Agent
#
# [DEFERRED-TO-UAT] TASK-0204 live smoke recipe (owned by TASK-0208). Same
# throwaway process (`sleep 600`-style, never one anyone depends on):
#   5. kill the process inside its bg tmux window so the pane falls back to a shell
#      dev-commands.sh status <name>
#        -> "liveness:     exited", "window:       present", and the sentence
#           "The process is not running (window is at a shell prompt); ..."
#   6. dev-commands.sh restart <name>; then dev-commands.sh status <name>
#        -> "liveness:     running" and "last restart: <ts> by <caller>"
#   7. dev-commands.sh tail <name>
#        -> escape-free text (no ESC bytes, no \r redraw artefacts) that includes a
#           "--- restart <ts> ---" marker after the restart
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [[ $FAILURES -eq 0 ]]; then
  echo "[verify-dev-commands-restart] PASS — $CHECKS check(s) passed, $SKIPS skipped"
  exit 0
else
  echo "[verify-dev-commands-restart] FAIL — $FAILURES of $CHECKS check(s) failed, $SKIPS skipped"
  exit 1
fi
