---
id: UAT-0208
aliases: [UAT-0208]
title: "UAT: Agent-driven bg-process restart — list, crash, tail, restart, cooldown, guard, audit, dashboard"
status: pending
task: TASK-0208
created: 2026-10-17
updated: 2026-10-17
---

# UAT-0208 — UAT: Agent-driven bg-process restart — list, crash, tail, restart, cooldown, guard, audit, dashboard

implements::[[TASK-0208]]

> **Source task**: [[TASK-0208]]
> **Generated**: 2026-10-17

This is ROADMAP-0024's closing integration UAT: it walks the full feature end to end — an agent in a project lists only its project's bg processes, sees one crashed, reads its clean output, and restarts it in one safe, audited action; the dashboard shows and does the same. It consolidates the `[DEFERRED-TO-UAT]` recipes from `TASK-0190`..`TASK-0207` into one run. It does **not** repeat the API-level cases already covered by [[UAT-0191-bg-process-real-liveness|UAT-0191]] (real liveness classification) or [[UAT-0192-bg-process-ansi-stripped-output-endpoint|UAT-0192]] (the ANSI-stripped `tail` endpoint) — those are referenced, not re-walked. Cases 10-12 are the end-to-end dashboard flow; the component-level detail for the same UI already has its own UATs at [[UAT-0205-agent-detail-background-tab|UAT-0205]], [[UAT-0206-bg-restart-action-with-confirmation|UAT-0206]] and [[UAT-0207-bg-last-restart-time-and-agent-display|UAT-0207]] (archived, passed) — reference those for the exhaustive per-component matrix.

**Safety (non-negotiable).** Every case below operates on an **isolated private stack**: its own `TMUX_TMPDIR`, its own scratch `conductor.conf`/`DB_PATH`/`STATE_DIR`/`LOG_DIR`, a `SESSION_NAME` that is never `conductor`, and a high port that is never `8788` (host-server) or `4321` (frontend dev server). **Never point any command below at the real `conductor.conf`, the real `conductor` tmux session, or ports 8788/4321.** This mirrors `scripts/lib/verify-dev-commands-live.sh`'s own isolation guards (it refuses to run against the real conf/port/session). Fixture names below (`alpha`, `beta`, `dev`, `weird`) are throwaway and never collide with real project/process names.

---

## Prerequisites

- [ ] `tmux >= 3.0`, `node >= 18`, `jq`, and `curl` are on `PATH`.
- [ ] `host-server/node_modules` is installed (`cd host-server && npm install` if not).
- [ ] Repo path contains no whitespace (the host-server sources the conf path unquoted).
- [ ] **One-shot automated proof.** `bash scripts/verify-dev-commands.sh --live` (from the repo root) stands up exactly the isolated world described below and runs every scenario assertion in cases 2-9 non-interactively, printing one `PASS:`/`FAIL:` line per assertion and exiting 0 only if all pass. It prints `SKIPPED` (exit 0) if `tmux`/`node`/`jq` is missing or the port is busy — not a failure. This was already run and verified during TASK-0208 Step 3 (4 consecutive green runs); do **not** re-run it as part of walking this UAT unless you need to reproduce a failure. Each case below gives the manual/UI equivalent plus the exact `PASS:` line(s) from that run that cover it.
- [ ] **Manual private-stack setup** (for cases walked by hand instead of via `--live`). From the repo root, in one shell session:
  ```bash
  export VERIFY_DIR="$PWD/tmp/uat-0208"; rm -rf "$VERIFY_DIR"; mkdir -p "$VERIFY_DIR/data" "$VERIFY_DIR/logs/state" "$VERIFY_DIR/tmux"
  cat > "$VERIFY_DIR/conductor.conf" <<'EOF'
  SESSION_NAME="uat0208"
  CLAUDE_FLAGS=""
  BG_PROCESSES=()
  CLEAR_CMD="/clear"
  IDLE_PATTERN="\\?[[:space:]]+for[[:space:]]+shortcuts|(accept edits|bypass permissions) on \\(shift\\+tab to cycle\\)"
  BUSY_PATTERN="esc to interrupt"
  AWAITING_PATTERN='(\?\s*$|\?\s+[A-Za-z]+(/[A-Za-z]+)+\s*$|\[Y/n\]|\[y/N\]|^\s*>\s*$|Enter to (select|confirm|submit)|Esc to (cancel|go back)|ctrl.g to edit|shift.tab to approve)'
  POLL_INTERVAL=15
  STALL_TIMEOUT=300
  STATUS_POLL_MS=300
  TERMINAL_POLL_MS=2000
  FOCUSED_TERMINAL_POLL_MS=250
  FOCUSED_TERMINAL_WS_POLL_MS=250
  TERMINAL_TAIL_LINES=100
  FOCUSED_TERMINAL_TAIL_LINES=300
  TERMINAL_LOG_MAX_ROWS_PER_AGENT=500
  METRICS_SNAPSHOT_INTERVAL_MS=60000
  CONTEXT_WINDOW=200000
  USAGE_CHECK_CMD='true'
  DB_PATH="./data/conductor.db"
  LOG_DIR="./logs"
  PENDING_AGENT_STALE_S=3600
  BG_RESTART_COOLDOWN_S=30
  STATE_DIR="./logs/state"
  EOF
  env -u TMUX TMUX_TMPDIR="$VERIFY_DIR/tmux" tmux -f /dev/null new-session -d -s uat0208 -n keeper -c "$VERIFY_DIR" 'sleep 86400'
  ( cd host-server && env -u TMUX -u TMUX_PANE -u CONDUCTOR_DB -u PORT CONDUCTOR_CONF="$VERIFY_DIR/conductor.conf" BACKEND_PORT=18789 HOST=127.0.0.1 TMUX_TMPDIR="$VERIFY_DIR/tmux" TMUX_SYNC_TIMEOUT_MS=2000 node --import tsx/esm index.ts > "$VERIFY_DIR/server.log" 2>&1 & disown )
  sleep 2; curl -sS 'http://127.0.0.1:18789/api/status' | jq -c '{session, sessionAlive}'
  ```
  Expect `{"session":"uat0208","sessionAlive":true}`. Keep this shell session open for the rest of the walkthrough (`$VERIFY_DIR` and the exported env persist).
