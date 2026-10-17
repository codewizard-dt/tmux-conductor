---
id: UAT-0191
aliases: [UAT-0191]
title: "UAT: Report real running/exited liveness for bg processes instead of window-exists-only"
status: pending
task: TASK-0191
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0191 — UAT: Report real running/exited liveness for bg processes instead of window-exists-only

implements::[[TASK-0191]]

> **Source task**: [[TASK-0191]]
> **Generated**: 2026-09-20

---

## Prerequisites

- [ ] Unit-test cases run from `host-server/` (`node --import tsx/esm --test state.test.ts`); no live server or tmux needed. tmux >= 3.0 is needed for the INT cases (generation-time: tmux 3.7c).
- [ ] API cases need the host-server on `http://localhost:8788` (routes live under `/api`, e.g. `/api/status`, `/api/events`) running the TASK-0191 code (`make dev` hot-reloads via `tsx watch`). At generation time it was up and already returning `liveness`.
- [ ] UAT-INT-003, UAT-INT-005 and the state-file checks need the conductor session (`conductor`) with the `monitor` window running the **new** `scripts/monitor.sh`. Restart the monitor window if it was started before TASK-0191 landed (generation-time `logs/state/bg-dev.state` already read `running`, i.e. new vocabulary).
- [ ] **Private tmux for INT-001/002.** Those cases run their own tmux server on an explicit socket under `./tmp/uat-0191/` and never touch the live `conductor` session. Every tmux command there passes `-S "$SOCK"` and `env -u TMUX` (inside tmux, `$TMUX` overrides `TMUX_TMPDIR`, so without `env -u TMUX` the host-server helper would silently query the real server). Never run a bare `tmux kill-server` in these cases.
- [ ] **UAT-INT-005 is opt-in.** It creates one throwaway `bg_processes` row and tmux window (`uat0191-probe`) in the live conductor session and always deletes them. Skip it where that is not acceptable; INT-001/002/003 and API-001 still prove the classifier.
- [ ] Known scope limit (not a failure): the dashboard bg tile still derives its label from `windowPresent` (`AgentList.tsx` shows `running` / `window missing`). Using `liveness` in the UI is Phase 4 of ROADMAP-0024; this task only adds the optional `liveness?` type field on `BgProcess`. Also out of scope here: the `skills/dev-commands/SKILL.md` wording (Phase 3).

---

## Test Cases

