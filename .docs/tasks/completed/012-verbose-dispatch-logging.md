# 012 — Verbose Dispatch State Logging

## Objective

Capture rich state context at every dispatch and hook transition so we can audit what state each agent was in when a command was sent to its pane.

## Approach

Enrich `monitor.sh` inline log lines with detection-method + state-file age + queue context, emit a structured `dispatch.jsonl` record per dispatch, and add a shared `hooks.jsonl` transitions log written by all four hook scripts via `hooks/lib/write-state.js`. All new artifacts live under `$LOG_DIR` (host) / `$CONDUCTOR_LOG_DIR` (container).

## Prerequisites

- [x] Task 011 (Hooks to JS) completed — hook scripts share `hooks/lib/write-state.js`
- [x] Task 009 (Hook Model Alignment) completed — state vocabulary is `idle`/`busy`

---

## Steps

### 1. Refactor `is_idle` to expose detection context  <!-- agent: general-purpose -->

- [x] In `monitor.sh`, declare globals at top of script: `LAST_DETECTION=""`, `LAST_STATE_VALUE=""`, `LAST_STATE_AGE=""`
- [x] Modify `is_idle()` so each return path sets these:
  - State-file `idle` → `LAST_DETECTION=state-file`, `LAST_STATE_VALUE=idle`, `LAST_STATE_AGE=<age>`
  - State-file `busy` → same but `LAST_STATE_VALUE=busy`
  - Stale/missing state file + regex match → `LAST_DETECTION=regex`, `LAST_STATE_VALUE=""`, `LAST_STATE_AGE=""`
  - Regex no match → same as above with `LAST_DETECTION=regex`
  - Unknown state-file contents (fall-through) → `LAST_STATE_VALUE=<raw>`, `LAST_DETECTION=regex` after regex runs
- [x] Do not change the return-code semantics — only add the globals

### 2. Expose queue kind from `pop_task`  <!-- agent: general-purpose -->

- [x] Add global `LAST_QUEUE_KIND=""` at top of `monitor.sh`
- [x] In `pop_task()`, set `LAST_QUEUE_KIND="$match_kind"` (already computed as `scoped` or `global`) before echoing the matched command
- [x] Also set `LAST_QUEUE_KIND=""` at the top of every `pop_task` call so stale values don't leak
- [x] Add global `LAST_QUEUE_REMAINING=""` set to `wc -l < "$TASK_QUEUE"` after the `sed -i.bak` removal (0 if queue file is gone/empty)

### 3. Add JSONL dispatch logging  <!-- agent: general-purpose -->

