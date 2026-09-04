# hooks/

Claude Code lifecycle hooks for tmux-conductor. These scripts implement the **idle/busy state machine** that `monitor.sh` depends on to know when an agent is ready for a new task.

See also: [`../install-hooks.sh`](../install-hooks.sh) — installer that copies these scripts to `~/.claude/hooks/tmux-conductor/` and registers them in `~/.claude/settings.json`.

---

## State machine

Each Claude Code session event maps to a state value written to `$STATE_DIR/<agent-name>.state`:

```
SessionStart (startup|resume|clear)  →  idle
UserPromptSubmit                      →  busy
Stop                                  →  idle
StopFailure                           →  idle
```

`monitor.sh`/`host-server` read these files as the **primary** idle signal. When a file is missing or older than `2 × POLL_INTERVAL`, the fallback is the `IDLE_PATTERN` regex against `capture-pane` output. A separate, orthogonal check also gates dispatch: `on-notification.js`'s background-agent sentinel (BUG-0001, below) — an agent can read `idle` here and still not be safe to dispatch into if it's waiting on a background sub-agent it spawned.

The agent name is resolved from the `CONDUCTOR_AGENT_NAME` environment variable, which `conductor.sh` / `spawn.sh` set before launching each agent.

---

## Scripts

| Script | Event | State written | Going forward? |
|--------|-------|---------------|----------------|
| `on-session-start.js` | `SessionStart` (matcher: `startup\|resume\|clear`) | `idle` | **Essential** |
| `on-prompt-submit.js` | `UserPromptSubmit` | `busy` | **Essential** |
| `on-stop.js` | `Stop` | `idle` | **Essential** |
| `on-stop-failure.js` | `StopFailure` | `idle` | **Essential** |
| `on-notification.js` | `Notification` | writes/clears a `<agent>.pending-agents/` sentinel file (not `idle`/`busy` — see below) | **Essential** (BUG-0001) |
| `lib/write-state.js` | *(shared helper, not registered directly)* | — | **Essential** |
| `register-hooks.jq` | *(jq program, not registered directly)* | — | **Essential** |

### `on-session-start.js` / `on-prompt-submit.js` / `on-stop.js` / `on-stop-failure.js`

Each is a one-liner that delegates to `lib/write-state.js`:

```js
require('./lib/write-state').writeState('idle', 'stop');
```

### `lib/write-state.js`

Shared helper used by all four hook scripts. Responsibilities:

1. Resolves the agent name from `process.env.CONDUCTOR_AGENT_NAME`
2. Drains stdin (required — Claude Code hooks must consume the JSON payload)
3. Writes the state value (`idle` or `busy`) to `$STATE_DIR/<agent>.state`
4. Appends a JSONL record to `$CONDUCTOR_LOG_DIR/hooks.jsonl` for audit tracing

Fields in each hooks.jsonl record: `ts`, `agent`, `event`, `prev_state`, `new_state`.

### `on-notification.js` — background-agent sentinel (BUG-0001)

Claude Code's background/async-agent feature (shipped v2.1.198) lets a session's
outer turn end via a genuine `Stop` — which `on-stop.js` writes as `idle`
unconditionally — while a background sub-agent it spawned (e.g. `/power-mode`'s
UAT-auto sub-agents) keeps running independently. The idle/busy state file above
has no way to represent "turn ended, but a background agent I spawned is still
going," so a queued task could dispatch into a pane that is still genuinely
occupied. This is **not** a reopening of the collapsed `done`/`working`/`wait`/
`dispatching` vocabulary (task 009) — it is a narrow, separate mechanism.

`on-notification.js` listens for two documented `notification_type` values and
is a no-op (log-only) for every other type:

| `notification_type` | Action |
|---|---|
| `agent_needs_input` | create a sentinel file under `$STATE_DIR/<agent>.pending-agents/` |
| `agent_completed` | remove the oldest sentinel file in that directory, if any |

`host-server/pendingAgents.ts`'s `hasPendingBackgroundAgents()` gates both
dispatch call sites (`POST /api/tasks`'s immediate-enqueue fast path and
`pollAndDiff`'s idle-transition trigger, in `host-server/index.ts`) on that
directory being empty of fresh sentinels. A sentinel older than
`PENDING_AGENT_STALE_S` (see `conductor.conf`) is treated as stale and ignored
— logged loudly — so a missed or unsupported `agent_completed` notification
can never wedge the queue forever. Every raw payload is also appended to
`$CONDUCTOR_LOG_DIR/notification-debug.jsonl` regardless of type.

See `wiki/work/bugs/0001-false-idle-during-subagent-wait.md` for the full
root-cause writeup and what remains unverified without a live multi-agent
session.

### `register-hooks.jq`

jq DSL program invoked by `install-hooks.sh` to merge hook registrations into `~/.claude/settings.json`. It:

- Registers `on-session-start.js` under `SessionStart` with matcher `startup|resume|clear`
- Registers `on-prompt-submit.js` under `UserPromptSubmit`
- Registers `on-stop.js` under `Stop`
- Registers `on-stop-failure.js` under `StopFailure`
- Registers `on-notification.js` under `Notification` (BUG-0001)
- Deduplicates on re-run (idempotent)
- Prunes stale repo-path entries from prior installs
- Preserves all unrelated hooks in the file

---

## Installation

```bash
# From the repo root:
./install-hooks.sh
```

The installer copies all JS scripts + `lib/write-state.js` to `~/.claude/hooks/tmux-conductor/` and merges registrations into `~/.claude/settings.json`. The registered commands use `~` paths so they survive repo relocation.

Optional overrides for testing:

```bash
./install-hooks.sh \
  --hook-dir /path/to/hooks \
  --settings-file /tmp/test-settings.json \
  --install-dir /tmp/test-install
```

---

## `.bash-backup/`

The original Bash implementations of all four hooks, kept for reference after task 011 ported them to Node.js. **These are not installed** — `install-hooks.sh` only registers the `.js` versions.

See [`hooks/.bash-backup/README.md`](.bash-backup/README.md) for details.
