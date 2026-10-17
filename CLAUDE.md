**IMPORTANT**
- You are never allowed to read or write to any `.env` file. The only exception is `.env.example`.
- You are, however, allowed to source an `.env` file to use the variables in the command line.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

tmux-conductor is a vendor-agnostic system for orchestrating multiple AI coding agent instances (Claude Code, OpenAI Codex, Aider, etc.) from a single tmux session. Each agent runs directly in its own tmux window on the host (no Docker, no containers). The conductor spawns agents, detects when each finishes a task via per-agent state files written by Claude Code lifecycle hooks (with a `capture-pane` regex fallback), dispatches the next command from a task queue, monitors usage limits, and tears everything down cleanly. A real-time React SPA dashboard backed by a Fastify server provides live agent status and queue management.

**Current state:** Core implementation complete — orchestration scripts, Claude Code hooks, the Fastify host-server, and the React dashboard UI are all implemented. Conductor operational data (agents, bg processes, projects, task queue, schedules) lives in SQLite (`./data/conductor.db` via `better-sqlite3`); `conductor.conf` holds tuning settings only.

### Code layout

The system is fully local and single-user — two runnable pieces, no daemon, no Docker, no deployment, no auth.

- **`host-server/`** — the native tmux conductor: Fastify on port **8788** (env `BACKEND_PORT`), `better-sqlite3`, the monitor/dispatch logic. Runs **directly on the host**. Serves the conductor API consumed by the dashboard.
- **`frontend/`** — Vite React SPA on port **4321** (env `FRONTEND_PORT`). Talks directly to the host-server through the Vite dev proxy: all `/api/*` requests are proxied to `:8788` (env `PROXY_TARGET`, or `VITE_API_URL` to point the frontend at a different base).
- **Run both natively:** `make dev` starts the host-server and the frontend through the root `concurrently` script. `Ctrl-C` stops both dev servers; `make ports` prints the URLs.
- **Config:** root `.env` / `.env.example` carries the ports and proxy target; `conductor.conf` remains host-server tuning only.

## Architecture

- **Agent panes** (0..N-1): each runs a coding CLI in its own tmux window
- **Conductor pane** (last window): runs `monitor.sh`, polling agent panes via `capture-pane` to detect idle state
- Communication is one-way push: conductor uses `send-keys` to dispatch commands and `capture-pane` to read output
- **Config vs data split:** `conductor.conf` holds only tuning settings (poll interval, idle/busy/awaiting patterns, usage checks, `DB_PATH`). All operational data — agents, bg processes, projects, the task queue, and schedules — lives in the SQLite database at `DB_PATH` (default `./data/conductor.db`)

### Core Scripts

See [`scripts/README.md`](scripts/README.md) for per-script usage details and an architecture flowchart.

All scripts below live in `scripts/` except `install-hooks.sh` (repo root).