- [ ] Install the `dev-commands` skill into a scratch location (never the user's real `~/.claude/skills`):
  ```bash
  bash install-hooks.sh --skills-dir "$VERIFY_DIR/skills/dev-commands" --install-dir "$VERIFY_DIR/hooks" --settings-file "$VERIFY_DIR/settings.json" --codex-install-dir "$VERIFY_DIR/codex-hooks" --codex-hooks-file "$VERIFY_DIR/codex-hooks.json"
  ```
  Expect stdout to include `Dev-commands skill installed to <...>/tmp/uat-0208/skills/dev-commands`. Use `$VERIFY_DIR/skills/dev-commands/scripts/dev-commands.sh` as `DEV_CMD` below (the repo's own copy, `skills/dev-commands/scripts/dev-commands.sh`, is equally valid and is what the commands below reference for brevity).
- [ ] Seed two projects, one agent and one `dev` bg process each, through the real API (the dashboard-forms equivalent is UAT-UI-001's own Prerequisite, for whoever walks the UI cases instead):
  ```bash
  DEV_CMD="$PWD/skills/dev-commands/scripts/dev-commands.sh"
  mkdir -p "$VERIFY_DIR/work/alpha" "$VERIFY_DIR/work/beta"
  ALPHA_ID=$(curl -sS -X POST 'http://127.0.0.1:18789/api/projects' -H 'Content-Type: application/json' -d "{\"name\":\"alpha\",\"workdir\":\"$VERIFY_DIR/work/alpha\"}" | jq -r '.id')
  BETA_ID=$(curl -sS -X POST 'http://127.0.0.1:18789/api/projects' -H 'Content-Type: application/json' -d "{\"name\":\"beta\",\"workdir\":\"$VERIFY_DIR/work/beta\"}" | jq -r '.id')
  curl -sS -X POST "http://127.0.0.1:18789/api/projects/$ALPHA_ID/agents" -H 'Content-Type: application/json' -d '{"name":"agent","launchCmd":"sleep 3600"}' | jq -c '{name, projectName}'
  curl -sS -X POST "http://127.0.0.1:18789/api/projects/$BETA_ID/agents" -H 'Content-Type: application/json' -d '{"name":"agent","launchCmd":"sleep 3600"}' | jq -c '{name, projectName}'
  curl -sS -X POST 'http://127.0.0.1:18789/api/bg-processes' -H 'Content-Type: application/json' -d "{\"name\":\"dev\",\"workdir\":\"$VERIFY_DIR/work/alpha\",\"launchCmd\":\"while true; do echo tick; sleep 2; done\",\"projectId\":$ALPHA_ID}" | jq -c '.bg.slug'
  curl -sS -X POST 'http://127.0.0.1:18789/api/bg-processes' -H 'Content-Type: application/json' -d "{\"name\":\"dev\",\"workdir\":\"$VERIFY_DIR/work/beta\",\"launchCmd\":\"while true; do echo tick; sleep 2; done\",\"projectId\":$BETA_ID}" | jq -c '.bg.slug'
  ```
  Expect both agent creations to return `{"name":"agent","projectName":"alpha"}` / `{"name":"agent","projectName":"beta"}` (window names `alpha-agent`/`beta-agent`), and both bg-process creations to return `"alpha-dev"` / `"beta-dev"`.
- [ ] Teardown is UAT-CLEANUP-001 (case 13) — run it even if earlier cases fail.

---

## Test Cases

### UAT-SETUP-001: Isolated world comes up and seeds alpha/beta cleanly (prerequisites for every other case)
- **Description**: Confirms the Prerequisites section actually produced a working private stack before relying on it for cases 2-12. Covers every roadmap sub-task's shared setup contract (project/agent/bg-process creation API, `dev-commands` skill install).
- **Steps**:
  1. Complete every Prerequisites step above.
  2. Run the command below.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:18789/api/status' | jq -c '[.bgProcesses[]? | {slug, projectName, liveness}]'
  ```
- **Expected Result**: `[{"slug":"alpha-dev","projectName":"alpha","liveness":"running"},{"slug":"beta-dev","projectName":"beta","liveness":"running"}]` (order may vary). `tmux -S` on the private socket (`env -u TMUX TMUX_TMPDIR="$VERIFY_DIR/tmux" tmux list-windows -t uat0208 -F '#W'`) lists `keeper`, `alpha-agent`, `beta-agent`, `alpha-dev`, `beta-dev`.
- **Repeatable Unit Test**: Not applicable: live seeding through the real API/tmux; no pure-logic unit to extract.
- **Verify script**: `bash scripts/verify-dev-commands.sh --live` — `PASS: live: private host-server + tmux world is up (port 18789, session verifydevcmds0208)` and `PASS: live: seeded projects alpha/beta, agents alpha-agent/beta-agent, bg processes alpha-dev/beta-dev` (`scripts/lib/verify-dev-commands-live.sh`).
- [x] Pass <!-- 2026-10-17 -->

### UAT-API-001: Project-scoped `list` shows only the caller's project; `--all` shows both (TASK-0202)
- **Description**: `dev-commands.sh list` run as alpha's agent (`CONDUCTOR_AGENT_NAME=alpha-agent`) resolves the caller via `GET /api/agents/whoami` and filters `GET /api/status`'s `bgProcesses` to `projectId` matching alpha; `list --all` drops the filter and shows both projects, each line annotated `project: <name>`.
- **Steps**:
  1. Run the first command below (project-scoped).
  2. Run the second command below (`--all`).
  3. Run the third command below with an unresolvable `CONDUCTOR_AGENT_NAME` and confirm the fallback note on stderr.
- **Command**:
  ```bash
  CONDUCTOR_AGENT_NAME=alpha-agent CONDUCTOR_STATE_DIR="$VERIFY_DIR/logs/state" CONDUCTOR_LOG_DIR="$VERIFY_DIR/logs" BACKEND_PORT=18789 bash "$DEV_CMD" list
  ```
  ```bash
  CONDUCTOR_AGENT_NAME=alpha-agent CONDUCTOR_STATE_DIR="$VERIFY_DIR/logs/state" CONDUCTOR_LOG_DIR="$VERIFY_DIR/logs" BACKEND_PORT=18789 bash "$DEV_CMD" list --all
  ```
  ```bash
  CONDUCTOR_AGENT_NAME=totally-unknown-caller-xyz CONDUCTOR_STATE_DIR="$VERIFY_DIR/logs/state" CONDUCTOR_LOG_DIR="$VERIFY_DIR/logs" BACKEND_PORT=18789 bash "$DEV_CMD" list
  ```
- **Expected Result**: Step 1 prints `Background processes for project alpha (use --all for every project):` followed by one line for `alpha-dev` only (no `beta-dev`). Step 2 prints `Background processes (all projects):` followed by lines for both `alpha-dev` and `beta-dev`, each ending `project: alpha`/`project: beta`. Step 3 prints to stderr `Note: could not resolve your project (...); showing all projects.` and still lists both processes on stdout (never fewer).
- **Repeatable Unit Test**: Not applicable: exercises the live `GET /api/agents/whoami` + `GET /api/status` round trip through the real shell client; `cmd_list`'s pure jq filter has no test harness in this repo.
- **Verify script**: `bash scripts/verify-dev-commands.sh --live` — `PASS: live: list (CONDUCTOR_AGENT_NAME=alpha-agent) shows only alpha's dev process` and `PASS: live: list --all shows both alpha's and beta's dev processes`; the unresolvable-caller fallback is also covered offline by `scripts/verify-dev-commands.sh` tests 15-19 (`list (no CONDUCTOR_AGENT_NAME, offline) -> 'cannot filter by project offline' note + still lists`).
- [x] Pass <!-- 2026-10-17 -->

### UAT-API-002: A crashed process reports `exited`, not `running` (TASK-0191/TASK-0204)
- **Description**: Killing the foreground process in alpha's `dev` window leaves the window open at a shell prompt. `bgLiveness` (`host-server/state.ts`) must classify that as `exited` (never a stale `running`), and `dev-commands.sh status` must surface it the same way.
- **Steps**:
  1. Send `Ctrl-C` to alpha's `dev` window on the private socket.
  2. Within a few seconds, run the command below.
- **Command**:
  ```bash
  env -u TMUX TMUX_TMPDIR="$VERIFY_DIR/tmux" tmux send-keys -t uat0208:=alpha-dev C-c
  sleep 3
  CONDUCTOR_AGENT_NAME=alpha-agent CONDUCTOR_STATE_DIR="$VERIFY_DIR/logs/state" CONDUCTOR_LOG_DIR="$VERIFY_DIR/logs" BACKEND_PORT=18789 bash "$DEV_CMD" status dev
  ```
- **Expected Result**: Output includes `  liveness:     exited` and the sentence `The process is not running (window is at a shell prompt); check 'tail', then 'restart' if appropriate.` (from `print_bg_status_online` in `skills/dev-commands/scripts/dev-commands.sh`). The dashboard's Background-tab badge for `alpha-dev` (case UAT-UI-001) must agree.
- **Repeatable Unit Test**: Not applicable: needs a live tmux pane transition; the pure classification rule it exercises (`bgLiveness`: window present, pane at a plain shell, launch command not a shell -> `exited`) is already unit-tested in `host-server/state.test.ts` (`describe('bgLiveness (TASK-0191)')`, pinned by [[UAT-0191-bg-process-real-liveness|UAT-0191]] UAT-EDGE-001).
- **Verify script**: `bash scripts/verify-dev-commands.sh --live` — `PASS: live: killing alpha's dev process makes status report liveness: exited`.
- [x] Pass <!-- 2026-10-17 -->

### UAT-API-003: `tail` returns escape-free text after the crash (TASK-0192/TASK-0204)
- **Description**: `dev-commands.sh tail` routes through `GET /api/bg-processes/:slug/tail`, whose cleaner (`host-server/bgOutput.ts`) strips ANSI/CSI/OSC escapes and collapses `\r` redraws; this case only re-confirms it through the shell client's own output on a real (if private) log, since [[UAT-0192-bg-process-ansi-stripped-output-endpoint|UAT-0192]] already proves the endpoint's byte-level contract.
- **Steps**:
  1. Run the command below as alpha's agent.
  2. Visually confirm no stray escape bytes; the byte-level guarantee is UAT-0192's job, not this case's.
- **Command**:
  ```bash
  CONDUCTOR_AGENT_NAME=alpha-agent CONDUCTOR_STATE_DIR="$VERIFY_DIR/logs/state" CONDUCTOR_LOG_DIR="$VERIFY_DIR/logs" BACKEND_PORT=18789 bash "$DEV_CMD" tail dev
  ```
- **Expected Result**: Exit 0; stdout contains `tick` lines with no literal `ESC` (`\x1b`) byte and no `\r`.
- **Repeatable Unit Test**: Not applicable: this case is the shell-client-through-the-live-route round trip; the cleaner's byte-level behavior is exhaustively unit-tested in `host-server/bgOutput.test.ts` and already walked by [[UAT-0192-bg-process-ansi-stripped-output-endpoint|UAT-0192]] (UAT-API-001, UAT-EDGE-001/002/003).
- **Verify script**: `bash scripts/verify-dev-commands.sh --live` — `PASS: live: tail dev (as alpha) returns escape-free text`.
- [x] Pass <!-- 2026-10-17 -->

### UAT-API-004: Agent-driven restart succeeds, marks the log, and comes back `running` (TASK-0190/TASK-0203)
- **Description**: `POST /api/bg-processes/:slug/restart` with `X-Conductor-Agent: alpha-agent` performs the restart (same-project, no cooldown hit), appends a `--- restart <ts> ---` marker to `logs/bg-alpha-dev.log`, and the process resumes producing `tick` output; `dev-commands.sh restart` surfaces it as exit 0.
- **Steps**:
  1. Run the restart command below.
  2. Inspect the log for the marker and new output after it.
  3. Re-check `status` for `liveness: running`.
- **Command**:
  ```bash
  CONDUCTOR_AGENT_NAME=alpha-agent CONDUCTOR_STATE_DIR="$VERIFY_DIR/logs/state" CONDUCTOR_LOG_DIR="$VERIFY_DIR/logs" BACKEND_PORT=18789 bash "$DEV_CMD" restart dev
  ```
- **Expected Result**: Exit 0; stdout `Restarted alpha-dev at <iso-timestamp>. Use 'dev-commands.sh tail alpha-dev' to watch it come back up.` `$VERIFY_DIR/logs/bg-alpha-dev.log` contains exactly one `--- restart ... ---` line, followed later by at least one new `tick` line. A follow-up `status dev` shows `liveness:     running`. The output continues in the **same** `bg-alpha-dev.log` file (no new log file created).
- **Repeatable Unit Test**: Not applicable: exercises the live tmux `respawn-window`/marker-append mechanism end to end; the restart mechanism's unit-level behavior (response mapping, header forwarding, marker format) is covered by `host-server/bgRestart.test.ts` and `scripts/verify-dev-commands-restart.sh` (folded into the default/hermetic run of `scripts/verify-dev-commands.sh`).
- **Verify script**: `bash scripts/verify-dev-commands.sh --live` — `PASS: live: restart dev (as alpha) exits 0`, `PASS: live: alpha-dev's log gained exactly one restart marker`, `PASS: live: new output ('tick') follows the restart marker in alpha-dev's log`, `PASS: live: status for alpha-dev reports liveness: running after the restart`.
- [x] Pass <!-- 2026-10-17 -->

### UAT-API-005: Immediate second restart is cooldown-skipped, exit 5, no second marker (TASK-0193)
- **Description**: `BG_RESTART_COOLDOWN_S` (30s in the private conf) blocks a second restart of the same slug within the window; the host-server responds `429`, and `dev-commands.sh` maps that to exit 5 with a retry hint, never a second marker.
- **Steps**:
  1. Immediately after UAT-API-004's restart (within 30s), run the same restart command again.
- **Command**:
  ```bash
  CONDUCTOR_AGENT_NAME=alpha-agent CONDUCTOR_STATE_DIR="$VERIFY_DIR/logs/state" CONDUCTOR_LOG_DIR="$VERIFY_DIR/logs" BACKEND_PORT=18789 bash "$DEV_CMD" restart dev
  ```
- **Expected Result**: Exit 5. Stderr matches `Restart skipped: alpha-dev was restarted <N>s ago by alpha-agent. Retry in <retry_s>s (or check its output with 'tail' first).` followed by `Do NOT retry in a loop: the cooldown exists to stop restart loops. Check 'dev-commands.sh tail alpha-dev' and wait.` (exact strings from `cmd_restart`'s `429` branch in `skills/dev-commands/scripts/dev-commands.sh`). `$VERIFY_DIR/logs/bg-alpha-dev.log` still has exactly one restart marker (unchanged from UAT-API-004).
- **Repeatable Unit Test**: Not applicable: exercises the live cooldown timer against wall-clock time; the cooldown decision logic itself (elapsed-time-vs-`BG_RESTART_COOLDOWN_S` comparison, `retryAfterS` computation) is unit-tested in `host-server/bgRestartPolicy.test.ts`.
- **Verify script**: `bash scripts/verify-dev-commands.sh --live` — `PASS: live: an immediate second restart dev (as alpha) exits 5 (cooldown)` and `PASS: live: the cooldown-skipped restart added no second marker to alpha-dev's log`.
- [x] Pass <!-- 2026-10-17 -->

### UAT-API-006: Cross-project restart by slug is denied; unknown caller header gets 403 (TASK-0194)
- **Description**: `bgAccess.ts`'s same-project guard rejects alpha's agent restarting `beta-dev` (exit 3, target untouched) and rejects any request whose `X-Conductor-Agent` value does not resolve to a known agent (HTTP 403, no marker added).
- **Steps**:
  1. As alpha's agent, attempt to restart `beta-dev` by its slug.
  2. Send a raw restart request with an unknown `X-Conductor-Agent` value.
- **Command**:
  ```bash
  CONDUCTOR_AGENT_NAME=alpha-agent CONDUCTOR_STATE_DIR="$VERIFY_DIR/logs/state" CONDUCTOR_LOG_DIR="$VERIFY_DIR/logs" BACKEND_PORT=18789 bash "$DEV_CMD" restart beta-dev
  ```
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' -X POST 'http://127.0.0.1:18789/api/bg-processes/alpha-dev/restart' -H 'X-Conductor-Agent: totally-unknown-caller-xyz'
  ```
- **Expected Result**: Step 1 exits 3 with stderr `Refused: beta-dev belongs to project <beta's id>, you are in project <alpha's id> (...). ... Do not retry; only processes in your own project can be restarted.`; `$VERIFY_DIR/logs/bg-beta-dev.log` gains no restart marker. Step 2 prints `403`; `$VERIFY_DIR/logs/bg-alpha-dev.log`'s marker count is unchanged.
- **Repeatable Unit Test**: Not applicable: exercises the live same-project HTTP guard; the guard's decision logic (project-id comparison, unknown/ambiguous/unscoped caller classification) is unit-tested in `host-server/bgAccess.test.ts`.
- **Verify script**: `bash scripts/verify-dev-commands.sh --live` — `PASS: live: alpha restarting beta-dev by slug exits 3 (refused)`, `PASS: live: beta-dev's log is untouched after the denied cross-project restart`, `PASS: live: an unknown X-Conductor-Agent header gets 403 on restart`, `PASS: live: the unknown-caller 403 added no marker to alpha-dev's log`.
- [x] Pass <!-- 2026-10-17 -->

### UAT-EDGE-001: `bg-restarts.jsonl` has one well-formed audit line per attempt, with the right `outcome`/`callerKind`/`caller` (TASK-0193)
- **Description**: Every restart attempt past the 404 check in `POST /api/bg-processes/:slug/restart` is audited to `logs/bg-restarts.jsonl`, one JSON line per attempt, regardless of outcome.
- **Steps**:
  1. After running UAT-API-004 through UAT-API-006 (and the header-less restart in UAT-UI-002/the dashboard case), read the audit log.
- **Command**:
  ```bash
  jq -c 'select(.bg=="alpha-dev" or .bg=="beta-dev")' "$VERIFY_DIR/logs/bg-restarts.jsonl"
  ```
- **Expected Result**: One well-formed JSON object per line, each with `ts`, `bg`, `callerKind`, `caller`, `outcome`. For `alpha-dev`: one `outcome:"restarted", callerKind:"agent", caller:"alpha-agent"` line (UAT-API-004), one `outcome:"cooldown"` line (UAT-API-005), one `outcome:"denied", reason:"unknown-caller"`-shaped entry is NOT expected here (the 403 in UAT-API-006 step 2 is logged under `denied`/`unknown-caller` too — confirm it is present). For `beta-dev`: one `outcome:"denied", reason:"project-mismatch"` line (UAT-API-006 step 1). No line is missing a field, and `jq` parses every line without error (malformed JSON would abort the whole pipe).
- **Repeatable Unit Test**: Not applicable: asserts the content of a live file the host-server appends to on a live HTTP round trip; the audit-record shape and write path are unit-tested in `host-server/bgRestart.test.ts` and `host-server/bgAccess.test.ts`.
- **Verify script**: `bash scripts/verify-dev-commands.sh --live` — `PASS: live: bg-restarts.jsonl gained one outcome:restarted line for alpha-dev naming alpha-agent`, `PASS: live: bg-restarts.jsonl gained one outcome:cooldown line for alpha-dev`, `PASS: live: bg-restarts.jsonl gained one outcome:denied/project-mismatch line for beta-dev`, `PASS: live: bg-restarts.jsonl's newest alpha-dev restarted line is callerKind:dashboard` (the header-less case, see UAT-UI-002).
- [x] Pass <!-- 2026-10-17 -->

### UAT-EDGE-002: A launch command with a double quote, `$HOME` and a backtick restarts and runs literally (TASK-0190)
- **Description**: The quoting fix from TASK-0190 types the launch command into the pane's own shell literally (via `send-keys -l`), never through an intermediate shell layer that would re-interpret `"`, `$HOME` or backticks.
- **Steps**:
  1. Register a bg process in alpha whose `launchCmd` contains all three risky characters.
  2. Confirm its output is the literal, unexpanded-by-an-intermediate-shell string.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:18789/api/bg-processes' -H 'Content-Type: application/json' -d "{\"name\":\"weird\",\"workdir\":\"$VERIFY_DIR/work/alpha\",\"launchCmd\":\"printf \\\"Q=%s H=%s T=%s\\\\n\\\" \\\"a\\\\\\\"b\\\" \\\"\\$HOME\\\" \\\"\\`echo tick-ok\\`\\\"; sleep 3600\",\"projectId\":$ALPHA_ID}" | jq -c '.bg.slug'
  sleep 2
  grep -F 'T=tick-ok' "$VERIFY_DIR/logs/bg-alpha-weird.log"
  ```
- **Expected Result**: `.bg.slug` is `"alpha-weird"`. `$VERIFY_DIR/logs/bg-alpha-weird.log` contains the literal line `Q=a"b H=<the real $HOME value> T=tick-ok` — the `$HOME` is expanded by the pane's own shell (correct — it is typed as a command into a real shell), the double quote and backtick survive and run exactly once, not twice (which would indicate the string was re-parsed through an extra shell layer).
- **Repeatable Unit Test**: Not applicable: proves the real `send-keys -l` typing behavior against a live tmux pane; there is no pure function to unit-test (the fix is in how the string is passed to `tmux send-keys`, not a parseable transform).
- **Verify script**: `bash scripts/verify-dev-commands.sh --live` — `PASS: live: a launchCmd containing a double quote, $HOME and a backtick ran literally in the pane`.
- [x] Pass <!-- 2026-10-17 -->

### UAT-UI-001: The agent detail Background tab shows only the selected agent's project processes, with live badges (TASK-0205)
- **Description**: Selecting an agent with a project opens a `Background (N)` tab counting that project's bg processes; selecting its row shows a clean, polling tail; an agent with no project has no such tab; the tab's output polling only starts once the tab is active.
- **Steps**:
  1. Start a private frontend dev server pointed at the private host-server (never port 4321/8788): `cd frontend && PROXY_TARGET=http://127.0.0.1:18789 PORT=4322 npx vite --port 4322` (or set `VITE_API_URL=http://127.0.0.1:18789` if not proxying).
  2. Open the private frontend in a browser (or via `mcp__playwright__browser_navigate`) and select `alpha-agent`.
  3. Open its detail pane's `Background` tab.
  4. Switch to a different tab, then back, and watch the network panel for `tail` polling requests.
- **Expected Result**: The detail pane's tablist shows a tab labeled `Background (1)` for `alpha-agent` (only `alpha-dev`/`alpha-weird`, never `beta-dev`); clicking it reveals a region labeled `Background processes` listing alpha's bg process(es) with a liveness badge (`running`/`exited`/`stopped`); no `tail` network request fires before the tab is clicked, and polling requests appear only while the tab is active. `lone-agent`-style agents (no project) show no `Background` tab at all, and the tablist still switches normally without it.
- **Expected Result (gap)**: Whether polling **stops** after switching away from the Background tab (not just that it withholds starting) is not covered by any existing automated test — confirm by eye in the network panel that no further `tail` requests fire once another tab is active. See Gaps in the completion report.
- **Repeatable Unit Test**: Not applicable: this is the full-stack/browser flow. The equivalent behavior is already unit-tested with RTL in `frontend/src/components/AgentList.test.tsx` (`describe('AgentList Background tab (TASK-0205)')`: `'shows a "Background (N)" tab counting the agent's project bg processes'`, `'does not poll the output until the Background tab is the active one'`, `'omits the Background tab for an agent with no project, and the tablist still works'`) and `frontend/src/components/BackgroundProcessesTab.test.tsx` (`describe('BackgroundProcessesTab (TASK-0205)')`), already walked by [[UAT-0205-agent-detail-background-tab|UAT-0205]].
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx src/components/BackgroundProcessesTab.test.tsx`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-10-17 -->

### UAT-UI-002: Restart on the tab row and on the tile both confirm, Cancel sends nothing, and a header-less dashboard restart works inside the agent's cooldown (TASK-0206)
- **Description**: Every `Restart`/`Start` affordance in the dashboard opens a confirmation dialog before sending anything; `Confirm` POSTs to `/bg-processes/:slug/restart` with **no** `X-Conductor-Agent` header (dashboard caller); that header-less restart must still succeed even while UAT-API-005's agent-initiated cooldown is active, and is audited `callerKind: dashboard`.
- **Steps**:
  1. On the private frontend from UAT-UI-001, open `alpha-agent`'s Background tab and click `Restart` on the `alpha-dev` row; confirm a dialog appears and no network request fired yet.
  2. Click `Cancel`; confirm the dialog closes and still no request fired.
  3. Click `Restart` again, then `Confirm`, while still inside the 30s cooldown from UAT-API-005.
  4. Repeat on the bg-process tile (outside the detail pane) for the same process.
- **Expected Result**: Step 1: a dialog reading `Restart "dev" (project alpha)?` with warning copy about stopping the running process and interrupting project alpha; no `fetch`/network call yet. Step 2: dialog closes, no request. Step 3: the request is `POST .../bg-processes/alpha-dev/restart` with no `X-Conductor-Agent` header; it succeeds (HTTP 200) even though an agent-initiated restart would have been cooldown-blocked (dashboard callers are cooldown-exempt per `host-server/bgRestartPolicy.ts`); the row's liveness badge optimistically flips to `running`, and `logs/bg-alpha-dev.log` gains a second restart marker. Step 4: the tile's own Restart control behaves identically.
- **Repeatable Unit Test**: Not applicable: this is the full-stack/browser confirm-then-POST flow. The equivalent is already unit-tested with RTL in `frontend/src/components/BgRestartButton.test.tsx` (`describe('BgRestartButton (TASK-0206)')`: `'opens the confirmation on click and sends nothing'`, `"'Cancel' closes the dialog without a request"`, `"'Confirm' POSTs the encoded slug to /restart with no X-Conductor-Agent header"`) and `frontend/src/components/BackgroundProcessesTab.test.tsx` (`describe('BackgroundProcessesTab restart action (TASK-0206)')`), already walked by [[UAT-0206-bg-restart-action-with-confirmation|UAT-0206]]. The cooldown-exemption-for-dashboard-callers decision itself is unit-tested in `host-server/bgRestartPolicy.test.ts`.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BgRestartButton.test.tsx src/components/BackgroundProcessesTab.test.tsx`
- **Verify script**: `bash scripts/verify-dev-commands.sh --live` — `PASS: live: a header-less (dashboard) restart of alpha-dev succeeds inside the agent cooldown`, `PASS: live: the dashboard restart added its own (second) marker to alpha-dev's log`, `PASS: live: bg-restarts.jsonl's newest alpha-dev restarted line is callerKind:dashboard` (proves the same HTTP contract the dashboard's `fetch` call relies on).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-10-17 -->

### UAT-UI-003: The last-restart line names the agent after an agent restart, "from the dashboard" after a dashboard restart, and survives a reload (TASK-0207)
- **Description**: Each Background-tab row and tile shows a `Restarted <relative time> by <caller>` (agent caller) or `Restarted <relative time> from the dashboard` (null caller) line, sourced from `GET /api/status`'s `lastRestart: {at, caller}` and updated live via the `bg-update` SSE without a page reload; it also survives an actual page reload.
- **Steps**:
  1. Immediately after UAT-API-004 (agent restart), without reloading, read `alpha-dev`'s row in the Background tab.
  2. Immediately after UAT-UI-002 (dashboard restart), without reloading, re-read the same row.
  3. Reload the page and re-read the row a third time.
- **Expected Result**: Step 1: the row's last-restart line reads `Restarted <N>m ago by alpha-agent` (agent window name, no reload needed — driven by the same `bg-update` SSE/optimistic state the restart response updates). Step 2: the line now reads `Restarted just now from the dashboard` (or `<N>m ago from the dashboard`), again with no reload. Step 3: after a full page reload, the line still reads the dashboard-attributed text (now sourced fresh from `GET /api/status`'s `lastRestart`), proving it is server-persisted, not purely client-side optimistic state.
- **Repeatable Unit Test**: Not applicable: this is the full-stack/browser live-update + reload-persistence flow. The equivalent is already unit-tested with RTL in `frontend/src/components/BgLastRestart.test.tsx` (`describe('BgLastRestart (TASK-0207)')`: agent-caller rendering, `"from the dashboard"` for a null caller, `"No restarts recorded"` for absent `lastRestart`, relative-time aging) and `frontend/src/components/BackgroundProcessesTab.test.tsx` (`describe('BackgroundProcessesTab last restart line (TASK-0207)')`), plus `frontend/src/components/AgentList.test.tsx`'s TASK-0207 cases (`'the tile shows the last restart line (agent caller) ...'`, `'a bg-update SSE carrying a new lastRestart updates the tab row text'`, `'a successful dashboard restart optimistically sets the row line to "from the dashboard"'`), already walked by [[UAT-0207-bg-last-restart-time-and-agent-display|UAT-0207]] (archived, passed).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BgLastRestart.test.tsx src/components/BackgroundProcessesTab.test.tsx src/components/AgentList.test.tsx`
- **Verify script**: `bash scripts/verify-dev-commands.sh --live` — `PASS: live: GET /api/status reports alpha-dev's lastRestart.caller as alpha-agent` (proves the server-persisted field the reload in step 3 depends on).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-10-17 -->

### UAT-CLEANUP-001: Teardown leaves no fixture state anywhere, and the real conductor/tmux/ports are untouched
- **Description**: The private stack (host-server process, private tmux server/session, scratch conf/DB/logs, scratch skill install, private frontend dev server) is fully removable and never touched the operator's real `conductor` session, port 8788/4321, or real `~/.claude/skills`.
- **Steps**:
  1. Stop the private frontend dev server (Ctrl-C on its process).
  2. Stop the private host-server and kill the private tmux server.
  3. Remove the scratch directory.
  4. Confirm the real tmux server is unaffected.
- **Command**:
  ```bash
  pkill -f "node --import tsx/esm index.ts.*$VERIFY_DIR" 2>/dev/null || true
  env -u TMUX TMUX_TMPDIR="$VERIFY_DIR/tmux" tmux kill-server 2>/dev/null || true
  rm -rf "$VERIFY_DIR"
  tmux list-windows -t conductor -F '#W' 2>/dev/null | grep -E '^(alpha|beta)-' ; echo "exit=$?"
  ```
- **Expected Result**: `$VERIFY_DIR` (`./tmp/uat-0208/`) no longer exists. The real `conductor` tmux session's window list contains no `alpha-*`/`beta-*`/`weird`-named window (the `grep` finds nothing; `exit=1`). `curl -sf http://127.0.0.1:8788/api/status` (the real host-server, if running) is unaffected throughout — it was never addressed by any command in this UAT.
- **Repeatable Unit Test**: Not applicable: teardown of live tmux/process/filesystem state.
- **Verify script**: `bash scripts/verify-dev-commands.sh --live` — its own `trap`-driven `lv_cleanup` performs the equivalent teardown automatically after every run (verified during TASK-0208 Step 3: `./tmp/verify-dev-commands/live/` fully removed, and before/after `tmux list-sessions`/`list-windows -a` plus `pgrep -fl index.ts` on the real server were byte-identical across 4 consecutive runs), plus `PASS: live: no alpha/beta/weird fixture window exists on the operator's real (default-socket) tmux server`.
- [x] Pass <!-- 2026-10-17 -->

---

## Gaps

- **UAT-UI-001**: No existing automated test proves that `tail` polling *stops* once the Background tab is switched away from (only that it does not start before the tab is active, per `AgentList.test.tsx`'s `'does not poll the output until the Background tab is the active one'`). This needs a manual/Playwright network-panel observation; it is called out inline in the case above rather than silently assumed.
- **UAT-EDGE-001**: The audit log's `unknown-caller` denial line (from UAT-API-006 step 2's 403) is asserted to exist by inspection (`jq` dump) rather than by a dedicated scripted count, since the live scenario script itself only explicitly counts the `restarted`/`cooldown`/`project-mismatch` lines; a human walking this case should confirm it by eye in the dump.
- All 13 cases above were generated from the task's required list; none were dropped. No new unit test files were created for this UAT — per the task's explicit instruction, the deterministic halves are already covered by `scripts/verify-dev-commands.sh --live` (TASK-0208 Step 3, already run and verified: 25 scenario `PASS` lines, 4 consecutive green runs) and by the pre-existing unit suites cited per case (`host-server/bgRestart.test.ts`, `bgRestartPolicy.test.ts`, `bgAccess.test.ts`, `state.test.ts`, `bgOutput.test.ts`, and the frontend component tests for TASK-0205/0206/0207).
