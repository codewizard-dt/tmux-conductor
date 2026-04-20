# 014 — Scripts README with Architecture Flowchart

<!-- Updated: 2026-04-19 -->


## Objective

Create `scripts/README.md` with a usage-focused paragraph for each of the nine orchestration scripts and a single combined mermaid flowchart that shows both script call relationships and the task lifecycle (including hook scripts writing state files).

## Approach

Write one new file, `scripts/README.md`, containing: (1) a short intro, (2) one section per script in `scripts/` with purpose, invocation, and key env vars, and (3) a single ```mermaid``` fenced flowchart grouped into three subgraphs — Setup/Entry, Orchestration loop, and Task lifecycle (including `hooks/*.js` writing `$STATE_DIR/<agent>.state`). Cross-link from the `CLAUDE.md` Core Scripts section and add the task to `.docs/tasks/README.md`.

## Prerequisites

- [x] Task 013 (Scripts Folder + add-task) completed — all scripts live in `scripts/`

---

## Steps

### 1. Verify script inventory and invocation surfaces  <!-- agent: general-purpose -->

Before drafting prose, confirm each script's current shape so the README matches reality.

- [x] Use Serena `list_dir` on `scripts/` and confirm exactly these nine files exist:
  `conductor.sh`, `spawn.sh`, `monitor.sh`, `dispatch.sh`, `broadcast.sh`, `teardown.sh`, `agent_exec.sh`, `scaffold.sh`, `add-task.sh`
- [x] Read the first 20 lines of each script and note: usage line (if present), positional args, env vars read from `conductor.conf`, and any sibling-script invocations (`"$SCRIPT_DIR/<other>.sh"`). This determines what each README section and each flowchart edge says.
- [x] Confirm `conductor.conf` keys currently in use: `SESSION_NAME`, `AGENTS`, `TASK_QUEUE`, `TASK_CMD`, `STATE_DIR`, `LOG_DIR`, `POLL_INTERVAL`, `IDLE_PATTERN`, `USAGE_CHECK_CMD`, `EXEC_MODE`, `COMPOSE_SERVICE`.

### 2. Draft the combined mermaid flowchart  <!-- agent: general-purpose -->