| Script | Purpose |
|--------|---------|
| `conductor.sh` | Entry point: creates tmux session, loads agents and bg processes from SQLite, spawns agent windows, starts monitor. Also spawns one tmux window per bg process (host-side, no container wrapping) |
| `spawn.sh` | Alternative: split-pane layout instead of separate windows. Loads the same SQLite data but lays agents out with `split-window` instead of separate windows. Also splits a pane per bg process (host-side, no container wrapping) |
| `dispatch.sh` | Sends a command to a specific agent pane via `send-keys -l` + separate `Enter` |
| `monitor.sh` | Main loop: polls for idle agents, checks usage limits, pops tasks from queue |
| `broadcast.sh` | Sends a command to all agent panes |
| `teardown.sh` | Graceful shutdown: sends `/exit` to each agent, waits, kills session |
| `scripts/add-task.sh` | Writes a scoped task entry to the SQLite DB using the caller's CWD name as agent name |
| `host-server/index.ts` | Fastify host-server on port 8788 — `GET /status`, `GET /agents`, `GET /agents/whoami` (read-only: resolves the self-declared `X-Conductor-Agent` header to the caller's agent/project for the dev-commands skill; always 200 with `kind: agent|human|unknown|ambiguous`), `GET\|POST /queue/:agent`, `DELETE /queue/:agent/:index`, `PUT /queue/:agent/reorder`, `GET /agents/:agent/tail`, `POST /agents/:agent/keys` (direct keystroke/text input to the pane, bypassing the queue — powers the dashboard's Interact mode), `POST /agents/:agent/upload` (raw image bytes; saves to `./tmp/dashboard-drops/` and types the saved path into the pane — powers dashboard image drag-drop/paste, mirroring a file drop onto a real terminal), `GET /skills` (user + plugin skills), `GET /agents/:agent/skills` (project + user skills for an agent's workdir), `GET /bg-processes/:slug/tail?lines=N[&format=text]` (ANSI-stripped, bounded tail of `bg-<slug>.log`; `format=text` returns `text/plain`; all `/bg-processes/:slug` routes — tail, PATCH, DELETE, `/window`, `/restart` — key by the derived slug, not the bare name), `POST /bg-processes/:slug/restart` (atomic stop+start via `bgRestart.ts`: `respawn-window -k`, keeps/re-attaches `pipe-pane` log capture, appends a `--- restart <ts> ---` marker to `bg-<slug>.log`; same-project guard (TASK-0194, `bgAccess.ts`): the `X-Conductor-Agent` header is resolved server-side to an agent's project and a mismatched, unscoped, unknown or ambiguous agent caller gets `403` before the session check and cooldown, while header-less dashboard callers are allowed; not a security boundary), `GET /events` (SSE) |
| `frontend/` | Vite React single-page app on port 4321 — real-time accordion agent list, queue editor, status indicators |
| `hooks/on-session-start.js` | Claude Code hook (Node.js) — writes `idle` to `$STATE_DIR/<agent>.state` on SessionStart (matcher `startup|resume|clear`) |
| `hooks/on-prompt-submit.js` | Claude Code hook (Node.js) — writes `busy` to `$STATE_DIR/<agent>.state` on UserPromptSubmit, and persists the submitted prompt as `last_prompt: { text, ts }` in the `$STATE_DIR/<agent>.meta.json` sidecar; the host-server exposes it as `lastPrompt: { text, ts } \| null` on the agent snapshot (REST + SSE), and the dashboard mirrors it into per-agent `localStorage` and shows it in place of `activeTask` in the detail-pane strip and sidebar card (`activeTask` stays in the API). Verify with `bash scripts/verify-last-payload.sh` |
| `hooks/on-stop.js` | Claude Code hook (Node.js) — writes `idle` to `$STATE_DIR/<agent>.state` on Stop |
| `hooks/on-stop-failure.js` | Claude Code hook (Node.js) — writes `idle` to `$STATE_DIR/<agent>.state` on StopFailure (API error) |
| `install-hooks.sh` (repo root) | Copies JS hook scripts plus `hooks/lib/write-state.js` into `~/.claude/hooks/tmux-conductor/` and merge-registers them in `~/.claude/settings.json` with dedup-by-command (preserves foreign hook entries; also prunes stale `.sh` registrations from prior installs) |
| `$LOG_DIR/dispatch.jsonl` | Verbose dispatch log (host). One JSONL record per dispatch: `ts`, `agent`, `command`, `state`, `state_age_s`, `detection`, `queue`, `queue_remaining`, `pane_tail` |
| `$CONDUCTOR_LOG_DIR/hooks.jsonl` | Hook transition log. One JSONL record per hook event: `ts`, `agent`, `event`, `prev_state`, `new_state` |
| `$LOG_DIR/transitions.jsonl` | Unified transition log. One JSONL record per detected agent status transition, emitted from both the host-server's `pollAndDiff` (fields: `ts`, `agentId`, `agent`, `from`, `to`, `reason`, `matchedPattern`, `stateFileAgeS`, `windowPresent`, `queuedTasks`, `paneTail`) and `monitor.sh`'s poll loop (fields: `ts`, `agent`, `from`, `to`, `reason`, `stateFileAgeS`, `paneTail`) |
| `$LOG_DIR/bg-restarts.jsonl` | Bg-process restart audit log (TASK-0193). One JSONL record per `POST /bg-processes/:slug/restart` attempt: `ts`, `bg` (slug), `callerKind` (`agent`\|`dashboard`), `caller` (raw `X-Conductor-Agent` header value or null), `outcome` (`restarted`\|`cooldown`\|`failed`\|`denied`), plus when applicable `cooldownRemainingS`, `mechanism` (`respawn-window`\|`new-window`), `step`, `status`, `reason` (on `denied`: `project-mismatch`\|`unknown-caller`\|`ambiguous-caller`\|`unscoped`, TASK-0194). Callers identify themselves with `X-Conductor-Agent: <tmux window/agent name>` (trimmed, capped at 128 chars); a header-less caller is logged as `dashboard` and exempt from the `BG_RESTART_COOLDOWN_S` cooldown. This is a runaway-loop guardrail, NOT authentication (no auth on the localhost host-server). No rotation |