### UAT-API-001: `GET /api/status` reports `liveness` on every bg process and keeps `windowPresent` and `state`
- **Endpoint**: `GET /api/status`
- **Description**: `buildBgStatuses` (`host-server/index.ts`) derives `BgStatus.liveness` from the shared `list-windows` inventory (`bgLiveness`), or from `bgLivenessForWindow` when no inventory is passed. `windowPresent` and the raw `state` string must remain on the payload. A registered bg process with a live window running a non-shell command reads `running`; one with no window reads `stopped`.
- **Steps**:
  1. Run the curl command below as-is.
  2. Cross-check each row against tmux: `tmux list-windows -t conductor -F '#{window_name} #{pane_current_command}'`.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq -c '[.bgProcesses[] | {name, windowPresent, liveness, state}]'
  ```
- **Expected Result**: HTTP 200 with a JSON array (one object per registered bg process). Every object has `liveness` in `{"running","exited","stopped"}` (never missing, never `alive`/`dead`), plus boolean `windowPresent` and string-or-null `state`. `windowPresent:false` rows have `liveness:"stopped"`; `windowPresent:true` rows whose tmux pane command is not a plain shell have `liveness:"running"`; rows whose pane is at a plain shell (`zsh`/`bash`/…) for longer than 3 s have `liveness:"exited"`. Generation-time sample: `[{"name":"dev","windowPresent":true,"liveness":"running","state":"running"},{"name":"dev-stack","windowPresent":false,"liveness":"stopped","state":"dead"}]`.
- **Repeatable Unit Test**: Not applicable: `buildBgStatuses` is a non-exported function inside `host-server/index.ts` that reads the live SQLite DB and tmux; the pure classification it delegates to is covered by UAT-EDGE-001/002/003.
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-API-002: `GET /api/events` replays a `bg-update` per bg process, each carrying `liveness`
- **Endpoint**: `GET /api/events` (SSE)
- **Description**: A late-connecting SSE client is sent the current `prevSnapshot.bgProcesses` as `bg-update` events (`host-server/index.ts` `/events` handler). Because they are the full `BgStatus` objects, `liveness` must be in each payload.
- **Steps**:
  1. Run the curl command below as-is (it reads the stream for 3 s then exits).
- **Command**:
  ```bash
  curl -sN -m 3 'http://localhost:8788/api/events' | grep -A1 '^event: bg-update'
  ```
- **Expected Result**: One `event: bg-update` line per registered bg process, each followed by a `data:` JSON line containing `"liveness":"running"`, `"liveness":"exited"` or `"liveness":"stopped"` and the unchanged fields (`name`, `windowPresent`, `state`, `logPath`, `statePath`, `linkedAgent`, `projectId`, `projectName`). (curl exits non-zero on the `-m` timeout; that is expected.)
- **Repeatable Unit Test**: Not applicable: exercises a live SSE stream on the running host-server.
- [FAIL: auto-judge: one bg-update per bg process each with liveness present (stopped/running) and name/windowPresent/state/logPath/statePath/projectId/projectName intact, BUT Expected lists `linkedAgent` and payload has no such key — likely stale spec (linkedAgent retired by TASK-0197 per CLAUDE.md), needs human/spec correction] <!-- 2026-09-20 -->

---

### UAT-EDGE-001: `bgLiveness()` classification matrix — stopped / running / exited, shell-launch exception, empty command fails toward running
- **Scenario**: The pure rule in `host-server/state.ts`: window absent -> `stopped` (whatever the pane command, even inside the grace); tmux gave an empty/whitespace/undefined/null command -> `running`; launch command whose first non-env word is a shell (`zsh -c ...`, `FOO=1 bash`) -> `running` even at a shell prompt; pane at a plain shell (`zsh`, `/bin/bash`, `/usr/bin/ZSH`, case/basename-insensitive) with a non-shell launch command (including an env-prefixed one like `PORT=3000 npm run dev`) and no grace -> `exited`; any non-shell pane command -> `running`, however old the window activity.
- **Steps**: Covered by `host-server/state.test.ts`, `describe('bgLiveness (TASK-0191)')` (12 cases: the 8 written by TASK-0191 plus 4 added by this UAT for env-prefixed launch, case/basename, non-shell-never-exited, and stopped-inside-grace). Code path: `bgLiveness` in `host-server/state.ts` (reuses `SHELL_COMMANDS` and `launchCommandBasename`, the same rule as `isPaneDead`).
- **Expected Result**: All `bgLiveness` cases pass; each of the five rows above returns exactly the classification listed.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (extended in place; existing file is the local pattern)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts` — verified: 43/43 pass (3 consecutive runs)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: Startup grace — a shell pane reads `running` for `BG_STARTUP_GRACE_MS` (3000 ms) after window activity, `exited` from exactly the boundary; the grace needs both timestamps
- **Scenario**: Right after `send-keys` the pane shows the shell before the child forks, so a shell must read `running` for `BG_STARTUP_GRACE_MS` after the window's `#{window_activity}`. The boundary is strict (`nowMs - windowActivityMs < 3000`). If either `windowActivityMs` or `nowMs` is omitted, no grace applies (the fallback / monitor-style path).
- **Steps**: Covered by `host-server/state.test.ts` `bgLiveness` cases "reports 'running' for a shell pane inside the startup grace" (activity `now - 2999`), "reports 'exited' for a shell pane once the startup grace has elapsed" (activity `now - 3000`) and "applies no grace when only one of windowActivityMs / nowMs is supplied". Constant: `BG_STARTUP_GRACE_MS = 3000` in `host-server/state.ts`.
- **Expected Result**: 2999 ms after activity -> `running`; 3000 ms -> `exited`; only one of the two timestamps supplied -> `exited`. `BG_STARTUP_GRACE_MS` is exported and equals `3000`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (existing cases from TASK-0191; see UAT-EDGE-001)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts` — verified: 43/43 pass
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: `readTmuxWindowInventory` requests `#{window_activity}` as a third tab column and parses it tolerantly (seconds -> ms; empty / non-numeric / legacy 2-column lines never drop the window)
- **Scenario**: The `list-windows` format string became `#{window_name}\t#{pane_current_command}\t#{window_activity}`. The parser fills the new `windowActivityMs` map only for numeric activity values (epoch seconds x 1000) and must still register the window in `windows` when the activity is empty, non-numeric, or the line has only two columns (older format).
- **Steps**: Covered by `host-server/state.test.ts` `describe('readTmuxWindowInventory window_activity column (TASK-0191)')` (added by this UAT): a fake `tmux` shim on `PATH` (written under `./tmp/`, cleaned up in `after`) records its argv and prints four lines (`bg-a zsh 1000`, `bg-b node <empty>`, `bg-c sleep notanumber`, `bg-old bash` with no third column). Whether a *real* tmux expands the variable is UAT-INT-001.
- **Expected Result**: The `-F` argument equals the three-column format exactly; `windows` lists all four windows with their commands; `windowActivityMs` is exactly `[['bg-a', 1000000]]`.
- **Repeatable Unit Test**: Created: `host-server/state.test.ts` (2 new cases; the shim is warmed up once in `before` because the first exec of a freshly written script can exceed the 100 ms `TMUX_SYNC_TIMEOUT_MS` on macOS)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test state.test.ts` — verified: 43/43 pass (3 consecutive runs)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-001: [DEFERRED-TO-UAT] Real tmux expands `#{window_activity}` to epoch seconds and `readTmuxWindowInventory` turns it into `windowActivityMs`
- **Scenario**: TASK-0191 flagged the live expansion of `#{window_activity}` as unverified (only mocked in unit tests). Use a private tmux server so the live conductor session is untouched.
- **Steps**:
  1. Run from the repo root (one shell session so the variables persist):
     ```bash
     export TMUX_TMPDIR="$PWD/tmp/uat-0191/tmux"; SOCK="$TMUX_TMPDIR/tmux-$(id -u)/default"; mkdir -p -m 700 "$(dirname "$SOCK")"
     env -u TMUX tmux -S "$SOCK" -f /dev/null new-session -d -s uat0191 -n bg-fresh 'bash --norc --noprofile'
     ```
  2. Read the raw tmux value next to the wall clock:
     ```bash
     env -u TMUX tmux -S "$SOCK" list-windows -t uat0191 -F '#{window_name} #{window_activity}'; date +%s
     ```
  3. Read it through the host-server helper (same private server, via `TMUX_TMPDIR`):
     ```bash
     (cd host-server && env -u TMUX node --import tsx/esm --input-type=module -e "import {readTmuxWindowInventory as r} from './state.ts'; const i=r('uat0191'); console.log(JSON.stringify({w:[...i.windows],a:[...i.windowActivityMs]}))")
     ```
  4. Cleanup: `env -u TMUX tmux -S "$SOCK" kill-server; rm -rf tmp/uat-0191`