The flowchart is the centerpiece — draft it first so the prose can reference it. Use a single `flowchart TD` block with three subgraphs. Validate the block parses by pasting into any mermaid renderer (e.g. https://mermaid.live) before committing.

- [x] Use GitHub-native fenced mermaid syntax:
  ````markdown
  ```mermaid
  flowchart TD
    ...
  ```
  ````
- [x] Flowchart structure (implement exactly — node labels are illustrative but the edges are load-bearing):

  ```mermaid
  flowchart TD
    %% ── Setup / Entry ────────────────────────────────────────────
    subgraph Setup["Setup / Entry"]
      User([User])
      Scaffold["scaffold.sh<br/>(target project setup)"]
      Compose[(conductor-compose.yml<br/>+ devcontainer.json)]
      Conductor["conductor.sh<br/>(tmux session + windows)"]
      Spawn["spawn.sh<br/>(alt: split-pane layout)"]
      AgentExec["agent_exec.sh<br/>(container exec wrapper)"]
    end

    %% ── Orchestration loop ───────────────────────────────────────
    subgraph Loop["Orchestration loop"]
      Monitor["monitor.sh<br/>(poll · is_idle · pop_task · dispatch)"]
      Dispatch["dispatch.sh<br/>(send-keys -l + Enter)"]
      Broadcast["broadcast.sh<br/>(fan-out to all agents)"]
      Teardown["teardown.sh<br/>(/exit + kill-session)"]
    end

    %% ── Task lifecycle ───────────────────────────────────────────
    subgraph Life["Task lifecycle"]
      AddTask["add-task.sh<br/>(appends scoped line)"]
      Queue[(tasks.txt)]
      Pane["agent pane<br/>(Claude Code / Codex / Aider)"]
      PromptHook["on-prompt-submit.js"]
      StopHook["on-stop.js / on-stop-failure.js"]
      SessionHook["on-session-start.js"]
      State[("$STATE_DIR/&lt;agent&gt;.state<br/>idle | busy")]
    end

    %% Edges — Setup
    User -->|"one-time per project"| Scaffold
    Scaffold --> Compose
    User -->|"start session"| Conductor
    User -.->|"alt layout"| Spawn
    Conductor -->|"EXEC_MODE=container"| AgentExec
    Spawn -->|"EXEC_MODE=container"| AgentExec
    AgentExec --> Pane
    Conductor --> Pane
    Spawn --> Pane
    Conductor -->|"launches monitor window"| Monitor

    %% Edges — Loop
    Monitor -->|"send next command"| Dispatch
    Dispatch --> Pane
    Broadcast --> Dispatch
    Monitor -->|"all agents idle + usage hit"| Teardown
    Teardown --> Dispatch
    Teardown -->|"kill-session"| Pane

    %% Edges — Lifecycle
    User -->|"enqueue"| AddTask
    AddTask -->|"append agent: cmd"| Queue
    Monitor -->|"pop_task (scoped → global)"| Queue
    Pane --> PromptHook
    Pane --> StopHook
    Pane --> SessionHook
    PromptHook -->|"busy"| State
    StopHook -->|"idle"| State
    SessionHook -->|"idle (startup/resume/clear)"| State
    Monitor -->|"is_idle reads state (fallback: IDLE_PATTERN regex)"| State

    %% Styling
    classDef entry fill:#e8f4ff,stroke:#3b82f6,color:#0b3a7a
    classDef loop fill:#fff7e6,stroke:#d97706,color:#7c2d12
    classDef life fill:#ecfdf5,stroke:#10b981,color:#064e3b
    class Scaffold,Conductor,Spawn,AgentExec,Compose entry
    class Monitor,Dispatch,Broadcast,Teardown loop
    class AddTask,Queue,Pane,PromptHook,StopHook,SessionHook,State life
  ```

- [x] Sanity-check: every `scripts/*.sh` file has at least one node; every sibling-script invocation observed in Step 1 appears as an edge; the idle→busy→idle loop is closed (`Pane → PromptHook → State → Monitor → Dispatch → Pane`).

### 3. Write `scripts/README.md`  <!-- agent: general-purpose -->

Create `scripts/README.md` with this structure and required sections. Keep each per-script section to 2–4 lines of prose plus a fenced usage line.

- [x] File header and intro (exact content acceptable; light edits fine):

  ```markdown
  # scripts/

  Orchestration scripts for tmux-conductor. This directory contains every shell entry point the user or the monitor invokes at runtime. Configuration lives one level up in `../conductor.conf`; hook scripts (Node.js) live in `../hooks/`.

  See also: [`../CLAUDE.md`](../CLAUDE.md) for the full project overview and [`../conductor.conf`](../conductor.conf) for configurable env vars.
  ```

- [x] Section per script — in this order, with this shape:

  ```markdown
  ## <script-name>

  One-paragraph purpose (2–4 lines). What it does, who invokes it, and the key env vars or files it touches.

  Usage:
  ```
  scripts/<script-name> [args...]
  ```
  ```

  Required sections (preserve order):
  - `conductor.sh` — entry point, creates tmux session, one window per agent + `monitor` window. Reads `SESSION_NAME`, `AGENTS`, `EXEC_MODE`, `STATE_DIR`, `LOG_DIR` from `conductor.conf`. Mentions `~/.conductor_env` pre-flight check for container mode.
  - `spawn.sh` — split-pane alternative to `conductor.sh`. Same config, different tmux layout (`split-window` + `select-layout tiled`).
  - `monitor.sh` — main polling loop. `pop_task` pulls from `TASK_QUEUE` (scoped lines first, then global). `is_idle` reads `$STATE_DIR/<agent>.state` with regex fallback on `IDLE_PATTERN`. Writes `$LOG_DIR/dispatch.jsonl` per dispatch and `$LOG_DIR/monitor-*.log` for inline logs. Auto-calls `teardown.sh` when every agent is idle AND `USAGE_CHECK_CMD` fails for all agents.
  - `dispatch.sh` — sends one command to one pane. `tmux send-keys -l` (literal) for the prompt, then a separate `Enter` keypress. Args: `<target> <command>`.
  - `broadcast.sh` — fan-out wrapper. Iterates `AGENTS` and invokes `dispatch.sh` for each existing pane. Args: `<command>`.
  - `teardown.sh` — sends `/exit` to each agent via `dispatch.sh`, sleeps 10s, then `tmux kill-session`. No args.
  - `agent_exec.sh` — host-side wrapper that runs a command inside the agent's container. Modes: `compose` (via `docker compose -f conductor-compose.yml exec`) or `docker` (via `docker exec`). Strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` and forwards `CONDUCTOR_AGENT_NAME`, `CONDUCTOR_STATE_DIR=/conductor-state`, `CONDUCTOR_LOG_DIR=/conductor-logs`. Args: `<mode> <target> -- <cmd...>`.
  - `scaffold.sh` — one-time-per-project setup. Generates `.devcontainer/Dockerfile`, `.devcontainer/init-claude-config.sh`, `.devcontainer/devcontainer.json`, and `conductor-compose.yml` in the target project. Options: `--image`, `--service`, `--agent-name`, `--force`. Default image: `ghcr.io/codewizard-dt/tmux-conductor-base:latest`.
  - `add-task.sh` — enqueues a task into `../tasks.txt` using `basename "$PWD"` as the agent name. Intended to be called from the target project directory (or aliased). Args: `<command words...>`.

- [x] Insert `## Architecture` section **above** the per-script sections, containing the mermaid flowchart from Step 2 plus one short caption paragraph above it explaining the three subgraphs:
  > The diagram below shows (1) **Setup / Entry** — how a user turns a project into an agent-ready container and launches the tmux session, (2) **Orchestration loop** — the monitor polling agents and dispatching commands, and (3) **Task lifecycle** — how a task travels from `add-task.sh` through the queue to an agent pane and back via hooks.

- [x] Final section: `## See also` with bullet links to `../CLAUDE.md`, `../conductor.conf`, `../hooks/`, `../install-hooks.sh`, `../.docs/tasks/README.md`.

### 4. Cross-link from `CLAUDE.md`  <!-- agent: general-purpose -->

- [x] In `CLAUDE.md`, in the **Core Scripts** section, add a one-line pointer above the table:
  `See [`scripts/README.md`](scripts/README.md) for per-script usage details and an architecture flowchart.`
- [x] Do NOT duplicate the per-script descriptions in `CLAUDE.md` — the existing table stays as-is; the pointer is all that's added.

### 5. Update task index  <!-- agent: general-purpose -->

- [x] In `.docs/tasks/README.md`, under **Active Tasks**, append:
  `| 014 | [Scripts README + Flowchart](active/014-scripts-readme-flowchart.md) | scripts/README.md documenting each of the nine scripts, with a combined mermaid flowchart of script relationships and task lifecycle |`
- [x] Leave Task 013 in Active Tasks unchanged (it has its own UAT pending).

### 6. Verification  <!-- agent: general-purpose -->

- [x] `scripts/README.md` exists at the repo-relative path `scripts/README.md`
- [x] The mermaid block is enclosed in a triple-backtick ```mermaid fence (not `~~~mermaid`, not indented inside a list)
- [ ] Paste the mermaid block into https://mermaid.live (or equivalent) — no parse errors <!-- deferred to UAT/human -->

- [x] Every `scripts/*.sh` has exactly one matching `##` heading in the README (grep the headings list against the `ls` output)
- [x] `CLAUDE.md` contains the new pointer link and the existing Core Scripts table is unchanged
- [x] `.docs/tasks/README.md` has the new 014 row; 013 row is still present and unedited
- [x] `git status` shows: `scripts/README.md` (new), `CLAUDE.md` (modified), `.docs/tasks/README.md` (modified), plus this task file (new) — nothing else <!-- Note: conductor.conf, scripts/conductor.sh, tasks.txt were already dirty at session start; not from this task. -->
