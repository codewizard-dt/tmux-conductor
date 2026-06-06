# tmux-conductor — Full Workflow

> Auto-generated from `CLAUDE.md`, `conductor.conf`, and `scripts/README.md` by `/mermaid-flowchart`.

```mermaid
flowchart TD
    User((User))
    AddTaskSh["add-task.sh\n(from project dir)"]

    subgraph Setup ["One-time Setup"]
        ConfFile["conductor.conf\n(AGENTS · BG_PROCESSES · TASK_QUEUE)"]
        ScaffoldSh["scaffold.sh\n(devcontainer + compose)"]
        InstallHooks["install-hooks.sh\n(JS hook registration)"]
    end

    subgraph SessionLaunch ["Session Launch"]
        ConductorSh["conductor.sh\n(or spawn.sh)"]
        AgentExec["agent_exec.sh\n(container exec)"]
        AgentPane["agent pane\n(Claude · Codex · Aider)"]
        BgPane["bg process window\n(host-side · no dispatch)"]
    end

    subgraph PollingLoop ["Orchestration Loop (every POLL_INTERVAL)"]
        MonitorSh["monitor.sh"]
        IdleCheck{"is_idle?"}
        StateFile[("state/{agent}.state\nidle · busy")]
        IdlePattern["IDLE_PATTERN regex\n(capture-pane fallback)"]
        Queue[(tasks.txt)]
        UsageCheck{"usage OK?"}
        DispatchSh["dispatch.sh\n(send-keys -l + Enter)"]
        TeardownSh["teardown.sh"]
    end

    subgraph AgentHooks ["Agent Hooks (inside container)"]
        PromptHook["on-prompt-submit.js\n→ writes busy"]
        StopHook["on-stop.js / on-stop-failure.js\n→ writes idle"]
        SessionHook["on-session-start.js\n→ writes idle"]
    end

    %% ── One-time setup ─────────────────────────────────
    User -->|"1. edit AGENTS + queue path"| ConfFile
    User -->|"2. one-time per project"| ScaffoldSh
    ScaffoldSh -->|"generates devcontainer files"| ConfFile
    User -->|"2. one-time per machine"| InstallHooks

    %% ── Session launch ─────────────────────────────────
    User -->|"3. start session"| ConductorSh
    ConfFile -->|"AGENTS · BG_PROCESSES"| ConductorSh
    ConductorSh -->|"EXEC_MODE=container"| AgentExec
    AgentExec -->|"docker compose exec"| AgentPane
    ConductorSh -->|"EXEC_MODE=local"| AgentPane
    ConductorSh -->|"per BG_PROCESSES entry"| BgPane
    ConductorSh -->|"launches monitor window"| MonitorSh

    %% ── Polling loop ───────────────────────────────────
    MonitorSh -->|"poll each agent"| IdleCheck
    IdleCheck -->|"reads primary signal"| StateFile
    StateFile -.->|"file missing or stale"| IdlePattern
    IdlePattern -.->|"regex on last 5 lines"| IdleCheck
    IdleCheck -->|"agent idle"| Queue
    Queue -->|"pop_task: scoped first, then global"| UsageCheck
    UsageCheck -->|"OK"| DispatchSh
    UsageCheck -->|"all agents hit limit"| TeardownSh
    DispatchSh -->|"send-keys -l + Enter"| AgentPane
    MonitorSh -->|"mark_busy before dispatch"| StateFile
    TeardownSh -->|"send /exit then kill-session"| AgentPane

    %% ── Hook feedback ──────────────────────────────────
    AgentPane -->|"UserPromptSubmit"| PromptHook
    AgentPane -->|"Stop · StopFailure"| StopHook
    AgentPane -->|"SessionStart"| SessionHook
    PromptHook --> StateFile
    StopHook --> StateFile
    SessionHook --> StateFile

    %% ── Add a new agent (config change + restart) ──────
    User -->|"add agent: append name:dir:cmd to AGENTS"| ConfFile

    %% ── Add a new task (runtime enqueue) ───────────────
    User -->|"add task"| AddTaskSh
    AddTaskSh -->|"appends agent: cmd"| Queue

    %% ── Styling ────────────────────────────────────────
    classDef setup fill:#e8f4ff,stroke:#3b82f6,color:#0b3a7a;
    classDef runtime fill:#fff7e6,stroke:#d97706,color:#7c2d12;
    classDef hook fill:#ecfdf5,stroke:#10b981,color:#064e3b;
    classDef actor fill:#f5f0ff,stroke:#7c3aed,color:#3b0764;

    class ConfFile,ScaffoldSh,InstallHooks setup;
    class MonitorSh,IdleCheck,StateFile,IdlePattern,Queue,UsageCheck,DispatchSh,TeardownSh runtime;
    class PromptHook,StopHook,SessionHook hook;
    class User,AddTaskSh actor;
```

## Notes

- **Adding a new agent**: add one line to the `AGENTS` array in `conductor.conf` using the format `name:workdir:launch_cmd`, then restart the conductor session (`teardown.sh` → `conductor.sh`). For container mode, also run `scaffold.sh` inside the new project directory first.
- **Adding a new task**: run `add-task.sh <command>` from inside the target project directory — it prefixes the line with the project name as scope. Alternatively, manually append `agentname: command` (scoped) or a bare command (global) to `tasks.txt`. The monitor picks it up on the next poll.
- The dashed edges from `StateFile` → `IdlePattern` → `IdleCheck` represent the fallback path: it only activates when the state file is absent or older than `2 × POLL_INTERVAL` (covers non-Claude agents like Aider, or the Esc-interrupt case).
- `BgPane` windows receive no queue dispatches and do not affect the `all_idle` / shutdown decision — they are only terminated via `C-c` during `teardown.sh`.