### Key Design Decisions

- `send-keys -l` (literal mode) for dispatch — preserves special characters in prompts
- `Enter` is always a separate `send-keys` argument, never embedded in the string
- `sed -i.bak` + cleanup for BSD/GNU sed compatibility (macOS ships BSD sed)
- Idle detection primary signal is the per-agent state file at `$STATE_DIR/<agent>.state`. Two values: `idle` (hook-written by `on-session-start.js` on startup/resume/clear, `on-stop.js` on Stop, and `on-stop-failure.js` on StopFailure) and `busy` (hook-written by `on-prompt-submit.js` on UserPromptSubmit, and monitor-written by `mark_busy` immediately before dispatch to close the race between send-keys and the agent's first UserPromptSubmit hook fire). Monitor treats `idle` as idle and `busy` as working; any other contents fall through to the regex fallback. Each Claude Code lifecycle event has its own Node.js script in `hooks/` (on-session-start.js, on-prompt-submit.js, on-stop.js, on-stop-failure.js), sharing stdlib-only logic via `hooks/lib/write-state.js` (resolves agent name, drains stdin, writes the state file). `install-hooks.sh` at the repo root copies the JS hooks plus `hooks/lib/write-state.js` to `~/.claude/hooks/tmux-conductor/` and merges the registrations into `~/.claude/settings.json` with dedup-by-command so foreign hook entries survive.
- State files do NOT expire by age: an idle agent's file is naturally old because nothing rewrites it while the agent waits. Instead, both `monitor.sh` and the host-server first check pane liveness via `tmux display -p '#{pane_current_command}'` — a pane showing a plain shell (zsh/bash/…) while the agent's launch command isn't a shell means the agent exited (`exited` status; never dispatch into it). A fresh `idle` is overridden to busy if the pane matches `BUSY_PATTERN` ("esc to interrupt"). A `busy` file older than `2 × POLL_INTERVAL` whose pane matches `IDLE_PATTERN` but not `BUSY_PATTERN` is recovered to `idle` (covers a missed Stop hook). If the state file is missing, the regex fallback runs: `BUSY_PATTERN` wins over `IDLE_PATTERN` (current Claude Code keeps the permission-mode footer visible while working) — this covers Aider, Codex, and Claude-without-hooks
- Background-agent sentinel (BUG-0001): the idle/busy state file above can read `idle` while the agent is still genuinely occupied waiting on a background sub-agent it spawned (Claude Code's `Stop` hook fires — and writes `idle` — before that background work resolves). `hooks/on-notification.js` tracks outstanding background agents separately as sentinel files under `$STATE_DIR/<agent>.pending-agents/`, and `host-server/pendingAgents.ts`'s `hasPendingBackgroundAgents()` gates both dispatch call sites on that directory being empty of fresh (non-stale) sentinels. See `hooks/README.md` for the full mechanism. A second, independent signal (`TASK-0184`) covers status *display* rather than dispatch gating: `host-server/backgroundJobs.ts`'s `hasActiveBackgroundJob()` correlates an agent's transcript `continued-in` records to `~/.claude/jobs/<id>/state.json` and, via `state.ts`'s `detectAgentStatusWithBackgroundJobs()` wrapper, upgrades an `idle` read to `busy` when a job is still `working`/`blocked`. It exists alongside the Notification-hook sentinel — not as a replacement — because it polls Claude Code's own job state directly and so does not depend on `agent_needs_input` ever firing, the gap the sentinel alone cannot cover.
- Waiting/stalled detection: `AWAITING_PATTERN` is matched against the last 8 non-blank pane lines (the window), after dropping Claude Code `❯ <typed draft>` input lines (regex `^\s*❯\s+\S`, so a half-typed `❯ …?` draft is not a prompt), for classic prompts (`?`, `[Y/n]`, a bare prompt line that is only `>`, i.e. `^\s*>\s*$` — HTML comments or `❯ /research <topic…>` placeholders that merely end in `>` do not match) and Claude Code dialog footers ("Enter to select …", "Esc to cancel" — AskUserQuestion / plan approval). The pattern is case-sensitive by design: the busy spinner's lowercase "esc to interrupt" must not match. For non-Codex agents the `?`/`>` heuristics are ignored — and an `awaiting` state file is reported/reverted as busy — while `BUSY_PATTERN` ("esc to interrupt") is visible in the last 15 non-blank lines (BUG-0013 busy guard); Codex is exempt because its busy pattern is broad and can match scrollback while a real confirm dialog is open. Both implementations (`monitor.sh` `awaiting_window`/`busy_visible`, `host-server/state.ts` `awaitingWindow` plus the guard in the `awaiting` branch) share the fixture set `host-server/fixtures/awaiting-panes/manifest.json` (checked by `state.test.ts` and `scripts/verify-awaiting-detection.sh`). `monitor.sh` writes `awaiting` to the state file on match (and reverts to `busy` when the dialog disappears); the host-server's `detectAgentStatus` also evaluates the pattern read-only every 2s so the dashboard flags a waiting agent immediately (badge label "waiting"). A `busy` state file older than `2 × POLL_INTERVAL` whose pane matches none of BUSY/IDLE/AWAITING patterns is reported as `stalled` (host-server-only, derived, never written to the state file). Both waiting and stalled agents surface a prominent Interact CTA in the dashboard; `getActiveTask` keeps showing the active task for `busy`/`awaiting`/`stalled`.
- `host-server/config.ts` reads the repo-root `conductor.conf` (overridable via `CONDUCTOR_CONF`) for **tuning settings only** (poll interval, detection patterns, usage checks, `DB_PATH`). It resolves `DB_PATH` and `./logs/state` relative to the conf file's directory. All data queries (agents, queue, bg processes, projects, schedules) go through `host-server/db.ts`. Agent spawns (host-server, `conductor.sh`, `spawn.sh`) pass absolute `CONDUCTOR_STATE_DIR` and `CONDUCTOR_LOG_DIR` so hooks write where the monitor and host-server read, regardless of the agent's workdir
- Background processes are stored in the SQLite `bg_processes` table (not the `conductor.conf` `BG_PROCESSES` array). They are still spawned as host-side tmux windows alongside agents, are not monitored for idle, never receive queue dispatches, and are terminated via `C-c` during teardown. `conductor.sh`/`spawn.sh` load them from the DB via `load_bg_processes()`. Format in the DB: `name`, `workdir`, `cmd` columns. Names are unique **per project** (`(project_id, name)`), so a process's addressable identity is the derived slug `<projectName>-<name>` (bare `name` if the row has no project, only possible in the deferred-nullable migration state). The slug is the tmux window name and the stem of `$LOG_DIR/bg-<slug>.log` / `$STATE_DIR/bg-<slug>.state`; `scripts/lib/db.sh` `load_bg` emits slugs, so `BG_NAMES` is keyed by slug. The bg-to-agent link is retired (TASK-0197): no `linkedAgent` API/status fields, no `CONDUCTOR_BG_NAME`/`LOG`/`STATE` env injection, no `AGENT_BG_LINKS` conf key; `project_id` is the sole access boundary and the project-scoped `dev-commands` skill is the agent interface. The `bg_processes.linked_agent_id` column was dropped in schema v12 (TASK-0198). A stale `linkedAgent`/`linkedAgentId` in a `POST`/`PATCH /bg-processes` body is ignored. Legacy `bg-<name>.log|state` files from before per-project uniqueness are left in place and ignored (delete by hand). See `wiki/knowledge/concepts/background-process-registry.md`.
- `POLL_INTERVAL` acts as debounce to avoid false positives during agent tool calls
- Usage monitoring runs before every dispatch; when all agents hit limits, auto-teardown triggers
- Task queue is SQL-backed (`tasks` table in SQLite). Agent scoping is via a foreign key to the `agents` table; `pop_task_sql()` selects scoped rows first, then global rows — replacing the old `agentname: command` plain-text prefix convention.
- Verbose dispatch logging is enabled by default. `monitor.sh` appends one JSONL record to `$LOG_DIR/dispatch.jsonl` for every dispatch (fields: `ts`, `agent`, `command`, `state`, `state_age_s`, `detection`, `queue`, `queue_remaining`, `pane_tail`). Task pops are SQL DELETEs against the `tasks` table; `queue_remaining` reflects the SQL row count after the pop. The hook scripts (`on-stop.js`, etc.) append one JSONL record to `$CONDUCTOR_LOG_DIR/hooks.jsonl` for every state transition (fields: `ts`, `agent`, `event`, `prev_state`, `new_state`). `LOG_DIR` is configurable in `conductor.conf`; `CONDUCTOR_LOG_DIR` defaults to `./logs` and can be overridden per-agent via env.
- Unified transition observability (ROADMAP-019): every agent status transition, from both detection paths, lands as one JSONL record in `$LOG_DIR/transitions.jsonl` — emitted from the host-server's `pollAndDiff` (hook-based signal; fields `ts`, `agentId`, `agent`, `from`, `to`, `reason`, `matchedPattern`, `stateFileAgeS`, `windowPresent`, `queuedTasks`, `paneTail`) and mirrored from `monitor.sh`'s `is_idle()` poll loop (regex-fallback signal; fields `ts`, `agent`, `from`, `to`, `reason`, `stateFileAgeS`, `paneTail`), so downstream analysis gets a single stream regardless of which detector fired.

## Prerequisites

- tmux >= 3.0
- bash >= 4.0 (macOS default is 3.2 — use `brew install bash` or adapt for indexed arrays)
- Node.js >= 18 (for the host-server and Claude Code hooks; CI runs Node 22)
- Optional: `jq` for JSON config parsing

## Task/Doc Workflow

This repo uses a structured task lifecycle under `.docs/`:
- Tasks go in `.docs/tasks/` with `<NNN>-<slug>.md` naming
- UAT files go in `.docs/uat/` with `<NNN>-<slug>.uat.md` naming
- Slash commands: `/add-task`, `/tackle`, `/uat-generator`, `/uat-walkthrough`, `/uat-skip`, `/trash-task`
- `/tackle` does not move task files — they stay in `active/` until UAT passes

## Shell Command Conventions

- Use plain `git log ...` and `git status ...` — never prefix with `git -C <path>`. The repo's allowlist matches `Bash(git log:*)` and `Bash(git status:*)`; adding `-C /abs/path` triggers an approval prompt every time. Rely on the working directory instead.
- **Temporary files / scratch directories on the host: ALWAYS use `./tmp/` (the repo-local `tmp/` directory). Non-negotiable, mandatory.** Never use `/tmp/`, `$TMPDIR`, `mktemp -d`, or any other system-level temp location for host-side work. `./tmp/` is gitignored, lives next to your work, and keeps fixtures/captures inspectable. **Scope:** this rule applies only to commands run on the host (your dev shell, sub-agents acting on the host, scripts executed from the project root). Inside a dev container or any generated container-init script, follow normal Unix conventions — `/tmp` there is the container's ephemeral filesystem and is the right choice.

## Agent Dispatch Convention

- This machine has agent teams enabled (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `~/.claude/settings.json`). See `~/.claude/rules/agent-teams-preference.md` (global, loads unconditionally) for the convention it drives: always pass an explicit, descriptive `name` to every `Agent(...)` call made for parallel work, so it renders as a persistent teammate row instead of a subagent row that clears the instant it finishes.
- Background: `raw/research/subagent-panel-visibility/index.md` in this repo.

## MCP Tool Rules

When MCP tools are available, follow `.docs/guides/mcp-tools.md`:
- Use Serena for all code exploration and editing, directory listing, and file search
- Use Context7 for library/framework documentation lookups
- Use Brave Search for general web research (sequential only, 1 req/sec)
- Standard `Read`/`Edit`/`Write` tools are permitted for markdown and config files
- Never use `sed`, `awk`, `echo >>`, or shell commands to edit any file

---

## LLM Wiki

This project maintains a three-layer LLM Wiki. This section is the **schema** — it tells you how the wiki is structured and what rules govern it.

```
raw/          Immutable ground-truth sources. Read them; NEVER modify, move, or delete them.
wiki/         LLM-maintained knowledge base. You own this layer entirely.
CLAUDE.md     This schema section.
```

### Two domains with opposite organizing laws

**`wiki/knowledge/`** — timeless synthesis, organized by links not status. Pages are revised in place as understanding evolves; no `status` field.

- `wiki/knowledge/sources/` — one summary page per ingested `raw/` source
- `wiki/knowledge/concepts/` — patterns, ideas, conventions, recurring themes
- `wiki/knowledge/entities/{people,organisations,tools,components}/` — one page per entity, filed by sub-type

**`wiki/work/`** — stateful lifecycle artifacts, organized by status. Files are **never moved** after creation; state lives in the `status:` frontmatter field. Each family has a `lifecycle.md` (schema + valid transitions) and an `index.md` listing **only active items** — when an item leaves the active set, delete its line from the family index; the file itself stays put forever.

- `wiki/work/requirements/` — REQ-NNN
- `wiki/work/decisions/` — DEC-NNNN (per-decision `#DM`)
- `wiki/work/roadmaps/` — ROADMAP-NNN
- `wiki/work/tasks/` — TASK-NNN
- `wiki/work/uat/` — UAT-NNN (own family, one per task)
- `wiki/work/bugs/` — BUG-NNNN

**Navigation:** `wiki/index.md` is the home Map of Content — read it first on every wiki query. Knowledge pages are listed there individually; work items live only in their family index. `wiki/log.md` is the append-only operation log. `wiki/conventions.md` holds the page rules (atomic pages, stable IDs/aliases, typed links, frontmatter namespace).

### Wiki operations

| Command | Purpose |
|---------|---------|
| `/wiki-ingest <raw-file>` | Process a source from `raw/` into the wiki — summary page, entity/concept updates, index + log entries |
| `/wiki-query <question>` | Answer from the wiki with citations; offer to file valuable synthesis back as a new page |
| `/wiki-lint` | Health-check — contradictions, orphan pages, stale claims, index drift, never-ingested raw sources |

### CRITICAL wiki rules

1. `raw/` is immutable — never create, modify, move, or delete files under `raw/`
2. Cross-link aggressively — related pages link to each other with relative markdown links; the link network is as valuable as the pages
3. Index and log updates are mandatory — every ingest and filed answer updates `wiki/index.md` + `wiki/log.md`; every work-item create or status flip updates the family `index.md` + `wiki/log.md`
4. Flag contradictions explicitly — when a new source conflicts with an existing page, add a `> **Contradiction:**` callout citing both; never silently overwrite
5. Answer from the wiki, not general knowledge — if the wiki lacks coverage, say so and suggest `/wiki-ingest` for relevant sources
6. Atomic pages — one concept, entity, or artifact per file; split a page rather than let it cover two things
7. Typed links — when a link has a meaning, annotate it inline as `rel::[[target]]` (e.g. `implements::[[REQ-012]]`, `supersedes::[[DEC-0003#D2]]`); keep the two domains separate — never file a stateful artifact under `knowledge/` or a timeless synthesis under `work/`
