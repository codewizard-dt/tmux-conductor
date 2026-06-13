# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

tmux-conductor is a vendor-agnostic system for orchestrating multiple AI coding agent instances (Claude Code, OpenAI Codex, Aider, etc.) from a single tmux session. Each agent runs directly in its own tmux window on the host (no Docker, no containers). The conductor spawns agents, detects when each finishes a task via per-agent state files written by Claude Code lifecycle hooks (with a `capture-pane` regex fallback), dispatches the next command from a task queue, monitors usage limits, and tears everything down cleanly. A real-time Astro+React dashboard backed by a Fastify server provides live agent status and queue management.

**Current state:** Core implementation complete — orchestration scripts, Claude Code hooks, Fastify dashboard backend, and Astro+React dashboard UI are all implemented and wired together via `BG_PROCESSES` in `conductor.conf`.

## Architecture

- **Agent panes** (0..N-1): each runs a coding CLI in its own tmux window
- **Conductor pane** (last window): runs `monitor.sh`, polling agent panes via `capture-pane` to detect idle state
- Communication is one-way push: conductor uses `send-keys` to dispatch commands and `capture-pane` to read output
- All config lives in `conductor.conf` — agent definitions, idle patterns, usage checks, task queue path

### Core Scripts

See [`scripts/README.md`](scripts/README.md) for per-script usage details and an architecture flowchart.

All scripts below live in `scripts/` except `install-hooks.sh` (repo root).