- **Expected Result**: Step 2 prints `bg-fresh <N>` where `<N>` is a 10-digit epoch-seconds integer within ~5 s of the `date +%s` value on the next line (NOT empty, NOT a literal `#{window_activity}`, NOT milliseconds). Step 3 prints `{"w":[["bg-fresh","bash"]],"a":[["bg-fresh",<N>000]]}` (`windowActivityMs` = seconds x 1000, and `windows` still maps to the pane command). Generation-time result on tmux 3.7c: `bg-fresh 1789885004` / `date` 1789885004 / `a: 1789885004000`. Step 4 leaves `tmux list-sessions` (default server) showing the `conductor` session still alive.
- **Repeatable Unit Test**: Not applicable: needs a live tmux server; the parsing half is pinned by UAT-EDGE-003.
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-002: [DEFERRED-TO-UAT] Startup grace against a real fresh window: a shell reads `running` immediately and `exited` once past 3 s
- **Scenario**: Ties `#{window_activity}` to the grace end to end: a freshly created bg window sitting at a shell prompt must read `running` right away and `exited` after `BG_STARTUP_GRACE_MS`.
- **Steps**:
  1. Re-run INT-001 step 1 (private server, `TMUX_TMPDIR`/`SOCK` exported), then in the same shell save this probe as one command:
     ```bash
     probe() { (cd host-server && env -u TMUX node --import tsx/esm --input-type=module -e "import {readTmuxWindowInventory as r, bgLiveness as b} from './state.ts'; const i=r('uat0191'); for (const [n,c] of i.windows) console.log(n, b({windowPresent:true,paneCommand:c,launchCmd:'npm run dev',windowActivityMs:i.windowActivityMs.get(n),nowMs:Date.now()}))"); }
     ```
  2. Immediately: `env -u TMUX tmux -S "$SOCK" new-window -d -t uat0191: -n bg-late 'bash --norc --noprofile'; probe`
  3. Wait 4 s (`sleep 4`), then `probe` again.
  4. Cleanup as INT-001 step 4.