- [x] In `monitor.sh`, define `DISPATCH_LOG="$LOG_DIR/dispatch.jsonl"`
- [x] Add helper `pane_tail_json()` that runs `tmux capture-pane -t "$target" -p | grep -v '^[[:space:]]*$' | tail -10` and emits a JSON array of strings (escape `"` and `\`, collapse newlines). Keep it stdlib-only — bash + `sed`/`awk` via a small here-doc or a `python3 -c` one-liner (prefer `python3` since the base image has it; use a bash JSON-escape function if not available)
- [x] Add helper `emit_dispatch_jsonl()` with signature `(agent, command, queue_kind, queue_remaining, target)` that appends one line to `$DISPATCH_LOG` with fields:
  ```json
  {"ts":"<ISO8601>","agent":"<name>","command":"<cmd>","state":"<LAST_STATE_VALUE>","state_age_s":<LAST_STATE_AGE|null>,"detection":"<LAST_DETECTION>","queue":"<scoped|global|default>","queue_remaining":<n|null>,"pane_tail":[...]}
  ```
  - Use `date -u +%Y-%m-%dT%H:%M:%SZ` for `ts`
  - `null` (bareword) when a numeric field has no value
- [x] In the main loop's three dispatch branches (scoped/global task, default `TASK_CMD`, no command), call `emit_dispatch_jsonl` **before** `mark_busy`:
  - scoped/global: pass `LAST_QUEUE_KIND`, `LAST_QUEUE_REMAINING`
  - default `TASK_CMD` branch: pass `"default"`, `""`
  - idle-no-command branch: still emit a record with `command:""`, `queue:"none"` so we see the decision was logged

### 4. Enrich inline `log` lines  <!-- agent: general-purpose -->

- [x] Change `log "$name — idle detected"` to include detection context, e.g.:
  `log "$name — idle detected (detection=$LAST_DETECTION state=${LAST_STATE_VALUE:-n/a} age=${LAST_STATE_AGE:-n/a}s)"`
- [x] Change `log "$name — dispatching task: $task"` to:
  `log "$name — dispatching task [queue=$LAST_QUEUE_KIND remaining=$LAST_QUEUE_REMAINING detection=$LAST_DETECTION]: $task"`
- [x] Change `log "$name — queue empty, sending default: $TASK_CMD"` to:
  `log "$name — dispatching default [queue=default detection=$LAST_DETECTION]: $TASK_CMD"`

### 5. Hook transitions log in `write-state.js`  <!-- agent: general-purpose -->

- [x] Modify `hooks/lib/write-state.js` `writeState(value, event)` signature to accept a second arg `event` (one of `session-start`, `prompt-submit`, `stop`, `stop-failure`)
- [x] Read env `CONDUCTOR_LOG_DIR` (default `/conductor-logs`)
- [x] Before writing the new state, read the existing state file (if present) into `prevState` (trim trailing newline; empty string if missing)
- [x] After the state file write succeeds, append one JSONL record to `$CONDUCTOR_LOG_DIR/hooks.jsonl`:
  ```json
  {"ts":"<ISO8601>","agent":"<name>","event":"<event>","prev_state":"<prev>","new_state":"<value>"}
  ```
  - Use `new Date().toISOString()`
  - Create `$CONDUCTOR_LOG_DIR` with `fs.mkdirSync(..., { recursive: true })`
  - Best-effort: swallow write errors (hooks must never crash the agent)
- [x] Update all four hook entrypoints in `hooks/` to pass their event name:
  - `on-session-start.js` → `writeState('idle', 'session-start')`
  - `on-prompt-submit.js` → `writeState('busy', 'prompt-submit')`
  - `on-stop.js` → `writeState('idle', 'stop')`
  - `on-stop-failure.js` → `writeState('idle', 'stop-failure')`

### 6. Wire `CONDUCTOR_LOG_DIR` into container env  <!-- agent: general-purpose -->

- [x] In `conductor.sh`, export `CONDUCTOR_LOG_DIR="$LOG_DIR"` before launching agents so hooks running in the host tmux session see it
- [x] In `scaffold.sh`, add `CONDUCTOR_LOG_DIR=/conductor-logs` to the compose service environment block (mirroring the existing `CONDUCTOR_STATE_DIR` pattern); add a matching tmpfs/volume mount for `/conductor-logs` so the host can read it
- [x] In `agent_exec.sh`, forward `CONDUCTOR_LOG_DIR` into the container exec call (same as `CONDUCTOR_STATE_DIR`)

### 7. Documentation  <!-- agent: general-purpose -->

- [x] Update `CLAUDE.md` "Core Scripts" and "Key Design Decisions" sections to mention `dispatch.jsonl` and `hooks.jsonl`, their location, and what each field means
- [x] Update `conductor.conf` (if present) or its example template to document any new env vars the user can override

### 8. Verification  <!-- agent: general-purpose -->

- [x] Run `bash -n monitor.sh` and `node -c hooks/lib/write-state.js` (via `node --check`) — both clean
- [ ] Start a short conductor session with 1 agent, dispatch one scoped task + one global task, then Esc-interrupt once
- [ ] Confirm `$LOG_DIR/dispatch.jsonl` has three records with distinct `queue` values (`scoped`, `global`, and — if applicable — `default`)
- [ ] Confirm every record has `detection`, `state`, `state_age_s`, `queue_remaining`, and a non-empty `pane_tail` array
- [ ] Confirm `$LOG_DIR/hooks.jsonl` contains entries for `session-start` (prev_state=""), `prompt-submit` (prev_state="idle", new_state="busy"), and `stop` (prev_state="busy", new_state="idle")
- [ ] Confirm `monitor-*.log` inline lines now include `detection=` and `queue=` annotations
- [ ] Tear down session cleanly and verify no stray processes

---
**UAT**: [`.docs/uat/pending/012-verbose-dispatch-logging.uat.md`](../../uat/pending/012-verbose-dispatch-logging.uat.md)