| Script | Purpose |
|--------|---------|
| `conductor.sh` | Entry point: creates tmux session, spawns agent windows, starts monitor. Also spawns one tmux window per `BG_PROCESSES` entry (host-side, no container wrapping) |
| `spawn.sh` | Alternative: split-pane layout instead of separate windows. Also splits a pane per `BG_PROCESSES` entry (host-side, no container wrapping) |
| `dispatch.sh` | Sends a command to a specific agent pane via `send-keys -l` + separate `Enter` |
| `monitor.sh` | Main loop: polls for idle agents, checks usage limits, pops tasks from queue |
| `broadcast.sh` | Sends a command to all agent panes |
| `teardown.sh` | Graceful shutdown: sends `/exit` to each agent, waits, kills session |
| `scripts/add-task.sh` | Appends a scoped task entry to `tasks.txt` using the caller's CWD name as agent name |
| `backend/index.ts` | Fastify backend on port 8788 — `GET /status`, `GET /agents`, `GET\|POST /queue/:agent`, `DELETE /queue/:agent/:index`, `PUT /queue/:agent/reorder`, `GET /agents/:agent/tail`, `POST /agents/:agent/keys` (direct keystroke/text input to the pane, bypassing the queue — powers the dashboard's Interact mode), `POST /agents/:agent/upload` (raw image bytes; saves to `./tmp/dashboard-drops/` and types the saved path into the pane — powers dashboard image drag-drop/paste, mirroring a file drop onto a real terminal), `GET /events` (SSE) |
| `frontend/` | Astro+React single-page app on port 4321 — real-time accordion agent list, queue editor, status indicators |
| `hooks/on-session-start.js` | Claude Code hook (Node.js) — writes `idle` to `$STATE_DIR/<agent>.state` on SessionStart (matcher `startup|resume|clear`) |
| `hooks/on-prompt-submit.js` | Claude Code hook (Node.js) — writes `busy` to `$STATE_DIR/<agent>.state` on UserPromptSubmit |
| `hooks/on-stop.js` | Claude Code hook (Node.js) — writes `idle` to `$STATE_DIR/<agent>.state` on Stop |
| `hooks/on-stop-failure.js` | Claude Code hook (Node.js) — writes `idle` to `$STATE_DIR/<agent>.state` on StopFailure (API error) |
| `install-hooks.sh` (repo root) | Copies JS hook scripts plus `hooks/lib/write-state.js` into `~/.claude/hooks/tmux-conductor/` and merge-registers them in `~/.claude/settings.json` with dedup-by-command (preserves foreign hook entries; also prunes stale `.sh` registrations from prior installs) |
| `$LOG_DIR/dispatch.jsonl` | Verbose dispatch log (host). One JSONL record per dispatch: `ts`, `agent`, `command`, `state`, `state_age_s`, `detection`, `queue`, `queue_remaining`, `pane_tail` |
| `$CONDUCTOR_LOG_DIR/hooks.jsonl` | Hook transition log. One JSONL record per hook event: `ts`, `agent`, `event`, `prev_state`, `new_state` |

### Key Design Decisions

- `send-keys -l` (literal mode) for dispatch — preserves special characters in prompts
- `Enter` is always a separate `send-keys` argument, never embedded in the string
- `sed -i.bak` + cleanup for BSD/GNU sed compatibility (macOS ships BSD sed)
- Idle detection primary signal is the per-agent state file at `$STATE_DIR/<agent>.state`. Two values: `idle` (hook-written by `on-session-start.js` on startup/resume/clear, `on-stop.js` on Stop, and `on-stop-failure.js` on StopFailure) and `busy` (hook-written by `on-prompt-submit.js` on UserPromptSubmit, and monitor-written by `mark_busy` immediately before dispatch to close the race between send-keys and the agent's first UserPromptSubmit hook fire). Monitor treats `idle` as idle and `busy` as working; any other contents fall through to the regex fallback. Each Claude Code lifecycle event has its own Node.js script in `hooks/` (on-session-start.js, on-prompt-submit.js, on-stop.js, on-stop-failure.js), sharing stdlib-only logic via `hooks/lib/write-state.js` (resolves agent name, drains stdin, writes the state file). `install-hooks.sh` at the repo root copies the JS hooks plus `hooks/lib/write-state.js` to `~/.claude/hooks/tmux-conductor/` and merges the registrations into `~/.claude/settings.json` with dedup-by-command so foreign hook entries survive.
- State files do NOT expire by age: an idle agent's file is naturally old because nothing rewrites it while the agent waits. Instead, both `monitor.sh` and the backend first check pane liveness via `tmux display -p '#{pane_current_command}'` — a pane showing a plain shell (zsh/bash/…) while the agent's launch command isn't a shell means the agent exited (`exited` status; never dispatch into it). A fresh `idle` is overridden to busy if the pane matches `BUSY_PATTERN` ("esc to interrupt"). A `busy` file older than `2 × POLL_INTERVAL` whose pane matches `IDLE_PATTERN` but not `BUSY_PATTERN` is recovered to `idle` (covers a missed Stop hook). If the state file is missing, the regex fallback runs: `BUSY_PATTERN` wins over `IDLE_PATTERN` (current Claude Code keeps the permission-mode footer visible while working) — this covers Aider, Codex, and Claude-without-hooks
- Waiting/stalled detection: `AWAITING_PATTERN` matches the last non-blank pane line against classic prompts (`?`, `[Y/n]`, trailing `>`) and Claude Code dialog footers ("Enter to select …", "Esc to cancel" — AskUserQuestion / plan approval). The pattern is case-sensitive by design: the busy spinner's lowercase "esc to interrupt" must not match. `monitor.sh` writes `awaiting` to the state file on match (and reverts to `busy` when the dialog disappears); the backend's `detectAgentStatus` also evaluates the pattern read-only every 2s so the dashboard flags a waiting agent immediately (badge label "waiting"). A `busy` state file older than `2 × POLL_INTERVAL` whose pane matches none of BUSY/IDLE/AWAITING patterns is reported as `stalled` (backend-only, derived, never written to the state file). Both waiting and stalled agents surface a prominent Interact CTA in the dashboard; `getActiveTask` keeps showing the active task for `busy`/`awaiting`/`stalled`.
- `backend/config.ts` reads the repo-root `conductor.conf` (single source of truth, overridable via `CONDUCTOR_CONF`) and resolves relative conf paths (`./tasks.txt`, `./logs/state`) against the conf file's directory. Agent spawns (backend, `conductor.sh`, `spawn.sh`) pass absolute `CONDUCTOR_STATE_DIR` and `CONDUCTOR_LOG_DIR` so hooks write where the monitor and backend read, regardless of the agent's workdir
- `BG_PROCESSES` entries are host-side windows spawned alongside agents but are not monitored for idle, never receive queue dispatches, and are terminated via `C-c` during teardown. Parsed with the same `name:workdir:cmd` format as `AGENTS` but without `CONDUCTOR_AGENT_NAME` env.
- `POLL_INTERVAL` acts as debounce to avoid false positives during agent tool calls
- Usage monitoring runs before every dispatch; when all agents hit limits, auto-teardown triggers
- Task queue supports agent-scoped entries via `agentname: command` prefix — `pop_task()` matches scoped lines first, then falls back to unscoped (global) lines
- Verbose dispatch logging is enabled by default. `monitor.sh` appends one JSONL record to `$LOG_DIR/dispatch.jsonl` for every dispatch (fields: `ts`, `agent`, `command`, `state`, `state_age_s`, `detection`, `queue`, `queue_remaining`, `pane_tail`). The hook scripts (`on-stop.js`, etc.) append one JSONL record to `$CONDUCTOR_LOG_DIR/hooks.jsonl` for every state transition (fields: `ts`, `agent`, `event`, `prev_state`, `new_state`). `LOG_DIR` is configurable in `conductor.conf`; `CONDUCTOR_LOG_DIR` defaults to `./logs` and can be overridden per-agent via env.

## Prerequisites

- tmux >= 3.0
- bash >= 4.0 (macOS default is 3.2 — use `brew install bash` or adapt for indexed arrays)
- Node.js >= 18 (for the dashboard server and Claude Code hooks)
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