- **Expected Result**: First `probe` (within ~1 s of window creation): `bg-late running`. Second `probe` (after >= 4 s): `bg-late exited`. The original `bg-fresh` window (created earlier than the grace) reads `exited` in both probes. Generation-time: `bg-fresh exited`, `bg-late running` -> after 4 s `bg-late exited`.
- **Repeatable Unit Test**: Not applicable: needs a live tmux server and wall-clock wait; the boundary logic is pinned by UAT-EDGE-002.
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-003: `scripts/verify-bg-liveness.sh` proves crashed -> `exited`, running -> `running`, shell-launch -> `running`, missing window -> `dead` on a private tmux socket
- **Scenario**: TASK-0191 wrote the script and left running it as [DEFERRED-TO-UAT]. It replicates `bg_pane_exited()` from `scripts/monitor.sh` (it cannot source `monitor.sh`, which runs its loop at top level), so a green run is only meaningful if the replica still matches — Step 2 checks that.
- **Steps**:
  1. Run the command below from the repo root (takes ~5 s; artifacts under `./tmp/verify-bg-liveness/`).
  2. Diff the logic by reading `bg_pane_exited()` in `scripts/monitor.sh` against the replica in `scripts/verify-bg-liveness.sh` (shell-launch early return -> `pane_current_command` -> empty fails toward running -> `is_shell_cmd`).
- **Command**:
  ```bash
  bash scripts/verify-bg-liveness.sh
  ```
- **Expected Result**: Exit code 0 and four `PASS:` lines — `running process (sleep 300) -> running`, `crashed process (shell prompt, window present) -> exited`, `shell launch command at a shell prompt -> running`, `missing window -> dead` — ending with `PASS — bg liveness classification checks passed`. The two implementations of `bg_pane_exited` are logically identical. Generation-time: run passed (4/4).
- **Repeatable Unit Test**: Not applicable: shell script exercising a private live tmux server (the script is itself the repeatable check; its exit code is the verdict).
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-004: The live monitor writes `running` / `dead` for real bg processes and never the old `alive`
- **Scenario**: `scripts/monitor.sh` bg loop now writes `dead` (window not found, plus `move_to_backlog`), `exited` (window present, pane at a plain shell, launch command not a shell) or `running`. The targets also changed to exact-match `"$SESSION_NAME:=$bg_name"`; `tmux has-session -t` with that form must still succeed for a live window and fail for a missing/prefix name, otherwise every bg process would be mis-written as `dead`.
- **Steps**:
  1. Pick a registered bg process that has a live window (generation-time: `dev`) and one without a window (`dev-stack`), using the UAT-API-001 output.
  2. Confirm the exact-match target semantics: `tmux has-session -t 'conductor:=dev'; echo $?`, `tmux has-session -t 'conductor:=de'; echo $?`, `tmux has-session -t 'conductor:=nosuch'; echo $?` (substitute the real window names).
  3. Wait at least one `POLL_INTERVAL` (15 s in `conductor.conf`) and read the state files: `cat logs/state/bg-dev.state` and `cat logs/state/bg-dev-stack.state`.
  4. Search `logs/state/bg-*.state` for the old value: Serena `search_for_pattern` `^alive$` over `logs/state`.
