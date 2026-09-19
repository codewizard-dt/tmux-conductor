---
topic: "Best strategy for a repeatable unit test covering scripts/monitor.sh's emit_transition_jsonl() and the poll loop's transition-diff logic (TASK-144), given monitor.sh cannot be sourced in isolation"
slug: monitor-sh-transition-emit-testability
researched: 2026-09-13
---

# Primary Sources — Testing strategy for monitor.sh's emit_transition_jsonl / transition-diff logic

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `scripts/monitor.sh:1-52` (top-of-file: `source conductor.conf`, `load_agents`/`load_bg` calls) and `scripts/monitor.sh:442-505` (main `while true` loop, transition-diff guard) | 2026-09-13 | Confirmed monitor.sh cannot be sourced without a live DB and never returns from its main loop; confirmed `conductor.conf`'s `LOG_DIR`/`STATE_DIR`/`POLL_INTERVAL` are hardcoded unconditional assignments that survive `source` regardless of pre-exported env vars |
| S2 | codebase | `scripts/monitor.sh::emit_transition_jsonl` (400-431), `scripts/monitor.sh::pane_tail_json` (337-346) | 2026-09-13 | Confirmed both functions are argument-driven, touch only `tmux capture-pane` and `python3 -c`, and read `TRANSITION_LOG` as a plain variable at call time (overridable after extraction) |
| S3 | codebase | `scripts/verify-task-pop-soft-flip.sh` (full file), `scripts/verify-teardown-window-mapping.sh` (full file), `scripts/lib/db.sh` (symbols overview) | 2026-09-13 | Established the repo's only two precedents for testing "live" scripts: sourcing a side-effect-free library file (`lib/db.sh`) against a scratch `CONDUCTOR_DB`, or running a *terminating* script (`teardown.sh`) as a real subprocess against scratch tmux+DB infra with overridable `CONDUCTOR_DB`/`CONDUCTOR_SESSION_NAME` — confirmed no `BASH_SOURCE`-guard/testability-seam idiom exists anywhere in `scripts/*.sh` |

## Excerpts

### S1 — scripts/monitor.sh (top-of-file + main loop)
`scripts/monitor.sh:10-23`
> `source "$SCRIPT_DIR/lib/db.sh"` / `source "$SCRIPT_DIR/../conductor.conf"` ... `LOG_DIR="$LOG_DIR/${LOG_DIR#./}"` style resolution, `TRANSITION_LOG="$LOG_DIR/transitions.jsonl"`

`scripts/monitor.sh:442-444`
> `ITER=0` / `while true; do` / `ITER=$((ITER + 1))`

`conductor.conf:105,201,223`
> `POLL_INTERVAL=15` ... `LOG_DIR="./logs"` ... `STATE_DIR="./logs/state"` — plain assignments, not `: "${VAR:=...}"`, so an exported override is clobbered on `source`.

### S2 — scripts/monitor.sh (emit_transition_jsonl, pane_tail_json)
`scripts/monitor.sh:400-431`
> `emit_transition_jsonl() { local agent="$1" ... pane_tail=$(pane_tail_json "$target" ...) ... >> "$TRANSITION_LOG" 2>/dev/null || true }` — args-only inputs plus the `TRANSITION_LOG`/`LAST_STATE_AGE` globals, no other implicit state.

### S3 — verify-teardown-window-mapping.sh / verify-task-pop-soft-flip.sh
`scripts/verify-teardown-window-mapping.sh:14-19,61-69`
> `export CONDUCTOR_DB="$VERIFY_DIR/conductor-verify.db"` ... `tmux new-session -d -s "$CONDUCTOR_SESSION_NAME" -n "$EXPECTED_WINDOW" ...` ... `CONDUCTOR_DB="$CONDUCTOR_DB" CONDUCTOR_SESSION_NAME="$CONDUCTOR_SESSION_NAME" bash "$SCRIPT_DIR/teardown.sh" >"$teardown_log" 2>&1` — runs the real, terminating script against scratch infra.

`scripts/verify-task-pop-soft-flip.sh:56-58`
> `export CONDUCTOR_DB="$SCRATCH_DB"` / `source "$REPO/scripts/lib/db.sh"` — sources a side-effect-free library file directly, no main loop to guard against.
