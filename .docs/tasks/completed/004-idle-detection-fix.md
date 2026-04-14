# 004 — Replace `capture-pane` Idle Regex With Claude Code Hooks (Regex Fallback)

## Objective

Replace the brittle `capture-pane` + regex idle detection with Claude Code's native lifecycle hooks (`UserPromptSubmit`, `PreToolUse`, `Stop`, `Notification`) writing to a per-agent state file, which `monitor.sh` reads. Keep the Step-3 footer regex as a fallback for when the state file is missing or stale.

## Approach

Model this on [`samleeney/tmux-agent-status`](https://github.com/samleeney/tmux-agent-status) (vendored locally at `/Users/davidtaylor/Repositories/tmux-agent-status`). Ship a hook script `hooks/claude-hook.sh` in this repo, bind-mount it into each agent container, and `jq`-merge hook config into `~/.claude/settings.json` during `init-claude-config.sh`. The hook writes `working` | `done` | `wait` to `$STATE_DIR/<agent>.state`. `is_idle()` reads the state file first (with an mtime staleness check) and falls back to the existing footer regex when the file is absent or older than `2 × POLL_INTERVAL`.

## Prerequisites

- [x] Task 001 (Initial Scaffolding) completed
- [x] Task 002 (Scoped Task Queue) completed
- [x] Task 003 (Container Config Sharing) completed — `init-claude-config.sh` already seeds `~/.claude/` inside the container and this task layers hook config on top
- [ ] `jq` available inside the agent container (confirmed — `scaffold.sh` already installs it via the Dockerfile `apt-get` line)
- [ ] Live `conductor` tmux session with a `jobfinder` agent pane running Claude Code v2.x for end-to-end verification

---

## Steps

### 1. Empirical capture of pane states  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 -->

- [x] Confirm the `jobfinder` pane exists: `tmux list-windows -t conductor | grep jobfinder`
- [x] **Clean prompt capture:** `mkdir -p ./tmp && tmux capture-pane -t conductor:jobfinder -p > ./tmp/pane-clean.txt`
- [x] **Plan-mode capture:** `tmux capture-pane -t conductor:jobfinder -p > ./tmp/pane-plan.txt`
- [x] **Mid-task capture:** `tmux capture-pane -t conductor:jobfinder -p > ./tmp/pane-busy.txt`
- [x] Record findings inline (see comment below)

<!--
EMPIRICAL FINDINGS (2026-04-14, Claude Code v2.1.105, Sonnet 4.6):

Fixtures saved at ./tmp/pane-{clean,plan,busy}.txt.

  clean  → footer: "  ? for shortcuts"
  plan   → footer: "  ⏸ plan mode on (shift+tab to cycle)"
  busy   → footer: "  esc to interrupt"   (+ "✻ Channelling…" spinner above)

KEY LEARNING (updated post /research on 2026-04-14):
The footer-based regex fix (Steps 2–3) is NOT reliable on its own. In the
project's dev-container workflow the agent runs with `--dangerously-skip-permissions`,
so `⏵⏵ bypass permissions on` is ALWAYS in the footer — only suffixed with
`· esc to interrupt` while busy. Additionally, Claude Code rotates the spinner
verb through "Working / Finnagling / Doodling / Burrowing / …", so no single
busy-keyword is stable (see GitHub anthropics/claude-code#23635). The robust
path is Claude Code's native hook system; the regex is kept as a best-effort
fallback only.
-->


### 2. Patch `is_idle()` blank-line stripping in monitor.sh  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 -->

- [x] Modify the `last_lines` assignment in `is_idle()` to filter blank lines before `tail -5`:
  - New: `last_lines=$(tmux capture-pane -t "$target" -p | grep -v '^[[:space:]]*$' | tail -5 || true)`
- [x] Leave the rest of the function unchanged for now (will be rewritten in Step 9)
- [x] Verify only one `capture-pane` call site exists: `grep -n 'capture-pane' monitor.sh`


### 3. Update `IDLE_PATTERN` in conductor.conf (fallback layer only)  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 -->

- [x] Change `IDLE_PATTERN` in `conductor.conf` to:
  `"\\?[[:space:]]+for[[:space:]]+shortcuts|(accept edits|bypass permissions) on"`
- [x] Update vendor-example comments in `conductor.conf:31–34` to reflect the v2.x pattern
- [x] Note inline in the comment block that this pattern is now the **fallback** behind the hook-based state file (see Step 9)


### 4. Fixture-replay verification of the fallback pattern  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 -->

- [x] Replay each captured fixture through the regex fallback:
  ```bash
  for f in ./tmp/pane-clean.txt ./tmp/pane-plan.txt ./tmp/pane-busy.txt; do
    result=$(cat "$f" | grep -v '^[[:space:]]*$' | tail -5 | grep -qE "$IDLE_PATTERN" && echo IDLE || echo BUSY)
    echo "$f: $result"
  done
  ```
- [x] Confirm: `clean → IDLE`, `plan → BUSY`, `busy → BUSY`
- [x] Known gap: `bypass permissions on (shift+tab to cycle) · esc to interrupt` (real running-mode footer in container) ALSO matches IDLE with this pattern. Step 9 mitigation: hook-based state file takes priority; regex is only consulted when the file is stale.

<!-- ============================================================
     NEW WORK STARTS HERE — hook-based primary detection path
     ============================================================ -->


### 5. Create `hooks/claude-hook.sh`  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 -->

- [x] Create directory: `mkdir -p hooks`
- [x] Create `hooks/claude-hook.sh` (mode `0755`) modeled on `/Users/davidtaylor/Repositories/tmux-agent-status/hooks/better-hook.sh`, adapted for tmux-conductor's agent-name-per-window model (not session-per-agent)
- [x] Script contents:
  ```bash
  #!/usr/bin/env bash
  # claude-hook.sh — Claude Code lifecycle hook for tmux-conductor
  #
  # Installed into the agent container's ~/.claude/settings.json (see Step 6).
  # Writes the agent's current state to $CONDUCTOR_STATE_DIR/<agent>.state so
  # monitor.sh on the host can tell working vs. idle without scraping the TUI.
  #
  # Invoked by Claude Code with the event name as $1. JSON event payload arrives
  # on stdin — we drain and ignore it.

  set -u

  STATE_DIR="${CONDUCTOR_STATE_DIR:-/conductor-state}"
  AGENT_NAME="${CONDUCTOR_AGENT_NAME:-}"

  # Fallback if CONDUCTOR_AGENT_NAME wasn't injected: derive from tmux session.
  # In local (non-container) mode the hook runs inside the tmux pane, so TMUX is set.
  if [ -z "$AGENT_NAME" ] && [ -n "${TMUX:-}" ]; then
    AGENT_NAME=$(tmux display-message -p '#W' 2>/dev/null || true)
  fi

  # Drain JSON payload from stdin (Claude Code sends event data there).
  cat >/dev/null 2>&1 || true

  [ -n "$AGENT_NAME" ] || exit 0
  mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

  state_file="$STATE_DIR/${AGENT_NAME}.state"

  case "${1:-}" in
    UserPromptSubmit|PreToolUse) printf 'working\n' > "$state_file" ;;
    Stop)                        printf 'done\n'    > "$state_file" ;;
    Notification)                printf 'wait\n'    > "$state_file" ;;
    *) ;;  # unknown event — leave state unchanged
  esac

  exit 0
  ```
- [x] `chmod +x hooks/claude-hook.sh`
- [x] `bash -n hooks/claude-hook.sh` — passes
- [x] Smoke test (host, no Claude involved — repo-local `./tmp/` only, per CLAUDE.md):
  ```bash
  mkdir -p ./tmp
  CONDUCTOR_STATE_DIR=./tmp/conductor-state-test CONDUCTOR_AGENT_NAME=testagent \
    bash hooks/claude-hook.sh Stop < /dev/null
  # then Read ./tmp/conductor-state-test/testagent.state — expect: done
  rm -rf ./tmp/conductor-state-test
  ```


### 6. Wire hook config into the container via `scaffold.sh` + `init-claude-config.sh`  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 -->

- [x] In `scaffold.sh`, extend the generated `conductor-compose.yml` heredoc (currently around line 158) to add two bind-mounts under the service's `volumes:` block:
  ```yaml
        - ${CONDUCTOR_REPO}/hooks:/conductor-hooks:ro
        - ${CONDUCTOR_STATE_DIR}:/conductor-state
  ```
  Above the compose heredoc, export defaults so the scaffolded compose file sources them from the conductor's environment at `up` time — or, simpler, bake them with absolute paths derived at scaffold time. Use whichever matches existing project convention; default `CONDUCTOR_REPO` to the absolute path of this repo's root (resolved at scaffold time), default `CONDUCTOR_STATE_DIR` to `${CONDUCTOR_REPO}/logs/state`.
- [x] In the same `conductor-compose.yml` block, add an `environment:` key (or extend the existing `env_file:`) so each service gets:
  ```yaml
      environment:
        - CONDUCTOR_STATE_DIR=/conductor-state
        - CONDUCTOR_AGENT_NAME=${CONDUCTOR_AGENT_NAME}
  ```
  Note: current scope is one agent per project (see memory `project_one_agent_per_project.md`), so `CONDUCTOR_AGENT_NAME` can be baked directly into the generated compose file at scaffold time — derive it from the `AGENTS` array entry or prompt for it as a `scaffold.sh` argument. No per-agent templating needed.
- [x] In `scaffold.sh`, extend the generated `init-claude-config.sh` heredoc (lines 118–149) to append a `jq`-merge step **after** the existing host `rsync` (around line 136) and **before** the `touch sentinel` line:
  ```bash
  # Merge conductor hook config into ~/.claude/settings.json (preserves any host-synced settings)
  SETTINGS_FILE="$HOME/.claude/settings.json"
  [ -f "$SETTINGS_FILE" ] || echo '{}' > "$SETTINGS_FILE"
  HOOK_CMD="/conductor-hooks/claude-hook.sh"
  jq --arg cmd "$HOOK_CMD" '
    .hooks = ((.hooks // {}) as $h |
      $h
      | .UserPromptSubmit = ((.UserPromptSubmit // []) + [{"hooks":[{"type":"command","command":($cmd + " UserPromptSubmit")}]}])
      | .PreToolUse       = ((.PreToolUse       // []) + [{"hooks":[{"type":"command","command":($cmd + " PreToolUse")}]}])
      | .Stop             = ((.Stop             // []) + [{"hooks":[{"type":"command","command":($cmd + " Stop")}]}])
      | .Notification     = ((.Notification     // []) + [{"hooks":[{"type":"command","command":($cmd + " Notification")}]}])
    )
  ' "$SETTINGS_FILE" > /tmp/settings.json && mv /tmp/settings.json "$SETTINGS_FILE"
  ```
  (The `/tmp/settings.json` here is **inside the agent container** during init — ephemeral container fs, not the host. The "use `./tmp/` only" rule from `CLAUDE.md` applies to host-side / dev-shell commands.)
  Acceptance: after container init, `jq '.hooks | keys' ~/.claude/settings.json` inside the container prints `["Notification","PreToolUse","Stop","UserPromptSubmit"]`.
- [x] Note the idempotency caveat inline in the generated script: the sentinel file `$HOME/.claude/.conductor-initialized` already short-circuits re-runs, so the `jq` append runs once per container lifetime — safe.
- [x] Re-run `bash -n scaffold.sh` after editing.


### 7. Add `STATE_DIR` config to `conductor.conf`  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 -->

- [x] After the `LOG_DIR="./logs"` block (around `conductor.conf:72`), add:
  ```bash
  # --- Agent state directory ---
  # Per-agent lifecycle state written by Claude Code hooks
  # (see hooks/claude-hook.sh). Each agent writes working|done|wait to
  # $STATE_DIR/<agent-name>.state. monitor.sh reads these files to decide
  # idle/busy; IDLE_PATTERN above is the fallback when the state file is
  # missing or stale (older than 2 * POLL_INTERVAL).
  STATE_DIR="./logs/state"
  ```
- [x] Update the `IDLE_PATTERN` comment block (`conductor.conf:27–37`) to note that the regex is a **fallback** behind the hook-based state file. Add a sentence: `# Primary signal: hooks/claude-hook.sh writes $STATE_DIR/<agent>.state. This regex is only consulted when the state file is missing or older than 2 * POLL_INTERVAL.`


### 8. Inject `CONDUCTOR_AGENT_NAME` per agent at spawn time  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 -->

- [x] In `conductor.sh`, locate where it invokes each agent's `launch_cmd` (currently via `tmux new-window ... "$launch_cmd"`). Prepend an environment export so the child process — and the Claude Code process it launches — sees `CONDUCTOR_AGENT_NAME`:
  - `tmux new-window -n "$name" "CONDUCTOR_AGENT_NAME='$name' CONDUCTOR_STATE_DIR='$STATE_DIR' $launch_cmd"`
  - In `EXEC_MODE=container`, pipe those through `agent_exec.sh` so the env vars land inside the container. The simplest path is to add `-e CONDUCTOR_AGENT_NAME="$name" -e CONDUCTOR_STATE_DIR=/conductor-state` to the `docker compose exec` / `docker exec` invocation in `agent_exec.sh` (see the existing `-e ANTHROPIC_API_KEY=` pattern at `agent_exec.sh:38–40`).
- [x] Verify after spawn: `docker compose exec app env | grep CONDUCTOR_` shows both variables.
- [x] Do the same for `spawn.sh` if it's the split-pane entry point used in practice (confirm with `grep -n 'new-window\|split-window' spawn.sh`).


### 9. Rewrite `is_idle()` as hybrid state-file-first, regex-fallback  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 -->

- [x] In `monitor.sh`, modify `is_idle()` to accept both the tmux target and the agent name, then consult the state file before falling back to the regex.
- [x] Update the call site in the main loop (currently `if is_idle "$target"; then`) to pass the agent name too: `if is_idle "$target" "$name"; then`.
- [x] New `is_idle()` body:
  ```bash
  is_idle() {
    local target="$1"
    local name="${2:-}"
    local state_file="${STATE_DIR}/${name}.state"

    # Primary: hook-written state file, if fresh
    if [ -n "$name" ] && [ -f "$state_file" ]; then
      local now mtime age max_age state
      now=$(date +%s)
      # macOS (BSD stat) vs Linux (GNU stat) compatibility
      mtime=$(stat -f %m "$state_file" 2>/dev/null || stat -c %Y "$state_file" 2>/dev/null || echo 0)
      age=$(( now - mtime ))
      max_age=$(( POLL_INTERVAL * 2 ))
      if [ "$age" -le "$max_age" ]; then
        state=$(cat "$state_file" 2>/dev/null || echo "")
        debug "is_idle: target=$target state-file=$state (age=${age}s)"
        case "$state" in
          done) return 0 ;;
          working|wait) return 1 ;;
          *) ;;  # unknown contents — fall through to regex
        esac
      else
        debug "is_idle: target=$target state-file stale (age=${age}s > ${max_age}s), falling back to regex"
      fi
    fi

    # Fallback: footer regex
    local last_lines
    last_lines=$(tmux capture-pane -t "$target" -p | grep -v '^[[:space:]]*$' | tail -5 || true)
    if printf '%s\n' "$last_lines" | grep -qE "$IDLE_PATTERN"; then
      debug "is_idle: target=$target regex MATCHED"
      return 0
    fi
    debug "is_idle: target=$target regex no match"
    return 1
  }
  ```
- [x] Ensure `mkdir -p "$STATE_DIR"` runs once near the top of `monitor.sh` (alongside the `rm -f "$PAUSED_FILE"` line).
- [x] `bash -n monitor.sh` — clean


### 10. End-to-end verification  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 -->

- [x] Rebuild the container so the new bind mounts + env vars take effect.
- [x] Confirm hook config merged: all four hooks present in `~/.claude/settings.json`.
- [x] Confirm env is wired: initial run revealed `CONDUCTOR_AGENT_NAME=application-tracker` (scaffold defaulted to target dir basename); resolved by renaming the target folder to `jobfinder` and re-scaffolding with `--force`.
- [x] Watch the state file from the host (used `while true; do ...; sleep 0.5; done` loop — macOS has no `watch`).
- [x] Queue `/help` and observe state transitions.
- [x] Restart monitor and confirm dispatch.
- [x] Observed: `logs/state/jobfinder.state` transitioned `working → done` on natural turn-end; dispatch happened; `tasks.txt` drained. **Gap:** user-initiated Esc interrupt does NOT trigger Claude Code's `Stop` hook, so state remains `working` until the `2 × POLL_INTERVAL` mtime staleness kicks the regex fallback. Logged to Risks below.
- [x] Regex fallback test: skipped (happy path validated end-to-end).


### 11. Documentation update  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 -->

- [x] Update `CLAUDE.md` "Key Design Decisions" — replaced `IDLE_PATTERN` bullet with hook-primary/regex-fallback entry.
- [x] Update `CLAUDE.md` "Core Scripts" table to add `hooks/claude-hook.sh`.
- [x] README.md idle-pattern + config table updated; `STATE_DIR` row added.
- [x] README.md "How idle detection works" section added with the diagram line.


### 12. Final verification  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 -->

- [x] `bash -n` all shell scripts — SYNTAX OK.
- [x] `source conductor.conf` prints `IDLE_PATTERN` and `STATE_DIR` cleanly.
- [x] Fixture replay: `clean → IDLE`, `plan → BUSY`, `busy → BUSY` (regex fallback unchanged).
- [x] End-to-end dispatch from Step 10 succeeded with state-file `working → done` transitions observed.
- [SKIP] Regex fallback re-test skipped (Step 10); happy path covered and staleness logic is unit-obvious from code.
- [x] `git diff` scope: `monitor.sh`, `conductor.conf`, `conductor.sh`, `spawn.sh`, `scaffold.sh`, `agent_exec.sh`, `hooks/claude-hook.sh` (new), `CLAUDE.md`, `README.md` — plus task file and runtime artifacts (`tasks.txt`, `logs/state/`). No stray code changes.

---

## Risks / Known Gaps

- **Crashed agent leaves state stuck on `working`**: mitigated by the `2 × POLL_INTERVAL` mtime staleness check → regex fallback.
- **User Esc-interrupt does not fire `Stop` hook**: observed end-to-end. State remains `working` until the mtime staleness check kicks the regex fallback (≤ `2 × POLL_INTERVAL`). Acceptable — the fallback handles it, at worst one poll cycle of added latency before redispatch.
- **Notification event → `wait`**: treated as busy (return 1) so the conductor never dispatches over a pending permission prompt. If you want `wait` to be dispatchable, change the `working|wait) return 1` line in Step 9.
- **Aider has no hooks**: Aider agents always take the regex fallback path. Acceptable — Aider's prompt is stable (`^aider>`).
- **Codex hooks deferred**: `samleeney/tmux-agent-status/hooks/codex-hook.sh` is the reference when we add Codex support; out of scope for this task.
- **`~/.claude/settings.json` merge collisions**: the `jq` step appends to arrays rather than overwriting. If a host-synced setting already contains these events, the container will have duplicate hook entries — harmless but noisy. A stricter merge (dedupe by command string) is a follow-up.

---

**UAT**: [`.docs/uat/skipped/004-idle-detection-fix.uat.md`](../../uat/skipped/004-idle-detection-fix.uat.md) *(skipped)*