- **Expected Result**: Step 2 prints `0`, then `1` (prefix `de` does not match `dev`), then `1`. Step 3: the live-window process reads `running` (or `exited` if its pane is genuinely at a shell prompt), the window-less one reads `dead`. Step 4: no `bg-*.state` file contains `alive`.
- **Repeatable Unit Test**: Not applicable: requires the running monitor loop and the live conductor tmux session.
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-005: [OPT-IN] End to end — a bg process that crashes back to its shell goes `running` -> `exited`, in the API, the state file, and as a pushed `bg-update`
- **Scenario**: The point of the task: a dev server that dies leaves its window open at a shell prompt, and that must no longer read healthy. A throwaway bg process with launch command `sleep 8` runs for 8 s and then falls back to the shell. (`sleep` is not a shell, so the shell-launch exception does not apply.) Also checks the SSE side: `pollAndDiff` (`host-server/index.ts`, "for (const bg of current.bgProcesses)") only emits `bg-update` when `windowPresent`, `state` or `linkedAgent` changed — `liveness` is **not** in that predicate. The window stays present through the crash, so a liveness-only flip is pushed only if/when the monitor's next poll rewrites the state file (up to `POLL_INTERVAL` = 15 s) — and never if the monitor is not running. A dashboard consuming `liveness` (Phase 4) needs the change pushed at host-server tick speed, so the SSE assertion below is written against that requirement. If it fails, see the Gaps note in the completion report.
- **Steps**:
  1. Start an SSE capture that outlives the test: `curl -sN -m 40 'http://localhost:8788/api/events' > tmp/uat-0191-sse.log &` (run `mkdir -p tmp` first if needed). Note the wall-clock time T0.
  2. Create the probe (run as-is):
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"uat0191-probe","workdir":"/Users/davidtaylor/Repositories/tmux-conductor","launchCmd":"sleep 8"}'
     ```
  3. Within ~2 s read the probe's liveness:
     ```bash
     curl -sS 'http://localhost:8788/api/status' | jq -c '.bgProcesses[] | select(.name=="uat0191-probe") | {windowPresent, liveness, state}'
     ```
  4. At ~T0+6 s repeat step 3 (`sleep` still running).
  5. At ~T0+14 s repeat step 3 (`sleep` ended at ~T0+8 s, grace ended ~T0+11 s, plus one status tick of ~2 s).
  6. At ~T0+35 s (after the monitor's next poll) read the state file: `cat logs/state/bg-uat0191-probe.state`, then inspect the capture: `grep -A1 '^event: bg-update' tmp/uat-0191-sse.log | grep uat0191-probe`.
  7. Cleanup (always): `curl -sS -X DELETE 'http://localhost:8788/api/bg-processes/uat0191-probe'`, then remove `logs/bg-uat0191-probe.log` and `tmp/uat-0191-sse.log`.
- **Expected Result**: Step 2 returns 201 `{"ok":true,...}`. Step 3 -> `{"windowPresent":true,"liveness":"running",...}` (startup grace covers the shell-before-fork window). Step 4 -> `"liveness":"running"`. Step 5 -> `{"windowPresent":true,"liveness":"exited",...}` (window still present, but `exited` — the old logic would have said healthy). Step 6: the state file reads `exited`. The SSE capture contains a `bg-update` for `uat0191-probe` with `"liveness":"exited"` that arrived by ~T0+16 s (i.e. driven by the host-server's own tick, not only by the monitor's 15 s poll); a capture that shows the `exited` update only after the monitor's poll, or not at all, FAILS this assertion. Step 7 returns `{"ok":true,"removed":"uat0191-probe"}` and afterwards the probe is absent from `/api/status`. The agents' dispatch and idle detection are unaffected throughout.
- **Repeatable Unit Test**: Not applicable: needs the live host-server, tmux session, monitor loop and wall-clock waits.
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: Non-goals hold — bg liveness never gates dispatch, idle detection or teardown, and does not change the agent status pipeline
- **Scenario**: The task forbids gating dispatch on bg liveness and forbids changing agent status detection. The new symbols must be confined to bg reporting.
- **Steps**:
  1. With Serena `find_referencing_symbols` (or `search_for_pattern`) list every reference to `bgLiveness`, `bgLivenessForWindow`, `BG_STARTUP_GRACE_MS`, `windowActivityMs` across `host-server/` (non-test).
  2. In `scripts/monitor.sh`, list every call site of `bg_pane_exited`, and confirm the bg loop's result is only written to `$STATE_DIR/bg-<name>.state` (plus the pre-existing `move_to_backlog` on the `dead` branch) and is not read by `is_idle`, `pop_task_sql`, dispatch, or the `all_idle`/`all_usage_hit` shutdown logic.
  3. Confirm `detectAgentStatus`'s signature/behavior is unchanged by this task (its 18-case matrix in `state.test.ts` still passes: run the UAT-EDGE-001 command and check the `detectAgentStatus` suites are green).
- **Expected Result**: Non-test references to the new symbols are limited to `state.ts` (definitions + `readTmuxWindowInventory`), `index.ts` (`BgStatus`, `buildBgStatuses`, `buildSnapshot` passing `inventory.windowActivityMs`), and the type field in `frontend/src/components/AgentList.tsx`. `bg_pane_exited` is called from exactly one place (the bg loop). No dispatch/usage/idle code references bg liveness. All `detectAgentStatus` tests pass.
- **Repeatable Unit Test**: Not applicable: a source-shape / non-regression check; the `detectAgentStatus` matrix is already covered by `state.test.ts` (run in UAT-EDGE-001's command).
- [FAIL: auto-judge: source-shape case with no machine oracle — requires human verification. Evidence gathered: bg_pane_exited called once (monitor.sh:652, bg loop only); state.test.ts 61/61 green incl. detectAgentStatus; no dispatch/idle/teardown code references bg liveness. BUT literal Expected "references limited to state.ts/index.ts/AgentList.tsx type" no longer holds: bgRestart.ts (comment) and Phase-4 frontend BgLivenessBadge.tsx/BackgroundProcessesTab.tsx now consume `liveness`, and bgDiff.ts diffs it (landed by sibling tasks) — Expected needs a human re-baseline] <!-- 2026-09-20 -->

---

### UAT-EDGE-005: Static gates — typecheck clean, shell syntax clean, and the `dev-commands` fixture script still passes with the new vocabulary
- **Scenario**: The vocabulary change (`alive` -> `running`/`exited`, `idle` fixture -> `exited`) touches `monitor.sh`, `verify-dev-commands.sh`, host-server and the frontend type.
- **Steps**:
  1. `cd host-server && npx tsc --noEmit`
  2. `cd frontend && npx tsc --noEmit`
  3. `bash -n scripts/monitor.sh && bash -n scripts/verify-bg-liveness.sh && bash -n scripts/verify-dev-commands.sh && echo syntax-ok`
  4. `bash scripts/verify-dev-commands.sh`
  5. Read `wiki/knowledge/concepts/background-process-registry.md` (section "Real liveness (running / exited / stopped)") and `scripts/README.md` (monitor bg liveness paragraph) and confirm they describe `running`/`exited`/`dead` (state file) and `running`/`exited`/`stopped` (API).
- **Expected Result**: Steps 1 and 2 produce no output (exit 0). If another agent's in-progress edit elsewhere causes an error, the case still passes as long as no error mentions `state.ts`, `index.ts`, `AgentList.tsx` or `state.test.ts`. Step 3 prints `syntax-ok`. Step 4 exits 0 with all checks `PASS` (generation-time: 10 checks, ending `PASS — all dev-commands.sh behavioral checks passed`). Step 5: both docs use the new vocabulary and neither still claims the state file is `alive`/`dead`. (Note: the Unverified-against-live-tmux sentence in `background-process-registry.md` should be updated once UAT-INT-001 passes.)
- **Repeatable Unit Test**: Not applicable: static typecheck / lint / doc-content gates (`tsc --noEmit` and `bash -n` are the repeatable checks).
- [x] Pass <!-- 2026-09-20 -->
